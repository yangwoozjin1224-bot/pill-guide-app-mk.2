package com.pillguide.app.utils

import com.pillguide.app.data.model.BagStructured
import com.pillguide.app.data.model.DoseInfo
import com.pillguide.app.data.model.FrequencyInfo

object BagTextParser {
    fun parse(ocrText: String): BagStructured {
        val text = ocrText
        val names = mutableListOf<String>()
        val formRe =
            Regex("([가-힣A-Za-z][가-힣A-Za-z0-9]{0,24}(?:정|캡슐|연질캡슐|서방정|필름코팅정|시럽|산|액))")
        formRe.findAll(text).forEach { names += it.groupValues[1].replace("\\s".toRegex(), "") }

        val doses = mutableListOf<DoseInfo>()
        Regex("(\\d+(?:\\.\\d+)?)\\s*(mg|MG|g|밀리그람|밀리그램)").findAll(text).forEach {
            doses += DoseInfo(it.groupValues[1].toDouble(), "mg", it.value)
        }

        val freqs = mutableListOf<FrequencyInfo>()
        Regex("1일\\s*(\\d+)\\s*회|하루\\s*(\\d+)\\s*번").findAll(text).forEach {
            val n = (it.groupValues[1].ifBlank { it.groupValues[2] }).toIntOrNull() ?: return@forEach
            freqs += FrequencyInfo(n, it.value)
        }

        val times = mutableListOf<String>()
        if (Regex("아침|조\\s*식").containsMatchIn(text)) times += "아침"
        if (Regex("점심|중\\s*식").containsMatchIn(text)) times += "점심"
        if (Regex("저녁|석\\s*식").containsMatchIn(text)) times += "저녁"
        if (Regex("취침").containsMatchIn(text)) times += "취침전"

        return BagStructured(
            drugNames = names.distinct().take(12),
            doses = doses,
            frequencies = freqs,
            times = times.distinct(),
            rawText = text,
        )
    }
}
