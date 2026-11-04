// Reads one scoreboard photo with Gemini for a signed-in shooter. Stores nothing.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { validateReading } from "./validate.ts";

const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];
const DAILY_CAP = 60;
const MAX_IMAGE_B64 = 4_000_000; // ~3 MB of JPEG; the app sends ~0.5 MB
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PROMPT =
  "This is a photo of an electronic shooting scoreboard. Read the shot list. " +
  'Return JSON: {"date":"YYYY-MM-DD","time":"HH:MM","subtotal":number,"sighter":boolean,' +
  '"shots":[{"n":shot number,"dir":one of "↖↑↗←→↙↓↘","score":number}]}. ' +
  "The screen shows the date as D.M.YYYY at the top. " +
  "The arrow before each score shows which way the shot landed from centre; look closely at its exact direction. " +
  "subtotal is the Subtotal printed BELOW the listed shots (ignore any '-3*' style suffix). " +
  "Set sighter true only if the screen is in sighting/practice mode rather than match shots.";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function askGemini(image: string, mime: string, key: string): Promise<unknown | null> {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body,
    });
    if (res.status === 503 || res.status === 429 || res.status === 404) { await res.body?.cancel(); continue; }
    if (!res.ok) { console.error(model, res.status, await res.text()); continue; }
    const out = await res.json();
    const text = out?.candidates?.[0]?.content?.parts?.findLast?.((p: { text?: string }) => p.text)?.text;
    try { return JSON.parse(text); } catch { console.error(model, "non-JSON reply"); }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const auth = req.headers.get("Authorization") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, anon, { global: { headers: { Authorization: auth } } });
  const { data: allowed, error } = await sb.rpc("bump_scan", { cap: DAILY_CAP });
  if (error) { console.error(error); return json(401, { error: "auth" }); }
  if (!allowed) return json(429, { error: "daily_limit" });

  let image: string, mime: string;
  try {
    ({ image, mime } = await req.json());
    if (typeof image !== "string" || !image || image.length > MAX_IMAGE_B64) throw 0;
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) mime = "image/jpeg";
  } catch { return json(400, { error: "bad_request" }); }

  const raw = await askGemini(image, mime, Deno.env.get("GEMINI_API_KEY")!);
  if (raw == null) return json(502, { error: "busy" });
  try { return json(200, validateReading(raw)); } catch { return json(422, { error: "unreadable" }); }
});
