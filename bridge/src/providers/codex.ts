import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCodexAccount, readCodexDefaultModel } from "../codex-app-server.js";
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
import { runCodexExec } from "./codex-exec.js";
import {
  type AiProvider,
  ProviderCallError,
  providerStatus,
  type ProviderStatus,
  type StructuredRequest,
  type StructuredResult,
} from "./types.js";

export class CodexProvider implements AiProvider {
  readonly id = "codex" as const;
  private defaultModel: string | null | undefined;

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

  /**
   * 요청마다 .work/codex-<id>/ 에 JPEG와 스키마를 두고 `codex exec --ephemeral`로 호출한다.
   * 호출이 끝나면(성공·실패·시간 초과 모두) 그 폴더를 지우고, 혹시 남은 세션 기록도 지운다.
   * 호출 전 과금 검사는 서버가 status()로 먼저 한다.
   */
  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    writeCodexConfig(this.dirs.codexHome);
    const authCheck = checkCodexAuthFile(readCodexAuthFile(this.dirs.codexHome));
    if (authCheck.code !== "READY") throw new ProviderCallError(authCheck.code as "AUTH_REQUIRED" | "API_KEY_BLOCKED", authCheck.message);

    const { env } = codexEnv(this.dirs.codexHome);
    const configured = request.purpose === "analysis" ? this.models.analysis : this.models.writing;
    const requestDir = path.join(this.dirs.workDir, `codex-${randomUUID()}`);
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), request.timeoutMs);
    try {
      mkdirSync(requestDir, { recursive: true });
      const imagePaths = request.images.map((bytes, i) => {
        const file = path.join(requestDir, `${i + 1}.jpg`);
        writeFileSync(file, bytes);
        return file;
      });
      const schemaPath = path.join(requestDir, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(request.schema));

      const result = await runCodexExec({
        env,
        prompt: request.instructions,
        imagePaths,
        outputSchemaPath: schemaPath,
        workingDirectory: requestDir,
        model: configured,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) throw new ProviderCallError("TIMEOUT", `GPT 응답이 ${request.timeoutMs / 1000}초 안에 오지 않았습니다.`);
      if (result.error || result.finalText === null) {
        throw classifyCodexFailure(result.error ?? result.stderr ?? "", result.exitCode);
      }
      let output: unknown;
      try {
        output = JSON.parse(result.finalText);
      } catch {
        throw new ProviderCallError("INVALID_OUTPUT", "GPT 응답을 JSON으로 해석하지 못했습니다.");
      }
      return { output, model: configured ?? (await this.resolveDefaultModel(env)), usage: result.usage };
    } finally {
      clearTimeout(timer);
      rmSync(requestDir, { recursive: true, force: true });
      // --ephemeral로 남지 않아야 하지만, 브리지 전용 폴더이므로 세션 기록은 매번 비운다.
      rmSync(path.join(this.dirs.codexHome, "sessions"), { recursive: true, force: true });
    }
  }

  private async resolveDefaultModel(env: Record<string, string>): Promise<string | null> {
    if (this.defaultModel === undefined) this.defaultModel = await readCodexDefaultModel(env);
    return this.defaultModel;
  }
}

/** Codex 오류 문구를 앱에 전달할 오류 코드로 분류한다. 원문은 짧게만 남긴다. */
export function classifyCodexFailure(detail: string, exitCode: number | null): ProviderCallError {
  const text = detail.toLowerCase();
  const short = detail.trim().slice(0, 300) || `codex exec 종료 코드 ${exitCode ?? "?"}`;
  if (/401|unauthorized|not logged in|login|re-authenticate|refresh token/.test(text)) {
    return new ProviderCallError("AUTH_REQUIRED", `ChatGPT 로그인이 만료되었거나 없습니다. PC에서 \`npm run login:codex\`를 실행하세요. (${short})`);
  }
  if (/usage limit|rate limit|429|quota/.test(text)) {
    return new ProviderCallError("USAGE_LIMIT", `ChatGPT/Codex 사용량 한도에 도달했습니다. (${short})`);
  }
  if (/credit/.test(text)) {
    return new ProviderCallError("BILLING_RISK", `크레딧 사용이 필요한 상태라 중단했습니다. (${short})`);
  }
  return new ProviderCallError("ERROR", `GPT 호출 실패: ${short}`);
}
