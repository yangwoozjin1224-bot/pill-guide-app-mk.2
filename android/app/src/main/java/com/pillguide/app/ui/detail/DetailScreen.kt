package com.pillguide.app.ui.detail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.pillguide.app.ui.components.AppCard
import com.pillguide.app.ui.components.BigPrimaryButton
import com.pillguide.app.ui.theme.PillGray2
import com.pillguide.app.ui.theme.PillGreen
import com.pillguide.app.ui.theme.PillRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    onBack: () -> Unit,
    vm: DetailViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("약 정보") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "뒤로")
                    }
                },
                actions = {
                    if (state.source == "scan") {
                        IconButton(onClick = { vm.speak() }) {
                            Icon(Icons.Default.VolumeUp, contentDescription = "음성으로 읽어주기")
                        }
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> CircularProgressIndicator(Modifier.padding(padding).padding(24.dp))
            state.error != null -> Text(state.error!!, color = PillRed, modifier = Modifier.padding(padding).padding(16.dp))
            state.pill != null -> {
                val pill = state.pill!!
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                ) {
                    AsyncImage(
                        model = pill.imageUrl,
                        contentDescription = pill.name,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(pill.name, style = MaterialTheme.typography.headlineLarge)
                    if (pill.entpName.isNotBlank()) Text(pill.entpName, color = PillGray2)
                    Spacer(Modifier.height(16.dp))
                    AppCard {
                        Column {
                            Section("1. 기본 정보", pill.tag)
                            Section("2. 복용 방법", pill.timing.ifBlank { "정보 없음" })
                            Section("3. 효과 및 효능", pill.effect.ifBlank { "정보 없음" })
                            Section("4. 주의사항", pill.caution.ifBlank { "정보 없음" })
                            pill.durWarning?.let { Section("5. 병용 금기", it, danger = true) }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    BigPrimaryButton(
                        text = if (state.registered) "복용 관리에 등록됨 ✓" else "복용 관리 등록하기",
                        onClick = { vm.register() },
                    )
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, body: String, danger: Boolean = false) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(4.dp))
    Text(body, color = if (danger) PillRed else PillGray2)
    Spacer(Modifier.height(12.dp))
}
