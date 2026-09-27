import type { DraftChecks } from "../checks.js";

export type ProviderName = "claude" | "codex";

/** 실행 1회의 기록. out/<실행시각>/<provider>-run<N>.json 으로 저장된다. */
export type RunRecord = {
  provider: ProviderName;
  runIndex: number;
  startedAt: string;
  durationMs: number;
  /** 결과 JSON을 받아 해석까지 됐는가 */
  success: boolean;
  error: string | null;
  /** 인증 안전장치 때문에 중단했는가 */
  authAborted: boolean;
  model: string | null;
  auth: Record<string, unknown>;
  removedEnvKeys: string[];
  retries: {
    /** PoC 코드는 자동 재시도를 하지 않는다 */
    pocRetries: 0;
    /** SDK/CLI 내부 API 재시도 횟수. 알 수 없으면 null */
    sdkApiRetries: number | null;
    notes: string[];
  };
  usage: Record<string, unknown> | null;
  subscription: {
    before: unknown;
    after: unknown;
    duringRun: unknown[];
  };
  rawOutput: unknown;
  checks: DraftChecks | null;
};

export function emptyRecord(provider: ProviderName, runIndex: number): RunRecord {
  return {
    provider,
    runIndex,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    success: false,
    error: null,
    authAborted: false,
    model: null,
    auth: {},
    removedEnvKeys: [],
    retries: { pocRetries: 0, sdkApiRetries: null, notes: [] },
    usage: null,
    subscription: { before: null, after: null, duringRun: [] },
    rawOutput: null,
    checks: null,
  };
}
