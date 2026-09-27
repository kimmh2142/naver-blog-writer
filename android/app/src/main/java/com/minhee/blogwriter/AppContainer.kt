package com.minhee.blogwriter

import android.content.Context
import androidx.datastore.preferences.preferencesDataStore
import com.minhee.blogwriter.data.DraftRepository
import com.minhee.blogwriter.data.GenerationConfig
import com.minhee.blogwriter.data.StyleRepository
import com.minhee.blogwriter.photo.AiImagePreparer
import com.minhee.blogwriter.photo.PhotoMetadataReader
import com.minhee.blogwriter.photo.UriPermissions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

private val Context.styleDataStore by preferencesDataStore(name = "style")

/** 앱 전체에서 하나씩만 쓰는 객체들. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** 화면이 닫힌 뒤에도 끝나야 하는 저장 작업용. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val generationConfig = GenerationConfig.fromBuildConfig()

    val draftRepository = DraftRepository(File(appContext.filesDir, "drafts"))
    val styleRepository = StyleRepository(appContext.styleDataStore)

    val uriPermissions = UriPermissions(appContext.contentResolver)
    val photoMetadataReader = PhotoMetadataReader(appContext.contentResolver)
    val aiImagePreparer = AiImagePreparer(
        resolver = appContext.contentResolver,
        workDir = File(appContext.cacheDir, "ai-images"),
        config = generationConfig,
    )
}
