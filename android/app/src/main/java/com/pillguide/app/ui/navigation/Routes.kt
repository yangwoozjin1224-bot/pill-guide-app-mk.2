package com.pillguide.app.ui.navigation

object Routes {
    const val HOME = "home"
    const val SEARCH = "search"
    const val SCAN = "scan"
    const val DETAIL = "detail/{itemSeq}?source={source}"
    const val MANAGEMENT = "management"
    const val BAG_CAMERA = "bag_camera"

    fun detail(itemSeq: String, source: String = "search") =
        "detail/$itemSeq?source=$source"
}
