// functions/api/explain.js — Cloudflare Pages Function (runs on the free Workers tier).
//
// Setup (one time, no API key needed): the AI binding is declared in wrangler.toml
// ([ai] binding = "AI"), which injects `env.AI` below on every deploy.
//
// Free tier: 10,000 neurons/day shared across the account (resets daily). Plenty for a
// teaching tool, and it hard-stops rather than billing you. On any error this returns a
// non-200 so the client (explainer.mjs) falls back to the deterministic text.
//
// Policy note: the client (explainer.mjs) only ever applies reworded *rationales* —
// decisions and caveats always render verbatim from the rules engine. So this function
// asks the model to reword only the rationale, one plain line per section. Plain lines
// parse reliably on any model; strict JSON was the thing small models kept fumbling.

// Rewording needs any current instruct model. Cloudflare deprecates model ids over time
// (llama-3.1-8b-instruct died 2026-05-30), so we try these in order and use the first
// that runs. Mistral-small is first because it is verified working on this account;
// update against developers.cloudflare.com/workers-ai/models when ids age out.
const MODELS = [
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

const SYSTEM = [
  "You rewrite the rationale of machine-generated ML recommendations in clear, warm, plain English.",
  "Keep every model name, metric, number, and column name exactly as written. Never change the meaning.",
  "Do not add explanations, examples, or equivalences that are not in the original.",
  "Input: one section per line, formatted 'id :: decision :: rationale'.",
  "Output: one line per section, formatted exactly 'id :: rewritten rationale' (1-2 short sentences).",
  "No other text, no blank lines, no JSON, no markdown.",
].join("\n");

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) return json({ error: "no AI binding configured" }, 503);
    const body = await request.json();
    const sections = body && body.sections;
    if (!Array.isArray(sections) || !sections.length) return json({ error: "bad input" }, 400);

    const input = sections
      .map((s) => `${s.id} :: ${s.decision} :: ${s.reason}`)
      .join("\n");

    const errors = [];
    for (const model of MODELS) {
      let out;
      try {
        out = await env.AI.run(model, {
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: input },
          ],
          max_tokens: 1024,
          temperature: 0.2,
        });
      } catch (e) {
        errors.push(`${model}: ${String(e && e.message ? e.message : e)}`);
        continue;   // deprecated/unknown model → try the next one
      }
      const text = (out && (out.response ?? out.result ?? "")) || "";
      const parsed = parseLines(text, sections);
      if (parsed.length) return json(parsed, 200);
      errors.push(`${model}: no parseable lines in output`);
    }
    // errors for EVERY model, so one curl shows the whole picture → client falls back
    return json({ error: errors.join(" | ") || "no model succeeded" }, 502);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// Parse 'id :: rationale' lines (tolerating a single ':' and stray whitespace), keeping
// only ids that exist in the request — anything else the model emitted is ignored.
function parseLines(text, sections) {
  const valid = new Set(sections.map((s) => s.id));
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*(?:::|:)\s*(.+?)\s*$/);
    if (m && valid.has(m[1]) && m[2]) out.push({ id: m[1], reason: m[2] });
  }
  return out;
}
