import { mkdirSync } from "node:fs";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelChoice } from "../config.js";
import {
  type ClaudeUsage,
  checkClaudeConfigDir,
  claudeEnv,
  claudeUsageWindows,
  evaluateClaudeAccount,
  evaluateClaudeUsage,
} from "../guard.js";
import type { BridgeDirs } from "../paths.js";
import { type AiProvider, providerStatus, type ProviderStatus } from "./types.js";

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
}
