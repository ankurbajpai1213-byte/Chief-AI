import React, { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Switch, TextInput, View } from "react-native";
import { canOpenByItself, companionAvailable, openOpenByItselfSettings, resetMorningToday } from "../../modules/chief-companion";
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
          {morningAuto && canOpen && <Body style={{ color: c.done }}>Chief can open by itself.</Body>}
          <Body muted>Android shows a small "Chief is ready for your morning" notification while this is on.</Body>
          <Button title="Rehearse tomorrow's start today" tone="plain" small onPress={() => { resetMorningToday(); setMsg({ text: "Lock your phone, then unlock it. Chief should start about a minute later (only after your wake time)." }); }} />
          <Button title="Save" filled busy={saving} onPress={save} />
        </Card>
      )}

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
