// Chief's brain. One endpoint for everything the user says or does.
// Runs with the caller's own login, so database security rules apply to every query.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const NL = String.fromCharCode(10);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StepEvent =
  | { type: "step_done"; step_id: string }
  | { type: "step_later"; step_id: string; scheduled_at?: string }
  | { type: "step_smaller"; step_id: string }
  | { type: "evening_checkin"; results: { step_id: string; done: boolean; reason?: string }[]; extra?: string }
  | { type: "morning_checkin" }
  | { type: "plan_day" }
  | { type: "leak"; app: string; minutes: number }
  | { type: "morning_start" }
  | { type: "evening_start" }
  | { type: "no_answer" }
  | { type: "followup"; about?: string }
  | { type: "approve_plan" }
  | { type: "reject_plan" };

type CalEvent = { title: string; start: string; end: string; all_day?: boolean };

type Body = ({ kind: "chat"; text: string } | { kind: "event"; event: StepEvent }) & { calendar?: CalEvent[]; calendar_status?: "off" | "connected" | "no_permission"; voice?: boolean };

type Action =
  | { type: "create_project"; title: string; why?: string; outcome?: string; goal_type?: string; hours_per_week?: number; deadline?: string | null; milestones?: string[]; first_step?: { title: string; minutes?: number; scheduled_at?: string | null } }
  | { type: "set_project_status"; project_id: string; status: "active" | "parked" | "done" | "dropped"; reason?: string }
  | { type: "add_step"; project_id?: string | null; title: string; minutes?: number; scheduled_at?: string | null; from_user?: string; proposed?: boolean }
  | { type: "approve_plan" }
  | { type: "update_step"; step_id: string; title?: string; minutes?: number; scheduled_at?: string | null; status?: string }
  | { type: "add_life_note"; area: string; content: string }
  | { type: "update_settings"; display_name?: string; morning_checkin?: string; evening_checkin?: string; max_active_projects?: number; tone?: string; voice_replies?: boolean };

type Brain = { reply: string; quick_replies?: string[]; actions?: Action[]; done?: boolean; follow_up_at?: string | null };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await db.auth.getUser(auth.replace("Bearer ", ""));
    if (userErr || !userData.user) return json({ error: "Please sign in again." }, 401);
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    let userTurn: string;
    if (body.kind === "chat") {
      const text = (body.text ?? "").trim().slice(0, 4000);
      if (!text) return json({ error: "Say or type something first." }, 400);
      await db.from("messages").insert({ user_id: userId, role: "user", content: text });
      userTurn = body.voice ? `CONVERSATION MODE (spoken, hands-free): ${text}` : text;
    } else {
      userTurn = await applyEvent(db, userId, body.event);
      await db.from("messages").insert({ user_id: userId, role: "event", content: userTurn });
    }

    const calendar = (body.calendar ?? []).slice(0, 80).map((e) => ({ title: String(e.title ?? "").slice(0, 120), start: e.start, end: e.end, all_day: !!e.all_day }));
    const context = await loadContext(db, userId);
    const t0 = Date.now();
    const brain = await think(context, userTurn, calendar, body.calendar_status ?? (calendar.length ? "connected" : "off"));
    console.log(`brain_ms=${Date.now() - t0}`);
    // What the user has actually said: steps without a project must trace back to this.
    const evidence = [
      ...context.history.filter((m) => m.role === "user").map((m) => m.content),
      ...(body.kind === "chat" ? [body.text] : []),
      ...context.lifeNotes.map((n) => n.content),
      ...calendar.map((e) => e.title),
      ...context.projects.map((p) => p.title),
    ].join(" ").toLowerCase();
    const notes = await applyActions(db, userId, brain.actions ?? [], context.profile.max_active_projects, evidence);

    let reply = (brain.reply ?? "").trim();
    if (notes.length) reply += (reply ? NL + NL : "") + notes.join(" ");
    await db.from("messages").insert({ user_id: userId, role: "chief", content: reply });

    const followUp = brain.follow_up_at && !Number.isNaN(Date.parse(brain.follow_up_at)) && Date.parse(brain.follow_up_at) > Date.now() ? new Date(brain.follow_up_at).toISOString() : null;
    return json({
      reply,
      quick_replies: (brain.quick_replies ?? []).slice(0, 4),
      changed: (brain.actions ?? []).length > 0 || body.kind === "event",
      done: !!brain.done,
      follow_up_at: followUp,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 500);
  }
});

// ---------- events: do the obvious part in code, then let the brain respond ----------

async function applyEvent(db: SupabaseClient, userId: string, ev: StepEvent): Promise<string> {
  const step = async (id: string) => {
    const { data } = await db.from("steps").select("*, projects(title)").eq("id", id).single();
    if (!data) throw new Error("That step no longer exists.");
    return data;
  };
  switch (ev.type) {
    case "step_done": {
      const s = await step(ev.step_id);
      await db.from("steps").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", s.id);
      return s.project_id
        ? `[event] I marked "${s.title}" (project: ${s.projects?.title}) as DONE. Give a short well-done, then propose the next step for this project with a time (proposed=true, in the future).`
        : `[event] I marked "${s.title}" as DONE. Give a short well-done in one line. Do not propose or add any new step.`;
    }
    case "step_later": {
      const s = await step(ev.step_id);
      const count = (s.postpone_count ?? 0) + 1;
      const patch: Record<string, unknown> = { postpone_count: count };
      if (ev.scheduled_at) patch.scheduled_at = ev.scheduled_at;
      await db.from("steps").update(patch).eq("id", s.id);
      const pattern = count >= 3 ? ` This step has now been postponed ${count} times: name the pattern, ask what is really stopping me, offer a 10-minute version or parking it.` : "";
      return ev.scheduled_at
        ? `[event] I postponed "${s.title}" to ${ev.scheduled_at}.${pattern || " Acknowledge in one line."}`
        : `[event] I tapped Later on "${s.title}" (step_id ${s.id}). Ask when, with 3 time options as quick replies, and set it with update_step once I answer.${pattern}`;
    }
    case "step_smaller": {
      const s = await step(ev.step_id);
      return `[event] "${s.title}" (step_id ${s.id}, ${s.minutes} min) feels too big. Replace it with a smaller first piece (10–20 min): update_step the title and minutes, keep the time unless I say otherwise.`;
    }
    case "evening_checkin": {
      let done = 0, missed = 0;
      const lines: string[] = [];
      for (const r of ev.results ?? []) {
        const s = await step(r.step_id);
        if (r.done) {
          done++;
          await db.from("steps").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", s.id);
          lines.push(`DONE: ${s.title}`);
        } else {
          missed++;
          await db.from("steps").update({ status: "missed", last_reason: r.reason ?? null, postpone_count: (s.postpone_count ?? 0) + 1 }).eq("id", s.id);
          lines.push(`MISSED: ${s.title} (step_id ${s.id}, reason: ${r.reason ?? "not given"}, postponed ${(s.postpone_count ?? 0) + 1}x)`);
        }
      }
      await db.from("checkins").insert({ user_id: userId, kind: "evening", day: new Date().toISOString().slice(0, 10), done_count: done, missed_count: missed, summary: ev.extra ?? null });
      return `[event] Evening check-in.${NL}${lines.join(NL) || "No steps were planned today."}${ev.extra ? `${NL}Also did: ${ev.extra}` : ""}${NL}Lead with what I DID get done (count it). For each missed step act on the reason: no time → update_step it with a new time; too big → update_step it into a smaller piece with a new time; stuck → ask what's blocking; not now → suggest parking the project. Then propose tomorrow's first step with a time.`;
    }
    case "morning_checkin":
      await db.from("checkins").insert({ user_id: userId, kind: "morning", day: new Date().toISOString().slice(0, 10) });
      return "[event] Morning check-in. In 2–3 sentences: what today holds, the one thing that matters most, and ask if the plan still works.";
    case "plan_day":
      return "[event] Plan my day. Use only real things: my open and overdue steps, project next steps, my calendar events, and what I've told you. If you don't know enough about today (meetings, must-dos), ask me first in one short question instead of planning. Never add filler like breaks, meals, exercise or generic deep work. Add steps with proposed=true and ask me to approve.";
    case "morning_start": {
      await db.from("checkins").insert({ user_id: userId, kind: "morning", day: new Date().toISOString().slice(0, 10) });
      return "[event] CONVERSATION MODE, morning. I just unlocked my phone for the first time today. Greet me by name if you know it and ask how I slept. One question only.";
    }
    case "evening_start": {
      await db.from("checkins").insert({ user_id: userId, kind: "evening", day: new Date().toISOString().slice(0, 10) });
      return "[event] CONVERSATION MODE, evening check-in. Greet me by name and ask in one short question how the day went. Then go through today's planned steps (open_steps scheduled today) one at a time: 'Did you do X?'. Yes → update_step status done. No → ask briefly why, then either update_step it to a new future time or status missed. Finish by saying what's first tomorrow (or ask what is), and set done=true.";
    }
    case "no_answer":
      return "[event] CONVERSATION MODE: I didn't answer your last question (no speech for several seconds). Don't repeat it. Move on to the next useful question, or if I've missed two in a row, end politely: say I can tap Chief anytime, and set done=true.";
    case "approve_plan": {
      await db.from("steps").update({ status: "cancelled" }).eq("status", "proposed").lt("scheduled_at", new Date().toISOString());
      const { data } = await db.from("steps").update({ status: "planned" }).eq("status", "proposed").select("id");
      return `[event] I approved your proposed plan (${data?.length ?? 0} steps are now scheduled with reminders). Confirm in one short line.`;
    }
    case "reject_plan": {
      await db.from("steps").update({ status: "cancelled" }).eq("status", "proposed");
      return "[event] I rejected your proposed plan; it's cleared. Ask in one short question what my day actually looks like.";
    }
    case "followup":
      return `[event] CONVERSATION MODE: you asked to come back to me now${ev.about ? ` about: ${ev.about}` : ""}. Pick up from there in one or two sentences.`;
    case "leak":
      return `[event] I've been on ${ev.app} for ${ev.minutes} minutes during time I planned for work. In one or two sentences, name the planned step and ask: back to it now, 10 more minutes, or move the step?`;
  }
}

// ---------- context: everything Chief should weigh ----------

async function loadContext(db: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const until = new Date(Date.now() + 14 * 86400000).toISOString();
  const [profile, notes, projects, planned, recentDone, history] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).single(),
    db.from("life_notes").select("area, content").order("created_at"),
    db.from("projects").select("id, title, why, outcome, goal_type, hours_per_week, deadline, status, milestones, status_reason").in("status", ["active", "parked"]),
    db.from("steps").select("id, project_id, title, minutes, scheduled_at, status, postpone_count, last_reason").in("status", ["proposed", "planned", "missed"]).or(`scheduled_at.is.null,scheduled_at.lte.${until}`).order("scheduled_at", { nullsFirst: false }).limit(60),
    db.from("steps").select("title, completed_at").eq("status", "done").gte("completed_at", since).limit(40),
    db.from("messages").select("role, content, created_at").order("created_at", { ascending: false }).limit(24),
  ]);
  const p = profile.data ?? { timezone: "Asia/Dubai", max_active_projects: 3 };
  return {
    profile: p,
    now: nowIn(p.timezone ?? "Asia/Dubai"),
    lifeNotes: notes.data ?? [],
    projects: projects.data ?? [],
    steps: planned.data ?? [],
    doneThisWeek: recentDone.data ?? [],
    history: (history.data ?? []).reverse(),
  };
}

function nowIn(tz: string) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "longOffset" }).formatToParts(d);
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const offset = g("timeZoneName").replace("GMT", "") || "+00:00";
  return { tz, weekday: g("weekday"), iso: `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00${offset}` };
}

// ---------- the brain ----------

const SYSTEM = `You are Chief, a personal chief of staff — a sharp, caring secretary for one person.
You see their whole life (work, money, side projects, family, health, learning), not one project. You protect their time and make them choose.

How you speak
- Replies are usually spoken aloud. Keep them short: 1–3 sentences, plain words, no lists or markdown unless planning a day.
- Mirror the user's language. If they mix Hindi and English (Hinglish), reply in natural Hinglish written in Roman script.
- Be direct and honest, never flattering. Challenge weak reasoning kindly.

New project (most important)
- Never create a project immediately. First ask, one or two questions at a time: why do you want this, what do you want to get out of it, what kind of goal is it (money, business, personal, health, learning, family), roughly how many hours a week, any deadline.
- Then weigh it against their active projects and life notes. Say plainly what it competes with for time.
- If active projects are at the limit, recommend which one to park and give the reason (deadlines, money, energy, what is already blocked). The user decides; offer quick replies such as "Park X", "Park another", "Don't start it".
- Only after they confirm: set_project_status for the parked one, then create_project with 3–5 milestones and a first step of 15–45 minutes. Ask when to do the first step and offer three concrete time options.

Running the day
- Every step gets a time. Spread steps across projects by deadline and importance; avoid times the user said they are busy.
- Missed step: no time → new time; too big → smaller piece; stuck → ask what is blocking; not important now → suggest parking the project.
- If a step has been postponed 3+ times, name the pattern and ask what is really stopping them. Offer a 10-minute version or parking.
- When the user tells you a lasting fact about their life (job, commitments, family duties, health limits, money goals, usual busy hours), save it with add_life_note.

Conversation mode (hands-free, spoken; marked CONVERSATION MODE)
- The user is not looking at the screen. One short question at a time, then wait. No lists.
- Morning flow: greet and ask how they slept → briefly react → ask: review today's plan now, or later? → if later, ask what time and set follow_up_at to that time (ISO), confirm, and set done=true → if now, say today's real steps in one sentence, ask about meetings or must-dos you don't know about, schedule them, then ask if anything else; when they're finished, set done=true.
- Save lasting facts they mention with add_life_note. Never plan with invented tasks.
- After "Hey Chief" the user asks for one thing (what's next, plan my day, remind me…). Answer it in one or two spoken sentences, ask "Anything else?" only if useful, and set done=true when they're finished.
- "Call me / remind me in N minutes" (e.g. to escape a meeting): set follow_up_at to that time and confirm. Chief will ring them then.
- Outside conversation mode, leave done=false. follow_up_at is still allowed whenever the user asks to be reminded or called back at a time.

Plans need approval
- Any plan you build (a day, tomorrow, a reshuffle) is a proposal: add steps with proposed=true, say it in one sentence, and ask "Shall I lock it in?". When the user agrees, use approve_plan. Proposed steps get no reminders until approved.
- Every add_step must include from_user: the user's own words (copied exactly, a few words) that this step comes from, or a calendar event title. No source, no step.
- Calendar events in the context are real commitments: plan around them, never on top of them.

What you can and can't do
- You can: talk, plan, add/move/finish steps, manage projects, remember life notes, read the phone calendar when the user has turned it on in Settings.
- The calendar comes straight from the phone (it includes Google Calendar if it syncs to the phone). There is no Google sign-in; ignore anything earlier in the conversation that suggested one.
- You cannot: sign in to accounts, connect services, send emails or messages, make calls, or browse. Never say you are doing these. If asked, say it isn't possible from chat yet; for the calendar, point to Settings → "Use my phone's calendar".
- Life notes are only for lasting facts about the user's life (job, routine, family, health limits, goals). Never save what happened in this chat.

Rules
- Never invent tasks, steps, meetings or projects the user hasn't mentioned. Earlier plans in the conversation are not evidence. If there isn't enough to work with, ask.
- Use only ids that appear in the context. Times are ISO 8601 with the user's UTC offset, in the future.
- A time without a day means its next occurrence that is still ahead (if 14:00 today has passed, it's tomorrow). Don't ask which day.
- When something they ask for clashes with a calendar event or another step, say so in the same reply and suggest a fix.
- Calendar events can't be changed or deleted by you yet. If they ask to move or remove one, say plainly that it's in their phone calendar and you can't edit it yet; offer to add a Chief step instead. Never say you moved it.
- Never claim you did something unless an action in this reply does it.
- Respond ONLY by calling the respond tool / returning the JSON object. Put what you say in "reply".`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What Chief says. Short, spoken-friendly." },
    done: { type: "boolean", description: "Conversation mode only: true when the conversation is finished." },
    follow_up_at: { type: ["string", "null"], description: "ISO time (with timezone offset) to remind or call the user back, only when they asked for it; otherwise null." },
    quick_replies: { type: "array", items: { type: "string" }, description: "Up to 4 short tap-to-answer options." },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_project", "set_project_status", "add_step", "update_step", "add_life_note", "update_settings", "approve_plan"] },
          from_user: { type: "string", description: "add_step: the user's exact words or calendar title this step comes from." },
          proposed: { type: "boolean", description: "add_step: true while the plan awaits the user's approval." },
          project_id: { type: ["string", "null"] }, step_id: { type: "string" },
          title: { type: "string" }, why: { type: "string" }, outcome: { type: "string" },
          goal_type: { type: "string", enum: ["money", "business", "personal", "health", "learning", "family", "other"] },
          hours_per_week: { type: "number" }, deadline: { type: ["string", "null"] },
          milestones: { type: "array", items: { type: "string" } },
          first_step: { type: "object", properties: { title: { type: "string" }, minutes: { type: "number" }, scheduled_at: { type: ["string", "null"] } } },
          status: { type: "string" }, reason: { type: "string" },
          minutes: { type: "number" }, scheduled_at: { type: ["string", "null"] },
          area: { type: "string", enum: ["work", "money", "side_projects", "family", "health", "learning", "other"] }, content: { type: "string" },
          display_name: { type: "string" }, morning_checkin: { type: "string" }, evening_checkin: { type: "string" },
          max_active_projects: { type: "number" }, tone: { type: "string" }, voice_replies: { type: "boolean" },
        },
        required: ["type"],
      },
    },
  },
  required: ["reply"],
};

async function think(ctx: Awaited<ReturnType<typeof loadContext>>, userTurn: string, calendar: CalEvent[], calendarStatus: string): Promise<Brain> {
  const state = {
    now: ctx.now,
    settings: {
      name: ctx.profile.display_name, max_active_projects: ctx.profile.max_active_projects,
      morning_checkin: ctx.profile.morning_checkin, evening_checkin: ctx.profile.evening_checkin,
      tone: ctx.profile.tone, language: ctx.profile.language,
    },
    life_notes: ctx.lifeNotes,
    projects: ctx.projects,
    open_steps: ctx.steps,
    calendar_events:
      calendarStatus === "connected" ? (calendar.length ? calendar : "connected: no events today or tomorrow")
      : calendarStatus === "no_permission" ? "switched on, but Android calendar permission is denied (Settings → Apps → Chief → Permissions)"
      : "off (user can turn on 'Use my phone's calendar' in Chief's Settings)",
    done_last_7_days: ctx.doneThisWeek,
  };
  const transcript = ctx.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join(NL);
  const prompt = `CONTEXT (JSON)${NL}${JSON.stringify(state)}${NL}${NL}RECENT CONVERSATION${NL}${transcript || "(none yet)"}${NL}${NL}LATEST${NL}${userTurn}`;

  const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (anthropic) return callAnthropic(anthropic, prompt);
  if (openai) return callOpenAI(openai, prompt);
  return { reply: "My brain isn't connected yet: an AI key needs to be added in Supabase.", actions: [] };
}

async function callAnthropic(key: string, prompt: string): Promise<Brain> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("CHIEF_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 1500,
      system: SYSTEM,
      tools: [{ name: "respond", description: "Chief's reply and any changes to make.", input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "respond" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const block = data.content?.find((b: { type: string }) => b.type === "tool_use");
  return (block?.input ?? { reply: "Sorry, I lost my train of thought. Say that again?" }) as Brain;
}

async function callOpenAI(key: string, prompt: string): Promise<Brain> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("CHIEF_MODEL") ?? "gpt-5-mini",
      // Spoken replies need speed: keep thinking short (override with CHIEF_REASONING).
      reasoning_effort: Deno.env.get("CHIEF_REASONING") ?? "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM}${NL}${NL}Return a JSON object matching this schema:${NL}${JSON.stringify(SCHEMA)}` },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content) as Brain;
  } catch {
    return { reply: "Sorry, I lost my train of thought. Say that again?" };
  }
}

// ---------- apply what the brain decided, with guard rails ----------

async function applyActions(db: SupabaseClient, userId: string, actions: Action[], maxActive: number, evidence: string): Promise<string[]> {
  const notes: string[] = [];
  const future = (t?: string | null) => (t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null);
  const mins = (m?: number) => Math.min(480, Math.max(5, Math.round(m ?? 30)));
  // Parking/finishing first, so a swap (park one, start one) fits within the limit.
  const order = (a: Action) => (a.type === "set_project_status" ? 0 : a.type === "create_project" ? 1 : 2);

  for (const a of [...actions].sort((x, y) => order(x) - order(y))) {
    switch (a.type) {
      case "set_project_status": {
        if (a.status === "active") {
          const { count } = await db.from("projects").select("id", { count: "exact", head: true }).eq("status", "active");
          if ((count ?? 0) >= maxActive) { notes.push(`(You already have ${maxActive} active projects, so I kept it parked.)`); break; }
        }
        await db.from("projects").update({ status: a.status, status_reason: a.reason ?? null, updated_at: new Date().toISOString() }).eq("id", a.project_id);
        if (a.status !== "active") await db.from("steps").update({ status: "parked" }).eq("project_id", a.project_id).eq("status", "planned");
        break;
      }
      case "create_project": {
        const { count } = await db.from("projects").select("id", { count: "exact", head: true }).eq("status", "active");
        if ((count ?? 0) >= maxActive) { notes.push(`(I didn't add "${a.title}" yet: you have ${maxActive} active projects. Park one first.)`); break; }
        const { data: proj, error } = await db.from("projects").insert({
          user_id: userId, title: a.title, why: a.why ?? null, outcome: a.outcome ?? null, goal_type: a.goal_type ?? "other",
          hours_per_week: a.hours_per_week ?? null, deadline: a.deadline || null, milestones: a.milestones ?? [],
        }).select("id").single();
        if (error) { console.error(error); break; }
        if (a.first_step?.title) {
          await db.from("steps").insert({ user_id: userId, project_id: proj.id, title: a.first_step.title, minutes: mins(a.first_step.minutes), scheduled_at: future(a.first_step.scheduled_at) });
        }
        break;
      }
      case "add_step": {
        // Guard against invented tasks: a step must belong to a project or trace back to the user's words.
        const quote = (a.from_user ?? "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]/g, " ").replace(/ +/g, " ").trim();
        const words = quote.split(" ").filter((w) => w.length > 2);
        const grounded = !!a.project_id || (words.length > 0 && words.filter((w) => evidence.includes(w)).length >= Math.ceil(words.length * 0.6));
        if (!grounded) { console.warn("skipped ungrounded step", a.title, a.from_user); break; }
        // Never schedule into the past.
        if (a.scheduled_at && Date.parse(a.scheduled_at) < Date.now() - 5 * 60000) { console.warn("skipped past step", a.title, a.scheduled_at); break; }
        await db.from("steps").insert({ user_id: userId, project_id: a.project_id || null, title: a.title, minutes: mins(a.minutes), scheduled_at: future(a.scheduled_at), status: a.proposed ? "proposed" : "planned" });
        break;
      }
      case "approve_plan":
        await db.from("steps").update({ status: "cancelled" }).eq("status", "proposed").lt("scheduled_at", new Date().toISOString());
        await db.from("steps").update({ status: "planned" }).eq("status", "proposed");
        break;
      case "update_step": {
        const patch: Record<string, unknown> = {};
        if (a.title) patch.title = a.title;
        if (a.minutes) patch.minutes = mins(a.minutes);
        if (a.scheduled_at !== undefined) patch.scheduled_at = future(a.scheduled_at);
        if (a.status && ["proposed", "planned", "done", "missed", "parked", "cancelled"].includes(a.status)) patch.status = a.status;
        if (Object.keys(patch).length) await db.from("steps").update(patch).eq("id", a.step_id);
        // A missed step that gets a new time is back on the plan (proposals stay proposals).
        if (a.scheduled_at && !a.status) await db.from("steps").update({ status: "planned" }).eq("id", a.step_id).eq("status", "missed");
        break;
      }
      case "add_life_note":
        if (a.content) await db.from("life_notes").insert({ user_id: userId, area: a.area ?? "other", content: a.content.slice(0, 500) });
        break;
      case "update_settings": {
        const patch: Record<string, unknown> = {};
        for (const k of ["display_name", "morning_checkin", "evening_checkin", "tone", "voice_replies"] as const) if (a[k] !== undefined) patch[k] = a[k];
        if (a.max_active_projects) patch.max_active_projects = Math.min(10, Math.max(1, Math.round(a.max_active_projects)));
        if (Object.keys(patch).length) await db.from("profiles").update(patch).eq("id", userId);
        break;
      }
    }
  }
  return notes;
}
