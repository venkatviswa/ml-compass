# CLAUDE.md — ML Compass

ML Compass is a deterministic ML project advisor: it profiles a dataset, asks a few
questions the data can't answer, and returns a *bearing* (task, baselines, model
families, metric, validation, leakage audit). **Rules decide; an optional LLM only
rephrases.** Next.js static export; all decision logic runs client-side.

## Architecture map

| Path | Layer | Rule |
|------|-------|------|
| `app/rules.mjs` | Decision engine | **Single source of truth.** Every recommendation lives here. |
| `app/profiler.mjs` | Profiling | Dataset facts + all tunable thresholds (`SMALL_N`, `HIGH_CARD`, `ORDINAL_MAX`). |
| `app/explainer.mjs` | Optional LLM | Tiered: Workers AI → opt-in on-device (WebLLM) → deterministic text. |
| `app/MLCompass.jsx` | UI only | Presentation + state. **Never put decision logic here.** |
| `app/fixtures.mjs`, `app/rules.test.mjs` | Golden tests | 21 datasets, 77 assertions on decisions. |
| `functions/api/explain.js` | Serverless | Cloudflare Pages Function (Workers AI, `env.AI` binding). |
| `docs/engine-rules.md` | Spec | Human-readable spec of the engine. **Keep in sync with `rules.mjs`.** |

## Invariants — do not break

1. **Rules decide; the LLM only rephrases.** Decisions and caveats render verbatim from
   the rules engine. Only the rationale ("Why") may be reworded, and only if it passes
   the faithfulness guard (`faithfulRewording` in `explainer.mjs`). That guard is the
   single policy point, enforced client-side for every tier/provider.
2. **All decision logic in `rules.mjs`/`profiler.mjs`** — importable by UI and tests
   alike. No decisions in React components or the explainer.
3. **Golden tests must pass** before any push: `npm test` (or `node app/rules.test.mjs`).
   When you add or change a rule, add/adjust a fixture in `app/fixtures.mjs` — a rule
   that can't be tested doesn't ship.
4. **Static export stays static.** `next.config.mjs` uses `output: "export"`; no
   server-only Next.js features. The only server code is `functions/` (Cloudflare).
   `PAGES_BASE_PATH` is injected at build time by CI — don't hardcode a basePath.
5. **On-device LLM is opt-in and desktop-only.** The multi-GB download crashes mobile
   tabs. Don't weaken `canRunBrowserLLM()` or the opt-in gate (`allowLLM`).
6. **Docs follow code.** A change to engine behavior updates `docs/engine-rules.md`
   (and README/article claims if they state the old behavior).

## Commands

```bash
npm run dev      # local dev server
npm run build    # static export → ./out (must stay green)
npm test         # golden suite — 21 datasets, 77 assertions, 0 failures expected
npm run report   # regenerate the test report in docs/
```

## Deploy targets

- **GitHub Pages** — automatic on push to `main` via `.github/workflows/deploy.yml`.
- **Cloudflare Pages** — framework preset **None** (never the Next.js/OpenNext preset —
  it expects a server build and fails), build `npm run build`, output `out`,
  Workers AI binding named exactly `AI`. `wrangler.toml` pins the static pipeline.

## Engineering principles

Adapted from Karpathy-style CLAUDE.md guidelines
(github.com/multica-ai/andrej-karpathy-skills):

1. **Think before coding.** State assumptions; if a request is ambiguous, present the
   interpretations instead of silently picking one. Suggest the simpler alternative
   when one exists; name confusion instead of coding through it.
2. **Simplicity first.** Implement only what was asked. No premature abstraction for
   single-use code, no unrequested configurability, no error handling for unrealistic
   cases. Test: would a senior engineer call it overcomplicated?
3. **Surgical changes.** Match existing style; don't refactor working code or reformat
   surrounding lines. Flag unrelated dead code, don't delete it. Remove only the
   imports/variables your own change orphaned. Every changed line serves the request.
4. **Goal-driven execution.** Turn vague asks into verifiable criteria before coding;
   for multi-step work, define checkpoints (here, usually: golden tests green + build
   green + behavior confirmed in the UI).

## Language conventions

- **JavaScript** — plain ESM (`.mjs`) for all logic modules; no TypeScript syntax; no
  React outside `MLCompass.jsx`. Follow the existing comment density and naming.
- **Python** *(none in the repo yet — binding for any that gets added, e.g. the planned
  Python twin of the engine mentioned in `profiler.mjs`)*: use **Pydantic v2** idioms
  exclusively — `model_validate()` / `model_dump()`, `field_validator` /
  `model_validator`, `ConfigDict`, `Annotated` field constraints. Never Pydantic v1
  patterns (`.dict()`, `.parse_obj()`, `@validator`, nested `class Config`). Mirror the
  thresholds from `profiler.mjs`; port the golden fixtures alongside the engine.
