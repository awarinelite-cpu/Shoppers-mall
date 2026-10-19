package com.provisionpos.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.data.StockMovement
import com.provisionpos.domain.*

@Composable
fun MovementRow(m: StockMovement) {
    ListItem(
        headlineContent = { Text("${m.productName}: ${if (m.changeMilli > 0) "+" else ""}${Qty.format(m.changeMilli)} (${m.type})") },
        supportingContent = { Text("${Qty.format(m.prevMilli)} -> ${Qty.format(m.newMilli)}  |  ${Fmt.dateTime(m.createdAt)}" +
            (if (m.reason.isNotBlank()) "\n${m.reason}" else "") + (m.note?.let { "\n$it" } ?: "")) })
    HorizontalDivider()
}

@Composable
fun StockScreen(vm: AppViewModel, nav: NavController) {
    val products by vm.products.collectAsState()
    var q by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("ALL") }
    val active = products.filter { it.active }
    val list = active.filter {
        (q.isBlank() || it.name.contains(q, true) || it.barcode == q || it.category.contains(q, true)) &&
        when (filter) { "LOW" -> it.stockMilli in 1..it.lowThresholdMilli; "OUT" -> it.stockMilli <= 0; else -> true }
    }
    val costValue = active.sumOf { it.costKobo?.let { c -> Calc.lineTotal(c, it.stockMilli.coerceAtLeast(0)) } ?: 0L }
    val saleValue = active.sumOf { Calc.lineTotal(it.priceKobo, it.stockMilli.coerceAtLeast(0)) }
    val missing = active.count { it.costKobo == null }
    Screen("Stock", actions = { TextButton({ nav.navigate("movements") }) { Text("History", color = MaterialTheme.colorScheme.onPrimary) } }) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Stock value at cost: ${Money.format(costValue)}" + if (missing > 0) "  ($missing products have no cost)" else "")
            Text("Stock value at selling price: ${Money.format(saleValue)}")
            Field(q, { q = it }, "Search stock")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("ALL" to "All", "LOW" to "Low stock", "OUT" to "Out of stock").forEach { (k, l) ->
                    FilterChip(filter == k, { filter = k }, { Text(l) })
                }
            }
        }
        if (list.isEmpty()) Empty("Nothing to show.")
        LazyColumn { items(list, key = { it.id }) { p ->
            ListItem(headlineContent = { Text(p.name) },
                supportingContent = { Text("${Qty.format(p.stockMilli)} ${Units.label(p.unit)}" + when {
                    p.stockMilli <= 0 -> "  OUT OF STOCK"; p.stockMilli <= p.lowThresholdMilli -> "  LOW (alert at ${Qty.format(p.lowThresholdMilli)})"; else -> "" }) },
                trailingContent = { TextButton({ nav.navigate("adjust/${p.id}") }) { Text("Adjust") } },
                modifier = Modifier.clickable { nav.navigate("product/${p.id}") })
            HorizontalDivider()
        } }
    }
}

@Composable
fun AdjustScreen(vm: AppViewModel, nav: NavController, id: Long) {
    val p by vm.repo.db.products().observe(id).collectAsState(initial = null)
    var type by remember { mutableStateOf("RECEIVED") }
    var qty by remember { mutableStateOf("") }
    var cost by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val types = listOf("RECEIVED" to "Goods received (+)", "DAMAGED" to "Damaged (-)", "EXPIRED" to "Expired (-)",
        "LOSS" to "Loss / missing (-)", "CORRECTION_ADD" to "Count correction (+)", "CORRECTION_SUB" to "Count correction (-)")
    Screen("Adjust stock", { nav.popBackStack() }) {
        val pr = p ?: return@Screen
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(pr.name, style = MaterialTheme.typography.titleLarge)
            Text("Current stock: ${Qty.format(pr.stockMilli)} ${Units.label(pr.unit)}")
            Dropdown(type, types, "Reason", { type = it })
            Field(qty, { qty = it }, "Quantity (${Units.label(pr.unit)})", number = true)
            if (type == "RECEIVED") Field(cost, { cost = it }, "New purchase cost per unit ₦ (optional)", number = true)
            Field(note, { note = it }, "Reference / notes (optional)")
            Button({
                val q = Qty.parse(qty); val c = if (cost.isBlank()) null else Money.parse(cost)
                if (q == null || q == 0L) vm.toast("Enter a valid quantity")
                else if (cost.isNotBlank() && c == null) vm.toast("Invalid cost")
                else vm.guard {
                    val sign = if (type == "RECEIVED" || type == "CORRECTION_ADD") 1 else -1
                    val t = if (type.startsWith("CORRECTION")) "CORRECTION" else type
                    vm.adjust(id, sign * q, t, types.first { it.first == type }.second, note, c) { nav.popBackStack() }
                }
            }, Modifier.fillMaxWidth().height(52.dp)) { Text("Save adjustment") }
        }
    }
}

@Composable
fun MovementsScreen(vm: AppViewModel, nav: NavController) {
    val moves by vm.movements.collectAsState()
    Screen("Stock movements", { nav.popBackStack() }) {
        if (moves.isEmpty()) Empty("No stock movements yet.")
        LazyColumn { items(moves) { MovementRow(it) } }
    }
}
