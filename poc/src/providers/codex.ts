import { mkdirSync } from "node:fs";
import { Codex, type UserInput } from "@openai/codex-sdk";
import {
  AuthViolation,
  assertCodexAccount,
  assertCodexAuthFile,
  codexEnv,
  writeCodexConfig,
} from "../auth-guard.js";
import { readCodexAccount } from "../codex-app-server.js";
import type { PocConfig } from "../config.js";
import type { PocInputs } from "../inputs.js";
import { paths } from "../paths.js";
import { emptyRecord, type RunRecord } from "./types.js";

export async function runCodex(inputs: PocInputs, config: PocConfig, runIndex: number): Promise<RunRecord> {
  const record = emptyRecord("codex", runIndex);
  const { env, removed } = codexEnv();
  record.removedEnvKeys = removed;
  record.model = config.codex.model ?? "(Codex 기본 모델)";
  record.retries.notes.push("Codex SDK는 내부 API 재시도 이벤트를 노출하지 않음 (오류 item 수만 기록)");
  const started = Date.now();

  try {
    // 안전장치 1: 전용 CODEX_HOME에 ChatGPT 로그인만 허용하는 설정
    writeCodexConfig();
    // 안전장치 2: 저장된 로그인이 ChatGPT 방식인지 확인 (API 키면 중단)
    assertCodexAuthFile();
    // 안전장치 3: app-server로 실제 계정 유형 확인 + 실행 전 사용량 기록
    const before = await readCodexAccount(env);
    assertCodexAccount(before.account);
    record.auth.account = before.account;
    record.subscription.before = before.rateLimits;

    mkdirSync(paths.codexWorkDir, { recursive: true });
    const codex = new Codex({ env, config: { forced_login_method: "chatgpt" } });
    const thread = codex.startThread({
      workingDirectory: paths.codexWorkDir,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      model: config.codex.model ?? undefined,
      modelReasoningEffort: config.codex.reasoningEffort ?? undefined,
    });

    const input: UserInput[] = [
      { type: "text", text: inputs.prompt },
      ...inputs.photos.map((p) => ({ type: "local_image" as const, path: p.file })),
    ];

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), config.timeoutMs);
    let finalText: string | null = null;
    let errorItems = 0;
    let commandItems = 0;
    try {
      const { events } = await thread.runStreamed(input, { outputSchema: inputs.schema, signal: abortController.signal });
      for await (const event of events) {
        if (event.type === "item.completed") {
          if (event.item.type === "agent_message") finalText = event.item.text;
          else if (event.item.type === "error") {
            errorItems++;
            record.retries.notes.push(`error item: ${event.item.message}`);
          } else if (event.item.type === "command_execution") commandItems++;
        } else if (event.type === "turn.completed") {
          record.usage = { usage: event.usage };
        } else if (event.type === "turn.failed") {
          record.error = `turn.failed: ${event.error.message}`;
        } else if (event.type === "error") {
          record.error = `error: ${event.message}`;
        }
      }
    } finally {
      clearTimeout(timer);
      if (abortController.signal.aborted && !record.error) record.error = `시간 초과(${config.timeoutMs}ms) 또는 중단`;
    }
    if (commandItems > 0) record.retries.notes.push(`에이전트가 명령을 ${commandItems}회 실행함 (지시는 '실행하지 말 것')`);
    if (errorItems > 0) record.retries.notes.push(`오류 item ${errorItems}개`);

    record.rawOutput = finalText;
    record.success = finalText !== null && !record.error;
    if (finalText === null && !record.error) record.error = "최종 응답이 없음";
  } catch (e) {
    record.authAborted = e instanceof AuthViolation;
    record.error = (e as Error).message;
  }
  record.durationMs = Date.now() - started;

  if (!record.authAborted) {
    try {
      const after = await readCodexAccount(env);
      assertCodexAccount(after.account);
      record.subscription.after = after.rateLimits;
    } catch (e) {
      record.subscription.after = { error: (e as Error).message };
      if (e instanceof AuthViolation) record.authAborted = true;
    }
  }
  return record;
}
