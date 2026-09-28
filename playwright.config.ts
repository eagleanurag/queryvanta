import { defineConfig, devices } from "@playwright/test";

/**
 * QueryVanta browser test configuration.
 *
 * Targets are driven by env vars so the same suite can run
 * against local dev, a local Worker build, or production:
 *   QV_BASE_URL  (default: http://localhost:5173/queryvanta/)
 *   QV_PROD_URL  (default: https://eagleanurag.github.io/queryvanta/)
 *
 * The base URL must keep its trailing slash and every test must
 * navigate with BASE-RELATIVE paths ("learn", not "/learn").
 * A leading slash would be resolved against the origin and
 * silently drop the /queryvanta base segment.
 *
 * No secrets are read here. Administrative session tests
 * obtain their session through the server-issued HttpOnly
 * cookie flow only.
 */
const baseURL =
  process.env.QV_BASE_URL ??
  "http://localhost:5173/queryvanta/";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Chromium at a 390x844 mobile viewport. `devices["iPhone 13"]`
      // would pull in WebKit, which is not installed and is not
      // the target browser for this audit.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
          "Version/17.0 Mobile/15E148 Safari/604.1",
      },
    },
  ],
});
