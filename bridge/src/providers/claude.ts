import { mkdirSync } from "node:fs";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelChoice } from "../config.js";
import {
  type ClaudeUsage,
  checkClaudeConfigDir,
  claudeEnv,
  claudeUsageWindows,
  evaluateClaudeAccount,
  evaluateClaudeRateLimitEvent,
  evaluateClaudeUsage,
} from "../guard.js";
import type { BridgeDirs } from "../paths.js";
import {
  type AiProvider,
  type CallErrorCode,
  ProviderCallError,
  providerStatus,
  type ProviderStatus,
  type StructuredRequest,
  type StructuredResult,
} from "./types.js";

/** 결과 메시지와 어시스턴트 오류를 앱에 전달할 결과/오류로 바꾼다. */
export function interpretClaudeResult(
  result: { subtype: string; stop_reason?: string | null; structured_output?: unknown; errors?: string[] } | null,
  assistantError: string | null,
): { output: unknown } | ProviderCallError {
  const byAssistantError: Record<string, CallErrorCode> = {
    authentication_failed: "AUTH_REQUIRED",
    oauth_org_not_allowed: "AUTH_REQUIRED",
    rate_limit: "USAGE_LIMIT",
    billing_error: "BILLING_RISK",
  };
  if (assistantError && byAssistantError[assistantError]) {
    return new ProviderCallError(byAssistantError[assistantError], `Claude 호출 실패: ${assistantError}`);
  }
  if (!result) return new ProviderCallError("ERROR", `Claude가 결과 없이 끝났습니다${assistantError ? ` (${assistantError})` : ""}.`);
  if (result.stop_reason === "refusal") return new ProviderCallError("REFUSED", "Claude가 이 요청을 거절했습니다.");
  if (result.subtype === "success") {
    if (result.structured_output === undefined || result.structured_output === null) {
      return new ProviderCallError("INVALID_OUTPUT", "Claude 응답에 구조화 결과가 없습니다.");
    }
    return { output: result.structured_output };
  }
  if (result.subtype === "error_max_structured_output_retries") {
    return new ProviderCallError("INVALID_OUTPUT", "Claude가 스키마에 맞는 결과를 만들지 못했습니다.");
  }
  return new ProviderCallError("ERROR", `Claude 호출 실패: ${result.subtype} ${(result.errors ?? []).join(" | ").slice(0, 300)}`);
}

/** Agent SDK의 실험적 사용량 API. 이름이 바뀔 수 있어 있을 때만 쓴다. */
const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";
const STATUS_TIMEOUT_MS = 60_000;

export class ClaudeProvider implements AiProvider {
  readonly id = "claude" as const;

  constructor(
    private readonly models: ModelChoice,
    private readonly dirs: BridgeDirs,
  ) {}

  /**
   * 메시지를 하나도 보내지 않은 세션을 열어 계정 정보와 사용량만 읽는다. 모델 호출이 없다.
   */
  async status(): Promise<ProviderStatus> {
    const base = { provider: this.id, models: this.models };
    const configCheck = checkClaudeConfigDir(this.dirs.claudeConfigDir);
    if (configCheck.code !== "READY") return providerStatus(base, configCheck);

    mkdirSync(this.dirs.workDir, { recursive: true });
    const { env } = claudeEnv(this.dirs.claudeConfigDir);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    // 아무 메시지도 보내지 않는 입력. release() 되면 세션이 끝난다.
    async function* noMessages(): AsyncGenerator<SDKUserMessage> {
      await hold;
    }
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), STATUS_TIMEOUT_MS);
    const q = query({
      prompt: noMessages(),
      options: {
        env,
        cwd: this.dirs.workDir,
        settingSources: [],
        tools: [],
        permissionMode: "dontAsk",
        persistSession: false,
        abortController,
      },
    });
    // 제어 응답이 막히지 않도록 메시지 스트림을 계속 읽어 둔다.
    const drain = (async () => {
      try {
        for await (const _ of q) {
          /* 무시 */
        }
      } catch {
        /* 중단 시 발생하는 오류는 무시 */
      }
    })();

    try {
      const account = await q.accountInfo();
      const accountCheck = evaluateClaudeAccount(account);
      if (accountCheck.code !== "READY") return providerStatus(base, accountCheck);

      let usage: ClaudeUsage = null;
      const usageFn = (q as unknown as Record<string, unknown>)[USAGE_METHOD];
      if (typeof usageFn === "function") {
        try {
          usage = (await usageFn.call(q, { skipBehaviors: true })) as ClaudeUsage;
        } catch {
          usage = null;
        }
      }
      const usageCheck = evaluateClaudeUsage(usage);
      return providerStatus(base, {
        code: usageCheck.code,
        message:
          usageCheck.code === "READY" && usageCheck.billingCheck === "unknown"
            ? "사용 가능 (구독 외 과금 여부를 미리 확인하지 못해, 생성 중 감지되면 즉시 중단합니다)"
            : usageCheck.message,
        plan: account.subscriptionType ?? null,
        usage: claudeUsageWindows(usage),
        billingCheck: usageCheck.billingCheck,
      });
    } catch (e) {
      const message = abortController.signal.aborted ? "Claude 상태 확인 시간이 초과되었습니다." : (e as Error).message;
      return providerStatus(base, { code: "ERROR", message });
    } finally {
      clearTimeout(timer);
      release();
      abortController.abort();
      await drain;
    }
  }

  /**
   * 사진은 메모리에서 base64로만 전달한다(디스크에 쓰지 않음). persistSession:false로 대화 기록도 남기지 않는다.
   * 실행 중 init의 apiKeySource와 rate_limit_event를 확인해, API 키 인증이나 초과 사용 전환이면 즉시 중단한다.
   */
  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const configCheck = checkClaudeConfigDir(this.dirs.claudeConfigDir);
    if (configCheck.code !== "READY") throw new ProviderCallError("API_KEY_BLOCKED", configCheck.message);

    mkdirSync(this.dirs.workDir, { recursive: true });
    const { env } = claudeEnv(this.dirs.claudeConfigDir);
    const content = [
      { type: "text" as const, text: request.instructions },
      ...request.images.map((bytes) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/jpeg" as const, data: bytes.toString("base64") },
      })),
    ];
    async function* messages(): AsyncGenerator<SDKUserMessage> {
      yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
    }

    const abortController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, request.timeoutMs);
    let stopped: ProviderCallError | null = null;
    let model: string | null = null;
    let assistantError: string | null = null;
    let result: Parameters<typeof interpretClaudeResult>[0] = null;
    let usage: unknown = null;
    const stop = (error: ProviderCallError) => {
      stopped = error;
      abortController.abort();
    };

    try {
      const q = query({
        prompt: messages(),
        options: {
          env,
          cwd: this.dirs.workDir,
          settingSources: [],
          tools: [],
          permissionMode: "dontAsk",
          persistSession: false,
          abortController,
          maxTurns: 5,
          model: (request.purpose === "analysis" ? this.models.analysis : this.models.writing) ?? undefined,
          outputFormat: { type: "json_schema", schema: request.schema },
        },
      });
      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") {
          model = message.model;
          // 구독 로그인은 status()에서 확인했다. 여기서는 API 키로 바뀌지 않았는지만 다시 본다.
          if (message.apiKeySource !== "none") {
            stop(new ProviderCallError("API_KEY_BLOCKED", `API 키(${message.apiKeySource})로 인증하려 해 중단했습니다.`));
          }
        } else if (message.type === "rate_limit_event") {
          const verdict = evaluateClaudeRateLimitEvent(message.rate_limit_info);
          if (verdict.code !== "READY") stop(new ProviderCallError(verdict.code as CallErrorCode, verdict.message));
        } else if (message.type === "assistant" && message.error) {
          assistantError = message.error;
        } else if (message.type === "result") {
          result = message;
          usage = { numTurns: message.num_turns, usage: message.usage, durationApiMs: message.duration_api_ms };
        }
        if (stopped) break;
      }
    } catch (e) {
      if (!stopped && !timedOut) throw new ProviderCallError("ERROR", `Claude 호출 실패: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (stopped) throw stopped;
    if (timedOut) throw new ProviderCallError("TIMEOUT", `Claude 응답이 ${request.timeoutMs / 1000}초 안에 오지 않았습니다.`);
    const interpreted = interpretClaudeResult(result, assistantError);
    if (interpreted instanceof ProviderCallError) throw interpreted;
    return { output: interpreted.output, model, usage };
  }
}
