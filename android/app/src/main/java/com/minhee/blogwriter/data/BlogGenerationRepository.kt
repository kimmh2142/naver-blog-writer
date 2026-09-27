package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.PhotoAnalysis
import com.minhee.blogwriter.data.model.PhotoAnalysisEntry
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.data.remote.AnalyzeResponse
import com.minhee.blogwriter.data.remote.BridgeError
import com.minhee.blogwriter.data.remote.BridgeErrorKind
import com.minhee.blogwriter.data.remote.BridgeResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import java.io.File

/** 배치 1개가 끝났을 때 저장할 캐시 항목들 (photoId → 항목). */
data class AnalysisBatchResult(
    val entries: Map<String, PhotoAnalysisEntry>,
    val error: BridgeError?,
)

data class AnalysisSummary(
    val requested: Int,
    val succeeded: Int,
    val failed: Int,
    /** 전체를 멈추게 한 오류(로그인, 과금 방어, PC 연결 등). 있으면 남은 배치는 보내지 않았다. */
    val stopError: BridgeError?,
    /** 마지막으로 난 오류 (배치 단위) */
    val lastError: BridgeError?,
)

/**
 * AI 생성 작업의 순서를 조율한다. 2단계는 사진 분석만 있다.
 * 작성 건 파일은 직접 쓰지 않고, 배치 결과를 onBatch로 넘겨 화면(ViewModel)이 합쳐 저장하게 한다.
 */
class BlogGenerationRepository(
    private val config: GenerationConfig,
    private val prepareImage: suspend (PostPhoto) -> File,
    private val analyze: suspend (AiProviderId, String, String, List<Pair<String, File>>) -> BridgeResult<AnalyzeResponse>,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** 이 Provider로 분석이 필요한 사진 (포스팅 순서). */
    fun photosToAnalyze(draft: PostDraft, provider: AiProviderId): List<PostPhoto> =
        draft.photosInPostOrder().filter { it.needsAnalysis(provider) }

    suspend fun analyzePhotos(
        draft: PostDraft,
        provider: AiProviderId,
        onBatch: suspend (AnalysisBatchResult) -> Unit,
    ): AnalysisSummary {
        val targets = photosToAnalyze(draft, provider)
        if (targets.isEmpty()) return AnalysisSummary(0, 0, 0, null, null)

        val permits = Semaphore(config.analysisConcurrency)
        val lock = Mutex()
        var succeeded = 0
        var failed = 0
        var stopError: BridgeError? = null
        var lastError: BridgeError? = null

        coroutineScope {
            config.batches(targets).map { batch ->
                async {
                    permits.withPermit {
                        if (lock.withLock { stopError != null }) return@withPermit // 남은 배치는 보내지 않음 (다음에 다시 시도 가능)
                        val result = runBatch(provider, draft, batch)
                        lock.withLock {
                            succeeded += result.entries.values.count { it.analysis != null }
                            failed += result.entries.values.count { it.analysis == null }
                            result.error?.let {
                                lastError = it
                                if (stopsEverything(it)) stopError = stopError ?: it
                            }
                            onBatch(result)
                        }
                    }
                }
            }.awaitAll()
        }
        return AnalysisSummary(targets.size, succeeded, failed, stopError, lastError)
    }

    private suspend fun runBatch(provider: AiProviderId, draft: PostDraft, batch: List<PostPhoto>): AnalysisBatchResult {
        val entries = mutableMapOf<String, PhotoAnalysisEntry>()
        val prepared = mutableListOf<Pair<String, File>>()
        var error: BridgeError? = null
        try {
            for (photo in batch) {
                try {
                    prepared += photo.id to prepareImage(photo)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    entries[photo.id] = failure("AI용 사진을 만들지 못했어요: ${e.message ?: e.javaClass.simpleName}", null)
                }
            }
            if (prepared.isNotEmpty()) {
                when (val result = analyze(provider, draft.category.name, draft.subjectName, prepared)) {
                    is BridgeResult.Ok -> {
                        val response = result.value
                        response.results.forEach {
                            entries[it.photoId] = PhotoAnalysisEntry(
                                analysis = it.analysis,
                                model = response.model,
                                version = response.analysisVersion,
                                analyzedAt = clock(),
                            )
                        }
                        response.failed.forEach { entries[it.photoId] = failure(it.reason, response.model) }
                        prepared.filter { it.first !in entries }.forEach { entries[it.first] = failure("응답에 이 사진이 없어요", response.model) }
                    }
                    is BridgeResult.Err -> {
                        error = result.error
                        prepared.forEach { entries[it.first] = failure(result.error.message, null) }
                    }
                }
            }
        } finally {
            // AI용 사본은 보낸 뒤 바로 지운다 (원본은 건드리지 않음).
            prepared.forEach { it.second.delete() }
        }
        return AnalysisBatchResult(entries, error)
    }

    private fun failure(reason: String, model: String?) = PhotoAnalysisEntry(
        analysis = null,
        error = reason,
        model = model,
        version = PhotoAnalysis.CURRENT_VERSION,
        analyzedAt = clock(),
    )

    companion object {
        private val STOP_CODES = setOf("AUTH_REQUIRED", "API_KEY_BLOCKED", "BILLING_RISK", "USAGE_LIMIT", "ANALYSIS_VERSION_MISMATCH")

        /** 모든 배치가 똑같이 실패할 오류면 남은 배치를 보내지 않는다. 시간 초과·형식 오류는 배치마다 다를 수 있어 계속한다. */
        fun stopsEverything(error: BridgeError): Boolean = when (error.kind) {
            BridgeErrorKind.SERVER -> error.code in STOP_CODES
            BridgeErrorKind.BAD_RESPONSE -> false
            else -> true
        }
    }
}
