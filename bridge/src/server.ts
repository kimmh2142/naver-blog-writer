import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { type AiProvider, type ProviderId, providerStatus, type ProviderStatus } from "./providers/types.js";

export const BRIDGE_VERSION = "0.1.0";
const STATUS_CACHE_MS = 30_000;

/** 길이와 무관하게 일정한 시간으로 토큰을 비교한다. */
export function tokenMatches(expected: string, header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(header.slice("Bearer ".length)));
}

export type AppDeps = {
  appToken: string;
  providers: Record<ProviderId, AiProvider>;
  now?: () => number;
  log?: (line: string) => void;
};

export function createApp({ appToken, providers, now = Date.now, log = console.log }: AppDeps) {
  const app = new Hono();
  const startedAt = new Date(now()).toISOString();
  const statusCache = new Map<ProviderId, { at: number; value: ProviderStatus }>();

  // 요청 한 줄 로그. 본문, 사진, 토큰은 남기지 않는다.
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

  async function statusOf(provider: AiProvider, refresh: boolean): Promise<ProviderStatus> {
    const cached = statusCache.get(provider.id);
    if (!refresh && cached && now() - cached.at < STATUS_CACHE_MS) return cached.value;
    let value: ProviderStatus;
    try {
      value = await provider.status();
    } catch (e) {
      value = providerStatus({ provider: provider.id, models: { analysis: null, writing: null } }, { code: "ERROR", message: (e as Error).message });
    }
    statusCache.set(provider.id, { at: now(), value });
    return value;
  }

  /** 두 Provider의 로그인·과금 안전·사용량 상태. 모델 호출은 하지 않는다. */
  app.get("/v1/status", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    const [claude, codex] = await Promise.all([statusOf(providers.claude, refresh), statusOf(providers.codex, refresh)]);
    return c.json({ bridge: { version: BRIDGE_VERSION, startedAt }, providers: { claude, codex } });
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "없는 경로입니다." } }, 404));
  app.onError((e, c) => {
    log(`오류: ${e.message}`);
    return c.json({ error: { code: "INTERNAL", message: "브리지 내부 오류" } }, 500);
  });

  return app;
}
