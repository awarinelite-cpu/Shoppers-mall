package com.provisionpos.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "products",
    indices = [Index(value = ["barcode"], unique = true), Index("name"), Index("internalCode"), Index("category")]
)
data class Product(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val barcode: String? = null,
    val altBarcode: String? = null,
    val internalCode: String = "",
    val category: String = "",
    val costKobo: Long? = null,
    val priceKobo: Long,
    val stockMilli: Long = 0,
    val lowThresholdMilli: Long = 5000,
    val unit: String = "PIECE",
    val supplier: String? = null,
    val description: String? = null,
    val expiryAt: Long? = null,
    val active: Boolean = true,
    val createdAt: Long = 0,
    val updatedAt: Long = 0
)

@Entity(
    tableName = "sales",
    indices = [Index(value = ["receiptNo"], unique = true), Index(value = ["clientToken"], unique = true), Index("createdAt")]
)
data class Sale(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val receiptNo: String,
    val clientToken: String,
    val createdAt: Long,
    val subtotal: Long,
    val discount: Long,
    val tax: Long,
    val total: Long,
    val tendered: Long,
    val changeDue: Long,
    val status: String = "COMPLETED",      // COMPLETED | REFUNDED
    val paymentStatus: String = "PAID",
    val methods: String = "",              // e.g. "CASH,TRANSFER"
    val cashier: String = "",
    val refundedAt: Long? = null,
    val refundReason: String? = null
)

@Entity(
    tableName = "sale_items",
    foreignKeys = [ForeignKey(Sale::class, ["id"], ["saleId"])],
    indices = [Index("saleId"), Index("productId")]
)
data class SaleItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val saleId: Long,
    val productId: Long?,
    val productName: String,
    val barcode: String?,
    val category: String,
    val unit: String,
    val qtyMilli: Long,
    val unitPriceKobo: Long,
    val unitCostKobo: Long?,
    val lineTotalKobo: Long
)

@Entity(
    tableName = "payments",
    foreignKeys = [ForeignKey(Sale::class, ["id"], ["saleId"])],
    indices = [Index("saleId")]
)
data class Payment(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val saleId: Long,
    val method: String,
    val amountKobo: Long,
    val reference: String? = null,
    val createdAt: Long,
    val status: String = "RECEIVED"
)

@Entity(tableName = "stock_movements", indices = [Index("productId"), Index("createdAt")])
data class StockMovement(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val productId: Long,
    val productName: String,
    val type: String,   // OPENING | RECEIVED | SALE | REFUND | DAMAGED | EXPIRED | LOSS | CORRECTION
    val changeMilli: Long,
    val prevMilli: Long,
    val newMilli: Long,
    val reason: String = "",
    val note: String? = null,
    val refId: Long? = null,
    val createdAt: Long
)

@Entity(tableName = "settings")
data class Setting(@PrimaryKey val key: String, val value: String)
