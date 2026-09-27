package com.minhee.blogwriter.data.model

import kotlinx.serialization.Serializable

@Serializable
enum class Category(val label: String, val subjectLabel: String) {
    RESTAURANT("맛집", "매장명"),
    EVENT("공연·행사", "공연/행사명"),
    PRODUCT("제품", "제품명"),
    CLINIC("병원·피부관리", "병원/샵 이름"),
    TRAVEL("여행", "장소명"),
    OTHER("기타", "대상 이름"),
}

/**
 * 포스팅에 쓸 사진 한 장. 원본은 휴대폰에만 있고 여기에는 URI만 둔다.
 *
 * originalIndex: 사용자가 선택한 순서(변하지 않음)
 * postOrder: 포스팅에 들어갈 순서(0부터 연속)
 */
@Serializable
data class PostPhoto(
    val id: String,
    val originalUri: String,
    val originalIndex: Int,
    val postOrder: Int,
    val takenAt: Long? = null,
    val mimeType: String? = null,
    /** Provider별 사진 분석 캐시. key = AiProviderId.id ("claude", "codex"). Provider끼리 공유하지 않는다. */
    val analyses: Map<String, PhotoAnalysisEntry> = emptyMap(),
) {
    fun analysisFor(provider: AiProviderId): PhotoAnalysisEntry? = analyses[provider.id]

    /** 같은 Provider에 현재 버전으로 성공한 분석이 있으면 재사용한다. 모델 이름은 판단에 쓰지 않는다. */
    fun needsAnalysis(provider: AiProviderId): Boolean {
        val entry = analysisFor(provider) ?: return true
        return entry.analysis == null || entry.version != PhotoAnalysis.CURRENT_VERSION
    }
}

/** 작성 중인 포스팅 한 건. filesDir/drafts/{id}.json 에 통째로 저장된다. */
@Serializable
data class PostDraft(
    val id: String,
    val createdAt: Long,
    val updatedAt: Long,
    val category: Category = Category.RESTAURANT,
    val subjectName: String = "",
    val memo: String = "",
    val isCampaign: Boolean = false,
    val campaignRawText: String = "",
    val sortByTakenAt: Boolean = false,
    val photos: List<PostPhoto> = emptyList(),
    /** 이 작성 건에서 마지막으로 고른 AI (AiProviderId.id). 없으면 Claude. */
    val selectedProvider: String? = null,
) {
    val provider: AiProviderId
        get() = AiProviderId.entries.find { it.id == selectedProvider } ?: AiProviderId.CLAUDE

    val isBlank: Boolean
        get() = subjectName.isBlank() && memo.isBlank() && campaignRawText.isBlank() && photos.isEmpty()

    fun photosInPostOrder(): List<PostPhoto> = photos.sortedBy { it.postOrder }

    companion object {
        const val MAX_PHOTOS = 50
    }
}
