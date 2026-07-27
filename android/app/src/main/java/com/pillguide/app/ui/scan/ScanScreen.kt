package com.pillguide.app.ui.scan

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.pillguide.app.camera.CameraPreview
import com.pillguide.app.camera.snapshotBitmap
import com.pillguide.app.data.model.ScanStatus
import com.pillguide.app.ui.components.BigPrimaryButton
import com.pillguide.app.ui.theme.PillRed

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun ScanScreen(
    onBack: () -> Unit,
    onOpenPill: (String) -> Unit,
    vm: ScanViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)
    var previewView by remember { mutableStateOf<PreviewView?>(null) }
    val context = LocalContext.current

    val galleryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val bmp = runCatching {
            if (Build.VERSION.SDK_INT >= 28) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri))
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
            }
        }.getOrNull() ?: return@rememberLauncherForActivityResult
        vm.recognizeBitmap(bmp)
    }

    LaunchedEffect(cameraPermission.status.isGranted) {
        if (cameraPermission.status.isGranted) {
            vm.setFrameProvider { previewView?.snapshotBitmap() }
            vm.startLoop()
        } else {
            cameraPermission.launchPermissionRequest()
        }
    }

    DisposableEffect(Unit) {
        onDispose { vm.stopLoop() }
    }

    LaunchedEffect(state.status, state.results) {
        if (state.status == ScanStatus.Results && state.results.size == 1) {
            onOpenPill(state.results.first().itemSeq)
        }
    }

    if (state.status == ScanStatus.Results && state.results.size > 1) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("인식된 알약") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "뒤로")
                        }
                    },
                )
            },
        ) { padding ->
            Column(Modifier.padding(padding).padding(16.dp)) {
                Text("${state.results.size}개를 찾았습니다. 확인할 약을 선택하세요.")
                Spacer(Modifier.height(12.dp))
                state.results.forEach { pill ->
                    BigPrimaryButton(
                        text = pill.name,
                        onClick = { onOpenPill(pill.itemSeq) },
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                BigPrimaryButton(text = "다시 인식하기", onClick = { vm.resume() })
            }
        }
        return
    }

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(
                title = { Text("알약 촬영", color = Color.White) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "뒤로", tint = Color.White)
                    }
                },
                actions = {
                    IconButton(
                        onClick = { galleryLauncher.launch("image/*") },
                        modifier = Modifier,
                    ) {
                        Icon(Icons.Default.PhotoLibrary, contentDescription = "갤러리에서 사진 선택", tint = Color.White)
                    }
                    IconButton(onClick = { vm.toggleTorch() }) {
                        Icon(
                            if (state.torch) Icons.Default.FlashOn else Icons.Default.FlashOff,
                            contentDescription = "플래시",
                            tint = Color.White,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Black),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                if (cameraPermission.status.isGranted) {
                    CameraPreview(
                        modifier = Modifier.fillMaxSize(),
                        torchEnabled = state.torch,
                        onPreviewReady = { view, _ -> previewView = view },
                    )
                } else {
                    Text(
                        "카메라 권한이 필요합니다",
                        color = Color.White,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
                Box(
                    Modifier
                        .size(280.dp)
                        .align(Alignment.Center)
                        .border(3.dp, Color.White.copy(alpha = 0.8f), RoundedCornerShape(24.dp)),
                )
            }

            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            ) {
                when (state.status) {
                    ScanStatus.Error -> {
                        Text(state.error.orEmpty(), color = PillRed)
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.manualMark,
                            onValueChange = vm::onManualMark,
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("표기 입력") },
                            singleLine = true,
                        )
                        Spacer(Modifier.height(8.dp))
                        BigPrimaryButton("입력으로 검색", onClick = { vm.searchManual() })
                        Spacer(Modifier.height(8.dp))
                        BigPrimaryButton("다시 인식하기", onClick = { vm.resume() })
                    }
                    ScanStatus.Loading -> Text("약 정보를 불러오고 있어요", style = MaterialTheme.typography.titleMedium)
                    else -> {
                        Text("알약을 인식하고 있어요", style = MaterialTheme.typography.titleMedium)
                        if (state.marks.isNotEmpty()) {
                            Text("읽은 표기: ${state.marks.joinToString()}", color = Color.Gray)
                        }
                        Text(
                            "알약 글자(각인)가 선명하게 보이도록 가까이 맞춰 주세요",
                            color = Color.Gray,
                        )
                    }
                }
            }
        }
    }
}
