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

/**
 * 공통 Provider 경계. 1단계는 상태 조회만 있고,
 * 사진 분석/원고 작성용 generateStructured는 2단계에서 추가한다.
 */
export interface AiProvider {
  readonly id: ProviderId;
  status(): Promise<ProviderStatus>;
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
