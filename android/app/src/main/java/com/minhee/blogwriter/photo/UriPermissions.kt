package com.minhee.blogwriter.photo

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.util.Log

/**
 * Photo Picker로 받은 URI는 기본적으로 앱이 살아 있는 동안만 읽을 수 있다.
 * 작성 건을 다시 열 때도 원본을 읽을 수 있도록 영구 읽기 권한을 받아 둔다.
 */
class UriPermissions(private val resolver: ContentResolver) {

    /** 실패하면 false. 이번 세션에서는 계속 읽을 수 있지만 앱 재시작 후에는 못 읽을 수 있다. */
    fun take(uri: Uri): Boolean = try {
        resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        true
    } catch (e: SecurityException) {
        Log.w(TAG, "영구 읽기 권한을 받지 못함: $uri", e)
        false
    }

    fun release(uri: String) {
        try {
            resolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            // 애초에 권한이 없었던 URI. 할 일 없음.
        }
    }

    private companion object {
        const val TAG = "UriPermissions"
    }
}
