import { existsSync } from "node:fs";
import { files } from "./paths.js";

/** 브리지는 항상 이 주소에만 열린다. 설정으로 바꿀 수 없다(외부 노출 방지). */
export const HOST = "127.0.0.1";

export type ModelChoice = { analysis: string | null; writing: string | null };

export type BridgeConfig = {
  port: number;
  appToken: string;
  models: { claude: ModelChoice; codex: ModelChoice };
};

export class ConfigError extends Error {}

const MIN_TOKEN_LENGTH = 32;

/** .env가 있으면 process.env로 읽는다. 이미 설정된 환경변수는 덮어쓰지 않는다. */
export function loadEnvFile(): void {
  if (existsSync(files.env)) process.loadEnvFile(files.env);
}

const modelOrNull = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export function readConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  const appToken = env.BRIDGE_APP_TOKEN?.trim() ?? "";
  if (appToken.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError("BRIDGE_APP_TOKEN이 없거나 너무 짧습니다. `npm run setup-token`을 먼저 실행하세요.");
  }
  const port = env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : 8787;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError(`BRIDGE_PORT 값이 올바르지 않습니다: ${env.BRIDGE_PORT}`);
  }
  return {
    port,
    appToken,
    models: {
      claude: {
        analysis: modelOrNull(env.CLAUDE_ANALYSIS_MODEL ?? "sonnet"),
        writing: modelOrNull(env.CLAUDE_WRITING_MODEL ?? "opus"),
      },
      codex: {
        analysis: modelOrNull(env.CODEX_ANALYSIS_MODEL),
        writing: modelOrNull(env.CODEX_WRITING_MODEL),
      },
    },
  };
}
