package com.minhee.blogwriter.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest

/** 정사각형 썸네일. 원본을 열 수 없으면 "원본 접근 불가"를 표시한다. */
@Composable
fun PhotoThumb(
    uri: String,
    badge: String,
    modifier: Modifier = Modifier,
    onRemove: (() -> Unit)? = null,
) {
    var failed by remember(uri) { mutableStateOf(false) }
    Box(
        modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(uri)
                .size(THUMB_PX)
                .crossfade(true)
                .build(),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            onSuccess = { failed = false },
            onError = { failed = true },
            modifier = Modifier.fillMaxSize(),
        )
        if (failed) {
            Text(
                "원본 접근 불가",
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.align(Alignment.Center).padding(4.dp),
            )
        }
        Surface(
            color = Color.Black.copy(alpha = 0.6f),
            shape = RoundedCornerShape(bottomEnd = 8.dp),
            modifier = Modifier.align(Alignment.TopStart),
        ) {
            Text(
                badge,
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        if (onRemove != null) {
            IconButton(
                onClick = onRemove,
                modifier = Modifier.align(Alignment.TopEnd).size(32.dp),
            ) {
                Surface(color = Color.Black.copy(alpha = 0.6f), shape = CircleShape) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "사진 빼기",
                        tint = Color.White,
                        modifier = Modifier.size(20.dp).padding(2.dp),
                    )
                }
            }
        }
    }
}

private const val THUMB_PX = 320
