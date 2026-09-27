import type { ModelChoice } from "../config.js";

export type ProviderId = "claude" | "codex";

/**
 * READY: 모델 호출 가능
 * AUTH_REQUIRED: 브리지 전용 폴더에 구독 로그인이 없거나 만료됨
 * API_KEY_BLOCKED: API 키(종량제) 인증이 감지되어 차단
 * BILLING_RISK: 구독 외 과금(Claude 초과 사용, Codex 크레딧) 가능성이 있어 차단
 * USAGE_LIMIT: 구독 사용량 한도 도달
 * ERROR: 그 밖의 오류
 */
export type StatusCode = "READY" | "AUTH_REQUIRED" | "API_KEY_BLOCKED" | "BILLING_RISK" | "USAGE_LIMIT" | "ERROR";

export type UsageWindow = { name: string; usedPercent: number | null; resetsAt: string | null };

export type ProviderStatus = {
  provider: ProviderId;
  ready: boolean;
  code: StatusCode;
  message: string;
  plan: string | null;
  usage: UsageWindow[];
  /** 구독 외 과금 가능성 확인 결과. unknown = 확인 수단이 응답하지 않음 */
  billingCheck: "ok" | "blocked" | "unknown";
  models: ModelChoice;
  checkedAt: string;
};

/** 모델 호출 실패 원인. Android에 error.code로 그대로 전달된다. */
export type CallErrorCode =
  | Exclude<StatusCode, "READY">
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "REFUSED";

export class ProviderCallError extends Error {
  constructor(
    readonly code: CallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export type StructuredRequest = {
  /** 설정의 어떤 모델을 쓸지 (분석/작성) */
  purpose: "analysis" | "writing";
  instructions: string;
  /** JPEG 바이트. 첨부 순서가 곧 사진 순서다. */
  images: Buffer[];
  schema: Record<string, unknown>;
  timeoutMs: number;
};

export type StructuredResult = {
  output: unknown;
  /** 실제로 쓰인 모델 (알 수 없으면 null) */
  model: string | null;
  usage: unknown;
};

/** 공통 Provider 경계. Claude/Codex 구현이 하나씩 있다. */
export interface AiProvider {
  readonly id: ProviderId;
  /** 로그인·과금 안전·사용량 확인. 모델 호출 없음. */
  status(): Promise<ProviderStatus>;
  /** 구조화 JSON을 돌려받는 모델 호출 1회. 과금 방어에 걸리면 ProviderCallError. */
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
}

export function providerStatus(
  base: { provider: ProviderId; models: ModelChoice },
  fields: Partial<Omit<ProviderStatus, "provider" | "models" | "checkedAt" | "ready">> & { code: StatusCode; message: string },
): ProviderStatus {
  return {
    provider: base.provider,
    models: base.models,
    plan: null,
    usage: [],
    billingCheck: "unknown",
    ...fields,
    ready: fields.code === "READY",
    checkedAt: new Date().toISOString(),
  };
}
