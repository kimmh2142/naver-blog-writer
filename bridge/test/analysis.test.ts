import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalysisPrompt, normalizeAnalysis } from "../src/analysis.js";
import { buildCodexExecArgs, parseCodexEvents } from "../src/providers/codex-exec.js";
import { classifyCodexFailure } from "../src/providers/codex.js";
import { interpretClaudeResult } from "../src/providers/claude.js";
import { ProviderCallError } from "../src/providers/types.js";

const ids = ["id-a", "id-b", "id-c"];
const item = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref,
  type: "food",
  description: ` 설명 ${ref} `,
  visibleText: "",
  tags: [" 짬뽕 ", ""],
  uncertain: [],
  ...extra,
});

test("정상: ref 순서와 무관하게 photoId로 매핑하고 문자열을 다듬는다", () => {
  const outcome = normalizeAnalysis({ photos: [item("3"), item("1"), item("2")] }, ids)!;
  assert.deepEqual(outcome.results.map((r) => r.photoId), ids);
  assert.equal(outcome.results[0].analysis.description, "설명 1");
  assert.deepEqual(outcome.results[0].analysis.tags, ["짬뽕"]);
  assert.deepEqual(outcome.failed, []);
});

test("빠지거나 중복되거나 설명이 빈 사진은 그 사진만 실패", () => {
  const outcome = normalizeAnalysis({ photos: [item("1"), item("2"), item("2"), item("9")] }, ids)!;
  assert.deepEqual(outcome.results.map((r) => r.photoId), ["id-a"]);
  assert.deepEqual(outcome.failed.map((f) => [f.photoId, f.reason]), [
    ["id-b", "분석 결과에 이 사진이 중복됨"],
    ["id-c", "분석 결과에 이 사진이 없음"],
  ]);
  const empty = normalizeAnalysis({ photos: [item("1", { description: "  " })] }, ["only"])!;
  assert.equal(empty.failed[0].reason, "사진 설명이 비어 있음");
});

test("알 수 없는 type은 other, 형식이 틀리면 null", () => {
  assert.equal(normalizeAnalysis({ photos: [item("1", { type: "spaceship" })] }, ["x"])!.results[0].analysis.type, "other");
  assert.equal(normalizeAnalysis({ nope: [] }, ids), null);
  assert.equal(normalizeAnalysis(null, ids), null);
});

test("분석 지시문: ref 목록, 관찰 규칙, uncertain 안내 포함", () => {
  const prompt = buildAnalysisPrompt(3, { category: "RESTAURANT", subjectName: "돈거돈락" });
  assert.match(prompt, /ref는 1, 2, 3/);
  assert.match(prompt, /평가·감정·맛/);
  assert.match(prompt, /uncertain/);
  assert.match(prompt, /돈거돈락/);
});

test("Codex exec 인자: 세션 기록을 남기지 않고(--ephemeral) 읽기 전용·ChatGPT 로그인 강제", () => {
  const args = buildCodexExecArgs({ imagePaths: ["C:/w/1.jpg", "C:/w/2.jpg"], outputSchemaPath: "C:/w/schema.json", workingDirectory: "C:/w", model: null });
  assert.ok(args.includes("--ephemeral"));
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(!args.includes("--model"));
  assert.deepEqual(args.filter((a, i) => args[i - 1] === "--image"), ["C:/w/1.jpg", "C:/w/2.jpg"]);
  assert.ok(buildCodexExecArgs({ imagePaths: [], outputSchemaPath: "s", workingDirectory: "w", model: "gpt-x" }).includes("gpt-x"));
});

test("Codex 이벤트 해석과 오류 분류", () => {
  const outcome = parseCodexEvents([
    '{"type":"thread.started","thread_id":"t"}',
    "not json",
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"photos\\":[]}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10}}',
  ]);
  assert.equal(outcome.finalText, '{"photos":[]}');
  assert.deepEqual(outcome.usage, { input_tokens: 10 });
  assert.equal(parseCodexEvents(['{"type":"turn.failed","error":{"message":"boom"}}']).error, "boom");
  assert.equal(classifyCodexFailure("401 Unauthorized", 1).code, "AUTH_REQUIRED");
  assert.equal(classifyCodexFailure("You've hit your usage limit", 1).code, "USAGE_LIMIT");
  assert.equal(classifyCodexFailure("something else", 2).code, "ERROR");
});

test("Claude 결과 해석: 성공, 거절, 스키마 실패, 어시스턴트 오류", () => {
  assert.deepEqual(interpretClaudeResult({ subtype: "success", structured_output: { photos: [] } }, null), { output: { photos: [] } });
  const code = (r: unknown) => (r as ProviderCallError).code;
  assert.equal(code(interpretClaudeResult({ subtype: "success", stop_reason: "refusal", structured_output: null }, null)), "REFUSED");
  assert.equal(code(interpretClaudeResult({ subtype: "success", structured_output: null }, null)), "INVALID_OUTPUT");
  assert.equal(code(interpretClaudeResult({ subtype: "error_max_structured_output_retries" }, null)), "INVALID_OUTPUT");
  assert.equal(code(interpretClaudeResult(null, "authentication_failed")), "AUTH_REQUIRED");
  assert.equal(code(interpretClaudeResult(null, "rate_limit")), "USAGE_LIMIT");
  assert.equal(code(interpretClaudeResult(null, "billing_error")), "BILLING_RISK");
});
