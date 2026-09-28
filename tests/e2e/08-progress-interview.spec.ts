import {
  attachCollectors,
  expect,
  pageText,
  expectNoAppErrors,
  gotoPath,
  resetStorage,
  test,
} from "./helpers";

/**
 * Phase 1A.10 / 1A.11 — progress analytics and interview mode.
 */

test.describe("PROGRESS / ANALYTICS", () => {
  test("empty state renders totals from the built-in catalog", async ({ page }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);
    await gotoPath(page, "progress");

    // Wait out the lazy route chunk.
    await expect(
      page.getByText("Progress Dashboard"),
    ).toBeVisible({ timeout: 30_000 });

    const body = await pageText(page);

    // Real rendered values from the built-in catalog.
    expect(body).toContain("Solved 0 / 35");
    expect(body).toContain("Total Questions");
    expect(body).toMatch(/SQL 0 \/ 24/);
    expect(body).toMatch(/PySpark 0 \/ 11/);
    expect(body).toMatch(/Easy 0 \/ 12/);
    expect(body).toMatch(/Medium 0 \/ 14/);
    expect(body).toMatch(/Hard 0 \/ 9/);
    expect(body).toMatch(/No attempts yet/);

    expectNoAppErrors(collector, "progress empty");
  });

  test("totals match local storage after a solved question", async ({ page }) => {
    await resetStorage(page);

    // Seed solved state exactly the way the app writes it.
    await gotoPath(page, "");
    await page.evaluate(() => {
      window.localStorage.setItem(
        "queryvanta-solved-questions",
        JSON.stringify(["high-engagement-video-filtering"]),
      );
    });

    await gotoPath(page, "progress");
    await page.reload();
    await expect(
      page.getByText("Progress Dashboard"),
    ).toBeVisible({ timeout: 30_000 });

    const body = await pageText(page);

    // Cross-check visible completion against the seeded value.
    // 1 of 35 rounds to 3%.
    expect(body).toMatch(/Solved 1 \/ 35/);
    expect(body).toMatch(/Solved 1 \/ 35 . 3%/);
    expect(body).toMatch(/Easy 1 \/ 12/);
    expect(body).toMatch(/SQL 1 \/ 24/);
    expect(body).toMatch(/Unsolved Questions 34/);

    console.log(
      "progress solved line:",
      (body.match(/Solved \d+ \/ 35[^\n]*/) ?? [""])[0].trim(),
    );
  });

  test("progress deep link + refresh", async ({ page }) => {
    await gotoPath(page, "progress");
    await page.reload();
    await expect(
      page.getByText("Progress Dashboard"),
    ).toBeVisible();
  });
});

test.describe("INTERVIEW", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "interview");
    await expect(
      page.getByRole("heading", { name: "Mock Interview Setup" }),
    ).toBeVisible();
  });

  test("setup page exposes presets, sizes, types and timing", async ({ page }) => {
    const collector = attachCollectors(page);
    const body = await pageText(page);

    // Presets.
    for (const preset of [
      "SQL Interview",
      "PySpark Interview",
      "Data Engineer Interview",
      "Mixed Technical Interview",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp(preset) }),
      ).toBeVisible();
    }

    // Sizes.
    for (const size of ["5", "10", "15", "20"]) {
      await expect(
        page.getByRole("button", { name: size, exact: true }),
      ).toBeVisible();
    }

    // Types / difficulty / order / timing.
    expect(body).toContain("Question type");
    expect(body).toContain("Difficulty");
    expect(body).toContain("Question order");
    expect(body).toContain("Timing");
    expect(body).toContain("Untimed");
    expect(body).toContain("Timed");

    // Preparation guides link to landing pages.
    await expect(
      page.getByLabel("Interview preparation guides"),
    ).toBeVisible();

    expectNoAppErrors(collector, "interview setup");
  });

  test("SQL interview launches an untimed session", async ({ page }) => {
    const collector = attachCollectors(page);

    await page
      .getByRole("button", { name: /SQL Interview/ })
      .click();
    await page.getByRole("button", { name: "Untimed", exact: true }).click();

    await page.getByRole("button", { name: "Start Interview" }).click();
    await expect(page).toHaveURL(/\/practice/);
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });

    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(stored).toContain("interview");

    // Untimed: no countdown persisted.
    expect(stored).not.toContain("endsAt");

    expectNoAppErrors(collector, "interview untimed");
  });

  test("PySpark interview launches a PySpark session", async ({ page }) => {
    await page
      .getByRole("button", { name: /PySpark Interview/ })
      .click();
    await page.getByRole("button", { name: "Start Interview" }).click();
    await expect(page).toHaveURL(/\/practice/);

    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(stored).toContain("interview");
  });

  test("timer persists across refresh during a timed interview", async ({ page }) => {
    await page.getByRole("button", { name: "Timed", exact: true }).click();

    const bodyBefore = await pageText(page);
    console.log(
      "timing options:",
      (bodyBefore.match(/Untimed Timed[^\n]{0,60}/) ?? [""])[0],
    );

    await page.getByRole("button", { name: "Start Interview" }).click();
    await expect(page).toHaveURL(/\/practice/);
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });

    const before = await pageText(page);
    const beforeTimer = (before.match(/\d+:\d{2}/) ?? [""])[0];
    console.log("timer before refresh:", beforeTimer);
    expect(beforeTimer).not.toBe("");

    const storedBefore = await page.evaluate(() =>
      window.sessionStorage.getItem("queryvanta-practice-session"),
    );
    expect(storedBefore).toContain("endsAt");

    await page.reload();
    await page.waitForTimeout(2000);

    const after = await pageText(page);
    const afterTimer = (after.match(/\d+:\d{2}/) ?? [""])[0];
    console.log("timer after refresh:", afterTimer);
    expect(afterTimer).not.toBe("");
  });

  test("manual finish produces a factual summary with no invented score", async ({ page }) => {
    await page.getByRole("button", { name: "Start Interview" }).click();
    await expect(page).toHaveURL(/\/practice/);
    await expect(
      page.getByRole("button", { name: /Run Query|Run PySpark/ }),
    ).toBeVisible({ timeout: 60_000 });

    // The Finish control is only rendered on the last question.
    for (let guard = 0; guard < 40; guard += 1) {
      const finish = page
        .getByRole("button", {
          name: /Finish practice session|Finish interview/,
        })
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
      page.getByText(/Summary|Completed|Practice Complete/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    const body = await pageText(page);

    // Factual summary: no fabricated aggregate score.
    expect(body).not.toMatch(/\bScore: \d+\/\d+\b/);
    console.log(
      "interview summary:",
      body.replace(/\s+/g, " ").slice(0, 240),
    );
  });
});
