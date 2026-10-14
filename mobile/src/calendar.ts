import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";

// Reads the calendars already on the phone (Google Calendar, work calendars synced to Android).
// Read-only: Chief never writes to them.

export type CalEvent = { title: string; start: string; end: string; all_day: boolean };

const KEY = "chief.useCalendar";

export async function calendarEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === "1"; } catch { return false; }
}

export async function setCalendarEnabled(on: boolean): Promise<boolean> {
  if (on) {
    const { granted } = await Calendar.requestCalendarPermissions();
    if (!granted) { await AsyncStorage.setItem(KEY, "0"); return false; }
  }
  await AsyncStorage.setItem(KEY, on ? "1" : "0");
  return on;
}

/** Events from the start of today through the end of tomorrow (or `days`). */
export async function upcomingEvents(days = 2): Promise<CalEvent[]> {
  if (!(await calendarEnabled())) return [];
  try {
    const { granted } = await Calendar.getCalendarPermissions();
    if (!granted) return [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 86400000);
    const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    if (!cals.length) return [];
    const events = await Calendar.listEvents(cals, start, end);
    return events
      .filter((e) => e.title)
      .map((e) => ({
        title: e.title ?? "",
        start: new Date(e.startDate as string | Date).toISOString(),
        end: new Date(e.endDate as string | Date).toISOString(),
        all_day: !!e.allDay,
      }))
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 80);
  } catch {
    return [];
  }
}
