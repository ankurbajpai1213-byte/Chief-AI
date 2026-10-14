import React, { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Switch, TextInput, View } from "react-native";
import { calendarEnabled, checkCalendar, setCalendarEnabled } from "../calendar";
import {
  canOpenByItself, companionAvailable, configureWake, openOpenByItselfSettings, resetMorningToday,
  sayNow, setSpeak, speakEnabled, wakeStatus, refreshCompanion, openBatterySettings, type WakeStatus,
} from "../../modules/chief-companion";
import { AudioModule } from "expo-audio";
import { supabase } from "../supabase";
import type { LifeNote, Profile } from "../types";
import { radius, space, useColors } from "../theme";
import { Body, Button, Card, H1, Label, Row } from "../ui";

type Props = { profile: Profile | null; onSaved: () => void };

const AREAS: { key: string; label: string }[] = [
  { key: "work", label: "Work" }, { key: "money", label: "Money" }, { key: "side_projects", label: "Side projects" },
  { key: "family", label: "Family" }, { key: "health", label: "Health" }, { key: "learning", label: "Learning" },
];
const validTime = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());

export default function Settings({ profile, onSaved }: Props) {
  const c = useColors();
  const [name, setName] = useState("");
  const [morning, setMorning] = useState("09:00");
  const [evening, setEvening] = useState("21:00");
  const [maxActive, setMaxActive] = useState(3);
  const [voice, setVoice] = useState(true);
  const [morningAuto, setMorningAuto] = useState(true);
  const [wake, setWake] = useState("06:00");
  const [canOpen, setCanOpen] = useState(false);
  const [useCal, setUseCal] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [wakeKey, setWakeKey] = useState("");
  const [speak, setSpeakState] = useState(true);
  const [wakeMsg, setWakeMsg] = useState<string | null>(null);
  const [live, setLive] = useState<WakeStatus | null>(null);

  // Show what the wake word is actually doing, refreshed every few seconds.
  useEffect(() => {
    const tick = () => setLive(wakeStatus());
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<LifeNote[]>([]);
  const [area, setArea] = useState("work");
  const [noteText, setNoteText] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? "");
    setMorning(profile.morning_checkin.slice(0, 5));
    setEvening(profile.evening_checkin.slice(0, 5));
    setMaxActive(profile.max_active_projects);
    setVoice(profile.voice_replies);
    setMorningAuto(profile.morning_auto);
    setWake(profile.wake_time.slice(0, 5));
  }, [profile]);

  useEffect(() => { calendarEnabled().then(setUseCal); }, []);
  useEffect(() => {
    const st = wakeStatus();
    setWakeOn(st.on);
    setHasKey(st.hasKey);
    setSpeakState(speakEnabled());
  }, []);

  const toggleWake = async (on: boolean) => {
    setWakeMsg(null);
    if (on) {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { setWakeMsg("Chief needs the microphone to hear \"Hey Chief\"."); return; }
      if (!hasKey && !wakeKey.trim()) { setWakeMsg("Paste your Picovoice AccessKey first."); return; }
    }
    configureWake(on, wakeKey);
    if (wakeKey.trim()) { setHasKey(true); setWakeKey(""); }
    setWakeOn(on);
    if (on) setWakeMsg("Listening for the wake word. Say it, wait for the beep, then speak.");
  };

  // Re-check "open by itself" when coming back from Android settings.
  useEffect(() => {
    const check = () => { try { setCanOpen(canOpenByItself()); } catch { setCanOpen(false); } };
    check();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") check(); });
    return () => sub.remove();
  }, []);

  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from("life_notes").select("id, area, content").order("created_at");
    setNotes((data as LifeNote[]) ?? []);
  }, []);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const save = async () => {
    if (!profile) return;
    if (!validTime(morning) || !validTime(evening) || !validTime(wake)) { setMsg({ text: "Use 24-hour times like 06:30, 09:00 and 21:00.", bad: true }); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: name.trim() || null, morning_checkin: morning.trim(), evening_checkin: evening.trim(),
      max_active_projects: maxActive, voice_replies: voice, wake_time: wake.trim(), morning_auto: morningAuto,
    }).eq("id", profile.id);
    setSaving(false);
    setMsg(error ? { text: error.message, bad: true } : { text: "Saved. Check-in reminders updated." });
    if (!error) onSaved();
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await supabase.from("life_notes").insert({ area, content: noteText.trim() });
    setNoteText("");
    loadNotes();
  };

  const input = { borderWidth: 1.5, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.ink, backgroundColor: c.surface, fontSize: 15 };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.xs }}>
        <Label>You</Label>
        <H1>Settings</H1>
      </View>

      {companionAvailable && (
        <Card>
          <Label>Chief starts your morning</Label>
          <Body muted>After your first unlock past your wake time, Chief opens and talks you through the day. Once a day, only in the morning.</Body>
          <Row style={{ justifyContent: "space-between" }}>
            <Body>Start my morning automatically</Body>
            <Switch value={morningAuto} onValueChange={setMorningAuto} trackColor={{ true: c.chief, false: c.line }} />
          </Row>
          <Label>Wake time</Label>
          <TextInput style={input} value={wake} onChangeText={setWake} keyboardType="numbers-and-punctuation" placeholder="06:00" placeholderTextColor={c.muted} />
          {morningAuto && !canOpen && (
            <View style={{ gap: space.xs }}>
              <Body style={{ color: c.slip }}>To open by itself, Chief needs "Display over other apps". Without it, Chief sends a notification to tap instead.</Body>
              <Button title="Allow Chief to open by itself" small onPress={() => openOpenByItselfSettings()} />
            </View>
          )}

      <Card>
        <Label>Your name</Label>
        <TextInput style={input} value={name} onChangeText={setName} placeholder="What Chief calls you" placeholderTextColor={c.muted} />
        <Row style={{ gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Label>Morning check-in</Label>
            <TextInput style={input} value={morning} onChangeText={setMorning} keyboardType="numbers-and-punctuation" placeholder="09:00" placeholderTextColor={c.muted} />
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Label>Evening check-in</Label>
            <TextInput style={input} value={evening} onChangeText={setEvening} keyboardType="numbers-and-punctuation" placeholder="21:00" placeholderTextColor={c.muted} />
          </View>
        </Row>
        <Label>Active project limit</Label>
        <Row>
          {[1, 2, 3, 4, 5].map((n) => <Button key={n} title={String(n)} small tone="plain" filled={maxActive === n} onPress={() => setMaxActive(n)} />)}
        </Row>
        <Row style={{ justifyContent: "space-between" }}>
          <Body>Chief speaks replies out loud</Body>
          <Switch value={voice} onValueChange={setVoice} trackColor={{ true: c.chief, false: c.line }} />
        </Row>
        {msg && <Body style={{ color: msg.bad ? c.slip : c.done }}>{msg.text}</Body>}
        <Button title="Save" filled busy={saving} onPress={save} />
      </Card>

          {morningAuto && canOpen && <Body style={{ color: c.done }}>Chief can open by itself.</Body>}
          <Body muted>Android shows a small "Chief is ready for your morning" notification while this is on.</Body>
          <Button title="Rehearse tomorrow's start today" tone="plain" small onPress={() => { resetMorningToday(); setMsg({ text: "Lock your phone, then unlock it. Chief should start about a minute later (only after your wake time)." }); }} />
          <Button title="Save" filled busy={saving} onPress={save} />
        </Card>
      )}

      {companionAvailable && (
        <Card>
          <Label>Hey Chief</Label>
          <Body muted>Say the wake word, wait for the beep, then ask: "What's next?", "Plan my day", "Call me in 10 minutes". Works with the screen off. Android shows a microphone indicator while it listens.</Body>
          {!hasKey && (
            <TextInput style={input} value={wakeKey} onChangeText={setWakeKey} placeholder="Picovoice AccessKey" placeholderTextColor={c.muted} autoCapitalize="none" secureTextEntry />
          )}
          {hasKey && <Body style={{ color: c.done }}>AccessKey saved on this phone.</Body>}
          <Row style={{ justifyContent: "space-between" }}>
            <Body>Listen for "Hey Chief"</Body>
            <Switch value={wakeOn} onValueChange={toggleWake} trackColor={{ true: c.chief, false: c.line }} />
          </Row>
          {wakeMsg && <Body style={{ color: wakeMsg.startsWith("Listening") ? c.done : c.slip }}>{wakeMsg}</Body>}
          {wakeOn && live && (
            <View style={{ gap: space.xs }}>
              <Body style={{ color: live.listening ? c.done : c.slip, fontWeight: "700" }}>
                {live.listening ? "● Listening now" : live.paused ? "Paused while you talk to Chief" : "○ Not listening"}
              </Body>
              {!live.listening && !live.paused && (
                <Body muted>Not listening. Tap Restart listening; if it keeps stopping, allow Chief to run without battery limits.</Body>
              )}
              {!!live.lastError && <Body style={{ color: c.slip }}>Reason: {live.lastError}</Body>}
              <Row>
                <Button title="Restart listening" small onPress={() => { refreshCompanion(); setTimeout(() => setLive(wakeStatus()), 1500); }} />
                {!live.batteryUnrestricted && <Button title="Remove battery limits" tone="plain" small onPress={() => openBatterySettings()} />}
              </Row>
            </View>
          )}
          <Row style={{ justifyContent: "space-between" }}>
            <Body>Say reminders out loud (not on silent)</Body>
            <Switch value={speak} onValueChange={(on) => { setSpeak(on); setSpeakState(on); }} trackColor={{ true: c.chief, false: c.line }} />
          </Row>
          <Button title="Test Chief's voice" tone="plain" small onPress={() => sayNow(`Hey ${name || "there"}, this is how I'll remind you.`)} />
        </Card>
      )}

      <Card>
        <Label>Your calendar</Label>
        <Body muted>Chief reads the calendars on this phone (including Google Calendar and work calendars synced to it) so it plans around your meetings. Read only.</Body>
        <Row style={{ justifyContent: "space-between" }}>
          <Body>Use my phone's calendar</Body>
          <Switch
            value={useCal}
            trackColor={{ true: c.chief, false: c.line }}
            onValueChange={async (on) => {
              const ok = await setCalendarEnabled(on);
              setUseCal(ok);
              setCalMsg(on && !ok ? "Calendar access was denied. Allow it in Android settings → Apps → Chief → Permissions." : null);
            }}
          />
        </Row>
        {calMsg && <Body style={{ color: calMsg.startsWith("✓") ? c.done : c.slip }}>{calMsg}</Body>}
        {useCal && (
          <Button title="Check what Chief can see" tone="plain" small onPress={async () => {
            const r = await checkCalendar(2);
            if (r.error) setCalMsg(`Couldn't read the calendar: ${r.error}`);
            else if (!r.permission) setCalMsg("Calendar permission is off. Allow it in Android settings → Apps → Chief → Permissions.");
            else if (!r.calendars) setCalMsg("No calendars found on this phone. Make sure Google Calendar is synced to this phone.");
            else setCalMsg(`✓ ${r.calendars} calendars, ${r.events.length} events today and tomorrow${r.events[0] ? ` (first: ${r.events[0].title})` : ""}.`);
          }} />
        )}
      </Card>

      <Card>
        <Label>Your life, for Chief</Label>
        <Body muted>Things Chief should always weigh: your job hours, family duties, money goals, health limits. Chief also adds notes here when you mention them.</Body>
        {notes.map((n) => (
          <Row key={n.id} style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <Body style={{ flex: 1 }}>
              <Body style={{ color: c.chief, fontWeight: "700" }}>{AREAS.find((a) => a.key === n.area)?.label ?? "Other"} · </Body>
              {n.content}
            </Body>
            <Button title="Remove" tone="plain" small onPress={async () => { await supabase.from("life_notes").delete().eq("id", n.id); loadNotes(); }} />
          </Row>
        ))}
        <Row>{AREAS.map((a) => <Button key={a.key} title={a.label} small tone="plain" filled={area === a.key} onPress={() => setArea(a.key)} />)}</Row>
        <TextInput style={input} value={noteText} onChangeText={setNoteText} placeholder="e.g. Office calls 10:00–18:00 on weekdays" placeholderTextColor={c.muted} onSubmitEditing={addNote} />
        <Button title="Add note" onPress={addNote} disabled={!noteText.trim()} />
      </Card>

      <Card>
        <Label>Account</Label>
        <Button title="Sign out" tone="plain" onPress={() => supabase.auth.signOut()} />
        {!confirmDelete ? (
          <Button title="Delete all my data" tone="slip" onPress={() => setConfirmDelete(true)} />
        ) : (
          <View style={{ gap: space.sm }}>
            <Body style={{ color: c.slip }}>This permanently deletes your account, projects, steps, notes and messages.</Body>
            <Row>
              <Button title="Delete everything" tone="slip" filled onPress={async () => {
                const { error } = await supabase.rpc("delete_my_account");
                if (error) setMsg({ text: error.message, bad: true }); else await supabase.auth.signOut();
              }} />
              <Button title="Keep my data" tone="plain" onPress={() => setConfirmDelete(false)} />
            </Row>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}
