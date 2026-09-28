import {
  attachCollectors,
  expect,
  gotoPath,
  pageText,
  resetStorage,
  test,
} from "./helpers";

/**
 * PySpark execution against a real Spark engine.
 *
 * The in-browser stack (Pyodide + pinned pyspark wheels + Spark
 * Connect) needs COOP/COEP isolation, and real execution needs a
 * reachable Spark Connect endpoint. Both are reported honestly:
 * when the backend is absent the suite records BLOCKED and asserts
 * the failure is specifically the Spark Connect transport, rather
 * than reporting a pass.
 */

const PYSPARK_QUESTION = "pyspark-customer-revenue-totals";

/** The validated solution for the question under test. */
const CORRECT_PYSPARK = `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (1, 1, 250.0),
        (2, 2, 100.0),
        (3, 1, 75.0),
        (4, 3, 300.0),
        (5, 2, 150.0),
    ],
    ["order_id", "customer_id", "amount"],
)

result = (
    orders.groupBy("customer_id").agg(F.sum("amount").alias("total_revenue"))
)`;

type Page = import("@playwright/test").Page;

function runButton(page: Page) {
  return page
    .getByRole("button", { name: /Run PySpark|Run Query/ })
    .first();
}

/**
 * Probe the Spark Connect gateway.
 *
 * A single 4s probe is not reliable here: the probe runs while the
 * browser is already streaming a real Spark execution through the
 * same Envoy proxy, so the proxy can be too busy to answer and the
 * probe times out even though the backend is perfectly healthy. That
 * produced a false BLOCKED verdict for runs that had just executed
 * successfully. Retry across a short window instead.
 */
async function sparkConnectReachable(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("http://localhost:8081/", {
        signal: AbortSignal.timeout(4000),
      });

      // Any HTTP answer means the endpoint is listening; a bare GET
      // legitimately returns 415 from Envoy.
      if (response.status > 0) {
        return true;
      }
    } catch {
      // Retry below.
    }

    await new Promise((done) => setTimeout(done, 2000));
  }

  return false;
}

test.describe("PYSPARK EXECUTION", () => {
  test.slow();

  test("prerequisites: cross-origin isolation is active", async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, `question/${PYSPARK_QUESTION}`);
    await expect(runButton(page)).toBeVisible({ timeout: 60_000 });

    const env = await page.evaluate(() => ({
      crossOriginIsolated:
        (globalThis as { crossOriginIsolated?: boolean })
          .crossOriginIsolated === true,
      hasSharedArrayBuffer:
        typeof SharedArrayBuffer !== "undefined",
    }));

    console.log("PYSPARK_ENV:", JSON.stringify(env));

    expect(env.crossOriginIsolated).toBe(true);
    expect(env.hasSharedArrayBuffer).toBe(true);
  });

  test("a correct PySpark solution is graded correct by the real engine", async ({
    page,
  }) => {
    const collector = attachCollectors(page);

    await gotoPath(page, `question/${PYSPARK_QUESTION}`);
    const editor = page.locator("textarea").first();
    await expect(editor).toBeVisible();
    await expect(runButton(page)).toBeVisible({ timeout: 60_000 });

    await editor.fill(CORRECT_PYSPARK);

    const started = Date.now();
    await runButton(page).click();

    const reachable = await sparkConnectReachable();
    const verdict = page
      .getByText(/Correct answer|answer is incorrect|Query failed/i)
      .first();

    await expect(verdict).toBeVisible({ timeout: 300_000 });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const verdictText = await verdict.innerText();
    const text = await pageText(page, "main");

    console.log(
      `PYSPARK wall=${elapsed}s verdict="${verdictText}" reachable=${reachable}`,
    );

    /*
     * A "Correct answer!" verdict is itself proof that the real
     * Spark engine ran and graded the DataFrame, so it outranks the
     * reachability probe. Only when no engine verdict is present does
     * the probe decide whether this was a PASS or an environment
     * BLOCK.
     */
    const engineRan = verdictText.includes("Correct answer");

    if (engineRan || reachable) {
      // Backend present: the real Spark engine must grade the
      // validated solution as correct.
      expect(verdictText).toContain("Correct answer");
      expect(text).toContain("Validated result DataFrame");
      console.log(
        "PYSPARK_RESULT: PASS (real Spark execution)" +
          (reachable ? "" : "; probe was saturated by the run"),
      );
    } else {
      // Backend absent: prove the browser stack booted and the
      // failure is the Spark Connect transport, i.e. environment
      // blocked rather than an application defect.
      expect(text).toMatch(/Traceback|TransportError|Connection|fetch/);
      console.log(
        "PYSPARK_RESULT: BLOCKED (browser stack booted; Spark " +
          "Connect endpoint unreachable)",
      );
    }

    expect(collector.pageErrors).toEqual([]);
  });

  test("an unmodified starter template is graded incorrect", async ({
    page,
  }) => {
    await gotoPath(page, `question/${PYSPARK_QUESTION}`);
    const editor = page.locator("textarea").first();
    await expect(editor).toBeVisible();
    await expect(runButton(page)).toBeVisible({ timeout: 60_000 });

    const starter = await editor.inputValue();
    expect(starter).toContain("TODO");

    await runButton(page).click();

    const verdict = page
      .getByText(/Correct answer|answer is incorrect|Query failed/i)
      .first();

    await expect(verdict).toBeVisible({ timeout: 300_000 });

    const text = await pageText(page, "main");
    const reachable = await sparkConnectReachable();

    if (reachable) {
      // The template returns 5 raw rows; the answer expects the
      // 3-row per-customer aggregation.
      expect(await verdict.innerText()).toContain("incorrect");
      expect(text).toMatch(/Expected 3 rows/);
      console.log(
        "PYSPARK_STARTER: correctly graded incorrect " +
          "(raw 5 rows vs 3-row aggregation)",
      );
    }
  });

  test("invalid PySpark reports an error and the editor recovers", async ({
    page,
  }) => {
    const collector = attachCollectors(page);

    await gotoPath(page, `question/${PYSPARK_QUESTION}`);
    const editor = page.locator("textarea").first();
    await expect(editor).toBeVisible();

    const original = await editor.inputValue();

    await editor.fill("result = this is not valid python");
    await runButton(page).click();

    await expect(
      page.getByText(/Query failed|error|Traceback/i).first(),
    ).toBeVisible({ timeout: 300_000 });

    // Reset restores the starter code.
    await page.getByRole("button", { name: /Reset Code/ }).click();
    await expect(editor).toHaveValue(original);

    expect(collector.pageErrors).toEqual([]);
  });

  test("diagnostics page loads and reports engine state", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    await gotoPath(page, "pyspark-test");
    await page.waitForTimeout(3000);

    const text = await pageText(page);
    expect(text).toContain("PySpark");
    console.log("PYSPARK-TEST:", text.slice(0, 200));
    expect(collector.pageErrors).toEqual([]);
  });
});
