package com.pillguide.app.data.remote

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import retrofit2.http.GET
import retrofit2.http.Query
import retrofit2.http.QueryMap

/**
 * 공공데이터포털 data.go.kr APIs used by the web app.
 * Prefer calling via a backend proxy in production; service key is injected for MVP.
 */
interface DataGoApi {
    @GET("1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03")
    suspend fun identifyPill(@QueryMap query: Map<String, String>): DataGoResponse<PillIdItem>

    @GET("1471000/DrbEasyDrugInfoService/getDrbEasyDrugList")
    suspend fun easyDrug(@QueryMap query: Map<String, String>): DataGoResponse<EasyDrugItem>

    @GET("1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03")
    suspend fun durInfo(@QueryMap query: Map<String, String>): DataGoResponse<DurItem>
}

/** Future server-side YOLO / Vision Search / PaddleOCR gateway */
interface AiServerApi {
    @GET("v1/health")
    suspend fun health(): Map<String, String>
}

@JsonClass(generateAdapter = true)
data class DataGoResponse<T>(
    val header: DataGoHeader? = null,
    val body: DataGoBody<T>? = null,
)

@JsonClass(generateAdapter = true)
data class DataGoHeader(
    val resultCode: String? = null,
    val resultMsg: String? = null,
)

@JsonClass(generateAdapter = true)
data class DataGoBody<T>(
    val items: Any? = null, // object or array
    val totalCount: Int? = null,
    val pageNo: Int? = null,
    val numOfRows: Int? = null,
)

@JsonClass(generateAdapter = true)
data class PillIdItem(
    @Json(name = "ITEM_SEQ") val itemSeq: String? = null,
    @Json(name = "ITEM_NAME") val itemName: String? = null,
    @Json(name = "ENTP_NAME") val entpName: String? = null,
    @Json(name = "ITEM_IMAGE") val itemImage: String? = null,
    @Json(name = "CLASS_NAME") val className: String? = null,
    @Json(name = "PRINT_FRONT") val printFront: String? = null,
    @Json(name = "PRINT_BACK") val printBack: String? = null,
    @Json(name = "DRUG_SHAPE") val drugShape: String? = null,
    @Json(name = "COLOR_CLASS1") val colorClass1: String? = null,
)

@JsonClass(generateAdapter = true)
data class EasyDrugItem(
    val itemSeq: String? = null,
    val itemName: String? = null,
    val entpName: String? = null,
    val efcyQesitm: String? = null,
    val useMethodQesitm: String? = null,
    val atpnWarnQesitm: String? = null,
    val atpnQesitm: String? = null,
    val itemImage: String? = null,
)

@JsonClass(generateAdapter = true)
data class DurItem(
    @Json(name = "MIXTURE_ITEM_NAME") val mixtureItemName: String? = null,
    @Json(name = "PROHBT_CONTENT") val prohibitContent: String? = null,
)
