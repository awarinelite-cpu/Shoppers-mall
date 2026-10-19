package com.provisionpos.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.provisionpos.domain.*

@Composable
fun SettingsScreen(vm: AppViewModel, nav: NavController) {
    val ctx = LocalContext.current
    var name by remember { mutableStateOf(vm.s("store_name")) }
    var addr by remember { mutableStateOf(vm.s("address")) }
    var phone by remember { mutableStateOf(vm.s("phone")) }
    var cashier by remember { mutableStateOf(vm.s("cashier")) }
    var footer by remember { mutableStateOf(vm.s("footer")) }
    var prefix by remember { mutableStateOf(vm.s("receipt_prefix", "POS")) }
    var low by remember { mutableStateOf(vm.s("low_default", "5")) }
    var tax by remember { mutableStateOf((vm.taxBps() / 100.0).toString()) }
    var pay by remember { mutableStateOf(vm.s("default_pay", "CASH")) }
    var allowNeg by remember { mutableStateOf(vm.s("allow_negative") == "1") }
    var newPin by remember { mutableStateOf("") }
    var restoreJson by remember { mutableStateOf<String?>(null) }

    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.backupJson { json ->
            try { ctx.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray()) }; vm.toast("Backup saved") }
            catch (e: Exception) { vm.toast("Could not write the backup file") }
        }
    }
    val openLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) try { restoreJson = ctx.contentResolver.openInputStream(uri)?.use { String(it.readBytes()) } }
        catch (e: Exception) { vm.toast("Could not read the file") }
    }

    Screen("Settings", { nav.popBackStack() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(name, { name = it }, "Store name"); Field(addr, { addr = it }, "Address"); Field(phone, { phone = it }, "Phone")
            Field(cashier, { cashier = it }, "Cashier name"); Field(footer, { footer = it }, "Receipt footer message")
            Field(prefix, { prefix = it }, "Receipt number prefix (e.g. POS)")
            Field(low, { low = it }, "Default low-stock level (new products)", number = true)
            Field(tax, { tax = it }, "Tax % (0 = no tax)", number = true)
            Dropdown(pay, Methods.all.map { it to Methods.label(it) }, "Default payment", { pay = it })
            Row { Text("Allow selling below zero stock", Modifier.weight(1f)); Switch(allowNeg, { allowNeg = it }) }
            Button({
                val t = Qty.parse(tax); val l = Qty.parse(low)
                if (name.isBlank()) vm.toast("Store name is required") else if (t == null || t > 100000L || l == null) vm.toast("Check tax and stock level")
                else vm.guard { vm.saveSettings(mapOf("store_name" to name.trim(), "address" to addr, "phone" to phone, "cashier" to cashier,
                    "footer" to footer, "receipt_prefix" to prefix.trim().ifBlank { "POS" }, "low_default" to Qty.format(l),
                    "tax_bps" to (t / 10).toString(), "default_pay" to pay, "allow_negative" to if (allowNeg) "1" else "0")) { vm.toast("Settings saved") } }
            }, Modifier.fillMaxWidth().height(48.dp)) { Text("Save settings") }

            HorizontalDivider()
            Text("Owner PIN", style = MaterialTheme.typography.titleMedium)
            Text("Protects editing products, adjusting stock, refunds, settings changes and restore.", style = MaterialTheme.typography.bodySmall)
            Field(newPin, { newPin = it.filter(Char::isDigit) }, "New PIN (digits)", number = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({ if (newPin.length < 4) vm.toast("Use at least 4 digits") else vm.guard { vm.setPin(newPin); newPin = "" } }) { Text("Set PIN") }
                OutlinedButton({ vm.guard { vm.setPin(null) } }) { Text("Remove PIN") }
            }

            HorizontalDivider()
            Text("Backup & restore", style = MaterialTheme.typography.titleMedium)
            Text("A backup is a single .json file with all products, sales, stock history and settings. It works offline. " +
                "To use it on another phone: install the app, then choose Restore backup and pick the file.", style = MaterialTheme.typography.bodySmall)
            Button({ saveLauncher.launch("provision-pos-backup-${Fmt.date(System.currentTimeMillis())}.json") }, Modifier.fillMaxWidth()) { Text("Export backup") }
            OutlinedButton({ openLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }, Modifier.fillMaxWidth()) { Text("Restore backup") }
        }
    }
    restoreJson?.let { json ->
        Confirm("Replace all data?", "Restoring REPLACES every product, sale and setting on this phone with the backup contents. This cannot be undone.", "Replace",
            { restoreJson = null; vm.guard { vm.restore(json) } }, { restoreJson = null })
    }
}
