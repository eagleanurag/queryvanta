import {
  attachCollectors,
  expect,
  expectNoAppErrors,
  gotoPath,
  pageText,
  resetStorage,
  test,
} from "./helpers";

/**
 * Phase 1A.9 / 1A.12 / 1A.13 — practice sessions, bookmarks and
 * session history. Selectors come from the real rendered dialog
 * (size presets are radio buttons, not a select).
 */

type Page = import("@playwright/test").Page;

async function startSession(
  page: Page,
  options: {
    size?:
      | "5 Questions"
      | "10 Questions"
      | "20 Questions"
      | "All Available (35)";
    order?: "Sequential" | "Random";
  } = {},
): Promise<void> {
  await gotoPath(page, "");
  await page
    .getByRole("button", { name: "Start Practice" })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  if (options.size) {
    await dialog
      .getByRole("button", { name: options.size, exact: false })
      .first()
      .click();
  }

  if (options.order === "Random") {
    await dialog.getByRole("radio", { name: /Random/ }).click();
  }

  await dialog
    .getByRole("button", { name: /^Start Practice \(/ })
    .click();

  await expect(page).toHaveURL(/\/practice/);
  await expect(
    page.getByRole("button", { name: /Run Query|Run PySpark/ }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Finishes the session.
 *
 * The Finish control is only rendered on the LAST question, so
 * advance through the session first.
 */
async function finishSession(page: Page): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const finish = page
      .getByRole("button", { name: /Finish practice session|Finish interview/ })
      .first();

    if (await finish.count()) {
      await finish.click();
      break;
    }

    const next = page
      .getByRole("button", { name: "Next session question" })
      .first();

    if (!(await next.count())) {
      break;
    }

    await next.click();
    await page.waitForTimeout(250);
  }

  await expect(
    page.getByText(/Practice Complete|Session Summary|Completed/i).first(),
  ).toBeVisible({ timeout: 30_000 });
}

const readHistoryCount = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem(
      "queryvanta-practice-history",
    );

    if (!raw) {
      return 0;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;

      return Array.isArray(parsed) ? parsed.length : -1;
    } catch {
      return -1;
    }
  });

test.describe("PRACTICE", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
  });

  test("empty practice page has a clear empty state", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "practice");
    await expect(
      page.getByText("No active practice session"),
    ).toBeVisible();
    expectNoAppErrors(collector, "practice empty");
  });

  test("setup dialog exposes size presets and order options", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "");
    await page
      .getByRole("button", { name: "Start Practice" })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      dialog.getByRole("button", { name: /5 Questions/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /20 Questions/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /All Available/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: /Sequential/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: /Random/ }),
    ).toBeVisible();

    expectNoAppErrors(collector, "practice dialog");
  });

  for (const [label, expected] of [
    ["5 Questions", 5],
    ["10 Questions", 10],
    ["20 Questions", 20],
  ] as const) {
    test(`sequential session: ${label}`, async ({ page }) => {
      const collector = attachCollectors(page);
      await startSession(page, { size: label });

      const text = await pageText(page);
      const counter = text.match(/(\d+)\s*of\s*(\d+)/);
      console.log(`session[${label}] counter:`, counter?.[0] ?? "none");

      expect(counter).not.toBeNull();
      expect(Number(counter![1])).toBe(1);
      expect(Number(counter![2])).toBe(expected);

      expectNoAppErrors(collector, `practice ${label}`);
    });
  }

  test("all-available session uses the full catalog", async ({ page }) => {
    await startSession(page, { size: "All Available (35)" });

    const text = await pageText(page);
    const counter = text.match(/(\d+)\s*of\s*(\d+)/);
    console.log("all-available counter:", counter?.[0] ?? "none");
    expect(Number(counter![2])).toBe(35);
  });

  test("random mode is recorded in session state", async ({ page }) => {
    const collector = attachCollectors(page);
    await startSession(page, { size: "5 Questions", order: "Random" });

    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );

    expect(stored).toBeTruthy();
    expect(stored).toContain("random");

    expectNoAppErrors(collector, "practice random");
  });

  test("session survives refresh and can finish", async ({ page }) => {
    const collector = attachCollectors(page);
    await startSession(page, { size: "5 Questions" });

    await page.reload();
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });

    // Session still intact after reload.
    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(stored).toContain("active");

    await finishSession(page);
    expectNoAppErrors(collector, "practice resume+finish");
  });

  test("duplicate finish does not create a second history entry", async ({
    page,
  }) => {
    await startSession(page, { size: "5 Questions" });
    await finishSession(page);

    const first = await readHistoryCount(page);
    console.log("history entries after 1st finish:", first);
    expect(first).toBe(1);

    // Revisit the finished session and attempt another finish.
    await gotoPath(page, "practice");
    await page.waitForTimeout(1000);

    const secondFinish = page
      .getByRole("button", {
        name: /Finish practice session|Finish interview/,
      })
      .first();

    if (await secondFinish.count()) {
      await secondFinish.click().catch(() => undefined);
    }
    await page.waitForTimeout(2000);

    const second = await readHistoryCount(page);
    console.log("history entries after 2nd attempt:", second);
    expect(second).toBe(first);
  });
});

test.describe("BOOKMARKS", () => {
  test("bookmark toggles, persists and filters", async ({ page }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);
    await gotoPath(page, "");

    const KEY = "queryvanta-bookmarked-questions";

    // A card is a wrapper div holding the question link and a
    // sibling bookmark button.
    const card = page
      .locator('a[href*="/question/"]')
      .first()
      .locator("xpath=..");
    await expect(card).toBeVisible();

    await card
      .getByRole("button", { name: "Bookmark question" })
      .first()
      .click();

    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      KEY,
    );
    expect(stored).toBeTruthy();
    const ids = JSON.parse(stored!) as string[];
    expect(ids.length).toBe(1);
    console.log("bookmarked id:", ids[0]);

    await page.reload();
    const afterReload = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      KEY,
    );
    expect(afterReload).toBe(stored);

    // Bookmarked-only filter.
    await page
      .getByRole("button", { name: /^Bookmarks/ })
      .click();
    await expect(
      page.getByText(/Showing 1 of 35 questions/),
    ).toBeVisible();

    // Leave the filter and remove the bookmark.
    await page
      .getByRole("button", { name: /^Bookmarks/ })
      .click();
    await expect(
      page.getByText("Showing 35 of 35 questions"),
    ).toBeVisible();

    await page
      .locator('a[href*="/question/"]')
      .first()
      .locator("xpath=..")
      .getByRole("button", { name: /Bookmark question|Remove bookmark/ })
      .first()
      .click();

    await page.waitForTimeout(500);
    const cleared = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      KEY,
    );
    console.log("bookmarks after removal:", cleared);
    expect(cleared === null || cleared === "[]").toBe(true);

    expectNoAppErrors(collector, "bookmarks");
  });
});

test.describe("HISTORY", () => {
  test("completed session appears in history", async ({ page }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);
    await startSession(page, { size: "5 Questions" });
    await finishSession(page);

    const text = await pageText(page);

    // The finish screen shows the factual session review.
    expect(text).toMatch(/Practice Complete/);
    expect(text).toMatch(/Session Review/);
    expect(text).toMatch(/5 Questions . 0 Completed . 5 Not Completed/);

    const entries = await page.evaluate(() => {
      const raw = window.localStorage.getItem(
        "queryvanta-practice-history",
      );

      if (!raw) {
        return [];
      }

      try {
        return JSON.parse(raw) as unknown[];
      } catch {
        return [];
      }
    });

    expect(entries.length).toBe(1);

    const first = entries[0] as Record<string, unknown>;
    console.log(
      "history entry fields:",
      JSON.stringify(Object.keys(first)),
    );

    // Origin metadata must be recorded.
    expect(first).toHaveProperty("origin");
    expect(first).toHaveProperty("startedAt");

    expectNoAppErrors(collector, "history");
  });
});
