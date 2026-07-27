package com.pillguide.app.repository

import com.pillguide.app.data.local.ScheduleDao
import com.pillguide.app.data.local.ScheduleEntity
import com.pillguide.app.data.model.BagStructured
import com.pillguide.app.data.model.Pill
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScheduleRepository @Inject constructor(
    private val dao: ScheduleDao,
) {
    fun observeSchedule(): Flow<List<Pill>> = dao.observeAll().map { list ->
        list.map { it.toPill() }
    }

    suspend fun add(pill: Pill, bagMetaJson: String? = null): Boolean {
        val row = dao.insert(
            ScheduleEntity(
                id = pill.id,
                itemSeq = pill.itemSeq,
                name = pill.name,
                tag = pill.tag,
                time = pill.time,
                timing = pill.timing,
                effect = pill.effect,
                caution = pill.caution,
                durWarning = pill.durWarning,
                imageUrl = pill.imageUrl,
                entpName = pill.entpName,
                bagMetaJson = bagMetaJson,
            )
        )
        return row != -1L
    }

    suspend fun setTaken(id: String, taken: Boolean) = dao.setTaken(id, taken)

    suspend fun currentItemSeqs(): List<String> = dao.getAll().map { it.itemSeq }

    private fun ScheduleEntity.toPill() = Pill(
        id = id,
        itemSeq = itemSeq,
        name = name,
        tag = tag,
        time = time,
        timing = timing,
        effect = effect,
        caution = caution,
        durWarning = durWarning,
        imageUrl = imageUrl,
        entpName = entpName,
    )
}

/** Cross-check hints from the last medicine-bag OCR session (mirrors web session bag context). */
@Singleton
class BagSessionRepository @Inject constructor() {
    private val _structured = MutableStateFlow<BagStructured?>(null)
    val structured: StateFlow<BagStructured?> = _structured.asStateFlow()

    fun set(bag: BagStructured?) {
        _structured.value = bag
    }

    fun drugNameHints(): List<String> = _structured.value?.drugNames.orEmpty()
}
