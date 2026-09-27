package com.minhee.blogwriter.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.minhee.blogwriter.data.model.StyleProfile

/** 문체 항목 하나: 화면 라벨, 입력 예시, 값 읽기/쓰기. */
private data class StyleField(
    val label: String,
    val hint: String,
    val get: (StyleProfile) -> String,
    val set: (StyleProfile, String) -> StyleProfile,
    val minLines: Int = 1,
)

private val styleFields = listOf(
    StyleField("종결어미", "예) ~했어요 / ~했답니다 섞어 씀", { it.endings }, { p, v -> p.copy(endings = v) }),
    StyleField("문장 길이", "예) 짧게 끊어 씀", { it.sentenceLength }, { p, v -> p.copy(sentenceLength = v) }),
    StyleField("문단 길이", "예) 2~3문장마다 줄바꿈", { it.paragraphLength }, { p, v -> p.copy(paragraphLength = v) }),
    StyleField("이모지 빈도", "예) 문단당 0~1개", { it.emojiFrequency }, { p, v -> p.copy(emojiFrequency = v) }),
    StyleField("ㅋㅋ/ㅎㅎ 사용", "예) ㅎㅎ만 가끔", { it.laughStyle }, { p, v -> p.copy(laughStyle = v) }),
    StyleField("자주 쓰는 표현", "예) 솔직히 말하면, 재방문 의사 100%", { it.favoritePhrases }, { p, v -> p.copy(favoritePhrases = v) }, 2),
    StyleField("피해야 할 표현", "예) 존맛탱, 강추", { it.avoidPhrases }, { p, v -> p.copy(avoidPhrases = v) }, 2),
    StyleField("후기 구성 방식", "예) 방문 계기 → 외관 → 메뉴 → 총평", { it.reviewStructure }, { p, v -> p.copy(reviewStructure = v) }, 2),
    StyleField("기타 지침", "예) 가격은 꼭 따로 정리", { it.customInstructions }, { p, v -> p.copy(customInstructions = v) }, 3),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = viewModel(factory = SettingsViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            viewModel.messageShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("설정") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val profile = state.profile
        if (profile == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("나의 블로그 문체", style = MaterialTheme.typography.titleMedium)
                Text(
                    "원고를 만들 때마다 이 설정을 그대로 참고해요. 글마다 다시 분석하지 않아요.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            item {
                OutlinedTextField(
                    value = profile.samplesText,
                    onValueChange = { v -> viewModel.edit { it.copy(samplesText = v) } },
                    label = { Text("내 기존 블로그 글 샘플 (붙여넣기)") },
                    minLines = 6,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Column {
                    OutlinedButton(onClick = {}, enabled = false) { Text("샘플로 문체 분석") }
                    Text(
                        "샘플 자동 분석은 Phase 2에서 연결돼요. 지금은 아래 항목을 직접 적어 주세요.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            styleFields.forEach { field ->
                item(key = field.label) {
                    OutlinedTextField(
                        value = field.get(profile),
                        onValueChange = { v -> viewModel.edit { field.set(it, v) } },
                        label = { Text(field.label) },
                        placeholder = { Text(field.hint) },
                        minLines = field.minLines,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item {
                Button(
                    onClick = viewModel::save,
                    enabled = state.dirty && !state.saving,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (state.dirty) "저장" else "저장됨") }
            }

            item { HorizontalDivider() }
            item {
                val c = viewModel.generationConfig
                Text("생성 설정 (local.properties에서 변경)", style = MaterialTheme.typography.titleSmall)
                Text(
                    "사진 분석 배치 ${c.analysisBatchSize}장 · 동시 요청 ${c.analysisConcurrency}개\n" +
                        "AI용 사진 긴 변 ${c.aiImageLongEdgePx}px · JPEG 품질 ${c.aiImageJpegQuality}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
