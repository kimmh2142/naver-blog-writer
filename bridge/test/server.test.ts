import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, readConfig } from "../src/config.js";
import {
  type AiProvider,
  ProviderCallError,
  type ProviderId,
  providerStatus,
  type StructuredRequest,
  type StructuredResult,
} from "../src/providers/types.js";
import { createApp, tokenMatches } from "../src/server.js";

const TOKEN = "t".repeat(43);
const auth = { authorization: `Bearer ${TOKEN}` };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

type Fake = { provider: AiProvider; statusCalls: () => number; requests: StructuredRequest[] };

function fakeProvider(
  id: ProviderId,
  status: () => Promise<any>,
  generate: (req: StructuredRequest) => Promise<StructuredResult> = async () => ({ output: null, model: null, usage: null }),
): Fake {
  let statusCalls = 0;
  const requests: StructuredRequest[] = [];
  return {
    provider: {
      id,
      status: async () => {
        statusCalls++;
        return status();
      },
      generateStructured: async (req) => {
        requests.push(req);
        return generate(req);
      },
    },
    statusCalls: () => statusCalls,
    requests,
  };
}

const ready = (id: ProviderId) => async () =>
  providerStatus({ provider: id, models: { analysis: "sonnet", writing: "opus" } }, { code: "READY", message: "사용 가능", plan: "pro" });

function setup(now = { t: 0 }, claudeGenerate?: (req: StructuredRequest) => Promise<StructuredResult>) {
  const claude = fakeProvider("claude", ready("claude"), claudeGenerate);
  const codex = fakeProvider("codex", async () => {
    throw new Error("app-server 응답 없음");
  });
  const app = createApp({ appToken: TOKEN, providers: { claude: claude.provider, codex: codex.provider }, now: () => now.t, log: () => {} });
  return { app, claude, codex };
}

function analyzeForm(meta: Record<string, unknown>, photos: { id: string; bytes?: Buffer }[]) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  for (const p of photos) form.append("photo", new Blob([new Uint8Array(p.bytes ?? JPEG)], { type: "image/jpeg" }), `${p.id}.jpg`);
  return form;
}

const baseMeta = { provider: "claude", analysisVersion: "v1", photoIds: ["a1", "b2"], category: "TRAVEL" };

test("토큰이 없거나 다르면 401", async () => {
  const { app } = setup();
  assert.equal((await app.request("/v1/status")).status, 401);
  assert.equal((await app.request("/v1/status", { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal(tokenMatches(TOKEN, `Bearer ${TOKEN}`), true);
  assert.equal(tokenMatches(TOKEN, TOKEN), false);
});

test("상태: 한 Provider가 실패해도 다른 Provider 결과는 돌려준다", async () => {
  const { app } = setup();
  const body: any = await (await app.request("/v1/status", { headers: auth })).json();
  assert.equal(body.providers.claude.code, "READY");
  assert.equal(body.providers.codex.code, "ERROR");
  assert.equal(body.bridge.analysisVersion, "v1");
});

test("상태는 30초 캐시, refresh=1이면 다시 확인", async () => {
  const now = { t: 0 };
  const { app, claude } = setup(now);
  await app.request("/v1/status", { headers: auth });
  now.t = 10_000;
  await app.request("/v1/status", { headers: auth });
  assert.equal(claude.statusCalls(), 1);
  await app.request("/v1/status?refresh=1", { headers: auth });
  assert.equal(claude.statusCalls(), 2);
});

test("분석: ref를 photoId로 되돌리고, 사진 순서대로 Provider에 넘긴다", async () => {
  const { app, claude } = setup({ t: 0 }, async () => ({
    output: { photos: [
      { ref: "2", type: "food", description: "짬뽕", visibleText: "", tags: ["짬뽕"], uncertain: [] },
      { ref: "1", type: "exterior", description: "건물 외관", visibleText: "초원사진관", tags: [], uncertain: ["간판 일부 가림"] },
    ] },
    model: "claude-sonnet-5",
    usage: null,
  }));
  // 파트 순서를 일부러 뒤집어도 meta.photoIds 순서를 따른다
  const form = analyzeForm(baseMeta, [{ id: "b2", bytes: Buffer.from([0xff, 0xd8, 0xff, 0x02]) }, { id: "a1", bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01]) }]);
  const res = await app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: form });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.model, "claude-sonnet-5");
  assert.equal(body.analysisVersion, "v1");
  assert.deepEqual(body.results.map((r: any) => [r.photoId, r.analysis.type]), [["a1", "exterior"], ["b2", "food"]]);
  assert.deepEqual(body.failed, []);
  const req = claude.requests[0];
  assert.equal(req.purpose, "analysis");
  assert.deepEqual(req.images.map((b) => b[3]), [0x01, 0x02]);
});

test("분석: 입력 검증 (버전, 사진 수, JPEG, 이름)", async () => {
  const { app, claude } = setup();
  const post = (form: FormData) => app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: form });
  assert.equal((await post(analyzeForm({ ...baseMeta, analysisVersion: "v0" }, [{ id: "a1" }, { id: "b2" }]))).status, 409);
  assert.equal((await post(analyzeForm(baseMeta, [{ id: "a1" }]))).status, 400);
  assert.equal((await post(analyzeForm(baseMeta, [{ id: "a1" }, { id: "b2", bytes: Buffer.from("GIF89a") }]))).status, 400);
  assert.equal((await post(analyzeForm(baseMeta, [{ id: "a1" }, { id: "zz" }]))).status, 400);
  assert.equal((await post(analyzeForm({ ...baseMeta, provider: "gemini" }, [{ id: "a1" }, { id: "b2" }]))).status, 400);
  const tooMany = Array.from({ length: 11 }, (_, i) => `p${i}`);
  assert.equal((await post(analyzeForm({ ...baseMeta, photoIds: tooMany }, tooMany.map((id) => ({ id }))))).status, 400);
  assert.equal(claude.requests.length, 0);
});

test("분석: Provider가 준비되지 않으면 모델을 호출하지 않는다", async () => {
  const blocked = fakeProvider("claude", async () =>
    providerStatus({ provider: "claude", models: { analysis: null, writing: null } }, { code: "BILLING_RISK", message: "초과 사용 켜짐" }),
  );
  const codex = fakeProvider("codex", ready("codex"));
  const app = createApp({ appToken: TOKEN, providers: { claude: blocked.provider, codex: codex.provider }, log: () => {} });
  const res = await app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: analyzeForm(baseMeta, [{ id: "a1" }, { id: "b2" }]) });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as any).error.code, "BILLING_RISK");
  assert.equal(blocked.requests.length, 0);
});

test("분석: 호출 중 과금 방어가 걸리면 코드 그대로 돌려주고 상태 캐시를 비운다", async () => {
  const { app, claude } = setup({ t: 0 }, async () => {
    throw new ProviderCallError("BILLING_RISK", "초과 사용 전환 감지");
  });
  const form = () => analyzeForm(baseMeta, [{ id: "a1" }, { id: "b2" }]);
  const res = await app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: form() });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as any).error.code, "BILLING_RISK");
  await app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: form() });
  assert.equal(claude.statusCalls(), 2);
});

test("분석: 결과 형식이 틀리면 INVALID_OUTPUT, 일부 누락은 그 사진만 실패", async () => {
  const bad = setup({ t: 0 }, async () => ({ output: { wrong: true }, model: null, usage: null }));
  const res = await bad.app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: analyzeForm(baseMeta, [{ id: "a1" }, { id: "b2" }]) });
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as any).error.code, "INVALID_OUTPUT");

  const partial = setup({ t: 0 }, async () => ({
    output: { photos: [{ ref: "1", type: "food", description: "면", visibleText: "", tags: [], uncertain: [] }] },
    model: null,
    usage: null,
  }));
  const body: any = await (await partial.app.request("/v1/photos/analyze", { method: "POST", headers: auth, body: analyzeForm(baseMeta, [{ id: "a1" }, { id: "b2" }]) })).json();
  assert.deepEqual(body.results.map((r: any) => r.photoId), ["a1"]);
  assert.deepEqual(body.failed.map((f: any) => f.photoId), ["b2"]);
});

const genBody = {
  provider: "claude",
  category: "TRAVEL",
  subjectName: "군산",
  memo: "엄마랑 다녀옴",
  style: { endings: "~했어요" },
  photos: [
    { photoId: "b2", postOrder: 1, analysis: { type: "food", description: "짬뽕", visibleText: "", tags: [], uncertain: [] } },
    { photoId: "a1", postOrder: 0, analysis: { type: "exterior", description: "건물", visibleText: "초원사진관", tags: [], uncertain: [] } },
  ],
};
const goodDraft = {
  titleCandidates: ["t1", "t2", "t3"],
  blocks: [
    { type: "imageGroup", text: "", photoRefs: ["1", "2"] },
    { type: "paragraph", text: "본문 [확인 필요: 식당 이름]", photoRefs: [] },
  ],
  hashtags: ["#군산"],
  confirmNeeded: [],
};
const postGenerate = (app: ReturnType<typeof createApp>) =>
  app.request("/v1/posts/generate", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(genBody) });

test("원고 생성: 사진 없이 분석만 보내고, 번호를 photoId로 되돌리고 확인 필요를 동기화", async () => {
  const { app, claude } = setup({ t: 0 }, async () => ({ output: goodDraft, model: "claude-opus-5-5", usage: null }));
  const res = await postGenerate(app);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.post.blocks[0].photoIds, ["a1", "b2"]); // postOrder 순서
  assert.deepEqual(body.post.confirmNeeded, ["식당 이름"]);
  assert.equal(body.validation.repaired, false);
  assert.equal(claude.requests.length, 1);
  assert.equal(claude.requests[0].purpose, "writing");
  assert.equal(claude.requests[0].images.length, 0);
  assert.match(claude.requests[0].instructions, /사진 1: 종류 exterior/);
});

test("원고 생성: 체험단 안내문이 있어도 모델 호출은 1회, 체크리스트를 함께 돌려준다", async () => {
  const { app, claude } = setup({ t: 0 }, async () => ({
    output: {
      ...goodDraft,
      campaignRules: { titleKeywords: ["t"], bodyKeywords: [], requiredHashtags: ["군산"], minPhotos: 0 },
      campaignChecks: [{ requirement: "지도 첨부", status: "APPLIED", note: "" }],
    },
    model: "m",
    usage: null,
  }));
  const res = await app.request("/v1/posts/generate", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ ...genBody, campaign: { text: "제목에 t 포함, 해시태그 #군산, 지도 첨부" } }),
  });
  const body: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(claude.requests.length, 1);
  assert.match(claude.requests[0].instructions, /\[체험단 요구사항\]/);
  assert.equal(body.post.isCampaign, true);
  assert.deepEqual(body.post.campaignChecks.map((c: any) => c.status), ["APPLIED", "APPLIED", "MANUAL"]);

  const plain: any = await (await postGenerate(app)).json();
  assert.equal(plain.post.isCampaign, false);
  assert.deepEqual(plain.post.campaignChecks, []);
});

test("원고 생성: 구조 문제가 있으면 1회만 수정 요청", async () => {
  const outputs = [{ ...goodDraft, blocks: [{ type: "imageGroup", text: "", photoRefs: ["2", "1"] }, goodDraft.blocks[1]] }, goodDraft];
  const { app, claude } = setup({ t: 0 }, async () => ({ output: outputs.shift(), model: "m", usage: null }));
  const body: any = await (await postGenerate(app)).json();
  assert.equal(body.validation.repaired, true);
  assert.equal(claude.requests.length, 2);
  assert.match(claude.requests[1].instructions, /구조 문제/);

  const bad = setup({ t: 0 }, async () => ({ output: { ...goodDraft, titleCandidates: ["하나"] }, model: "m", usage: null }));
  const res = await postGenerate(bad.app);
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as any).error.code, "INVALID_OUTPUT");
  assert.equal(bad.claude.requests.length, 2); // 원래 1회 + 수정 1회, 그 이상은 없음
});

test("원고 생성: 한 번에 하나만 (진행 중이면 BUSY)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { app } = setup({ t: 0 }, async () => {
    await gate;
    return { output: goodDraft, model: "m", usage: null };
  });
  const first = postGenerate(app);
  await new Promise((r) => setTimeout(r, 20));
  const second = await postGenerate(app);
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as any).error.code, "BUSY");
  release();
  assert.equal((await first).status, 200);
});

test("원고 생성: 호출 중 한도 도달이면 코드 그대로", async () => {
  const { app } = setup({ t: 0 }, async () => {
    throw new ProviderCallError("USAGE_LIMIT", "한도 도달");
  });
  const res = await postGenerate(app);
  assert.equal(res.status, 429);
  assert.equal(((await res.json()) as any).error.code, "USAGE_LIMIT");
});

test("설정: 토큰이 짧으면 거부, 모델 기본값과 빈 값 처리", () => {
  assert.throws(() => readConfig({ BRIDGE_APP_TOKEN: "short" }), ConfigError);
  const config = readConfig({ BRIDGE_APP_TOKEN: TOKEN, CODEX_WRITING_MODEL: " " });
  assert.equal(config.port, 8787);
  assert.deepEqual(config.models.claude, { analysis: "sonnet", writing: "opus" });
  assert.deepEqual(config.models.codex, { analysis: null, writing: null });
  assert.throws(() => readConfig({ BRIDGE_APP_TOKEN: TOKEN, BRIDGE_PORT: "80" }), ConfigError);
});
