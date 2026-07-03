# Deploying ML Compass

ML Compass is a **static, client-side app** (the rules engine and profiler run in the
browser). So hosting is free almost anywhere. The only optional server piece is the
Workers AI explainer proxy in `functions/` — and even without it, the explainer still
works via the on-device (WebLLM) tier or falls back to the deterministic text.

## Project setup (once)

This repo **is** the ready-to-run app — clone and build:

```bash
git clone https://github.com/venkatviswa/ml-compass.git
cd ml-compass
npm install        # @mlc-ai/web-llm is an optionalDependency (on-device explainer tier)
npm run build      # with output:"export", emits ./out
```

Path prefixing is automatic: `next.config.mjs` reads `PAGES_BASE_PATH` at build time
(set by CI for GitHub Pages project sites; left unset for root-domain hosts like
Cloudflare or Vercel) — nothing to edit by hand.

---

## Option A — Cloudflare Pages  (recommended: free, commercial-OK, unlimited bandwidth, runs the Workers AI tier)

1. Push the repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → *Pages* tab → Connect to Git** → pick the repo.
3. Build settings:
   - **Framework preset:** **None** — do *not* pick "Next.js": that routes through the
     OpenNext/Workers adapter, which expects a server build and fails on this static
     export (`ENOENT .next/standalone/...`). The repo's `wrangler.toml`
     (`pages_build_output_dir = "out"`) pins the classic static pipeline.
   - **Build command:** `npm run build`
   - **Build output directory:** `out`
   - **Environment variable:** `NODE_VERSION` = `20` (don't set `PAGES_BASE_PATH`)
4. Deploy. The top-level `functions/` directory is picked up automatically, so
   `POST /api/explain` is live.
5. **To enable the Workers AI explainer** (free): project → **Settings → Functions →
   Bindings → Add → AI**, name it `AI`. No API key needed. Free tier is
   10,000 neurons/day; when exhausted, the app falls back to the deterministic text
   (or the opt-in on-device tier, if the visitor enabled it on a capable desktop).
6. (Optional) **Custom domain** under the project's Domains tab.

> Without the AI binding, `/api/explain` returns 503 → the explainer simply uses the
> on-device tier or the rules text. Nothing breaks.

## Option B — Vercel  (easiest Next.js deploy; note the caveats)

1. Import the GitHub repo at vercel.com — it autodetects Next.js.
2. Deploy. Done.
3. Caveats:
   - The **Hobby tier is non-commercial only** and caps bandwidth at 100 GB/mo.
   - `functions/api/explain.js` is **Cloudflare-specific** and will *not* run on Vercel.
     The Workers AI tier therefore won't be available; the explainer falls back to the
     on-device tier or the rules text. To get a server tier on Vercel, add a Vercel
     Route Handler at `app/api/explain/route.js` calling your chosen provider (Groq,
     Google AI Studio, etc.).

## Option C — GitHub Pages  (pure static, zero server — already wired up)

1. Already configured: `.github/workflows/deploy.yml` builds and publishes on every
   push to `main`, injecting `PAGES_BASE_PATH=/<repo>` so project-site asset paths
   resolve. One-time: repo **Settings → Pages → Source: GitHub Actions**.
2. No server tier exists here, so the explainer uses the opt-in on-device tier (WebLLM,
   desktop only) or the deterministic text. The core app is fully functional.

---

## What runs where

| Tier | Needs | Cost |
|------|-------|------|
| Rules + profiler + UI | static hosting only | free everywhere |
| Workers AI explainer | Cloudflare Pages + `AI` binding | free (10k neurons/day) |
| On-device explainer | `@mlc-ai/web-llm` + a WebGPU browser | free (one-time ~1–2 GB model download) |

The app degrades gracefully down this list, automatically, with no user action.
