package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.PhotoAnalysis
import com.minhee.blogwriter.data.model.PhotoAnalysisEntry
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoAnalysisCacheTest {

    private val analysis = PhotoAnalysis(type = "food", description = "짬뽕", uncertain = listOf("양산인지 우산인지 불확실"))
    private fun ok(version: String = PhotoAnalysis.CURRENT_VERSION, model: String = "claude-sonnet-5") =
        PhotoAnalysisEntry(analysis = analysis, model = model, version = version, analyzedAt = 1L)
    private val failed = PhotoAnalysisEntry(error = "시간 초과", version = PhotoAnalysis.CURRENT_VERSION, analyzedAt = 1L)
    private fun photo(analyses: Map<String, PhotoAnalysisEntry> = emptyMap()) = PostPhoto("p1", "content://1", 0, 0, analyses = analyses)

    @Test
    fun analysisIsNotSharedBetweenProviders() {
        val p = photo(mapOf("claude" to ok()))
        assertFalse(p.needsAnalysis(AiProviderId.CLAUDE))
        assertTrue(p.needsAnalysis(AiProviderId.CODEX))
    }

    @Test
    fun failedOrOldVersionNeedsAnalysisButModelChangeDoesNot() {
        assertTrue(photo(mapOf("claude" to failed)).needsAnalysis(AiProviderId.CLAUDE))
        assertTrue(photo(mapOf("claude" to ok(version = "v0"))).needsAnalysis(AiProviderId.CLAUDE))
        assertFalse(photo(mapOf("claude" to ok(model = "다른-모델"))).needsAnalysis(AiProviderId.CLAUDE))
    }

    @Test
    fun phase1DraftJsonStillLoads() {
        val json = """{"id":"d","createdAt":1,"updatedAt":2,
            "photos":[{"id":"p","originalUri":"u","originalIndex":0,"postOrder":0}]}"""
        val draft = AppJson.decodeFromString<PostDraft>(json)
        assertEquals(emptyMap<String, PhotoAnalysisEntry>(), draft.photos.single().analyses)
        assertEquals(AiProviderId.CLAUDE, draft.provider)
    }

    @Test
    fun analysesAndProviderRoundTrip() {
        val draft = PostDraft(
            id = "d", createdAt = 1, updatedAt = 1, selectedProvider = "codex",
            photos = listOf(photo(mapOf("claude" to ok(), "codex" to failed))),
        )
        val decoded = AppJson.decodeFromString<PostDraft>(AppJson.encodeToString(PostDraft.serializer(), draft))
        assertEquals(draft, decoded)
        assertEquals(AiProviderId.CODEX, decoded.provider)
    }
}
