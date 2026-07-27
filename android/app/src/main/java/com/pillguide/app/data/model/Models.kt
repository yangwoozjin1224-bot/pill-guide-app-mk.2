package com.pillguide.app.data.model

data class Pill(
    val id: String,
    val itemSeq: String,
    val name: String,
    val tag: String = "의약품",
    val time: String = "처방 정보 확인",
    val timing: String = "",
    val effect: String = "",
    val caution: String = "",
    val durWarning: String? = null,
    val imageUrl: String = "",
    val entpName: String = "",
    val mark: String = "",
    val shape: String = "",
    val color: String = "",
    val detectedMark: String = "",
    val fusedScore: Float = 0f,
)

data class PillCandidate(
    val itemSeq: String,
    val name: String,
    val entpName: String = "",
    val imageUrl: String = "",
    val tag: String = "의약품",
    val mark: String = "",
    val printBack: String = "",
    val shape: String = "",
    val color: String = "",
    val score: Float = 0f,
)

data class DoseInfo(val value: Double, val unit: String, val raw: String)
data class FrequencyInfo(val perDay: Int, val raw: String)

data class BagStructured(
    val drugNames: List<String> = emptyList(),
    val doses: List<DoseInfo> = emptyList(),
    val frequencies: List<FrequencyInfo> = emptyList(),
    val times: List<String> = emptyList(),
    val rawText: String = "",
    val confidence: Float = 0f,
)

data class DetectedPillBox(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float,
    val confidence: Float,
    val label: String = "pill",
)

data class PillRecognitionResult(
    val pills: List<Pill>,
    val boxes: List<DetectedPillBox> = emptyList(),
    val marks: List<String> = emptyList(),
    val debugMessage: String = "",
)

enum class ScanStatus {
    Idle, Preview, Scanning, Loading, Results, Error
}
