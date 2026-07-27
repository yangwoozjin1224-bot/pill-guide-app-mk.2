package com.pillguide.app.ai

import android.content.Context
import android.graphics.Bitmap

/**
 * YOLO-based detector placeholder.
 * Place `pill_yolo.onnx` under assets/models/ and wire ONNX Runtime / TFLite here.
 */
class YoloPillDetector(
    private val context: Context,
) : PillDetector {

    companion object {
        const val MODEL_ASSET = "models/pill_yolo.onnx"
    }

    override fun isModelAvailable(): Boolean =
        runCatching {
            context.assets.open(MODEL_ASSET).use { true }
        }.getOrDefault(false)

    override suspend fun detect(bitmap: Bitmap): List<PillDetection> {
        if (!isModelAvailable()) return emptyList()
        // TODO: ONNX Runtime inference
        return emptyList()
    }
}
