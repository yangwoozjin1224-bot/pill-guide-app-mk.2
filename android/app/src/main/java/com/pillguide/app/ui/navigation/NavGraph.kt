package com.pillguide.app.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.pillguide.app.ui.detail.DetailScreen
import com.pillguide.app.ui.home.HomeScreen
import com.pillguide.app.ui.management.BagCameraScreen
import com.pillguide.app.ui.management.ManagementScreen
import com.pillguide.app.ui.scan.ScanScreen
import com.pillguide.app.ui.search.SearchScreen

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

@Composable
fun PillGuideNavHost() {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val current = backStack?.destination?.route.orEmpty()
    val hideBottom = current.startsWith("scan") ||
        current.startsWith("detail") ||
        current == Routes.BAG_CAMERA

    val tabs = listOf(
        Tab(Routes.HOME, "홈", Icons.Default.Home),
        Tab(Routes.SEARCH, "약 찾기", Icons.Default.Search),
        Tab(Routes.SCAN, "촬영", Icons.Default.CameraAlt),
        Tab(Routes.MANAGEMENT, "복용관리", Icons.Default.Medication),
    )

    Scaffold(
        bottomBar = {
            if (!hideBottom) {
                NavigationBar {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = current == tab.route || (tab.route == Routes.HOME && current.isEmpty()),
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    tab.icon,
                                    contentDescription = tab.label,
                                    modifier = Modifier.semantics { contentDescription = tab.label },
                                )
                            },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    onSearch = { navController.navigate(Routes.SEARCH) },
                    onScan = { navController.navigate(Routes.SCAN) },
                    onManagement = { navController.navigate(Routes.MANAGEMENT) },
                    onOpenPill = { seq -> navController.navigate(Routes.detail(seq, "home")) },
                )
            }
            composable(Routes.SEARCH) {
                SearchScreen(
                    onBack = { navController.popBackStack() },
                    onOpenPill = { seq -> navController.navigate(Routes.detail(seq, "search")) },
                )
            }
            composable(Routes.SCAN) {
                ScanScreen(
                    onBack = { navController.popBackStack() },
                    onOpenPill = { seq ->
                        navController.navigate(Routes.detail(seq, "scan")) {
                            popUpTo(Routes.SCAN) { inclusive = false }
                        }
                    },
                )
            }
            composable(
                route = Routes.DETAIL,
                arguments = listOf(
                    navArgument("itemSeq") { type = NavType.StringType },
                    navArgument("source") {
                        type = NavType.StringType
                        defaultValue = "search"
                    },
                ),
            ) {
                DetailScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.MANAGEMENT) {
                ManagementScreen(
                    onBack = { navController.popBackStack() },
                    onOpenBagCamera = { navController.navigate(Routes.BAG_CAMERA) },
                    onOpenPill = { seq -> navController.navigate(Routes.detail(seq, "management")) },
                )
            }
            composable(Routes.BAG_CAMERA) {
                BagCameraScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
