package xyz.chief.companion

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinition

class ChiefCompanionModule : Module() {
  private val ctx get() = appContext.reactContext!!

  private fun batteryUnrestricted(): Boolean {
    if (Build.VERSION.SDK_INT < 23) return true
    val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
    return pm.isIgnoringBatteryOptimizations(ctx.packageName)
  }

  private fun apply() {
    val p = Prefs(ctx)
    if (p.needsService) CompanionService.send(ctx, CompanionService.ACTION_REFRESH) else CompanionService.stop(ctx)
  }

  override fun definition() = ModuleDefinition {
    Name("ChiefCompanion")

    // Morning start: on/off, wake time, and delay after unlock.
    Function("configure") { enabled: Boolean, wakeHour: Int, wakeMinute: Int, delaySeconds: Int ->
      val p = Prefs(ctx)
      p.enabled = enabled
      p.wakeHour = wakeHour
      p.wakeMinute = wakeMinute
      p.delaySeconds = delaySeconds
      apply()
      true
    }

    // "Hey Chief": on/off plus the Picovoice access key (kept only on this phone).
    // Evening check-in: Chief starts the conversation at this time (or at the next unlock within 3 hours).
    Function("configureEvening") { on: Boolean, hour: Int, minute: Int ->
      val p = Prefs(ctx)
      p.eveningOn = on; p.eveningHour = hour; p.eveningMinute = minute
      CompanionService.scheduleEvening(ctx)
      apply()
      true
    }

    Function("configureWake") { on: Boolean, accessKey: String ->
      val p = Prefs(ctx)
      p.wakeWordOn = on
      if (accessKey.isNotBlank()) p.accessKey = accessKey.trim()
      apply()
      true
    }

    Function("wakeStatus") {
      val p = Prefs(ctx)
      val live = CompanionService.instance?.status() ?: emptyMap()
      mapOf(
        "on" to p.wakeWordOn,
        "hasKey" to p.accessKey.isNotBlank(),
        "running" to (CompanionService.instance != null),
        "listening" to (live["listening"] ?: false),
        "micAllowedInBackground" to (live["micAllowedInBackground"] ?: false),
        "paused" to (live["paused"] ?: false),
        "batteryUnrestricted" to batteryUnrestricted(),
        "lastError" to p.lastError,
      )
    }

    // Direct calls into the running service; fall back to an intent if it isn't running.
    Function("pauseWake") {
      CompanionService.instance?.pauseFor(90_000) ?: CompanionService.send(ctx, CompanionService.ACTION_PAUSE_WAKE)
      true
    }
    Function("wakeWasReal") {
      CompanionService.instance?.wakeWasReal()
      true
    }

    Function("resumeWake") {
      CompanionService.instance?.resumeNow() ?: CompanionService.send(ctx, CompanionService.ACTION_RESUME_WAKE)
      true
    }

    // Called whenever the app comes to the front: Android only grants the microphone then.
    Function("refresh") {
      if (Prefs(ctx).needsService) CompanionService.send(ctx, CompanionService.ACTION_REFRESH)
      true
    }

    Function("batteryUnrestricted") { batteryUnrestricted() }
    Function("openBatterySettings") {
      val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try { ctx.startActivity(i) } catch (_: Exception) {
        ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    }

    // Spoken reminders.
    Function("setSpeak") { on: Boolean ->
      Prefs(ctx).speakOn = on
      apply()
      true
    }
    Function("speakEnabled") { Prefs(ctx).speakOn }
    Function("setAnnouncements") { json: String ->
      CompanionService.scheduleAnnouncements(ctx, json)
      true
    }
    // Speak inside a conversation and resolve when finished (plays even on silent: you asked).
    AsyncFunction("speakAndWait") { text: String, promise: Promise ->
      Speaker.say(ctx, text) { promise.resolve(true) }
    }

    Function("stopSpeaking") {
      Speaker.stop()
      true
    }

    Function("sayNow") { text: String ->
      CompanionService.send(ctx, CompanionService.ACTION_ANNOUNCE, text)
      true
    }

    Function("isEnabled") { Prefs(ctx).enabled }

    // Needed for Chief to open itself (otherwise it posts a notification).
    Function("canOpenByItself") {
      Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
    }

    Function("openOpenByItselfSettings") {
      val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
      true
    }

    Function("resetToday") {
      Prefs(ctx).lastDay = ""
      true
    }
  }
}
