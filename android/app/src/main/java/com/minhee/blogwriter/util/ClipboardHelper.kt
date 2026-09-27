package com.minhee.blogwriter.util

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build

/** text/plain으로만 복사한다. 네이버 에디터에 서식 없이 붙여넣기 위해서다. */
object ClipboardHelper {
    /**
     * 복사에 성공하면 true.
     * Android 13 이상은 시스템이 복사 알림을 보여주므로, 호출한 쪽은 그보다 낮은 버전에서만 안내를 띄우면 된다.
     */
    fun copyPlainText(context: Context, label: String, text: String): Boolean = try {
        val manager = context.getSystemService(ClipboardManager::class.java)
        manager.setPrimaryClip(ClipData.newPlainText(label, text))
        true
    } catch (e: Exception) {
        false
    }

    val systemShowsCopyNotice: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
}
