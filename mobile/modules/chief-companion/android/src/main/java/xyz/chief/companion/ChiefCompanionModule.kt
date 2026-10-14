package xyz.chief.companion

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ChiefCompanionModule : Module() {
  private val ctx get() = appContext.reactContext!!

  override fun definition() = ModuleDefinition {
    Name("ChiefCompanion")

    // Turn the morning start on or off, with the wake time and delay after unlock.
    Function("configure") { enabled: Boolean, wakeHour: Int, wakeMinute: Int, delaySeconds: Int ->
      val p = Prefs(ctx)
      p.enabled = enabled
      p.wakeHour = wakeHour
      p.wakeMinute = wakeMinute
      p.delaySeconds = delaySeconds
      if (enabled) CompanionService.start(ctx) else CompanionService.stop(ctx)
      true
    }

    Function("isEnabled") { Prefs(ctx).enabled }

    // Needed for Chief to open itself after unlock (otherwise it posts a notification).
    Function("canOpenByItself") {
      Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
    }

    Function("openOpenByItselfSettings") {
      val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
      true
    }

    // Lets the user rehearse the morning start right now.
    Function("resetToday") {
      Prefs(ctx).lastDay = ""
      true
    }
  }
}
