// functions/api/explain.js — Cloudflare Pages Function (runs on the free Workers tier).
//
// Setup (one time, no API key needed):
//   Cloudflare Dashboard → your Pages project → Settings → Functions → Bindings
//   → add an "AI" binding (Workers AI). That injects `env.AI` below.
//
// Free tier: 10,000 neurons/day shared across the account (resets daily). Plenty for a
// teaching tool, and it hard-stops rather than billing you. On any error this returns a
// non-200 so the client (explainer.mjs) falls back to the deterministic text.

// This task is rewording, not reasoning, so any current instruct model is enough.
// Cloudflare deprecates model ids over time (llama-3.1-8b-instruct died 2026-05-30),
// so we try these in order and use the first that runs. Check the live catalog at
// developers.cloudflare.com/workers-ai/models when updating this list.
const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];

const SYSTEM = [
  "You rephrase machine-generated ML recommendations into clear, warm, plain English.",
  "STRICT RULES:",
  "- Never change, add, or remove any decision, number, model name, metric, or column name.",
  "- Only reword for clarity and tone. Keep each field concise (1–2 sentences).",
  "- Return ONLY a JSON array. No prose, no markdown fences.",
  '- Each element: {"id": <unchanged id>, "decision": <reworded>, "reason": <reworded>, "caveat": <reworded or "">}.',
  "- Include every id from the input, unchanged.",
].join("\n");

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) return json({ error: "no AI binding configured" }, 503);
    const body = await request.json();
    const sections = body && body.sections;
    if (!Array.isArray(sections) || !sections.length) return json({ error: "bad input" }, 400);

    let lastErr = "no model succeeded";
    for (const model of MODELS) {
      let out;
      try {
        out = await env.AI.run(model, {
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "Rephrase these sections:\n" + JSON.stringify(sections) },
          ],
          max_tokens: 2048,   // headroom so the JSON array isn't truncated for larger bearings
          temperature: 0.3,
        });
      } catch (e) {
        lastErr = `${model}: ${String(e && e.message ? e.message : e)}`;
        continue;   // deprecated/unknown model → try the next one
      }
      const text = (out && (out.response ?? out.result ?? "")) || "";
      const parsed = extractJsonArray(text);
      if (parsed) return json(parsed, 200);
      lastErr = `${model}: unparseable model output`;
    }
    return json({ error: lastErr }, 502);   // → client falls back to on-device / rules
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function extractJsonArray(text) {
  const a = text.indexOf("[");
  if (a === -1) return null;
  const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  const b = text.lastIndexOf("]");
  if (b > a) { const v = parse(text.slice(a, b + 1)); if (v) return v; }
  // salvage a truncated reply: close the array after the last complete object
  const lastObj = text.lastIndexOf("}");
  if (lastObj > a) { const v = parse(text.slice(a, lastObj + 1) + "]"); if (v) return v; }
  return null;
}
