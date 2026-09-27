package com.minhee.blogwriter.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.minhee.blogwriter.appContainer
import com.minhee.blogwriter.data.GenerationConfig
import com.minhee.blogwriter.data.StyleRepository
import com.minhee.blogwriter.data.model.StyleProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
    val profile: StyleProfile? = null,
    val dirty: Boolean = false,
    val saving: Boolean = false,
    val message: String? = null,
)

class SettingsViewModel(
    private val styleRepository: StyleRepository,
    val generationConfig: GenerationConfig,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val profile = styleRepository.profile.first()
            _state.update { it.copy(profile = profile) }
        }
    }

    fun edit(change: (StyleProfile) -> StyleProfile) {
        _state.update { state ->
            val profile = state.profile ?: return@update state
            state.copy(profile = change(profile), dirty = true)
        }
    }

    fun save() {
        val profile = _state.value.profile ?: return
        viewModelScope.launch {
            _state.update { it.copy(saving = true) }
            val message = try {
                styleRepository.save(profile.copy(updatedAt = System.currentTimeMillis()))
                _state.update { it.copy(dirty = false) }
                "문체 설정을 저장했어요."
            } catch (e: Exception) {
                "저장하지 못했어요: ${e.message}"
            }
            _state.update { it.copy(saving = false, message = message) }
        }
    }

    fun messageShown() = _state.update { it.copy(message = null) }

    companion object {
        val Factory = viewModelFactory {
            initializer {
                SettingsViewModel(appContainer.styleRepository, appContainer.generationConfig)
            }
        }
    }
}
