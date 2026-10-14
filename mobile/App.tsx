import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./src/supabase";
import { sendEvent } from "./src/api";
import { ACTION_DONE, ACTION_LATER, ACTION_SMALLER, rescheduleAll, scheduleFollowUp, setupNotifications } from "./src/notify";
import type { ChiefEvent, ChiefReply, Profile, Tab } from "./src/types";
import { configureMorning } from "./modules/chief-companion";
import { useColors } from "./src/theme";
import Login from "./src/screens/Login";
import Talk from "./src/screens/Talk";
import Today from "./src/screens/Today";
import Checkin from "./src/screens/Checkin";
import Projects from "./src/screens/Projects";
import Settings from "./src/screens/Settings";
import Conversation, { type ConversationStart } from "./src/screens/Conversation";

type Launch = "morning" | "wake" | null;
const launchFromUrl = (url: string | null): Launch =>
  !url ? null : url.startsWith("chief://morning") ? "morning" : url.startsWith("chief://wake") ? "wake" : null;

const TABS: { key: Tab; label: string }[] = [
  { key: "talk", label: "Talk" },
  { key: "today", label: "Today" },
  { key: "checkin", label: "Check-in" },
  { key: "projects", label: "Projects" },
  { key: "settings", label: "Settings" },
];

function Main({ session, launch, onLaunchHandled }: { session: Session; launch: Launch; onLaunchHandled: () => void }) {
  const c = useColors();
  const [tab, setTab] = useState<Tab>("talk");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [quick, setQuick] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationStart | null>(null);
  const voiceOn = useRef(true);

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    if (data) {
      const p = data as Profile;
      setProfile(p);
      voiceOn.current = p.voice_replies;
      try { configureMorning(p.morning_auto, p.wake_time.slice(0, 5)); } catch { /* not available on this device */ }
    }
  }, [session.user.id]);

  const refresh = useCallback(async () => {
    setRefreshKey((k) => k + 1);
    try { await rescheduleAll(); } catch { /* reminders retry on next change */ }
  }, []);

  // Every conversation with Chief goes through here: show it on Talk, speak it, refresh reminders.
  const ask = useCallback(async (p: Promise<ChiefReply>) => {
    setTab("talk");
    setThinking(true);
    setError(null);
    setQuick([]);
    try {
      const r = await p;
      setQuick(r.quick_replies ?? []);
      if (voiceOn.current && r.reply) {
        Speech.stop();
        Speech.speak(r.reply, { language: "en-IN", rate: 1.0 });
      }
      await loadProfile();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chief couldn't be reached.");
      setRefreshKey((k) => k + 1);
    } finally {
      setThinking(false);
    }
  }, [loadProfile, refresh]);

  useEffect(() => {
    loadProfile();
    setupNotifications().then(() => rescheduleAll()).catch(() => {});
  }, [loadProfile]);

  // Opened by the morning unlock.
  useEffect(() => {
    if (launch === "morning") setConversation({ type: "morning_start" });
    if (launch === "wake") setConversation({ type: "wake" });
    if (launch) onLaunchHandled();
  }, [launch, onLaunchHandled]);

  // Notification taps and buttons.
  const handled = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    const id = lastResponse.notification.request.identifier + lastResponse.actionIdentifier + lastResponse.notification.date;
    if (handled.current === id) return;
    handled.current = id;
    const data = lastResponse.notification.request.content.data as { kind?: string; step_id?: string };
    const action = lastResponse.actionIdentifier;
    if (data.kind === "step" && data.step_id) {
      if (action === ACTION_DONE) ask(sendEvent({ type: "step_done", step_id: data.step_id }));
      else if (action === ACTION_LATER) ask(sendEvent({ type: "step_later", step_id: data.step_id }));
      else if (action === ACTION_SMALLER) ask(sendEvent({ type: "step_smaller", step_id: data.step_id }));
      else setTab("today");
    } else if (data.kind === "morning") {
      setConversation({ type: "morning_start" });
    } else if (data.kind === "followup") {
      setConversation({ type: "followup" });
    } else if (data.kind === "evening") {
      setTab("checkin");
    }
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [lastResponse, ask]);

  const props = { refreshKey, thinking, ask };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      {error && (
        <Pressable onPress={() => setError(null)} style={[s.banner, { backgroundColor: c.slipSoft, borderColor: c.slip }]}>
          <Text style={{ color: c.slip, fontWeight: "600" }}>{error}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>Tap to dismiss</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        {tab === "talk" && <Talk {...props} quickReplies={quick} />}
        {tab === "today" && <Today {...props} onStartConversation={() => setConversation({ type: "morning_start" })} />}
        {tab === "checkin" && <Checkin {...props} />}
        {tab === "projects" && <Projects {...props} maxActive={profile?.max_active_projects ?? 3} onLocalChange={refresh} />}
        {tab === "settings" && <Settings profile={profile} onSaved={async () => { await loadProfile(); await refresh(); }} />}
      </View>
      <SafeAreaView edges={["bottom"]} style={[s.tabbar, { borderTopColor: c.line, backgroundColor: c.surface }]}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(t.key)} style={s.tab}>
              <View style={[s.tabDot, { backgroundColor: on ? c.chief : "transparent" }]} />
              <Text style={{ color: on ? c.ink : c.muted, fontWeight: on ? "800" : "600", fontSize: 12 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </SafeAreaView>
      {conversation && (
        <Conversation
          key={JSON.stringify(conversation)}
          start={conversation}
          name={profile?.display_name}
          onClose={() => { setConversation(null); refresh(); }}
          onChanged={() => setRefreshKey((k) => k + 1)}
          onFollowUp={(at) => { scheduleFollowUp(at, profile?.display_name).catch(() => {}); }}
        />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  const c = useColors();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [launch, setLaunch] = useState<Launch>(null);

  useEffect(() => {
    Linking.getInitialURL().then((u) => setLaunch(launchFromUrl(u))).catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => { const l = launchFromUrl(url); if (l) setLaunch(l); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {session === undefined ? null : session ? <Main key={session.user.id} session={session} launch={launch} onLaunchHandled={() => setLaunch(null)} /> : <Login />}
      </View>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  tabbar: { flexDirection: "row", borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 },
  tabDot: { width: 18, height: 4, borderRadius: 2 },
  banner: { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1.5, gap: 2 },
});
