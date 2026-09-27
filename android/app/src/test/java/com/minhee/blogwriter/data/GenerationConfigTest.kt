package com.minhee.blogwriter.data

import org.junit.Assert.assertEquals
import org.junit.Test

class GenerationConfigTest {

    private fun config(batchSize: Int) = GenerationConfig.of(
        analysisBatchSize = batchSize,
        analysisConcurrency = 3,
        aiImageLongEdgePx = 1280,
        aiImageJpegQuality = 80,
    )

    @Test
    fun batchesFollowConfiguredSize() {
        val photos = (1..23).toList()

        assertEquals(List(23) { 1 }, config(1).batches(photos).map { it.size })
        assertEquals(listOf(5, 5, 5, 5, 3), config(5).batches(photos).map { it.size })
        assertEquals(listOf(8, 8, 7), config(8).batches(photos).map { it.size })
    }

    @Test
    fun batchesKeepPhotoOrder() {
        val photos = (1..12).toList()
        assertEquals(photos, config(5).batches(photos).flatten())
    }

    @Test
    fun emptyInputHasNoBatches() {
        assertEquals(emptyList<List<Int>>(), config(5).batches(emptyList<Int>()))
    }

    @Test
    fun outOfRangeValuesAreClamped() {
        val c = GenerationConfig.of(
            analysisBatchSize = 0,
            analysisConcurrency = 99,
            aiImageLongEdgePx = 10,
            aiImageJpegQuality = 100,
        )
        assertEquals(1, c.analysisBatchSize)
        assertEquals(5, c.analysisConcurrency)
        assertEquals(512, c.aiImageLongEdgePx)
        assertEquals(95, c.aiImageJpegQuality)
        assertEquals(GenerationConfig.MAX_BATCH_SIZE, config(50).analysisBatchSize)
    }

    @Test
    fun buildConfigDefaults() {
        val c = GenerationConfig.fromBuildConfig()
        assertEquals(5, c.analysisBatchSize)
        assertEquals(2, c.analysisConcurrency)
        assertEquals(1280, c.aiImageLongEdgePx)
        assertEquals(80, c.aiImageJpegQuality)
    }
}
