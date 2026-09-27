import { readCodexAccount } from "../codex-app-server.js";
import type { ModelChoice } from "../config.js";
import {
  type CodexRateLimits,
  checkCodexAuthFile,
  codexEnv,
  codexUsageWindows,
  evaluateCodexAccount,
  evaluateCodexRateLimits,
  readCodexAuthFile,
  writeCodexConfig,
} from "../guard.js";
import type { BridgeDirs } from "../paths.js";
import { type AiProvider, providerStatus, type ProviderStatus } from "./types.js";

export class CodexProvider implements AiProvider {
  readonly id = "codex" as const;

  constructor(
    private readonly models: ModelChoice,
    private readonly dirs: BridgeDirs,
  ) {}

  /** app-server로 계정 유형과 사용량만 읽는다. 모델 호출이 없다. */
  async status(): Promise<ProviderStatus> {
    const base = { provider: this.id, models: this.models };
    try {
      writeCodexConfig(this.dirs.codexHome);
      const authCheck = checkCodexAuthFile(readCodexAuthFile(this.dirs.codexHome));
      if (authCheck.code !== "READY") return providerStatus(base, authCheck);

      const { env } = codexEnv(this.dirs.codexHome);
      const snapshot = await readCodexAccount(env);
      const accountCheck = evaluateCodexAccount(snapshot.account);
      if (accountCheck.code !== "READY") return providerStatus(base, accountCheck);

      const limits = snapshot.rateLimits as CodexRateLimits;
      const limitCheck = evaluateCodexRateLimits(limits);
      return providerStatus(base, {
        code: limitCheck.code,
        message:
          limitCheck.code === "READY" && limitCheck.billingCheck === "unknown"
            ? "사용 가능 (사용량 정보를 읽지 못했습니다)"
            : limitCheck.message,
        plan: snapshot.account?.planType ?? null,
        usage: codexUsageWindows(limits),
        billingCheck: limitCheck.billingCheck,
      });
    } catch (e) {
      return providerStatus(base, { code: "ERROR", message: (e as Error).message });
    }
  }
}
