package com.minhee.blogwriter.data.model

import kotlinx.serialization.Serializable

/**
 * 나의 블로그 문체. Phase 1에서는 직접 입력만 하고,
 * Phase 2부터 samplesText를 분석해 나머지 항목을 채운다.
 */
@Serializable
data class StyleProfile(
    val endings: String = "",
    val sentenceLength: String = "",
    val paragraphLength: String = "",
    val emojiFrequency: String = "",
    val laughStyle: String = "",
    val favoritePhrases: String = "",
    val avoidPhrases: String = "",
    val reviewStructure: String = "",
    val customInstructions: String = "",
    val samplesText: String = "",
    val updatedAt: Long? = null,
)
