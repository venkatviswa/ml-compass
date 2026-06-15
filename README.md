# ML Compass

**An ML project advisor, not an AutoML tool.** ML Compass takes a dataset and a
business question and returns a *bearing*: the learning task, sensible baselines,
which model families to try, whether to use PCA, a feature‑engineering plan,
the right evaluation metric, a validation strategy, and — most importantly —
the **leakage risks** specific to your data. It tells you *how to think through*
the problem, with a reason and a caveat behind every call.

It's a **pre-flight checklist for ML projects** — it helps you catch leakage,
wrong metrics, validation mistakes, and poor model framing *before* training.

**▶ Try the live prototype: [venkatviswa.github.io/ml-compass](https://venkatviswa.github.io/ml-compass)**

The flow is simple: frame the business decision, profile the dataset, answer a
few context questions, then receive a deterministic *bearing* with reasons and
caveats.

## Core principle: rules decide, explanations follow

The recommendation is produced by a **deterministic rules engine** over your
dataset profile and your answers — never by a language model guessing. That makes
the advice testable, auditable, and reproducible. (A future LLM layer is meant
only to *phrase* the result in friendly prose, never to change the decision.)

This is the deliberate counter‑position to "ask a chatbot which model to use":
the model that gives you confident wrong advice is exactly the failure mode this
design removes.

## How it works — four stages

1. **Frame** — state the decision the prediction will drive, then upload a CSV
   (or use the built‑in NYC‑taxi sample).
2. **Profile** — the app computes everything *objective* from the data: column
   types, cardinality, missingness, ID‑like and leak‑suspect columns, class
   imbalance, and a data‑modality hint (tabular / text / image). You then pick
   the target.
3. **Questions** — you answer only what the data *cannot* reveal (~5 taps):
   time‑dependence, probabilities vs labels, regulated/high‑stakes, interpretability,
   error cost, and — the single most valuable leakage guard — *which columns would
   actually be known at prediction time*. Questions appear conditionally
   (e.g. error‑cost only for classification; a framing question when a numeric
   target has few distinct values; a modality‑confirm when the profiler suspects
   text or images).
4. **Bearing** — the rules engine emits the recommendation, each section showing
   **decision · reason · caveat**. Exportable as Markdown.

## Files

| File | Layer | What it does |
|------|-------|--------------|
| `MLCompass.jsx` | **UI** | The React component: the four‑stage wizard, profile table, question cards, and the bearing report. Pure presentation + state — contains no decision logic. In a Next.js app, add `"use client";` as the first line. |
| `rules.mjs` | **Business logic** | The deterministic advisor engine. `recommend(facts)` takes a profile + answers and returns structured sections (task, baseline, model families, metrics, PCA, feature engineering, validation, leakage, calibration, fairness). Branches for tabular, text, image, and unsupervised paths, plus small‑n and ordinal‑framing handling. **Single source of truth** — imported by both the UI and the tests. |
| `profiler.mjs` | **Business logic** | Dataset profiling (`profile`), target analysis with framing‑ambiguity detection (`targetFacts`), the synthetic NYC‑taxi `makeSample`, and the tunable thresholds (`SMALL_N`, `HIGH_CARD`, `ORDINAL_MAX`). No React. |
| `rules.test.mjs` | **Tests** | Golden tests: 20 famous datasets encoded as fixtures, asserting the engine's *decisions* against best practice. Run with `node rules.test.mjs`. |
| `explainer.mjs` | **Business logic** *(optional)* | The optional, **tiered** LLM "explainer." `explainSections(sections)` rephrases the rules' text into plain English and **never changes a decision**. It tries Workers AI → on-device (WebLLM) → deterministic text, falling back automatically on any failure. The app is fully functional and $0 without it. |
| `functions/api/explain.js` | **Serverless** *(optional)* | A Cloudflare Pages Function that proxies to Workers AI (free tier). Holds no API key — it uses the platform's `AI` binding. Returns a non-200 on any error (incl. daily quota) so the client falls back. Swap the `MODEL` constant for Gemma, Phi, Llama, etc. |
| `next.config.mjs` | **Config** | Static export (`output: "export"`) so `next build` emits a fully static `./out` hostable anywhere. |
| `DEPLOY.md` | **Docs** | Push-button deploy guide: Cloudflare Pages (recommended), Vercel, and GitHub Pages, with the Workers AI binding setup. |
| `ml-decision-guide.pdf` / `.html` | **Reference** | The companion ML decision guide whose lifecycle, matrices, and leakage rules this engine encodes. The HTML is for screen; the PDF (with two landscape flowchart pages) is for printing/teaching. |
| `ml-compass.jsx` | *legacy* | The original single‑file version (logic + UI bundled) used for the in‑chat live preview. Superseded by the `profiler.mjs` + `rules.mjs` + `MLCompass.jsx` split; kept only for quick preview. |

## Running it

**The app (Next.js):**

```bash
npx create-next-app@latest ml-compass   # TypeScript: No, Tailwind: Yes, App Router: Yes
cd ml-compass
npm install papaparse lucide-react
npm install @mlc-ai/web-llm              # OPTIONAL — enables the on-device explainer tier
```

Copy `MLCompass.jsx`, `rules.mjs`, `profiler.mjs` (and optionally `explainer.mjs`) into
`app/`, copy `next.config.mjs` to the project root, add `"use client";` to the top of
`MLCompass.jsx`, then in `app/page.js`:

```jsx
import MLCompass from "./MLCompass";
export default function Home() { return <MLCompass />; }
```

```bash
npm run dev        # http://localhost:3000 (development)
npm run build      # emits a static ./out for hosting (output: "export")
```

To deploy (Cloudflare Pages / Vercel / GitHub Pages), see **DEPLOY.md**.

**The tests (no framework needed):**

```bash
node rules.test.mjs
```

## The optional LLM explainer

The recommendation is always produced by the deterministic engine. The LLM, when
enabled, **only rephrases the engine's text into friendlier prose — it never makes
or alters a decision.** This keeps the "rules decide" guarantee intact and means the
app works fully, instantly, and at **$0 with the explainer off** (the default).

It's **tiered**, and the fallback is automatic and transparent — the user never picks
a provider:

1. **Workers AI** (`/api/explain`) — fast, no client download. Free tier is 10,000
   neurons/day; when exhausted, the request 4xx/5xxs and the explainer moves on.
2. **On-device** (WebLLM) — if Workers AI is unavailable *and* the browser has WebGPU,
   a small open model (Llama 3.2 3B / Gemma 2 / Phi-3.5-mini) runs entirely in the
   browser. No quota, no cost, private. The tradeoff is a one-time ~1–2 GB model
   download, so the UI shows honest progress ("Workers AI busy — loading on-device
   model… 40%") rather than silently fetching a gigabyte.
3. **Deterministic text** — if neither is available, the rules' own wording is shown.

The Bearing screen has a *Plain-English* toggle (off by default). `explainer.mjs` sends
only the text fields, validates the response shape, and replaces *only* wording —
keeping every decision, id, and structure from the rules. A failed or malformed
response at any tier drops to the next one.

**Enabling the tiers:**

- *Workers AI:* deploy with the `functions/` folder, then add a Workers AI binding named
  `AI` in the Cloudflare Pages project (*Settings → Functions → Bindings*). No API key is
  stored — the function calls `env.AI.run(...)`. Change the model via the `MODEL` constant.
- *On-device:* `npm install @mlc-ai/web-llm`. If it isn't installed, that tier is simply
  skipped. Set the model id in `explainer.mjs` (verify it against WebLLM's prebuilt list).

See **DEPLOY.md** for the full hosting walkthrough.

## Testing approach

Model *choice* has a range of defensible answers, so the suite asserts on the
**decisions that have a clear right/wrong** — the metric, the PCA call, leakage
flags, validation strategy, calibration, and fairness — rather than on prose.
The 20 datasets are chosen for **branch coverage**: each one exercises a different
rule (extreme imbalance → PR‑AUC; small‑n → simple‑model‑first; high cardinality →
CatBoost; time‑dependent → time‑split; medical → subgroup fairness; numeric‑few‑values
→ ordinal framing; text → TF‑IDF + Naive Bayes; images → CNN; no target → clustering).
Current status: **20 datasets, 71 assertions, 0 failures.**

Datasets covered: Titanic, Iris, House Prices (Ames), Credit Card Fraud, Adult/Census
Income, Telco Churn, Wine Quality, NYC Taxi, MNIST, SMS Spam, Pima Diabetes,
California Housing, Heart Disease (Cleveland), Spaceship Titanic, Breast Cancer
Wisconsin, Bike Sharing Demand, IMDB Reviews, CIFAR‑10, Mall Customers, Santander
Transaction.

> Note: the profiler tests the *rules*. The profiler's own heuristics (date detection,
> high‑cardinality, modality hints) deserve a separate fixture suite on raw rows —
> a different failure mode.

## Honest limitations

- **Modality detection is a hint, not magic.** Whether a flat CSV is "really" images
  or text is a judgment call, so the app *asks you to confirm* rather than guessing.
- **Thresholds are heuristics.** `SMALL_N` (<500 rows), `HIGH_CARD` (>30 levels),
  and `ORDINAL_MAX` (≤15 target values) live in `profiler.mjs` and are meant to be tuned.
- **No model is trained.** This is an advisor; it produces the plan, not the fitted model.

## Roadmap

- A **Python twin** (`profiler.py` + `rules.py` with Pydantic + a pytest port of these
  fixtures) so a FastAPI backend shares the exact logic file‑for‑file.
- The optional **LLM explanation layer** — **built** (`explainer.mjs` + `functions/api/explain.js`): tiered Workers AI → on-device → deterministic, phrasing only, $0 by default.
- **Static export + deploy** — **built** (`next.config.mjs` + `DEPLOY.md`): Cloudflare Pages / Vercel / GitHub Pages.
- A separate **profiler fixture suite** on raw rows.
- Report export to PDF/HTML and a downloadable starter notebook.
