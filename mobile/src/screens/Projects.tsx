import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { supabase } from "../supabase";
import { sayToChief } from "../api";
import type { ChiefReply, Project } from "../types";
import { space, useColors } from "../theme";
import { Body, Button, Card, Empty, H1, Label, Row } from "../ui";

type Props = {
  refreshKey: number;
  thinking: boolean;
  maxActive: number;
  ask: (p: Promise<ChiefReply>) => Promise<void>;
  onLocalChange: () => void;
};

const GOAL: Record<string, string> = { money: "Money", business: "Business", personal: "Personal", health: "Health", learning: "Learning", family: "Family", other: "Other" };

export default function Projects({ refreshKey, thinking, maxActive, ask, onLocalChange }: Props) {
  const c = useColors();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("projects").select("*").in("status", ["active", "parked"]).order("created_at");
    setProjects((data as Project[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const active = projects.filter((p) => p.status === "active");
  const parked = projects.filter((p) => p.status === "parked");

  const setStatus = async (p: Project, status: Project["status"]) => {
    setNote(null);
    if (status === "active" && active.length >= maxActive) {
      setNote(`You have ${maxActive} active projects. Park one first, or ask Chief which one to drop.`);
      return;
    }
    await supabase.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (status !== "active") await supabase.from("steps").update({ status: "parked" }).eq("project_id", p.id).eq("status", "planned");
    else await supabase.from("steps").update({ status: "planned" }).eq("project_id", p.id).eq("status", "parked");
    await load();
    onLocalChange();
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.chief} />}
    >
      <View style={{ gap: space.xs }}>
        <Label>Focus</Label>
        <H1>Projects</H1>
        <Body muted>Chief keeps you to {maxActive} active projects. Anything new means choosing what to pause.</Body>
      </View>

      <Button
        title="Start a new project"
        filled
        busy={thinking}
        onPress={() => ask(sayToChief("I want to start a new project. Ask me about it before adding it."))}
      />
      {note && <Body style={{ color: c.slip }}>{note}</Body>}

      <Label>Active · {active.length} of {maxActive}</Label>
      {active.length === 0 && <Empty title="No active projects yet" hint="Tap Start a new project. Chief will ask why it matters before adding it." />}
      {active.map((p) => (
        <Card key={p.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "800", fontSize: 17 }}>{p.title}</Body>
            {p.goal_type && <Label style={{ color: c.chief }}>{GOAL[p.goal_type] ?? p.goal_type}</Label>}
          </Row>
          {p.why && <Body muted>Why: {p.why}</Body>}
          {p.deadline && <Body muted>Deadline: {new Date(p.deadline).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</Body>}
          {p.milestones?.length > 0 && (
            <View style={{ gap: 2 }}>
              {p.milestones.map((m, i) => <Body key={i}>{i + 1}. {m}</Body>)}
            </View>
          )}
          <Row>
            <Button title="Park" tone="plain" small onPress={() => setStatus(p, "parked")} />
            <Button title="Finished" tone="done" small onPress={() => setStatus(p, "done")} />
          </Row>
        </Card>
      ))}

      {parked.length > 0 && <Label>Parked</Label>}
      {parked.map((p) => (
        <Card key={p.id} style={{ opacity: 0.85 }}>
          <Body style={{ fontWeight: "700" }}>{p.title}</Body>
          {p.status_reason && <Body muted>{p.status_reason}</Body>}
          <Row>
            <Button title="Resume" small onPress={() => setStatus(p, "active")} />
            <Button title="Drop" tone="slip" small onPress={() => setStatus(p, "dropped")} />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}
