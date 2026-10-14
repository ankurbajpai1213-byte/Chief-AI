import { supabase, SUPABASE_URL, SUPABASE_KEY } from "./supabase";
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
  const { data, error } = await supabase.functions.invoke("chief", { body });
  if (error) throw new Error(await errorMessage(error));
  return data as ChiefReply;
}

export const sayToChief = (text: string) => callChief({ kind: "chat", text });
export const sendEvent = (event: ChiefEvent) => callChief({ kind: "event", event });

export async function transcribe(uri: string): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const form = new FormData();
  // React Native's FormData accepts a file descriptor object.
  form.append("file", { uri, name: "voice.m4a", type: "audio/m4a" } as unknown as Blob);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't hear that. Try again or type.");
  return body.text ?? "";
}
