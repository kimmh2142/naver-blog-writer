package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.PhotoAnalysis
import com.minhee.blogwriter.data.model.PhotoAnalysisEntry
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.data.remote.AnalyzeResponse
import com.minhee.blogwriter.data.remote.AnalyzedPhoto
import com.minhee.blogwriter.data.remote.BridgeError
import com.minhee.blogwriter.data.remote.BridgeErrorKind
import com.minhee.blogwriter.data.remote.BridgeResult
import com.minhee.blogwriter.data.remote.FailedPhoto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class BlogGenerationRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val analysis = PhotoAnalysis(type = "food", description = "설명")
    private val done = PhotoAnalysisEntry(analysis = analysis, model = "m", version = PhotoAnalysis.CURRENT_VERSION, analyzedAt = 1)

    /** postOrder가 선택 순서와 다른 사진 7장. p3은 Claude 분석이 이미 있다. */
    private fun draft(): PostDraft {
        val photos = (1..7).map { i ->
            PostPhoto("p$i", "content://$i", originalIndex = i, postOrder = 7 - i,
                analyses = if (i == 3) mapOf("claude" to done) else emptyMap())
        }
        return PostDraft(id = "d", createdAt = 0, updatedAt = 0, photos = photos)
    }

    private class Recorder {
        val sentBatches = mutableListOf<List<String>>()
        val preparedFiles = mutableListOf<File>()
        val results = mutableListOf<AnalysisBatchResult>()
    }

    private fun repo(
        rec: Recorder,
        batchSize: Int = 3,
        failPrepare: Set<String> = emptySet(),
        respond: (List<String>) -> BridgeResult<AnalyzeResponse> = { ids -> okResponse(ids) },
    ) = BlogGenerationRepository(
        config = GenerationConfig.of(batchSize, 1, 1280, 80),
        prepareImage = { photo ->
            if (photo.id in failPrepare) error("디코딩 실패")
            tmp.newFile("${photo.id}.jpg").also { rec.preparedFiles += it }
        },
        analyze = { _, _, _, photos ->
            val ids = photos.map { it.first }
            rec.sentBatches += ids
            respond(ids)
        },
        generate = { error("이 테스트에서는 원고 생성을 부르지 않음") },
        clock = { 42 },
    )

    private fun okResponse(ids: List<String>) = BridgeResult.Ok(
        AnalyzeResponse(provider = "claude", model = "claude-sonnet-5", analysisVersion = "v1", results = ids.map { AnalyzedPhoto(it, analysis) }),
    )

    @Test
    fun sendsOnlyPhotosNeedingAnalysisInPostOrderByBatch() = runTest {
        val rec = Recorder()
        val summary = repo(rec).analyzePhotos(draft(), AiProviderId.CLAUDE) { rec.results += it }

        // postOrder: p7,p6,p5,p4,(p3 캐시),p2,p1 → 배치 3장씩
        assertEquals(listOf(listOf("p7", "p6", "p5"), listOf("p4", "p2", "p1")), rec.sentBatches)
        assertEquals(6, summary.succeeded)
        val entry = rec.results.flatMap { it.entries.entries }.first { it.key == "p7" }.value
        assertEquals("claude-sonnet-5", entry.model)
        assertEquals("v1", entry.version)
        assertEquals(42L, entry.analyzedAt)
        // AI용 사본은 보낸 뒤 모두 지운다
        assertFalse(rec.preparedFiles.any { it.exists() })
    }

    @Test
    fun otherProviderAnalysesEverythingSeparately() = runTest {
        val rec = Recorder()
        repo(rec, batchSize = 10).analyzePhotos(draft(), AiProviderId.CODEX) {}
        assertEquals(7, rec.sentBatches.single().size)
    }

    @Test
    fun partialFailuresAreRecordedPerPhoto() = runTest {
        val rec = Recorder()
        val summary = repo(rec, batchSize = 10, failPrepare = setOf("p5")) { ids ->
            BridgeResult.Ok(
                AnalyzeResponse(
                    provider = "claude", model = "m", analysisVersion = "v1",
                    results = ids.filter { it != "p2" && it != "p1" }.map { AnalyzedPhoto(it, analysis) },
                    failed = listOf(FailedPhoto("p2", "분석 결과에 이 사진이 없음")),
                ),
            )
        }.analyzePhotos(draft(), AiProviderId.CLAUDE) { rec.results += it }

        val entries = rec.results.single().entries
        assertEquals(listOf("p7", "p6", "p4", "p2", "p1"), rec.sentBatches.single()) // p5는 사본 생성 실패로 보내지 않음
        assert(entries.getValue("p5").error!!.contains("AI용 사진"))
        assertEquals("분석 결과에 이 사진이 없음", entries.getValue("p2").error)
        assertEquals("응답에 이 사진이 없어요", entries.getValue("p1").error) // 응답에 아예 없는 사진
        assertEquals(3, summary.succeeded)
        assertEquals(3, summary.failed)
    }

    @Test
    fun blockingErrorStopsRemainingBatches() = runTest {
        val rec = Recorder()
        val blocked = BridgeError(BridgeErrorKind.SERVER, "초과 사용 켜짐", code = "BILLING_RISK")
        val summary = repo(rec) { BridgeResult.Err(blocked) }.analyzePhotos(draft(), AiProviderId.CLAUDE) { rec.results += it }

        assertEquals(1, rec.sentBatches.size) // 두 번째 배치는 보내지 않음
        assertEquals("BILLING_RISK", summary.stopError?.code)
        assertEquals(3, rec.results.single().entries.size)
        assertNull(rec.results.single().entries.values.first().analysis)
    }

    @Test
    fun transientErrorContinuesOtherBatches() = runTest {
        val rec = Recorder()
        var call = 0
        val summary = repo(rec) { ids ->
            if (call++ == 0) BridgeResult.Err(BridgeError(BridgeErrorKind.SERVER, "시간 초과", code = "TIMEOUT")) else okResponse(ids)
        }.analyzePhotos(draft(), AiProviderId.CLAUDE) { rec.results += it }

        assertEquals(2, rec.sentBatches.size)
        assertNull(summary.stopError)
        assertEquals(3, summary.succeeded)
        assertEquals(3, summary.failed)
    }

    @Test
    fun whichErrorsStopEverything() {
        assert(BlogGenerationRepository.stopsEverything(BridgeError(BridgeErrorKind.PC_UNREACHABLE, "")))
        assert(BlogGenerationRepository.stopsEverything(BridgeError(BridgeErrorKind.SERVER, "", "USAGE_LIMIT")))
        assertFalse(BlogGenerationRepository.stopsEverything(BridgeError(BridgeErrorKind.SERVER, "", "INVALID_OUTPUT")))
    }
}
