package com.pillguide.app.ai

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RectF
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Lightweight classical detector used until YOLO weights are shipped.
 * Finds blob-like regions that differ from border-estimated background.
 */
class ClassicalPillDetector : PillDetector {

    override suspend fun detect(bitmap: Bitmap): List<PillDetection> = withContext(Dispatchers.Default) {
        val w = 160
        val h = 160
        val scaled = Bitmap.createScaledBitmap(bitmap, w, h, true)
        val pixels = IntArray(w * h)
        scaled.getPixels(pixels, 0, w, 0, 0, w, h)

        var br = 0.0
        var bg = 0.0
        var bb = 0.0
        var bn = 0
        fun sample(x: Int, y: Int) {
            val c = pixels[y * w + x]
            br += Color.red(c)
            bg += Color.green(c)
            bb += Color.blue(c)
            bn++
        }
        for (x in 0 until w step 2) {
            sample(x, 0); sample(x, h - 1)
        }
        for (y in 0 until h step 2) {
            sample(0, y); sample(w - 1, y)
        }
        br /= bn; bg /= bn; bb /= bn

        val mask = BooleanArray(w * h)
        for (y in 2 until h - 2) {
            for (x in 2 until w - 2) {
                val c = pixels[y * w + x]
                val r = Color.red(c)
                val g = Color.green(c)
                val b = Color.blue(c)
                val dist = abs(r - br) + abs(g - bg) + abs(b - bb)
                val maxc = max(r, max(g, b)).toFloat()
                val minc = min(r, min(g, b)).toFloat()
                val sat = if (maxc == 0f) 0f else (maxc - minc) / maxc
                if (dist > 55 || (sat > 0.2f && maxc > 90)) mask[y * w + x] = true
            }
        }

        val visited = BooleanArray(w * h)
        val boxes = mutableListOf<PillDetection>()
        val frameArea = w * h.toFloat()

        for (y in 0 until h) {
            for (x in 0 until w) {
                val idx = y * w + x
                if (!mask[idx] || visited[idx]) continue
                var minX = x
                var maxX = x
                var minY = y
                var maxY = y
                var area = 0
                val stack = ArrayDeque<Int>()
                stack.add(idx)
                visited[idx] = true
                while (stack.isNotEmpty()) {
                    val cur = stack.removeLast()
                    val cx = cur % w
                    val cy = cur / w
                    area++
                    minX = min(minX, cx); maxX = max(maxX, cx)
                    minY = min(minY, cy); maxY = max(maxY, cy)
                    for (dy in -1..1) for (dx in -1..1) {
                        if (dx == 0 && dy == 0) continue
                        val nx = cx + dx
                        val ny = cy + dy
                        if (nx !in 0 until w || ny !in 0 until h) continue
                        val nidx = ny * w + nx
                        if (!mask[nidx] || visited[nidx]) continue
                        visited[nidx] = true
                        stack.add(nidx)
                    }
                }
                val bw = maxX - minX + 1
                val bh = maxY - minY + 1
                val ratio = bw / bh.toFloat()
                if (area < frameArea * 0.004f || area > frameArea * 0.4f) continue
                if (ratio > 3.2f || ratio < 0.3f) continue
                if (bw < 10 || bh < 10) continue
                val conf = (0.35f + (area / frameArea).coerceAtMost(0.4f)).coerceIn(0.2f, 0.95f)
                boxes += PillDetection(
                    box = RectF(
                        minX / w.toFloat(),
                        minY / h.toFloat(),
                        (maxX + 1) / w.toFloat(),
                        (maxY + 1) / h.toFloat(),
                    ),
                    confidence = conf,
                )
            }
        }
        boxes.sortedByDescending { it.confidence }.take(8)
    }
}
