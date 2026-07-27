package com.pillguide.app.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

class CameraController(
    private val context: Context,
) {
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var analysis: ImageAnalysis? = null
    private val analyzing = AtomicBoolean(false)

    fun bind(
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView,
        enableAnalysis: Boolean,
        onFrame: ((Bitmap) -> Unit)? = null,
    ) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            provider.unbindAll()

            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            val selector = CameraSelector.DEFAULT_BACK_CAMERA
            val useCases = mutableListOf(preview, imageCapture!!)

            if (enableAnalysis && onFrame != null) {
                analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { analyzer ->
                        analyzer.setAnalyzer(mainExecutor()) { proxy ->
                            if (analyzing.compareAndSet(false, true)) {
                                try {
                                    val bmp = proxy.toBitmapRotated()
                                    if (bmp != null) onFrame(bmp)
                                } finally {
                                    analyzing.set(false)
                                    proxy.close()
                                }
                            } else {
                                proxy.close()
                            }
                        }
                    }
                useCases += analysis!!
            }

            camera = provider.bindToLifecycle(
                lifecycleOwner,
                selector,
                *useCases.toTypedArray(),
            )
            // Enable continuous autofocus via camera control when available
            camera?.cameraControl?.enableTorch(false)
        }, mainExecutor())
    }

    fun setTorch(enabled: Boolean) {
        camera?.cameraControl?.enableTorch(enabled)
    }

    fun unbind() {
        runCatching {
            ProcessCameraProvider.getInstance(context).get().unbindAll()
        }
        camera = null
        imageCapture = null
        analysis = null
    }

    suspend fun takePicture(): Bitmap = suspendCancellableCoroutine { cont ->
        val capture = imageCapture
        if (capture == null) {
            cont.resumeWithException(IllegalStateException("Camera not ready"))
            return@suspendCancellableCoroutine
        }
        capture.takePicture(mainExecutor(), object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                val bmp = image.toBitmapRotated()
                image.close()
                if (bmp != null) cont.resume(bmp)
                else cont.resumeWithException(IllegalStateException("Empty capture"))
            }

            override fun onError(exception: ImageCaptureException) {
                cont.resumeWithException(exception)
            }
        })
    }

    private fun mainExecutor(): Executor = ContextCompat.getMainExecutor(context)
}

fun ImageProxy.toBitmapRotated(): Bitmap? {
    val plane = planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)
    // Preview analysis YUV→Bitmap is non-trivial; for MVP use JPEG capture path primarily.
    // When format is JPEG:
    return try {
        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        val rotation = imageInfo.rotationDegrees.toFloat()
        if (rotation == 0f) bmp
        else {
            val m = Matrix().apply { postRotate(rotation) }
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
    } catch (_: Exception) {
        null
    }
}
