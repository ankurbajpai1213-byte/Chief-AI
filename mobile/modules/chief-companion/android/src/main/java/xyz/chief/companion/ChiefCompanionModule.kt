package xyz.chief.companion

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ChiefCompanionModule : Module() {
  private val ctx get() = appContext.reactContext!!

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
    Function("configureWake") { on: Boolean, accessKey: String ->
      val p = Prefs(ctx)
      p.wakeWordOn = on
      if (accessKey.isNotBlank()) p.accessKey = accessKey.trim()
      apply()
      true
    }

    Function("wakeStatus") {
      val p = Prefs(ctx)
      mapOf("on" to p.wakeWordOn, "hasKey" to p.accessKey.isNotBlank())
    }

    Function("pauseWake") { CompanionService.send(ctx, CompanionService.ACTION_PAUSE_WAKE); true }
    Function("resumeWake") { CompanionService.send(ctx, CompanionService.ACTION_RESUME_WAKE); true }

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
