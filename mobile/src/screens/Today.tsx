import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { supabase } from "../supabase";
import { sendEvent } from "../api";
import type { ChiefReply, Step } from "../types";
import { space, useColors } from "../theme";
import { Body, Button, Card, Empty, fmtDay, fmtTime, H1, Label, Row } from "../ui";

type Props = { refreshKey: number; thinking: boolean; ask: (p: Promise<ChiefReply>) => Promise<void>; onStartConversation: () => void };

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export default function Today({ refreshKey, thinking, ask, onStartConversation }: Props) {
  const c = useColors();
  const [today, setToday] = useState<Step[]>([]);
  const [overdue, setOverdue] = useState<Step[]>([]);
  const [unscheduled, setUnscheduled] = useState<Step[]>([]);
  const [upcoming, setUpcoming] = useState<Step[]>([]);
  const [doneToday, setDoneToday] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const sod = startOfDay();
    const tomorrow = new Date(sod.getTime() + 86400000);
    const week = new Date(sod.getTime() + 7 * 86400000);
    const cols = "id, project_id, title, minutes, scheduled_at, status, postpone_count, completed_at, projects(title)";
    const [t, o, u, n, d] = await Promise.all([
      supabase.from("steps").select(cols).eq("status", "planned").gte("scheduled_at", sod.toISOString()).lt("scheduled_at", tomorrow.toISOString()).order("scheduled_at"),
      supabase.from("steps").select(cols).in("status", ["planned", "missed"]).lt("scheduled_at", sod.toISOString()).order("scheduled_at"),
      supabase.from("steps").select(cols).eq("status", "planned").is("scheduled_at", null).limit(10),
      supabase.from("steps").select(cols).eq("status", "planned").gte("scheduled_at", tomorrow.toISOString()).lt("scheduled_at", week.toISOString()).order("scheduled_at").limit(8),
      supabase.from("steps").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", sod.toISOString()),
    ]);
    setToday((t.data as unknown as Step[]) ?? []);
    setOverdue((o.data as unknown as Step[]) ?? []);
    setUnscheduled((u.data as unknown as Step[]) ?? []);
    setUpcoming((n.data as unknown as Step[]) ?? []);
    setDoneToday(d.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const StepCard = ({ step, late }: { step: Step; late?: boolean }) => (
    <Card tone={late ? "slip" : "plain"}>
      <Row style={{ justifyContent: "space-between" }}>
        <Label style={{ color: late ? c.slip : c.chief }}>
          {late ? `Missed · ${fmtDay(step.scheduled_at)}` : fmtTime(step.scheduled_at)} · {step.minutes} min
        </Label>
        {step.postpone_count >= 3 && <Label style={{ color: c.slip }}>Slipped {step.postpone_count}×</Label>}
      </Row>
      <Body style={{ fontWeight: "700", fontSize: 16 }}>{step.title}</Body>
      {step.projects?.title && <Body muted>{step.projects.title}</Body>}
      <Row>
        <Button title="Done" tone="done" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_done", step_id: step.id }))} />
        <Button title="Later" tone="plain" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_later", step_id: step.id }))} />
        <Button title="Smaller" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_smaller", step_id: step.id }))} />
      </Row>
    </Card>
  );

  const dateLine = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.chief} />}
    >
      <View style={{ gap: space.xs }}>
        <Label>{dateLine}</Label>
        <H1>Today</H1>
        <Body muted>{doneToday > 0 ? `${doneToday} done so far today.` : "Nothing finished yet today."}</Body>
      </View>

      <Row>
        <Button title="Plan my day" filled busy={thinking} onPress={() => ask(sendEvent({ type: "plan_day" }))} />
        <Button title="Talk it through" tone="plain" disabled={thinking} onPress={onStartConversation} />
      </Row>

      {overdue.length > 0 && <Label style={{ color: c.slip }}>Still open from earlier</Label>}
      {overdue.map((s) => <StepCard key={s.id} step={s} late />)}

      <Label>Scheduled today</Label>
      {today.length === 0
        ? <Empty title="No steps with a time today" hint="Tap Plan my day, or hold the mic on Talk and tell Chief what you need to get done." />
        : today.map((s) => <StepCard key={s.id} step={s} />)}

      {unscheduled.length > 0 && <Label>Needs a time</Label>}
      {unscheduled.map((s) => <StepCard key={s.id} step={s} />)}

      {upcoming.length > 0 && <Label>Next 7 days</Label>}
      {upcoming.map((s) => (
        <Card key={s.id}>
          <Label style={{ color: c.chief }}>{fmtDay(s.scheduled_at)} · {fmtTime(s.scheduled_at)} · {s.minutes} min</Label>
          <Body style={{ fontWeight: "700" }}>{s.title}</Body>
          {s.projects?.title && <Body muted>{s.projects.title}</Body>}
        </Card>
      ))}
    </ScrollView>
  );
}
