import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import * as Legacy from "expo-calendar/legacy";

// Reads the calendars already on the phone (Google Calendar, work calendars synced to Android).
// Read-only: Chief never writes to them.

export type CalEvent = { title: string; start: string; end: string; all_day: boolean };
export type CalendarCheck = { enabled: boolean; permission: boolean; calendars: number; events: CalEvent[]; error?: string };

const KEY = "chief.useCalendar";

export async function calendarEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === "1"; } catch { return false; }
}

export async function setCalendarEnabled(on: boolean): Promise<boolean> {
  if (on) {
    let granted = false;
    try { granted = (await Calendar.requestCalendarPermissions()).granted; }
    catch { granted = (await Legacy.requestCalendarPermissionsAsync()).granted; }
    if (!granted) { await AsyncStorage.setItem(KEY, "0"); return false; }
  }
  await AsyncStorage.setItem(KEY, on ? "1" : "0");
  return on;
}

const toIso = (d: unknown) => new Date(d as string | Date).toISOString();

/** Full check, used by Settings to show what Chief can actually see. */
export async function checkCalendar(days = 2): Promise<CalendarCheck> {
  const enabled = await calendarEnabled();
  const result: CalendarCheck = { enabled, permission: false, calendars: 0, events: [] };
  if (!enabled) return result;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86400000);
  const errors: string[] = [];

  // Newer API first, then the older one: either is enough.
  try {
    result.permission = (await Calendar.getCalendarPermissions()).granted;
    if (result.permission) {
      const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      result.calendars = cals.length;
      if (cals.length) {
        const events = await Calendar.listEvents(cals, start, end);
        result.events = events.filter((e) => e.title).map((e) => ({ title: e.title ?? "", start: toIso(e.startDate), end: toIso(e.endDate), all_day: !!e.allDay }));
      }
      return finish(result);
    }
  } catch (e) {
    errors.push(`new: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    result.permission = (await Legacy.getCalendarPermissionsAsync()).granted;
    if (result.permission) {
      const cals = await Legacy.getCalendarsAsync(Legacy.EntityTypes.EVENT);
      result.calendars = cals.length;
      if (cals.length) {
        const events = await Legacy.getEventsAsync(cals.map((c) => c.id), start, end);
        result.events = events.filter((e) => e.title).map((e) => ({ title: e.title, start: toIso(e.startDate), end: toIso(e.endDate), all_day: !!e.allDay }));
      }
      return finish(result);
    }
  } catch (e) {
    errors.push(`legacy: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (errors.length) result.error = errors.join(" | ");
  return result;
}

function finish(r: CalendarCheck): CalendarCheck {
  r.events = r.events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 80);
  return r;
}

/** Events from the start of today through the end of tomorrow (or `days`). */
export async function upcomingEvents(days = 2): Promise<CalEvent[]> {
  try { return (await checkCalendar(days)).events; } catch { return []; }
}
