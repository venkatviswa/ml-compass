// functions/api/explain.js — Cloudflare Pages Function (runs on the free Workers tier).
//
// Setup (one time, no API key needed):
//   Cloudflare Dashboard → your Pages project → Settings → Functions → Bindings
//   → add an "AI" binding (Workers AI). That injects `env.AI` below.
//
// Free tier: 10,000 neurons/day shared across the account (resets daily). Plenty for a
// teaching tool, and it hard-stops rather than billing you. On any error this returns a
// non-200 so the client (explainer.mjs) falls back to the deterministic text.

// Small open model is enough — this task is rewording, not reasoning.
// Swap freely: "@cf/google/gemma-7b-it-lora", "@cf/meta/llama-3.2-3b-instruct", etc.
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

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

    const out = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: "Rephrase these sections:\n" + JSON.stringify(sections) },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const text = (out && (out.response ?? out.result ?? "")) || "";
    const parsed = extractJsonArray(text);
    if (!parsed) return json({ error: "unparseable model output" }, 502); // → client falls back
    return json(parsed, 200);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function extractJsonArray(text) {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a === -1 || b === -1 || b <= a) return null;
  try { const v = JSON.parse(text.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}
