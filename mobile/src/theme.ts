import { useColorScheme } from "react-native";

const light = {
  bg: "#f3f5f8", surface: "#ffffff", ink: "#152238", muted: "#5d6b80", line: "#cfd6e1",
  chief: "#c9781c", chiefSoft: "#fbeedc", you: "#2d5fa6", youSoft: "#e3ecf8",
  done: "#2f8a57", doneSoft: "#e1f2e8", slip: "#b8433a", slipSoft: "#f8e3e1", onAccent: "#ffffff",
};
const dark: typeof light = {
  bg: "#0f1622", surface: "#18212f", ink: "#e7ecf3", muted: "#9aa7ba", line: "#2d3a4d",
  chief: "#e79a3f", chiefSoft: "#3a2a15", you: "#7aa7e6", youSoft: "#1c2c45",
  done: "#5cc48a", doneSoft: "#173226", slip: "#ec7c71", slipSoft: "#3b1d1b", onAccent: "#0f1622",
};
export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
