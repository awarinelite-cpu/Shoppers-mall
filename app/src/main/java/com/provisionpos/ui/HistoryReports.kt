package com.provisionpos.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.data.*
import com.provisionpos.domain.*

@Composable
fun HistoryScreen(vm: AppViewModel, nav: NavController) {
    val sales by vm.sales.collectAsState()
    var q by remember { mutableStateOf("") }
    var method by remember { mutableStateOf("ALL") }
    var date by remember { mutableStateOf("") }
    val day = if (date.isBlank()) null else Fmt.parseDate(date)
    val list = sales.filter {
        (q.isBlank() || it.receiptNo.contains(q, true)) &&
        (method == "ALL" || it.methods.split(",").contains(method)) &&
        (day == null || (it.createdAt >= day && it.createdAt < day + 86_400_000L))
    }
    Screen("Sales history", { nav.popBackStack() }) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Field(q, { q = it }, "Search receipt number")
            Field(date, { date = it }, "Date yyyy-MM-dd (optional)")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                (listOf("ALL") + Methods.all).forEach { m -> FilterChip(method == m, { method = m }, { Text(if (m == "ALL") "All" else Methods.label(m)) }) }
            }
        }
        if (list.isEmpty()) Empty("No sales found.")
        LazyColumn { items(list, key = { it.id }) { s ->
            ListItem(headlineContent = { Text("${s.receiptNo}  ${Money.format(s.total)}") },
                supportingContent = { Text("${Fmt.dateTime(s.createdAt)} | ${s.methods.split(",").joinToString { Methods.label(it) }} | ${s.paymentStatus}" +
                    if (s.status == "REFUNDED") " | REFUNDED" else "") },
                modifier = Modifier.clickable { nav.navigate("sale/${s.id}") })
            HorizontalDivider()
        } }
    }
}

@Composable
fun SaleDetailScreen(vm: AppViewModel, nav: NavController, id: Long) {
    val ctx = LocalContext.current
    val sales by vm.sales.collectAsState()          // re-load when a refund changes the sale
    val detail by produceState<Triple<Sale, List<SaleItem>, List<Payment>>?>(null, id, sales) { value = vm.detail(id) }
    val settings by vm.settings.collectAsState()
    var refund by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    Screen("Receipt", { nav.popBackStack() }) {
        val d = detail ?: return@Screen
        val text = Receipt.text(settings ?: emptyMap(), d.first, d.second, d.third)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (d.first.status == "COMPLETED") Text("Sale completed", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            Card { SelectionContainer { Text(text, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace) } }
            Button({ Receipt.shareText(ctx, text, "Receipt ${d.first.receiptNo}") }, Modifier.fillMaxWidth().height(48.dp)) { Text("Share receipt (text)") }
            Text("To print: share to a printing app or print service on your phone.", style = MaterialTheme.typography.bodySmall)
            if (d.first.status == "COMPLETED") OutlinedButton({ refund = true }, Modifier.fillMaxWidth()) { Text("Refund / reverse sale") }
            OutlinedButton({ nav.navigate("sale") { popUpTo("dashboard") } }, Modifier.fillMaxWidth()) { Text("New sale") }
        }
    }
    if (refund) AlertDialog({ refund = false }, title = { Text("Refund this sale?") },
        text = { Column { Text("The sale stays in history marked REFUNDED and all items return to stock."); Field(reason, { reason = it }, "Reason") } },
        confirmButton = { Button({ refund = false; vm.guard { vm.refund(id, reason) {} } }) { Text("Refund") } },
        dismissButton = { TextButton({ refund = false }) { Text("Cancel") } })
}

@Composable
fun ReportsScreen(vm: AppViewModel, nav: NavController) {
    val ctx = LocalContext.current
    var preset by remember { mutableStateOf("TODAY") }
    var fromT by remember { mutableStateOf("") }
    var toT by remember { mutableStateOf("") }
    val sales by vm.sales.collectAsState()
    val products by vm.products.collectAsState()
    val range: Pair<Long, Long>? = when (preset) {
        "TODAY" -> AppViewModel.dayRange(0)
        "WEEK" -> AppViewModel.dayRange(-6).first to AppViewModel.dayRange(0).second
        "MONTH" -> java.util.Calendar.getInstance().let { c -> AppViewModel.dayRange(1 - c.get(java.util.Calendar.DAY_OF_MONTH)).first to AppViewModel.dayRange(0).second }
        else -> { val a = Fmt.parseDate(fromT); val b = Fmt.parseDate(toT); if (a != null && b != null && b >= a) a to b + 86_399_999L else null }
    }
    val report by produceState<Report?>(null, range, sales) { value = range?.let { vm.report(it.first, it.second) } }
    Screen("Reports", { nav.popBackStack() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("TODAY" to "Today", "WEEK" to "7 days", "MONTH" to "Month", "CUSTOM" to "Custom").forEach { (k, l) ->
                    FilterChip(preset == k, { preset = k }, { Text(l) })
                }
            }
            if (preset == "CUSTOM") Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Field(fromT, { fromT = it }, "From yyyy-MM-dd", Modifier.weight(1f)); Field(toT, { toT = it }, "To yyyy-MM-dd", Modifier.weight(1f))
            }
            val r = report
            if (r == null) Text(if (range == null) "Enter a valid date range." else "Loading...")
            else if (r.saleCount == 0 && r.refundedCount == 0) Empty("No sales in this period.")
            else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Total sales", Money.format(r.totalSales), Modifier.weight(1f)); Stat("Transactions", r.saleCount.toString(), Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Stat("Items sold", Qty.format(r.itemsMilli), Modifier.weight(1f)); Stat("Average sale", Money.format(r.avgSale), Modifier.weight(1f))
                }
                Text("Net sales (excl. tax): ${Money.format(r.netSales)}   Discounts: ${Money.format(r.discount)}   Tax: ${Money.format(r.tax)}")
                Text("Cost of goods sold: ${Money.format(r.cogs)}")
                Text(r.grossProfit?.let { "Gross profit: ${Money.format(it)} (net sales - cost of goods; not net profit)" }
                    ?: "Gross profit cannot be calculated reliably: ${r.uncostedLines} sold line(s) have no purchase cost.")
                if (r.refundedCount > 0) Text("Refunded: ${r.refundedCount} sale(s), ${Money.format(r.refundedTotal)} (excluded above)")
                Text("By payment method", style = MaterialTheme.typography.titleMedium)
                r.byMethod.forEach { (m, a) -> Row { Text(Methods.label(m), Modifier.weight(1f)); Text(Money.format(a)) } }
                Text("By category", style = MaterialTheme.typography.titleMedium)
                r.byCategory.forEach { (m, a) -> Row { Text(m, Modifier.weight(1f)); Text(Money.format(a)) } }
                Text("Best-selling products", style = MaterialTheme.typography.titleMedium)
                r.byProduct.sortedByDescending { it.qtyMilli }.take(15).forEach { Row { Text("${it.name} x${Qty.format(it.qtyMilli)}", Modifier.weight(1f)); Text(Money.format(it.revenue)) } }
                Text("Daily trend", style = MaterialTheme.typography.titleMedium)
                r.trend.forEach { (d, a) -> Row { Text(d, Modifier.weight(1f)); Text(Money.format(a)) } }
                val cutoff = range!!.first
                val unsold = products.filter { it.active && r.byProduct.none { l -> l.name == it.name } }
                Text("Not sold in this period (${unsold.size})", style = MaterialTheme.typography.titleMedium)
                Text(unsold.take(20).joinToString { it.name }.ifBlank { "None" })
                Button({
                    val csv = buildString {
                        appendLine("Product,Category,Quantity,Revenue NGN")
                        r.byProduct.forEach { appendLine("\"${it.name.replace("\"", "\"\"")}\",\"${it.category}\",${Qty.format(it.qtyMilli)},${it.revenue / 100}.${"%02d".format(it.revenue % 100)}") }
                    }
                    Receipt.shareCsv(ctx, "sales_report_${Fmt.date(cutoff)}.csv", csv)
                }, Modifier.fillMaxWidth()) { Text("Export CSV") }
            }
        }
    }
}
