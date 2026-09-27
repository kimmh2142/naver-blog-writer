package com.minhee.blogwriter.data.model

import kotlinx.serialization.Serializable

/** 생성에 쓸 AI. id는 브리지 API 값, label은 화면 표시용. */
enum class AiProviderId(val id: String, val label: String) {
    CLAUDE("claude", "Claude"),
    CODEX("codex", "GPT"),
}

/** 브리지 GET /v1/status 응답. */
@Serializable
data class BridgeStatus(
    val bridge: BridgeInfo,
    val providers: Map<String, ProviderStatus>,
)

@Serializable
data class BridgeInfo(val version: String, val startedAt: String)

/**
 * code: READY / AUTH_REQUIRED / API_KEY_BLOCKED / BILLING_RISK / USAGE_LIMIT / ERROR
 * billingCheck: ok / blocked / unknown (구독 외 과금 사전 확인 결과)
 */
@Serializable
data class ProviderStatus(
    val provider: String,
    val ready: Boolean,
    val code: String,
    val message: String,
    val plan: String? = null,
    val usage: List<UsageWindow> = emptyList(),
    val billingCheck: String = "unknown",
    val models: ProviderModels = ProviderModels(),
    val checkedAt: String? = null,
)

@Serializable
data class UsageWindow(val name: String, val usedPercent: Double? = null, val resetsAt: String? = null)

@Serializable
data class ProviderModels(val analysis: String? = null, val writing: String? = null)
