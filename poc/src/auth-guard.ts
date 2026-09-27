import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { paths } from "./paths.js";

/**
 * 종량제(API 키) 과금으로 이어질 수 있는 환경변수를 자식 프로세스에 넘기지 않는다.
 * Windows 환경변수는 대소문자를 구분하지 않으므로 대문자로 비교한다.
 * CLAUDE_* 는 이 PoC를 Claude Code 터미널 안에서 실행할 때 섞여 들어오는 값도 함께 제거한다.
 */
const BLOCKED_PREFIXES = ["ANTHROPIC_", "OPENAI_", "CODEX_", "CLAUDE_", "AZURE_OPENAI_"];
const BLOCKED_EXACT = ["CLAUDECODE", "AWS_BEARER_TOKEN_BEDROCK"];

export function isBlockedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return BLOCKED_EXACT.includes(upper) || BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/** 차단 목록을 뺀 환경변수에 overrides를 더한다. 제거한 변수 이름(값은 아님)도 돌려준다. */
export function buildSafeEnv(
  source: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): { env: Record<string, string>; removed: string[] } {
  const env: Record<string, string> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isBlockedEnvKey(key)) {
      removed.push(key);
      continue;
    }
    env[key] = value;
  }
  return { env: { ...env, ...overrides }, removed: removed.sort() };
}

export class AuthViolation extends Error {
  constructor(message: string) {
    super(`[인증 안전장치] ${message}`);
    this.name = "AuthViolation";
  }
}

// ---------- Claude ----------

export function claudeEnv() {
  return buildSafeEnv(process.env, { CLAUDE_CONFIG_DIR: paths.claudeConfigDir });
}

/**
 * Agent SDK init 메시지의 apiKeySource.
 * "none" = API 키 없이 로그인 등 다른 방식으로 인증(구독 로그인). 그 외는 전부 API 키이므로 중단한다.
 * (클라우드 제공자/베어러 토큰도 "none"이지만 해당 환경변수는 buildSafeEnv가 이미 제거한다.)
 */
export function assertClaudeSubscriptionAuth(apiKeySource: string | undefined): void {
  if (apiKeySource !== "none") {
    throw new AuthViolation(
      `Claude가 API 키(${apiKeySource ?? "unknown"})로 인증하려 합니다. 종량제 과금을 막기 위해 중단합니다.`,
    );
  }
}

/** 전용 CLAUDE_CONFIG_DIR의 설정에 API 키 관련 항목이 있으면 중단한다. */
export function assertClaudeConfigClean(configDir = paths.claudeConfigDir): void {
  const settingsPath = path.join(configDir, "settings.json");
  if (!existsSync(settingsPath)) return;
  const text = readFileSync(settingsPath, "utf8");
  if (/apiKeyHelper|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_/.test(text)) {
    throw new AuthViolation(`${settingsPath}에 API 키 관련 설정이 있습니다. 해당 항목을 지운 뒤 다시 실행하세요.`);
  }
}

/** 로그인 여부만 확인한다. 토큰 값은 읽어서 출력하지 않는다. */
export function describeClaudeLogin(configDir = paths.claudeConfigDir): { loggedIn: boolean; subscriptionType?: string } {
  const credPath = path.join(configDir, ".credentials.json");
  if (!existsSync(credPath)) return { loggedIn: false };
  try {
    const parsed = JSON.parse(readFileSync(credPath, "utf8"));
    const oauth = parsed?.claudeAiOauth;
    return { loggedIn: Boolean(oauth), subscriptionType: typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : undefined };
  } catch {
    return { loggedIn: false };
  }
}

// ---------- Codex ----------

export function codexEnv() {
  return buildSafeEnv(process.env, { CODEX_HOME: paths.codexHome });
}

/** 전용 CODEX_HOME에 ChatGPT 로그인만 허용하는 설정을 쓴다. */
export function writeCodexConfig(codexHome = paths.codexHome): void {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "# naver-blog-writer PoC 전용 설정 (자동 생성)",
      "# ChatGPT 로그인만 허용한다. API 키 로그인이 감지되면 Codex가 로그아웃하고 종료한다.",
      'forced_login_method = "chatgpt"',
      'cli_auth_credentials_store = "file"',
      "",
    ].join("\n"),
  );
}

export type CodexAuthFileStatus = { ok: true; mode: string } | { ok: false; reason: string };

/** auth.json 내용(문자열)을 검사한다. 토큰 값은 다루지 않는다. */
export function checkCodexAuthFile(raw: string | null): CodexAuthFileStatus {
  if (raw === null) return { ok: false, reason: "로그인 정보가 없습니다. `npm run login:codex`를 먼저 실행하세요." };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "auth.json을 읽을 수 없습니다." };
  }
  if (typeof parsed?.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0) {
    return { ok: false, reason: "auth.json에 API 키가 저장되어 있습니다." };
  }
  if (parsed?.auth_mode !== "chatgpt") {
    return { ok: false, reason: `ChatGPT 로그인이 아닙니다 (auth_mode=${parsed?.auth_mode ?? "없음"}).` };
  }
  return { ok: true, mode: parsed.auth_mode };
}

export function readCodexAuthFile(codexHome = paths.codexHome): string | null {
  const authPath = path.join(codexHome, "auth.json");
  return existsSync(authPath) ? readFileSync(authPath, "utf8") : null;
}

export function assertCodexAuthFile(codexHome = paths.codexHome): void {
  const status = checkCodexAuthFile(readCodexAuthFile(codexHome));
  if (!status.ok) throw new AuthViolation(`Codex: ${status.reason}`);
}

/** app-server account/read 결과가 ChatGPT 계정인지 확인한다. */
export function assertCodexAccount(account: { type?: string } | null | undefined): void {
  if (account?.type !== "chatgpt") {
    throw new AuthViolation(`Codex 계정 유형이 ChatGPT가 아닙니다 (type=${account?.type ?? "로그인 안 됨"}). 실행을 중단합니다.`);
  }
}
