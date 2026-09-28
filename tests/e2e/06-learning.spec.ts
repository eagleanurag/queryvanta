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
 * Phase 1A.8 — learning paths, topics and weak areas.
 */

test.describe("LEARNING", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
  });

  test("/learn lists all paths", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "learn");

    await expect(
      page.getByRole("heading", { name: "Learn", level: 1 }),
    ).toBeVisible();

    for (const pathName of [
      "SQL Foundations",
      "SQL Advanced Practice",
      "PySpark Foundations",
    ]) {
      await expect(page.getByText(pathName).first()).toBeVisible();
    }

    expectNoAppErrors(collector, "learn");
  });

  test("each learning path opens and lists stages", async ({ page }) => {
    const paths = [
      "sql-foundations",
      "sql-advanced",
      "pyspark-foundations",
      "pyspark-advanced",
      "data-engineering-core",
      "interview-prep",
    ];

    for (const pathId of paths) {
      const collector = attachCollectors(page);
      await gotoPath(page, `learn/${pathId}`);

      await expect(page.getByLabel("Breadcrumb")).toBeVisible();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();

      console.log(
        `path ${pathId}:`,
        (await heading.innerText()).trim(),
      );

      expectNoAppErrors(collector, `path ${pathId}`);
    }
  });

  test("topic page deep link lists questions", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "learn/topic/window-functions");

    await expect(page.getByLabel("Breadcrumb")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Window Functions" }),
    ).toBeVisible();

    const body = await pageText(page);
    expect(body).toMatch(/0 of 6 completed/);
    expect(body).toContain("Employee Department Ranking");
    expect(body).toContain("Running Order Totals");

    // Topic page offers a practice start.
    await expect(
      page
        .getByRole("button", { name: /Start Practice/ })
        .first(),
    ).toBeVisible();

    expectNoAppErrors(collector, "topic page");
  });

  test("topic page launches a practice session", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "learn/topic/window-functions");

    await page
      .getByRole("button", { name: /Start Practice/ })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("button", { name: /^Start Practice \(/ })
      .click();

    await expect(page).toHaveURL(/\/practice/);

    // The session must carry its learning origin.
    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(stored).toContain("learning");

    expectNoAppErrors(collector, "topic practice");
  });

  test("unknown topic shows not-found state", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "learn/topic/does-not-exist-topic");
    await expect(page.getByText("Topic not found")).toBeVisible();
    expectNoAppErrors(collector, "unknown topic");
  });

  test("unknown path shows not-found state", async ({ page }) => {
    await gotoPath(page, "learn/no-such-path");
    await expect(
      page.getByText("Learning path not found"),
    ).toBeVisible();
  });

  test("weak areas section explains the empty state", async ({ page }) => {
    await gotoPath(page, "learn");
    await expect(
      page.getByText("Practice Weak Areas"),
    ).toBeVisible({ timeout: 30_000 });

    const body = await pageText(page);
    expect(body).toContain("Practice Weak Areas");
    expect(body).toMatch(/Not enough practice data yet/);
  });

  test("quick practice preset launches a session", async ({ page }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "learn");

    await page
      .getByRole("button", { name: /Quick 5/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/practice/);
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });

    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(stored).toContain("learning");

    expectNoAppErrors(collector, "quick preset");
  });
});
