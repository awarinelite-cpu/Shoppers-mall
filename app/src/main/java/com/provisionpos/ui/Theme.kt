package com.provisionpos.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(primary = Color(0xFF1B6B3A), secondary = Color(0xFF8A5A00), tertiary = Color(0xFF9C2B2B))
private val Dark = darkColorScheme(primary = Color(0xFF7FD69A), secondary = Color(0xFFFFB955), tertiary = Color(0xFFFFB4AB))

@Composable
fun PosTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
