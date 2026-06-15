# Deploying ML Compass

ML Compass is a **static, client-side app** (the rules engine and profiler run in the
browser). So hosting is free almost anywhere. The only optional server piece is the
Workers AI explainer proxy in `functions/` — and even without it, the explainer still
works via the on-device (WebLLM) tier or falls back to the deterministic text.

## Project setup (once)

```bash
npx create-next-app@latest ml-compass     # TypeScript: No · Tailwind: Yes · App Router: Yes
cd ml-compass
npm install papaparse lucide-react
npm install @mlc-ai/web-llm               # OPTIONAL — enables the on-device explainer tier
```

Copy the project files into place:

```
app/
  page.js              → import MLCompass from "./MLCompass"; export default ...
  MLCompass.jsx        ("use client"; as the first line)
  rules.mjs
  profiler.mjs
  explainer.mjs        (optional explainer)
functions/
  api/explain.js       (optional Workers AI proxy — Cloudflare only)
next.config.mjs        (output: "export")
```

`app/page.js`:

```jsx
import MLCompass from "./MLCompass";
export default function Home() { return <MLCompass />; }
```

Build the static site:

```bash
npm run build      # with output:"export", emits ./out
```

---

## Option A — Cloudflare Pages  (recommended: free, commercial-OK, unlimited bandwidth, runs the Workers AI tier)

1. Push the repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings:
   - **Framework preset:** Next.js (Static HTML Export) — or "None"
   - **Build command:** `npm run build`
   - **Build output directory:** `out`
4. Deploy. The top-level `functions/` directory is picked up automatically, so
   `POST /api/explain` is live.
5. **To enable the Workers AI explainer** (free): project → **Settings → Functions →
   Bindings → Add → AI**, name it `AI`. No API key needed. Free tier is
   10,000 neurons/day; when exhausted, the app transparently switches to the on-device
   tier (if WebLLM is installed) and then to the deterministic text.
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

## Option C — GitHub Pages  (pure static, zero server)

1. Set `basePath`/`assetPrefix` in `next.config.mjs` to your repo name (see the comments there).
2. `npm run build`, then publish the `out/` directory (e.g. via the `actions/deploy-pages` workflow).
3. No server tier exists here, so the explainer uses the on-device tier (WebLLM) or the
   deterministic text. The core app is fully functional.

---

## What runs where

| Tier | Needs | Cost |
|------|-------|------|
| Rules + profiler + UI | static hosting only | free everywhere |
| Workers AI explainer | Cloudflare Pages + `AI` binding | free (10k neurons/day) |
| On-device explainer | `@mlc-ai/web-llm` + a WebGPU browser | free (one-time ~1–2 GB model download) |

The app degrades gracefully down this list, automatically, with no user action.
