import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Project-Pages deployment target:
  // https://eagleanurag.github.io/queryvanta/
  // Vite rewrites built asset URLs (JS/CSS/WASM) and
  // import.meta.env.BASE_URL with this prefix. Local
  // `vite dev` is unaffected (it serves from root).
  base: "/queryvanta/",
  server: {
    // Required for the PySpark browser proof-of-concept (/pyspark-test):
    // SharedArrayBuffer (the pyspark-connect-web blocking bridge) is only
    // available when the page is cross-origin isolated. Local dev only;
    // production hosting headers are handled separately.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
