import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "./supabase";
import { upcomingEvents } from "./calendar";
import type { ChiefEvent, ChiefReply } from "./types";

async function errorMessage(e: unknown): Promise<string> {
  // supabase-js wraps non-2xx responses; pull the server's own message when there is one.
  const ctx = (e as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error;
    } catch { /* fall through */ }
  }
  return e instanceof Error ? e.message : "Chief couldn't be reached. Check your internet and try again.";
}

async function callChief(body: object): Promise<ChiefReply> {
  // Chief always sees today's and tomorrow's calendar, if the user turned it on.
  const calendar = await upcomingEvents(2);
  const { data, error } = await supabase.functions.invoke("chief", { body: { ...body, calendar } });
  if (error) throw new Error(await errorMessage(error));
  return data as ChiefReply;
}

export const sayToChief = (text: string) => callChief({ kind: "chat", text });
export const sendEvent = (event: ChiefEvent) => callChief({ kind: "event", event });

export async function transcribe(uri: string): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const headers = { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY };
  const url = `${SUPABASE_URL}/functions/v1/transcribe`;
  const file = new File(uri);
  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    // expo-file-system's File is a real Blob, which expo/fetch can upload.
    const form = new FormData();
    form.append("file", file, "voice.m4a");
    res = await expoFetch(url, { method: "POST", headers, body: form });
  } catch {
    // Fallback: send the recording as base64 text.
    res = await expoFetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64: await file.base64(), filename: "voice.m4a" }),
    });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't hear that. Try again or type.");
  return body.text ?? "";
}
