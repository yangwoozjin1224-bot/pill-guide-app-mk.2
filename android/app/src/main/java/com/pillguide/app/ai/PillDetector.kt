package com.pillguide.app.ai

import android.graphics.Bitmap
import android.graphics.RectF

data class PillDetection(
    val box: RectF, // normalized 0..1
    val confidence: Float,
    val classId: Int = 0,
)

/**
 * YOLO / instance-seg style detector interface.
 * Swap ClassicalPillDetector ↔ YoloPillDetector (ONNX) ↔ server detector.
 */
interface PillDetector {
    suspend fun detect(bitmap: Bitmap): List<PillDetection>
    fun isModelAvailable(): Boolean = true
}
