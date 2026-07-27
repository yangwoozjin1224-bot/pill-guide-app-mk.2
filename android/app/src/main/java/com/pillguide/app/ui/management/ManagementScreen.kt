package com.pillguide.app.ui.management

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.pillguide.app.ui.components.AppCard
import com.pillguide.app.ui.components.BigPrimaryButton
import com.pillguide.app.ui.theme.PillGray2
import com.pillguide.app.ui.theme.PillGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManagementScreen(
    onBack: () -> Unit,
    onOpenBagCamera: () -> Unit,
    onOpenPill: (String) -> Unit,
    vm: ManagementViewModel = hiltViewModel(),
) {
    val schedule by vm.schedule.collectAsStateWithLifecycle()
    val ui by vm.ui.collectAsStateWithLifecycle()
    var taken by remember { mutableStateOf(setOf<String>()) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("복용 관리") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "뒤로")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
        ) {
            BigPrimaryButton(
                text = "처방전 / 약봉지 촬영",
                onClick = onOpenBagCamera,
                contentDescription = "처방전 또는 약봉지 촬영",
            )
            ui.message?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = PillGreen)
            }
            ui.error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(16.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(schedule, key = { it.id }) { pill ->
                    val isTaken = taken.contains(pill.id)
                    AppCard(onClick = { onOpenPill(pill.itemSeq) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(
                                model = pill.imageUrl,
                                contentDescription = pill.name,
                                modifier = Modifier
                                    .size(56.dp)
                                    .clip(RoundedCornerShape(12.dp)),
                                contentScale = ContentScale.Fit,
                            )
                            Spacer(Modifier.size(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(pill.name, style = MaterialTheme.typography.titleMedium)
                                Text(pill.timing.take(40), color = PillGray2, maxLines = 1)
                            }
                            FilterChip(
                                selected = isTaken,
                                onClick = {
                                    val next = !isTaken
                                    taken = if (next) taken + pill.id else taken - pill.id
                                    vm.toggleTaken(pill.id, next)
                                },
                                label = { Text(if (isTaken) "복용완료" else "복용 체크") },
                                leadingIcon = if (isTaken) {
                                    { Icon(Icons.Default.Check, null) }
                                } else null,
                            )
                        }
                    }
                }
            }
        }
    }
}
