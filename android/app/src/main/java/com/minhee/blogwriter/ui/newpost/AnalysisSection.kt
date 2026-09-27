package com.minhee.blogwriter.ui.newpost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 사진 한 장의 현재 Provider 분석 상태를 썸네일 배지에 붙일 기호로. */
fun analysisMark(photo: PostPhoto, provider: AiProviderId): String {
    val entry = photo.analysisFor(provider) ?: return ""
    return when {
        photo.needsAnalysis(provider) && entry.analysis != null -> " ↻" // 이전 버전 분석
        entry.analysis != null -> " ✓"
        else -> " !"
    }
}

/** 새 포스팅 화면의 "AI 사진 분석" 영역. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AnalysisSection(
    draft: PostDraft,
    state: AnalysisUiState,
    /** 분석이나 원고 생성이 진행 중이면 true */
    locked: Boolean,
    onSelectProvider: (AiProviderId) -> Unit,
    onAnalyze: () -> Unit,
    onReanalyzeAll: () -> Unit,
) {
    val provider = draft.provider
    val photos = draft.photos
    val analyzed = photos.count { !it.needsAnalysis(provider) }
    val failed = photos.count { it.needsAnalysis(provider) && it.analysisFor(provider)?.error != null }
    val pending = photos.size - analyzed
    var confirmReanalyze by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("AI 사진 분석", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AiProviderId.entries.forEach { id ->
                FilterChip(
                    selected = id == provider,
                    onClick = { onSelectProvider(id) },
                    enabled = !locked,
                    label = { Text(id.label) },
                )
            }
        }
        Text(
            "${provider.label} 분석: 완료 $analyzed · 실패 $failed · 남음 ${pending - failed} / ${photos.size}장",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (state.running) {
            LinearProgressIndicator(
                progress = { if (state.total == 0) 0f else state.processed.toFloat() / state.total },
                modifier = Modifier.fillMaxWidth(),
            )
            Text("PC에서 분석 중… ${state.processed}/${state.total}장", style = MaterialTheme.typography.bodySmall)
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

        Button(
            onClick = onAnalyze,
            enabled = !locked && pending > 0,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                when {
                    photos.isEmpty() -> "사진을 먼저 추가하세요"
                    pending == 0 -> "${provider.label} 분석 완료"
                    failed > 0 -> "${provider.label}로 실패·남은 사진 ${pending}장 분석"
                    else -> "${provider.label}로 사진 ${pending}장 분석"
                },
            )
        }
        if (analyzed > 0 && !locked) {
            TextButton(onClick = { confirmReanalyze = true }) { Text("${provider.label} 분석 지우고 처음부터 다시") }
        }
        Text(
            "AI용으로 줄인 사진만 PC로 보내고, 분석 결과는 AI별로 따로 저장해요. 썸네일을 누르면 결과를 볼 수 있어요. (✓ 완료, ! 실패)",
            style = MaterialTheme.typography.bodySmall,
        )
    }

    if (confirmReanalyze) {
        AlertDialog(
            onDismissRequest = { confirmReanalyze = false },
            title = { Text("${provider.label} 분석 다시 하기") },
            text = { Text("${provider.label}로 분석한 결과만 지우고 사진 ${photos.size}장을 다시 분석해요. 다른 AI의 분석 결과는 그대로 남아요.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmReanalyze = false
                    onReanalyzeAll()
                }) { Text("다시 분석") }
            },
            dismissButton = { TextButton(onClick = { confirmReanalyze = false }) { Text("취소") } },
        )
    }
}

/** 썸네일을 눌렀을 때 현재 Provider의 분석 결과. */
@Composable
fun AnalysisDialog(photo: PostPhoto, provider: AiProviderId, onDismiss: () -> Unit) {
    val entry = photo.analysisFor(provider)
    val a = entry?.analysis
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("사진 ${photo.postOrder + 1} · ${provider.label} 분석") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                when {
                    entry == null -> Text("아직 분석하지 않았어요.")
                    a == null -> Text("분석 실패: ${entry.error ?: "알 수 없음"}", color = MaterialTheme.colorScheme.error)
                    else -> {
                        Text("종류: ${a.type}")
                        Text("설명: ${a.description}")
                        Text("사진 속 글자: ${a.visibleText.ifBlank { "(없음)" }}")
                        Text("태그: ${a.tags.joinToString(", ").ifBlank { "(없음)" }}")
                        Text("불확실: ${a.uncertain.joinToString(" / ").ifBlank { "(없음)" }}")
                    }
                }
                if (entry != null) {
                    Text(
                        "모델 ${entry.model ?: "-"} · 버전 ${entry.version} · ${SimpleDateFormat("M/d HH:mm", Locale.KOREA).format(Date(entry.analyzedAt))}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )
}
