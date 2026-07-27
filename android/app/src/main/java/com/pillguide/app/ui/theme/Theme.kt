package com.pillguide.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val PillRed = Color(0xFFE53E3E)
val PillBg = Color(0xFFF5F5F7)
val PillBlack = Color(0xFF1A1A1A)
val PillGray = Color(0xFF9CA3AF)
val PillGray2 = Color(0xFF6B7280)
val PillGreen = Color(0xFF059669)
val PillCard = Color(0xFFFFFFFF)

private val LightColors = lightColorScheme(
    primary = PillRed,
    onPrimary = Color.White,
    secondary = PillGreen,
    background = PillBg,
    surface = PillCard,
    onBackground = PillBlack,
    onSurface = PillBlack,
    outline = Color(0xFFE8E8E8),
)

private val DarkColors = darkColorScheme(
    primary = PillRed,
    onPrimary = Color.White,
    secondary = PillGreen,
    background = Color(0xFF121212),
    surface = Color(0xFF1E1E1E),
    onBackground = Color.White,
    onSurface = Color.White,
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, color = PillBlack),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 17.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp),
)

@Composable
fun PillGuideTheme(
    highContrast: Boolean = false,
    largeText: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = if (isSystemInDarkTheme() && !highContrast) DarkColors else LightColors
    val typography = if (largeText) {
        AppTypography.copy(
            bodyLarge = AppTypography.bodyLarge.copy(fontSize = 18.sp, lineHeight = 26.sp),
            titleLarge = AppTypography.titleLarge.copy(fontSize = 22.sp),
        )
    } else AppTypography

    MaterialTheme(
        colorScheme = colors,
        typography = typography,
        content = content,
    )
}
