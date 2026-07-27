package com.pillguide.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ScheduleDao {
    @Query("SELECT * FROM schedule ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<ScheduleEntity>>

    @Query("SELECT * FROM schedule ORDER BY createdAt DESC")
    suspend fun getAll(): List<ScheduleEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: ScheduleEntity): Long

    @Update
    suspend fun update(entity: ScheduleEntity)

    @Query("UPDATE schedule SET taken = :taken WHERE id = :id")
    suspend fun setTaken(id: String, taken: Boolean)

    @Query("DELETE FROM schedule WHERE id = :id")
    suspend fun delete(id: String)
}
