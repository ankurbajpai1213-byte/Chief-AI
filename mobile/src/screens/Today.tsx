import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { supabase } from "../supabase";
import { sendEvent } from "../api";
import { upcomingEvents, type CalEvent } from "../calendar";
import type { ChiefReply, Step } from "../types";
import { radius, space, useColors } from "../theme";
import { Body, Button, Card, Empty, fmtDay, fmtTime, H1, Label, Row } from "../ui";

type Props = { refreshKey: number; thinking: boolean; ask: (p: Promise<ChiefReply>) => Promise<void>; onStartConversation: () => void };

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// One timeline for the day: Chief's locked-in steps and calendar events, in time order.
// When a step and an event are the same thing (same title, about the same time), show it once with both chips.
type DayItem = { key: string; at: number; end: number; title: string; step?: Step; event?: CalEvent };
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function buildDay(steps: Step[], events: CalEvent[]): DayItem[] {
  const items: DayItem[] = [];
  const used = new Set<number>();
  for (const st of steps) {
    const at = new Date(st.scheduled_at!).getTime();
    const ei = events.findIndex((e, i) => !used.has(i) && !e.all_day
      && Math.abs(new Date(e.start).getTime() - at) <= 10 * 60000
      && (norm(e.title) === norm(st.title) || norm(e.title).includes(norm(st.title)) || norm(st.title).includes(norm(e.title))));
    if (ei >= 0) used.add(ei);
    items.push({ key: st.id, at, end: at + st.minutes * 60000, title: st.title, step: st, event: ei >= 0 ? events[ei] : undefined });
  }
  events.forEach((e, i) => {
    if (used.has(i)) return;
    const at = e.all_day ? startOfDay().getTime() - 1 : new Date(e.start).getTime();
    items.push({ key: `ev-${e.start}-${i}`, at, end: new Date(e.end).getTime(), title: e.title, event: e });
  });
  return items.sort((a, b) => a.at - b.at);
}

export default function Today({ refreshKey, thinking, ask, onStartConversation }: Props) {
  const c = useColors();
  const [today, setToday] = useState<Step[]>([]);
  const [overdue, setOverdue] = useState<Step[]>([]);
  const [unscheduled, setUnscheduled] = useState<Step[]>([]);
  const [upcoming, setUpcoming] = useState<Step[]>([]);
  const [doneToday, setDoneToday] = useState(0);
  const [proposed, setProposed] = useState<Step[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const sod = startOfDay();
    const tomorrow = new Date(sod.getTime() + 86400000);
    const week = new Date(sod.getTime() + 7 * 86400000);
    const cols = "id, project_id, title, minutes, scheduled_at, status, postpone_count, completed_at, projects(title)";
    const [t, o, u, n, d, pr, ev] = await Promise.all([
      supabase.from("steps").select(cols).eq("status", "planned").gte("scheduled_at", sod.toISOString()).lt("scheduled_at", tomorrow.toISOString()).order("scheduled_at"),
      supabase.from("steps").select(cols).in("status", ["planned", "missed"]).lt("scheduled_at", sod.toISOString()).order("scheduled_at"),
      supabase.from("steps").select(cols).eq("status", "planned").is("scheduled_at", null).limit(10),
      supabase.from("steps").select(cols).eq("status", "planned").gte("scheduled_at", tomorrow.toISOString()).lt("scheduled_at", week.toISOString()).order("scheduled_at").limit(8),
      supabase.from("steps").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", sod.toISOString()),
      supabase.from("steps").select(cols).eq("status", "proposed").order("scheduled_at"),
      upcomingEvents(1),
    ]);
    setProposed((pr.data as unknown as Step[]) ?? []);
    setEvents(ev);
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

  const Chip = ({ text, color, bg }: { text: string; color: string; bg: string }) => (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{text}</Text>
    </View>
  );

  const DayCard = ({ item }: { item: DayItem }) => {
    const { step, event } = item;
    const past = item.end < Date.now();
    const time = event?.all_day ? "All day"
      : step ? `${fmtTime(step.scheduled_at)} · ${step.minutes} min`
      : `${fmtTime(event!.start)}–${fmtTime(event!.end)}`;
    return (
      <Card style={past ? { opacity: 0.6 } : undefined}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Label style={{ color: step ? c.chief : c.muted }}>{time}</Label>
          <Row style={{ gap: space.xs }}>
            {step && <Chip text="Locked in" color={c.done} bg={c.doneSoft} />}
            {event && <Chip text="Calendar" color={c.you} bg={c.youSoft} />}
          </Row>
        </Row>
        <Body style={{ fontWeight: "700", fontSize: 16 }}>{item.title}</Body>
        {step?.projects?.title && <Body muted>{step.projects.title}</Body>}
        {step && (
          <Row>
            <Button title="Done" tone="done" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_done", step_id: step.id }))} />
            <Button title="Later" tone="plain" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_later", step_id: step.id }))} />
            <Button title="Smaller" small disabled={thinking} onPress={() => ask(sendEvent({ type: "step_smaller", step_id: step.id }))} />
          </Row>
        )}
      </Card>
    );
  };

  const day = buildDay(today, events);

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

      {proposed.length > 0 && (
        <Card tone="chief">
          <Label style={{ color: c.chief }}>Chief's proposal · not locked in yet</Label>
          {proposed.map((s) => (
            <Body key={s.id}>
              <Body style={{ fontWeight: "700" }}>{fmtDay(s.scheduled_at)} {fmtTime(s.scheduled_at)}</Body>  {s.title} · {s.minutes} min
            </Body>
          ))}
          <Body muted>No reminders until you approve.</Body>
          <Row>
            <Button title="Lock it in" tone="done" filled small disabled={thinking} onPress={() => ask(sendEvent({ type: "approve_plan" }))} />
            <Button title="Clear it" tone="slip" small disabled={thinking} onPress={() => ask(sendEvent({ type: "reject_plan" }))} />
          </Row>
        </Card>
      )}

      {overdue.length > 0 && <Label style={{ color: c.slip }}>Still open from earlier</Label>}
      {overdue.map((s) => <StepCard key={s.id} step={s} late />)}

      <Label>Your day</Label>
      {day.length === 0
        ? <Empty title="Nothing on today yet" hint="Tap Plan my day or Talk it through. Chief proposes, you approve, then reminders start." />
        : day.map((it) => <DayCard key={it.key} item={it} />)}

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
