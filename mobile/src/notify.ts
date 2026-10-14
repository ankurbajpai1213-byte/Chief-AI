import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import type { Profile, Step } from "./types";

export const CHANNEL = "chief";
export const STEP_CATEGORY = "step";
export const ACTION_DONE = "DONE";
export const ACTION_LATER = "LATER";
export const ACTION_SMALLER = "SMALLER";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Chief check-ins and reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  // Buttons on step reminders. They open the app so Chief can act and reply.
  await Notifications.setNotificationCategoryAsync(STEP_CATEGORY, [
    { identifier: ACTION_DONE, buttonTitle: "Done", options: { opensAppToForeground: true } },
    { identifier: ACTION_LATER, buttonTitle: "Later", options: { opensAppToForeground: true } },
    { identifier: ACTION_SMALLER, buttonTitle: "Smaller", options: { opensAppToForeground: true } },
  ]);
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

const hm = (t: string) => {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return { hour: h || 0, minute: m || 0 };
};

// Rebuild every reminder from the database. Simple and always correct.
export async function rescheduleAll(): Promise<number> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 0;
  const now = Date.now();
  const horizon = new Date(now + 7 * 86400000).toISOString();
  const [{ data: profile }, { data: steps }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", auth.user.id).single<Profile>(),
    supabase.from("steps").select("id, title, minutes, scheduled_at, status, projects(title)")
      .eq("status", "planned").gt("scheduled_at", new Date(now).toISOString()).lte("scheduled_at", horizon)
      .order("scheduled_at").limit(60).returns<Step[]>(),
  ]);

  await Notifications.cancelAllScheduledNotificationsAsync();
  let count = 0;

  for (const s of steps ?? []) {
    if (!s.scheduled_at) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Time for: ${s.title}`,
        body: `${s.minutes} min${s.projects?.title ? ` · ${s.projects.title}` : ""}`,
        data: { kind: "step", step_id: s.id },
        categoryIdentifier: STEP_CATEGORY,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(s.scheduled_at), channelId: CHANNEL },
    });
    count++;
  }

  if (profile) {
    await Notifications.scheduleNotificationAsync({
      content: { title: "Good morning", body: "Chief has your plan for today. Tap to review.", data: { kind: "morning" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...hm(profile.morning_checkin), channelId: CHANNEL },
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: "Evening check-in", body: "Did today's steps happen? Takes one minute.", data: { kind: "evening" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...hm(profile.evening_checkin), channelId: CHANNEL },
    });
  }
  return count;
}
