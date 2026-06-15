// explainer.mjs — OPTIONAL, tiered "explainer" layer. Pure renderer: it ONLY rephrases
// the rules' text and NEVER changes a decision. It tries providers in order and falls
// back automatically, so the caller always gets a result and the app is always $0-capable.
//
//   Tier 1  workers-ai → POST /api/explain  (Cloudflare Workers AI free tier; fast, no download)
//   Tier 2  on-device  → WebLLM in the browser (no quota/cost; one-time model download; needs WebGPU)
//   Tier 0  rules      → the deterministic text (always available)
//
// The switch between tiers is automatic and transparent — callers just get explanations.
// onStatus(...) lets the UI show a small, honest note (e.g. on-device download progress).

const DEFAULT_ENDPOINT = "/api/explain";
const DEFAULT_TIMEOUT_MS = 8000;
// Small open model is plenty for rewording. Verify the id against WebLLM's prebuilt list.
// Alternatives: "gemma-2-2b-it-q4f16_1-MLC", "Phi-3.5-mini-instruct-q4f16_1-MLC".
const DEFAULT_BROWSER_MODEL = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

const SYSTEM = [
  "You rephrase machine-generated ML recommendations into clear, warm, plain English.",
  "STRICT RULES:",
  "- Never change, add, or remove any decision, number, model name, metric, or column name.",
  "- Only reword for clarity and tone. Keep each field concise (1–2 sentences).",
  "- Return ONLY a JSON array. No prose, no markdown fences.",
  '- Each element: {"id": <unchanged id>, "decision": <reworded>, "reason": <reworded>, "caveat": <reworded or "">}.',
  "- Include every id from the input, unchanged.",
].join("\n");

/**
 * @returns {Promise<{sections: Array, source: 'workers-ai'|'on-device'|'rules'}>}
 */
export async function explainSections(sections, opts = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    enableBrowserFallback = true,
    browserModel = DEFAULT_BROWSER_MODEL,
    onStatus = () => {},
  } = opts;

  const payload = sections.map((s) => ({ id: s.id, title: s.title, decision: s.decision, reason: s.reason, caveat: s.caveat || "" }));

  // Tier 1 — Workers AI proxy
  onStatus({ tier: "workers-ai", phase: "requesting" });
  const serverData = await tryServer(endpoint, timeoutMs, payload);
  if (serverData) {
    const merged = mergeRephrased(sections, serverData);
    if (merged) return { sections: merged, source: "workers-ai" };
  }

  // Tier 2 — on-device (WebLLM). Only if quota/server failed AND the browser can run it.
  if (enableBrowserFallback && hasWebGPU()) {
    try {
      onStatus({ tier: "on-device", phase: "loading", progress: 0 });
      const arr = await tryBrowser(browserModel, payload, (p) => onStatus({ tier: "on-device", phase: "loading", progress: p }));
      const merged = mergeRephrased(sections, arr);
      if (merged) return { sections: merged, source: "on-device" };
    } catch { /* fall through to deterministic */ }
  }

  // Tier 0 — deterministic
  return { sections, source: "rules" };
}

async function tryServer(endpoint, timeoutMs, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: payload }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;   // non-200 (e.g. daily quota hit) → null → next tier
  } catch { clearTimeout(timer); return null; }
}

let enginePromise = null;   // load the on-device model once per session
async function tryBrowser(model, payload, onProgress) {
  const webllm = await import("@mlc-ai/web-llm");   // requires `npm i @mlc-ai/web-llm`; if absent → throws → fallback
  if (!enginePromise) {
    enginePromise = webllm.CreateMLCEngine(model, {
      initProgressCallback: (r) => onProgress?.(typeof r?.progress === "number" ? r.progress : undefined),
    });
  }
  const engine = await enginePromise;
  const reply = await engine.chat.completions.create({
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "Rephrase these sections:\n" + JSON.stringify(payload) }],
    temperature: 0.3,
    max_tokens: 1000,
  });
  return extractJsonArray(reply?.choices?.[0]?.message?.content || "");
}

function hasWebGPU() { return typeof navigator !== "undefined" && "gpu" in navigator; }

function extractJsonArray(text) {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a === -1 || b === -1 || b <= a) return null;
  try { const v = JSON.parse(text.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}

// Only text fields are replaced; id / title / tone / order come from the originals.
// If anything is missing or malformed, return null so the caller falls back wholesale.
function mergeRephrased(original, data) {
  const arr = Array.isArray(data) ? data : data?.sections;
  if (!Array.isArray(arr)) return null;
  const byId = new Map(arr.map((x) => [x && x.id, x]));
  if (!original.every((s) => byId.has(s.id))) return null;
  return original.map((s) => {
    const r = byId.get(s.id) || {};
    const keep = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb);
    return { ...s, decision: keep(r.decision, s.decision), reason: keep(r.reason, s.reason), caveat: s.caveat ? keep(r.caveat, s.caveat) : "" };
  });
}
