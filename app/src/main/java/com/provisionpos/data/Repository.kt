package com.provisionpos.data

import androidx.room.withTransaction
import com.google.gson.Gson
import com.provisionpos.domain.*
import java.security.MessageDigest
import java.util.Locale

data class CartLine(val product: Product, val qtyMilli: Long)

data class SaleRequest(
    val token: String,
    val lines: List<CartLine>,
    val discountKobo: Long,
    val payments: List<PayIn>,
    val cashier: String,
    val expectedTotal: Long
)

data class ProductReportLine(val name: String, val category: String, val qtyMilli: Long, val revenue: Long)

data class Report(
    val from: Long, val to: Long,
    val saleCount: Int, val totalSales: Long, val netSales: Long, val discount: Long, val tax: Long,
    val itemsMilli: Long, val avgSale: Long,
    val byMethod: Map<String, Long>,
    val byProduct: List<ProductReportLine>,
    val byCategory: Map<String, Long>,
    val trend: List<Pair<String, Long>>,
    val cogs: Long, val uncostedLines: Int, val grossProfit: Long?,
    val refundedCount: Int, val refundedTotal: Long
)

data class Backup(
    val format: String = "provision-pos-backup",
    val version: Int = 1,
    val createdAt: Long = 0,
    val products: List<Product> = emptyList(),
    val sales: List<Sale> = emptyList(),
    val saleItems: List<SaleItem> = emptyList(),
    val payments: List<Payment> = emptyList(),
    val movements: List<StockMovement> = emptyList(),
    val settings: List<Setting> = emptyList()
)

class Repository(val db: AppDatabase) {
    private val products = db.products()
    private val sales = db.sales()
    private val stock = db.stock()
    private val settings = db.settings()

    val productsFlow = products.observeAll()
    val salesFlow = sales.observeAll()
    val movementsFlow = stock.observeAll()
    val settingsFlow = settings.observeAll()
    fun movementsFor(pid: Long) = stock.observeFor(pid)

    suspend fun setting(key: String): String? = settings.get(key)
    suspend fun putSetting(key: String, value: String) = settings.put(Setting(key, value))
    suspend fun putSettings(map: Map<String, String>) = settings.putAll(map.map { Setting(it.key, it.value) })

    suspend fun findByCode(code: String): Product? = products.byCode(code.trim())
    suspend fun product(id: Long): Product? = products.byId(id)

    // ---------- Products ----------
    suspend fun saveProduct(input: Product): Long = db.withTransaction {
        val now = System.currentTimeMillis()
        if (input.name.isBlank()) throw PosException("Product name is required")
        if (input.priceKobo < 0) throw PosException("Selling price cannot be negative")
        if ((input.costKobo ?: 0) < 0) throw PosException("Purchase cost cannot be negative")
        if (input.stockMilli < 0 || input.lowThresholdMilli < 0) throw PosException("Quantities cannot be negative")
        val bc = input.barcode?.trim()?.ifBlank { null }
        val alt = input.altBarcode?.trim()?.ifBlank { null }
        if (bc != null && bc == alt) throw PosException("Alternative barcode must differ from the barcode")
        for (code in listOfNotNull(bc, alt)) {
            val other = products.byCode(code)
            if (other != null && other.id != input.id)
                throw PosException("Barcode $code already belongs to \"${other.name}\"")
        }
        val clean = input.copy(name = input.name.trim(), barcode = bc, altBarcode = alt)
        if (input.id == 0L) {
            val id = products.insert(clean.copy(createdAt = now, updatedAt = now, internalCode = "TMP"))
            val code = clean.internalCode.ifBlank { "P" + String.format(Locale.US, "%05d", id) }
            products.update(clean.copy(id = id, internalCode = code, createdAt = now, updatedAt = now))
            if (clean.stockMilli > 0)
                stock.insert(StockMovement(productId = id, productName = clean.name, type = "OPENING",
                    changeMilli = clean.stockMilli, prevMilli = 0, newMilli = clean.stockMilli, reason = "Opening stock", createdAt = now))
            id
        } else {
            val existing = products.byId(input.id) ?: throw PosException("Product not found")
            // Stock is only changed through stock adjustments and sales.
            products.update(clean.copy(stockMilli = existing.stockMilli, createdAt = existing.createdAt, updatedAt = now,
                internalCode = clean.internalCode.ifBlank { existing.internalCode }))
            input.id
        }
    }

    suspend fun setActive(id: Long, active: Boolean) {
        val p = products.byId(id) ?: return
        products.update(p.copy(active = active, updatedAt = System.currentTimeMillis()))
    }

    // ---------- Stock ----------
    /** deltaMilli is signed. Result may not go below zero. */
    suspend fun adjustStock(pid: Long, deltaMilli: Long, type: String, reason: String, note: String?, newCost: Long?) = db.withTransaction {
        val p = products.byId(pid) ?: throw PosException("Product not found")
        if (deltaMilli == 0L) throw PosException("Enter a quantity")
        val newQty = p.stockMilli + deltaMilli
        if (newQty < 0) throw PosException("Cannot remove more than the ${Qty.format(p.stockMilli)} in stock")
        val now = System.currentTimeMillis()
        products.update(p.copy(stockMilli = newQty, costKobo = newCost ?: p.costKobo, updatedAt = now))
        stock.insert(StockMovement(productId = pid, productName = p.name, type = type, changeMilli = deltaMilli,
            prevMilli = p.stockMilli, newMilli = newQty, reason = reason, note = note?.ifBlank { null }, createdAt = now))
    }

    // ---------- Sales ----------
    suspend fun completeSale(req: SaleRequest): Sale = db.withTransaction {
        sales.byToken(req.token)?.let { return@withTransaction it }   // idempotent: double tap / retry
        if (req.lines.isEmpty()) throw PosException("The cart is empty")
        val allowNeg = settings.get("allow_negative") == "1"
        val taxBps = settings.get("tax_bps")?.toIntOrNull() ?: 0
        val now = System.currentTimeMillis()

        // Re-read every product inside the transaction: price, active flag and stock are re-checked.
        val fresh = req.lines.map { l ->
            val p = products.byId(l.product.id) ?: throw PosException("${l.product.name} no longer exists")
            if (!p.active) throw PosException("${p.name} has been deactivated. Remove it from the cart.")
            if (l.qtyMilli <= 0) throw PosException("Invalid quantity for ${p.name}")
            if (!allowNeg && p.stockMilli < l.qtyMilli)
                throw PosException("Not enough stock for ${p.name}: ${Qty.format(p.stockMilli)} available")
            p to l.qtyMilli
        }
        val lineTotals = fresh.map { (p, q) -> Calc.lineTotal(p.priceKobo, q) }
        val totals = Calc.totals(lineTotals, req.discountKobo, taxBps)
        if (totals.total != req.expectedTotal) throw PosException("Prices changed since the cart was built. Review the cart.")
        val settlement = Calc.settle(totals.total, req.payments)

        val counter = (settings.get("receipt_counter")?.toLongOrNull() ?: 0L) + 1
        settings.put(Setting("receipt_counter", counter.toString()))
        val prefix = settings.get("receipt_prefix")?.ifBlank { null } ?: "POS"
        val receiptNo = prefix + "-" + String.format(Locale.US, "%06d", counter)

        val saleId = sales.insertSale(Sale(
            receiptNo = receiptNo, clientToken = req.token, createdAt = now,
            subtotal = totals.subtotal, discount = totals.discount, tax = totals.tax, total = totals.total,
            tendered = settlement.tendered, changeDue = settlement.change,
            methods = settlement.applied.map { it.method }.distinct().joinToString(","), cashier = req.cashier
        ))
        val items = ArrayList<SaleItem>()
        fresh.forEachIndexed { i, (p, q) ->
            val rows = products.deduct(p.id, q, now, if (allowNeg) 1 else 0)
            if (rows == 0) throw PosException("Not enough stock for ${p.name}")
            stock.insert(StockMovement(productId = p.id, productName = p.name, type = "SALE", changeMilli = -q,
                prevMilli = p.stockMilli, newMilli = p.stockMilli - q, reason = "Sale $receiptNo", refId = saleId, createdAt = now))
            items += SaleItem(saleId = saleId, productId = p.id, productName = p.name, barcode = p.barcode, category = p.category,
                unit = p.unit, qtyMilli = q, unitPriceKobo = p.priceKobo, unitCostKobo = p.costKobo, lineTotalKobo = lineTotals[i])
        }
        sales.insertItems(items)
        sales.insertPayments(settlement.applied.map { Payment(saleId = saleId, method = it.method, amountKobo = it.amount, createdAt = now) })
        sales.byId(saleId)!!
    }

    suspend fun saleDetail(id: Long): Triple<Sale, List<SaleItem>, List<Payment>>? {
        val s = sales.byId(id) ?: return null
        return Triple(s, sales.items(id), sales.payments(id))
    }

    /** Full reversal. The sale stays in history, marked REFUNDED, and stock is restored via movements. */
    suspend fun refund(id: Long, reason: String) = db.withTransaction {
        val s = sales.byId(id) ?: throw PosException("Sale not found")
        if (s.status != "COMPLETED") throw PosException("This sale was already refunded")
        val now = System.currentTimeMillis()
        for (it in sales.items(id)) {
            val pid = it.productId ?: continue
            val p = products.byId(pid) ?: continue
            products.add(pid, it.qtyMilli, now)
            stock.insert(StockMovement(productId = pid, productName = p.name, type = "REFUND", changeMilli = it.qtyMilli,
                prevMilli = p.stockMilli, newMilli = p.stockMilli + it.qtyMilli, reason = "Refund ${s.receiptNo}",
                note = reason.ifBlank { null }, refId = id, createdAt = now))
        }
        sales.updateSale(s.copy(status = "REFUNDED", refundedAt = now, refundReason = reason.ifBlank { null }))
    }

    // ---------- Reports ----------
    suspend fun report(from: Long, to: Long): Report {
        val all = sales.range(from, to)
        val done = all.filter { it.status == "COMPLETED" }
        val refunded = all.filter { it.status == "REFUNDED" }
        val items = sales.itemsInRange(from, to)
        val pays = sales.paymentsInRange(from, to)
        val cogs = items.filter { it.unitCostKobo != null }.sumOf { Calc.lineTotal(it.unitCostKobo!!, it.qtyMilli) }
        val uncosted = items.count { it.unitCostKobo == null }
        val net = done.sumOf { it.subtotal - it.discount }
        val total = done.sumOf { it.total }
        val trend = done.groupBy { Fmt.date(it.createdAt) }.toSortedMap().map { (d, l) -> d to l.sumOf { it.total } }
        return Report(
            from, to, done.size, total, net, done.sumOf { it.discount }, done.sumOf { it.tax },
            items.sumOf { it.qtyMilli }, if (done.isEmpty()) 0 else total / done.size,
            pays.groupBy { it.method }.mapValues { e -> e.value.sumOf { it.amountKobo } },
            items.groupBy { it.productName to it.category }
                .map { (k, l) -> ProductReportLine(k.first, k.second, l.sumOf { it.qtyMilli }, l.sumOf { it.lineTotalKobo }) }
                .sortedByDescending { it.revenue },
            items.groupBy { it.category.ifBlank { "Uncategorised" } }.mapValues { e -> e.value.sumOf { it.lineTotalKobo } },
            trend, cogs, uncosted, if (uncosted == 0) net - cogs else null,
            refunded.size, refunded.sumOf { it.total }
        )
    }

    suspend fun movementsInRange(from: Long, to: Long) = stock.range(from, to)

    // ---------- PIN ----------
    private fun hash(pin: String, salt: String): String =
        MessageDigest.getInstance("SHA-256").digest((salt + pin).toByteArray()).joinToString("") { "%02x".format(it) }

    suspend fun hasPin() = !settings.get("pin_hash").isNullOrBlank()
    suspend fun setPin(pin: String?) {
        if (pin.isNullOrBlank()) { putSetting("pin_hash", ""); putSetting("pin_salt", ""); return }
        val salt = java.util.UUID.randomUUID().toString()
        putSetting("pin_salt", salt); putSetting("pin_hash", hash(pin, salt))
    }
    suspend fun checkPin(pin: String): Boolean {
        val h = settings.get("pin_hash") ?: return true
        if (h.isBlank()) return true
        return hash(pin, settings.get("pin_salt") ?: "") == h
    }

    // ---------- Backup / restore ----------
    suspend fun exportBackup(): String {
        val b = db.backup()
        return Gson().toJson(Backup(createdAt = System.currentTimeMillis(), products = b.products(), sales = b.sales(),
            saleItems = b.items(), payments = b.payments(), movements = b.movements(), settings = settings.all()))
    }

    /** Validates then replaces all data in one transaction. Nothing changes if validation or insertion fails. */
    suspend fun restoreBackup(json: String): String {
        val bk = try { Gson().fromJson(json, Backup::class.java) } catch (e: Exception) { null }
        if (bk == null || bk.format != "provision-pos-backup") throw PosException("This is not a Provision POS backup file")
        if (bk.version > 1) throw PosException("Backup was made by a newer app version (v${bk.version}). Update the app first.")
        val pids = bk.products.map { it.id }.toSet()
        val sids = bk.sales.map { it.id }.toSet()
        if (pids.size != bk.products.size || sids.size != bk.sales.size) throw PosException("Backup contains duplicate records")
        if (bk.sales.map { it.receiptNo }.toSet().size != bk.sales.size) throw PosException("Backup contains duplicate receipt numbers")
        if (bk.saleItems.any { it.saleId !in sids } || bk.payments.any { it.saleId !in sids })
            throw PosException("Backup is inconsistent (items without a sale)")
        if (bk.movements.any { it.productId !in pids }) throw PosException("Backup is inconsistent (stock movement without a product)")
        val b = db.backup()
        db.withTransaction {
            b.clearItems(); b.clearPayments(); b.clearMovements(); b.clearSales(); b.clearProducts(); b.clearSettings()
            b.putProducts(bk.products); b.putSales(bk.sales); b.putItems(bk.saleItems); b.putPayments(bk.payments)
            b.putMovements(bk.movements); b.putSettings(bk.settings)
            val counter = maxOf(bk.settings.firstOrNull { it.key == "receipt_counter" }?.value?.toLongOrNull() ?: 0L, bk.sales.size.toLong())
            settings.put(Setting("receipt_counter", counter.toString()))
        }
        return "Restored ${bk.products.size} products and ${bk.sales.size} sales"
    }
}
