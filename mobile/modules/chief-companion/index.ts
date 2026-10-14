import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

type Native = {
  configure(enabled: boolean, wakeHour: number, wakeMinute: number, delaySeconds: number): boolean;
  isEnabled(): boolean;
  canOpenByItself(): boolean;
  openOpenByItselfSettings(): boolean;
  resetToday(): boolean;
};

const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("ChiefCompanion") : null;

export const companionAvailable = !!native;

export function configureMorning(enabled: boolean, wakeTime: string, delaySeconds = 60) {
  if (!native) return false;
  const [h, m] = wakeTime.split(":").map((n) => parseInt(n, 10));
  return native.configure(enabled, h || 0, m || 0, delaySeconds);
}

export const canOpenByItself = () => native?.canOpenByItself() ?? false;
export const openOpenByItselfSettings = () => native?.openOpenByItselfSettings();
export const resetMorningToday = () => native?.resetToday();
