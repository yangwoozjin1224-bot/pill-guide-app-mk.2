package com.pillguide.app.utils

import android.graphics.Bitmap
import android.graphics.Matrix

object ImageUtils {
    fun centerCropSquare(src: Bitmap, outSize: Int = 960): Bitmap {
        val size = minOf(src.width, src.height)
        val x = (src.width - size) / 2
        val y = (src.height - size) / 2
        val cropped = Bitmap.createBitmap(src, x, y, size, size)
        return if (cropped.width == outSize) cropped
        else Bitmap.createScaledBitmap(cropped, outSize, outSize, true)
    }

    fun rotate(src: Bitmap, degrees: Float): Bitmap {
        if (degrees % 360f == 0f) return src
        val m = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }
}
