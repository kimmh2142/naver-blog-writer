package com.minhee.blogwriter.data

import com.minhee.blogwriter.data.model.PostDraft
import com.minhee.blogwriter.data.model.PostPhoto
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DraftRepositoryTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun draft(id: String, uri: String? = null) = PostDraft(
        id = id,
        createdAt = 1L,
        updatedAt = 1L,
        subjectName = "대상 $id",
        photos = listOfNotNull(uri?.let { PostPhoto("p-$id", it, 0, 0) }),
    )

    @Test
    fun savedDraftsSurviveNewRepositoryInstance() = runTest {
        val dir = tmp.newFolder("drafts")
        val io = StandardTestDispatcher(testScheduler)
        DraftRepository(dir, io).save(draft("a"))

        val reopened = DraftRepository(dir, io)
        assertEquals("대상 a", reopened.get("a")?.subjectName)
    }

    @Test
    fun deleteRemovesFileAndReturnsDraft() = runTest {
        val dir = tmp.newFolder("drafts")
        val repo = DraftRepository(dir, StandardTestDispatcher(testScheduler))
        repo.save(draft("a"))

        assertEquals("a", repo.delete("a")?.id)
        assertNull(repo.get("a"))
        assertFalse(File(dir, "a.json").exists())
        assertNull(repo.delete("a"))
    }

    @Test
    fun corruptFileIsSkippedInsteadOfBreakingTheList() = runTest {
        val dir = tmp.newFolder("drafts")
        File(dir, "broken.json").writeText("{not json")
        val repo = DraftRepository(dir, StandardTestDispatcher(testScheduler))
        repo.save(draft("ok"))

        repo.ensureLoaded()
        assertEquals(listOf("ok"), repo.drafts.first().map { it.id })
    }

    @Test
    fun uriUsageIgnoresTheGivenDraft() = runTest {
        val repo = DraftRepository(tmp.newFolder("drafts"), StandardTestDispatcher(testScheduler))
        repo.save(draft("a", uri = "content://x/1"))
        repo.save(draft("b", uri = "content://x/2"))

        assertTrue(repo.isUriUsed("content://x/1"))
        assertFalse(repo.isUriUsed("content://x/1", exceptDraftId = "a"))
        assertFalse(repo.isUriUsed("content://x/3"))
    }
}
