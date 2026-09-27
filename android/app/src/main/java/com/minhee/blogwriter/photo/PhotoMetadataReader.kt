package com.minhee.blogwriter.photo

import android.content.ContentResolver
import android.net.Uri
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * 정렬에 필요한 촬영시간과 MIME 타입만 로컬에서 읽는다.
 * GPS 등 다른 EXIF 값은 읽지 않는다.
 */
class PhotoMetadataReader(private val resolver: ContentResolver) {

    data class Metadata(val mimeType: String?, val takenAt: Long?)

    fun read(uri: Uri): Metadata = Metadata(
        mimeType = runCatching { resolver.getType(uri) }.getOrNull(),
        takenAt = readExifTakenAt(uri) ?: queryDateTaken(uri),
    )

    private fun readExifTakenAt(uri: Uri): Long? = runCatching {
        resolver.openFileDescriptor(uri, "r")?.use { pfd ->
            val exif = ExifInterface(pfd.fileDescriptor)
            (exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
                ?: exif.getAttribute(ExifInterface.TAG_DATETIME))
                ?.let(::parseExifDateTime)
        }
    }.getOrNull()

    private fun queryDateTaken(uri: Uri): Long? = runCatching {
        resolver.query(uri, arrayOf(MediaStore.MediaColumns.DATE_TAKEN), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN)
            if (cursor.moveToFirst() && index >= 0 && !cursor.isNull(index)) cursor.getLong(index) else null
        }
    }.getOrNull()

    companion object {
        /**
         * EXIF "yyyy:MM:dd HH:mm:ss"를 기기 시간대 기준 epoch ms로 바꾼다.
         * 사진끼리 순서만 비교하므로 시간대 오차는 문제 되지 않는다.
         */
        fun parseExifDateTime(value: String): Long? {
            val trimmed = value.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("0000")) return null
            return try {
                SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US)
                    .apply { isLenient = false }
                    .parse(trimmed)
                    ?.time
            } catch (e: ParseException) {
                null
            }
        }
    }
}
