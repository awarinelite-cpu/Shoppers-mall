package com.provisionpos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Insert suspend fun insert(p: Product): Long
    @Update suspend fun update(p: Product)
    @Query("SELECT * FROM products WHERE id = :id") suspend fun byId(id: Long): Product?
    @Query("SELECT * FROM products WHERE barcode = :c OR altBarcode = :c OR internalCode = :c LIMIT 1")
    suspend fun byCode(c: String): Product?
    @Query("SELECT * FROM products ORDER BY name COLLATE NOCASE") fun observeAll(): Flow<List<Product>>
    @Query("SELECT * FROM products WHERE id = :id") fun observe(id: Long): Flow<Product?>

    @Query("UPDATE products SET stockMilli = stockMilli - :q, updatedAt = :now WHERE id = :id AND (stockMilli >= :q OR :allowNeg = 1)")
    suspend fun deduct(id: Long, q: Long, now: Long, allowNeg: Int): Int
    @Query("UPDATE products SET stockMilli = stockMilli + :q, updatedAt = :now WHERE id = :id")
    suspend fun add(id: Long, q: Long, now: Long): Int
}

@Dao
interface SaleDao {
    @Insert suspend fun insertSale(s: Sale): Long
    @Insert suspend fun insertItems(l: List<SaleItem>)
    @Insert suspend fun insertPayments(l: List<Payment>)
    @Update suspend fun updateSale(s: Sale)
    @Query("SELECT * FROM sales WHERE id = :id") suspend fun byId(id: Long): Sale?
    @Query("SELECT * FROM sales WHERE clientToken = :t LIMIT 1") suspend fun byToken(t: String): Sale?
    @Query("SELECT * FROM sale_items WHERE saleId = :id") suspend fun items(id: Long): List<SaleItem>
    @Query("SELECT * FROM payments WHERE saleId = :id") suspend fun payments(id: Long): List<Payment>
    @Query("SELECT * FROM sales ORDER BY createdAt DESC") fun observeAll(): Flow<List<Sale>>
    @Query("SELECT * FROM sales WHERE createdAt BETWEEN :f AND :t ORDER BY createdAt ASC") suspend fun range(f: Long, t: Long): List<Sale>
    @Query("SELECT si.* FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE s.status = 'COMPLETED' AND s.createdAt BETWEEN :f AND :t")
    suspend fun itemsInRange(f: Long, t: Long): List<SaleItem>
    @Query("SELECT p.* FROM payments p JOIN sales s ON s.id = p.saleId WHERE s.status = 'COMPLETED' AND s.createdAt BETWEEN :f AND :t")
    suspend fun paymentsInRange(f: Long, t: Long): List<Payment>
}

@Dao
interface StockDao {
    @Insert suspend fun insert(m: StockMovement): Long
    @Insert suspend fun insertAll(l: List<StockMovement>)
    @Query("SELECT * FROM stock_movements ORDER BY createdAt DESC, id DESC LIMIT 500") fun observeAll(): Flow<List<StockMovement>>
    @Query("SELECT * FROM stock_movements WHERE productId = :pid ORDER BY createdAt DESC, id DESC LIMIT 200")
    fun observeFor(pid: Long): Flow<List<StockMovement>>
    @Query("SELECT * FROM stock_movements WHERE createdAt BETWEEN :f AND :t ORDER BY createdAt ASC")
    suspend fun range(f: Long, t: Long): List<StockMovement>
}

@Dao
interface SettingDao {
    @Query("SELECT value FROM settings WHERE key = :k") suspend fun get(k: String): String?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(s: Setting)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putAll(l: List<Setting>)
    @Query("SELECT * FROM settings") fun observeAll(): Flow<List<Setting>>
    @Query("SELECT * FROM settings") suspend fun all(): List<Setting>
}

@Dao
interface BackupDao {
    @Query("SELECT * FROM products") suspend fun products(): List<Product>
    @Query("SELECT * FROM sales") suspend fun sales(): List<Sale>
    @Query("SELECT * FROM sale_items") suspend fun items(): List<SaleItem>
    @Query("SELECT * FROM payments") suspend fun payments(): List<Payment>
    @Query("SELECT * FROM stock_movements") suspend fun movements(): List<StockMovement>

    @Query("DELETE FROM sale_items") suspend fun clearItems()
    @Query("DELETE FROM payments") suspend fun clearPayments()
    @Query("DELETE FROM stock_movements") suspend fun clearMovements()
    @Query("DELETE FROM sales") suspend fun clearSales()
    @Query("DELETE FROM products") suspend fun clearProducts()
    @Query("DELETE FROM settings") suspend fun clearSettings()

    @Insert suspend fun putProducts(l: List<Product>)
    @Insert suspend fun putSales(l: List<Sale>)
    @Insert suspend fun putItems(l: List<SaleItem>)
    @Insert suspend fun putPayments(l: List<Payment>)
    @Insert suspend fun putMovements(l: List<StockMovement>)
    @Insert suspend fun putSettings(l: List<Setting>)
}
