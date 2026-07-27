package com.pillguide.app.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.pillguide.app.ui.components.AppCard
import com.pillguide.app.ui.components.BigPrimaryButton
import com.pillguide.app.ui.theme.PillGray2

@Composable
fun HomeScreen(
    onSearch: () -> Unit,
    onScan: () -> Unit,
    onManagement: () -> Unit,
    onOpenPill: (String) -> Unit,
    vm: HomeViewModel = hiltViewModel(),
) {
    val schedule by vm.schedule.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "안녕하세요",
                style = MaterialTheme.typography.headlineLarge,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { vm.speakWelcome() },
                modifier = Modifier.semantics { contentDescription = "음성 안내" },
            ) {
                Icon(Icons.Default.VolumeUp, contentDescription = null)
            }
        }
        Text("약을 쉽게 찾고 관리하세요", color = PillGray2)
        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = "",
            onValueChange = {},
            readOnly = true,
            enabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onSearch)
                .semantics { contentDescription = "약 검색" },
            placeholder = { Text("약 이름 검색") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            shape = RoundedCornerShape(16.dp),
        )

        Spacer(Modifier.height(16.dp))
        BigPrimaryButton(
            text = "촬영하러 가기",
            onClick = onScan,
            contentDescription = "카메라로 알약 촬영",
        )
        Spacer(Modifier.height(10.dp))
        BigPrimaryButton(
            text = "복용 기록하기",
            onClick = onManagement,
        )

        Spacer(Modifier.height(28.dp))
        Text("자주 먹는 약", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        if (schedule.isEmpty()) {
            Text("등록된 약이 없습니다", color = PillGray2)
        } else {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                schedule.forEach { pill ->
                    AppCard(
                        modifier = Modifier.width(160.dp),
                        onClick = { onOpenPill(pill.itemSeq) },
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (pill.imageUrl.isNotBlank()) {
                                AsyncImage(
                                    model = pill.imageUrl,
                                    contentDescription = pill.name,
                                    modifier = Modifier
                                        .size(72.dp)
                                        .clip(RoundedCornerShape(12.dp)),
                                    contentScale = ContentScale.Fit,
                                )
                            } else {
                                Icon(Icons.Default.Medication, null, modifier = Modifier.size(48.dp))
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(pill.name, style = MaterialTheme.typography.titleMedium, maxLines = 2)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(80.dp))
    }
}
