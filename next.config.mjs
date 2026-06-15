/** @type {import('next').NextConfig} */
// Static export: `next build` emits a fully static ./out hostable anywhere
// (Cloudflare Pages, GitHub Pages, Netlify, S3). No Node server required.
//
// For GitHub Pages PROJECT sites (username.github.io/repo), the path prefix is
// injected at build time via PAGES_BASE_PATH (set by the GitHub Actions workflow),
// so it stays empty for local dev and root-domain hosts like Cloudflare Pages.
const base = process.env.PAGES_BASE_PATH || "";
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  basePath: base,
  assetPrefix: base || undefined,
};
export default nextConfig;
