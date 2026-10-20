package com.provisionpos.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.domain.*

@Composable
fun SetupScreen(vm: AppViewModel) {
    var name by remember { mutableStateOf("") }
    var addr by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var cashier by remember { mutableStateOf("") }
    var low by remember { mutableStateOf("5") }
    Screen("Welcome to Provision POS") {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Set up your store. You can change all of this later in Settings.")
            Field(name, { name = it }, "Store name *")
            Field(addr, { addr = it }, "Store address (optional)")
            Field(phone, { phone = it }, "Phone number (optional)")
            Field(cashier, { cashier = it }, "Cashier / attendant name (optional)")
            Field(low, { low = it }, "Low-stock warning level (units)", number = true)
            Button(onClick = {
                if (name.isBlank()) { vm.toast("Enter the store name"); return@Button }
                val lowMilli = Qty.parse(low) ?: 5000L
                vm.saveSettings(mapOf("store_name" to name.trim(), "address" to addr.trim(), "phone" to phone.trim(),
                    "cashier" to cashier.trim(), "low_default" to Qty.format(lowMilli), "footer" to "Thank you for shopping with us!",
                    "receipt_prefix" to "POS", "default_pay" to "CASH", "tax_bps" to "0", "setup_done" to "1"))
            }, Modifier.fillMaxWidth().height(52.dp)) { Text("Start") }
        }
    }
}

@Composable
fun DashboardScreen(vm: AppViewModel, nav: NavController) {
    val r by vm.today.collectAsState()
    val products by vm.products.collectAsState()
    val sales by vm.sales.collectAsState()
    val active = products.filter { it.active }
    val out = active.count { it.stockMilli <= 0 }
    val low = active.count { it.stockMilli in 1..it.lowThresholdMilli }
    Screen(vm.s("store_name", "Provision POS")) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({ nav.navigate("scanner/sale") }, Modifier.weight(1f).height(52.dp)) { Text("Scan & sell") }
                OutlinedButton({ nav.navigate("product/form") }, Modifier.weight(1f).height(52.dp)) { Text("Add product") }
            }
            Text("Today", style = MaterialTheme.typography.titleMedium)
            val rep = r
            if (rep == null) CircularProgressIndicator() else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Total sales", Money.format(rep.totalSales), Modifier.weight(1f))
                    Stat("Transactions", rep.saleCount.toString(), Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Items sold", Qty.format(rep.itemsMilli), Modifier.weight(1f))
                    Stat("Est. cost of goods", Money.format(rep.cogs), Modifier.weight(1f))
                }
                Stat("Est. gross profit", rep.grossProfit?.let { Money.format(it) } ?: "Unavailable: some items have no purchase cost", Modifier.fillMaxWidth())
            }
            Text("Stock", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("In stock", (active.size - out).toString(), Modifier.weight(1f))
                Stat("Low", low.toString(), Modifier.weight(1f))
                Stat("Out", out.toString(), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ nav.navigate("stock") }, Modifier.weight(1f)) { Text("View stock") }
                OutlinedButton({ nav.navigate("reports") }, Modifier.weight(1f)) { Text("Reports") }
            }
            Text("Recent sales", style = MaterialTheme.typography.titleMedium)
            if (sales.isEmpty()) Empty("No sales yet. Tap Scan & sell to make your first sale.")
            sales.take(5).forEach { s ->
                ListItem(headlineContent = { Text("${s.receiptNo}  ${Money.format(s.total)}") },
                    supportingContent = { Text(Fmt.dateTime(s.createdAt) + if (s.status == "REFUNDED") "  (refunded)" else "") },
                    modifier = Modifier.clickable { nav.navigate("sale/${s.id}") })
            }
        }
    }
}
