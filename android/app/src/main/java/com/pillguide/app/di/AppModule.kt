package com.pillguide.app.di

import android.content.Context
import androidx.room.Room
import com.pillguide.app.BuildConfig
import com.pillguide.app.ai.ClassicalPillDetector
import com.pillguide.app.ai.PillDetector
import com.pillguide.app.ai.YoloPillDetector
import com.pillguide.app.data.local.AppDatabase
import com.pillguide.app.data.local.ScheduleDao
import com.pillguide.app.data.remote.AiServerApi
import com.pillguide.app.data.remote.DataGoApi
import com.pillguide.app.ocr.MlKitOcrEngine
import com.pillguide.app.ocr.OcrEngine
import com.pillguide.app.ocr.ServerOcrEngine
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideMoshi(): Moshi =
        Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()

    @Provides
    @Singleton
    fun provideOkHttp(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val serviceKeyInterceptor = Interceptor { chain ->
            val original = chain.request()
            val url = original.url.newBuilder()
                .addQueryParameter("serviceKey", BuildConfig.DATA_GO_API_KEY)
                .addQueryParameter("type", "json")
                .build()
            chain.proceed(original.newBuilder().url(url).build())
        }
        return OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(serviceKeyInterceptor)
            .addInterceptor(logging)
            .build()
    }

    @Provides
    @Singleton
    fun provideDataGoApi(client: OkHttpClient, moshi: Moshi): DataGoApi =
        Retrofit.Builder()
            .baseUrl(BuildConfig.DATA_GO_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(DataGoApi::class.java)

    @Provides
    @Singleton
    fun provideAiServerApi(moshi: Moshi): AiServerApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.AI_SERVER_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(AiServerApi::class.java)
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "pill_guide.db").build()

    @Provides
    fun provideScheduleDao(db: AppDatabase): ScheduleDao = db.scheduleDao()

    @Provides
    @Singleton
    @Named("mlkit")
    fun provideMlKitOcr(@ApplicationContext context: Context): OcrEngine = MlKitOcrEngine(context)

    @Provides
    @Singleton
    @Named("server")
    fun provideServerOcr(aiServerApi: AiServerApi): OcrEngine = ServerOcrEngine(aiServerApi)

    @Provides
    @Singleton
    fun provideDefaultOcr(@Named("mlkit") ocr: OcrEngine): OcrEngine = ocr

    @Provides
    @Singleton
    fun providePillDetector(@ApplicationContext context: Context): PillDetector {
        val yolo = YoloPillDetector(context)
        return if (yolo.isModelAvailable()) yolo else ClassicalPillDetector()
    }
}
