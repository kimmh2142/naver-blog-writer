package com.minhee.blogwriter.photo

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import com.minhee.blogwriter.data.GenerationConfig
import com.minhee.blogwriter.data.model.PostPhoto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * AI 분석용 사본을 만든다. 원본은 건드리지 않는다.
 * - ImageDecoder가 HEIC/HEIF 디코딩과 EXIF 회전을 처리한다.
 * - 애니메이션 GIF/WebP는 decodeBitmap이 첫 프레임만 디코딩한다. 그 한 장을 대표 프레임으로 쓰고
 *   다른 사진과 똑같이 줄여 JPEG로 만든다. 원본 GIF는 건드리지 않는다.
 * - Bitmap.compress는 EXIF를 쓰지 않으므로 결과 JPEG에는 GPS를 포함한 메타데이터가 없다.
 */
class AiImagePreparer(
    private val resolver: ContentResolver,
    private val workDir: File,
    private val config: GenerationConfig,
) {
    data class PreparedImage(
        val photoId: String,
        val file: File,
        val width: Int,
        val height: Int,
        val bytes: Long,
    )

    suspend fun prepare(photo: PostPhoto): PreparedImage = withContext(Dispatchers.IO) {
        val source = ImageDecoder.createSource(resolver, Uri.parse(photo.originalUri))
        val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val (width, height) = targetSize(info.size.width, info.size.height, config.aiImageLongEdgePx)
            decoder.setTargetSize(width, height)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        try {
            workDir.mkdirs()
            val out = File(workDir, "${photo.id}.jpg")
            FileOutputStream(out).use { stream ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, config.aiImageJpegQuality, stream)) {
                    "JPEG 인코딩 실패"
                }
            }
            PreparedImage(photo.id, out, bitmap.width, bitmap.height, out.length())
        } finally {
            bitmap.recycle()
        }
    }

    /** 전송이 끝난 사본을 지운다. */
    fun clear() {
        workDir.deleteRecursively()
    }

    companion object {
        /** 파일 앞부분이 JPEG 시그니처(FF D8 FF)인지. 원본 형식과 상관없이 사본이 JPEG인지 확인할 때 쓴다. */
        fun isJpeg(header: ByteArray): Boolean =
            header.size >= 3 &&
                header[0] == 0xFF.toByte() &&
                header[1] == 0xD8.toByte() &&
                header[2] == 0xFF.toByte()

        /** 긴 변을 longEdge 이하로 줄인 크기. 이미 작으면 키우지 않는다. */
        fun targetSize(width: Int, height: Int, longEdge: Int): Pair<Int, Int> {
            val longest = max(width, height)
            if (longest <= longEdge) return width to height
            val scale = longEdge.toDouble() / longest
            return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
        }
    }
}
