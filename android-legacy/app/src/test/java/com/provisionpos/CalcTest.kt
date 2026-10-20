package com.provisionpos

import com.provisionpos.domain.*
import org.junit.Assert.*
import org.junit.Test

class CalcTest {
    @Test fun formatsNaira() { assertEquals("₦1,500.00", Money.format(150000)); assertEquals("₦0.05", Money.format(5)) }
    @Test fun parsesMoney() { assertEquals(150050L, Money.parse("1,500.50")); assertNull(Money.parse("-5")); assertNull(Money.parse("abc")) }
    @Test fun parsesQty() { assertEquals(2500L, Qty.parse("2.5")); assertEquals("2.5", Qty.format(2500)); assertEquals("3", Qty.format(3000)) }
    @Test fun lineTotalFractional() { assertEquals(125000L, Calc.lineTotal(50000, 2500)) }   // 2.5 x ₦500
    @Test fun totalsSeveralItems() {
        val t = Calc.totals(listOf(150000, 80000, 25050), 5000, 0)
        assertEquals(255050L, t.subtotal); assertEquals(250050L, t.total)
    }
    @Test fun taxAppliesAfterDiscount() {
        val t = Calc.totals(listOf(100000), 10000, 750)   // 7.5% of 90,000 kobo
        assertEquals(6750L, t.tax); assertEquals(96750L, t.total)
    }
    @Test fun discountCannotExceedSubtotal() { assertEquals(100L, Calc.totals(listOf(100), 999, 0).discount) }
    @Test fun cashChange() {
        val s = Calc.settle(150000, listOf(PayIn("CASH", 200000)))
        assertEquals(50000L, s.change); assertEquals(150000L, s.applied.sumOf { it.amount })
    }
    @Test fun insufficientCashRejected() { assertThrows(PosException::class.java) { Calc.settle(150000, listOf(PayIn("CASH", 100000))) } }
    @Test fun transferMustBeExact() { assertThrows(PosException::class.java) { Calc.settle(100000, listOf(PayIn("TRANSFER", 120000))) } }
    @Test fun splitPayment() {
        val s = Calc.settle(100000, listOf(PayIn("CASH", 40000), PayIn("TRANSFER", 60000)))
        assertEquals(0L, s.change); assertEquals(2, s.applied.size)
    }
    @Test fun splitWithChangeReducesCashOnly() {
        val s = Calc.settle(100000, listOf(PayIn("TRANSFER", 60000), PayIn("CASH", 50000)))
        assertEquals(10000L, s.change); assertEquals(40000L, s.applied.first { it.method == "CASH" }.amount)
    }
}
