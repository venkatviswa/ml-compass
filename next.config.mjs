/** @type {import('next').NextConfig} */
// Static export: `next build` emits a fully static ./out you can host anywhere
// (Cloudflare Pages, GitHub Pages, Netlify, S3). No Node server required — the
// rules engine and profiler run in the browser.
//
// The optional LLM explainer still works on a static host: the Workers AI tier
// needs a Cloudflare Pages Function (see /functions), and the on-device tier
// (WebLLM) runs entirely client-side, so even a pure static deploy gets explanations.
const nextConfig = {
  output: "export",
  images: { unoptimized: true },   // next/image needs this in export mode
  reactStrictMode: true,
  // Deploying to a GitHub Pages *project* site (username.github.io/ml-compass),
  // so asset paths must be prefixed with the repo name:
  basePath: "/ml-compass",
  assetPrefix: "/ml-compass/",
};
export default nextConfig;
