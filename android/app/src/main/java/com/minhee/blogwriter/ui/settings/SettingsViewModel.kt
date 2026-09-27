package com.minhee.blogwriter.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.minhee.blogwriter.BuildConfig
import com.minhee.blogwriter.appContainer
import com.minhee.blogwriter.data.GenerationConfig
import com.minhee.blogwriter.data.StyleRepository
import com.minhee.blogwriter.data.model.BridgeStatus
import com.minhee.blogwriter.data.model.StyleProfile
import com.minhee.blogwriter.data.remote.BridgeApi
import com.minhee.blogwriter.data.remote.BridgeError
import com.minhee.blogwriter.data.remote.BridgeResult
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
    val bridge: BridgeUiState = BridgeUiState(),
)

/** PC 브리지 연결 확인 결과. */
data class BridgeUiState(
    val checking: Boolean = false,
    val status: BridgeStatus? = null,
    val error: BridgeError? = null,
)

class SettingsViewModel(
    private val styleRepository: StyleRepository,
    val generationConfig: GenerationConfig,
    private val bridgeApi: BridgeApi,
) : ViewModel() {

    val bridgeUrl: String = BuildConfig.BRIDGE_URL
    val bridgeConfigured: Boolean = bridgeApi.isConfigured

    /** 브리지에 두 Provider 상태를 물어본다. 모델 호출은 없다. */
    fun checkBridge() {
        if (_state.value.bridge.checking) return
        viewModelScope.launch {
            _state.update { it.copy(bridge = it.bridge.copy(checking = true, error = null)) }
            val bridge = when (val result = bridgeApi.status(refresh = true)) {
                is BridgeResult.Ok -> BridgeUiState(status = result.value)
                is BridgeResult.Err -> BridgeUiState(error = result.error)
            }
            _state.update { it.copy(bridge = bridge) }
        }
    }

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
                SettingsViewModel(appContainer.styleRepository, appContainer.generationConfig, appContainer.bridgeApi)
            }
        }
    }
}
