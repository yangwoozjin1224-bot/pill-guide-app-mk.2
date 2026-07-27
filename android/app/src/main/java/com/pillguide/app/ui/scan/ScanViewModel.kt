package com.pillguide.app.ui.scan

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pillguide.app.ai.PillVisionPipeline
import com.pillguide.app.data.model.DetectedPillBox
import com.pillguide.app.data.model.Pill
import com.pillguide.app.data.model.ScanStatus
import com.pillguide.app.repository.PillRepository
import com.pillguide.app.repository.ScheduleRepository
import com.pillguide.app.utils.HapticHelper
import com.pillguide.app.utils.ImageUtils
import com.pillguide.app.utils.TtsHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ScanUiState(
    val status: ScanStatus = ScanStatus.Preview,
    val boxes: List<DetectedPillBox> = emptyList(),
    val marks: List<String> = emptyList(),
    val results: List<Pill> = emptyList(),
    val error: String? = null,
    val torch: Boolean = false,
    val manualMark: String = "",
    val debug: Boolean = false,
)

@HiltViewModel
class ScanViewModel @Inject constructor(
    private val pipeline: PillVisionPipeline,
    private val pillRepository: PillRepository,
    private val scheduleRepository: ScheduleRepository,
    private val tts: TtsHelper,
    private val haptics: HapticHelper,
) : ViewModel() {
    private val _state = MutableStateFlow(ScanUiState())
    val state: StateFlow<ScanUiState> = _state.asStateFlow()

    private var loopJob: Job? = null
    private var frameProvider: (() -> Bitmap?)? = null
    private var busy = false

    fun setFrameProvider(provider: () -> Bitmap?) {
        frameProvider = provider
    }

    fun toggleTorch() = _state.update { it.copy(torch = !it.torch) }
    fun toggleDebug() = _state.update { it.copy(debug = !it.debug) }
    fun onManualMark(v: String) = _state.update { it.copy(manualMark = v) }

    fun startLoop() {
        if (loopJob?.isActive == true) return
        _state.update { it.copy(status = ScanStatus.Scanning, error = null, results = emptyList()) }
        loopJob = viewModelScope.launch {
            var empty = 0
            var tries = 0
            while (isActive) {
                if (busy) {
                    delay(200)
                    continue
                }
                val raw = frameProvider?.invoke()
                if (raw == null) {
                    delay(200)
                    continue
                }
                tries++
                busy = true
                try {
                    val frame = ImageUtils.centerCropSquare(raw, 960)
                    val result = pipeline.recognize(frame)
                    _state.update {
                        it.copy(
                            boxes = result.boxes,
                            marks = result.marks,
                        )
                    }
                    if (result.pills.isNotEmpty()) {
                        haptics.tick()
                        _state.update {
                            it.copy(
                                status = if (result.pills.size == 1) ScanStatus.Loading else ScanStatus.Results,
                                results = result.pills,
                            )
                        }
                        if (result.pills.size == 1) {
                            // keep loading briefly then UI navigates via results
                            _state.update { it.copy(status = ScanStatus.Results) }
                        }
                        stopLoop()
                        return@launch
                    }
                    empty++
                    if (empty >= 10 || tries >= 16) {
                        _state.update {
                            it.copy(
                                status = ScanStatus.Error,
                                error = "알약 각인을 읽지 못했습니다. 표기를 직접 입력해 주세요.",
                            )
                        }
                        stopLoop()
                        return@launch
                    }
                } catch (e: Exception) {
                    // keep looping
                } finally {
                    busy = false
                }
                delay(350)
            }
        }
    }

    fun stopLoop() {
        loopJob?.cancel()
        loopJob = null
        busy = false
    }

    fun resume() {
        stopLoop()
        _state.update {
            ScanUiState(torch = it.torch, debug = it.debug)
        }
        startLoop()
    }

    fun searchManual() {
        val mark = _state.value.manualMark.trim()
        if (mark.length < 2) return
        viewModelScope.launch {
            _state.update { it.copy(status = ScanStatus.Loading, error = null) }
            val seqs = scheduleRepository.currentItemSeqs()
            val pill = pillRepository.fetchByMark(mark, scheduleSeqs = seqs)
            if (pill == null) {
                _state.update {
                    it.copy(status = ScanStatus.Error, error = "표기에 맞는 약을 찾지 못했습니다.")
                }
            } else {
                haptics.tick()
                tts.speakPill(pill.name, pill.tag, pill.timing)
                _state.update { it.copy(status = ScanStatus.Results, results = listOf(pill)) }
            }
        }
    }

    fun recognizeBitmap(raw: Bitmap) {
        stopLoop()
        viewModelScope.launch {
            _state.update { it.copy(status = ScanStatus.Loading, error = null) }
            runCatching {
                pipeline.recognize(ImageUtils.centerCropSquare(raw, 960))
            }.onSuccess { result ->
                if (result.pills.isEmpty()) {
                    _state.update {
                        it.copy(
                            status = ScanStatus.Error,
                            boxes = result.boxes,
                            marks = result.marks,
                            error = "사진에서 약을 찾지 못했습니다.",
                        )
                    }
                } else {
                    haptics.tick()
                    _state.update {
                        it.copy(
                            status = ScanStatus.Results,
                            results = result.pills,
                            boxes = result.boxes,
                            marks = result.marks,
                        )
                    }
                }
            }.onFailure { e ->
                _state.update {
                    it.copy(status = ScanStatus.Error, error = e.message ?: "인식 실패")
                }
            }
        }
    }

    override fun onCleared() {
        stopLoop()
        super.onCleared()
    }
}
