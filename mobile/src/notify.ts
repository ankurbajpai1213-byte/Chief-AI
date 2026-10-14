import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { upcomingEvents } from "./calendar";
import { setAnnouncements } from "../modules/chief-companion";
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

  // Rebuild everything except follow-ups Chief promised in a conversation.
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    if ((n.content.data as { kind?: string } | null)?.kind !== "followup") {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
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
      content: { title: "Morning check-in", body: "Tap to go through today with Chief.", data: { kind: "morning" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...hm(profile.morning_checkin), channelId: CHANNEL },
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: "Evening check-in", body: "Did today's steps happen? Takes one minute.", data: { kind: "evening" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...hm(profile.evening_checkin), channelId: CHANNEL },
    });
  }
  // Chief also says reminders out loud at their time (the phone stays quiet when on silent).
  try {
    const name = profile?.display_name ? `${profile.display_name}, ` : "";
    const items: { at: number; text: string }[] = [];
    for (const s of steps ?? []) {
      if (s.scheduled_at) items.push({ at: Date.parse(s.scheduled_at), text: `Hey ${name}it's time for ${s.title}.` });
    }
    for (const e of await upcomingEvents(2)) {
      if (e.all_day) continue;
      const at = Date.parse(e.start) - 10 * 60000;
      const when = new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      items.push({ at, text: `Hey ${name}${e.title} starts at ${when}, in ten minutes.` });
    }
    for (const f of await loadFollowUps()) items.push(f);
    setAnnouncements(items.filter((i) => i.at > Date.now()).sort((a, b) => a.at - b.at).slice(0, 60));
  } catch { /* speaking is optional */ }
  return count;
}

const FOLLOWUPS = "chief.followups";
async function loadFollowUps(): Promise<{ at: number; text: string }[]> {
  try {
    const list = JSON.parse((await AsyncStorage.getItem(FOLLOWUPS)) ?? "[]") as { at: number; text: string }[];
    const live = list.filter((f) => f.at > Date.now());
    if (live.length !== list.length) await AsyncStorage.setItem(FOLLOWUPS, JSON.stringify(live));
    return live;
  } catch { return []; }
}

// Chief said "I'll come back to you at…": remind at that time and reopen the conversation.
export async function scheduleFollowUp(at: string, name?: string | null) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30000) return;
  // Spoken too: this is how "call me in 10 minutes" rings.
  const list = await loadFollowUps();
  list.push({ at: when.getTime(), text: `${name ? name + ", " : ""}it's Chief. You asked me to come back to you now.` });
  await AsyncStorage.setItem(FOLLOWUPS, JSON.stringify(list));
  rescheduleAll().catch(() => {});
  await Notifications.scheduleNotificationAsync({
    content: { title: "Chief, as promised", body: "Ready to go through your day? Tap to talk.", data: { kind: "followup" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
  });
}
