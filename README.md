# ML Compass

**An ML project advisor, not an AutoML tool.** ML Compass takes a dataset and a
business question and returns a *bearing*: the learning task, sensible baselines,
which model families to try, whether to use PCA, a feature‑engineering plan,
the right evaluation metric, a validation strategy, and — most importantly —
the **leakage risks** specific to your data. It tells you *how to think through*
the problem, with a reason and a caveat behind every call.

It's a **pre-flight checklist for ML projects** — it helps you catch leakage,
wrong metrics, validation mistakes, and poor model framing *before* training.

**▶ Try the live prototype: [ml-compass.pages.dev](https://ml-compass.pages.dev)**

The flow is simple: frame the business decision, profile the dataset, answer a
few context questions, then receive a deterministic *bearing* with reasons and
caveats.

## Core principle: rules decide, explanations follow

The recommendation is produced by a **deterministic rules engine** over your
dataset profile and your answers — never by a language model guessing. That makes
the advice testable, auditable, and reproducible. The optional LLM layer only
*phrases* the result in friendly prose: the **decision and caveats are shown
verbatim** from the rules engine, the explainer rewords just the *rationale*, and
if that wording drifts from the facts the app discards it and shows the exact
rules text. It can never change a decision.

This is the deliberate counter‑position to "ask a chatbot which model to use":
the model that gives you confident wrong advice is exactly the failure mode this
design removes.

> 📋 **[docs/engine-rules.md](docs/engine-rules.md)** — the full human-readable spec
> of every rule the engine follows (conditions, thresholds, and how its choices map
> to a practitioner's algorithm field guide).

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
| `rules.test.mjs` | **Tests** | Golden-test runner: asserts the engine's *decisions* against best practice across 21 datasets. Run with `node app/rules.test.mjs`. |
| `fixtures.mjs` | **Tests** | The 21 famous datasets encoded as profiles + answers + expected assertions, chosen for branch coverage. |
| `explainer.mjs` | **Business logic** *(optional)* | The optional, **tiered** LLM "explainer." `explainSections(sections)` rephrases the rules' text into plain English and **never changes a decision**. It tries Workers AI → on-device (WebLLM) → deterministic text, falling back automatically on any failure. Whatever the tier, the decision and caveat are shown **verbatim** and only the rationale is reworded — accepted only if it stays faithful (a content-overlap guard rejects over-summaries and fact-drift). The policy is enforced client-side in `explainer.mjs`, so it holds for any provider. On-device is **opt-in** (a one-time model download), desktop-only (the multi-GB model would crash phones), and the choice is remembered. The app is fully functional and $0 without any of it. |
| `functions/api/explain.js` | **Serverless** *(optional)* | A Cloudflare Pages Function that proxies to Workers AI (free tier). Holds no API key — it uses the platform's `AI` binding. Returns a non-200 on any error (incl. daily quota) so the client falls back. Tries the `MODELS` list in order, so one deprecated model id doesn't kill the tier. |
| `next.config.mjs` | **Config** | Static export (`output: "export"`) so `next build` emits a fully static `./out` hostable anywhere. |
| `report.mjs` | **Tooling** | Generates the Markdown/HTML test report from the golden suite (`npm run report`). |
| `docs/engine-rules.md` | **Docs** | Human-readable spec of every rule the engine follows, plus its algorithm coverage vs a practitioner field guide. |
| `docs/mcp-setup.md` | **Docs** | MCP setup guide: local + remote servers, client config, tool reference, troubleshooting. |
| `mcp/server.mjs` | **Headless** *(optional)* | Local **MCP server** (stdio) exposing the engine to AI agents: `profile_dataset`, `list_questions`, `get_bearing`. Reads CSVs from local disk — data never leaves the machine. `npm run mcp`; e2e test via `npm run test:mcp`. |
| `mcp-worker/` | **Headless** *(optional)* | Remote **MCP server** on Cloudflare Workers (agents SDK). Privacy-preserving by design: tools accept only the *computed profile*, never raw rows. Deployed separately (`npx wrangler deploy` from `mcp-worker/`). |
| `.github/workflows/deploy.yml` | **CI/CD** | Builds the static export and publishes to GitHub Pages on every push to `main`. |
| `DEPLOY.md` | **Docs** | Push-button deploy guide: Cloudflare Pages (recommended), Vercel, and GitHub Pages, with the Workers AI binding setup. |
| `ml-decision-guide.pdf` / `.html` | **Reference** | The companion ML decision guide whose lifecycle, matrices, and leakage rules this engine encodes. The HTML is for screen; the PDF (with two landscape flowchart pages) is for printing/teaching. |

## Running it

This repo **is** a ready-to-run Next.js app — just clone and start:

```bash
git clone https://github.com/venkatviswa/ml-compass.git
cd ml-compass
npm install        # @mlc-ai/web-llm is an optionalDependency for the on-device tier
npm run dev        # http://localhost:3000 (development)
npm run build      # emits a static ./out for hosting (output: "export")
```

**Deploying:**

- **GitHub Pages** — pushes to `main` auto-build and publish via `.github/workflows/deploy.yml`.
  Static only, so the explainer uses the on-device or rules tiers.
- **Cloudflare Pages** (recommended for the LLM) — connect the repo, build command `npm run build`,
  output dir `out`, then add a Workers AI binding named `AI`. This enables the fast server-side
  explainer with no client download. See **DEPLOY.md** for the click-by-click walkthrough.

**The tests (no framework needed):**

```bash
node app/rules.test.mjs   # golden suite (engine decisions)
npm run test:mcp          # end-to-end test of the local MCP server
```

## Headless: use it from AI agents (MCP)

The same deterministic engine is exposed as **Model Context Protocol** servers, so an
AI agent can consult ML Compass instead of guessing which model to use — the agent
calls the tools, the rules decide.

**Local (stdio)** — full-fidelity and fully private (CSVs are read from your disk):

```json
{ "mcpServers": { "ml-compass": {
    "command": "node", "args": ["/path/to/ml-compass/mcp/server.mjs"] } } }
```

Tools: `profile_dataset` (CSV → objective facts) → `list_questions` (what the data
can't reveal — the agent asks its human) → `get_bearing` (the full recommendation).

**Remote (Cloudflare Workers)** — for agents that already hold the facts: the remote
tools (`list_questions`, `get_bearing`) accept only the *computed profile and task
facts*, never raw rows, so no dataset ever reaches the server. Deploy from
`mcp-worker/` (see DEPLOY.md) and connect MCP clients to `/mcp` (streamable HTTP)
or `/sse`.

> 📖 **[docs/mcp-setup.md](docs/mcp-setup.md)** — the full setup guide: Claude
> Desktop/Code config, example prompts, tool reference, and troubleshooting.

## The optional LLM explainer

The recommendation is always produced by the deterministic engine. The LLM, when
enabled, **only rephrases the engine's text into friendlier prose — it never makes
or alters a decision.** This keeps the "rules decide" guarantee intact and means the
app works fully, instantly, and at **$0 with the explainer off** (the default).

It's **tiered**, and the fallback is automatic and transparent — the user never picks
a provider:

1. **Workers AI** (`/api/explain`) — fast, no client download, works on any device
   (incl. mobile). Free tier is 10,000 neurons/day; when exhausted, the request
   4xx/5xxs and the explainer moves on. Rephrases all fields at once (server-side).
2. **On-device** (WebLLM) — if Workers AI is unavailable *and* the device can run it,
   a small open model (default **Gemma-2-2B**, ~1.6 GB; swap for Llama-3.2-3B / Phi-3.5-mini)
   runs entirely in the browser. No quota, no cost, private. Because the model is
   multi-GB, this tier is **opt-in** (an explicit "download model" prompt, remembered in
   `localStorage`) and **desktop-only** (phones/tablets are excluded — the download would
   crash the tab). It rephrases **one section per call in plain text** (robust, no fragile
   JSON), keeps the **decision and caveat verbatim**, and rewords only the rationale —
   accepting it only if a content-overlap guard confirms it stayed faithful. The UI shows
   honest progress ("Downloading Gemma 2 2B Instruct… 40%", then "Rephrasing… (4/9)").
3. **Deterministic text** — if neither is available, the rules' own wording is shown.

The Bearing screen has a *Plain-English* toggle (off by default). `explainer.mjs` sends
only the bearing's text fields (never the dataset), and replaces *only* wording —
keeping every decision, id, and structure from the rules. A failed, malformed, or
unfaithful response at any tier drops to the next one (ultimately the exact rules text).

**Enabling the tiers:**

- *Workers AI:* deploy with the `functions/` folder, then add a Workers AI binding named
  `AI` in the Cloudflare Pages project (*Settings → Functions → Bindings*). No API key is
  stored — the function calls `env.AI.run(...)`. Change the model via the `MODEL` constant.
- *On-device:* `@mlc-ai/web-llm` ships as an `optionalDependency`, so `npm install` pulls it
  in; if it's absent the tier is simply skipped. Change the model via `DEFAULT_BROWSER_MODEL`
  in `explainer.mjs` (verify the id against WebLLM's prebuilt list).

See **DEPLOY.md** for the full hosting walkthrough.

## Testing approach

Model *choice* has a range of defensible answers, so the suite asserts on the
**decisions that have a clear right/wrong** — the metric, the PCA call, leakage
flags, validation strategy, calibration, and fairness — rather than on prose.
The 21 datasets are chosen for **branch coverage**: each one exercises a different
rule (extreme imbalance → PR‑AUC; small‑n → simple‑model‑first; high cardinality →
CatBoost; time‑dependent → time‑split; medical → subgroup fairness; numeric‑few‑values
→ ordinal framing; text → TF‑IDF + Naive Bayes; images → CNN; no target → clustering).
Current status: **21 datasets, 77 assertions, 0 failures.**

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
- **Leakage detection is a name-based prior, not proof.** `LEAKY_RE` in `rules.mjs`
  flags columns whose *names* match words like `total`, `final`, `outcome`, `result`,
  `paid`, `settle`, `tip`, `duration`, `dropoff_time`, `completed`. That will
  false-positive on innocent names (`final_score` in a game, `duration_since_signup`,
  `result_page_visited`) and it will miss leakage hidden under bland names. That's
  why the *"known at prediction time"* toggles are the real defense — the regex just
  puts a warning at the top of the pile.
- **No model is trained.** This is an advisor; it produces the plan, not the fitted model.

## Roadmap

- A **Python twin** (`profiler.py` + `rules.py` with Pydantic + a pytest port of these
  fixtures) so a FastAPI backend shares the exact logic file‑for‑file.
- The optional **LLM explanation layer** — **built** (`explainer.mjs` + `functions/api/explain.js`): tiered Workers AI → on-device → deterministic, phrasing only, $0 by default.
- **Static export + deploy** — **built** (`next.config.mjs` + `DEPLOY.md`): Cloudflare Pages / Vercel / GitHub Pages.
- A separate **profiler fixture suite** on raw rows.
- Report export to PDF/HTML and a downloadable starter notebook.
