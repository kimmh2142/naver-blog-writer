package com.minhee.blogwriter.photo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoHelpersTest {

    @Test
    fun targetSizeShrinksLongEdgeKeepingRatio() {
        assertEquals(1280 to 960, AiImagePreparer.targetSize(4032, 3024, 1280))
        assertEquals(960 to 1280, AiImagePreparer.targetSize(3024, 4032, 1280))
        assertEquals(1280 to 1280, AiImagePreparer.targetSize(3000, 3000, 1280))
    }

    @Test
    fun targetSizeNeverUpscales() {
        assertEquals(800 to 600, AiImagePreparer.targetSize(800, 600, 1280))
        assertEquals(1280 to 720, AiImagePreparer.targetSize(1280, 720, 1280))
    }

    @Test
    fun targetSizeKeepsAtLeastOnePixel() {
        assertEquals(1280 to 1, AiImagePreparer.targetSize(20000, 2, 1280))
    }

    @Test
    fun jpegSignatureIsDetectedRegardlessOfOriginalFormat() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())
        val gif = "GIF89a".toByteArray()

        assertTrue(AiImagePreparer.isJpeg(jpeg))
        assertFalse(AiImagePreparer.isJpeg(gif))
        assertFalse(AiImagePreparer.isJpeg(byteArrayOf(0xFF.toByte(), 0xD8.toByte())))
    }

    @Test
    fun gifFramesUseTheSameSizeLimitAsPhotos() {
        // GIF 대표 프레임도 일반 사진과 같은 긴 변 제한을 받는다.
        assertEquals(1280 to 720, AiImagePreparer.targetSize(1920, 1080, 1280))
        assertEquals(480 to 270, AiImagePreparer.targetSize(480, 270, 1280))
    }

    @Test
    fun parsesExifDateTimeInOrder() {
        val earlier = PhotoMetadataReader.parseExifDateTime("2026:09:27 12:00:00")!!
        val later = PhotoMetadataReader.parseExifDateTime("2026:09:27 12:00:01")!!
        assertTrue(earlier < later)
    }

    @Test
    fun rejectsEmptyOrInvalidExifDateTime() {
        assertNull(PhotoMetadataReader.parseExifDateTime(""))
        assertNull(PhotoMetadataReader.parseExifDateTime("0000:00:00 00:00:00"))
        assertNull(PhotoMetadataReader.parseExifDateTime("2026-09-27 12:00:00"))
        assertNull(PhotoMetadataReader.parseExifDateTime("2026:13:40 12:00:00"))
    }
}
