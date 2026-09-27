package com.minhee.blogwriter.ui.newpost

import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.minhee.blogwriter.appContainer
import com.minhee.blogwriter.data.BlogGenerationRepository
import com.minhee.blogwriter.data.DraftRepository
import com.minhee.blogwriter.data.StyleRepository
import kotlinx.coroutines.flow.first
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.GenerationConfig
import com.minhee.blogwriter.data.PhotoOrdering
import com.minhee.blogwriter.data.model.Category
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.photo.AiImagePreparer
import com.minhee.blogwriter.photo.PhotoMetadataReader
import com.minhee.blogwriter.photo.UriPermissions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.UUID

sealed interface ResizeTestState {
    data object Idle : ResizeTestState
    data class Running(val done: Int, val total: Int) : ResizeTestState
    data class Done(val summary: String, val lines: List<String>) : ResizeTestState
}

/** 사진 분석 진행 상태. 완료·실패 장수는 draft의 캐시에서 계산한다. */
data class AnalysisUiState(
    val running: Boolean = false,
    /** 이번 실행에서 보낸 장수 / 처리된 장수 */
    val total: Int = 0,
    val processed: Int = 0,
    val error: String? = null,
)

/** 원고 생성 상태. 실패해도 draft.result(이전 원고)는 그대로 둔다. */
data class GenerationUiState(
    val running: Boolean = false,
    val provider: AiProviderId? = null,
    val error: String? = null,
)

data class NewPostUiState(
    val draft: PostDraft? = null,
    val importingPhotos: Boolean = false,
    val message: String? = null,
    val resizeTest: ResizeTestState = ResizeTestState.Idle,
    val analysis: AnalysisUiState = AnalysisUiState(),
    val generation: GenerationUiState = GenerationUiState(),
    /** 원고가 만들어지면 결과 화면으로 이동할 작성 건 id (한 번 쓰고 비운다) */
    val openResultFor: String? = null,
) {
    /** 분석이나 생성이 진행 중이면 Provider 변경·사진 편집·중복 요청을 막는다. */
    val busy: Boolean get() = analysis.running || generation.running
}

class NewPostViewModel(
    savedStateHandle: SavedStateHandle,
    private val draftRepository: DraftRepository,
    private val uriPermissions: UriPermissions,
    private val metadataReader: PhotoMetadataReader,
    private val aiImagePreparer: AiImagePreparer,
    private val generationConfig: GenerationConfig,
    private val appScope: CoroutineScope,
    private val generationRepository: BlogGenerationRepository,
    private val styleRepository: StyleRepository,
) : ViewModel() {

    private val handle = savedStateHandle

    // 새 작성 건이면 id를 만들어 SavedStateHandle에 넣어 둔다. 프로세스가 죽었다 살아나도 같은 id로 복원된다.
    private val draftId: String = savedStateHandle.get<String>(ARG_DRAFT_ID)
        ?: savedStateHandle.get<String>(KEY_NEW_DRAFT_ID)
        ?: UUID.randomUUID().toString().also { savedStateHandle[KEY_NEW_DRAFT_ID] = it }

    private val _state = MutableStateFlow(NewPostUiState())
    val state: StateFlow<NewPostUiState> = _state.asStateFlow()

    /** 한 번이라도 파일로 저장됐는지. 아무것도 입력하지 않은 새 작성 건은 저장하지 않는다. */
    private var persisted = false
    private var saveJob: Job? = null

    init {
        viewModelScope.launch {
            val existing = draftRepository.get(draftId)
            persisted = existing != null
            val now = System.currentTimeMillis()
            val draft = existing ?: PostDraft(id = draftId, createdAt = now, updatedAt = now)
            _state.update { it.copy(draft = draft) }
            // 결과 화면의 "다른 AI로 다시 생성"으로 들어온 경우 한 번만 생성한다(화면 복원 때 다시 돌지 않게).
            val regenerate = handle.get<String>(ARG_REGENERATE)
            if (regenerate != null && handle.get<Boolean>(KEY_REGENERATE_DONE) != true) {
                handle[KEY_REGENERATE_DONE] = true
                AiProviderId.entries.find { it.id == regenerate }?.let { generate(it) }
            }
        }
    }

    fun setCategory(category: Category) = edit { it.copy(category = category) }
    fun setSubjectName(value: String) = edit { it.copy(subjectName = value) }
    fun setMemo(value: String) = edit { it.copy(memo = value) }
    fun setCampaign(enabled: Boolean) = edit(immediate = true) { it.copy(isCampaign = enabled) }
    fun setCampaignText(value: String) = edit { it.copy(campaignRawText = value) }

    fun setSortByTakenAt(enabled: Boolean) = edit(immediate = true) {
        it.copy(sortByTakenAt = enabled, photos = PhotoOrdering.reorder(it.photos, enabled))
    }

    fun onPhotosPicked(uris: List<Uri>) {
        val draft = _state.value.draft ?: return
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(importingPhotos = true) }
            val existing = draft.photos.map { it.originalUri }.toSet()
            val fresh = uris.map { it.toString() }.distinct().filterNot { it in existing }
            val duplicates = uris.size - fresh.size
            val accepted = fresh.take(PostDraft.MAX_PHOTOS - draft.photos.size)
            val overflow = fresh.size - accepted.size
            var permissionFailures = 0

            val startIndex = PhotoOrdering.nextOriginalIndex(draft.photos)
            val newPhotos = withContext(Dispatchers.IO) {
                accepted.mapIndexed { i, uriString ->
                    val uri = Uri.parse(uriString)
                    if (!uriPermissions.take(uri)) permissionFailures++
                    val meta = metadataReader.read(uri)
                    PostPhoto(
                        id = UUID.randomUUID().toString(),
                        originalUri = uriString,
                        originalIndex = startIndex + i,
                        postOrder = 0,
                        takenAt = meta.takenAt,
                        mimeType = meta.mimeType,
                    )
                }
            }

            edit(immediate = true) {
                it.copy(photos = PhotoOrdering.reorder(it.photos + newPhotos, it.sortByTakenAt))
            }
            val notes = buildList {
                if (duplicates > 0) add("이미 추가된 사진 ${duplicates}장은 제외했어요.")
                if (overflow > 0) add("사진은 최대 ${PostDraft.MAX_PHOTOS}장까지라 ${overflow}장은 제외했어요.")
                if (permissionFailures > 0) {
                    add("사진 ${permissionFailures}장은 앱을 다시 켜면 열리지 않을 수 있어요.")
                }
            }
            _state.update {
                it.copy(importingPhotos = false, message = notes.joinToString(" ").ifEmpty { null })
            }
        }
    }

    fun removePhoto(photoId: String) {
        val photo = _state.value.draft?.photos?.find { it.id == photoId } ?: return
        edit(immediate = true) { draft ->
            draft.copy(photos = PhotoOrdering.reorder(draft.photos - photo, draft.sortByTakenAt))
        }
        viewModelScope.launch {
            if (!draftRepository.isUriUsed(photo.originalUri, exceptDraftId = draftId)) {
                uriPermissions.release(photo.originalUri)
            }
        }
    }

    fun selectProvider(provider: AiProviderId) {
        if (_state.value.busy) return
        edit(immediate = true) { it.copy(selectedProvider = provider.id) }
        _state.update { it.copy(analysis = AnalysisUiState(), generation = GenerationUiState()) }
    }

    /**
     * 선택한 Provider로 원고를 만든다. 사진은 다시 보내지 않고 그 Provider의 사진 분석만 쓴다.
     * 분석이 없는 사진이 있으면 호출하지 않고 안내한다. 실패해도 이전 원고는 지우지 않는다.
     */
    fun generate(provider: AiProviderId? = null) {
        val current = _state.value.draft ?: return
        if (_state.value.busy) return
        val target = provider ?: current.provider
        if (target != current.provider) edit(immediate = true) { it.copy(selectedProvider = target.id) }
        viewModelScope.launch {
            _state.update { it.copy(generation = GenerationUiState(running = true, provider = target)) }
            val style = styleRepository.profile.first()
            val draft = _state.value.draft ?: return@launch
            when (val outcome = generationRepository.generatePost(draft, target, style)) {
                is BlogGenerationRepository.GenerateOutcome.NeedsAnalysis -> _state.update {
                    it.copy(
                        generation = GenerationUiState(
                            provider = target,
                            error = if (outcome.missing == 0) {
                                "사진을 먼저 추가하세요."
                            } else {
                                "${target.label} 사진 분석이 먼저 필요해요 (${outcome.missing}장). 위의 사진 분석을 먼저 해 주세요."
                            },
                        ),
                    )
                }
                is BlogGenerationRepository.GenerateOutcome.Failed -> _state.update {
                    it.copy(generation = GenerationUiState(provider = target, error = outcome.error.message))
                }
                is BlogGenerationRepository.GenerateOutcome.Success -> {
                    edit(immediate = true) { it.copy(result = outcome.post) }
                    _state.update { it.copy(generation = GenerationUiState(provider = target), openResultFor = draftId) }
                }
            }
        }
    }

    fun resultOpened() = _state.update { it.copy(openResultFor = null) }

    /**
     * 선택한 Provider로 아직 분석이 없는(또는 실패한, 버전이 다른) 사진만 분석한다.
     * 배치가 끝날 때마다 결과를 작성 건에 바로 저장하므로, 중간에 실패해도 성공한 배치는 남는다.
     */
    fun analyzePhotos() {
        val draft = _state.value.draft ?: return
        if (_state.value.busy) return
        val provider = draft.provider
        val total = generationRepository.photosToAnalyze(draft, provider).size
        if (total == 0) return
        viewModelScope.launch {
            _state.update { it.copy(analysis = AnalysisUiState(running = true, total = total)) }
            val summary = generationRepository.analyzePhotos(draft, provider) { batch ->
                edit(immediate = true) { current ->
                    current.copy(
                        photos = current.photos.map { photo ->
                            // 분석 중에 빠진 사진의 결과는 버린다.
                            batch.entries[photo.id]?.let { photo.copy(analyses = photo.analyses + (provider.id to it)) } ?: photo
                        },
                    )
                }
                _state.update { it.copy(analysis = it.analysis.copy(processed = it.analysis.processed + batch.entries.size)) }
            }
            val error = (summary.stopError ?: summary.lastError)?.message
            _state.update {
                it.copy(
                    analysis = AnalysisUiState(total = summary.requested, processed = summary.succeeded + summary.failed, error = error),
                    message = "${provider.label} 사진 분석: 성공 ${summary.succeeded}장" +
                        (if (summary.failed > 0) ", 실패 ${summary.failed}장" else "") +
                        (if (summary.stopError != null) " (중단됨)" else ""),
                )
            }
        }
    }

    /** 선택한 Provider의 분석 결과만 지우고 전체를 다시 분석한다. 다른 Provider 결과는 그대로 둔다. */
    fun reanalyzeAll() {
        if (_state.value.busy) return
        val provider = _state.value.draft?.provider ?: return
        edit(immediate = true) { draft ->
            draft.copy(photos = draft.photos.map { it.copy(analyses = it.analyses - provider.id) })
        }
        analyzePhotos()
    }

    fun showMessage(message: String) = _state.update { it.copy(message = message) }
    fun messageShown() = _state.update { it.copy(message = null) }

    /**
     * 디버그용: 모든 사진으로 AI용 사본을 만들어 보고 크기와 실패 여부를 보여준다.
     * 아무것도 전송하지 않고, 끝나면 사본을 지운다.
     */
    fun runResizeTest() {
        val photos = _state.value.draft?.photosInPostOrder().orEmpty()
        if (photos.isEmpty() || _state.value.resizeTest is ResizeTestState.Running) return
        viewModelScope.launch {
            _state.update { it.copy(resizeTest = ResizeTestState.Running(0, photos.size)) }
            val started = SystemClock.elapsedRealtime()
            val lines = mutableListOf<String>()
            var succeeded = 0
            var totalBytes = 0L
            var withLocation = 0
            var notJpeg = 0
            photos.forEachIndexed { i, photo ->
                // 왼쪽은 원본 형식, 화살표 오른쪽은 실제로 만들어진 사본 파일의 형식이다.
                val label = "#${photo.postOrder + 1} 원본 ${photo.mimeType ?: "?"}"
                try {
                    val image = aiImagePreparer.prepare(photo)
                    succeeded++
                    totalBytes += image.bytes
                    if (hasLocation(image.file)) withLocation++
                    val jpeg = isJpegFile(image.file)
                    if (!jpeg) notJpeg++
                    val format = if (jpeg) "JPEG" else "JPEG 아님!"
                    lines += "$label → 사본 $format ${image.width}×${image.height}, ${image.bytes / 1024}KB"
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "리사이즈 실패: ${photo.originalUri}", e)
                    lines += "$label → 실패: ${e.message ?: e::class.simpleName}"
                }
                _state.update { it.copy(resizeTest = ResizeTestState.Running(i + 1, photos.size)) }
            }
            aiImagePreparer.clear()

            val elapsedMs = SystemClock.elapsedRealtime() - started
            val avgKb = if (succeeded > 0) totalBytes / succeeded / 1024 else 0
            // base64로 보내면 약 1.35배가 된다.
            val batchKb = avgKb * generationConfig.analysisBatchSize * 135 / 100
            val summary = buildString {
                append("성공 $succeeded/${photos.size}장, ${elapsedMs}ms, 평균 ${avgKb}KB")
                append(" (긴 변 ${generationConfig.aiImageLongEdgePx}px, 품질 ${generationConfig.aiImageJpegQuality})\n")
                append("예상 요청 크기: 배치 ${generationConfig.analysisBatchSize}장 ≈ ${batchKb}KB\n")
                append("JPEG가 아닌 사본: ${notJpeg}장 · 위치정보가 남은 사본: ${withLocation}장")
            }
            _state.update { it.copy(resizeTest = ResizeTestState.Done(summary, lines)) }
        }
    }

    private suspend fun hasLocation(file: File): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val exif = ExifInterface(file)
            exif.latLong != null || exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE) != null
        }.getOrDefault(false)
    }

    private suspend fun isJpegFile(file: File): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val header = ByteArray(3)
            val read = file.inputStream().use { it.read(header) }
            read == header.size && AiImagePreparer.isJpeg(header)
        }.getOrDefault(false)
    }

    private fun edit(immediate: Boolean = false, change: (PostDraft) -> PostDraft) {
        _state.update { state ->
            val draft = state.draft ?: return@update state
            state.copy(draft = change(draft).copy(updatedAt = System.currentTimeMillis()))
        }
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            if (!immediate) delay(SAVE_DEBOUNCE_MS)
            persist(_state.value.draft)
        }
    }

    private suspend fun persist(draft: PostDraft?) {
        if (draft == null || (draft.isBlank && !persisted)) return
        persisted = true
        try {
            draftRepository.save(draft)
        } catch (e: IOException) {
            Log.e(TAG, "작성 건 저장 실패", e)
            _state.update { it.copy(message = "저장하지 못했어요: ${e.message}") }
        }
    }

    override fun onCleared() {
        // 디바운스 중이던 입력까지 저장한다. viewModelScope는 이미 취소됐으므로 appScope를 쓴다.
        val draft = _state.value.draft
        appScope.launch { persist(draft) }
    }

    companion object {
        private const val TAG = "NewPostViewModel"
        private const val ARG_DRAFT_ID = "draftId"
        private const val KEY_NEW_DRAFT_ID = "newDraftId"
        private const val ARG_REGENERATE = "regenerate"
        private const val KEY_REGENERATE_DONE = "regenerateDone"
        private const val SAVE_DEBOUNCE_MS = 400L

        val Factory = viewModelFactory {
            initializer {
                val c = appContainer
                NewPostViewModel(
                    savedStateHandle = createSavedStateHandle(),
                    draftRepository = c.draftRepository,
                    uriPermissions = c.uriPermissions,
                    metadataReader = c.photoMetadataReader,
                    aiImagePreparer = c.aiImagePreparer,
                    generationConfig = c.generationConfig,
                    appScope = c.appScope,
                    generationRepository = c.blogGenerationRepository,
                    styleRepository = c.styleRepository,
                )
            }
        }
    }
}
