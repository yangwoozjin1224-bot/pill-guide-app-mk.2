package com.pillguide.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pillguide.app.data.model.Pill
import com.pillguide.app.repository.ScheduleRepository
import com.pillguide.app.utils.TtsHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    scheduleRepository: ScheduleRepository,
    private val tts: TtsHelper,
) : ViewModel() {
    val schedule: StateFlow<List<Pill>> = scheduleRepository.observeSchedule()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun speakWelcome() {
        tts.speak("필가이드입니다. 약을 촬영하거나 검색할 수 있습니다.")
    }
}
