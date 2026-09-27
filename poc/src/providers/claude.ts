import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AuthViolation,
  assertClaudeConfigClean,
  assertClaudeSubscriptionAuth,
  claudeEnv,
  describeClaudeLogin,
} from "../auth-guard.js";
import type { PocConfig } from "../config.js";
import type { PocInputs } from "../inputs.js";
import { paths } from "../paths.js";
import { emptyRecord, type RunRecord } from "./types.js";

/** 두 Provider 모두 도구 없이, 사용자 설정을 읽지 않고, 빈 폴더에서 실행한다. */
function baseOptions(env: Record<string, string>): Options {
  mkdirSync(paths.claudeWorkDir, { recursive: true });
  return {
    env,
    cwd: paths.claudeWorkDir,
    settingSources: [],
    tools: [],
    permissionMode: "dontAsk",
    persistSession: false,
  };
}

export type ClaudePreflight = {
  apiKeySource: string | null;
  /** 모델 호출 없이 로컬 명령으로 처리됐는가 */
  localCommand: boolean;
};

/**
 * 본 실행과 같은 환경으로 로컬 명령(`/usage`)만 실행해 init 메시지의 apiKeySource를 확인한다.
 * 모델 호출이 없으므로 과금이 없다. API 키가 감지되면 여기서 AuthViolation으로 중단된다.
 * (SDK의 /usage는 세션 비용 통계만 돌려주고 구독 사용량은 알려주지 않아서, 사용량 측정에는 쓰지 않는다.)
 */
export async function claudePreflight(env: Record<string, string>): Promise<ClaudePreflight> {
  const abortController = new AbortController();
  const preflight: ClaudePreflight = { apiKeySource: null, localCommand: false };
  const q = query({ prompt: "/usage", options: { ...baseOptions(env), abortController, maxTurns: 1 } });
  for await (const message of q) {
    if (message.type === "system" && message.subtype === "init") {
      preflight.apiKeySource = message.apiKeySource;
      try {
        assertClaudeSubscriptionAuth(message.apiKeySource);
      } catch (e) {
        abortController.abort();
        throw e;
      }
    } else if (message.type === "result" && message.subtype === "success") {
      preflight.localCommand = Boolean(message.local_command);
    }
  }
  return preflight;
}

export async function runClaude(inputs: PocInputs, config: PocConfig, runIndex: number): Promise<RunRecord> {
  const record = emptyRecord("claude", runIndex);
  const { env, removed } = claudeEnv();
  record.removedEnvKeys = removed;
  record.retries.sdkApiRetries = 0;
  const started = Date.now();

  try {
    assertClaudeConfigClean();
    record.auth.login = describeClaudeLogin();
    // 사전 점검: 같은 환경으로 모델 호출 없는 명령을 먼저 실행해 API 키 사용 여부를 확인한다. API 키면 여기서 중단된다.
    record.auth.preflight = await claudePreflight(env);

    const images = await Promise.all(inputs.photos.map((p) => readFile(p.file, "base64")));
    const content = [
      { type: "text" as const, text: inputs.prompt },
      ...images.map((data) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
      })),
    ];
    async function* messages(): AsyncGenerator<SDKUserMessage> {
      yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
    }

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), config.timeoutMs);
    try {
      const q = query({
        prompt: messages(),
        options: {
          ...baseOptions(env),
          abortController,
          maxTurns: config.claude.maxTurns,
          model: config.claude.model ?? undefined,
          effort: config.claude.effort ?? undefined,
          outputFormat: { type: "json_schema", schema: inputs.schema },
        },
      });
      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") {
          record.model = message.model;
          record.auth.apiKeySource = message.apiKeySource;
          try {
            assertClaudeSubscriptionAuth(message.apiKeySource);
          } catch (e) {
            abortController.abort();
            throw e;
          }
        } else if (message.type === "system" && message.subtype === "api_retry") {
          record.retries.sdkApiRetries = (record.retries.sdkApiRetries ?? 0) + 1;
          record.retries.notes.push(`api_retry #${message.attempt}: ${message.error} (status ${message.error_status ?? "-"})`);
        } else if (message.type === "rate_limit_event") {
          // 구독 사용량 정보. claude.ai 구독 인증일 때 오는 이벤트라 구독 사용의 근거로도 본다.
          record.subscription.duringRun.push(message.rate_limit_info);
        } else if (message.type === "result") {
          record.usage = {
            numTurns: message.num_turns,
            usage: message.usage,
            // 구독 인증에서는 실제 청구액이 아니라 Claude Code가 계산한 추정치다.
            estimatedCostUsdNotBilled: message.total_cost_usd,
            durationApiMs: message.duration_api_ms,
          };
          if (message.num_turns > 1) record.retries.notes.push(`num_turns=${message.num_turns} (구조화 출력 재시도 가능성)`);
          if (message.subtype === "success") {
            record.rawOutput = message.structured_output ?? message.result;
            record.success = message.structured_output !== undefined && message.structured_output !== null;
            if (!record.success) record.error = "structured_output이 비어 있음";
          } else {
            record.error = `${message.subtype}: ${message.errors.join(" | ")}`;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      if (abortController.signal.aborted && !record.error) record.error = `시간 초과(${config.timeoutMs}ms) 또는 중단`;
    }
  } catch (e) {
    record.authAborted = e instanceof AuthViolation;
    record.error = (e as Error).message;
  }
  record.durationMs = Date.now() - started;
  record.subscription.before = "Claude는 실행 전후 구독 사용량을 SDK로 읽을 수 없음 (claude.ai 설정 > 사용량에서 직접 확인)";
  return record;
}
