package com.minhee.blogwriter.ui.result

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.GeneratedPost
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.ui.common.PhotoThumb
import com.minhee.blogwriter.util.ClipboardHelper
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 임시 결과 화면(3단계). 제목·문단·전체 복사, 사진 썸네일, 확인 필요, 다른 AI로 다시 생성. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultScreen(
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onRegenerate: (String, AiProviderId) -> Unit,
    viewModel: ResultViewModel = viewModel(factory = ResultViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val copy: (String, String) -> Unit = { label, text ->
        val ok = ClipboardHelper.copyPlainText(context, label, text)
        if (!ok || !ClipboardHelper.systemShowsCopyNotice) {
            scope.launch { snackbar.showSnackbar(if (ok) "$label 복사했어요" else "복사하지 못했어요. 글을 길게 눌러 직접 선택하세요.") }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("원고") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val draft = state.draft
        val post = draft?.result
        if (state.loading || draft == null || post == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (state.loading) CircularProgressIndicator() else Text("저장된 원고가 없어요.")
            }
            return@Scaffold
        }
        val photosById = draft.photos.associateBy { it.id }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { GeneratedByLine(post) }
            if (post.photoIds.toSet() != draft.photos.map { it.id }.toSet()) {
                item {
                    Text(
                        "원고를 만든 뒤 사진이 바뀌었어요. 사진을 반영하려면 다시 생성하세요.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (post.confirmNeeded.isNotEmpty()) item { ConfirmNeededCard(post.confirmNeeded) }

            item { Text("제목 후보", style = MaterialTheme.typography.titleMedium) }
            itemsIndexed(post.titleCandidates) { i, title ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}. ", style = MaterialTheme.typography.bodyLarge)
                    Text(highlightConfirm(title), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = { copy("제목", title) }) { Text("복사") }
                }
            }
            item {
                Button(onClick = { copy("전체 글", post.fullText()) }, modifier = Modifier.fillMaxWidth()) { Text("전체 본문 복사 (해시태그 포함)") }
            }
            item { HorizontalDivider() }

            itemsIndexed(post.blocks) { _, block ->
                if (block.isImageGroup) {
                    ImageGroup(block.photoIds.map { photosById[it] to it })
                } else {
                    Column {
                        Text(
                            highlightConfirm(block.text),
                            style = if (block.type == "heading") MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
                        )
                        TextButton(onClick = { copy(if (block.type == "heading") "소제목" else "문단", block.text) }) { Text("이 부분 복사") }
                    }
                }
            }

            if (post.hashtags.isNotEmpty()) {
                item {
                    Column {
                        Text(post.hashtags.joinToString(" "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                        TextButton(onClick = { copy("해시태그", post.hashtags.joinToString(" ")) }) { Text("해시태그 복사") }
                    }
                }
            }
            item { HorizontalDivider() }
            item { ValidationList(post) }
            item { RegenerateSection(draft, onEdit = { onEdit(draft.id) }, onRegenerate = { onRegenerate(draft.id, it) }) }
        }
    }
}

@Composable
private fun GeneratedByLine(post: GeneratedPost) {
    val by = post.generatedBy
    val time = SimpleDateFormat("M/d HH:mm", Locale.KOREA).format(Date(by.generatedAt))
    Text(
        "생성: ${by.providerLabel} · ${by.model ?: "모델 정보 없음"} · $time" +
            (if (by.analysisModels.isNotEmpty()) "\n사진 분석: ${by.analysisModels.joinToString(", ")}" else ""),
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun ConfirmNeededCard(items: List<String>) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("확인 필요 ${items.size}개 — 올리기 전에 직접 확인하고 고쳐 주세요", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ImageGroup(photos: List<Pair<PostPhoto?, String>>) {
    val numbers = photos.mapNotNull { it.first?.postOrder?.plus(1) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            if (numbers.isEmpty()) "📷 사진" else "📷 사진 ${numbers.first()}" + (if (numbers.size > 1) "~${numbers.last()}" else ""),
            style = MaterialTheme.typography.labelLarge,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            photos.forEach { (photo, _) ->
                if (photo != null) {
                    PhotoThumb(uri = photo.originalUri, badge = "${photo.postOrder + 1}", modifier = Modifier.width(88.dp))
                } else {
                    Box(
                        Modifier.width(88.dp).aspectRatio(1f).background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center,
                    ) { Text("사진 없음", style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }
}

@Composable
private fun ValidationList(post: GeneratedPost) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("자동 검사", style = MaterialTheme.typography.titleSmall)
        post.validation.forEach { item ->
            val mark = when (item.status) {
                "PASS" -> "통과"
                "WARN" -> "주의"
                else -> "실패"
            }
            Text(
                "[$mark] ${item.label}: ${item.detail}",
                style = MaterialTheme.typography.bodySmall,
                color = if (item.status == "PASS") Color.Unspecified else MaterialTheme.colorScheme.error,
            )
        }
    }
}

/** 다른 AI(또는 같은 AI)로 다시 생성. 그 AI의 사진 분석이 모두 있어야 바로 생성할 수 있다. */
@Composable
private fun RegenerateSection(draft: PostDraft, onEdit: () -> Unit, onRegenerate: (AiProviderId) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("다시 생성", style = MaterialTheme.typography.titleSmall)
        AiProviderId.entries.forEach { provider ->
            val pending = draft.photos.count { it.needsAnalysis(provider) }
            if (pending == 0 && draft.photos.isNotEmpty()) {
                OutlinedButton(onClick = { onRegenerate(provider) }, modifier = Modifier.fillMaxWidth()) {
                    Text("${provider.label}로 다시 생성 (사진 재분석 없음)")
                }
            } else {
                Text(
                    "${provider.label}: 사진 분석이 먼저 필요해요 (${pending}장). 입력 화면에서 ${provider.label}를 선택해 분석하세요.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        TextButton(onClick = onEdit) { Text("입력 화면으로 (메모·사진·분석 수정)") }
    }
}

/** 본문의 [확인 필요: ...] 부분을 눈에 띄게 표시한다. */
@Composable
private fun highlightConfirm(text: String): AnnotatedString {
    val highlight = SpanStyle(background = MaterialTheme.colorScheme.errorContainer, fontWeight = FontWeight.Bold)
    return buildAnnotatedString {
        var last = 0
        Regex("""\[확인\s*필요\s*:[^\]]*]""").findAll(text).forEach { match ->
            append(text.substring(last, match.range.first))
            withStyle(highlight) { append(match.value) }
            last = match.range.last + 1
        }
        append(text.substring(last))
    }
}
