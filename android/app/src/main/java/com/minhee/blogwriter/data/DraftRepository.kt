package com.minhee.blogwriter.data

import android.util.Log
import androidx.core.util.AtomicFile
import com.minhee.blogwriter.data.model.PostDraft
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 작성 건을 draftsDir/{id}.json 파일로 저장한다.
 * 파일은 AtomicFile로 써서 저장 도중 앱이 죽어도 이전 내용이 깨지지 않는다.
 */
class DraftRepository(
    private val draftsDir: File,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val mutex = Mutex()
    private val cache = MutableStateFlow<Map<String, PostDraft>?>(null)

    /** 모든 작성 건. ensureLoaded()가 불린 뒤부터 값이 나온다. */
    val drafts: Flow<List<PostDraft>> = cache.filterNotNull().map { it.values.toList() }

    suspend fun ensureLoaded() {
        mutex.withLock { loadLocked() }
    }

    suspend fun get(id: String): PostDraft? = mutex.withLock { loadLocked()[id] }

    suspend fun exists(id: String): Boolean = get(id) != null

    // 쓰기 도중 호출한 쪽이 취소돼도 파일과 메모리 캐시가 어긋나지 않게 끝까지 진행한다.
    suspend fun save(draft: PostDraft) = withContext(NonCancellable) {
        mutex.withLock {
            val current = loadLocked()
            withContext(io) { write(draft) }
            cache.value = current + (draft.id to draft)
        }
    }

    /** 삭제한 작성 건을 돌려준다(사진 URI 권한 정리용). */
    suspend fun delete(id: String): PostDraft? = withContext(NonCancellable) {
        mutex.withLock {
            val current = loadLocked()
            val removed = current[id] ?: return@withLock null
            withContext(io) { AtomicFile(fileFor(id)).delete() }
            cache.value = current - id
            removed
        }
    }

    /** 다른 작성 건이 같은 사진을 쓰고 있으면 URI 권한을 해제하면 안 된다. */
    suspend fun isUriUsed(uri: String, exceptDraftId: String? = null): Boolean = mutex.withLock {
        loadLocked().values.any { draft ->
            draft.id != exceptDraftId && draft.photos.any { it.originalUri == uri }
        }
    }

    private suspend fun loadLocked(): Map<String, PostDraft> {
        cache.value?.let { return it }
        val loaded = withContext(io) {
            draftsDir.mkdirs()
            draftsDir.listFiles { file -> file.extension == "json" }
                .orEmpty()
                .mapNotNull(::readOrNull)
                .associateBy { it.id }
        }
        cache.value = loaded
        return loaded
    }

    private fun readOrNull(file: File): PostDraft? = try {
        AppJson.decodeFromString<PostDraft>(AtomicFile(file).readFully().decodeToString())
    } catch (e: Exception) {
        // 깨진 파일 하나 때문에 전체 목록을 못 여는 일은 없게 한다.
        Log.w(TAG, "작성 건 파일을 읽지 못함: ${file.name}", e)
        null
    }

    private fun write(draft: PostDraft) {
        draftsDir.mkdirs()
        val file = AtomicFile(fileFor(draft.id))
        val out = file.startWrite()
        try {
            out.write(AppJson.encodeToString(PostDraft.serializer(), draft).encodeToByteArray())
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }

    private fun fileFor(id: String) = File(draftsDir, "$id.json")

    private companion object {
        const val TAG = "DraftRepository"
    }
}
