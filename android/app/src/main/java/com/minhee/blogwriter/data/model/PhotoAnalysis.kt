package com.minhee.blogwriter.data.model

import kotlinx.serialization.Serializable

/** 브리지가 두 Provider 공통 형태로 정리해 돌려주는 사진 분석 결과. */
@Serializable
data class PhotoAnalysis(
    val type: String,
    /** 사진에 보이는 것만 적은 관찰 문장 */
    val description: String,
    /** 사진 속 글자(간판, 메뉴판 등). 없으면 "" */
    val visibleText: String = "",
    val tags: List<String> = emptyList(),
    /** 확실하지 않은 해석 */
    val uncertain: List<String> = emptyList(),
) {
    companion object {
        /** 브리지의 ANALYSIS_VERSION과 같아야 한다. 다르면 브리지가 요청을 거절한다. */
        const val CURRENT_VERSION = "v1"
    }
}

/** 사진 1장 × Provider 1개의 분석 캐시 항목. 실패하면 analysis=null, error에 이유. */
@Serializable
data class PhotoAnalysisEntry(
    val analysis: PhotoAnalysis? = null,
    val error: String? = null,
    /** 실제로 쓰인 모델 (기록용, 캐시 판단에는 쓰지 않음) */
    val model: String? = null,
    val version: String,
    val analyzedAt: Long,
)
