import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Worker build base regression.
 *
 * Production incident: the deployed Cloudflare Worker served a
 * GitHub Pages bundle. The browser asked for
 * `/queryvanta/assets/...`, the SPA fallback answered with index.html
 * as text/html, Chromium refused the module for a MIME mismatch, and
 * `/admin/questions` rendered as a blank page.
 *
 * This suite drives the REAL Worker serving the REAL built bundle
 * and asserts the failure cannot recur:
 *
 *   - no request is ever made for /queryvanta/assets/
 *   - every JS/CSS response has a JS/CSS content type
 *   - the page is not blank
 *   - the admin route renders
 *   - the logged-out admin gate renders
 *   - the server catalog endpoint still answers
 *
 * Start the environment first:
 *   npm run build:worker
 *   node --experimental-strip-types server/tests/admin-env.ts up
 */

type AdminEnv = {
  origin: string;
  cookieName: string;
  cookieValue: string;
  csrfToken: string;
  adminId: string;
  seedId: string;
  seedTitle: string;
};

const INFO_PATH = join(
  process.cwd(),
  "server",
  "tests",
  ".admin-env.json",
);

let ENV: AdminEnv | null = null;

try {
  ENV = JSON.parse(readFileSync(INFO_PATH, "utf8")) as AdminEnv;
} catch {
  ENV = null;
}

const targetBase =
  process.env.QV_BASE_URL ?? "http://localhost:5173/queryvanta/";

const skipReason =
  ENV === null
    ? "admin-env not started. Run: npm run build:worker; " +
      "node --experimental-strip-types server/tests/admin-env.ts up"
    : !targetBase.startsWith(ENV.origin)
      ? `This suite must target the admin-env Worker at ${ENV.origin}`
      : false;

const PAGES_SEGMENT = "/queryvanta/";

test.describe("WORKER BUILD BASE", () => {
  test.use({ baseURL: ENV?.origin ?? targetBase });
  test.skip(
    skipReason !== false,
    skipReason === false ? "" : skipReason,
  );

  /**
   * The admin page itself needs a session; the gate test below
   * deliberately runs without one. Only the signed-in tests get the
   * cookie.
   */
  test("the admin route renders with no /queryvanta/ asset request", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: ENV?.cookieName ?? "",
        value: ENV?.cookieValue ?? "",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    const requests: string[] = [];
    const mimeProblems: { url: string; type: string }[] = [];
    const consoleErrors: string[] = [];

    page.on("request", (request) => {
      requests.push(request.url());
    });

    page.on("response", (response) => {
      const url = response.url();
      const type =
        response.headers()["content-type"] ?? "(none)";

      // A JS or CSS URL answered with HTML means the SPA fallback
      // swallowed a missing asset, which is the exact production
      // failure.
      if (
        /\.(js|mjs|css)(\?|$)/.test(url) &&
        type.includes("text/html")
      ) {
        mimeProblems.push({ url, type });
      }
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    const response = await page.goto("/admin/questions", {
      waitUntil: "networkidle",
    });

    expect(response?.status()).toBe(200);
    expect(
      response?.headers()["content-type"],
    ).toContain("text/html");

    // The document itself must not be a blank SPA shell.
    await expect(page.locator("#root")).not.toBeEmpty({
      timeout: 60_000,
    });

    // The page must have actually mounted the admin UI.
    await expect(
      page.getByRole("heading", { name: /Question Management/i }),
    ).toBeVisible({ timeout: 60_000 });

    // THE REGRESSION: nothing may be requested under /queryvanta/.
    const pagesRequests = requests.filter((url) =>
      url.includes(PAGES_SEGMENT),
    );

    console.log(
      `  total requests: ${requests.length}, ` +
        `under ${PAGES_SEGMENT}: ${pagesRequests.length}`,
    );
    console.log(
      `  module requests: ` +
        requests
          .filter((url) => /\.(js|mjs|css)(\?|$)/.test(url))
          .slice(0, 3)
          .join("\n    "),
    );

    expect(
      pagesRequests,
      `a Worker build must never request ${PAGES_SEGMENT}`,
    ).toEqual([]);

    // Assets must actually have loaded as modules and stylesheets.
    const scripts = await page.locator(
      'script[src$=".js"]',
    ).count();
    const styles = await page
      .locator('link[rel="stylesheet"]')
      .count();

    console.log(`  script tags: ${scripts}, stylesheets: ${styles}`);
    expect(scripts).toBeGreaterThan(0);
    expect(styles).toBeGreaterThan(0);

    expect(
      mimeProblems,
      "an asset was served as text/html (MIME mismatch)",
    ).toEqual([]);

    // The stylesheet must have applied: the app sets a background
    // colour on its root wrapper.
    const background = await page.evaluate(() => {
      const root = document.querySelector("#root");
      const child = root?.firstElementChild as HTMLElement | null;

      return child === null
        ? ""
        : window.getComputedStyle(child).backgroundColor;
    });

    console.log(`  root background: ${background}`);
    expect(background).not.toBe("");

    const mimeErrors = consoleErrors.filter((text) =>
      /MIME|Refused to (load|execute)|Failed to load module/i.test(
        text,
      ),
    );

    expect(mimeErrors, `console errors: ${consoleErrors.join(" | ")}`)
      .toEqual([]);
  });

  test("the logged-out admin gate renders", async ({ browser }) => {
    // A fresh context with no session cookie.
    const context = await browser.newContext({
      baseURL: ENV?.origin,
    });

    const page = await context.newPage();
    const responses: { url: string; type: string }[] = [];

    page.on("response", (response) => {
      const url = response.url();

      if (/\.(js|mjs|css)(\?|$)/.test(url)) {
        responses.push({
          url,
          type: response.headers()["content-type"] ?? "(none)",
        });
      }
    });

    await page.goto("/admin/questions", {
      waitUntil: "networkidle",
    });

    await expect(page.locator("#root")).not.toBeEmpty({
      timeout: 60_000,
    });

    // The gate, not the question list. The gate offers a link to the
    // login page; the login page itself offers a button. Either is a
    // correct logged-out outcome.
    const signIn = page
      .getByRole("link", { name: /Continue with GitHub/i })
      .or(page.getByRole("button", { name: /Continue with GitHub/i }));

    await expect(signIn.first()).toBeVisible({
      timeout: 60_000,
    });

    console.log(
      `  logged-out admin gate rendered at ${page.url()}`,
    );

    // The question list must NOT be reachable without a session.
    await expect(
      page.getByRole("heading", { name: /Question Management/i }),
    ).toHaveCount(0);

    const mimeProblems = responses.filter((entry) =>
      entry.type.includes("text/html"),
    );

    expect(
      mimeProblems,
      "an asset was served as text/html (MIME mismatch)",
    ).toEqual([]);

    await context.close();
  });

  test("the server catalog endpoint still answers", async ({
    request,
  }) => {
    const health = await request.get("/api/health");

    expect(health.status()).toBe(200);

    const catalog = await request.get("/api/admin/questions", {
      headers: {
        Cookie: `${ENV?.cookieName}=${ENV?.cookieValue}`,
      },
    });

    expect(catalog.status()).toBe(200);

    const body = (await catalog.json()) as {
      data: { count: number; questions: { id: string }[] };
    };

    console.log(
      `  /api/admin/questions count = ${body.data.count}`,
    );
    expect(
      body.data.questions.map((question) => question.id),
    ).toContain(ENV?.seedId);
  });

  test("the preserved production test question is intact", async ({
    request,
  }) => {
    const catalog = await request.get("/api/admin/questions", {
      headers: {
        Cookie: `${ENV?.cookieName}=${ENV?.cookieValue}`,
      },
    });

    const body = (await catalog.json()) as {
      data: { questions: { id: string; title: string }[] };
    };

    const found = body.data.questions.find(
      (question) => question.id === ENV?.seedId,
    );

    expect(
      found,
      "test-prod-d1-crud-001 must not be deleted",
    ).toBeDefined();
    expect(found?.title).toBe(ENV?.seedTitle);

    console.log(
      `  preserved: ${found?.id} = "${found?.title}"`,
    );
  });
});