import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthViolation,
  assertClaudeSubscriptionAuth,
  assertCodexAccount,
  buildSafeEnv,
  checkCodexAuthFile,
  isBlockedEnvKey,
} from "../src/auth-guard.js";

test("API 과금 가능 환경변수는 대소문자와 상관없이 제거된다", () => {
  const { env, removed } = buildSafeEnv(
    {
      PATH: "C:/bin",
      ANTHROPIC_API_KEY: "x",
      anthropic_auth_token: "x",
      OPENAI_API_KEY: "x",
      CODEX_API_KEY: "x",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "x",
      CLAUDECODE: "1",
      AWS_BEARER_TOKEN_BEDROCK: "x",
    },
    { CODEX_HOME: "C:/poc/.auth/codex" },
  );
  assert.deepEqual(env, { PATH: "C:/bin", CODEX_HOME: "C:/poc/.auth/codex" });
  assert.equal(removed.length, 8);
});

test("PoC가 넣는 전용 폴더 변수는 차단 목록에 걸려도 overrides로 다시 들어간다", () => {
  assert.equal(isBlockedEnvKey("CLAUDE_CONFIG_DIR"), true);
  const { env } = buildSafeEnv({ CLAUDE_CONFIG_DIR: "C:/Users/me/.claude" }, { CLAUDE_CONFIG_DIR: "C:/poc/.auth/claude" });
  assert.equal(env.CLAUDE_CONFIG_DIR, "C:/poc/.auth/claude");
});

test("Claude는 apiKeySource가 none일 때만 통과한다", () => {
  assert.doesNotThrow(() => assertClaudeSubscriptionAuth("none"));
  for (const source of ["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", undefined]) {
    assert.throws(() => assertClaudeSubscriptionAuth(source), AuthViolation);
  }
});

test("Codex auth.json은 ChatGPT 로그인이고 API 키가 없어야 통과한다", () => {
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {} })).ok, true);
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" })).ok, false);
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: "sk-x" })).ok, false);
  assert.equal(checkCodexAuthFile(null).ok, false);
  assert.equal(checkCodexAuthFile("{broken").ok, false);
});

test("Codex 계정 유형이 chatgpt가 아니면 중단한다", () => {
  assert.doesNotThrow(() => assertCodexAccount({ type: "chatgpt" }));
  assert.throws(() => assertCodexAccount({ type: "apiKey" }), AuthViolation);
  assert.throws(() => assertCodexAccount(null), AuthViolation);
});
