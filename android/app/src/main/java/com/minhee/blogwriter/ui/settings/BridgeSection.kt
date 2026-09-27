package com.minhee.blogwriter.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.ProviderStatus

/** 설정 화면의 "PC 브리지" 영역: 연결 확인과 Provider별 상태. */
@Composable
fun BridgeSection(url: String, configured: Boolean, state: BridgeUiState, onCheck: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("PC 브리지 (AI 연결)", style = MaterialTheme.typography.titleMedium)
        Text(
            if (configured) "주소: $url" else "브리지 주소/토큰이 설정되지 않았어요. PC에서 `npm run setup-token` 후 앱을 다시 빌드하세요.",
            style = MaterialTheme.typography.bodySmall,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onCheck, enabled = configured && !state.checking) { Text("연결 확인") }
            if (state.checking) {
                Spacer(Modifier.size(12.dp))
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
                Text("PC에서 확인 중… (최대 1분)", style = MaterialTheme.typography.bodySmall)
            }
        }
        state.error?.let { error ->
            Text(error.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        state.status?.let { status ->
            AiProviderId.entries.forEach { id ->
                val provider = status.providers[id.id]
                if (provider != null) ProviderCard(id.label, provider)
            }
            Text("브리지 ${status.bridge.version} · 모델 호출 없이 확인했어요.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ProviderCard(label: String, status: ProviderStatus) {
    val color = if (status.ready) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer
    Card(colors = CardDefaults.cardColors(containerColor = color), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$label · ${codeLabel(status.code)}", style = MaterialTheme.typography.titleSmall)
            Text(status.message, style = MaterialTheme.typography.bodySmall)
            status.plan?.let { Text("요금제: $it", style = MaterialTheme.typography.bodySmall) }
            status.usage.forEach { w ->
                Text(
                    "사용량 ${w.name}: ${w.usedPercent?.let { "${it.toInt()}%" } ?: "?"}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(
                "구독 외 과금 확인: ${billingLabel(status.billingCheck)} · 모델: 분석 ${status.models.analysis ?: "구독 기본"} / 작성 ${status.models.writing ?: "구독 기본"}",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun codeLabel(code: String) = when (code) {
    "READY" -> "사용 가능"
    "AUTH_REQUIRED" -> "로그인 필요"
    "API_KEY_BLOCKED" -> "API 키 차단"
    "BILLING_RISK" -> "과금 위험 차단"
    "USAGE_LIMIT" -> "사용량 한도"
    else -> "오류"
}

private fun billingLabel(check: String) = when (check) {
    "ok" -> "안전"
    "blocked" -> "차단"
    else -> "확인 불가"
}
