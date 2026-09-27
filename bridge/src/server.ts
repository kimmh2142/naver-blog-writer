import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ANALYSIS_VERSION, PHOTO_TYPES, analysisSchema, buildAnalysisPrompt, normalizeAnalysis } from "./analysis.js";
import {
  buildRepairPrompt,
  buildWritingPrompt,
  finalizeDraft,
  findStructureProblems,
  type WritingInput,
  type WritingPhoto,
  writingSchema,
} from "./writing.js";
import {
  type AiProvider,
  type CallErrorCode,
  ProviderCallError,
  type ProviderId,
  providerStatus,
  type ProviderStatus,
} from "./providers/types.js";
import { Semaphore } from "./semaphore.js";

export const BRIDGE_VERSION = "0.3.0";
const STATUS_CACHE_MS = 30_000;
/** 요청 1건의 사진 수 상한 (Android 배치 크기 상한과 같음) */
export const MAX_IMAGES_PER_REQUEST = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 150_000;
const WRITING_TIMEOUT_MS = 240_000;
const REPAIR_TIMEOUT_MS = 150_000;
/** 동시에 실행하는 모델 호출 수 */
const MODEL_CONCURRENCY = 2;

/** 길이와 무관하게 일정한 시간으로 토큰을 비교한다. */
export function tokenMatches(expected: string, header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(header.slice("Bearer ".length)));
}

/** 오류 코드별 HTTP 상태. Android는 본문의 error.code로 구분한다. */
export function httpStatusFor(code: CallErrorCode | "BAD_REQUEST" | "ANALYSIS_VERSION_MISMATCH" | "BUSY"): ContentfulStatusCode {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "API_KEY_BLOCKED":
    case "BILLING_RISK":
      return 403;
    case "AUTH_REQUIRED":
    case "ANALYSIS_VERSION_MISMATCH":
    case "BUSY":
      return 409;
    case "REFUSED":
      return 422;
    case "USAGE_LIMIT":
      return 429;
    case "TIMEOUT":
      return 504;
    default:
      return 502;
  }
}

export type AppDeps = {
  appToken: string;
  providers: Record<ProviderId, AiProvider>;
  now?: () => number;
  log?: (line: string) => void;
};

type AnalyzeMeta = { provider: ProviderId; analysisVersion: string; photoIds: string[]; category?: string; subjectName?: string };

class BadRequest extends Error {}

function parseMeta(raw: unknown): AnalyzeMeta {
  if (typeof raw !== "string") throw new BadRequest("meta 파트가 없습니다.");
  let meta: any;
  try {
    meta = JSON.parse(raw);
  } catch {
    throw new BadRequest("meta가 JSON이 아닙니다.");
  }
  if (meta?.provider !== "claude" && meta?.provider !== "codex") throw new BadRequest("provider는 claude 또는 codex여야 합니다.");
  const ids = meta.photoIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IMAGES_PER_REQUEST) {
    throw new BadRequest(`photoIds는 1~${MAX_IMAGES_PER_REQUEST}개여야 합니다.`);
  }
  if (!ids.every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new BadRequest("photoIds 형식이 올바르지 않거나 중복됩니다.");
  }
  return {
    provider: meta.provider,
    analysisVersion: String(meta.analysisVersion ?? ""),
    photoIds: ids,
    category: typeof meta.category === "string" ? meta.category.slice(0, 50) : undefined,
    subjectName: typeof meta.subjectName === "string" ? meta.subjectName.slice(0, 100) : undefined,
  };
}

const MAX_PHOTOS_PER_POST = 50;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)) : []);

/** 원고 생성 요청 검사. 사진은 postOrder 순서로 정렬해 돌려준다. */
export function parseGenerateBody(body: any): { providerId: ProviderId; input: WritingInput } {
  if (!body || typeof body !== "object") throw new BadRequest("요청 본문이 JSON이 아닙니다.");
  if (body.provider !== "claude" && body.provider !== "codex") throw new BadRequest("provider는 claude 또는 codex여야 합니다.");
  const photos = body.photos;
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > MAX_PHOTOS_PER_POST) {
    throw new BadRequest(`photos는 1~${MAX_PHOTOS_PER_POST}개여야 합니다.`);
  }
  const parsed: WritingPhoto[] = photos.map((p: any, i: number) => {
    if (typeof p?.photoId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(p.photoId)) throw new BadRequest(`${i + 1}번째 사진의 photoId가 올바르지 않습니다.`);
    if (!Number.isInteger(p.postOrder)) throw new BadRequest(`사진 ${p.photoId}의 postOrder가 없습니다.`);
    const a = p.analysis;
    if (!a || typeof a.description !== "string" || !a.description.trim()) throw new BadRequest(`사진 ${p.photoId}의 분석 결과가 없습니다. 먼저 사진 분석을 하세요.`);
    return {
      photoId: p.photoId,
      postOrder: p.postOrder,
      analysis: {
        type: PHOTO_TYPES.includes(a.type) ? a.type : "other",
        description: str(a.description, 1000),
        visibleText: str(a.visibleText, 1000),
        tags: strList(a.tags),
        uncertain: strList(a.uncertain),
      },
    };
  });
  if (new Set(parsed.map((p) => p.photoId)).size !== parsed.length) throw new BadRequest("photoId가 중복됩니다.");
  if (new Set(parsed.map((p) => p.postOrder)).size !== parsed.length) throw new BadRequest("postOrder가 중복됩니다.");
  parsed.sort((a, b) => a.postOrder - b.postOrder);
  const style = body.style && typeof body.style === "object" ? body.style : {};
  return {
    providerId: body.provider,
    input: {
      category: str(body.category, 30),
      subjectName: str(body.subjectName, 100),
      memo: str(body.memo, 5000),
      style: Object.fromEntries(Object.entries(style).map(([k, v]) => [k, str(v, 1000)])),
      photos: parsed,
    },
  };
}

const isJpeg = (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** 파일 이름(photoId.jpg)으로 사진을 찾아 meta.photoIds 순서대로 정렬한다. */
async function collectImages(files: unknown, photoIds: string[]): Promise<Buffer[]> {
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter((f): f is File => f instanceof File);
  if (list.length !== photoIds.length) throw new BadRequest(`사진 파트 수(${list.length})가 photoIds 수(${photoIds.length})와 다릅니다.`);
  const byId = new Map(list.map((f) => [f.name.replace(/\.jpe?g$/i, ""), f]));
  const images: Buffer[] = [];
  for (const id of photoIds) {
    const file = byId.get(id);
    if (!file) throw new BadRequest(`사진 ${id} 파트가 없습니다.`);
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequest(`사진 ${id}가 너무 큽니다.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!isJpeg(bytes)) throw new BadRequest(`사진 ${id}가 JPEG가 아닙니다.`);
    images.push(bytes);
  }
  return images;
}

export function createApp({ appToken, providers, now = Date.now, log = console.log }: AppDeps) {
  const app = new Hono();
  const startedAt = new Date(now()).toISOString();
  const statusCache = new Map<ProviderId, { at: number; value: Promise<ProviderStatus> }>();
  const modelCalls = new Semaphore(MODEL_CONCURRENCY);
  /** 원고 생성은 한 번에 하나만 */
  let generating = false;

  // 요청 한 줄 로그. 본문, 사진, 분석 결과, 토큰은 남기지 않는다.
  app.use("*", async (c, next) => {
    const started = now();
    await next();
    log(`${new Date(started).toISOString()} ${c.req.method} ${c.req.path} ${c.res.status} ${now() - started}ms`);
  });

  app.use("/v1/*", async (c, next) => {
    if (!tokenMatches(appToken, c.req.header("authorization"))) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "앱 토큰이 맞지 않습니다." } }, 401);
    }
    await next();
  });

  /** 동시에 들어온 요청은 같은 확인 결과를 기다린다(Claude 상태 확인이 여러 번 뜨지 않게). */
  function statusOf(provider: AiProvider, refresh: boolean): Promise<ProviderStatus> {
    const cached = statusCache.get(provider.id);
    if (!refresh && cached && now() - cached.at < STATUS_CACHE_MS) return cached.value;
    const value = provider.status().catch((e: Error) =>
      providerStatus({ provider: provider.id, models: { analysis: null, writing: null } }, { code: "ERROR", message: e.message }),
    );
    statusCache.set(provider.id, { at: now(), value });
    return value;
  }

  /** 두 Provider의 로그인·과금 안전·사용량 상태. 모델 호출은 하지 않는다. */
  app.get("/v1/status", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    const [claude, codex] = await Promise.all([statusOf(providers.claude, refresh), statusOf(providers.codex, refresh)]);
    return c.json({ bridge: { version: BRIDGE_VERSION, startedAt, analysisVersion: ANALYSIS_VERSION }, providers: { claude, codex } });
  });

  /**
   * 사진 한 배치(최대 10장)를 선택한 Provider로 분석한다.
   * multipart: meta(JSON) + photo 파트들(파일 이름 = photoId.jpg). 사진은 메모리에서만 다루고 저장하지 않는다.
   */
  app.post("/v1/photos/analyze", bodyLimit({ maxSize: 40 * 1024 * 1024 }), async (c) => {
    let meta: AnalyzeMeta;
    let images: Buffer[];
    try {
      const body = await c.req.parseBody({ all: true });
      meta = parseMeta(body.meta);
      if (meta.analysisVersion !== ANALYSIS_VERSION) {
        return c.json(
          { error: { code: "ANALYSIS_VERSION_MISMATCH", message: `앱의 분석 버전(${meta.analysisVersion})과 브리지(${ANALYSIS_VERSION})가 다릅니다. 앱과 브리지를 같은 버전으로 맞추세요.` } },
          httpStatusFor("ANALYSIS_VERSION_MISMATCH"),
        );
      }
      images = await collectImages(body.photo, meta.photoIds);
    } catch (e) {
      if (e instanceof BadRequest) return c.json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
      throw e;
    }

    const provider = providers[meta.provider];
    // 모델 호출 전 확인: 로그인, API 키, 구독 외 과금, 사용량 한도
    const status = await statusOf(provider, false);
    if (!status.ready) {
      const code = status.code as CallErrorCode;
      return c.json({ error: { code, message: status.message } }, httpStatusFor(code));
    }

    try {
      const result = await modelCalls.run(() =>
        provider.generateStructured({
          purpose: "analysis",
          instructions: buildAnalysisPrompt(images.length, meta),
          images,
          schema: analysisSchema as unknown as Record<string, unknown>,
          timeoutMs: ANALYSIS_TIMEOUT_MS,
        }),
      );
      const outcome = normalizeAnalysis(result.output, meta.photoIds);
      if (!outcome) {
        return c.json({ error: { code: "INVALID_OUTPUT", message: "분석 결과 형식이 올바르지 않습니다." } }, httpStatusFor("INVALID_OUTPUT"));
      }
      return c.json({ provider: meta.provider, model: result.model, analysisVersion: ANALYSIS_VERSION, ...outcome });
    } catch (e) {
      if (e instanceof ProviderCallError) {
        // 과금·로그인 관련 실패면 다음 요청이 상태를 새로 확인하게 한다.
        if (["AUTH_REQUIRED", "API_KEY_BLOCKED", "BILLING_RISK", "USAGE_LIMIT"].includes(e.code)) statusCache.delete(provider.id);
        return c.json({ error: { code: e.code, message: e.message } }, httpStatusFor(e.code));
      }
      throw e;
    }
  });

  /**
   * 원고 생성. 사진 파일은 받지 않고, 앱에 저장된 해당 Provider의 사진 분석만 받는다.
   * 구조 문제가 있으면 1회만 수정 요청하고, 그래도 안 되면 INVALID_OUTPUT.
   */
  app.post("/v1/posts/generate", bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    let providerId: ProviderId;
    let input: WritingInput;
    try {
      ({ providerId, input } = parseGenerateBody(await c.req.json().catch(() => null)));
    } catch (e) {
      if (e instanceof BadRequest) return c.json({ error: { code: "BAD_REQUEST", message: e.message } }, 400);
      throw e;
    }
    if (generating) {
      return c.json({ error: { code: "BUSY", message: "PC에서 다른 원고를 만드는 중입니다. 끝난 뒤 다시 시도하세요." } }, httpStatusFor("BUSY"));
    }
    generating = true;
    const provider = providers[providerId];
    try {
      const status = await statusOf(provider, false);
      if (!status.ready) {
        const code = status.code as CallErrorCode;
        return c.json({ error: { code, message: status.message } }, httpStatusFor(code));
      }
      const call = (instructions: string, timeoutMs: number) =>
        modelCalls.run(() =>
          provider.generateStructured({ purpose: "writing", instructions, images: [], schema: writingSchema as unknown as Record<string, unknown>, timeoutMs }),
        );

      let result = await call(buildWritingPrompt(input), WRITING_TIMEOUT_MS);
      let problems = findStructureProblems(result.output, input.photos.length);
      let repaired: string[] | null = null;
      if (problems.length > 0) {
        repaired = problems;
        result = await call(buildRepairPrompt(input, result.output, problems), REPAIR_TIMEOUT_MS);
        problems = findStructureProblems(result.output, input.photos.length);
        if (problems.length > 0) {
          return c.json(
            { error: { code: "INVALID_OUTPUT", message: `원고 구조를 1회 수정했지만 여전히 문제가 있습니다: ${problems.join(" / ")}` } },
            httpStatusFor("INVALID_OUTPUT"),
          );
        }
      }
      const { draft, validation } = finalizeDraft(result.output, input.photos, repaired);
      return c.json({
        provider: providerId,
        model: result.model,
        post: draft,
        validation: { repaired: repaired !== null, items: validation },
      });
    } catch (e) {
      if (e instanceof ProviderCallError) {
        if (["AUTH_REQUIRED", "API_KEY_BLOCKED", "BILLING_RISK", "USAGE_LIMIT"].includes(e.code)) statusCache.delete(provider.id);
        return c.json({ error: { code: e.code, message: e.message } }, httpStatusFor(e.code));
      }
      throw e;
    } finally {
      generating = false;
    }
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "없는 경로입니다." } }, 404));
  app.onError((e, c) => {
    log(`오류: ${e.name}`);
    return c.json({ error: { code: "INTERNAL", message: "브리지 내부 오류" } }, 500);
  });

  return app;
}
