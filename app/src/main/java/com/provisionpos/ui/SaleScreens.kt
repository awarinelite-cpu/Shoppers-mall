package com.provisionpos.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.data.CartLine
import com.provisionpos.domain.*

@Composable
fun SaleScreen(vm: AppViewModel, nav: NavController) {
    val products by vm.products.collectAsState()
    var query by remember { mutableStateOf("") }
    var qtyFor by remember { mutableStateOf<CartLine?>(null) }
    var discDialog by remember { mutableStateOf(false) }
    var clearDialog by remember { mutableStateOf(false) }
    val totals = vm.totals()
    val matches = remember(query, products) {
        if (query.isBlank()) emptyList() else products.filter { it.active && (it.name.contains(query, true) ||
            it.barcode == query || it.internalCode.equals(query, true) || it.category.contains(query, true)) }.take(6)
    }
    Screen("New Sale", actions = {
        if (vm.cart.isNotEmpty()) IconButton({ clearDialog = true }) { Icon(Icons.Filled.DeleteSweep, "Clear cart") }
    }) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Field(query, { query = it }, "Search name / barcode", Modifier.weight(1f))
            FilledIconButton({ nav.navigate("scanner/sale") }, Modifier.size(56.dp)) { Icon(Icons.Filled.QrCodeScanner, "Scan barcode") }
        }
        if (matches.isNotEmpty()) Card(Modifier.padding(horizontal = 12.dp)) {
            matches.forEach { p ->
                ListItem(headlineContent = { Text(p.name) },
                    supportingContent = { Text("${Money.format(p.priceKobo)}  |  stock ${Qty.format(p.stockMilli)} ${Units.label(p.unit)}") },
                    modifier = Modifier.clickable { if (vm.addToCart(p)) query = "" })
            }
        }
        if (vm.cart.isEmpty()) Box(Modifier.weight(1f)) { Empty("Cart is empty. Scan or search for a product.") }
        else LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(vm.cart.toList(), key = { it.product.id }) { l ->
                Card { Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(l.product.name, style = MaterialTheme.typography.titleSmall)
                        Text("${Money.format(l.product.priceKobo)} x ${Qty.format(l.qtyMilli)}  (stock ${Qty.format(l.product.stockMilli)})",
                            style = MaterialTheme.typography.bodySmall)
                        Text(Money.format(Calc.lineTotal(l.product.priceKobo, l.qtyMilli)), style = MaterialTheme.typography.titleMedium)
                    }
                    IconButton({ vm.setQty(l.product.id, l.qtyMilli - Qty.ONE) }) { Icon(Icons.Filled.Remove, "Decrease") }
                    TextButton({ qtyFor = l }) { Text(Qty.format(l.qtyMilli)) }
                    IconButton({ vm.setQty(l.product.id, l.qtyMilli + Qty.ONE) }) { Icon(Icons.Filled.Add, "Increase") }
                    IconButton({ vm.removeLine(l.product.id) }) { Icon(Icons.Filled.Close, "Remove") }
                } }
            }
        }
        Surface(tonalElevation = 3.dp) { Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row { Text("Subtotal", Modifier.weight(1f)); Text(Money.format(totals.subtotal)) }
            Row(Modifier.clickable { discDialog = true }) { Text("Discount (tap to set)", Modifier.weight(1f)); Text("-" + Money.format(totals.discount)) }
            if (vm.taxBps() > 0) Row { Text("Tax", Modifier.weight(1f)); Text(Money.format(totals.tax)) }
            Row { Text("TOTAL", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); Text(Money.format(totals.total), style = MaterialTheme.typography.titleLarge) }
            Button({ nav.navigate("checkout") }, Modifier.fillMaxWidth().height(52.dp), enabled = vm.cart.isNotEmpty()) { Text("Checkout") }
        } }
    }
    qtyFor?.let { l ->
        var t by remember { mutableStateOf(Qty.format(l.qtyMilli)) }
        AlertDialog({ qtyFor = null }, title = { Text(l.product.name) },
            text = { Field(t, { t = it }, "Quantity (${Units.label(l.product.unit)})", number = true) },
            confirmButton = { Button({
                val q = Qty.parse(t); if (q == null) vm.toast("Invalid quantity") else { vm.setQty(l.product.id, q); qtyFor = null }
            }) { Text("OK") } }, dismissButton = { TextButton({ qtyFor = null }) { Text("Cancel") } })
    }
    if (discDialog) {
        var t by remember { mutableStateOf(if (vm.discountKobo > 0) (vm.discountKobo / 100.0).toString() else "") }
        AlertDialog({ discDialog = false }, title = { Text("Discount (₦)") },
            text = { Field(t, { t = it }, "Amount off", number = true) },
            confirmButton = { Button({
                val d = if (t.isBlank()) 0L else Money.parse(t)
                if (d == null) vm.toast("Invalid amount") else if (d > totals.subtotal) vm.toast("Discount is more than the subtotal")
                else { vm.discountKobo = d; discDialog = false }
            }) { Text("OK") } }, dismissButton = { TextButton({ discDialog = false }) { Text("Cancel") } })
    }
    if (clearDialog) Confirm("Clear cart?", "All items will be removed. Stock is not affected.", "Clear",
        { vm.clearCart(); clearDialog = false }, { clearDialog = false })
}

private class PayRow(method: String, amount: String) {
    var method by mutableStateOf(method)
    var amount by mutableStateOf(amount)
}

@Composable
fun CheckoutScreen(vm: AppViewModel, nav: NavController) {
    val totals = vm.totals()
    val rows = remember { mutableStateListOf(PayRow(vm.s("default_pay", "CASH"), Money.format(totals.total).drop(1).replace(",", ""))) }
    var confirm by remember { mutableStateOf(false) }
    val pays = rows.map { PayIn(it.method, Money.parse(it.amount) ?: 0L) }
    val tendered = pays.sumOf { it.amount }
    val error = try { Calc.settle(totals.total, pays); null } catch (e: PosException) { e.message }
    val change = if (tendered > totals.total) tendered - totals.total else 0L

    Screen("Checkout", { nav.popBackStack() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Card { Column(Modifier.padding(12.dp)) {
                vm.cart.forEach { l -> Row { Text("${l.product.name} x${Qty.format(l.qtyMilli)}", Modifier.weight(1f)); Text(Money.format(Calc.lineTotal(l.product.priceKobo, l.qtyMilli))) } }
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                Row { Text("Subtotal", Modifier.weight(1f)); Text(Money.format(totals.subtotal)) }
                Row { Text("Discount", Modifier.weight(1f)); Text("-" + Money.format(totals.discount)) }
                if (totals.tax > 0) Row { Text("Tax", Modifier.weight(1f)); Text(Money.format(totals.tax)) }
                Row { Text("TOTAL DUE", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); Text(Money.format(totals.total), style = MaterialTheme.typography.titleLarge) }
            } }
            Text("Payment", style = MaterialTheme.typography.titleMedium)
            rows.forEachIndexed { i, r ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dropdown(r.method, Methods.all.map { it to Methods.label(it) }, "Method", { r.method = it }, Modifier.weight(1f))
                    Field(r.amount, { r.amount = it }, "Amount ₦", Modifier.weight(1f), number = true)
                    if (rows.size > 1) IconButton({ rows.removeAt(i) }) { Icon(Icons.Filled.Close, "Remove payment") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ val rest = (totals.total - tendered).coerceAtLeast(0); rows.add(PayRow("TRANSFER", (rest / 100.0).toString())) }) { Text("Split payment") }
                OutlinedButton({ rows.clear(); rows.add(PayRow("CASH", Money.format(totals.total).drop(1).replace(",", ""))) }) { Text("Exact cash") }
            }
            Row { Text("Received", Modifier.weight(1f)); Text(Money.format(tendered)) }
            Row { Text("Change due", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(Money.format(change), style = MaterialTheme.typography.titleMedium) }
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            Text("Bank transfer and POS terminal payments are recorded as entered; the app does not verify them.", style = MaterialTheme.typography.bodySmall)
            Button({ confirm = true }, Modifier.fillMaxWidth().height(56.dp), enabled = error == null && !vm.busy && vm.cart.isNotEmpty()) {
                Text(if (vm.busy) "Saving..." else "Complete sale")
            }
        }
    }
    if (confirm) Confirm("Complete this sale?", "Total ${Money.format(totals.total)}. Stock will be deducted.", "Complete",
        { confirm = false; vm.completeSale(pays) { id -> nav.navigate("sale/$id") { popUpTo("sale") } } }, { confirm = false })
}
