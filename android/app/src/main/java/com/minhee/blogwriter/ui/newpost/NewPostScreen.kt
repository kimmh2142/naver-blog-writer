package com.minhee.blogwriter.ui.newpost

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.minhee.blogwriter.BuildConfig
import com.minhee.blogwriter.data.model.Category
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.ui.common.PhotoThumb

private const val GRID_COLUMNS = 4

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewPostScreen(
    onBack: () -> Unit,
    viewModel: NewPostViewModel = viewModel(factory = NewPostViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            viewModel.messageShown()
        }
    }

    // 계약 객체는 남은 장수가 바뀔 때만 새로 만든다. 선택 한도는 최소 2장이어야 해서, 1장 남았을 때 넘친 사진은 ViewModel이 잘라낸다.
    val remaining = PostDraft.MAX_PHOTOS - (state.draft?.photos?.size ?: 0)
    val pickerContract = remember(remaining) {
        ActivityResultContracts.PickMultipleVisualMedia(maxItems = remaining.coerceAtLeast(2))
    }
    val pickerLauncher = rememberLauncherForActivityResult(pickerContract) { uris ->
        viewModel.onPhotosPicked(uris)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("새 포스팅") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val draft = state.draft
        if (draft == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        val photos = draft.photosInPostOrder()
        val analyzing = state.analysis.running
        var detailPhotoId by remember { mutableStateOf<String?>(null) }
        detailPhotoId?.let { id ->
            photos.find { it.id == id }?.let { photo ->
                AnalysisDialog(photo = photo, provider = draft.provider, onDismiss = { detailPhotoId = null })
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { SectionTitle("카테고리") }
            item {
                CategoryChips(selected = draft.category, onSelect = viewModel::setCategory)
            }

            item {
                PhotoHeader(
                    count = photos.size,
                    sortByTakenAt = draft.sortByTakenAt,
                    importing = state.importingPhotos,
                    // 분석 중에는 사진 추가·삭제·정렬을 막는다.
                    canAdd = remaining > 0 && !analyzing,
                    canSort = !analyzing,
                    onAdd = {
                        try {
                            pickerLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        } catch (e: ActivityNotFoundException) {
                            viewModel.showMessage("사진 선택기를 열 수 없어요.")
                        }
                    },
                    onSortChange = viewModel::setSortByTakenAt,
                )
            }
            items(photos.chunked(GRID_COLUMNS), key = { row -> row.first().id }) { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { photo ->
                        val badge = if (draft.sortByTakenAt) {
                            "${photo.postOrder + 1} (선택 ${photo.originalIndex + 1})"
                        } else {
                            "${photo.postOrder + 1}"
                        } + analysisMark(photo, draft.provider)
                        PhotoThumb(
                            uri = photo.originalUri,
                            badge = badge,
                            onRemove = if (analyzing) null else ({ viewModel.removePhoto(photo.id) }),
                            onClick = { detailPhotoId = photo.id },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(GRID_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }

            item {
                OutlinedTextField(
                    value = draft.subjectName,
                    onValueChange = viewModel::setSubjectName,
                    label = { Text(draft.category.subjectLabel) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = draft.memo,
                    onValueChange = viewModel::setMemo,
                    label = { Text("실제 경험 · 꼭 넣고 싶은 내용") },
                    placeholder = { Text("예) 웨이팅 20분, 등심 돈가스 바삭함, 소스는 조금 짰음, 주차는 건물 지하 1시간 무료") },
                    minLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("체험단 포스팅", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Switch(checked = draft.isCampaign, onCheckedChange = viewModel::setCampaign)
                }
            }
            if (draft.isCampaign) {
                item {
                    OutlinedTextField(
                        value = draft.campaignRawText,
                        onValueChange = viewModel::setCampaignText,
                        label = { Text("체험단 작성 조건 (안내문 그대로 붙여넣기)") },
                        minLines = 6,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                    )
                }
            }

            item {
                AnalysisSection(
                    draft = draft,
                    state = state.analysis,
                    onSelectProvider = viewModel::selectProvider,
                    onAnalyze = viewModel::analyzePhotos,
                    onReanalyzeAll = viewModel::reanalyzeAll,
                )
            }

            item {
                Column {
                    Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                        Text("원고 생성")
                    }
                    Text(
                        "원고 생성은 다음 단계에서 연결돼요. 지금 입력한 내용과 사진 분석 결과는 자동 저장돼요.",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }

            if (BuildConfig.DEBUG) {
                item {
                    ResizeTestCard(
                        state = state.resizeTest,
                        enabled = photos.isNotEmpty(),
                        onRun = viewModel::runResizeTest,
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoryChips(selected: Category, onSelect: (Category) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Category.entries.forEach { category ->
            FilterChip(
                selected = category == selected,
                onClick = { onSelect(category) },
                label = { Text(category.label) },
            )
        }
    }
}

@Composable
private fun PhotoHeader(
    count: Int,
    sortByTakenAt: Boolean,
    importing: Boolean,
    canAdd: Boolean,
    canSort: Boolean,
    onAdd: () -> Unit,
    onSortChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionTitle("사진 $count/${PostDraft.MAX_PHOTOS}")
            Spacer(Modifier.weight(1f))
            if (importing) {
                CircularProgressIndicator(Modifier.size(20.dp).padding(end = 4.dp), strokeWidth = 2.dp)
            }
            OutlinedButton(onClick = onAdd, enabled = canAdd && !importing) {
                Text("사진 추가")
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "촬영시간순 정렬 (끄면 선택한 순서)",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Switch(checked = sortByTakenAt, onCheckedChange = onSortChange, enabled = count > 1 && canSort)
        }
    }
}

@Composable
private fun ResizeTestCard(state: ResizeTestState, enabled: Boolean, onRun: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("[디버그] AI용 리사이즈 테스트", style = MaterialTheme.typography.titleSmall)
            Text(
                "전송 없이 사본을 만들어 크기와 실패 여부만 확인하고 바로 지워요.",
                style = MaterialTheme.typography.bodySmall,
            )
            when (state) {
                ResizeTestState.Idle -> Unit
                is ResizeTestState.Running -> {
                    LinearProgressIndicator(
                        progress = { state.done.toFloat() / state.total },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("${state.done}/${state.total}", style = MaterialTheme.typography.bodySmall)
                }
                is ResizeTestState.Done -> {
                    Text(state.summary, style = MaterialTheme.typography.bodyMedium)
                    state.lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
            OutlinedButton(
                onClick = onRun,
                enabled = enabled && state !is ResizeTestState.Running,
            ) { Text("리사이즈 테스트 실행") }
        }
    }
}
