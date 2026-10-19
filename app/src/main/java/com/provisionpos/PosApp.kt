package com.provisionpos

import android.app.Application
import com.provisionpos.data.AppDatabase
import com.provisionpos.data.Repository

class PosApp : Application() {
    val db by lazy { AppDatabase.build(this) }
    val repo by lazy { Repository(db) }
}
