package com.pillguide.app.ocr

import android.graphics.Bitmap
import android.util.Base64
import com.pillguide.app.data.remote.AiServerApi
import java.io.ByteArrayOutputStream

/** Server OCR / PaddleOCR gateway stub. */
class ServerOcrEngine(
    private val api: AiServerApi,
) : OcrEngine {

    override suspend fun recognizeLatinImprint(bitmap: Bitmap): OcrResult {
        runCatching { api.health() }
        return OcrResult(text = "", confidence = 0f)
    }

    override suspend fun recognizeDocument(bitmap: Bitmap): OcrResult {
        runCatching { api.health() }
        return OcrResult(text = "", confidence = 0f)
    }

    @Suppress("unused")
    private fun Bitmap.toBase64Jpeg(): String {
        val out = ByteArrayOutputStream()
        compress(Bitmap.CompressFormat.JPEG, 85, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}

/** On-device PaddleOCR placeholder (native .so / NNAPI later). */
class PaddleOcrEngine : OcrEngine {
    override suspend fun recognizeLatinImprint(bitmap: Bitmap): OcrResult = OcrResult("", 0f)
    override suspend fun recognizeDocument(bitmap: Bitmap): OcrResult = OcrResult("", 0f)
}
