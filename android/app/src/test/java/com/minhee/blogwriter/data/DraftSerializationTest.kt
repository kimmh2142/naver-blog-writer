package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.Category
import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import com.minhee.blogwriter.data.model.StyleProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DraftSerializationTest {

    private val draft = PostDraft(
        id = "d1",
        createdAt = 1_000L,
        updatedAt = 2_000L,
        category = Category.CLINIC,
        subjectName = "돈거돈락 서초점",
        memo = "웨이팅 20분\n\"소스\"는 조금 짰음 😅",
        isCampaign = true,
        campaignRawText = "제목 필수 키워드: 서초 돈가스",
        sortByTakenAt = true,
        photos = listOf(
            PostPhoto("p1", "content://media/picker/0/1", originalIndex = 0, postOrder = 1, takenAt = 5L, mimeType = "image/heic"),
            PostPhoto("p2", "content://media/picker/0/2", originalIndex = 1, postOrder = 0),
        ),
    )

    @Test
    fun draftRoundTrip() {
        val json = AppJson.encodeToString(PostDraft.serializer(), draft)
        assertEquals(draft, AppJson.decodeFromString<PostDraft>(json))
    }

    @Test
    fun unknownFieldsFromNewerVersionsAreIgnored() {
        val json = """{"id":"d2","createdAt":1,"updatedAt":2,"result":{"titles":["a"]},
            "photos":[{"id":"p","originalUri":"u","originalIndex":0,"postOrder":0,"analysis":{"type":"food"}}]}"""
        val decoded = AppJson.decodeFromString<PostDraft>(json)
        assertEquals("d2", decoded.id)
        assertEquals(Category.RESTAURANT, decoded.category)
        assertEquals(1, decoded.photos.size)
        assertNull(decoded.photos[0].takenAt)
    }

    @Test
    fun styleProfileRoundTrip() {
        val profile = StyleProfile(endings = "~했어요", avoidPhrases = "존맛탱", updatedAt = 3L)
        val json = AppJson.encodeToString(StyleProfile.serializer(), profile)
        assertEquals(profile, AppJson.decodeFromString<StyleProfile>(json))
    }
}
