package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.PostPhoto

object PhotoOrdering {

    /**
     * postOrder를 0부터 다시 매긴다.
     * 기본은 선택 순서(originalIndex). byTakenAt이면 촬영시간순이고, 촬영시간이 없는 사진은 뒤로 보낸다.
     */
    fun reorder(photos: List<PostPhoto>, byTakenAt: Boolean): List<PostPhoto> {
        val sorted = if (byTakenAt) {
            photos.sortedWith(compareBy<PostPhoto>({ it.takenAt ?: Long.MAX_VALUE }, { it.originalIndex }))
        } else {
            photos.sortedBy { it.originalIndex }
        }
        return sorted.mapIndexed { index, photo -> photo.copy(postOrder = index) }
    }

    fun nextOriginalIndex(photos: List<PostPhoto>): Int =
        (photos.maxOfOrNull { it.originalIndex } ?: -1) + 1
}
