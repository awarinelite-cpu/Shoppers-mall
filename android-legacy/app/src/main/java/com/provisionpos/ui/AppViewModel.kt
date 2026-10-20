package com.provisionpos.ui

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.provisionpos.PosApp
import com.provisionpos.data.*
import com.provisionpos.domain.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.UUID

class AppViewModel(app: Application) : AndroidViewModel(app) {
    val repo: Repository = (app as PosApp).repo

    val settings: StateFlow<Map<String, String>?> =
        repo.settingsFlow.map { l -> l.associate { it.key to it.value } }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val products: StateFlow<List<Product>> = repo.productsFlow.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val sales: StateFlow<List<Sale>> = repo.salesFlow.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val movements: StateFlow<List<StockMovement>> = repo.movementsFlow.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /** Today's figures, recomputed from the database whenever sales or products change. */
    val today: StateFlow<Report?> = combine(sales, products) { _, _ -> }
        .map { val (f, t) = dayRange(0); repo.report(f, t) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    fun s(key: String, def: String = ""): String = settings.value?.get(key)?.takeIf { it.isNotEmpty() } ?: def
    fun taxBps(): Int = s("tax_bps", "0").toIntOrNull() ?: 0
    fun defaultThresholdMilli(): Long = Qty.parse(s("low_default", "5")) ?: 5000L

    // ---- messages ----
    var message by mutableStateOf<String?>(null)
    fun toast(m: String) { message = m }

    // ---- PIN gate ----
    var pendingGuard by mutableStateOf<(() -> Unit)?>(null)
    fun guard(action: () -> Unit) {
        viewModelScope.launch { if (repo.hasPin()) pendingGuard = action else action() }
    }
    fun submitPin(pin: String) {
        viewModelScope.launch {
            if (repo.checkPin(pin)) { val a = pendingGuard; pendingGuard = null; a?.invoke() } else toast("Wrong PIN")
        }
    }

    private fun launchSafe(block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block() }
            catch (e: PosException) { toast(e.message ?: "Error") }
            catch (e: Exception) { Log.e("PosVM", "operation failed", e); toast("Something went wrong. Nothing was changed.") }
        }
    }

    // ---- setup / settings ----
    fun saveSettings(map: Map<String, String>, done: () -> Unit = {}) = launchSafe { repo.putSettings(map); done() }
    fun setPin(pin: String?) = launchSafe { repo.setPin(pin); toast(if (pin.isNullOrBlank()) "PIN removed" else "PIN saved") }

    // ---- cart ----
    val cart = mutableStateListOf<CartLine>()
    var discountKobo by mutableLongStateOf(0L)
    var busy by mutableStateOf(false)
    private var token = UUID.randomUUID().toString()

    // scanning state
    var notFoundCode by mutableStateOf<String?>(null)
    var scanStatus by mutableStateOf("")
    var pickedBarcode by mutableStateOf<String?>(null)

    fun totals(): Totals = Calc.totals(cart.map { Calc.lineTotal(it.product.priceKobo, it.qtyMilli) }, discountKobo, taxBps())
    private fun allowNegative() = s("allow_negative") == "1"

    fun addToCart(p: Product, qty: Long = Qty.ONE): Boolean {
        if (!p.active) { toast("${p.name} is deactivated"); return false }
        val i = cart.indexOfFirst { it.product.id == p.id }
        val newQty = (if (i >= 0) cart[i].qtyMilli else 0L) + qty
        if (!allowNegative() && newQty > p.stockMilli) { toast("Only ${Qty.format(p.stockMilli)} ${Units.label(p.unit)} of ${p.name} in stock"); return false }
        if (i >= 0) cart[i] = cart[i].copy(product = p, qtyMilli = newQty) else cart.add(CartLine(p, newQty))
        return true
    }
    fun setQty(productId: Long, qty: Long) {
        val i = cart.indexOfFirst { it.product.id == productId }; if (i < 0) return
        if (qty <= 0) { cart.removeAt(i); return }
        val p = cart[i].product
        if (!allowNegative() && qty > p.stockMilli) { toast("Only ${Qty.format(p.stockMilli)} in stock"); return }
        cart[i] = cart[i].copy(qtyMilli = qty)
    }
    fun removeLine(productId: Long) { cart.removeAll { it.product.id == productId } }
    fun clearCart() { cart.clear(); discountKobo = 0 }

    /** Scanner callback during a sale. Each scan of a known product adds one unit. */
    fun onSaleScan(code: String) {
        viewModelScope.launch {
            val p = repo.findByCode(code)
            if (p == null) { notFoundCode = code; scanStatus = "Not registered: $code" }
            else if (addToCart(p)) {
                val q = cart.first { it.product.id == p.id }.qtyMilli
                scanStatus = "${p.name}  ${Money.format(p.priceKobo)}  x${Qty.format(q)}  (stock ${Qty.format(p.stockMilli)})"
            }
        }
    }
    fun addByCode(code: String) = onSaleScan(code.trim())

    fun completeSale(pays: List<PayIn>, onDone: (Long) -> Unit) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val sale = repo.completeSale(SaleRequest(token, cart.toList(), discountKobo, pays, s("cashier"), totals().total))
                cart.clear(); discountKobo = 0; token = UUID.randomUUID().toString()
                onDone(sale.id)
            } catch (e: PosException) { toast(e.message ?: "Error") }
            catch (e: Exception) { Log.e("PosVM", "sale failed", e); toast("Could not save the sale. Nothing was changed.") }
            finally { busy = false }
        }
    }

    // ---- products / stock ----
    fun saveProduct(p: Product, done: (Long) -> Unit) = launchSafe { val id = repo.saveProduct(p); toast("Product saved"); done(id) }
    fun setActive(id: Long, active: Boolean) = launchSafe { repo.setActive(id, active); toast(if (active) "Product activated" else "Product deactivated") }
    fun adjust(pid: Long, delta: Long, type: String, reason: String, note: String?, cost: Long?, done: () -> Unit) =
        launchSafe { repo.adjustStock(pid, delta, type, reason, note, cost); toast("Stock updated"); done() }

    // ---- sales ----
    fun refund(id: Long, reason: String, done: () -> Unit) = launchSafe { repo.refund(id, reason); toast("Sale refunded and stock restored"); done() }
    suspend fun detail(id: Long) = repo.saleDetail(id)

    // ---- backup ----
    fun backupJson(cb: (String) -> Unit) = launchSafe { cb(repo.exportBackup()) }
    fun restore(json: String) = launchSafe { toast(repo.restoreBackup(json)) }

    suspend fun report(f: Long, t: Long) = repo.report(f, t)

    companion object {
        /** Start/end of the day [offset] days from today. */
        fun dayRange(offsetDays: Int): Pair<Long, Long> {
            val c = Calendar.getInstance()
            c.add(Calendar.DAY_OF_YEAR, offsetDays)
            c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
            val start = c.timeInMillis
            return start to (start + 24L * 3600 * 1000 - 1)
        }
    }
}
