package com.pillguide.app.ui.management

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.pillguide.app.camera.CameraController
import com.pillguide.app.camera.CameraPreview
import com.pillguide.app.ui.components.BigPrimaryButton
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun BagCameraScreen(
    onBack: () -> Unit,
    vm: ManagementViewModel = hiltViewModel(),
) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)
    var controller by remember { mutableStateOf<CameraController?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(
                title = { Text("처방전 / 약봉지 촬영", color = Color.White) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "뒤로", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Black),
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (cameraPermission.status.isGranted) {
                CameraPreview(
                    modifier = Modifier.fillMaxSize(),
                    onPreviewReady = { _, c -> controller = c },
                )
            } else {
                Text(
                    "카메라 권한이 필요합니다",
                    color = Color.White,
                    modifier = Modifier.align(Alignment.Center),
                )
                // request once
                cameraPermission.launchPermissionRequest()
            }

            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
            ) {
                when {
                    ui.processing -> {
                        CircularProgressIndicator(Modifier = Modifier.align(Alignment.CenterHorizontally))
                        Text(ui.message ?: "처리 중...", color = Color.White)
                    }
                    ui.message != null || ui.error != null -> {
                        Text(ui.message ?: ui.error.orEmpty(), color = Color.White)
                        BigPrimaryButton("복용 관리로 돌아가기", onClick = onBack)
                    }
                    else -> {
                        Text("처방전/약봉지를 맞춘 뒤 촬영하세요", color = Color.White)
                        BigPrimaryButton(
                            text = "촬영하기",
                            onClick = {
                                scope.launch {
                                    val bmp = controller?.takePicture() ?: return@launch
                                    vm.processBagPhoto(bmp)
                                }
                            },
                            contentDescription = "사진 촬영",
                        )
                    }
                }
            }
        }
    }
}
