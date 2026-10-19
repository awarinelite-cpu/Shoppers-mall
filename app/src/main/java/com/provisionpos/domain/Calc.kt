package com.provisionpos.domain

import java.math.BigDecimal
import java.math.RoundingMode

data class Totals(val subtotal: Long, val discount: Long, val tax: Long, val total: Long)
data class PayIn(val method: String, val amount: Long)
data class Settlement(val tendered: Long, val change: Long, val applied: List<PayIn>)

object Calc {
    fun lineTotal(unitPriceKobo: Long, qtyMilli: Long): Long =
        BigDecimal(unitPriceKobo).multiply(BigDecimal(qtyMilli))
            .divide(BigDecimal(1000), 0, RoundingMode.HALF_UP).toLong()

    /** taxBps = tax in basis points (7.5% = 750). Tax applies to (subtotal - discount). */
    fun totals(lineTotals: List<Long>, discount: Long, taxBps: Int): Totals {
        val subtotal = lineTotals.sum()
        val d = discount.coerceIn(0, subtotal)
        val base = subtotal - d
        val tax = BigDecimal(base).multiply(BigDecimal(taxBps)).divide(BigDecimal(10000), 0, RoundingMode.HALF_UP).toLong()
        return Totals(subtotal, d, tax, base + tax)
    }

    /**
     * Validates payments against the total. Non-cash payments must be exact portions;
     * only cash can produce change. Returned [Settlement.applied] has cash reduced by the change.
     */
    fun settle(total: Long, payments: List<PayIn>): Settlement {
        val pos = payments.filter { it.amount > 0 }
        if (pos.isEmpty()) throw PosException("Enter a payment amount")
        val tendered = pos.sumOf { it.amount }
        val cash = pos.filter { it.method == "CASH" }.sumOf { it.amount }
        val nonCash = tendered - cash
        if (nonCash > total) throw PosException("Non-cash payments exceed the total")
        if (tendered < total) throw PosException("Amount received is less than the total due")
        val change = tendered - total
        var toRemove = change
        val applied = pos.reversed().map { p ->
            if (p.method == "CASH" && toRemove > 0) {
                val cut = minOf(toRemove, p.amount); toRemove -= cut; PayIn(p.method, p.amount - cut)
            } else p
        }.reversed().filter { it.amount > 0 }
        return Settlement(tendered, change, applied)
    }
}
