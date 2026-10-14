export type Profile = {
  id: string;
  display_name: string | null;
  timezone: string;
  morning_checkin: string; // "09:00:00"
  evening_checkin: string;
  max_active_projects: number;
  tone: string;
  language: string;
  voice_replies: boolean;
  wake_time: string; // "06:00:00"
  morning_auto: boolean;
};

export type Project = {
  id: string;
  title: string;
  why: string | null;
  outcome: string | null;
  goal_type: string | null;
  hours_per_week: number | null;
  deadline: string | null;
  status: "active" | "parked" | "done" | "dropped";
  milestones: string[];
  status_reason: string | null;
};

export type Step = {
  id: string;
  project_id: string | null;
  title: string;
  minutes: number;
  scheduled_at: string | null;
  status: "planned" | "done" | "missed" | "parked" | "cancelled";
  postpone_count: number;
  completed_at: string | null;
  projects?: { title: string } | null;
};

export type Message = { id: string; role: "user" | "chief" | "event"; content: string; created_at: string };

export type LifeNote = { id: string; area: string; content: string };

export type ChiefEvent =
  | { type: "step_done"; step_id: string }
  | { type: "step_later"; step_id: string; scheduled_at?: string }
  | { type: "step_smaller"; step_id: string }
  | { type: "evening_checkin"; results: { step_id: string; done: boolean; reason?: string }[]; extra?: string }
  | { type: "morning_checkin" }
  | { type: "plan_day" }
  | { type: "morning_start" }
  | { type: "no_answer" }
  | { type: "followup"; about?: string };

export type ChiefReply = { reply: string; quick_replies: string[]; changed: boolean; done?: boolean; follow_up_at?: string | null };

export type Tab = "talk" | "today" | "checkin" | "projects" | "settings";
