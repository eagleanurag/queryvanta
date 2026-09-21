import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
