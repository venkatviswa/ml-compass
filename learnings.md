# Learnings — ML Compass

Hard-won lessons from building, deploying, and debugging ML Compass. Each entry is a
problem we actually hit, what it turned out to be, and the rule we now follow.
(Companion to `CLAUDE.md`, which carries the binding invariants.)

## Engine correctness

- **Timestamps are not IDs.** The "near-unique ⇒ ID-like" heuristic flagged
  `pickup_datetime` (400 unique values in 400 rows) as an ID — so the engine told users
  to *drop* the most predictive column in the taxi dataset and silently lost the whole
  datetime feature plan. Datetime columns are now exempt from the uniqueness heuristic.
  *Rule: a profiling heuristic is judged by its worst false positive, not its accuracy.*
- **"Stratified" is a class-label concept.** Small-n regression was told to use
  "Repeated *stratified* k-fold." Now stratified appears only for classification.
- **Date formats are plural.** `DATE_RE` originally matched only ISO (`YYYY-MM-DD`), so
  `9/28/12`-style columns profiled as high-cardinality categoricals — producing wrong
  advice (target-encode dates!) downstream. The profiler now matches slash dates too.
- **Heuristics need their own tests.** Golden fixtures pass `idLike` explicitly, so the
  ID-heuristic bug was invisible to 70+ green assertions. The runner now has profiler
  unit checks against the built-in sample. *Rule: test the layer that computes a fact,
  not just the layer that consumes it.*

## The LLM explainer (the hardest-won section)

- **Rules decide; the LLM only rephrases — and the code must enforce it, once.**
  The guarantee drifted: one tier kept decisions verbatim, the other rewrote them.
  Now a single policy point (`faithfulRewording` in `explainer.mjs`) is enforced
  client-side for *every* provider: decisions/caveats verbatim, only the rationale
  reworded, and only if it keeps ~45% of the original's meaningful terms.
- **Small models can't do strict JSON reliably.** One big JSON array from a 1–3B model
  fails in every way imaginable: truncation, stray commas, merged fields, format drift.
  Per-section plain text (`id :: rewritten rationale`) parses reliably on any model,
  and one bad section can't poison the rest.
- **Guard against plausible-but-wrong, not just malformed.** Gemma-2B turned
  "balanced classes" into "multi-class" and decisions into "a good starting point."
  Length/format checks missed it; the content-overlap (token-preservation) guard
  catches it. Worst case is now the exact deterministic text — never corruption.
- **WebGPU presence ≠ ability to run a model.** iOS Safari exposes `navigator.gpu`,
  then the multi-GB download kills and silently reloads the tab, wiping the session.
  On-device is opt-in, desktop-only, low-memory-excluded (`canRunBrowserLLM`).
- **Multi-GB downloads must be opt-in.** Flipping a toggle should never silently pull
  ~2 GB. Explicit "Download model & rephrase" button; choice remembered in
  `localStorage` (note: incognito re-downloads every session — that's expected).
- **Status messages must track every slow await.** The UI froze on "Checking Workers
  AI…" through a library import + model load, and "Using <model>…" read as *finished*
  while generation ran. Every tier/phase now emits its own honest status.
- **Size timeouts to the real payload.** An 8s server timeout passed a 1-section curl
  test but timed out on real 8–9-section bearings — silently demoting users to the
  download tier. Now 30s. *Rule: test the timeout with production-shaped input.*

## Cloudflare deployment

- **Pages wizard, not Workers wizard.** The default "Create application" flow is the
  Workers one; its tell is a **"Deploy command"** field (`npx wrangler deploy`). That
  path routes a static export through OpenNext and dies on
  `ENOENT .next/standalone/...`. The Pages wizard's tell is a **"Build output
  directory"** field. Framework preset **None** — never "Next.js" for a static export.
- **`wrangler.toml` becomes the single source of truth.** Once committed
  (`pages_build_output_dir = "out"`), the dashboard greys out binding management —
  bindings must be declared in the file (`[ai] binding = "AI"`). Better anyway:
  version-controlled, applies on every deploy, no "retry deployment" dance.
- **Model ids are perishable.** `@cf/meta/llama-3.1-8b-instruct` was deprecated
  2026-05-30 and the whole tier silently 502'd. The function now tries an ordered
  `MODELS` list and reports *every* model's error in the 502 body, so one curl
  diagnoses the whole list.
- **Debug tiers with one fetch.** `POST /api/explain` from the browser console
  distinguishes in seconds: 503 = binding missing, 502 = model call failed (body says
  why), 200 = server fine (so the problem is client-side — timeout, cache, gating).
- **Static-export changes ship in the *client* bundle.** "The fix didn't deploy" was
  twice just a pending deployment or cached JS — the rules engine runs in the browser.
  Hard-refresh before diagnosing anything deeper.

## Docs & process

- **Docs follow code, or they rot in weeks.** Deploy guides described a pre-repo file
  layout; the article claimed guarantees one tier didn't yet honor; counts ("20
  datasets, 71 assertions") were baked into five documents. Every engine change now
  updates `docs/engine-rules.md` + any prose stating the old behavior — and captions
  avoid hardcoding numbers that grow.
- **Out-of-band zips are merge hazards.** Edits arriving as zip snapshots branch from
  stale history and silently revert newer work (this bit us once — the mobile-crash
  fix and landing UX). Reconcile file-by-file; prefer branches/PRs over zips.
- **A rule that can't be tested doesn't ship.** Every engine fix in this file landed
  with a fixture or unit check in the same commit. Suite: 21 datasets · 77 assertions.
