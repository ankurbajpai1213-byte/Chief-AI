package xyz.chief.companion

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.util.concurrent.Executors

/**
 * Open-source, on-device wake word ("Hey Chief" / "Chief") using Vosk.
 * No account or key needed. The recognizer only knows a tiny grammar, so it
 * listens for the wake phrase and treats everything else as unknown speech.
 */
class VoskWake(private val context: Context, private val onWake: () -> Unit, private val onError: (String) -> Unit) {
  private var service: SpeechService? = null
  private val main = Handler(Looper.getMainLooper())
  private var lastFired = 0L

  fun start() {
    stop()
    io.execute {
      try {
        val model = loadModel(context)
        val rec = Recognizer(model, SAMPLE_RATE, GRAMMAR)
        val svc = SpeechService(rec, SAMPLE_RATE)
        main.post {
          service = svc
          svc.startListening(listener)
          Log.i(TAG, "vosk wake word listening")
        }
      } catch (e: Throwable) {
        Log.e(TAG, "vosk failed: ${e.message}")
        main.post { onError("${e.javaClass.simpleName}: ${e.message ?: "wake word model failed to load"}") }
      }
    }
  }

  fun stop() {
    try { service?.stop() } catch (_: Throwable) {}
    try { service?.shutdown() } catch (_: Throwable) {}
    service = null
  }

  val running: Boolean get() = service != null

  private fun check(json: String?, key: String) {
    if (json.isNullOrBlank()) return
    val text = try { JSONObject(json).optString(key, "") } catch (_: Exception) { "" }
    if (!text.split(" ").contains("chief")) return
    val now = System.currentTimeMillis()
    if (now - lastFired < 4000) return
    lastFired = now
    onWake()
  }

  private val listener = object : RecognitionListener {
    override fun onPartialResult(hypothesis: String?) = check(hypothesis, "partial")
    override fun onResult(hypothesis: String?) = check(hypothesis, "text")
    override fun onFinalResult(hypothesis: String?) = check(hypothesis, "text")
    override fun onError(exception: Exception?) { onError("Vosk: ${exception?.message ?: "listening error"}") }
    override fun onTimeout() { /* keep listening */ }
  }

  companion object {
    private const val TAG = "ChiefCompanion"
    private const val SAMPLE_RATE = 16000f
    // Only these phrases are recognised; "[unk]" absorbs all other speech.
    private const val GRAMMAR = "[\"hey chief\", \"chief\", \"[unk]\"]"
    private const val ASSET_DIR = "vosk-model"
    private const val MODEL_VERSION = "small-en-us-0.15"
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var cached: Model? = null

    fun modelBundled(context: Context): Boolean =
      try { context.assets.list(ASSET_DIR)?.isNotEmpty() == true } catch (_: Exception) { false }

    /** Copies the bundled model out of the APK once, then loads it (cached for the process). */
    @Synchronized
    fun loadModel(context: Context): Model {
      cached?.let { return it }
      LibVosk.setLogLevel(LogLevel.WARNINGS)
      val target = File(context.filesDir, ASSET_DIR)
      val marker = File(target, ".version")
      if (!marker.exists() || marker.readText() != MODEL_VERSION) {
        target.deleteRecursively()
        copyAssets(context, ASSET_DIR, target)
        marker.writeText(MODEL_VERSION)
      }
      return Model(target.absolutePath).also { cached = it }
    }

    private fun copyAssets(context: Context, path: String, out: File) {
      val children = context.assets.list(path) ?: emptyArray()
      if (children.isEmpty()) {
        out.parentFile?.mkdirs()
        context.assets.open(path).use { input -> out.outputStream().use { input.copyTo(it) } }
        return
      }
      out.mkdirs()
      for (child in children) copyAssets(context, "$path/$child", File(out, child))
    }
  }
}
