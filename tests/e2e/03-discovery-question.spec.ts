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
 * Phase 1A.4 / 1A.5 — question discovery and question detail.
 */

test.describe("QUESTION DISCOVERY", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "");
  });

  test("search filters and count updates", async ({ page }) => {
    await expect(page.getByText("Showing 35 of 35 questions")).toBeVisible();

    await page
      .getByPlaceholder("Search questions...")
      .fill("join");

    await expect(
      page.getByText(/Showing \d+ of 35 questions/),
    ).toBeVisible();

    const count = await page.getByText(/Showing \d+ of 35 questions/)
      .innerText();
    const shown = Number(count.match(/Showing (\d+)/)![1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(35);
  });

  test("search is reflected in the URL and clearing restores", async ({ page }) => {
    await page.getByPlaceholder("Search questions...").fill("window");
    await page.waitForURL(/q=/);
    expect(page.url()).toContain("q=window");

    await page.getByLabel("Clear search").click();
    await expect(page.getByText("Showing 35 of 35 questions")).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);
  });

  test("difficulty filter narrows results", async ({ page }) => {
    // The discovery filter selects carry no accessible name
    // (recorded as an accessibility finding), so they are
    // addressed by their option set.
    const difficulty = page
      .locator("select")
      .filter({ hasText: "Medium" })
      .first();

    await difficulty.selectOption("Medium");
    await page.waitForURL(/difficulty=Medium/);

    const body = await pageText(page);
    const shown = Number(
      (body.match(/Showing (\d+)/) ?? [])[1] ?? "0",
    );
    console.log("difficulty=Medium shown:", shown);

    expect(shown).toBe(14);
    expect(body).toMatch(/Showing 14 of 35 questions/);
  });

  test("engine (question type) filter narrows results", async ({ page }) => {
    const typeSelect = page
      .locator("select")
      .filter({ hasText: "PySpark" })
      .first();

    await typeSelect.selectOption("PySpark");
    await page.waitForURL(/type=PySpark/);

    const body = await pageText(page);
    const shown = Number(
      (body.match(/Showing (\d+)/) ?? [])[1] ?? "0",
    );
    console.log("questionType=PySpark shown:", shown);

    expect(shown).toBe(11);
    expect(body).toMatch(/Showing 11 of 35 questions/);
  });

  test("category filter narrows results", async ({ page }) => {
    const category = page
      .locator("select")
      .filter({ hasText: "Window Functions" })
      .first();

    await category.selectOption("Window Functions");
    await page.waitForURL(/category=/);

    const body = await pageText(page);
    const shown = Number(
      (body.match(/Showing (\d+)/) ?? [])[1] ?? "0",
    );
    console.log("category=Window Functions shown:", shown);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(35);
  });

  test("filters combine and clear", async ({ page }) => {
    await page
      .locator("select")
      .filter({ hasText: "PySpark" })
      .first()
      .selectOption("PySpark");
    await page
      .locator("select")
      .filter({ hasText: "Medium" })
      .first()
      .selectOption("Medium");

    await page.waitForTimeout(600);
    const body = await pageText(page);
    const shown = Number(
      (body.match(/Showing (\d+)/) ?? [])[1] ?? "0",
    );
    console.log("PySpark+Medium shown:", shown);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(11);

    // Reset to all.
    await page
      .locator("select")
      .filter({ hasText: "PySpark" })
      .first()
      .selectOption("All");
    await page
      .locator("select")
      .filter({ hasText: "Medium" })
      .first()
      .selectOption("All");

    await expect(
      page.getByText("Showing 35 of 35 questions"),
    ).toBeVisible();
  });

  test("result navigation reaches a question and prev/next works", async ({ page }) => {
    const collector = attachCollectors(page);

    await page.getByPlaceholder("Search questions...").fill("join");
    await expect(
      page.getByText(/Showing \d+ of 35 questions/),
    ).toBeVisible();

    await page
      .locator('a[href*="/question/"]')
      .first()
      .click();

    await expect(page).toHaveURL(/\/question\/.+/);
    await expect(page.getByText("Run Query")).toBeVisible();

    // Breadcrumbs present on a public question page.
    await expect(page.getByLabel("Breadcrumb")).toBeVisible();

    // Related questions exist and are crawlable.
    const related = page.getByLabel("Related questions");
    await expect(related).toBeVisible();
    expect(
      await related.locator('a[href*="/question/"]').count(),
    ).toBeGreaterThanOrEqual(3);

    // Next navigation is available for a multi-result set.
    const next = page.getByLabel("Next question");
    if (await next.isVisible()) {
      const before = page.url();
      await next.click();
      await expect(page).toHaveURL(/\/question\/.+/);
      expect(page.url()).not.toBe(before);
    }

    expectNoAppErrors(collector, "discovery nav");
  });
});

test.describe("QUESTION DETAIL — SQL", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "question/high-engagement-video-filtering");
  });

  test("prompt, metadata, hints, solution render", async ({ page }) => {
    const collector = attachCollectors(page);

    await expect(
      page.getByRole("heading", {
        name: "High-Engagement Video Filtering",
      }),
    ).toBeVisible();

    await expect(page.getByText("Easy").first()).toBeVisible();
    await expect(page.getByText("Filtering").first()).toBeVisible();
    await expect(page.getByText("Run Query")).toBeVisible();

    // Hints are hidden until requested.
    const showHint = page.getByRole("button", { name: /Show Hint/i });
    if (await showHint.isVisible()) {
      await showHint.click();
      await expect(page.getByText(/Filter rows with WHERE/)).toBeVisible();
    }

    // Solution + explanation hidden until requested.
    const showSolution = page.getByRole("button", {
      name: /Show Solution/i,
    });
    await expect(showSolution).toBeVisible();
    await showSolution.click();
    await expect(page.getByText("Explanation")).toBeVisible();

    expectNoAppErrors(collector, "question sql detail");
  });

  test("starter code prefilled and reset restores it", async ({ page }) => {
    const editor = page.locator("textarea").first();
    await expect(editor).toBeVisible();

    const initial = await editor.inputValue();
    expect(initial).toContain("SELECT");

    await editor.fill("SELECT 1;");
    await page.getByText("Reset Code").click();
    await expect(editor).toHaveValue(initial);
  });

  test("deep link + refresh keep the question", async ({ page }) => {
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "High-Engagement Video Filtering",
      }),
    ).toBeVisible();
    await expect(page.getByText("Run Query")).toBeVisible();
  });
});
