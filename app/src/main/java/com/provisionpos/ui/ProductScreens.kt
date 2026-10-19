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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.data.Product
import com.provisionpos.domain.*

@Composable
fun ProductsScreen(vm: AppViewModel, nav: NavController) {
    val products by vm.products.collectAsState()
    var q by remember { mutableStateOf("") }
    var showInactive by remember { mutableStateOf(false) }
    val list = products.filter { (showInactive || it.active) && (q.isBlank() || it.name.contains(q, true) ||
        it.barcode == q || it.altBarcode == q || it.internalCode.contains(q, true) || it.category.contains(q, true)) }
    Screen("Products", actions = {
        IconButton({ nav.navigate("scanner/pick") }) { Icon(Icons.Filled.QrCodeScanner, "Scan to find") }
        IconButton({ nav.navigate("product/form") }) { Icon(Icons.Filled.Add, "Add product") }
    }) {
        Column(Modifier.padding(12.dp)) {
            Field(q, { q = it }, "Search name, barcode, code, category")
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(showInactive, { showInactive = it }); Text("Show deactivated")
            }
        }
        // a scan from this screen jumps to the product, or offers to register it
        LaunchedEffect(vm.pickedBarcode) {
            vm.pickedBarcode?.let { code ->
                vm.pickedBarcode = null
                val p = vm.repo.findByCode(code)
                if (p != null) nav.navigate("product/${p.id}") else nav.navigate("product/form?barcode=$code")
            }
        }
        if (list.isEmpty()) Empty(if (products.isEmpty()) "No products yet. Tap + to add your first product." else "No matching products.")
        LazyColumn { items(list, key = { it.id }) { p ->
            ListItem(headlineContent = { Text(p.name + if (!p.active) " (deactivated)" else "") },
                supportingContent = { Text("${Money.format(p.priceKobo)}  |  ${Qty.format(p.stockMilli)} ${Units.label(p.unit)}  |  ${p.barcode ?: p.internalCode}") },
                modifier = Modifier.clickable { nav.navigate("product/${p.id}") })
            HorizontalDivider()
        } }
    }
}

@Composable
fun ProductFormScreen(vm: AppViewModel, nav: NavController, id: Long, barcodeArg: String) {
    var loaded by remember { mutableStateOf(id == 0L) }
    var existing by remember { mutableStateOf<Product?>(null) }
    var name by rememberSaveable { mutableStateOf("") }
    var barcode by rememberSaveable { mutableStateOf(barcodeArg) }
    var alt by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }
    var cost by rememberSaveable { mutableStateOf("") }
    var price by rememberSaveable { mutableStateOf("") }
    var stock by rememberSaveable { mutableStateOf("0") }
    var low by rememberSaveable { mutableStateOf(Qty.format(vm.defaultThresholdMilli())) }
    var unit by rememberSaveable { mutableStateOf("PIECE") }
    var supplier by rememberSaveable { mutableStateOf("") }
    var desc by rememberSaveable { mutableStateOf("") }
    var expiry by rememberSaveable { mutableStateOf("") }
    var internal by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(id) {
        if (id != 0L) vm.repo.product(id)?.let { p ->
            existing = p; name = p.name; barcode = p.barcode ?: ""; alt = p.altBarcode ?: ""; category = p.category
            cost = p.costKobo?.let { Money.format(it).drop(1).replace(",", "") } ?: ""
            price = Money.format(p.priceKobo).drop(1).replace(",", ""); low = Qty.format(p.lowThresholdMilli); unit = p.unit
            supplier = p.supplier ?: ""; desc = p.description ?: ""; expiry = p.expiryAt?.let { Fmt.date(it) } ?: ""; internal = p.internalCode
            loaded = true
        }
    }
    // barcode returned from the scanner
    LaunchedEffect(vm.pickedBarcode) { vm.pickedBarcode?.let { barcode = it; vm.pickedBarcode = null } }

    Screen(if (id == 0L) "Add product" else "Edit product", { nav.popBackStack() }) {
        if (!loaded) { CircularProgressIndicator(Modifier.padding(24.dp)); return@Screen }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(name, { name = it }, "Product name *")
            Field(barcode, { barcode = it }, "Barcode (leave empty to use internal code)", trailing = {
                IconButton({ nav.navigate("scanner/pick") }) { Icon(Icons.Filled.QrCodeScanner, "Scan") }
            })
            Field(alt, { alt = it }, "Alternative barcode (optional)")
            Field(internal, { internal = it }, "Internal code (auto if empty)")
            Field(category, { category = it }, "Category (e.g. Grains, Drinks)")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field(cost, { cost = it }, "Purchase cost ₦", Modifier.weight(1f), number = true)
                Field(price, { price = it }, "Selling price ₦ *", Modifier.weight(1f), number = true)
            }
            Dropdown(unit, Units.all.map { it to Units.label(it) }, "Unit", { unit = it })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (id == 0L) Field(stock, { stock = it }, "Opening stock", Modifier.weight(1f), number = true)
                Field(low, { low = it }, "Low-stock level", Modifier.weight(1f), number = true)
            }
            if (id != 0L) Text("Change stock using Stock > Adjust so the history stays correct.", style = MaterialTheme.typography.bodySmall)
            Field(supplier, { supplier = it }, "Supplier (optional)")
            Field(expiry, { expiry = it }, "Expiry date yyyy-MM-dd (optional)")
            Field(desc, { desc = it }, "Description (optional)", singleLine = false)
            Button({
                val p = Money.parse(price)
                val c = if (cost.isBlank()) null else Money.parse(cost)
                val st = Qty.parse(stock); val lw = Qty.parse(low)
                val ex = if (expiry.isBlank()) null else Fmt.parseDate(expiry)
                when {
                    name.isBlank() -> vm.toast("Enter the product name")
                    p == null -> vm.toast("Enter a valid selling price")
                    cost.isNotBlank() && c == null -> vm.toast("Purchase cost is invalid")
                    st == null || lw == null -> vm.toast("Stock quantities are invalid")
                    expiry.isNotBlank() && ex == null -> vm.toast("Expiry date must be yyyy-MM-dd")
                    else -> {
                        val base = existing ?: Product(name = name, priceKobo = p)
                        vm.saveProduct(base.copy(name = name, barcode = barcode, altBarcode = alt, internalCode = internal, category = category.trim(),
                            costKobo = c, priceKobo = p, stockMilli = if (id == 0L) st else base.stockMilli, lowThresholdMilli = lw, unit = unit,
                            supplier = supplier.ifBlank { null }, description = desc.ifBlank { null }, expiryAt = ex)) { nav.popBackStack() }
                    }
                }
            }, Modifier.fillMaxWidth().height(52.dp)) { Text("Save product") }
        }
    }
}

@Composable
fun ProductDetailScreen(vm: AppViewModel, nav: NavController, id: Long) {
    val p by vm.repo.db.products().observe(id).collectAsState(initial = null)
    val moves by vm.repo.movementsFor(id).collectAsState(initial = emptyList())
    var deact by remember { mutableStateOf(false) }
    Screen(p?.name ?: "Product", { nav.popBackStack() }) {
        val pr = p ?: return@Screen
        LazyColumn(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            item {
                Text("Selling price: ${Money.format(pr.priceKobo)}", style = MaterialTheme.typography.titleMedium)
                Text("Purchase cost: ${pr.costKobo?.let { Money.format(it) } ?: "not set"}")
                Text("Stock: ${Qty.format(pr.stockMilli)} ${Units.label(pr.unit)} (low at ${Qty.format(pr.lowThresholdMilli)})")
                Text("Barcode: ${pr.barcode ?: "-"}   Code: ${pr.internalCode}")
                Text("Category: ${pr.category.ifBlank { "-" }}   Supplier: ${pr.supplier ?: "-"}")
                pr.expiryAt?.let { Text("Expiry: ${Fmt.date(it)}") }
                pr.description?.let { Text(it) }
                Text("Created ${Fmt.dateTime(pr.createdAt)}, updated ${Fmt.dateTime(pr.updatedAt)}", style = MaterialTheme.typography.bodySmall)
                Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button({ vm.guard { nav.navigate("product/form?id=$id") } }) { Text("Edit") }
                    OutlinedButton({ nav.navigate("adjust/$id") }) { Text("Adjust stock") }
                    OutlinedButton({ if (pr.active) deact = true else vm.setActive(id, true) }) { Text(if (pr.active) "Deactivate" else "Activate") }
                }
                Text("Transaction history", style = MaterialTheme.typography.titleMedium)
                if (moves.isEmpty()) Text("No movements yet.")
            }
            items(moves) { m -> MovementRow(m) }
        }
    }
    if (deact) Confirm("Deactivate product?", "It will no longer be sellable. Old receipts are not affected.", "Deactivate",
        { vm.setActive(id, false); deact = false }, { deact = false })
}
