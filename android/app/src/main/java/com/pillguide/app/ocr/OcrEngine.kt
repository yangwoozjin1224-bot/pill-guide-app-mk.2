package com.pillguide.app.ocr

import android.graphics.Bitmap

data class OcrResult(
    val text: String,
    val confidence: Float = 0f,
)

/**
 * Pluggable OCR: ML Kit (default), PaddleOCR (JNI/server), or Retrofit server OCR.
 */
interface OcrEngine {
    suspend fun recognizeLatinImprint(bitmap: Bitmap): OcrResult
    suspend fun recognizeDocument(bitmap: Bitmap): OcrResult
}
