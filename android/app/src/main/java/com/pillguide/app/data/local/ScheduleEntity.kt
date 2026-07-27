package com.pillguide.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "schedule")
data class ScheduleEntity(
    @PrimaryKey val id: String,
    val itemSeq: String,
    val name: String,
    val tag: String,
    val time: String,
    val timing: String,
    val effect: String,
    val caution: String,
    val durWarning: String?,
    val imageUrl: String,
    val entpName: String,
    val taken: Boolean = false,
    val bagMetaJson: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)
