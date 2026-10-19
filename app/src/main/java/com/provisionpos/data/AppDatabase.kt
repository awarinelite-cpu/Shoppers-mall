package com.provisionpos.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration

@Database(
    entities = [Product::class, Sale::class, SaleItem::class, Payment::class, StockMovement::class, Setting::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun products(): ProductDao
    abstract fun sales(): SaleDao
    abstract fun stock(): StockDao
    abstract fun settings(): SettingDao
    abstract fun backup(): BackupDao

    companion object {
        /** Add Migration objects here when the schema version increases. Never use destructive migration. */
        val MIGRATIONS: Array<Migration> = arrayOf()

        fun build(ctx: Context): AppDatabase =
            Room.databaseBuilder(ctx.applicationContext, AppDatabase::class.java, "provision_pos.db")
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
