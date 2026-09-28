import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { resolveTarget } from "./config/deploy-targets.ts";

/**
 * Deployment base path.
 *
 * The base is NOT read from a hand-set environment variable in
 * normal use. `npm run build:pages` and `npm run build:worker` set
 * `QV_TARGET`, and this config resolves the base from the shared
 * target table in `config/deploy-targets.mjs`:
 *
 *   GitHub Pages  ->  /queryvanta/
 *   Cloudflare    ->  /
 *
 * `QV_BASE` is still honoured so an ad-hoc override remains
 * possible, but the repository's supported entry points are the
 * npm scripts, which also record the target in `.qv-build.json`
 * and run `scripts/verify-build.mjs` afterwards.
 */
const target = resolveTarget(process.env.QV_TARGET);

const base = process.env.QV_BASE ?? target.base;

if (!base.startsWith("/") || !base.endsWith("/")) {
  throw new Error(
    `QV_BASE must start and end with "/" (received "${base}")`,
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite rewrites built asset URLs (JS/CSS/WASM) and
  // import.meta.env.BASE_URL with this prefix. Local `vite dev`
  // is unaffected (it serves from root).
  base,
  server: {
    // Required for the PySpark browser proof-of-concept
    // (/pyspark-test): SharedArrayBuffer (the
    // pyspark-connect-web blocking bridge) is only available when
    // the page is cross-origin isolated. Local dev only; the Worker
    // sets the equivalent headers in production, while GitHub Pages
    // cannot (documented limitation).
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
