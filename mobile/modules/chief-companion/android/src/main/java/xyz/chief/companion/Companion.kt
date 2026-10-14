package xyz.chief.companion

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineManager
import android.Manifest
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.util.Log
import org.json.JSONArray
import java.util.Calendar
import java.util.Locale

private const val TAG = "ChiefCompanion"

/** Settings shared between the app and the background service. */
class Prefs(context: Context) {
  private val sp = context.getSharedPreferences("chief_companion", Context.MODE_PRIVATE)
  var enabled: Boolean
    get() = sp.getBoolean("enabled", false)
    set(v) = sp.edit().putBoolean("enabled", v).apply()
  var wakeHour: Int
    get() = sp.getInt("wakeHour", 6)
    set(v) = sp.edit().putInt("wakeHour", v).apply()
  var wakeMinute: Int
    get() = sp.getInt("wakeMinute", 0)
    set(v) = sp.edit().putInt("wakeMinute", v).apply()
  var delaySeconds: Int
    get() = sp.getInt("delaySeconds", 60)
    set(v) = sp.edit().putInt("delaySeconds", v).apply()
  var lastDay: String
    get() = sp.getString("lastDay", "") ?: ""
    set(v) = sp.edit().putString("lastDay", v).apply()
  var wakeWordOn: Boolean
    get() = sp.getBoolean("wakeWordOn", false)
    set(v) = sp.edit().putBoolean("wakeWordOn", v).apply()
  var accessKey: String
    get() = sp.getString("accessKey", "") ?: ""
    set(v) = sp.edit().putString("accessKey", v).apply()
  var speakOn: Boolean
    get() = sp.getBoolean("speakOn", true)
    set(v) = sp.edit().putBoolean("speakOn", v).apply()
  var lastError: String
    get() = sp.getString("lastError", "") ?: ""
    set(v) = sp.edit().putString("lastError", v).apply()
  var announcementCount: Int
    get() = sp.getInt("announcementCount", 0)
    set(v) = sp.edit().putInt("announcementCount", v).apply()

  /** The service should run if any feature needs it. */
  val needsService: Boolean get() = enabled || wakeWordOn || speakOn
}

/**
 * Chief's always-on helper:
 *  - morning start after the first unlock past wake time,
 *  - "Hey Chief" wake word,
 *  - speaking reminders out loud at their time (unless the phone is silent).
 */
class CompanionService : Service(), TextToSpeech.OnInitListener {
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Runnable? = null
  private var registered = false
  private var porcupine: PorcupineManager? = null
  private var vosk: VoskWake? = null
  private var wakePaused = false
  private var micForeground = false
  private val resumeRunnable = Runnable { wakePaused = false; restartWakeWord() }
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val ttsQueue = ArrayList<String>()

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
      when (i.action) {
        Intent.ACTION_USER_PRESENT -> onUnlock()
        Intent.ACTION_SCREEN_OFF -> cancelPending()
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureChannels(this)
    goForeground()
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_USER_PRESENT)
      addAction(Intent.ACTION_SCREEN_OFF)
    }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else registerReceiver(receiver, filter)
    registered = true
  }

  private fun micAllowed(): Boolean =
    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private fun statusText(p: Prefs): String = when {
    p.wakeWordOn && !micForeground -> "\"Hey Chief\" is paused. Tap to open Chief and switch it back on."
    p.wakeWordOn -> "Listening for \"Hey Chief\"."
    p.enabled -> "Chief will start your day after you unlock your phone."
    else -> "Chief will speak your reminders."
  }

  private fun goForeground() {
    val p = Prefs(this)
    val wantMic = p.wakeWordOn && micAllowed()
    micForeground = false
    if (Build.VERSION.SDK_INT >= 34) {
      try {
        val type = if (wantMic) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                   else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        micForeground = wantMic
        startForeground(SERVICE_ID, buildNotification(this, SERVICE_CHANNEL, "Chief is with you", statusText(p), ongoing = true, contentUri = null), type)
        if (wantMic && p.lastError.startsWith("Android blocked")) p.lastError = ""
      } catch (e: Exception) {
        // Android refuses the microphone when this starts from the background (after the app was closed).
        Log.w(TAG, "microphone foreground refused: ${e.message}")
        p.lastError = "Android blocked the microphone in the background (${e.javaClass.simpleName}). Open Chief once to re-allow it."
        micForeground = false
        startForeground(SERVICE_ID, buildNotification(this, SERVICE_CHANNEL, "Chief is with you", statusText(p), ongoing = true, contentUri = null), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      }
    } else {
      micForeground = wantMic
      startForeground(SERVICE_ID, buildNotification(this, SERVICE_CHANNEL, "Chief is with you", statusText(p), ongoing = true, contentUri = null))
    }
  }

  /** Free the microphone for the app; listening resumes by itself after [ms] unless renewed. */
  fun pauseFor(ms: Long) {
    wakePaused = true
    stopWakeWord()
    handler.removeCallbacks(resumeRunnable)
    handler.postDelayed(resumeRunnable, ms)
  }

  fun resumeNow() {
    handler.removeCallbacks(resumeRunnable)
    wakePaused = false
    restartWakeWord()
  }

  fun status(): Map<String, Any> = mapOf(
    "listening" to (porcupine != null || vosk?.running == true),
    "engine" to (if (porcupine != null) "porcupine" else if (vosk != null) "open-source" else "none"),
    "micAllowedInBackground" to micForeground,
    "paused" to wakePaused,
  )

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_REFRESH -> { goForeground(); restartWakeWord() }
      ACTION_PAUSE_WAKE -> pauseFor(90_000)
      ACTION_RESUME_WAKE -> resumeNow()
      ACTION_ANNOUNCE -> intent.getStringExtra(EXTRA_TEXT)?.let { speak(it) }
      else -> restartWakeWord()
    }
    if (!Prefs(this).needsService) stopSelf()
    return START_STICKY
  }

  override fun onDestroy() {
    cancelPending()
    handler.removeCallbacks(resumeRunnable)
    stopWakeWord()
    tts?.shutdown()
    if (instance === this) instance = null
    if (registered) unregisterReceiver(receiver)
    registered = false
    super.onDestroy()
  }

  // ---------- wake word ----------

  private fun restartWakeWord() {
    stopWakeWord()
    val p = Prefs(this)
    if (!p.wakeWordOn || wakePaused) return
    if (!micAllowed()) { p.lastError = "Microphone permission is off for Chief."; return }
    if (!micForeground) {
      if (p.lastError.isBlank()) p.lastError = "Microphone not available in the background yet. Open Chief once."
      return
    }
    // No Picovoice key: use the open-source engine (no account needed).
    if (p.accessKey.isBlank()) {
      p.lastError = ""
      vosk = VoskWake(applicationContext, onWake = { onWakeWord() }, onError = { msg -> p.lastError = msg; vosk = null }, onStatus = { msg -> p.lastError = msg })
      vosk?.start()
      return
    }
    try {
      val builder = PorcupineManager.Builder().setAccessKey(p.accessKey).setSensitivity(0.6f)
      val custom = try { assets.list("")?.contains(KEYWORD_FILE) == true } catch (_: Exception) { false }
      if (custom) builder.setKeywordPath(KEYWORD_FILE) else builder.setKeyword(Porcupine.BuiltInKeyword.PORCUPINE)
      porcupine = builder.build(applicationContext) { _ -> handler.post { onWakeWord() } }
      porcupine?.start()
      p.lastError = ""
      Log.i(TAG, "wake word listening (custom=$custom)")
    } catch (e: Exception) {
      Log.e(TAG, "wake word failed to start: ${e.message}")
      p.lastError = "${e.javaClass.simpleName}: ${e.message ?: "wake word engine failed to start"}"
      porcupine = null
    }
  }

  private fun stopWakeWord() {
    try { porcupine?.stop() } catch (_: Exception) {}
    try { porcupine?.delete() } catch (_: Exception) {}
    porcupine = null
    vosk?.stop()
    vosk = null
  }

  private fun onWakeWord() {
    // Release the microphone so the app can listen to the request.
    pauseFor(120_000)
    try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).startTone(ToneGenerator.TONE_PROP_ACK, 150) } catch (_: Exception) {}
    launchChief(this, WAKE_URI, "Chief is listening", "Tap to talk to Chief.")
  }

  // ---------- speaking reminders ----------

  override fun onInit(status: Int) {
    ttsReady = status == TextToSpeech.SUCCESS
    if (ttsReady) {
      tts?.language = Locale("en", "IN")
      ttsQueue.forEach { tts?.speak(it, TextToSpeech.QUEUE_ADD, null, "chief-${System.nanoTime()}") }
    }
    ttsQueue.clear()
  }

  private fun speak(text: String) {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (am.ringerMode != AudioManager.RINGER_MODE_NORMAL) return // silent or vibrate: stay quiet
    if (Prefs(this).wakeWordOn && !wakePaused) pauseFor(15_000) // don't wake on Chief's own voice
    if (tts == null) tts = TextToSpeech(this, this)
    if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "chief-${System.nanoTime()}")
    else ttsQueue.add(text)
  }

  // ---------- morning start ----------

  private fun cancelPending() {
    pending?.let { handler.removeCallbacks(it) }
    pending = null
  }

  private fun onUnlock() {
    val p = Prefs(this)
    if (!p.enabled) return
    val now = Calendar.getInstance()
    val today = "${now.get(Calendar.YEAR)}-${now.get(Calendar.DAY_OF_YEAR)}"
    if (p.lastDay == today) return
    val minutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    val wake = p.wakeHour * 60 + p.wakeMinute
    if (minutes < wake || minutes > wake + 6 * 60) return

    cancelPending()
    val run = Runnable {
      pending = null
      val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      if (!pm.isInteractive || km.isKeyguardLocked) return@Runnable
      p.lastDay = today
      launchChief(this, MORNING_URI, "Good morning", "Tap to start your day with Chief.")
    }
    pending = run
    handler.postDelayed(run, p.delaySeconds.coerceIn(0, 600) * 1000L)
  }

  companion object {
    /** The running service, for direct calls from the app (no background-start limits). */
    @Volatile var instance: CompanionService? = null
    const val SERVICE_CHANNEL = "chief_companion"
    const val MORNING_CHANNEL = "chief_morning"
    const val SERVICE_ID = 4101
    const val MORNING_ID = 4102
    const val MORNING_URI = "chief://morning"
    const val WAKE_URI = "chief://wake"
    const val KEYWORD_FILE = "hey-chief_android.ppn"
    const val ACTION_REFRESH = "xyz.chief.companion.REFRESH"
    const val ACTION_PAUSE_WAKE = "xyz.chief.companion.PAUSE_WAKE"
    const val ACTION_RESUME_WAKE = "xyz.chief.companion.RESUME_WAKE"
    const val ACTION_ANNOUNCE = "xyz.chief.companion.ANNOUNCE"
    const val EXTRA_TEXT = "text"

    fun send(ctx: Context, action: String, text: String? = null) {
      val i = Intent(ctx, CompanionService::class.java).setAction(action)
      if (text != null) i.putExtra(EXTRA_TEXT, text)
      try {
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
      } catch (e: Exception) {
        Log.w(TAG, "could not reach service: ${e.message}")
      }
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, CompanionService::class.java))
    }

    /** Open Chief directly when allowed; otherwise post a notification to tap. */
    fun launchChief(ctx: Context, uri: String, title: String, text: String) {
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        .setPackage(ctx.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val canOpen = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
      if (canOpen) {
        try {
          ctx.startActivity(open)
          return
        } catch (_: Exception) { /* fall back to a notification */ }
      }
      ensureChannels(ctx)
      val n = buildNotification(ctx, MORNING_CHANNEL, title, text, ongoing = false, contentUri = uri)
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(MORNING_ID, n)
    }

    fun ensureChannels(ctx: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(SERVICE_CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL, "Chief in the background", NotificationManager.IMPORTANCE_MIN))
      }
      if (nm.getNotificationChannel(MORNING_CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(MORNING_CHANNEL, "Chief wants to talk", NotificationManager.IMPORTANCE_HIGH))
      }
    }

    fun buildNotification(ctx: Context, channel: String, title: String, text: String, ongoing: Boolean, contentUri: String?): Notification {
      val icon = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
        .takeIf { it != 0 } ?: ctx.applicationInfo.icon
      val tap = if (contentUri != null) {
        Intent(Intent.ACTION_VIEW, Uri.parse(contentUri)).setPackage(ctx.packageName)
      } else {
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      }
      val pi = tap?.let {
        PendingIntent.getActivity(ctx, contentUri.hashCode(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      @Suppress("DEPRECATION")
      val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channel) else Notification.Builder(ctx)
      b.setSmallIcon(icon).setContentTitle(title).setContentText(text).setOngoing(ongoing).setAutoCancel(!ongoing)
      if (pi != null) b.setContentIntent(pi)
      return b.build()
    }

    /** Replace all spoken reminders with a new list of [epochMillis, text]. */
    fun scheduleAnnouncements(ctx: Context, json: String) {
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val p = Prefs(ctx)
      for (i in 0 until p.announcementCount) {
        am.cancel(announcePI(ctx, i, null))
      }
      val list = try { JSONArray(json) } catch (_: Exception) { JSONArray() }
      var n = 0
      val now = System.currentTimeMillis()
      for (i in 0 until minOf(list.length(), 60)) {
        val item = list.optJSONObject(i) ?: continue
        val at = item.optLong("at", 0L)
        val text = item.optString("text", "")
        if (at <= now || text.isBlank()) continue
        val pi = announcePI(ctx, n, text)
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        n++
      }
      p.announcementCount = n
    }

    private fun announcePI(ctx: Context, index: Int, text: String?): PendingIntent {
      val i = Intent(ctx, AnnounceReceiver::class.java).setAction("xyz.chief.companion.ANNOUNCE_$index")
      if (text != null) i.putExtra(EXTRA_TEXT, text)
      return PendingIntent.getBroadcast(ctx, 7000 + index, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }
}

/** Fires at a reminder's time and asks the service to say it out loud. */
class AnnounceReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val text = intent.getStringExtra(CompanionService.EXTRA_TEXT) ?: return
    if (!Prefs(context).speakOn) return
    CompanionService.send(context, CompanionService.ACTION_ANNOUNCE, text)
  }
}

/** Restarts the background service after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Prefs(context).needsService) CompanionService.send(context, CompanionService.ACTION_REFRESH)
  }
}
