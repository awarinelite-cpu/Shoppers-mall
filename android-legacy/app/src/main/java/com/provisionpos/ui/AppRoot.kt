package com.provisionpos.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val tabs = listOf(
    Tab("dashboard", "Home", Icons.Filled.Home), Tab("sale", "Sale", Icons.Filled.ShoppingCart),
    Tab("products", "Products", Icons.Filled.Inventory2), Tab("stock", "Stock", Icons.Filled.Warehouse),
    Tab("more", "More", Icons.Filled.Menu)
)

@Composable
fun AppRoot(vm: AppViewModel = viewModel()) {
    val settings by vm.settings.collectAsState()
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) { vm.message?.let { snack.showSnackbar(it); vm.message = null } }

    Scaffold(snackbarHost = { SnackbarHost(snack) }, contentWindowInsets = WindowInsets(0)) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            val s = settings
            when {
                s == null -> Box(Modifier.fillMaxSize()) { CircularProgressIndicator(Modifier.padding(48.dp)) }
                s["setup_done"] != "1" -> SetupScreen(vm)
                else -> MainNav(vm)
            }
        }
    }
    vm.pendingGuard?.let { PinDialog({ vm.submitPin(it) }, { vm.pendingGuard = null }) }
}

@Composable
private fun MainNav(vm: AppViewModel) {
    val nav = rememberNavController()
    val back by nav.currentBackStackEntryAsState()
    val route = back?.destination?.route
    Scaffold(contentWindowInsets = WindowInsets(0), bottomBar = {
        if (tabs.any { it.route == route }) NavigationBar {
            tabs.forEach { t ->
                NavigationBarItem(selected = route == t.route, icon = { Icon(t.icon, t.label) }, label = { Text(t.label) }, onClick = {
                    nav.navigate(t.route) { popUpTo("dashboard"); launchSingleTop = true }
                })
            }
        }
    }) { pad ->
        NavHost(nav, "dashboard", Modifier.padding(pad)) {
            composable("dashboard") { DashboardScreen(vm, nav) }
            composable("sale") { SaleScreen(vm, nav) }
            composable("products") { ProductsScreen(vm, nav) }
            composable("stock") { StockScreen(vm, nav) }
            composable("more") { MoreScreen(nav) }
            composable("scanner/{mode}") { e ->
                val mode = e.arguments?.getString("mode") ?: "sale"
                ScannerScreen(vm, mode, { nav.popBackStack() }) { code -> nav.navigate("product/form?barcode=$code") }
            }
            composable("checkout") { CheckoutScreen(vm, nav) }
            composable("product/form?id={id}&barcode={barcode}",
                listOf(navArgument("id") { type = NavType.LongType; defaultValue = 0L },
                       navArgument("barcode") { type = NavType.StringType; defaultValue = "" })) { e ->
                ProductFormScreen(vm, nav, e.arguments?.getLong("id") ?: 0L, e.arguments?.getString("barcode") ?: "")
            }
            composable("product/{id}", listOf(navArgument("id") { type = NavType.LongType })) { e ->
                ProductDetailScreen(vm, nav, e.arguments!!.getLong("id"))
            }
            composable("adjust/{id}", listOf(navArgument("id") { type = NavType.LongType })) { e ->
                AdjustScreen(vm, nav, e.arguments!!.getLong("id"))
            }
            composable("movements") { MovementsScreen(vm, nav) }
            composable("history") { HistoryScreen(vm, nav) }
            composable("sale/{id}", listOf(navArgument("id") { type = NavType.LongType })) { e ->
                SaleDetailScreen(vm, nav, e.arguments!!.getLong("id"))
            }
            composable("reports") { ReportsScreen(vm, nav) }
            composable("settings") { SettingsScreen(vm, nav) }
        }
    }
}

@Composable
private fun MoreScreen(nav: androidx.navigation.NavController) {
    Screen("More") {
        listOf("reports" to "Reports", "history" to "Sales history", "movements" to "Stock movement history", "settings" to "Settings & backup").forEach { (r, l) ->
            ListItem(headlineContent = { Text(l) },
                modifier = Modifier.clickable { nav.navigate(r) },
                trailingContent = { Icon(Icons.Filled.ChevronRight, null) })
            HorizontalDivider()
        }
    }
}
