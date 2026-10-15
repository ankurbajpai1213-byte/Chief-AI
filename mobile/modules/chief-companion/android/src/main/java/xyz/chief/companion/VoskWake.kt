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
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream

/**
 * Open-source, on-device wake word ("Hey Chief" / "Chief") using Vosk.
 * No account or key needed. The recognizer only knows a tiny grammar, so it
 * listens for the wake phrase and treats everything else as unknown speech.
 */
class VoskWake(
  private val context: Context,
  private val onWake: () -> Unit,
  private val onError: (String) -> Unit,
  private val onStatus: (String) -> Unit = {},
) {
  private var service: SpeechService? = null
  private val main = Handler(Looper.getMainLooper())
  private var lastFired = 0L
  @Volatile private var stopped = false

  fun start() {
    stop()
    stopped = false
    io.execute {
      try {
        if (stopped) return@execute
        if (!modelReady(context)) main.post { onStatus("Getting the wake word model (first time only, about 40 MB)...") }
        val model = loadModel(context)
        if (stopped) return@execute
        val rec = Recognizer(model, SAMPLE_RATE, GRAMMAR)
        rec.setWords(true) // per-word confidence, so weak matches can be ignored
        val svc = SpeechService(rec, SAMPLE_RATE)
        main.post {
          if (stopped) { try { svc.shutdown() } catch (_: Throwable) {}; return@post }
          onStatus("")
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
    stopped = true
    try { service?.stop() } catch (_: Throwable) {}
    try { service?.shutdown() } catch (_: Throwable) {}
    service = null
  }

  val running: Boolean get() = service != null

  /**
   * Decide on a finished utterance only (never on partial guesses, which fire on
   * almost any speech). Accept "hey chief" anywhere, or "chief" said on its own,
   * and only when the recognizer is confident about every wake word.
   */
  private fun check(json: String?) {
    if (json.isNullOrBlank()) return
    val words = try {
      val arr = JSONObject(json).optJSONArray("result") ?: return
      (0 until arr.length()).map { arr.getJSONObject(it) }.map { it.optString("word") to it.optDouble("conf", 0.0) }
    } catch (_: Exception) { return }
    val spoken = words.filter { it.first != "[unk]" }
    val i = spoken.indexOfFirst { it.first == "chief" }
    if (i < 0) return
    val chiefConf = spoken[i].second
    val hey = i > 0 && spoken[i - 1].first == "hey" && spoken[i - 1].second >= MIN_CONF
    val alone = words.size == 1
    val ok = (hey && chiefConf >= MIN_CONF) || (alone && chiefConf >= MIN_CONF_ALONE)
    if (!ok) { Log.i(TAG, "wake ignored: $words"); return }
    val now = System.currentTimeMillis()
    if (now - lastFired < 4000) return
    lastFired = now
    onWake()
  }

  private val listener = object : RecognitionListener {
    override fun onPartialResult(hypothesis: String?) { /* too eager to trust */ }
    override fun onResult(hypothesis: String?) = check(hypothesis)
    override fun onFinalResult(hypothesis: String?) = check(hypothesis)
    override fun onError(exception: Exception?) { onError("Vosk: ${exception?.message ?: "listening error"}") }
    override fun onTimeout() { /* keep listening */ }
  }

  companion object {
    private const val TAG = "ChiefCompanion"
    private const val SAMPLE_RATE = 16000f
    // Only these words are recognised. The look-alikes soak up everyday speech that
    // would otherwise be forced onto "chief"; "[unk]" absorbs everything else.
    private const val GRAMMAR = "[\"hey chief\", \"chief\", \"hey\", \"chef\", \"cheap\", \"sheep\", \"chip\", \"cheese\", \"teeth\", \"leaf\", \"beef\", \"keep\", \"she\", \"each\", \"brief\", \"thief\", \"[unk]\"]"
    private const val MIN_CONF = 0.80
    private const val MIN_CONF_ALONE = 0.92
    private const val MODEL_DIR = "vosk-model"
    private const val MODEL_VERSION = "small-en-us-0.15"
    private const val ZIP_ROOT = "vosk-model-small-en-us-0.15"
    // Not bundled in the app (keeps the download small): fetched once on first use.
    private val MODEL_URLS = listOf(
      "https://github.com/ankurbajpai1213-byte/Chief-AI/releases/download/vosk-model/vosk-model-small-en-us-0.15.zip",
      "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
    )
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var cached: Model? = null

    fun modelReady(context: Context): Boolean {
      val marker = File(File(context.filesDir, MODEL_DIR), ".version")
      return marker.exists() && marker.readText() == MODEL_VERSION
    }

    /** Downloads the model once (if needed), then loads it (cached for the process). */
    @Synchronized
    fun loadModel(context: Context): Model {
      cached?.let { return it }
      LibVosk.setLogLevel(LogLevel.WARNINGS)
      val target = File(context.filesDir, MODEL_DIR)
      if (!modelReady(context)) download(context, target)
      return Model(target.absolutePath).also { cached = it }
    }

    private fun download(context: Context, target: File) {
      val zip = File(context.cacheDir, "vosk-model.zip")
      var lastErr: Exception? = null
      for (u in MODEL_URLS) {
        try {
          fetch(u, zip)
          val tmp = File(context.filesDir, "$MODEL_DIR.tmp")
          tmp.deleteRecursively()
          unzip(zip, tmp)
          val root = File(tmp, ZIP_ROOT).takeIf { it.isDirectory } ?: tmp
          if (!File(root, "am/final.mdl").exists()) throw IllegalStateException("model archive incomplete")
          target.deleteRecursively()
          if (!root.renameTo(target)) throw IllegalStateException("couldn't save model")
          tmp.deleteRecursively()
          File(target, ".version").writeText(MODEL_VERSION)
          zip.delete()
          return
        } catch (e: Exception) {
          Log.w(TAG, "model download from $u failed: ${e.message}")
          lastErr = e
        }
      }
      zip.delete()
      throw IllegalStateException("Couldn't download the wake word model. Check internet, then tap Restart listening. (${lastErr?.message})")
    }

    private fun fetch(url: String, out: File) {
      var link = url
      repeat(5) {
        val c = URL(link).openConnection() as HttpURLConnection
        c.connectTimeout = 20000
        c.readTimeout = 60000
        c.instanceFollowRedirects = false
        val code = c.responseCode
        if (code in 300..399) { link = c.getHeaderField("Location") ?: throw IllegalStateException("bad redirect"); c.disconnect(); return@repeat }
        if (code != 200) { c.disconnect(); throw IllegalStateException("HTTP $code") }
        c.inputStream.use { input -> out.outputStream().use { input.copyTo(it, 64 * 1024) } }
        c.disconnect()
        return
      }
      throw IllegalStateException("too many redirects")
    }

    private fun unzip(zip: File, dest: File) {
      val base = dest.canonicalPath + File.separator
      ZipInputStream(zip.inputStream().buffered()).use { zin ->
        while (true) {
          val e = zin.nextEntry ?: break
          val f = File(dest, e.name)
          if (!f.canonicalPath.startsWith(base)) throw SecurityException("bad zip entry")
          if (e.isDirectory) f.mkdirs() else { f.parentFile?.mkdirs(); f.outputStream().use { zin.copyTo(it) } }
        }
      }
    }
  }
}
