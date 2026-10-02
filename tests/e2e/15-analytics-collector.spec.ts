import { expect, test, type Page } from "@playwright/test";

import {
  attachCollectors,
  expectNoAppErrors,
  gotoPath,
  openNavIfNeeded,
} from "./helpers";

/**
 * Analytics collector - backend availability (regression for F-01).
 *
 * THE DEFECT
 * ----------
 * The collector posted to `api/analytics/events` unconditionally. The
 * GitHub Pages deployment is static and serves no `/api/*`, so on the
 * Pages origin and on the Vite dev server that POST 404s. A failed
 * request is not silent: the browser logs a console error for it, which
 * is what broke four tests in `07-practice-bookmarks` via
 * `expectNoAppErrors`.
 *
 * THE FIX
 * -------
 * The collector now asks `probeApi()` whether a backend exists, once per
 * runtime, and suppresses permanently when the answer is no.
 *
 * WHAT THIS PROVES
 * ----------------
 *   A. backend present   -> the event is posted and accepted
 *   B. backend absent    -> no POST is ever made to the missing endpoint
 *   C. probing is bounded -> exactly one probe, shared, never per event
 *   D. the app is unaffected either way
 *
 * The suite adapts to whichever origin it is pointed at, so the same
 * file proves the available case against `admin-env` and the unavailable
 * case against the dev server / Pages:
 *
 *   API present :  npm run build:worker
 *                  node --experimental-strip-types server/tests/admin-env.ts up
 *                  QV_BASE_URL=http://127.0.0.1:<port>/
 *
 *   API absent  :  npm run dev -- --port 5173 --strictPort
 *                  QV_BASE_URL=http://localhost:5173/queryvanta/
 */

/**
 * Must outlast `FLUSH_INTERVAL_MS` (15s) in the client, or the assertion
 * "no POST happened" would pass simply because the flush had not fired
 * yet.
 */
const PAST_ONE_FLUSH_MS = 20_000;

const targetBase =
  process.env.QV_BASE_URL ?? "http://localhost:5173/queryvanta/";

/**
 * Ask, from the test process, whether the target origin has an API.
 *
 * Uses the same signal the client does: a JSON response from
 * `api/health`. A static host answers with HTML, which is what
 * `readEnvelope` calls `no_backend`.
 */
async function originHasApi(): Promise<boolean> {
  try {
    const response = await fetch(new URL("api/health", targetBase), {
      headers: { Accept: "application/json" },
    });

    const contentType = response.headers.get("Content-Type") ?? "";

    return response.ok && contentType.includes("application/json");
  } catch {
    return false;
  }
}

const HAS_API = await originHasApi();

type NetLog = {
  probes: string[];
  posts: string[];
};

/**
 * Records analytics traffic so absence can be asserted, not assumed.
 *
 * Only request-side facts live here. Response status is read by awaiting
 * the response where a status is actually needed, which avoids racing a
 * `request` event against its own `response`.
 */
function recordAnalyticsRequests(page: Page): NetLog {
  const log: NetLog = {
    probes: [],
    posts: [],
  };

  page.on("request", (request) => {
    const url = request.url();

    if (!url.includes("/api/")) {
      return;
    }

    if (url.includes("/api/analytics/events")) {
      log.posts.push(`${request.method()} ${url}`);
      return;
    }

    if (url.includes("/api/health")) {
      log.probes.push(`${request.method()} ${url}`);
    }
  });

  return log;
}

/**
 * Visits several base-relative routes so the collector sees many events.
 *
 * Navigates by URL, so the mobile navigation drawer is never opened -
 * this is about generating analytics events, not about exercising the nav.
 */
async function visitRoutes(page: Page): Promise<void> {
  for (const path of ["learn", "progress", "sql-practice", "interview"]) {
    await gotoPath(page, path);
    await page.waitForTimeout(250);
  }

  await gotoPath(page, "");
}

test.describe("ANALYTICS COLLECTOR - API UNAVAILABLE", () => {
  test.use({ baseURL: targetBase });
  test.skip(
    HAS_API,
    "This case requires an origin with no backend (GitHub Pages or the dev server)",
  );

  test("B/C. makes no /api request at all, so nothing 404s", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    const log = recordAnalyticsRequests(page);

    await gotoPath(page, "");

    // Enough events to outnumber the single probe, so the assertion below
    // is about sharing one request rather than about there being only
    // one event.
    await visitRoutes(page);

    await page.waitForTimeout(PAST_ONE_FLUSH_MS);

    // B: the ingest endpoint is not called at all.
    expect(
      log.posts,
      "the collector must not POST to a nonexistent ingest endpoint",
    ).toEqual([]);

    // C: and there is no request loop either. The build target already
    // states that this deployment has no API, so a static bundle must
    // not even probe - a probe would itself be a failed request, and a
    // failed request is a console error.
    expect(
      log.probes,
      "a build with no API must not probe at runtime",
    ).toEqual([]);

    // D: and the whole point - no console noise, so the repository's
    // own console-error gate can pass on a static origin.
    expectNoAppErrors(collector, "collector with no backend");
  });

  test("C. a later navigation does not re-probe or resume posting", async ({
    page,
  }) => {
    const log = recordAnalyticsRequests(page);

    await gotoPath(page, "");
    await page.waitForTimeout(PAST_ONE_FLUSH_MS);

    // A fresh navigation in the same tab runtime, plus a second one.
    await gotoPath(page, "learn");
    await page.waitForTimeout(PAST_ONE_FLUSH_MS);
    await gotoPath(page, "progress");
    await page.waitForTimeout(PAST_ONE_FLUSH_MS);

    expect(
      log.probes,
      "a static build must never probe, on any navigation",
    ).toEqual([]);

    expect(
      log.posts,
      "suppression must survive navigation within the same runtime",
    ).toEqual([]);
  });

  test("D. the app renders and navigates with analytics unavailable", async ({
    page,
  }) => {
    const collector = attachCollectors(page);

    await gotoPath(page, "");
    await openNavIfNeeded(page);

    // The primary workflow must not depend on analytics.
    await expect(page.locator("body")).toContainText(/queryvanta/i);

    await gotoPath(page, "learn");
    await expect(page.locator("body")).toContainText(/learn/i);

    await gotoPath(page, "sql-practice");
    await expect(page.locator("body")).toContainText(/sql/i);

    expectNoAppErrors(collector, "app with analytics unavailable");
  });
});

test.describe("ANALYTICS COLLECTOR - API AVAILABLE", () => {
  test.use({ baseURL: targetBase });
  test.skip(
    !HAS_API,
    "This case requires the Worker backend. Start admin-env and point QV_BASE_URL at it.",
  );

  test("A. a route event is posted to the ingest endpoint and accepted", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    const log = recordAnalyticsRequests(page);

    await gotoPath(page, "");

    // The real 15s flush interval is what triggers the POST; there is no
    // test hook for it, and faking one would not prove the shipped path.
    const response = await page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes("/api/analytics/events"),
      { timeout: 40_000 },
    );

    expect(
      response.status(),
      "the ingest endpoint must accept the event",
    ).toBe(200);

    expect(
      log.posts.length,
      "the ingest endpoint must be called",
    ).toBeGreaterThan(0);

    // The Worker must still be confirmed at runtime, once, rather than
    // assumed from the build target.
    expect(
      log.probes.length,
      "a build that expects an API must confirm it exactly once",
    ).toBe(1);

    expectNoAppErrors(collector, "collector with a backend");
  });

  test("D. a question renders normally with analytics enabled", async ({
    page,
  }) => {
    const collector = attachCollectors(page);

    await gotoPath(page, "");
    await expect(page.locator("body")).toContainText(/queryvanta/i);

    expectNoAppErrors(collector, "app with analytics enabled");
  });
});