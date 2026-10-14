import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";
import { radius, space, useColors } from "./theme";

type Tone = "chief" | "you" | "done" | "slip" | "plain";

export function useTone(tone: Tone) {
  const c = useColors();
  switch (tone) {
    case "chief": return { fg: c.chief, bg: c.chiefSoft };
    case "you": return { fg: c.you, bg: c.youSoft };
    case "done": return { fg: c.done, bg: c.doneSoft };
    case "slip": return { fg: c.slip, bg: c.slipSoft };
    default: return { fg: c.ink, bg: c.surface };
  }
}

export function H1({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={[s.h1, { color: c.ink }]}>{children}</Text>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[s.label, { color: c.muted }, style]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: TextStyle }) {
  const c = useColors();
  return <Text style={[s.body, { color: muted ? c.muted : c.ink }, style]}>{children}</Text>;
}

export function Card({ children, style, tone = "plain" }: { children: React.ReactNode; style?: ViewStyle; tone?: Tone }) {
  const c = useColors();
  const t = useTone(tone);
  return (
    <View style={[s.card, { backgroundColor: tone === "plain" ? c.surface : t.bg, borderColor: tone === "plain" ? c.line : t.fg }, style]}>
      {children}
    </View>
  );
}

export function Button({ title, onPress, tone = "chief", filled = false, disabled, busy, small }: {
  title: string; onPress: () => void; tone?: Tone; filled?: boolean; disabled?: boolean; busy?: boolean; small?: boolean;
}) {
  const c = useColors();
  const t = useTone(tone);
  const fg = filled ? c.onAccent : t.fg;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall,
        { borderColor: tone === "plain" ? c.line : t.fg, backgroundColor: filled ? t.fg : c.surface, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && s.btnTextSmall, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.row, style]}>{children}</View>;
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <Card style={{ alignItems: "flex-start", gap: space.xs }}>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      <Body muted>{hint}</Body>
    </Card>
  );
}

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "No time";
export const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) : "";

const s = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  body: { fontSize: 15, lineHeight: 21 },
  card: { borderWidth: 1.5, borderRadius: radius.md, padding: space.md, gap: space.sm },
  btn: { borderWidth: 1.5, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 44 },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 12, minHeight: 34 },
  btnText: { fontSize: 15, fontWeight: "700" },
  btnTextSmall: { fontSize: 13 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" },
});
