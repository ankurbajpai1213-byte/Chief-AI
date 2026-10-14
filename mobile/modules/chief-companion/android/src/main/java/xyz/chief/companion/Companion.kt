package xyz.chief.companion

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
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import java.util.Calendar

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
}

/**
 * Runs quietly in the background. On the first unlock after wake time (once a day),
 * waits a short delay and opens Chief's morning conversation.
 */
class CompanionService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Runnable? = null
  private var registered = false

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
    ensureChannels(this)
    val notification = buildNotification(
      this, SERVICE_CHANNEL, "Chief is ready for your morning",
      "Chief will start your day after you unlock your phone.", ongoing = true, contentUri = null,
    )
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(SERVICE_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(SERVICE_ID, notification)
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_USER_PRESENT)
      addAction(Intent.ACTION_SCREEN_OFF)
    }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else registerReceiver(receiver, filter)
    registered = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    cancelPending()
    if (registered) unregisterReceiver(receiver)
    registered = false
    super.onDestroy()
  }

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
    // Only in the morning window: from wake time until 6 hours later.
    if (minutes < wake || minutes > wake + 6 * 60) return

    cancelPending()
    val run = Runnable {
      pending = null
      val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      if (!pm.isInteractive || km.isKeyguardLocked) return@Runnable
      p.lastDay = today
      launchChief(this)
    }
    pending = run
    handler.postDelayed(run, p.delaySeconds.coerceIn(0, 600) * 1000L)
  }

  companion object {
    const val SERVICE_CHANNEL = "chief_companion"
    const val MORNING_CHANNEL = "chief_morning"
    const val SERVICE_ID = 4101
    const val MORNING_ID = 4102
    const val MORNING_URI = "chief://morning"

    fun start(ctx: Context) {
      val i = Intent(ctx, CompanionService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, CompanionService::class.java))
    }

    /** Open Chief directly when allowed; otherwise post a notification to tap. */
    fun launchChief(ctx: Context) {
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(MORNING_URI))
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
      val n = buildNotification(ctx, MORNING_CHANNEL, "Good morning", "Tap to start your day with Chief.", ongoing = false, contentUri = MORNING_URI)
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(MORNING_ID, n)
    }

    fun ensureChannels(ctx: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(SERVICE_CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL, "Chief in the background", NotificationManager.IMPORTANCE_MIN))
      }
      if (nm.getNotificationChannel(MORNING_CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(MORNING_CHANNEL, "Morning with Chief", NotificationManager.IMPORTANCE_HIGH))
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
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      @Suppress("DEPRECATION")
      val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channel) else Notification.Builder(ctx)
      b.setSmallIcon(icon).setContentTitle(title).setContentText(text).setOngoing(ongoing).setAutoCancel(!ongoing)
      if (pi != null) b.setContentIntent(pi)
      return b.build()
    }
  }
}

/** Restarts the background service after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Prefs(context).enabled) {
      try { CompanionService.start(context) } catch (_: Exception) { /* Android may refuse; the app restarts it on next open */ }
    }
  }
}
