import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { supabase } from "../supabase";
import { sayToChief, transcribe } from "../api";
import type { ChiefReply, Message } from "../types";
import { radius, space, useColors } from "../theme";
import { Body, Button, Label, Row } from "../ui";

type Props = {
  refreshKey: number;
  thinking: boolean;
  quickReplies: string[];
  ask: (p: Promise<ChiefReply>) => Promise<void>;
};

export default function Talk({ refreshKey, thinking, quickReplies, ask }: Props) {
  const c = useColors();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [hearing, setHearing] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 200);
  const pressStart = useRef(0);
  const starting = useRef<Promise<boolean> | null>(null);
  const isRec = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("messages").select("id, role, content, created_at")
      .neq("role", "event").order("created_at", { ascending: false }).limit(60);
    setMessages((data as Message[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const send = async (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    setText("");
    setHint(null);
    // Show it immediately; the saved copy replaces it on reload.
    setMessages((m) => [{ id: `local-${Date.now()}`, role: "user", content: clean, created_at: new Date().toISOString() }, ...m]);
    await ask(sayToChief(clean));
  };

  const startRecording = () => {
    setHint(null);
    pressStart.current = Date.now();
    starting.current = (async () => {
      try {
        const { granted } = await AudioModule.requestRecordingPermissionsAsync();
        if (!granted) { setHint("Allow microphone access in Android settings to talk to Chief."); return false; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        isRec.current = true;
        return true;
      } catch {
        setHint("Couldn't start the microphone. Try again or type.");
        return false;
      }
    })();
  };

  const stopRecording = async () => {
    const ok = await starting.current;
    starting.current = null;
    if (!ok || !isRec.current) return;
    isRec.current = false;
    const held = Date.now() - pressStart.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch { /* already stopped */ }
    if (held < 700) { setHint("Hold the mic while you speak, then let go."); return; }
    const uri = recorder.uri;
    if (!uri) return;
    setHearing(true);
    try {
      const heard = await transcribe(uri);
      if (heard) await send(heard);
      else setHint("Didn't catch that. Try again a little closer to the phone.");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Couldn't hear that. Try again or type.");
    } finally {
      setHearing(false);
    }
  };

  const recording = rec.isRecording;
  const busy = thinking || hearing;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      {messages.length === 0 ? (
        // Shown outside the inverted list: Android flips inverted content on both axes.
        <View style={{ flex: 1, justifyContent: "flex-end", padding: space.lg, gap: space.sm }}>
          <Label style={{ color: c.chief }}>Start here</Label>
          <Body>Hold the mic and tell Chief what's on your plate: work, side projects, family, anything you've promised yourself.</Body>
          <Body muted>Try: "I want to start a new project" or "Plan my day."</Body>
        </View>
      ) : (
      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        renderItem={({ item }) => {
          const mine = item.role === "user";
          return (
            <View style={[s.bubble, mine
              ? { alignSelf: "flex-end", backgroundColor: c.you, borderBottomRightRadius: 4 }
              : { alignSelf: "flex-start", backgroundColor: c.chiefSoft, borderColor: c.chief, borderWidth: 1, borderBottomLeftRadius: 4 }]}>
              <Text style={{ color: mine ? c.onAccent : c.ink, fontSize: 15, lineHeight: 21 }}>{item.content}</Text>
            </View>
          );
        }}
      />
      )}

      <View style={[s.dock, { borderTopColor: c.line, backgroundColor: c.bg }]}>
        {busy && (
          <Row>
            <ActivityIndicator color={c.chief} />
            <Body muted>{hearing ? "Listening back…" : "Chief is thinking…"}</Body>
          </Row>
        )}
        {!busy && quickReplies.length > 0 && (
          <Row>{quickReplies.map((q) => <Button key={q} title={q} small onPress={() => send(q)} />)}</Row>
        )}
        {hint && <Body style={{ color: c.slip }}>{hint}</Body>}

        <View style={s.inputRow}>
          <TextInput
            style={[s.input, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }]}
            placeholder="Type instead…" placeholderTextColor={c.muted}
            value={text} onChangeText={setText} onSubmitEditing={() => send(text)} returnKeyType="send"
            editable={!busy}
          />
          {text.trim() ? (
            <Button title="Send" filled onPress={() => send(text)} disabled={busy} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hold to talk to Chief"
              onPressIn={startRecording}
              onPressOut={stopRecording}
              disabled={busy}
              style={[s.mic, { backgroundColor: recording ? c.slip : c.chief, opacity: busy ? 0.5 : 1, borderColor: recording ? c.slipSoft : c.chiefSoft }]}
            >
              <MicGlyph color={c.onAccent} />
            </Pressable>
          )}
        </View>
        <Label style={{ textAlign: "right" }}>{recording ? `Listening… ${Math.floor(rec.durationMillis / 1000)}s · let go to send` : "Hold to talk"}</Label>
      </View>
    </KeyboardAvoidingView>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: 14, height: 22, borderRadius: 7, backgroundColor: color }} />
      <View style={{ width: 22, height: 10, borderBottomLeftRadius: 11, borderBottomRightRadius: 11, borderWidth: 2.5, borderTopWidth: 0, borderColor: color, marginTop: -6 }} />
      <View style={{ width: 2.5, height: 5, backgroundColor: color }} />
    </View>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: "86%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  dock: { borderTopWidth: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: space.sm },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  input: { flex: 1, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  mic: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 6 },
});
