package com.minhee.blogwriter.data

import com.minhee.blogwriter.BuildConfig

/**
 * AI 생성 튜닝값. 이 숫자들은 여기서만 정의하고, 다른 코드는 이 객체만 참조한다.
 * 값은 local.properties의 blogwriter.* 항목 → BuildConfig로 들어온다.
 */
data class GenerationConfig(
    val analysisBatchSize: Int,
    val analysisConcurrency: Int,
    val aiImageLongEdgePx: Int,
    val aiImageJpegQuality: Int,
) {
    /** Vision 분석 요청 단위로 나눈다. */
    fun <T> batches(items: List<T>): List<List<T>> = items.chunked(analysisBatchSize)

    companion object {
        /** Backend MAX_IMAGES_PER_REQUEST 기본값과 맞춘다. */
        const val MAX_BATCH_SIZE = 10

        /** 잘못된 값이 들어와도 동작 가능한 범위로 보정한다. */
        fun of(
            analysisBatchSize: Int,
            analysisConcurrency: Int,
            aiImageLongEdgePx: Int,
            aiImageJpegQuality: Int,
        ) = GenerationConfig(
            analysisBatchSize = analysisBatchSize.coerceIn(1, MAX_BATCH_SIZE),
            analysisConcurrency = analysisConcurrency.coerceIn(1, 5),
            aiImageLongEdgePx = aiImageLongEdgePx.coerceIn(512, 2048),
            aiImageJpegQuality = aiImageJpegQuality.coerceIn(50, 95),
        )

        fun fromBuildConfig() = of(
            analysisBatchSize = BuildConfig.ANALYSIS_BATCH_SIZE,
            analysisConcurrency = BuildConfig.ANALYSIS_CONCURRENCY,
            aiImageLongEdgePx = BuildConfig.AI_IMAGE_LONG_EDGE_PX,
            aiImageJpegQuality = BuildConfig.AI_IMAGE_JPEG_QUALITY,
        )
    }
}
