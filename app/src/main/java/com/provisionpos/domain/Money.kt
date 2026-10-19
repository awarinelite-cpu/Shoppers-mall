package com.provisionpos.domain

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PosException(message: String) : Exception(message)

/** Money is stored as Long kobo. Quantities are stored as Long thousandths of a unit ("milli"). */
object Money {
    fun format(kobo: Long): String {
        val neg = kobo < 0
        val a = Math.abs(kobo)
        val s = "₦" + String.format(Locale.US, "%,d", a / 100) + "." + String.format(Locale.US, "%02d", a % 100)
        return if (neg) "-$s" else s
    }

    /** Parses "1,500.50" or "₦1500" into kobo. Returns null if invalid or negative. */
    fun parse(text: String): Long? = try {
        val clean = text.replace(",", "").replace("₦", "").trim()
        if (clean.isEmpty()) null
        else BigDecimal(clean).setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValueExact().takeIf { it >= 0 }
    } catch (e: Exception) { null }
}

object Qty {
    const val ONE = 1000L
    fun format(milli: Long): String {
        val bd = BigDecimal(milli).movePointLeft(3).stripTrailingZeros()
        return bd.toPlainString()
    }
    fun parse(text: String): Long? = try {
        val t = text.trim()
        if (t.isEmpty()) null
        else BigDecimal(t).setScale(3, RoundingMode.HALF_UP).movePointRight(3).longValueExact().takeIf { it >= 0 }
    } catch (e: Exception) { null }
}

object Fmt {
    fun dateTime(ms: Long): String = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.ENGLISH).format(Date(ms))
    fun date(ms: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).format(Date(ms))
    fun parseDate(s: String): Long? = try {
        SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).apply { isLenient = false }.parse(s.trim())?.time
    } catch (e: Exception) { null }
}

object Units {
    val all = listOf("PIECE", "PACK", "CARTON", "KG", "G", "LITRE", "ML")
    fun label(u: String) = when (u) {
        "PIECE" -> "piece(s)"; "PACK" -> "pack(s)"; "CARTON" -> "carton(s)"
        "KG" -> "kg"; "G" -> "g"; "LITRE" -> "litre(s)"; "ML" -> "ml"; else -> u.lowercase()
    }
}

object Methods {
    val all = listOf("CASH", "TRANSFER", "POS", "OTHER")
    fun label(m: String) = when (m) {
        "CASH" -> "Cash"; "TRANSFER" -> "Bank transfer"; "POS" -> "POS terminal"; "OTHER" -> "Other"; else -> m
    }
}
