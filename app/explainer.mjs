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
// On-device model for the browser tier. Gemma-2-2B follows simple formatting well and
// is a good size/quality/speed balance (~1.6 GB). Swap the id here to try others.
// Alternatives: "Llama-3.2-3B-Instruct-q4f16_1-MLC", "Phi-3.5-mini-instruct-q4f16_1-MLC",
// "Llama-3.2-1B-Instruct-q4f16_1-MLC". Verify ids against WebLLM's prebuilt list.
const DEFAULT_BROWSER_MODEL = "gemma-2-2b-it-q4f16_1-MLC";

// Server (Workers AI) tier rephrases all sections at once and returns JSON.
const SYSTEM = [
  "You rephrase machine-generated ML recommendations into clear, warm, plain English.",
  "STRICT RULES:",
  "- Never change, add, or remove any decision, number, model name, metric, or column name.",
  "- Only reword for clarity and tone. Keep each field concise (1–2 sentences).",
  "- Return ONLY a JSON array. No prose, no markdown fences.",
  '- Each element: {"id": <unchanged id>, "decision": <reworded>, "reason": <reworded>, "caveat": <reworded or "">}.',
  "- Include every id from the input, unchanged.",
].join("\n");

// On-device tier rephrases ONE section per call in plain text (no JSON). Small models
// produce plain lines far more reliably than strict JSON, and a per-section failure
// can't poison the others. A one-shot example keeps the format from drifting.
const SECTION_SYSTEM = [
  "You rewrite one machine-generated ML recommendation in clear, friendly plain English.",
  "Keep every model name, metric, number, and column name exactly as given.",
  "Reply with EXACTLY these three lines and nothing else. Do NOT repeat the words DECISION, WHY, or CAVEAT inside your sentences:",
  "DECISION: <one short sentence>",
  "WHY: <one or two short sentences>",
  'CAVEAT: <one short sentence, or "-" if the input caveat is "-">',
  "",
  "Example input:",
  "DECISION: Supervised regression",
  "WHY: A labeled continuous numeric target.",
  "CAVEAT: -",
  "Example output:",
  "DECISION: This is a regression problem.",
  "WHY: We're predicting a continuous number, so regression fits.",
  "CAVEAT: -",
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
    shouldStop = () => false,   // lets the caller abort a stale on-device run (e.g. toggled off)
  } = opts;

  const payload = sections.map((s) => ({ id: s.id, title: s.title, decision: s.decision, reason: s.reason, caveat: s.caveat || "" }));

  // Tier 1 — Workers AI proxy
  onStatus({ tier: "workers-ai", phase: "requesting" });
  const serverData = await tryServer(endpoint, timeoutMs, payload);
  if (serverData) {
    const merged = mergeRephrased(sections, serverData);
    if (merged) return { sections: merged, source: "workers-ai" };
  }

  // Tier 2 — on-device (WebLLM). Only if quota/server failed AND the device can actually
  // run it. Phones/tablets are excluded: the model is multi-GB and the tab gets killed
  // (and silently reloaded) under memory pressure, which would wipe the user's session.
  if (enableBrowserFallback && canRunBrowserLLM()) {
    try {
      // Emit immediately: the WebLLM library import + cache check below are slow, and
      // without this the UI would stay frozen on the stale "Checking Workers AI…" label.
      onStatus({ tier: "on-device", phase: "init" });
      const merged = await tryBrowser(browserModel, sections, (s) => onStatus({ tier: "on-device", ...s }), shouldStop);
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
let engineReady = false;
let genLock = Promise.resolve();   // serialize generation: WebLLM runs one request at a time

// Returns merged sections (originals reworded where the model gave usable text) or null
// if nothing could be reworded. Rephrases one section per call in plain text.
// shouldStop() lets a stale run (e.g. the toggle was switched off) bail cleanly.
async function tryBrowser(model, sections, onStatus, shouldStop = () => false) {
  const webllm = await import("@mlc-ai/web-llm");   // requires `npm i @mlc-ai/web-llm`; if absent → throws → fallback
  if (!engineReady || !enginePromise) {
    let cached = false;
    try { cached = webllm.hasModelInCache ? await webllm.hasModelInCache(model) : false; } catch { cached = false; }
    onStatus?.({ phase: cached ? "loading" : "downloading", model, progress: 0 });
    if (!enginePromise) {
      enginePromise = webllm.CreateMLCEngine(model, {
        initProgressCallback: (r) => onStatus?.({
          phase: cached ? "loading" : "downloading",
          model,
          progress: typeof r?.progress === "number" ? r.progress : undefined,
        }),
      });
    }
  }
  const engine = await enginePromise;
  engineReady = true;

  // Serialize the per-section loop behind genLock so a re-toggle can't run a second
  // generation concurrently against the single engine (which throws and looks "unavailable").
  const run = genLock.then(async () => {
    let reworded = 0;
    const out = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (shouldStop()) { out.push(s); continue; }   // stale run — keep originals, finish fast
      onStatus?.({ phase: "rephrasing", model, index: i + 1, total: sections.length });
      let merged = s;
      try {
        const reply = await engine.chat.completions.create({
          messages: [{ role: "system", content: SECTION_SYSTEM }, { role: "user", content: sectionToText(s) }],
          temperature: 0.2,
          max_tokens: 256,   // one short section — can't truncate the whole reply
        });
        merged = applyRephrase(s, reply?.choices?.[0]?.message?.content || "");
        if (merged.decision !== s.decision || merged.reason !== s.reason || merged.caveat !== s.caveat) reworded++;
      } catch { merged = s; }   // a single bad section keeps its deterministic text
      out.push(merged);
    }
    return reworded ? out : null;
  });
  genLock = run.then(() => {}, () => {});   // chain next run after this one, success or fail
  return run;
}

function sectionToText(s) {
  return `DECISION: ${s.decision}\nWHY: ${s.reason}\nCAVEAT: ${s.caveat || "-"}`;
}

// Pull DECISION/WHY/CAVEAT lines from a plain-text reply; keep the original on anything
// missing, blank, "-", or implausible. The sanity guard rejects run-on / merged output
// (e.g. a model that crams decision+why+"Caveat:" onto one line) so garbage never shows.
function applyRephrase(s, text) {
  const grab = (label) => {
    const m = text.match(new RegExp("^\\s*" + label + "\\s*:\\s*(.+)$", "im"));
    return m ? m[1].trim() : "";
  };
  // candidate is accepted only if it's non-empty, not a placeholder, doesn't echo the
  // field labels, and isn't wildly longer than the original (a sign it merged fields).
  const sane = (candidate, original, maxFactor) => {
    const v = (candidate || "").trim();
    if (!v || v === "-") return original;
    if (/\b(decision|why|caveat)\s*:/i.test(v)) return original;   // leaked a field label
    if (v.length > original.length * maxFactor + 40) return original;
    return v;
  };
  return {
    ...s,
    decision: sane(grab("DECISION"), s.decision, 2),
    reason: sane(grab("WHY"), s.reason, 2.5),
    caveat: s.caveat ? sane(grab("CAVEAT"), s.caveat, 2.5) : "",
  };
}

function hasWebGPU() { return typeof navigator !== "undefined" && "gpu" in navigator; }

// Gate for the on-device tier. WebGPU alone isn't enough: iOS/Android now expose
// navigator.gpu, but loading a multi-GB model crashes the tab on phones/tablets.
// So require WebGPU AND a non-mobile, non-low-memory device; otherwise fall back to
// the deterministic rules text (decisions are identical — only the wording differs).
export function canRunBrowserLLM() {
  if (!hasWebGPU()) return false;
  const ua = navigator.userAgent || "";
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) ||
    // iPadOS 13+ reports as desktop Safari but is still a tablet:
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isMobile) return false;
  // deviceMemory is in GB (Chromium only); skip clearly under-provisioned machines.
  if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < 4) return false;
  return true;
}

// Only text fields are replaced; id / title / tone / order come from the originals.
// Partial merge: sections the model dropped or mangled keep their deterministic text,
// so a small/imperfect model still rewords what it can instead of failing wholesale.
// Returns null only if NOTHING was reworded (then the caller falls back to rules).
function mergeRephrased(original, data) {
  const arr = Array.isArray(data) ? data : data?.sections;
  if (!Array.isArray(arr) || !arr.length) return null;
  const byId = new Map(arr.map((x) => [x && x.id, x]));
  let reworded = 0;
  const out = original.map((s) => {
    const r = byId.get(s.id);
    if (!r) return s;
    const keep = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb);
    const merged = { ...s, decision: keep(r.decision, s.decision), reason: keep(r.reason, s.reason), caveat: s.caveat ? keep(r.caveat, s.caveat) : "" };
    if (merged.decision !== s.decision || merged.reason !== s.reason || merged.caveat !== s.caveat) reworded++;
    return merged;
  });
  return reworded ? out : null;
}
