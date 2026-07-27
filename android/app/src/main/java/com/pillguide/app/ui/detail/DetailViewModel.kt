package com.pillguide.app.ui.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pillguide.app.data.model.Pill
import com.pillguide.app.repository.PillRepository
import com.pillguide.app.repository.ScheduleRepository
import com.pillguide.app.utils.HapticHelper
import com.pillguide.app.utils.TtsHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DetailUiState(
    val pill: Pill? = null,
    val loading: Boolean = true,
    val registered: Boolean = false,
    val source: String = "search",
    val error: String? = null,
)

@HiltViewModel
class DetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val pillRepository: PillRepository,
    private val scheduleRepository: ScheduleRepository,
    private val tts: TtsHelper,
    private val haptics: HapticHelper,
) : ViewModel() {
    private val itemSeq: String = checkNotNull(savedStateHandle["itemSeq"])
    private val source: String = savedStateHandle["source"] ?: "search"

    private val _state = MutableStateFlow(DetailUiState(source = source))
    val state: StateFlow<DetailUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching {
                pillRepository.fetchDetail(itemSeq, currentItemSeqs = scheduleRepository.currentItemSeqs())
            }.onSuccess { pill ->
                _state.value = DetailUiState(pill = pill, loading = false, source = source)
                if (source == "scan") {
                    tts.speakPill(pill.name, pill.tag, pill.timing)
                }
            }.onFailure { e ->
                _state.value = DetailUiState(loading = false, error = e.message, source = source)
            }
        }
    }

    fun speak() {
        val p = _state.value.pill ?: return
        tts.speakPill(p.name, p.tag, p.timing)
    }

    fun register() {
        val p = _state.value.pill ?: return
        viewModelScope.launch {
            scheduleRepository.add(p)
            haptics.tick()
            if (source == "scan") tts.speak("복용 관리에 등록되었습니다")
            _state.value = _state.value.copy(registered = true)
        }
    }
}
