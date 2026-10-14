// Turns a voice recording into text. Accepts multipart form data with an audio "file".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await db.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !data.user) return json({ error: "Please sign in again." }, 401);

    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ error: "Voice isn't connected yet. Type for now." }, 503);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "No recording received." }, 400);
    if (file.size > 20 * 1024 * 1024) return json({ error: "That recording is too long." }, 413);

    const out = new FormData();
    out.append("file", file, file.name || "voice.m4a");
    out.append("model", Deno.env.get("CHIEF_STT_MODEL") ?? "whisper-1");
    // Hint for mixed Hindi-English speech, written in Roman script.
    out.append("prompt", "Conversation in English or Hinglish (Hindi and English mixed), written in Roman script. Example: Kal subah proposal finish karna hai, then gym.");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    if (!res.ok) return json({ error: `Couldn't hear that (${res.status}). Try again or type.` }, 502);
    const result = await res.json();
    return json({ text: (result.text ?? "").trim() });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't process the recording." }, 500);
  }
});
