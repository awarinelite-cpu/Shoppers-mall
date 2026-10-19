package com.provisionpos.ui

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.provisionpos.data.Payment
import com.provisionpos.data.Sale
import com.provisionpos.data.SaleItem
import com.provisionpos.domain.*
import java.io.File

object Receipt {
    fun text(s: Map<String, String>, sale: Sale, items: List<SaleItem>, pays: List<Payment>): String = buildString {
        appendLine(s["store_name"] ?: "Store")
        s["address"]?.takeIf { it.isNotBlank() }?.let { appendLine(it) }
        s["phone"]?.takeIf { it.isNotBlank() }?.let { appendLine("Tel: $it") }
        appendLine("--------------------------------")
        appendLine("Receipt No: ${sale.receiptNo}")
        appendLine("Date: ${Fmt.dateTime(sale.createdAt)}")
        if (sale.cashier.isNotBlank()) appendLine("Served by: ${sale.cashier}")
        if (sale.status == "REFUNDED") appendLine("*** REFUNDED ***")
        appendLine("--------------------------------")
        items.forEach {
            appendLine(it.productName)
            appendLine("  ${Qty.format(it.qtyMilli)} x ${Money.format(it.unitPriceKobo)} = ${Money.format(it.lineTotalKobo)}")
        }
        appendLine("--------------------------------")
        appendLine("Subtotal: ${Money.format(sale.subtotal)}")
        if (sale.discount > 0) appendLine("Discount: -${Money.format(sale.discount)}")
        if (sale.tax > 0) appendLine("Tax: ${Money.format(sale.tax)}")
        appendLine("TOTAL: ${Money.format(sale.total)}")
        pays.forEach { appendLine("Paid (${Methods.label(it.method)}): ${Money.format(it.amountKobo)}") }
        if (sale.changeDue > 0) {
            appendLine("Amount tendered: ${Money.format(sale.tendered)}")
            appendLine("Change: ${Money.format(sale.changeDue)}")
        }
        appendLine("--------------------------------")
        appendLine(s["footer"] ?: "Thank you!")
    }

    fun shareText(ctx: Context, text: String, subject: String) {
        val i = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text); putExtra(Intent.EXTRA_SUBJECT, subject) }
        ctx.startActivity(Intent.createChooser(i, "Share"))
    }

    fun shareCsv(ctx: Context, name: String, csv: String) {
        val dir = File(ctx.cacheDir, "exports").apply { mkdirs() }
        val f = File(dir, name).apply { writeText(csv) }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        val i = Intent(Intent.ACTION_SEND).apply { type = "text/csv"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        ctx.startActivity(Intent.createChooser(i, "Share"))
    }
}
