package com.minhee.blogwriter.ui.result

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.minhee.blogwriter.appContainer
import com.minhee.blogwriter.data.DraftRepository
import com.minhee.blogwriter.data.model.PostDraft
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ResultUiState(val loading: Boolean = true, val draft: PostDraft? = null)

/**
 * 저장된 원고를 보여주기만 한다(작성 건 파일을 쓰지 않음).
 * 다시 생성은 입력 화면(NewPostViewModel)이 하므로, 한 작성 건을 두 화면이 동시에 덮어쓰지 않는다.
 */
class ResultViewModel(savedStateHandle: SavedStateHandle, draftRepository: DraftRepository) : ViewModel() {
    val draftId: String = checkNotNull(savedStateHandle["draftId"])

    val state: StateFlow<ResultUiState> = draftRepository.drafts
        .map { drafts -> ResultUiState(loading = false, draft = drafts.find { it.id == draftId }) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ResultUiState())

    init {
        viewModelScope.launch { draftRepository.ensureLoaded() }
    }

    companion object {
        val Factory = viewModelFactory {
            initializer { ResultViewModel(createSavedStateHandle(), appContainer.draftRepository) }
        }
    }
}
