import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, readConfig } from "../src/config.js";
import { type AiProvider, type ProviderId, providerStatus } from "../src/providers/types.js";
import { createApp, tokenMatches } from "../src/server.js";

const TOKEN = "t".repeat(43);

function fakeProvider(id: ProviderId, behavior: () => Promise<any>) {
  let calls = 0;
  const provider: AiProvider = {
    id,
    status: async () => {
      calls++;
      return behavior();
    },
  };
  return { provider, calls: () => calls };
}

function setup(now: { t: number }) {
  const claude = fakeProvider("claude", async () =>
    providerStatus({ provider: "claude", models: { analysis: "sonnet", writing: "opus" } }, { code: "READY", message: "사용 가능", plan: "pro" }),
  );
  const codex = fakeProvider("codex", async () => {
    throw new Error("app-server 응답 없음");
  });
  const app = createApp({ appToken: TOKEN, providers: { claude: claude.provider, codex: codex.provider }, now: () => now.t, log: () => {} });
  return { app, claude, codex };
}

const auth = { authorization: `Bearer ${TOKEN}` };

test("토큰이 없거나 다르면 401", async () => {
  const { app } = setup({ t: 0 });
  assert.equal((await app.request("/v1/status")).status, 401);
  assert.equal((await app.request("/v1/status", { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal(tokenMatches(TOKEN, `Bearer ${TOKEN}`), true);
  assert.equal(tokenMatches(TOKEN, TOKEN), false);
});

test("상태: 한 Provider가 실패해도 다른 Provider 결과는 돌려준다", async () => {
  const { app } = setup({ t: 0 });
  const res = await app.request("/v1/status", { headers: auth });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.providers.claude.code, "READY");
  assert.equal(body.providers.claude.ready, true);
  assert.equal(body.providers.codex.code, "ERROR");
  assert.equal(body.providers.codex.ready, false);
  assert.equal(body.bridge.version, "0.1.0");
});

test("상태는 30초 동안 캐시되고 refresh=1이면 다시 확인한다", async () => {
  const now = { t: 0 };
  const { app, claude } = setup(now);
  await app.request("/v1/status", { headers: auth });
  now.t = 10_000;
  await app.request("/v1/status", { headers: auth });
  assert.equal(claude.calls(), 1);
  await app.request("/v1/status?refresh=1", { headers: auth });
  assert.equal(claude.calls(), 2);
  now.t = 50_000;
  await app.request("/v1/status", { headers: auth });
  assert.equal(claude.calls(), 3);
});

test("없는 경로는 토큰 확인 뒤 404", async () => {
  const { app } = setup({ t: 0 });
  assert.equal((await app.request("/v1/nope", { headers: auth })).status, 404);
});

test("설정: 토큰이 짧으면 거부, 모델 기본값과 빈 값 처리", () => {
  assert.throws(() => readConfig({ BRIDGE_APP_TOKEN: "short" }), ConfigError);
  const config = readConfig({ BRIDGE_APP_TOKEN: TOKEN, CODEX_WRITING_MODEL: " " });
  assert.equal(config.port, 8787);
  assert.deepEqual(config.models.claude, { analysis: "sonnet", writing: "opus" });
  assert.deepEqual(config.models.codex, { analysis: null, writing: null });
  assert.throws(() => readConfig({ BRIDGE_APP_TOKEN: TOKEN, BRIDGE_PORT: "80" }), ConfigError);
});
