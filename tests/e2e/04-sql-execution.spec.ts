import {
  attachCollectors,
  expect,
  gotoPath,
  resetStorage,
  test,
} from "./helpers";

const CORRECT_SQL = `SELECT
    *
FROM videos
WHERE views > 1000000
ORDER BY duration_seconds;`;

test.describe("SQL EXECUTION (PGlite)", () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "question/high-engagement-video-filtering");
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("valid SQL returns the expected result set", async ({ page }) => {
    const editor = page.locator("textarea").first();
    await editor.fill(CORRECT_SQL);

    const started = Date.now();
    await page
      .getByRole("button", { name: /Run Query/ })
      .click();

    const verdict = page
      .getByText(/Correct answer|answer is incorrect/i)
      .first();

    await expect(verdict).toBeVisible({ timeout: 90_000 });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `SQL_OK verdict="${await verdict.innerText()}" wall=${elapsed}s`,
    );

    expect(await verdict.innerText()).toContain("Correct answer");
  });

  test("invalid SQL surfaces an error without crashing", async ({ page }) => {
    const collector = attachCollectors(page);
    await page.locator("textarea").first().fill("SELECT FROM WHERE;");
    await page.getByRole("button", { name: /Run Query/ }).click();

    await expect(
      page.getByText(/error|exception|syntax/i).first(),
    ).toBeVisible({ timeout: 90_000 });

    await expect(
      page.getByRole("button", { name: /Run Query/ }),
    ).toBeEnabled();
    expect(collector.pageErrors).toEqual([]);
  });

  test("empty SQL is handled without a crash", async ({ page }) => {
    const collector = attachCollectors(page);
    await page.locator("textarea").first().fill("");
    await page.getByRole("button", { name: /Run Query/ }).click();
    await page.waitForTimeout(4000);
    expect(collector.pageErrors).toEqual([]);
  });

  test("repeated execution is stable", async ({ page }) => {
    const editor = page.locator("textarea").first();
    await editor.fill(CORRECT_SQL);

    for (const attempt of [1, 2]) {
      await page.getByRole("button", { name: /Run Query/ }).click();
      await expect(
        page.getByText(/Correct answer/i).first(),
      ).toBeVisible({ timeout: 90_000 });
      console.log(`SQL_REPEAT attempt=${attempt} correct`);
    }
  });

  test("stale execution cannot overwrite a newer result", async ({ page }) => {
    const editor = page.locator("textarea").first();

    // Slow query first, then a correct one.
    await editor.fill("SELECT pg_sleep(4), title FROM videos;");
    await page.getByRole("button", { name: /Run Query/ }).click();
    await page.waitForTimeout(300);

    await editor.fill(CORRECT_SQL);
    await page.getByRole("button", { name: /Run Query/ }).click();

    await expect(page.getByText(/Correct answer/i).first()).toBeVisible({
      timeout: 90_000,
    });

    // The older slow query must not clobber the newer result.
    await page.waitForTimeout(10_000);
    await expect(page.getByText(/Correct answer/i).first()).toBeVisible();
    console.log("SQL_STALE guard held after slow query completed");
  });

  test("result table renders rows", async ({ page }) => {
    await page.locator("textarea").first().fill(CORRECT_SQL);
    await page.getByRole("button", { name: /Run Query/ }).click();
    await expect(page.getByText(/Correct answer/i).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator("table").first()).toBeVisible();
  });

  test("session continuity across navigation", async ({ page }) => {
    const collector = attachCollectors(page);
    await page.locator("textarea").first().fill("SELECT 42 AS answer;");
    await page.getByRole("button", { name: /Run Query/ }).click();
    await expect(
      page.getByText(/Correct answer|answer is incorrect|error/i).first(),
    ).toBeVisible({ timeout: 90_000 });

    await gotoPath(page, "");
    await expect(
      page.getByText(/Showing \d+ of \d+ questions/),
    ).toBeVisible();
    await gotoPath(page, "question/high-engagement-video-filtering");
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible();
    expect(collector.pageErrors).toEqual([]);
  });
});
