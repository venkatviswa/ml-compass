# CLAUDE.md — ML Compass

ML Compass is a deterministic ML project advisor: it profiles a dataset, asks a few
questions the data can't answer, and returns a *bearing* (task, baselines, model
families, metric, validation, leakage audit). **Rules decide; an optional LLM only
rephrases.** Next.js static export; all decision logic runs client-side.

## Architecture map

| Path | Layer | Rule |
|------|-------|------|
| `app/rules.mjs` | Decision engine | **Single source of truth.** Every recommendation lives here. |
| `app/profiler.mjs` | Profiling | Dataset facts + all tunable thresholds (`SMALL_N`, `HIGH_CARD`, `ORDINAL_MAX`, sentinel thresholds). |
| `app/explainer.mjs` | Optional LLM | Tiered: Workers AI → opt-in on-device (WebLLM) → deterministic text. |
| `app/MLCompass.jsx` | UI only | Presentation + state. **Never put decision logic here.** |
| `app/fixtures.mjs`, `app/rules.test.mjs` | Golden tests | 21 datasets, 101 assertions on decisions. |
| `functions/api/explain.js` | Serverless | Cloudflare Pages Function (Workers AI, `env.AI` binding). |
| `mcp/server.mjs` | Headless | Local MCP server (stdio) over the same engine; e2e test `npm run test:mcp`. |
| `mcp-worker/` | Headless | Remote MCP server (Cloudflare Worker, agents SDK). **Profile-in only — never accept raw rows remotely.** Separate deployable with its own wrangler.jsonc. |
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
   (and README/article claims if they state the old behavior). Assertion counts are
   stated in CLAUDE.md, README, engine-rules.md and the article — grep for the old
   number after changing the suite; prefer number-free phrasing in captions/badges.
7. **Headless parity.** The MCP servers share the engine and carry behavioral guards in
   their responses — the verbatim-decision note, the framing-dependent-questions note,
   and `unansweredQuestions`. Don't strip them; agents act on them.

## Commands

```bash
npm run dev       # local dev server
npm run build     # static export → ./out (must stay green)
npm test          # golden suite — 21 datasets, 101 assertions, 0 failures expected
                  #   (fixtures + unit checks: profiler heuristics, questionKeys/resolveTask,
                  #    faithfulRewording — the invariant-#1 guard)
npm run test:mcp  # end-to-end: drives the stdio MCP server over real JSON-RPC (11 checks)
npm run mcp       # run the local MCP server (stdio) by hand
npm run report    # regenerate the test report in docs/
```

## Deploy targets

- **GitHub Pages** — automatic on push to `main` via `.github/workflows/deploy.yml`.
- **Cloudflare Pages** (`ml-compass.pages.dev`) — auto-builds on push to `main`.
  Gotchas that have already burned us once (full walkthrough in `DEPLOY.md`):
  - Create under the **Pages** wizard, never the Workers one. Tell-tale: the Workers
    wizard asks for a "Deploy command" (`npx wrangler deploy`) — wrong path, OpenNext
    will fail on this static export. The Pages wizard asks for a "Build output directory".
  - Framework preset **None** (never Next.js), build `npm run build`, output `out`,
    env var `NODE_VERSION=20`, no `PAGES_BASE_PATH`.
  - Bindings are managed in **`wrangler.toml`** (`[ai] binding = "AI"`), not the
    dashboard — the UI greys them out once the file exists.
  - Workers AI model ids get deprecated; `functions/api/explain.js` tries the `MODELS`
    list in order. If the tier 502s, the response body names each model's error.
- **MCP worker** (`mcp-worker/`) — a separate Cloudflare **Worker** (not Pages):
  `cd mcp-worker && npm install && npx wrangler deploy`. For this one the Workers
  wizard / `npx wrangler deploy` IS the right path (unlike the site).
- The rules engine ships in the **client bundle** — after an engine change, a stale
  browser cache looks like a failed deploy. Hard-refresh before debugging.

See **`learnings.md`** for the full set of hard-won lessons behind these rules.

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
