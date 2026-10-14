import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { supabase } from "../supabase";
import { sendEvent } from "../api";
import type { ChiefReply, Step } from "../types";
import { radius, space, useColors } from "../theme";
import { Body, Button, Card, Empty, fmtTime, H1, Label, Row } from "../ui";

type Props = { refreshKey: number; thinking: boolean; ask: (p: Promise<ChiefReply>) => Promise<void> };
type Answer = { done?: boolean; reason?: string };

const REASONS = ["No time", "Too big", "Stuck", "Not now"];

export default function Checkin({ refreshKey, thinking, ask }: Props) {
  const c = useColors();
  const [steps, setSteps] = useState<Step[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [extra, setExtra] = useState("");

  const load = useCallback(async () => {
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    const eod = new Date(sod.getTime() + 86400000);
    const { data } = await supabase.from("steps")
      .select("id, project_id, title, minutes, scheduled_at, status, postpone_count, completed_at, projects(title)")
      .eq("status", "planned").lt("scheduled_at", eod.toISOString()).order("scheduled_at");
    setSteps((data as unknown as Step[]) ?? []);
    setAnswers({});
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const set = (id: string, a: Answer) => setAnswers((m) => ({ ...m, [id]: { ...m[id], ...a } }));
  const answered = steps.filter((s) => answers[s.id]?.done !== undefined);
  const ready = steps.length === 0 ? extra.trim().length > 0 : answered.length === steps.length;

  const submit = () =>
    ask(sendEvent({
      type: "evening_checkin",
      results: answered.map((s) => ({ step_id: s.id, done: !!answers[s.id].done, reason: answers[s.id].reason })),
      extra: extra.trim() || undefined,
    })).then(() => setExtra(""));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.xs }}>
        <Label>One minute</Label>
        <H1>Evening check-in</H1>
        <Body muted>Did today's steps happen? Chief counts what you did first.</Body>
      </View>

      {steps.length === 0 && <Empty title="No steps were due today" hint="Add anything you did below, or ask Chief to plan tomorrow." />}

      {steps.map((s) => {
        const a = answers[s.id] ?? {};
        return (
          <Card key={s.id} tone={a.done === true ? "done" : a.done === false ? "slip" : "plain"}>
            <Label style={{ color: c.chief }}>{fmtTime(s.scheduled_at)} · {s.minutes} min</Label>
            <Body style={{ fontWeight: "700" }}>{s.title}</Body>
            <Row>
              <Button title="Did it" tone="done" small filled={a.done === true} onPress={() => set(s.id, { done: true, reason: undefined })} />
              <Button title="Didn't" tone="slip" small filled={a.done === false} onPress={() => set(s.id, { done: false })} />
            </Row>
            {a.done === false && (
              <View style={{ gap: space.xs }}>
                <Label>What got in the way?</Label>
                <Row>{REASONS.map((r) => <Button key={r} title={r} tone="plain" small filled={a.reason === r} onPress={() => set(s.id, { reason: r })} />)}</Row>
              </View>
            )}
          </Card>
        );
      })}

      <Label>Anything else you did today?</Label>
      <TextInput
        style={{ borderWidth: 1.5, borderColor: c.line, borderRadius: radius.md, padding: 12, color: c.ink, backgroundColor: c.surface, minHeight: 70, fontSize: 15, textAlignVertical: "top" }}
        placeholder="e.g. Sent the client invoice, went for a run" placeholderTextColor={c.muted}
        multiline value={extra} onChangeText={setExtra}
      />
      <Button title={ready ? "Send to Chief" : `Answer all ${steps.length} steps`} filled disabled={!ready} busy={thinking} onPress={submit} />
    </ScrollView>
  );
}
