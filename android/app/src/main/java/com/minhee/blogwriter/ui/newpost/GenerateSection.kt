package com.minhee.blogwriter.ui.newpost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.minhee.blogwriter.data.model.PostDraft

/** 새 포스팅 화면의 "원고 생성" 영역. */
@Composable
fun GenerateSection(
    draft: PostDraft,
    state: NewPostUiState,
    onGenerate: () -> Unit,
    onOpenResult: () -> Unit,
) {
    val provider = draft.provider
    val pending = draft.photos.count { it.needsAnalysis(provider) }
    val generation = state.generation

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = onGenerate,
            enabled = draft.photos.isNotEmpty() && pending == 0 && !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("${provider.label}로 원고 생성") }

        when {
            generation.running -> {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text("PC에서 ${generation.provider?.label ?: provider.label}로 원고를 쓰는 중… (보통 1~3분)", style = MaterialTheme.typography.bodySmall)
            }
            draft.photos.isEmpty() -> Text("사진을 추가하고 분석한 뒤 원고를 만들 수 있어요.", style = MaterialTheme.typography.bodySmall)
            pending > 0 -> Text(
                "원고를 만들려면 먼저 ${provider.label} 사진 분석을 끝내세요 (${pending}장 남음). 사진은 다시 보내지 않고 분석 결과만 써요.",
                style = MaterialTheme.typography.bodySmall,
            )
            else -> Text("사진 파일은 다시 보내지 않고, ${provider.label} 사진 분석과 메모·문체 설정만으로 원고를 써요.", style = MaterialTheme.typography.bodySmall)
        }
        if (draft.isCampaign) {
            Text(
                if (draft.campaignRawText.isBlank()) {
                    "체험단 스위치가 켜져 있지만 조건이 비어 있어요. 이대로 만들면 일반 글로 생성돼요."
                } else {
                    "붙여넣은 체험단 조건을 원고에 반영하고, 결과 화면에 체크리스트로 보여줘요. (추가 AI 호출 없음)"
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        generation.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        draft.result?.let { result ->
            OutlinedButton(onClick = onOpenResult, enabled = !generation.running, modifier = Modifier.fillMaxWidth()) {
                Text("저장된 원고 보기 (${result.generatedBy.providerLabel})")
            }
        }
    }
}
