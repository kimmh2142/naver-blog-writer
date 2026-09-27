import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSafeEnv,
  checkCodexAuthFile,
  codexUsageWindows,
  evaluateClaudeAccount,
  evaluateClaudeRateLimitEvent,
  evaluateClaudeUsage,
  evaluateCodexAccount,
  evaluateCodexRateLimits,
} from "../src/guard.js";

test("API 키 계열과 브리지 비밀값은 AI 프로세스 환경에서 제거된다", () => {
  const { env, removed } = buildSafeEnv(
    { PATH: "C:/bin", ANTHROPIC_API_KEY: "x", openai_api_key: "x", CODEX_API_KEY: "x", BRIDGE_APP_TOKEN: "secret", CLAUDE_CODE_USE_BEDROCK: "1" },
    { CODEX_HOME: "C:/bridge/.auth/codex" },
  );
  assert.deepEqual(env, { PATH: "C:/bin", CODEX_HOME: "C:/bridge/.auth/codex" });
  assert.equal(removed.length, 5);
});

test("Claude 계정: 구독 로그인만 READY", () => {
  assert.equal(evaluateClaudeAccount({ subscriptionType: "pro", apiKeySource: "none", apiProvider: "firstParty" }).code, "READY");
  assert.equal(evaluateClaudeAccount({ subscriptionType: "pro" }).code, "READY");
  assert.equal(evaluateClaudeAccount({ apiKeySource: "ANTHROPIC_API_KEY" }).code, "API_KEY_BLOCKED");
  assert.equal(evaluateClaudeAccount({ subscriptionType: "max", apiProvider: "bedrock" }).code, "API_KEY_BLOCKED");
  assert.equal(evaluateClaudeAccount({}).code, "AUTH_REQUIRED");
});

test("Claude 사용량: 초과 사용이 켜져 있으면 호출 전에 차단", () => {
  const base = { five_hour: { utilization: 38, resets_at: "2026-09-28T03:00:00Z" }, seven_day: { utilization: 5, resets_at: null } };
  assert.deepEqual(
    [evaluateClaudeUsage({ rate_limits: { ...base, extra_usage: { is_enabled: false } } }).code, evaluateClaudeUsage({ rate_limits: base }).billingCheck],
    ["READY", "ok"],
  );
  const risky = evaluateClaudeUsage({ rate_limits: { ...base, extra_usage: { is_enabled: true } } });
  assert.equal(risky.code, "BILLING_RISK");
  assert.equal(risky.billingCheck, "blocked");
  assert.equal(evaluateClaudeUsage({ rate_limits: { five_hour: { utilization: 100, resets_at: null } } }).code, "USAGE_LIMIT");
});

test("Claude 사용량 API가 응답하지 않으면 판단을 보류한다 (unknown)", () => {
  const verdict = evaluateClaudeUsage(null);
  assert.equal(verdict.code, "READY");
  assert.equal(verdict.billingCheck, "unknown");
});

test("Claude 실행 중 이벤트: 초과 사용 전환이나 한도 도달이면 중단", () => {
  // PoC에서 실제로 받은 이벤트 형태
  assert.equal(evaluateClaudeRateLimitEvent({ status: "allowed", isUsingOverage: false }).code, "READY");
  assert.equal(evaluateClaudeRateLimitEvent({ status: "allowed", isUsingOverage: true }).code, "BILLING_RISK");
  assert.equal(evaluateClaudeRateLimitEvent({ status: "allowed", overageInUse: true }).code, "BILLING_RISK");
  assert.equal(evaluateClaudeRateLimitEvent({ status: "rejected", resetsAt: 1790527800 }).code, "USAGE_LIMIT");
});

// PoC에서 실제로 받은 account/rateLimits/read 응답 형태 (Plus, 크레딧 없음)
const codexSample = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1790544824 },
    secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1791113573 },
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    rateLimitReachedType: null,
  },
};

test("Codex 사용량: 크레딧 없이 한도 안이면 READY, 창 이름도 변환", () => {
  const verdict = evaluateCodexRateLimits(codexSample);
  assert.equal(verdict.code, "READY");
  assert.equal(verdict.billingCheck, "ok");
  assert.deepEqual(codexUsageWindows(codexSample).map((w) => [w.name, w.usedPercent]), [["5시간", 3], ["7일", 16]]);
});

test("Codex 사용량: 크레딧이 있거나 일반 사용 불가면 호출 전에 차단", () => {
  const withCredits = { ...codexSample, rateLimits: { ...codexSample.rateLimits, credits: { hasCredits: true, unlimited: false } } };
  assert.equal(evaluateCodexRateLimits(withCredits).code, "BILLING_RISK");
  assert.equal(evaluateCodexRateLimits({ ...codexSample, ordinaryUsageAllowed: false }).code, "BILLING_RISK");
});

test("Codex 사용량: 한도 도달이면 USAGE_LIMIT, 정보가 없으면 unknown", () => {
  const full = { ...codexSample, rateLimits: { ...codexSample.rateLimits, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1790544824 } } };
  assert.equal(evaluateCodexRateLimits(full).code, "USAGE_LIMIT");
  assert.equal(evaluateCodexRateLimits({ ...codexSample, rateLimits: { ...codexSample.rateLimits, rateLimitReachedType: "primary" } }).code, "USAGE_LIMIT");
  assert.equal(evaluateCodexRateLimits(null).billingCheck, "unknown");
});

test("Codex 로그인 파일과 계정 유형", () => {
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null })).code, "READY");
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: "sk-x" })).code, "API_KEY_BLOCKED");
  assert.equal(checkCodexAuthFile(JSON.stringify({ auth_mode: "apikey" })).code, "API_KEY_BLOCKED");
  assert.equal(checkCodexAuthFile(null).code, "AUTH_REQUIRED");
  assert.equal(evaluateCodexAccount({ type: "chatgpt" }).code, "READY");
  assert.equal(evaluateCodexAccount({ type: "apiKey" }).code, "API_KEY_BLOCKED");
  assert.equal(evaluateCodexAccount(null).code, "AUTH_REQUIRED");
});
