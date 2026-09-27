package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.PostPhoto
import org.junit.Assert.assertEquals
import org.junit.Test

class PhotoOrderingTest {

    private fun photo(id: String, originalIndex: Int, takenAt: Long?) =
        PostPhoto(id, "content://$id", originalIndex, postOrder = -1, takenAt = takenAt)

    // 선택 순서: a, b, c, d / 촬영 순서: c, a, (시간 없음 b, d)
    private val photos = listOf(
        photo("a", 0, 200L),
        photo("b", 1, null),
        photo("c", 2, 100L),
        photo("d", 3, null),
    )

    @Test
    fun defaultKeepsSelectionOrder() {
        val result = PhotoOrdering.reorder(photos.shuffled(), byTakenAt = false)
        assertEquals(listOf("a", "b", "c", "d"), result.map { it.id })
        assertEquals(listOf(0, 1, 2, 3), result.map { it.postOrder })
    }

    @Test
    fun byTakenAtPutsUnknownTimesLastInSelectionOrder() {
        val result = PhotoOrdering.reorder(photos, byTakenAt = true)
        assertEquals(listOf("c", "a", "b", "d"), result.map { it.id })
        assertEquals(listOf(0, 1, 2, 3), result.map { it.postOrder })
    }

    @Test
    fun originalIndexNeverChanges() {
        val result = PhotoOrdering.reorder(photos, byTakenAt = true)
        assertEquals(mapOf("a" to 0, "b" to 1, "c" to 2, "d" to 3), result.associate { it.id to it.originalIndex })
    }

    @Test
    fun removingAPhotoCompactsPostOrder() {
        val result = PhotoOrdering.reorder(photos.filterNot { it.id == "b" }, byTakenAt = false)
        assertEquals(listOf(0, 1, 2), result.map { it.postOrder })
    }

    @Test
    fun nextOriginalIndexContinuesAfterGaps() {
        assertEquals(0, PhotoOrdering.nextOriginalIndex(emptyList()))
        assertEquals(4, PhotoOrdering.nextOriginalIndex(photos.filterNot { it.id == "b" }))
    }
}
