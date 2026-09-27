package com.minhee.blogwriter.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.minhee.blogwriter.appContainer
import com.minhee.blogwriter.data.DraftRepository
import com.minhee.blogwriter.data.model.Category
import com.minhee.blogwriter.photo.UriPermissions
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DraftSummary(
    val id: String,
    val title: String,
    val category: Category,
    val photoCount: Int,
    val updatedAt: Long,
)

data class HomeUiState(
    val loading: Boolean = true,
    val drafts: List<DraftSummary> = emptyList(),
)

class HomeViewModel(
    private val draftRepository: DraftRepository,
    private val uriPermissions: UriPermissions,
) : ViewModel() {

    val state: StateFlow<HomeUiState> = draftRepository.drafts
        .map { drafts ->
            HomeUiState(
                loading = false,
                drafts = drafts
                    .sortedByDescending { it.updatedAt }
                    .take(RECENT_LIMIT)
                    .map { draft ->
                        DraftSummary(
                            id = draft.id,
                            title = draft.subjectName.ifBlank { "(이름 없음)" },
                            category = draft.category,
                            photoCount = draft.photos.size,
                            updatedAt = draft.updatedAt,
                        )
                    },
            )
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUiState())

    init {
        viewModelScope.launch { draftRepository.ensureLoaded() }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            val removed = draftRepository.delete(id) ?: return@launch
            removed.photos.forEach { photo ->
                if (!draftRepository.isUriUsed(photo.originalUri)) {
                    uriPermissions.release(photo.originalUri)
                }
            }
        }
    }

    companion object {
        private const val RECENT_LIMIT = 10

        val Factory = viewModelFactory {
            initializer {
                HomeViewModel(appContainer.draftRepository, appContainer.uriPermissions)
            }
        }
    }
}
