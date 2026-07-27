package com.pillguide.app.utils

import android.content.Context
import android.speech.tts.TextToSpeech
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TtsHelper @Inject constructor(
    @ApplicationContext context: Context,
) {
    private var tts: TextToSpeech? = null
    private var ready = false

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                tts?.language = Locale.KOREAN
                tts?.setSpeechRate(0.95f)
            }
        }
    }

    fun speak(text: String) {
        if (!ready || text.isBlank()) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pillguide")
    }

    fun speakPill(name: String, tag: String = "", timing: String = "") {
        val body = buildString {
            append("이 약은 ").append(name).append("입니다.")
            if (tag.isNotBlank()) append(" ").append(tag).append(".")
            if (timing.isNotBlank()) append(" ").append(timing)
        }
        speak(body)
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
    }
}
