package com.minhee.blogwriter.data.model

import kotlinx.serialization.Serializable

/** 원고 블록. imageGroup은 photoIds(포스팅 순서, 연속), heading/paragraph는 text. */
@Serializable
data class PostBlock(
    val type: String,
    val text: String = "",
    val photoIds: List<String> = emptyList(),
) {
    val isImageGroup: Boolean get() = type == "imageGroup"
}

@Serializable
data class ValidationItem(val label: String, val status: String, val detail: String = "")

/** 이 원고를 만든 AI. 분석 모델은 쓰인 사진 분석 캐시의 모델 목록. */
@Serializable
data class GeneratedBy(
    val provider: String,
    val model: String? = null,
    val generatedAt: Long,
    val analysisModels: List<String> = emptyList(),
    val repaired: Boolean = false,
) {
    val providerLabel: String get() = AiProviderId.entries.find { it.id == provider }?.label ?: provider
}

/** 작성 건에 저장되는 마지막 원고 결과 (1개). */
@Serializable
data class GeneratedPost(
    val titleCandidates: List<String>,
    val blocks: List<PostBlock>,
    val hashtags: List<String> = emptyList(),
    val confirmNeeded: List<String> = emptyList(),
    val generatedBy: GeneratedBy,
    val validation: List<ValidationItem> = emptyList(),
) {
    /** 이 원고에 쓰인 사진 ID (포스팅 순서) */
    val photoIds: List<String> get() = blocks.flatMap { it.photoIds }

    /** 네이버에 붙여넣을 전체 본문 (text/plain). 사진 자리는 넣지 않는다. */
    fun fullText(): String = buildString {
        append(blocks.filterNot { it.isImageGroup }.joinToString("\n\n") { it.text.trim() })
        if (hashtags.isNotEmpty()) append("\n\n").append(hashtags.joinToString(" "))
    }
}
