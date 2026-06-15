"use client";
// MLCompass.jsx — UI layer only. All decision logic lives in rules.mjs / profiler.mjs.
// In a Next.js app this is a client component: add "use client"; as the first line.
import { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import {
  Compass, Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle,
  Target, HelpCircle, Sparkles, Download, Copy, Database, ListChecks, Map,
  CheckCircle2, XCircle, Info, Wand2,
} from "lucide-react";

// ---- business logic (single source of truth, shared with the test harness) ----
import { explainSections } from "./explainer.mjs";
import { profile, targetFacts, makeSample } from "./profiler.mjs";
import { recommend, sectionText, LEAKY_RE } from "./rules.mjs";

/* ---------------- design tokens (shared identity with the ML guide) ---------------- */
const C = {
  ink: "#15202b", inkSoft: "#445566", paper: "#fbfaf7", panel: "#ffffff", line: "#e3e1da",
  sup: "#1f6feb", supBg: "#e9f1ff", uns: "#7b3fe4", unsBg: "#f1e9ff",
  amber: "#c77400", amberBg: "#fdf0db", neu: "#5a6b7b", neuBg: "#eef1f4",
  good: "#1d7a3a", goodBg: "#e3f6e8", bad: "#b23b3b", badBg: "#fbe6e6",
};
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };
const disp = { fontFamily: "'Space Grotesk','Inter',system-ui,sans-serif" };

/* ---------------- markdown export ---------------- */
function toMarkdown(rec, meta) {
  let md = `# ML Compass — Bearing\n\nDataset: ${meta.name} (${meta.nRows} rows × ${meta.nCols} cols)\nModality: ${meta.modality}\nTarget: ${meta.target || "none (unsupervised)"}\nGoal: ${meta.goal || "—"}\n\n`;
  rec.sections.forEach((s) => {
    md += `## ${s.title}\n**Decision:** ${s.decision}\n\n**Reason:** ${s.reason}\n`;
    if (s.caveat) md += `\n*Caveat:* ${s.caveat}\n`;
    md += "\n";
  });
  md += "_Rules decided. This report explains._\n";
  return md;
}

/* ---------------- UI atoms ---------------- */
function Tag({ children, tone = "neu" }) {
  const bg = { sup: C.supBg, uns: C.unsBg, amber: C.amberBg, neu: C.neuBg, bad: C.badBg, good: C.goodBg }[tone];
  const fg = { sup: C.sup, uns: C.uns, amber: C.amber, neu: C.neu, bad: C.bad, good: C.good }[tone];
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ ...mono, background: bg, color: fg }}>{children}</span>;
}
function Btn({ children, onClick, primary, disabled, small }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-all ${small ? "px-3 py-1.5 text-sm" : "px-5 py-2.5"} ${disabled ? "opacity-40 cursor-not-allowed" : "hover:translate-y-px"}`}
      style={primary ? { background: C.ink, color: "#fff" } : { background: C.panel, color: C.ink, border: `1px solid ${C.line}` }}>
      {children}
    </button>
  );
}
function Dial({ stage }) {
  const angle = [-120, -45, 40, 120][stage] ?? -120;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="26" fill={C.panel} stroke={C.line} strokeWidth="1.5" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="28" y1="4" x2="28" y2={a % 90 === 0 ? "9" : "7"} stroke={C.inkSoft} strokeWidth="1.2" transform={`rotate(${a} 28 28)`} />
      ))}
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "28px 28px", transition: "transform .7s cubic-bezier(.2,.8,.2,1)" }}>
        <polygon points="28,8 31,28 28,33 25,28" fill={C.sup} />
        <polygon points="28,48 25,28 28,33 31,28" fill={C.line} />
      </g>
      <circle cx="28" cy="28" r="3" fill={C.ink} />
    </svg>
  );
}

const STAGES = ["Frame", "Profile", "Questions", "Bearing"];
// Plain-language gloss for each stage, shown on hover so the nautical terms stay
// self-explanatory to a first-time visitor.
const STAGE_HELP = {
  Frame: "Frame — state the decision the prediction will drive, then load your data.",
  Profile: "Profile — the app reads your dataset and reports the objective facts.",
  Questions: "Questions — answer the few things the data can't reveal (~5 taps).",
  Bearing: "Bearing — your recommended plan: task, metric, validation, and leakage risks.",
};
const EMPTY_ANSWERS = { modality: null, framing: null, timeDependent: null, needsProbs: null, regulated: null, interpretability: null, errorCost: null, unsupGoal: null };

/* ---------------- main app ---------------- */
export default function MLCompass() {
  const [stage, setStage] = useState(0);
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [goal, setGoal] = useState("");
  const [target, setTarget] = useState("");
  const [noTarget, setNoTarget] = useState(false);
  const [known, setKnown] = useState({});
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [copied, setCopied] = useState(false);
  const [useLLM, setUseLLM] = useState(false);          // off by default → instant + $0
  const [explained, setExplained] = useState(null);     // reworded sections (or null)
  const [explainState, setExplainState] = useState("idle"); // idle | loading | workers-ai | on-device | rules
  const [loadMsg, setLoadMsg] = useState("");
  const fileRef = useRef(null);

  const prof = useMemo(() => (rows ? profile(rows) : null), [rows]);
  const rawTask = useMemo(() => (rows && target && !noTarget ? targetFacts(rows, prof, target) : null), [rows, prof, target, noTarget]);
  const resolvedTask = useMemo(() => {
    if (noTarget || !rawTask) return noTarget ? null : rawTask;
    return rawTask.framingAmbiguous && answers.framing ? { ...rawTask, kind: answers.framing } : rawTask;
  }, [rawTask, answers.framing, noTarget]);
  const isClf = resolvedTask?.kind === "classification";
  const resolvedModality = noTarget ? "tabular" : (answers.modality || "tabular");

  const initKnown = (r) => {
    const k = {};
    Object.keys(r[0] || {}).forEach((c) => (k[c] = !LEAKY_RE.test(c)));
    setKnown(k);
  };
  const loadSample = () => { const r = makeSample(); setRows(r); setFileName("nyc_taxi_sample.csv"); initKnown(r); };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => { setRows(res.data); setFileName(f.name); initKnown(res.data); } });
  };

  const questionList = useMemo(() => {
    if (noTarget) return ["unsupGoal"];
    const q = [];
    if (prof?.modalityHint && prof.modalityHint !== "tabular") q.push("modality");
    if (rawTask?.framingAmbiguous) q.push("framing");
    q.push("timeDependent");
    if (isClf) q.push("needsProbs");
    q.push("interpretability", "regulated");
    if (isClf) q.push("errorCost");
    return q;
  }, [noTarget, prof, rawTask, isClf]);
  const questionsDone = questionList.every((k) => answers[k] !== null && answers[k] !== undefined);

  const rec = useMemo(() => {
    if (stage !== 3 || !prof) return null;
    const excludedCols = Object.entries(known).filter(([c, v]) => !v && c !== target).map(([c]) => c);
    return recommend({ modality: resolvedModality, task: noTarget ? null : resolvedTask, prof, answers, target, excludedCols });
  }, [stage, prof, resolvedTask, answers, known, target, noTarget, resolvedModality]);

  // optional explainer: rephrase when enabled, and re-run / reset whenever the bearing changes
  useEffect(() => {
    if (stage !== 3 || !rec || !useLLM) { setExplained(null); setExplainState("idle"); setLoadMsg(""); return; }
    let cancelled = false;
    setExplainState("loading"); setLoadMsg("Checking Workers AI…");
    explainSections(rec.sections, {
      onStatus: (s) => {
        if (cancelled) return;
        if (s.tier === "workers-ai") setLoadMsg("Checking Workers AI…");
        else if (s.tier === "on-device") setLoadMsg(s.progress != null
          ? `Workers AI busy — loading on-device model… ${Math.round(s.progress * 100)}%`
          : "Workers AI busy — starting on-device model…");
      },
    }).then(({ sections, source }) => {
      if (cancelled) return;
      setExplained(sections);
      setExplainState(source);   // 'workers-ai' | 'on-device' | 'rules'
    });
    return () => { cancelled = true; };
  }, [stage, rec, useLLM]);

  const meta = () => ({ name: fileName, nRows: prof.nRows, nCols: prof.nCols, target: noTarget ? null : target, goal, modality: resolvedModality });
  const copyMd = () => navigator.clipboard.writeText(toMarkdown(rec, meta())).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  const downloadMd = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toMarkdown(rec, meta())], { type: "text/markdown" }));
    a.download = "ml-compass-bearing.md"; a.click();
  };
  const reset = () => { setStage(0); setRows(null); setTarget(""); setNoTarget(false); setGoal(""); setAnswers(EMPTY_ANSWERS); };

  const QMETA = {
    modality: {
      icon: <Database size={16} />, q: `This looks like ${prof?.modalityHint} data — is that right?`,
      hint: "Detection is a heuristic; you confirm. Images and text take a different path from tabular.",
      opts: [{ v: prof?.modalityHint, l: `Yes — ${prof?.modalityHint}` }, { v: "tabular", l: "No — tabular" }],
    },
    framing: {
      icon: <Target size={16} />, q: "Your target is a small set of ordered numbers — how should it be modeled?",
      hint: "Regression predicts the value, classification the class, ordinal respects the order.",
      opts: [{ v: "regression", l: "Regression" }, { v: "classification", l: "Classification" }, { v: "ordinal", l: "Ordinal" }],
    },
    timeDependent: {
      icon: <Map size={16} />, q: "Could the patterns drift over time?",
      hint: prof?.cols.some((c) => c.dtype === "datetime") ? "A datetime column was detected — drift is likely." : "No datetime column detected.",
      opts: [{ v: true, l: "Yes — time matters" }, { v: false, l: "No — stable patterns" }],
    },
    needsProbs: {
      icon: <Sparkles size={16} />, q: "Do you need a probability score, or just the label?",
      hint: "Scores that drive decisions (risk, churn, fraud) need calibration.",
      opts: [{ v: true, l: "Probability score" }, { v: false, l: "Just the label" }],
    },
    regulated: {
      icon: <AlertTriangle size={16} />, q: "Is this regulated or high-stakes?",
      hint: "Health, finance, hiring, insurance — anywhere errors carry legal or human cost.",
      opts: [{ v: true, l: "Yes" }, { v: false, l: "No" }],
    },
    interpretability: {
      icon: <HelpCircle size={16} />, q: "How important is explaining individual predictions?",
      hint: "Drives the balance between linear models, trees + SHAP, and pure accuracy.",
      opts: [{ v: "must", l: "Must explain" }, { v: "nice", l: "Nice to have" }, { v: "no", l: "Not needed" }],
    },
    errorCost: {
      icon: <Target size={16} />, q: "When the model is wrong, which is worse?",
      hint: "Shapes the metric emphasis and decision threshold.",
      opts: [{ v: "fp", l: "False positives" }, { v: "fn", l: "False negatives" }, { v: "eq", l: "About equal" }],
    },
    unsupGoal: {
      icon: <Database size={16} />, q: "No target selected — what are you trying to do?",
      hint: "This routes the unsupervised branch.",
      opts: [{ v: "cluster", l: "Group similar records" }, { v: "reduce", l: "Reduce dimensions / visualize" }, { v: "anomaly", l: "Find anomalies" }],
    },
  };

  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>

      <header className="max-w-5xl mx-auto px-5 pt-8 pb-5 flex items-center gap-4">
        <Dial stage={stage} />
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={disp}>ML Compass</h1>
            <span className="text-xs" style={{ ...mono, color: C.inkSoft }}>rules decide · explanations follow</span>
          </div>
          <div className="flex gap-1 mt-2">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <span title={STAGE_HELP[s]} className="text-xs px-2 py-0.5 rounded-full cursor-help" style={{ ...mono, background: i === stage ? C.ink : i < stage ? C.goodBg : C.neuBg, color: i === stage ? "#fff" : i < stage ? C.good : C.inkSoft }}>{i < stage ? "✓ " : ""}{s}</span>
                {i < 3 && <span style={{ color: C.line }}>—</span>}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 pb-20">
        {/* STAGE 0 — FRAME */}
        {stage === 0 && (
          <>
          <p className="text-base md:text-lg mt-4 mb-5 max-w-3xl" style={{ color: C.inkSoft }}>
            A pre-flight checklist for ML projects. Catch leakage, metric mistakes,
            validation issues, and weak framing <b style={{ color: C.ink }}>before you train</b>.
          </p>
          <section className="grid md:grid-cols-5 gap-6 mt-4">
            <div className="md:col-span-3 rounded-2xl p-7" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <h2 className="text-xl font-semibold mb-1" style={disp}>Frame the question</h2>
              <p className="text-sm mb-5" style={{ color: C.inkSoft }}>One line: what decision will this prediction drive? This anchors everything downstream.</p>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3}
                placeholder="e.g. Show riders a reliable upfront fare at pickup, within $2 of the final price."
                className="w-full rounded-xl p-3 text-sm outline-none" style={{ border: `1.5px solid ${C.line}`, background: C.paper }} />
              <p className="text-xs mt-2" style={{ color: C.inkSoft }}>
                Example: <i>“Predict which customers are likely to churn so retention teams can prioritize outreach.”</i>
              </p>
              <div className="mt-6">
                <h3 className="font-semibold text-sm mb-3" style={disp}>Then bring the data</h3>
                <div className="flex flex-wrap gap-3">
                  <Btn primary onClick={() => fileRef.current?.click()}><Upload size={16} /> Upload CSV</Btn>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />
                  <Btn onClick={loadSample}><FileSpreadsheet size={16} /> Use NYC taxi sample</Btn>
                </div>
                {rows && <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: C.good }}><CheckCircle2 size={16} /> {fileName} — {rows.length} rows loaded</div>}
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl p-6" style={{ background: C.neuBg, border: `1px solid ${C.line}` }}>
              <h3 className="font-semibold text-sm mb-3" style={disp}>How this works</h3>
              <ol className="space-y-3 text-sm" style={{ color: C.inkSoft }}>
                <li><b style={{ color: C.ink }}>Profile.</b> The dataset answers everything objective — types, cardinality, imbalance, modality.</li>
                <li><b style={{ color: C.ink }}>Questions.</b> You answer only what the data can't reveal (~5 taps).</li>
                <li><b style={{ color: C.ink }}>Bearing.</b> A deterministic rules engine — not an LLM guess — issues the recommendation with reasons and caveats.</li>
              </ol>
              <div className="mt-5 pt-4 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.inkSoft }}>
                <b style={{ color: C.ink }}>Who it's for:</b> architects and ML engineers aligning before code, teams
                catching leakage and metric mistakes early enough to flag them to a client, and anyone
                pushing data straight into a model builder (Salesforce Einstein, Snowflake, Databricks)
                that trains on whatever you feed it.
              </div>
            </div>
            <div className="md:col-span-5 flex justify-end">
              <Btn primary disabled={!rows} onClick={() => setStage(1)}>Profile the data <ArrowRight size={16} /></Btn>
            </div>
          </section>
          </>
        )}

        {/* STAGE 1 — PROFILE */}
        {stage === 1 && prof && (
          <section className="mt-4">
            <div className="rounded-2xl p-7" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="flex flex-wrap items-baseline gap-3 mb-1">
                <h2 className="text-xl font-semibold" style={disp}>Dataset profile</h2>
                <span className="text-sm" style={{ ...mono, color: C.inkSoft }}>{prof.nRows} rows × {prof.nCols} columns</span>
                {prof.modalityHint !== "tabular" && <Tag tone="amber">looks like {prof.modalityHint}</Tag>}
              </div>
              <p className="text-sm mb-5" style={{ color: C.inkSoft }}>Everything below was computed, not asked. Now pick the target.</p>
              <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${C.line}` }}>
                <table className="w-full text-sm" style={{ minWidth: 560 }}>
                  <thead><tr style={{ background: C.neuBg }}>{["Column", "Type", "Missing", "Cardinality", "Flags", "Target?"].map((h) => <th key={h} className="text-left px-3 py-2 text-xs uppercase tracking-wide" style={{ ...mono, color: C.inkSoft }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {prof.cols.map((c) => (
                      <tr key={c.name} style={{ borderTop: `1px solid ${C.line}`, background: target === c.name ? C.supBg : "transparent" }}>
                        <td className="px-3 py-2 font-medium" style={mono}>{c.name}</td>
                        <td className="px-3 py-2"><Tag tone={{ numeric: "sup", categorical: "uns", datetime: "amber", text: "neu" }[c.dtype]}>{c.dtype}</Tag></td>
                        <td className="px-3 py-2" style={{ ...mono, color: c.missingPct > 0 ? C.amber : C.inkSoft }}>{c.missingPct}%</td>
                        <td className="px-3 py-2" style={mono}>{c.cardinality}</td>
                        <td className="px-3 py-2">{c.idLike && <Tag tone="bad">ID-like</Tag>} {LEAKY_RE.test(c.name) && <Tag tone="amber">leak-suspect</Tag>}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => { setTarget(c.name); setNoTarget(false); }} className="w-5 h-5 rounded-full inline-flex items-center justify-center" style={{ border: `2px solid ${target === c.name ? C.sup : C.line}`, background: target === c.name ? C.sup : "transparent" }}>
                            {target === c.name && <Check size={12} color="#fff" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
                <input type="checkbox" checked={noTarget} onChange={(e) => { setNoTarget(e.target.checked); if (e.target.checked) setTarget(""); }} />
                No target — I want to find structure (unsupervised)
              </label>
              {rawTask && (
                <div className="mt-4 rounded-xl p-4 text-sm flex gap-2 items-start" style={{ background: C.supBg }}>
                  <Info size={16} style={{ color: C.sup, marginTop: 2 }} />
                  <span>
                    {rawTask.framingAmbiguous
                      ? <><b>{target}</b> is a small set of numbers — regression, classification, or ordinal? You'll choose in the next step.</>
                      : rawTask.kind === "regression"
                        ? <><b>{target}</b> looks continuous → supervised regression.</>
                        : <><b>{target}</b> looks categorical ({rawTask.nClasses} classes) → supervised classification.{rawTask.imbalance !== undefined && rawTask.imbalance < 0.2 && <> Minority class is <b>{(rawTask.imbalance * 100).toFixed(1)}%</b> — imbalance handling will be recommended.</>}</>}
                  </span>
                </div>
              )}
            </div>

            {!noTarget && target && (
              <div className="rounded-2xl p-7 mt-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <h3 className="font-semibold mb-1" style={disp}>Which columns would you actually know at prediction time?</h3>
                <p className="text-sm mb-4" style={{ color: C.inkSoft }}>The single most important leakage guard. Suspicious names are pre-unchecked — confirm them.</p>
                <div className="flex flex-wrap gap-2">
                  {prof.cols.filter((c) => c.name !== target).map((c) => (
                    <button key={c.name} onClick={() => setKnown({ ...known, [c.name]: !known[c.name] })} className="px-3 py-1.5 rounded-lg text-sm inline-flex items-center gap-1.5"
                      style={{ ...mono, background: known[c.name] ? C.goodBg : C.badBg, color: known[c.name] ? C.good : C.bad, border: `1px solid ${known[c.name] ? "#bfe6c9" : "#f1c7c7"}` }}>
                      {known[c.name] ? <Check size={13} /> : <XCircle size={13} />} {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <Btn onClick={() => setStage(0)}><ArrowLeft size={16} /> Back</Btn>
              <Btn primary disabled={!noTarget && !target} onClick={() => setStage(2)}>Guided questions <ArrowRight size={16} /></Btn>
            </div>
          </section>
        )}

        {/* STAGE 2 — QUESTIONS */}
        {stage === 2 && (
          <section className="mt-4">
            <div className="rounded-2xl p-7" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <h2 className="text-xl font-semibold mb-1" style={disp}>Only what the data can't tell us</h2>
              <p className="text-sm mb-6" style={{ color: C.inkSoft }}>{questionList.length} questions. Each one changes a specific rule downstream.</p>
              <div className="space-y-6">
                {questionList.map((key) => {
                  const m = QMETA[key];
                  return (
                    <div key={key}>
                      <div className="flex items-center gap-2 mb-1 font-medium text-sm" style={disp}><span style={{ color: C.sup }}>{m.icon}</span> {m.q}</div>
                      <div className="text-xs mb-2" style={{ color: C.inkSoft }}>{m.hint}</div>
                      <div className="flex flex-wrap gap-2">
                        {m.opts.map((o) => (
                          <button key={String(o.v)} onClick={() => setAnswers({ ...answers, [key]: o.v })} className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                            style={{ background: answers[key] === o.v ? C.ink : C.paper, color: answers[key] === o.v ? "#fff" : C.ink, border: `1.5px solid ${answers[key] === o.v ? C.ink : C.line}` }}>{o.l}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between mt-6">
              <Btn onClick={() => setStage(1)}><ArrowLeft size={16} /> Back</Btn>
              <Btn primary disabled={!questionsDone} onClick={() => setStage(3)}>Get my bearing <Compass size={16} /></Btn>
            </div>
          </section>
        )}

        {/* STAGE 3 — BEARING */}
        {stage === 3 && rec && (
          <section className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-2xl font-bold" style={disp}>Your bearing <span className="text-sm font-normal" style={{ color: C.inkSoft }}>— your recommended plan</span></h2>
                <p className="text-sm" style={{ color: C.inkSoft }}>{fileName} · {prof.nRows}×{prof.nCols} · {resolvedModality} · target: <b style={mono}>{noTarget ? "none" : target}</b></p>
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => setUseLLM((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
                  title="Rephrase the rules' text in plain English. Decisions never change; falls back to rules text if unavailable."
                  style={{ background: useLLM ? C.ink : C.panel, color: useLLM ? "#fff" : C.ink, border: `1px solid ${useLLM ? C.ink : C.line}` }}>
                  <Wand2 size={14} /> {useLLM ? "Plain-English: on" : "Plain-English: off"}
                </button>
                <Btn small onClick={copyMd}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy markdown"}</Btn>
                <Btn small onClick={downloadMd}><Download size={14} /> Download .md</Btn>
              </div>
            </div>
            {useLLM && (
              <div className="text-xs mb-4 -mt-1" style={{ ...mono, color: explainState === "rules" ? C.amber : C.inkSoft }}>
                {explainState === "loading" && (loadMsg || "Rephrasing…")}
                {explainState === "workers-ai" && "✓ Reworded by Workers AI — decisions unchanged."}
                {explainState === "on-device" && "✓ Reworded on-device — decisions unchanged."}
                {explainState === "rules" && "Explainer unavailable — showing the deterministic rules text."}
              </div>
            )}
            <div className="space-y-4">
              {(useLLM && explained && (explainState === "workers-ai" || explainState === "on-device") ? explained : rec.sections).map((s) => {
                const bar = { sup: C.sup, uns: C.uns, amber: C.amber, neu: C.neu, bad: C.bad }[s.tone];
                return (
                  <div key={s.id} className="rounded-2xl p-5 md:p-6" style={{ background: C.panel, border: `1px solid ${C.line}`, borderLeft: `4px solid ${bar}` }}>
                    <div className="text-xs uppercase tracking-wider mb-1" style={{ ...mono, color: bar }}>{s.title}</div>
                    <div className="font-semibold mb-1.5" style={disp}>{s.decision}</div>
                    <p className="text-sm" style={{ color: C.inkSoft }}><b style={{ color: C.ink }}>Why:</b> {s.reason}</p>
                    {s.caveat && <p className="text-sm mt-2 rounded-lg px-3 py-2" style={{ background: C.amberBg, color: C.ink }}><b>Caveat:</b> {s.caveat}</p>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-8">
              <Btn onClick={() => setStage(2)}><ArrowLeft size={16} /> Adjust answers</Btn>
              <Btn onClick={reset}><ListChecks size={16} /> New dataset</Btn>
            </div>
            <p className="text-xs mt-8 text-center" style={{ ...mono, color: C.inkSoft }}>Every decision came from deterministic rules over your dataset profile and answers. The language model, when on, only rephrases — it never decides.</p>
          </section>
        )}
      </main>
    </div>
  );
}
