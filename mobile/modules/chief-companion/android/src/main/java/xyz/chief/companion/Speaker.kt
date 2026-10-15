package xyz.chief.companion

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Chief's voice inside a conversation: the same Android engine as "Test Chief's voice",
 * plus a callback when the sentence has finished, so Chief listens only after it stops talking.
 */
object Speaker {
  private const val TAG = "ChiefCompanion"
  private var tts: TextToSpeech? = null
  private var ready = false
  private val pending = ArrayList<Pair<String, () -> Unit>>()
  private val done = HashMap<String, () -> Unit>()
  private val main = Handler(Looper.getMainLooper())

  fun say(context: Context, text: String, onDone: () -> Unit) {
    main.post {
      if (tts == null) {
        tts = TextToSpeech(context.applicationContext) { status ->
          main.post {
            ready = status == TextToSpeech.SUCCESS
            if (ready) setup() else Log.e(TAG, "voice engine failed to start ($status)")
            val queued = ArrayList(pending); pending.clear()
            queued.forEach { (t, cb) -> if (ready) speakNow(t, cb) else cb() }
          }
        }
      }
      if (ready) speakNow(text, onDone) else pending.add(text to onDone)
    }
  }

  fun stop() {
    main.post {
      try { tts?.stop() } catch (_: Exception) {}
      val cbs = ArrayList(done.values); done.clear()
      cbs.forEach { it() }
    }
  }

  private fun setup() {
    val t = tts ?: return
    try { t.language = Locale("en", "IN") } catch (_: Exception) {}
    t.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    )
    t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) {}
      override fun onDone(id: String?) = finish(id)
      @Deprecated("Deprecated in Java") override fun onError(id: String?) = finish(id)
      override fun onError(id: String?, errorCode: Int) = finish(id)
      override fun onStop(id: String?, interrupted: Boolean) = finish(id)
    })
  }

  private fun finish(id: String?) {
    main.post { id?.let { done.remove(it)?.invoke() } }
  }

  private fun speakNow(text: String, onDone: () -> Unit) {
    val id = "conv-${System.nanoTime()}"
    done[id] = onDone
    val r = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
    if (r != TextToSpeech.SUCCESS) finish(id)
  }
}
