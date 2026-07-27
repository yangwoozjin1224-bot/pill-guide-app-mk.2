package com.pillguide.app.ai

import android.graphics.Bitmap
import android.graphics.Rect
import com.pillguide.app.data.model.DetectedPillBox
import com.pillguide.app.data.model.PillRecognitionResult
import com.pillguide.app.ocr.OcrEngine
import com.pillguide.app.ocr.OcrResult
import com.pillguide.app.repository.BagSessionRepository
import com.pillguide.app.repository.PillRepository
import com.pillguide.app.repository.ScheduleRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Android Vision pipeline:
 * YOLO/classical Detection → Crop(+margin) → OCR → DB search → results
 */
@Singleton
class PillVisionPipeline @Inject constructor(
    private val detector: PillDetector,
    private val ocrEngine: OcrEngine,
    private val pillRepository: PillRepository,
    private val scheduleRepository: ScheduleRepository,
    private val bagSessionRepository: BagSessionRepository,
) {
    suspend fun recognize(bitmap: Bitmap): PillRecognitionResult = withContext(Dispatchers.Default) {
        val detections = detector.detect(bitmap)
        if (detections.isEmpty()) {
            return@withContext PillRecognitionResult(emptyList(), debugMessage = "no_detection")
        }

        val boxes = detections.map {
            DetectedPillBox(it.box.left, it.box.top, it.box.width(), it.box.height(), it.confidence)
        }

        val scheduleSeqs = scheduleRepository.currentItemSeqs()
        val bagHints = bagSessionRepository.drugNameHints()
        val marks = mutableListOf<String>()
        val pills = linkedMapOf<String, com.pillguide.app.data.model.Pill>()

        for (det in detections.take(6)) {
            val crop = cropWithMargin(bitmap, det.box.left, det.box.top, det.box.right, det.box.bottom, 0.15f)
                ?: continue
            val ocr: OcrResult = ocrEngine.recognizeLatinImprint(crop)
            val mark = ocr.text.uppercase().replace(Regex("[^A-Z0-9]"), "")
            if (mark.length >= 2) marks += mark

            val byMark = if (mark.length >= 2) {
                pillRepository.fetchByMark(mark, scheduleSeqs = scheduleSeqs)
            } else null

            if (byMark != null) {
                pills.putIfAbsent(byMark.itemSeq, byMark.copy(fusedScore = det.confidence))
                continue
            }

            // Bag cross-check: boost name search when bag OCR named a drug
            for (hint in bagHints.take(3)) {
                val candidates = pillRepository.fetchTopCandidates(itemName = hint, topK = 5)
                val top = candidates.firstOrNull() ?: continue
                val detail = pillRepository.fetchDetail(top.itemSeq, top.name, scheduleSeqs)
                pills.putIfAbsent(detail.itemSeq, detail.copy(fusedScore = 0.4f))
            }
        }

        PillRecognitionResult(
            pills = pills.values.toList(),
            boxes = boxes,
            marks = marks.distinct(),
            debugMessage = "detector=${detector::class.simpleName} count=${detections.size}",
        )
    }

    private fun cropWithMargin(
        src: Bitmap,
        l: Float,
        t: Float,
        r: Float,
        b: Float,
        margin: Float,
    ): Bitmap? {
        val w = src.width
        val h = src.height
        var left = (l * w).toInt()
        var top = (t * h).toInt()
        var right = (r * w).toInt()
        var bottom = (b * h).toInt()
        val bw = right - left
        val bh = bottom - top
        val mx = (bw * margin).toInt()
        val my = (bh * margin).toInt()
        left = (left - mx).coerceAtLeast(0)
        top = (top - my).coerceAtLeast(0)
        right = (right + mx).coerceAtMost(w)
        bottom = (bottom + my).coerceAtMost(h)
        if (right - left < 16 || bottom - top < 16) return null
        return Bitmap.createBitmap(src, left, top, right - left, bottom - top)
    }
}
