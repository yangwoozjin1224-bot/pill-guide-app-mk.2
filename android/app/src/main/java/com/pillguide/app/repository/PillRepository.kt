package com.pillguide.app.repository

import com.pillguide.app.data.model.Pill
import com.pillguide.app.data.model.PillCandidate
import com.pillguide.app.data.remote.DataGoApi
import com.pillguide.app.data.remote.EasyDrugItem
import com.pillguide.app.data.remote.PillIdItem
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max

@Singleton
class PillRepository @Inject constructor(
    private val api: DataGoApi,
    private val moshi: Moshi,
) {
    suspend fun searchByName(query: String): List<PillCandidate> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val map = linkedMapOf<String, PillCandidate>()

        runCatching {
            val easy = api.easyDrug(
                mapOf(
                    "numOfRows" to "30",
                    "pageNo" to "1",
                    "itemName" to q,
                )
            )
            parseItems<EasyDrugItem>(easy.body?.items).forEach { it ->
                val id = it.itemSeq.orEmpty()
                if (id.isNotEmpty()) {
                    map[id] = PillCandidate(
                        itemSeq = id,
                        name = it.itemName ?: "이름 없음",
                        entpName = it.entpName.orEmpty(),
                        imageUrl = it.itemImage.orEmpty(),
                        tag = "의약품",
                    )
                }
            }
        }

        runCatching {
            val idnt = api.identifyPill(
                mapOf(
                    "numOfRows" to "30",
                    "pageNo" to "1",
                    "item_name" to q,
                )
            )
            parseItems<PillIdItem>(idnt.body?.items).forEach { it ->
                val id = it.itemSeq.orEmpty()
                if (id.isEmpty()) return@forEach
                val prev = map[id]
                map[id] = PillCandidate(
                    itemSeq = id,
                    name = it.itemName ?: prev?.name ?: "이름 없음",
                    entpName = it.entpName ?: prev?.entpName.orEmpty(),
                    imageUrl = it.itemImage ?: prev?.imageUrl.orEmpty(),
                    tag = it.className ?: prev?.tag ?: "의약품",
                    mark = it.printFront.orEmpty(),
                    printBack = it.printBack.orEmpty(),
                    shape = it.drugShape.orEmpty(),
                    color = it.colorClass1.orEmpty(),
                )
            }
        }

        return map.values.toList()
    }

    suspend fun fetchTopCandidates(
        mark: String? = null,
        color: String? = null,
        shape: String? = null,
        itemName: String? = null,
        topK: Int = 10,
    ): List<PillCandidate> {
        val marks = buildList {
            mark?.uppercase()?.replace(Regex("[^A-Z0-9]"), "")?.takeIf { it.length >= 2 }?.let { add(it) }
        }.distinct().take(4)
        if (marks.isEmpty() && itemName.isNullOrBlank()) return emptyList()

        val map = linkedMapOf<String, PillCandidate>()
        suspend fun pull(query: Map<String, String>) {
            runCatching {
                val res = api.identifyPill(query + mapOf("numOfRows" to "15", "pageNo" to "1"))
                parseItems<PillIdItem>(res.body?.items).forEach { it ->
                    val id = it.itemSeq.orEmpty()
                    if (id.isEmpty() || map.containsKey(id)) return@forEach
                    map[id] = PillCandidate(
                        itemSeq = id,
                        name = it.itemName.orEmpty(),
                        entpName = it.entpName.orEmpty(),
                        imageUrl = it.itemImage.orEmpty(),
                        tag = it.className ?: "의약품",
                        mark = it.printFront.orEmpty(),
                        printBack = it.printBack.orEmpty(),
                        shape = it.drugShape.orEmpty(),
                        color = it.colorClass1.orEmpty(),
                    )
                }
            }
        }

        for (m in marks) {
            pull(buildMap {
                put("print_front", m)
                color?.takeIf { it.isNotBlank() }?.let { put("color_class1", it) }
            })
            pull(mapOf("print_front" to m))
        }
        itemName?.takeIf { it.isNotBlank() }?.let { name ->
            pull(mapOf("item_name" to name))
            searchByName(name).forEach { map.putIfAbsent(it.itemSeq, it) }
        }
        return map.values.take(max(topK, 10))
    }

    suspend fun fetchDetail(
        itemSeq: String,
        nameHint: String = "",
        currentItemSeqs: List<String> = emptyList(),
    ): Pill {
        val easy = runCatching {
            api.easyDrug(
                buildMap {
                    put("numOfRows", "1")
                    put("pageNo", "1")
                    put("itemSeq", itemSeq)
                    if (nameHint.isNotBlank()) put("itemName", nameHint)
                }
            ).body?.items.let { parseItems<EasyDrugItem>(it).firstOrNull() }
        }.getOrNull()

        val idnt = runCatching {
            api.identifyPill(
                mapOf("numOfRows" to "1", "pageNo" to "1", "item_seq" to itemSeq)
            ).body?.items.let { parseItems<PillIdItem>(it).firstOrNull() }
        }.getOrNull()

        val durMsg = if (currentItemSeqs.isEmpty()) null else runCatching {
            val items = parseItems<com.pillguide.app.data.remote.DurItem>(
                api.durInfo(
                    mapOf(
                        "itemSeq" to itemSeq,
                        "itemSeqs" to currentItemSeqs.joinToString(","),
                        "numOfRows" to "20",
                        "pageNo" to "1",
                    )
                ).body?.items
            )
            items.mapNotNull {
                when {
                    !it.mixtureItemName.isNullOrBlank() -> "${it.mixtureItemName}와(과) 병용 주의"
                    !it.prohibitContent.isNullOrBlank() -> it.prohibitContent
                    else -> null
                }
            }.joinToString(" · ").ifBlank { null }
        }.getOrNull()

        val cautionBase = easy?.atpnWarnQesitm ?: easy?.atpnQesitm ?: "주의사항 정보 없음"
        return Pill(
            id = itemSeq,
            itemSeq = itemSeq,
            name = idnt?.itemName ?: easy?.itemName ?: nameHint.ifBlank { "알약" },
            tag = idnt?.className ?: "의약품",
            time = "처방 정보 확인",
            timing = easy?.useMethodQesitm ?: "복용법 정보 없음",
            effect = easy?.efcyQesitm ?: idnt?.className ?: "정보 없음",
            caution = if (durMsg != null) "$cautionBase · [병용주의] $durMsg" else cautionBase,
            durWarning = durMsg,
            imageUrl = idnt?.itemImage ?: easy?.itemImage.orEmpty(),
            entpName = idnt?.entpName ?: easy?.entpName.orEmpty(),
            mark = idnt?.printFront.orEmpty(),
            shape = idnt?.drugShape.orEmpty(),
            color = idnt?.colorClass1.orEmpty(),
        )
    }

    suspend fun fetchByMark(mark: String, color: String? = null, scheduleSeqs: List<String> = emptyList()): Pill? {
        val clean = mark.uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (clean.length < 2) return null
        val candidates = fetchTopCandidates(mark = clean, color = color, topK = 10)
        val best = candidates.maxByOrNull { scoreMark(clean, it) } ?: return null
        if (scoreMark(clean, best) < 30) return null
        return fetchDetail(best.itemSeq, best.name, scheduleSeqs).copy(detectedMark = clean)
    }

    private fun scoreMark(mark: String, c: PillCandidate): Int {
        val front = c.mark.uppercase().replace(Regex("[^A-Z0-9]"), "")
        val back = c.printBack.uppercase().replace(Regex("[^A-Z0-9]"), "")
        var score = 0
        if (front == mark || back == mark) score += 100
        else if (front.contains(mark) || mark.contains(front) || back.contains(mark)) score += 50
        return score
    }

    private inline fun <reified T> parseItems(items: Any?): List<T> {
        if (items == null) return emptyList()
        val adapter = moshi.adapter(T::class.java)
        val listType = Types.newParameterizedType(List::class.java, T::class.java)
        val listAdapter = moshi.adapter<List<T>>(listType)
        return try {
            when (items) {
                is List<*> -> listAdapter.fromJson(moshi.adapter(Any::class.java).toJson(items)) ?: emptyList()
                else -> listOfNotNull(adapter.fromJson(moshi.adapter(Any::class.java).toJson(items)))
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
