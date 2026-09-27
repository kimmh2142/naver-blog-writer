import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StatusCode, UsageWindow } from "./providers/types.js";

// PoC(poc/src/auth-guard.ts)에서 검증한 방어를 그대로 가져오고, 구독 외 과금 검사를 더했다.

/**
 * 종량제(API 키) 과금으로 이어질 수 있는 환경변수와 브리지 자신의 비밀값을 AI 프로세스에 넘기지 않는다.
 * Windows 환경변수는 대소문자를 구분하지 않으므로 대문자로 비교한다.
 */
const BLOCKED_PREFIXES = ["ANTHROPIC_", "OPENAI_", "CODEX_", "CLAUDE_", "AZURE_OPENAI_", "BRIDGE_"];
const BLOCKED_EXACT = ["CLAUDECODE", "AWS_BEARER_TOKEN_BEDROCK"];

export function isBlockedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return BLOCKED_EXACT.includes(upper) || BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

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

export type GuardVerdict = { code: StatusCode; message: string };
const ok: GuardVerdict = { code: "READY", message: "사용 가능" };

// ---------------- Claude ----------------

export function claudeEnv(configDir: string) {
  return buildSafeEnv(process.env, { CLAUDE_CONFIG_DIR: configDir });
}

/** 전용 설정 폴더에 API 키 관련 설정이 있으면 거부한다. */
export function checkClaudeConfigDir(configDir: string): GuardVerdict {
  const settingsPath = path.join(configDir, "settings.json");
  if (!existsSync(settingsPath)) return ok;
  const text = readFileSync(settingsPath, "utf8");
  if (/apiKeyHelper|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_/.test(text)) {
    return { code: "API_KEY_BLOCKED", message: `${settingsPath}에 API 키 관련 설정이 있습니다.` };
  }
  return ok;
}

/** Agent SDK accountInfo() 결과. 구독 로그인(1st party OAuth)만 허용한다. */
export function evaluateClaudeAccount(account: {
  subscriptionType?: string;
  apiKeySource?: string;
  apiProvider?: string;
}): GuardVerdict {
  if (account.apiKeySource && account.apiKeySource !== "none") {
    return { code: "API_KEY_BLOCKED", message: `API 키(${account.apiKeySource})로 인증하려 합니다. 종량제 과금을 막기 위해 차단했습니다.` };
  }
  if (account.apiProvider && account.apiProvider !== "firstParty") {
    return { code: "API_KEY_BLOCKED", message: `클라우드 제공자(${account.apiProvider}) 인증은 쓰지 않습니다.` };
  }
  if (!account.subscriptionType) {
    return { code: "AUTH_REQUIRED", message: "브리지 전용 폴더에 Claude 구독 로그인이 없습니다. PC에서 `npm run login:claude`를 실행하세요." };
  }
  return ok;
}

type Window = { utilization: number | null; resets_at: string | null } | null | undefined;

/** Agent SDK의 실험적 usage 응답 중 브리지가 쓰는 부분. */
export type ClaudeUsage = {
  rate_limits_available?: boolean;
  rate_limits?: {
    five_hour?: Window;
    seven_day?: Window;
    extra_usage?: { is_enabled: boolean } | null;
  } | null;
} | null;

export function claudeUsageWindows(usage: ClaudeUsage): UsageWindow[] {
  const rl = usage?.rate_limits;
  if (!rl) return [];
  const toWindow = (name: string, w: Window) => (w ? [{ name, usedPercent: w.utilization, resetsAt: w.resets_at }] : []);
  return [...toWindow("5시간", rl.five_hour), ...toWindow("7일", rl.seven_day)];
}

/**
 * 호출 전 사용량 검사.
 * - 초과 사용(extra usage)이 켜져 있으면 한도를 넘는 순간 추가 과금될 수 있으므로 차단한다.
 * - usage 응답이 없으면(실험적 API 실패) 판단을 보류한다. 실행 중 rate_limit_event 검사가 뒤를 받친다.
 */
export function evaluateClaudeUsage(usage: ClaudeUsage): GuardVerdict & { billingCheck: "ok" | "blocked" | "unknown" } {
  const rl = usage?.rate_limits;
  if (!usage || !rl) {
    return { ...ok, billingCheck: "unknown" };
  }
  if (rl.extra_usage?.is_enabled) {
    return {
      code: "BILLING_RISK",
      message: "Claude 계정에 초과 사용(Extra usage)이 켜져 있어 한도 초과 시 추가 과금될 수 있습니다. claude.ai 설정에서 끈 뒤 다시 시도하세요.",
      billingCheck: "blocked",
    };
  }
  for (const [name, w] of [["5시간", rl.five_hour], ["7일", rl.seven_day]] as const) {
    if (w?.utilization !== null && w?.utilization !== undefined && w.utilization >= 100) {
      return { code: "USAGE_LIMIT", message: `Claude ${name} 사용량 한도에 도달했습니다 (초기화: ${w.resets_at ?? "알 수 없음"}).`, billingCheck: "ok" };
    }
  }
  return { ...ok, billingCheck: "ok" };
}

/** 실행 중 rate_limit_event 검사 (2단계부터 사용). 초과 사용이 시작되면 즉시 중단해야 한다. */
export function evaluateClaudeRateLimitEvent(info: {
  status?: string;
  isUsingOverage?: boolean;
  overageInUse?: boolean;
  resetsAt?: number;
}): GuardVerdict {
  if (info.isUsingOverage || info.overageInUse) {
    return { code: "BILLING_RISK", message: "Claude가 구독 한도를 넘어 초과 사용으로 전환하려 해 중단했습니다." };
  }
  if (info.status === "rejected") {
    const reset = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : "알 수 없음";
    return { code: "USAGE_LIMIT", message: `Claude 구독 사용량 한도에 도달했습니다 (초기화: ${reset}).` };
  }
  return ok;
}

// ---------------- Codex ----------------

export function codexEnv(codexHome: string) {
  return buildSafeEnv(process.env, { CODEX_HOME: codexHome });
}

/** 전용 CODEX_HOME에 ChatGPT 로그인만 허용하는 설정을 쓴다. */
export function writeCodexConfig(codexHome: string): void {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "# naver-blog-writer 브리지 전용 설정 (자동 생성)",
      "# ChatGPT 로그인만 허용한다. API 키 로그인이 감지되면 Codex가 로그아웃하고 종료한다.",
      'forced_login_method = "chatgpt"',
      'cli_auth_credentials_store = "file"',
      "",
    ].join("\n"),
  );
}

/** auth.json 내용을 검사한다. 토큰 값은 다루지 않는다. */
export function checkCodexAuthFile(raw: string | null): GuardVerdict {
  if (raw === null) {
    return { code: "AUTH_REQUIRED", message: "브리지 전용 폴더에 ChatGPT 로그인이 없습니다. PC에서 `npm run login:codex`를 실행하세요." };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { code: "AUTH_REQUIRED", message: "Codex 로그인 정보를 읽을 수 없습니다. 다시 로그인하세요." };
  }
  if (typeof parsed?.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0) {
    return { code: "API_KEY_BLOCKED", message: "Codex 로그인 정보에 API 키가 있습니다. 종량제 과금을 막기 위해 차단했습니다." };
  }
  if (parsed?.auth_mode !== "chatgpt") {
    return { code: "API_KEY_BLOCKED", message: `ChatGPT 로그인이 아닙니다 (auth_mode=${parsed?.auth_mode ?? "없음"}).` };
  }
  return ok;
}

export function readCodexAuthFile(codexHome: string): string | null {
  const authPath = path.join(codexHome, "auth.json");
  return existsSync(authPath) ? readFileSync(authPath, "utf8") : null;
}

/** app-server account/read 결과. */
export function evaluateCodexAccount(account: { type?: string } | null | undefined): GuardVerdict {
  if (!account) {
    return { code: "AUTH_REQUIRED", message: "ChatGPT 로그인이 확인되지 않습니다. PC에서 `npm run login:codex`를 실행하세요." };
  }
  if (account.type !== "chatgpt") {
    return { code: "API_KEY_BLOCKED", message: `Codex 계정 유형이 ChatGPT가 아닙니다 (${account.type}). 차단했습니다.` };
  }
  return ok;
}

type CodexWindow = { usedPercent?: number | null; windowDurationMins?: number | null; resetsAt?: number | null } | null | undefined;

/** app-server account/rateLimits/read 결과 중 브리지가 쓰는 부분. */
export type CodexRateLimits = {
  ordinaryUsageAllowed?: boolean;
  rateLimits?: {
    primary?: CodexWindow;
    secondary?: CodexWindow;
    credits?: { hasCredits?: boolean; unlimited?: boolean } | null;
    rateLimitReachedType?: string | null;
  } | null;
} | null;

function windowName(mins: number | null | undefined): string {
  if (!mins) return "기간";
  if (mins % 1440 === 0) return `${mins / 1440}일`;
  if (mins % 60 === 0) return `${mins / 60}시간`;
  return `${mins}분`;
}

export function codexUsageWindows(result: CodexRateLimits): UsageWindow[] {
  const rl = result?.rateLimits;
  if (!rl) return [];
  return [rl.primary, rl.secondary]
    .filter((w): w is NonNullable<CodexWindow> => Boolean(w))
    .map((w) => ({
      name: windowName(w.windowDurationMins),
      usedPercent: w.usedPercent ?? null,
      resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null,
    }));
}

/**
 * 호출 전 사용량 검사.
 * - 구독 한도 안의 일반 사용이 불가능하면(ordinaryUsageAllowed=false) 크레딧이 쓰일 수 있으므로 차단한다.
 * - 크레딧 잔액이 있으면 한도 초과 시 크레딧이 차감될 수 있으므로 차단한다.
 */
export function evaluateCodexRateLimits(result: CodexRateLimits): GuardVerdict & { billingCheck: "ok" | "blocked" | "unknown" } {
  if (!result || !result.rateLimits) return { ...ok, billingCheck: "unknown" };
  const rl = result.rateLimits;
  if (result.ordinaryUsageAllowed === false) {
    return { code: "BILLING_RISK", message: "ChatGPT 구독 한도 안의 사용이 불가능한 상태입니다(크레딧 사용 가능성). 차단했습니다.", billingCheck: "blocked" };
  }
  if (rl.credits?.hasCredits || rl.credits?.unlimited) {
    return {
      code: "BILLING_RISK",
      message: "ChatGPT 크레딧이 있어 한도 초과 시 크레딧이 차감될 수 있습니다. 구독 외 과금을 막기 위해 차단했습니다.",
      billingCheck: "blocked",
    };
  }
  const full = [rl.primary, rl.secondary].find((w) => (w?.usedPercent ?? 0) >= 100);
  if (rl.rateLimitReachedType || full) {
    const reset = full?.resetsAt ? new Date(full.resetsAt * 1000).toISOString() : "알 수 없음";
    return { code: "USAGE_LIMIT", message: `ChatGPT/Codex 사용량 한도에 도달했습니다 (초기화: ${reset}).`, billingCheck: "ok" };
  }
  return { ...ok, billingCheck: "ok" };
}
