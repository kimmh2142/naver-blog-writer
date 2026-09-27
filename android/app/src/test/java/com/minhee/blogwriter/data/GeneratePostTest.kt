package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.BlogGenerationRepository.GenerateOutcome
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.GeneratedBy
import com.minhee.blogwriter.data.model.GeneratedPost
import com.minhee.blogwriter.data.model.PhotoAnalysis
import com.minhee.blogwriter.data.model.PhotoAnalysisEntry
import com.minhee.blogwriter.data.model.PostBlock
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.data.model.StyleProfile
import com.minhee.blogwriter.data.remote.BridgeError
import com.minhee.blogwriter.data.remote.BridgeErrorKind
import com.minhee.blogwriter.data.remote.BridgeResult
import com.minhee.blogwriter.data.remote.GenerateRequest
import com.minhee.blogwriter.data.remote.GenerateResponse
import com.minhee.blogwriter.data.remote.GenerateValidation
import com.minhee.blogwriter.data.remote.GeneratedDraft
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeneratePostTest {

    private fun entry(desc: String, model: String) = PhotoAnalysisEntry(
        analysis = PhotoAnalysis(type = "food", description = desc), model = model, version = PhotoAnalysis.CURRENT_VERSION, analyzedAt = 1,
    )

    /** 선택 순서와 포스팅 순서가 다른 사진 3장. Claude 분석은 모두 있고, GPT 분석은 1장만 있다. */
    private val draft = PostDraft(
        id = "d", createdAt = 0, updatedAt = 0, subjectName = "군산", memo = "엄마랑 감",
        photos = listOf(
            PostPhoto("x", "u1", 0, postOrder = 2, analyses = mapOf("claude" to entry("x-claude", "sonnet-a"), "codex" to entry("x-gpt", "gpt"))),
            PostPhoto("y", "u2", 1, postOrder = 0, analyses = mapOf("claude" to entry("y-claude", "sonnet-a"))),
            PostPhoto("z", "u3", 2, postOrder = 1, analyses = mapOf("claude" to entry("z-claude", "sonnet-b"))),
        ),
    )

    private val response = GenerateResponse(
        provider = "claude",
        model = "claude-opus-5-5",
        post = GeneratedDraft(
            titleCandidates = listOf("t1", "t2", "t3"),
            blocks = listOf(PostBlock("imageGroup", photoIds = listOf("y", "z", "x")), PostBlock("paragraph", "본문 [확인 필요: 가게 이름]")),
            hashtags = listOf("#군산"),
            confirmNeeded = listOf("가게 이름"),
        ),
        validation = GenerateValidation(repaired = true),
    )

    private fun repo(onGenerate: (GenerateRequest) -> BridgeResult<GenerateResponse>) = BlogGenerationRepository(
        config = GenerationConfig.of(5, 2, 1280, 80),
        prepareImage = { error("원고 생성에서는 사진 사본을 만들지 않음") },
        analyze = { _, _, _, _ -> error("원고 생성에서는 사진 분석을 부르지 않음") },
        generate = onGenerate,
        clock = { 99 },
    )

    @Test
    fun sendsOnlyThisProvidersAnalysesInPostOrderWithoutPhotos() = runTest {
        var sent: GenerateRequest? = null
        val outcome = repo { sent = it; BridgeResult.Ok(response) }
            .generatePost(draft, AiProviderId.CLAUDE, StyleProfile(endings = "~했어요", samplesText = "샘플 원문은 보내지 않음"))

        val request = sent!!
        assertEquals("claude", request.provider)
        assertEquals(listOf("y", "z", "x"), request.photos.map { it.photoId })
        assertEquals(listOf("y-claude", "z-claude", "x-claude"), request.photos.map { it.analysis.description })
        assertEquals(mapOf("endings" to "~했어요"), request.style) // 빈 항목과 샘플 원문은 보내지 않음

        val post = (outcome as GenerateOutcome.Success).post
        assertEquals(GeneratedBy("claude", "claude-opus-5-5", 99, listOf("sonnet-a", "sonnet-b"), repaired = true), post.generatedBy)
        assertEquals(listOf("가게 이름"), post.confirmNeeded)
    }

    @Test
    fun missingAnalysisForSelectedProviderDoesNotCallBridge() = runTest {
        var called = false
        val outcome = repo { called = true; BridgeResult.Ok(response) }.generatePost(draft, AiProviderId.CODEX, StyleProfile())
        assertEquals(GenerateOutcome.NeedsAnalysis(AiProviderId.CODEX, missing = 2), outcome)
        assertEquals(false, called)
    }

    @Test
    fun bridgeErrorIsReturnedAsIs() = runTest {
        val error = BridgeError(BridgeErrorKind.SERVER, "한도 도달", "USAGE_LIMIT")
        val outcome = repo { BridgeResult.Err(error) }.generatePost(draft, AiProviderId.CLAUDE, StyleProfile())
        assertEquals(GenerateOutcome.Failed(error), outcome)
    }

    @Test
    fun fullTextIsPlainBodyWithHashtagsAndNoPhotoMarkers() {
        val post = GeneratedPost(
            titleCandidates = listOf("t1", "t2", "t3"),
            blocks = listOf(
                PostBlock("paragraph", " 도입 "),
                PostBlock("imageGroup", photoIds = listOf("y")),
                PostBlock("heading", "초원사진관"),
                PostBlock("paragraph", "간판이 보여요."),
            ),
            hashtags = listOf("#군산", "#여행"),
            generatedBy = GeneratedBy("claude", "m", 1),
        )
        assertEquals("도입\n\n초원사진관\n\n간판이 보여요.\n\n#군산 #여행", post.fullText())
        assertEquals(listOf("y"), post.photoIds)
    }

    @Test
    fun resultSurvivesSaveAndOldDraftsWithoutResultStillLoad() {
        val saved = draft.copy(result = GeneratedPost(listOf("a", "b", "c"), listOf(PostBlock("paragraph", "p")), generatedBy = GeneratedBy("codex", "gpt-6-astra", 5)))
        val decoded = AppJson.decodeFromString<PostDraft>(AppJson.encodeToString(PostDraft.serializer(), saved))
        assertEquals(saved, decoded)
        assertEquals("GPT", decoded.result!!.generatedBy.providerLabel)
        assertTrue(AppJson.decodeFromString<PostDraft>("""{"id":"o","createdAt":1,"updatedAt":1}""").result == null)
    }
}
