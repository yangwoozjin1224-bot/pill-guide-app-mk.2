package com.pillguide.app.camera

import android.graphics.Bitmap
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView

@Composable
fun CameraPreview(
    modifier: Modifier = Modifier,
    torchEnabled: Boolean = false,
    onPreviewReady: (PreviewView, CameraController) -> Unit = { _, _ -> },
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val controller = remember { CameraController(context) }

    DisposableEffect(lifecycleOwner, torchEnabled) {
        onDispose {
            controller.unbind()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            PreviewView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                scaleType = PreviewView.ScaleType.FILL_CENTER
                controller.bind(lifecycleOwner, this, enableAnalysis = false)
                controller.setTorch(torchEnabled)
                onPreviewReady(this, controller)
            }
        },
        update = {
            controller.setTorch(torchEnabled)
        },
    )
}

fun PreviewView.snapshotBitmap(): Bitmap? = bitmap
