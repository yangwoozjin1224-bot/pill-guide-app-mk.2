package com.pillguide.app.ocr

import android.content.Context
import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await

class MlKitOcrEngine(
    @Suppress("UNUSED_PARAMETER") context: Context,
) : OcrEngine {

    private val latin by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val korean by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    override suspend fun recognizeLatinImprint(bitmap: Bitmap): OcrResult {
        val image = InputImage.fromBitmap(bitmap, 0)
        val result = latin.process(image).await()
        val text = result.textBlocks.joinToString(" ") { it.text }
            .uppercase()
            .replace(Regex("[^A-Z0-9\\s]"), " ")
            .trim()
        val conf = result.textBlocks.mapNotNull { block ->
            block.lines.mapNotNull { it.confidence }.average().takeIf { !it.isNaN() }
        }.average().let { if (it.isNaN()) 0.5f else it.toFloat() }
        return OcrResult(text = text, confidence = conf)
    }

    override suspend fun recognizeDocument(bitmap: Bitmap): OcrResult {
        val image = InputImage.fromBitmap(bitmap, 0)
        val result = korean.process(image).await()
        return OcrResult(text = result.text.orEmpty(), confidence = 0.7f)
    }
}
