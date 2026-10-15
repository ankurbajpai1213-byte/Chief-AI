import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type WakeStatus = {
  on: boolean; hasKey: boolean; running?: boolean; listening?: boolean;
  micAllowedInBackground?: boolean; paused?: boolean; batteryUnrestricted?: boolean; lastError?: string; engine?: string;
};

type Native = {
  configure(enabled: boolean, wakeHour: number, wakeMinute: number, delaySeconds: number): boolean;
  configureWake(on: boolean, accessKey: string): boolean;
  wakeStatus(): WakeStatus;
  refresh(): boolean;
  batteryUnrestricted(): boolean;
  openBatterySettings(): boolean;
  pauseWake(): boolean;
  resumeWake(): boolean;
  wakeWasReal(): boolean;
  setSpeak(on: boolean): boolean;
  speakEnabled(): boolean;
  setAnnouncements(json: string): boolean;
  sayNow(text: string): boolean;
  isEnabled(): boolean;
  canOpenByItself(): boolean;
  openOpenByItselfSettings(): boolean;
  resetToday(): boolean;
};

const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("ChiefCompanion") : null;

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export const companionAvailable = !!native;

export function configureMorning(enabled: boolean, wakeTime: string, delaySeconds = 60) {
  if (!native) return false;
  const [h, m] = wakeTime.split(":").map((n) => parseInt(n, 10));
  return safe(() => native.configure(enabled, h || 0, m || 0, delaySeconds), false);
}

export const canOpenByItself = () => safe(() => native?.canOpenByItself() ?? false, false);
export const openOpenByItselfSettings = () => safe(() => native?.openOpenByItselfSettings(), undefined);
export const resetMorningToday = () => safe(() => native?.resetToday(), undefined);

// "Hey Chief"
export const configureWake = (on: boolean, accessKey = "") => safe(() => native?.configureWake(on, accessKey) ?? false, false);
export const wakeStatus = (): WakeStatus => safe(() => native?.wakeStatus() ?? { on: false, hasKey: false }, { on: false, hasKey: false });
export const refreshCompanion = () => safe(() => native?.refresh(), undefined);
export const batteryUnrestricted = () => safe(() => native?.batteryUnrestricted() ?? true, true);
export const openBatterySettings = () => safe(() => native?.openBatterySettings(), undefined);
export const pauseWake = () => safe(() => native?.pauseWake(), undefined);
export const resumeWake = () => safe(() => native?.resumeWake(), undefined);
export const wakeWasReal = () => safe(() => native?.wakeWasReal(), undefined);

// Spoken reminders
export const setSpeak = (on: boolean) => safe(() => native?.setSpeak(on) ?? false, false);
export const speakEnabled = () => safe(() => native?.speakEnabled() ?? false, false);
export const sayNow = (text: string) => safe(() => native?.sayNow(text), undefined);
export function setAnnouncements(items: { at: number; text: string }[]) {
  return safe(() => native?.setAnnouncements(JSON.stringify(items)) ?? false, false);
}
