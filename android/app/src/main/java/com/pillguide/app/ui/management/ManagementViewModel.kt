package com.pillguide.app.ui.management

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pillguide.app.data.model.Pill
import com.pillguide.app.ocr.OcrEngine
import com.pillguide.app.repository.BagSessionRepository
import com.pillguide.app.repository.PillRepository
import com.pillguide.app.repository.ScheduleRepository
import com.pillguide.app.utils.BagTextParser
import com.pillguide.app.utils.HapticHelper
import com.pillguide.app.utils.TtsHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ManagementUiState(
    val processing: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val foundNames: List<String> = emptyList(),
)

@HiltViewModel
class ManagementViewModel @Inject constructor(
    private val scheduleRepository: ScheduleRepository,
    private val pillRepository: PillRepository,
    private val bagSessionRepository: BagSessionRepository,
    private val ocrEngine: OcrEngine,
    private val tts: TtsHelper,
    private val haptics: HapticHelper,
) : ViewModel() {
    val schedule: StateFlow<List<Pill>> = scheduleRepository.observeSchedule()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _ui = MutableStateFlow(ManagementUiState())
    val ui: StateFlow<ManagementUiState> = _ui.asStateFlow()

    fun toggleTaken(id: String, taken: Boolean) {
        viewModelScope.launch { scheduleRepository.setTaken(id, taken) }
    }

    fun processBagPhoto(bitmap: Bitmap) {
        viewModelScope.launch {
            _ui.update { it.copy(processing = true, message = "문서 OCR 중...", error = null) }
            try {
                val ocr = ocrEngine.recognizeDocument(bitmap)
                val structured = BagTextParser.parse(ocr.text).copy(confidence = ocr.confidence)
                bagSessionRepository.set(structured)
                val names = structured.drugNames
                if (names.isEmpty()) {
                    _ui.update {
                        it.copy(processing = false, error = "약 이름을 읽지 못했습니다. 다시 촬영해주세요.")
                    }
                    return@launch
                }
                _ui.update {
                    it.copy(
                        foundNames = names,
                        message = "${names.size}개 약 이름 확인. 정보 조회 중...",
                    )
                }
                var added = 0
                val seqs = scheduleRepository.currentItemSeqs().toMutableList()
                for (name in names.take(8)) {
                    val list = pillRepository.searchByName(name)
                    val top = list.firstOrNull() ?: continue
                    val detail = pillRepository.fetchDetail(top.itemSeq, top.name, seqs)
                    if (scheduleRepository.add(detail)) {
                        added++
                        seqs += detail.itemSeq
                    }
                }
                haptics.tick()
                if (added == 0) {
                    _ui.update {
                        it.copy(processing = false, error = "약은 읽었지만 정보를 찾지 못했습니다.")
                    }
                } else {
                    tts.speak("${added}개 약을 복용 관리에 추가했습니다")
                    _ui.update {
                        it.copy(
                            processing = false,
                            message = "${added}개 약을 복용 관리에 추가했습니다." +
                                (if (structured.times.isNotEmpty()) " · ${structured.times.joinToString()}" else ""),
                        )
                    }
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(processing = false, error = e.message ?: "인식 실패")
                }
            }
        }
    }
}
