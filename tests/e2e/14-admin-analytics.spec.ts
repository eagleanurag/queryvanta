import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  attachCollectors,
  gotoPath,
  pageText,
  resetStorage,
} from "./helpers";

/**
 * ADMIN ANALYTICS PAGE (task 5.3)
 *
 * Covers the two things the server suite structurally cannot: that the
 * page actually RENDERS for an administrator, and that it is USABLE at the
 * mobile viewport width. Authorization, cache policy, range clamping and
 * the empty-data envelope are all covered in
 * `server/tests/admin-analytics.test.ts` against the real Worker.
 *
 * This suite needs the real Worker with a real administrator session, so it
 * cannot run against the Vite dev server or against production GitHub
 * Pages, neither of which has a backend. Start the environment first:
 *   $env:QV_BASE = "/"; npm run build
 *   node --experimental-strip-types server/tests/admin-env.ts up
 */

type AdminEnv = {
  origin: string;
  cookieName: string;
  cookieValue: string;
  csrfToken: string;
  adminId: string;
};

const INFO_PATH = join(
  process.cwd(),
  "server",
  "tests",
  ".admin-env.json",
);

let SEED: AdminEnv | null = null;

try {
  SEED = JSON.parse(
    readFileSync(INFO_PATH, "utf8"),
  ) as AdminEnv;
} catch {
  SEED = null;
}

const targetBase =
  process.env.QV_BASE_URL ??
  "http://localhost:5173/queryvanta/";

const skipReason =
  SEED === null
    ? "admin-env not started. Run: " +
      "$env:QV_BASE='/'; npm run build; " +
      "node --experimental-strip-types server/tests/admin-env.ts up"
    : !targetBase.startsWith(SEED.origin)
      ? `This suite must target the admin-env Worker at ${SEED.origin}`
      : false;

/** Today in UTC, matching the ingest endpoint's date basis. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Visible text of the RESULTS region only.
 *
 * The filter panel lists every event name, so any whole-page text
 * assertion about which events are present would match the dropdown and
 * would pass even with zero results rendered.
 */
async function resultsText(
  page: import("@playwright/test").Page,
): Promise<string> {
  const region = page
    .locator('section[aria-label="Analytics by event"]')
    .first();

  if ((await region.count()) === 0) {
    return "";
  }

  return (await region.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * The count shown for one dimension inside the results region.
 *
 * Each dimension renders as `<label> <value> <count>`, so matching the
 * label and value together attributes the number to the right dimension
 * rather than to whichever number happens to follow a matching word
 * elsewhere on the page.
 */
function dimensionCount(
  results: string,
  label: string,
  value: string,
): number {
  const match = new RegExp(
    `${label} ${value} ([\\d,]+)`,
  ).exec(results);

  if (match === null) {
    return 0;
  }

  return Number((match[1] as string).replace(/,/g, ""));
}

/**
 * The total shown on an event card.
 *
 * An event card renders its heading followed immediately by the total, so
 * this needs its own pattern rather than reusing `dimensionCount`.
 */
function eventTotal(results: string, label: string): number {
  const match = new RegExp(
    `${label} ([\\d,]+)`,
  ).exec(results);

  if (match === null) {
    return 0;
  }

  return Number((match[1] as string).replace(/,/g, ""));
}

/**
 * Seed analytics through the REAL public ingest endpoint.
 *
 * Going through ingest rather than writing to D1 directly means the page
 * is exercised against data that arrived the way production data arrives,
 * so a bug in the aggregation shape would surface here rather than being
 * hidden by a hand-written fixture.
 */
async function seedAnalytics(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  const date = todayUtc();

  const response = await request.post(
    "/api/analytics/events",
    {
      headers: {
        // The ingest endpoint's same-origin check accepts an exact Origin
        // match as well as Sec-Fetch-Site, and an APIRequestContext cannot
        // set the forbidden Sec-Fetch-Site header.
        Origin: SEED?.origin ?? "",
        "Content-Type": "application/json",
      },
      data: {
        events: [
          { d: date, e: "page_viewed", p: { page_kind: "discover" } },
          { d: date, e: "page_viewed", p: { page_kind: "discover" } },
          { d: date, e: "page_viewed", p: { page_kind: "question" } },
          {
            d: date,
            e: "question_submitted",
            p: {
              engine: "SQL",
              difficulty: "Easy",
              outcome: "correct",
            },
          },
          { d: date, e: "interview_started", p: { engine: "PySpark" } },
        ],
      },
    },
  );

  expect(
    response.status(),
    "analytics ingest must accept the seed batch",
  ).toBe(200);
}

test.describe("ADMIN ANALYTICS PAGE", () => {
  test.use({ baseURL: SEED?.origin ?? targetBase });
  test.skip(
    skipReason !== false,
    skipReason === false ? "" : skipReason,
  );

  test.beforeEach(async ({ context, request }) => {
    await context.addCookies([
      {
        name: SEED?.cookieName ?? "",
        value: SEED?.cookieValue ?? "",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await seedAnalytics(request);
  });

  test("A. the page renders for an administrator with real data", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);

    await gotoPath(page, "admin/analytics");
    await page.waitForTimeout(1500);

    // The gate must have been satisfied, so the real page is present.
    await expect(
      page.getByRole("heading", { name: "Analytics" }),
    ).toBeVisible();

    // The seeded events appear as readable summaries. Assertions are
    // scoped to the results region: the event FILTER dropdown also
    // contains every event name, so a whole-page text match would pass
    // even if no results rendered at all.
    const results = await resultsText(page);

    expect(results).toMatch(/Page viewed/);
    expect(results).toMatch(/Question submitted/);
    expect(results).toMatch(/Interview started/);

    // Dimension values are present and non-zero. An absolute count is not
    // assertable here: the D1 database is shared across tests, so
    // beforeEach has already seeded several times, AND the 5.2 client
    // collector genuinely reports a real `page_viewed` for the "/" page
    // this test navigates to. Both are correct behaviour; neither is
    // something to pin a fixed number to.
    const discover = dimensionCount(
      results,
      "Page",
      "discover",
    );
    const question = dimensionCount(
      results,
      "Page",
      "question",
    );

    expect(discover).toBeGreaterThan(0);
    expect(question).toBeGreaterThan(0);

    // The invariant that IS stable: an event's displayed total is at
    // least the sum of its dimensions, because the total row counts every
    // event of that name including ones with no dimension recorded.
    const total = eventTotal(results, "Page viewed");

    expect(total).toBeGreaterThanOrEqual(
      discover + question,
    );

    // Dimension values are shown with readable labels, not wire keys.
    expect(results).not.toMatch(/page_kind/);
    expect(results).not.toMatch(/bucketDate|propKey|propValue/);

    expect(collector.pageErrors).toEqual([]);
  });

  test("B. the privacy position is stated on the page", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/analytics");
    await page.waitForTimeout(1200);

    const text = await pageText(page);

    // The page must not imply that individuals are tracked.
    expect(text).toMatch(/Anonymous/i);
    expect(text).toMatch(/No\s*visitor is identified/i);
  });

  test("C. every filter control is explicitly labelled", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/analytics");
    await page.waitForTimeout(1200);

    // An unlabelled control is the known accessibility gap in this
    // repository, so each control must resolve to a real label.
    for (
      const [label, role] of [
        ["From", "textbox"],
        ["To", "textbox"],
        ["Event", "combobox"],
      ] as const
    ) {
      await expect(
        page.getByLabel(label, { exact: true }),
      ).toHaveCount(1, `"${label}" must label exactly one control`);

      void role;
    }

    // No control may be left with an empty accessible name.
    const unnamed = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll("input, select"),
      );

      return controls
        .filter((element) => {
          const id = element.getAttribute("id");

          if (id === null) {
            return true;
          }

          const label = document.querySelector(
            `label[for="${CSS.escape(id)}"]`,
          );

          return (
            label === null ||
            (label.textContent ?? "").trim() === ""
          );
        })
        .map((element) => element.outerHTML.slice(0, 80));
    });

    expect(unnamed).toEqual([]);
  });

  test("D. the event filter narrows the results", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/analytics");
    await page.waitForTimeout(1500);

    const before = await resultsText(page);

    expect(before).toMatch(/Page viewed/);
    expect(before).toMatch(/Interview started/);

    await page
      .getByLabel("Event", { exact: true })
      .selectOption("interview_started");
    await page.waitForTimeout(1200);

    // Scoped to the results region: the dropdown keeps listing every
    // event name, so only the rendered results can show the filter working.
    const after = await resultsText(page);

    expect(after).toMatch(/Interview started/);
    expect(after).not.toMatch(/Page viewed/);
    expect(after).not.toMatch(/Question submitted/);
  });

  test("E. the page does not overflow horizontally at the mobile viewport", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/analytics");
    await page.waitForTimeout(1500);

    const size = page.viewportSize();

    if (!size || size.width >= 1024) {
      // The desktop project. The mobile project covers the narrow case;
      // skipping here keeps the assertion meaningful rather than vacuous.
      test.skip(
        true,
        "horizontal-overflow assertion applies to the mobile viewport",
      );

      return;
    }

    // No horizontal scrolling at 390px.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));

    expect(
      overflow.scrollWidth,
      "the page must not scroll horizontally at the mobile viewport",
    ).toBeLessThanOrEqual(overflow.innerWidth + 1);

    // The controls must remain reachable and usable, not merely present.
    for (const label of ["From", "To", "Event"]) {
      const control = page.getByLabel(label, {
        exact: true,
      });

      await expect(control).toBeVisible();

      const box = await control.boundingBox();

      expect(
        box,
        `"${label}" must have a layout box`,
      ).not.toBeNull();

      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `"${label}" must fit within the viewport`,
      ).toBeLessThanOrEqual(size.width + 1);
    }
  });

  test("F. the route is gated without an administrator session", async ({
    browser,
  }) => {
    // A fresh context with no cookie at all.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${SEED?.origin ?? ""}/admin/analytics`);
    await page.waitForTimeout(2500);

    const text = await pageText(page);

    expect(text).toMatch(
      /Administrator access required|Administrator sign-in/,
    );

    // The analytics content must not be rendered at all.
    await expect(
      page.getByRole("heading", { name: "Analytics" }),
    ).toHaveCount(0);

    await context.close();
  });
});
