package com.provisionpos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.provisionpos.data.*
import com.provisionpos.domain.*
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SaleRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var repo: Repository

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).build()
        repo = Repository(db)
    }
    @After fun tearDown() { db.close() }

    private suspend fun addProduct(name: String, barcode: String?, price: Long, stock: Long, cost: Long? = 30000) =
        repo.product(repo.saveProduct(Product(name = name, barcode = barcode, priceKobo = price, costKobo = cost, stockMilli = stock)))!!

    private fun req(token: String, p: Product, qty: Long, total: Long, paid: Long) =
        SaleRequest(token, listOf(CartLine(p, qty)), 0, listOf(PayIn("CASH", paid)), "T", total)

    @Test fun saleDeductsStockAndKeepsPrice() = runBlocking {
        val p = addProduct("Indomie", "111", 50000, 10000)
        val sale = repo.completeSale(req("t1", p, 3000, 150000, 200000))
        assertEquals(50000L, sale.changeDue)
        assertEquals(7000L, repo.product(p.id)!!.stockMilli)
        repo.saveProduct(repo.product(p.id)!!.copy(priceKobo = 70000))
        assertEquals(50000L, repo.saleDetail(sale.id)!!.second.first().unitPriceKobo)
    }
    @Test fun doubleSubmitCreatesOneSale() = runBlocking {
        val p = addProduct("Rice", "222", 100000, 10000)
        val a = repo.completeSale(req("same", p, 1000, 100000, 100000))
        val b = repo.completeSale(req("same", p, 1000, 100000, 100000))
        assertEquals(a.id, b.id); assertEquals(9000L, repo.product(p.id)!!.stockMilli)
    }
    @Test fun insufficientStockRollsBack() = runBlocking {
        val p = addProduct("Sugar", "333", 20000, 2000)
        try { repo.completeSale(req("t3", p, 5000, 100000, 100000)); fail() } catch (e: PosException) {}
        assertEquals(2000L, repo.product(p.id)!!.stockMilli)
        assertNull(db.sales().byToken("t3"))
    }
    @Test fun duplicateBarcodeRejected() = runBlocking {
        addProduct("A", "999", 100, 0)
        try { addProduct("B", "999", 100, 0); fail() } catch (e: PosException) {}
    }
    @Test fun refundRestoresStock() = runBlocking {
        val p = addProduct("Milk", "444", 100000, 5000)
        val s = repo.completeSale(req("t5", p, 2000, 200000, 200000))
        repo.refund(s.id, "test")
        assertEquals(5000L, repo.product(p.id)!!.stockMilli)
        assertEquals("REFUNDED", db.sales().byId(s.id)!!.status)
    }
    @Test fun backupRestoreRoundTripNoDuplicates() = runBlocking {
        val p = addProduct("Salt", "555", 10000, 5000)
        repo.completeSale(req("t6", p, 1000, 10000, 10000))
        val json = repo.exportBackup()
        repo.restoreBackup(json); repo.restoreBackup(json)
        assertEquals(1, db.backup().sales().size); assertEquals(1, db.backup().products().size)
        val next = repo.completeSale(req("t7", repo.product(p.id)!!, 1000, 10000, 10000))
        assertEquals("POS-000002", next.receiptNo)
    }
}
