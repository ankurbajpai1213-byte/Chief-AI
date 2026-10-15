import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Speech from "expo-speech";
import { sayToChief, sendEvent, transcribe } from "../api";
import { companionAvailable, pauseWake, resumeWake, speakAndWait, stopSpeaking, wakeWasReal } from "../../modules/chief-companion";
import type { ChiefEvent, ChiefReply } from "../types";
import { radius, space, useColors } from "../theme";

// A hands-free conversation: Chief speaks, then listens; silence moves things along.
// Started by the morning unlock, a follow-up reminder, or the user.

type Phase = "thinking" | "speaking" | "listening" | "hearing" | "ended";

export type ConversationStart = ChiefEvent | { type: "wake" };

type Props = {
  start: ConversationStart;
  name?: string | null;
  onClose: () => void;
  onChanged: () => void;
  onFollowUp: (at: string) => void;
};

const WAIT_FOR_SPEECH_MS = 7000; // how long Chief waits for an answer
const END_OF_SPEECH_MS = 1600;   // pause that means "I'm done talking"
const MAX_ANSWER_MS = 30000;

// Never wait forever on the voice engine: if Android doesn't report "done", move on
// after a generous estimate of how long the sentence takes to say.
const speak = (text: string) =>
  new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
    const guard = setTimeout(finish, 2500 + text.length * 90);
    if (companionAvailable) {
      // Android's own voice: the same one as "Test Chief's voice".
      speakAndWait(text).then((ok) => { if (ok) finish(); else fallback(); });
    } else fallback();
    function fallback() {
      Speech.stop();
      Speech.speak(text, { language: "en-IN", volume: 1.0, onDone: finish, onStopped: finish, onError: finish });
    }
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Conversation({ start, name, onClose, onChanged, onFollowUp }: Props) {
  const c = useColors();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [phase, setPhase] = useState<Phase>("thinking");
  const [line, setLine] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const alive = useRef(true);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Record until the person stops talking. Returns null if they never started.
  const listen = async (): Promise<string | null> => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) throw new Error("Chief needs the microphone. Allow it in Android settings.");
    pauseWake(); // make sure "Hey Chief" has let go of the microphone
    await sleep(350);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();

    const startedAt = Date.now();
    let baseline: number | null = null;
    let spoke = false;
    let lastLoud = 0;
    let metered = false;
    let loudest = -160;

    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (!alive.current) { clearInterval(tick); resolve(); return; }
        const now = Date.now();
        const level = recorder.getStatus().metering;
        if (typeof level === "number" && Number.isFinite(level)) {
          metered = true;
          loudest = Math.max(loudest, level);
          if (now - startedAt < 500) baseline = baseline === null ? level : Math.min(baseline, level);
          // Relative to the room's noise, but a clearly loud sound always counts (even if they talked straight away).
          const threshold = Math.min(Math.max((baseline ?? -60) + 10, -48), -32);
          if (level > threshold) { spoke = true; lastLoud = now; }
        }
        const waitedTooLong = !spoke && now - startedAt > WAIT_FOR_SPEECH_MS;
        const finished = spoke && now - lastLoud > END_OF_SPEECH_MS;
        // Without level readings, fall back to a fixed 6-second answer window.
        const noMeter = !metered && now - startedAt > 6000;
        if (waitedTooLong || finished || noMeter || now - startedAt > MAX_ANSWER_MS) { clearInterval(tick); resolve(); }
      }, 150);
    });

    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setLevel(Math.round(loudest));
    // Only skip the upload when the microphone heard near-silence the whole time.
    if (metered && !spoke && loudest < -50) return null;
    if (!recorder.uri || !alive.current) return null;
    setPhase("hearing");
    const text = (await transcribe(recorder.uri)).trim();
    return text.length > 1 ? text : null;
  };

  useEffect(() => {
    alive.current = true;
    pauseWake(); // free the microphone from "Hey Chief" while we talk
    const keepPaused = setInterval(() => pauseWake(), 60000);
    const run = async () => {
      let next: Promise<ChiefReply>;
      let silentTurns = 0;
      try {
        if (start.type === "wake") {
          // "Hey Chief": answer at once, then listen for the request.
          const hello = name ? `Yes, ${name}?` : "Yes?";
          setLine(hello);
          setPhase("speaking");
          await speak(hello);
          if (!alive.current) return;
          setPhase("listening");
          const first = await listen();
          if (!alive.current) return;
          if (!first) {
            setLine("I didn't catch that. Say \"Hey Chief\" again, or tap Close.");
            setPhase("ended");
            return;
          }
          setHeard(first);
          wakeWasReal(); // you really were talking to Chief
          next = sayToChief(first, true);
        } else {
          next = sendEvent(start);
        }
        while (alive.current) {
          setPhase("thinking");
          const r = await next;
          if (!alive.current) return;
          if (r.changed) onChanged();
          if (r.follow_up_at) onFollowUp(r.follow_up_at);
          setLine(r.reply);
          setHeard("");
          setPhase("speaking");
          await speak(r.reply);
          if (!alive.current || r.done) break;
          setPhase("listening");
          const answer = await listen();
          if (!alive.current) return;
          if (answer) {
            silentTurns = 0;
            setHeard(answer);
            next = sayToChief(answer, true);
          } else {
            silentTurns++;
            if (silentTurns >= 3) break; // safety net if Chief keeps asking into silence
            next = sendEvent({ type: "no_answer" });
          }
        }
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      if (alive.current) setPhase("ended");
    };
    run();
    return () => {
      alive.current = false;
      Speech.stop();
      stopSpeaking();
      recorder.stop().catch(() => {});
      clearInterval(keepPaused);
      resumeWake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close by itself when finished, so "Hey Chief" starts listening again.
  useEffect(() => {
    if (phase !== "ended" || error) return;
    const t = setTimeout(() => { if (alive.current) { alive.current = false; onClose(); } }, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, error]);

  const close = () => {
    alive.current = false;
    Speech.stop();
    stopSpeaking();
    onClose();
  };

  const label: Record<Phase, string> = {
    thinking: "Chief is thinking…",
    speaking: "Chief is speaking",
    listening: "Listening… just talk",
    hearing: "Got it…",
    ended: "That's all for now",
  };
  const orbColor = phase === "listening" ? c.you : phase === "ended" ? c.done : c.chief;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, phase === "listening" || phase === "speaking" ? 1.12 : 1.04] });

  return (
    <View style={[s.wrap, { backgroundColor: c.bg }]}>
      <Text style={[s.kicker, { color: c.muted }]}>CHIEF</Text>
      <View style={s.center}>
        <Animated.View style={[s.orb, { backgroundColor: orbColor, transform: [{ scale }] }]} />
        <Text style={[s.state, { color: c.muted }]}>{label[phase]}</Text>
        {!!line && <Text style={[s.line, { color: c.ink }]}>{line}</Text>}
        {!!heard && <Text style={[s.heard, { color: c.you }]}>You: {heard}</Text>}
        {error && <Text style={[s.heard, { color: c.slip }]}>{error}</Text>}
        {phase === "ended" && level !== null && <Text style={[s.heard, { color: c.muted, fontSize: 12 }]}>Mic level heard: {level} dB</Text>}
      </View>
      <Pressable onPress={close} accessibilityRole="button" style={[s.close, { borderColor: c.line, backgroundColor: c.surface }]}>
        <Text style={{ color: c.ink, fontWeight: "700", fontSize: 16 }}>{phase === "ended" ? "Close" : "Stop"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill, paddingHorizontal: space.xl, paddingTop: 56, paddingBottom: 40, zIndex: 10 },
  kicker: { fontSize: 12, letterSpacing: 2, fontWeight: "800", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg },
  orb: { width: 140, height: 140, borderRadius: 70, opacity: 0.9 },
  state: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  line: { fontSize: 22, lineHeight: 30, fontWeight: "600", textAlign: "center" },
  heard: { fontSize: 15, textAlign: "center" },
  close: { borderWidth: 1.5, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
});
