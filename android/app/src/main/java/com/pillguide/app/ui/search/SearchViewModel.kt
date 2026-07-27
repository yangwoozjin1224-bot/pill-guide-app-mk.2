package com.pillguide.app.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pillguide.app.data.model.PillCandidate
import com.pillguide.app.repository.PillRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<PillCandidate> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val pillRepository: PillRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    val categories = listOf(
        "가려움" to "가려움 / 물집",
        "두통" to "두통 / 치통",
        "설사" to "설사통 / 통증",
        "소화불량" to "소화불량 / 위통",
        "감기" to "감기 / 몸살",
        "알레르기" to "알레르기",
        "항생제" to "항생제",
        "혈압" to "혈압",
        "당뇨" to "당뇨",
        "수면" to "수면",
        "진통" to "진통 / 해열",
    )

    fun onQueryChange(q: String) = _state.update { it.copy(query = q) }

    fun search(q: String = _state.value.query) {
        val query = q.trim()
        if (query.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null, query = query) }
            runCatching { pillRepository.searchByName(query) }
                .onSuccess { list ->
                    _state.update { it.copy(loading = false, results = list, error = if (list.isEmpty()) "검색 결과가 없습니다" else null) }
                }
                .onFailure { e ->
                    _state.update { it.copy(loading = false, error = e.message ?: "검색 실패") }
                }
        }
    }
}
