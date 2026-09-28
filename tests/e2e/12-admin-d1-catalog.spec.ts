import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * TEST A-J: the admin catalog must come from D1.
 *
 * The reported production bug was that a question created in D1 and
 * returned by `GET /api/admin/questions` was invisible in the
 * refreshed admin UI, which searched only the local/built-in
 * catalog.
 *
 * This suite runs against the real Worker serving the real built
 * bundle, with a real local D1 seeded with one DRAFT question
 * (`published: false`) and a real administrator session cookie.
 *
 * Start the environment first:
 *   $env:QV_BASE = "/"; npm run build
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

let SEED: AdminEnv | null = null;

try {
  SEED = JSON.parse(
    readFileSync(INFO_PATH, "utf8"),
  ) as AdminEnv;
} catch {
  SEED = null;
}

/**
 * This suite exercises the real Worker, its real local D1 and a
 * real session cookie. It cannot run against the Vite dev server or
 * production GitHub Pages, which have no backend.
 */
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

const SEARCH_TERM = "TEST - Production D1 CRUD";

test.describe("ADMIN CATALOG FROM D1", () => {
  test.use({ baseURL: SEED?.origin ?? targetBase });
  test.skip(
    skipReason !== false,
    skipReason === false ? "" : skipReason,
  );

  test.beforeEach(async ({ context, request }) => {
    await context.addCookies([
      {
        name: SEED.cookieName,
        value: SEED.cookieValue,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // The D1 database is shared across tests, and H/I mutate it.
    // Reset the seed question to the production-reported starting
    // state (enabled, unpublished draft) so every test is
    // independent and order does not matter.
    const authHeaders = {
      Cookie: `${SEED.cookieName}=${SEED.cookieValue}`,
      Origin: SEED.origin,
      "X-CSRF-Token": SEED.csrfToken,
    };

    const existing = await request.get(
      `/api/admin/questions/${SEED.seedId}`,
      { headers: { Cookie: authHeaders.Cookie } },
    );

    if (existing.status() === 404) {
      const created = await request.post("/api/admin/questions", {
        headers: { ...authHeaders, "Content-Type": "application/json" },
        data: {
          id: SEED.seedId,
          title: SEED.seedTitle,
          description:
            "Seeded draft used by the admin catalog test.",
          difficulty: "Easy",
          questionType: "SQL",
          category: "Aggregation",
          languages: ["PostgreSQL"],
          tags: ["SELECT"],
          companies: [],
          database: {
            engine: "PostgreSQL",
            tables: [
              {
                name: "orders",
                columns: [
                  { name: "id", type: "INTEGER" },
                  { name: "amount", type: "DECIMAL" },
                ],
                rows: [{ id: 1, amount: 10 }],
              },
            ],
          },
          starterCode: "SELECT * FROM orders;",
          validation: {
            type: "result",
            orderMatters: false,
            expectedResult: [{ id: 1, amount: 10 }],
          },
        },
      });

      expect(created.status()).toBe(200);
    }

    // Restore the starting state: enabled, unpublished draft.
    await request.post(
      `/api/admin/questions/${SEED.seedId}/enable`,
      { headers: authHeaders },
    );
    await request.post(
      `/api/admin/questions/${SEED.seedId}/unpublish`,
      { headers: authHeaders },
    );
  });

  test("A. initial load shows the server question", async ({ page }) => {
    await page.goto("/admin/questions");

    // The sync panel must report a real server load, not a guess.
    const ok = page.getByTestId("server-sync-ok");
    await expect(ok).toBeVisible({ timeout: 60_000 });

    const message = await ok.innerText();
    console.log("  sync message:", message);
    expect(message).toMatch(/Shared catalog loaded/);
    expect(message).toMatch(/1 question\(s\) on the server/);

    // The seeded draft must be present in the admin list.
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Marked as a draft, not published.
    await expect(
      page.getByText("Draft", { exact: true }),
    ).toBeVisible();
  });

  test("B. search finds exactly one server question", async ({ page }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page
      .getByLabel("Search catalog questions")
      .fill(SEARCH_TERM);
    await page.waitForTimeout(800);

    // The old failure mode: "No local questions match the current
    // search or filters."
    await expect(
      page.getByText(/No local questions match/i),
    ).toHaveCount(0);

    const row = page
      .getByText(SEED.seedTitle, { exact: true })
      .first();
    await expect(row).toBeVisible();

    // Exactly one match.
    const ids = page.locator(
      `text=${SEED.seedId}`,
    );
    await expect(ids).toHaveCount(1);
  });

  test("C. the server question survives a full refresh", async ({ page }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();

    await expect(
      page.getByTestId("server-sync-ok"),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible();

    // And it is still searchable after the refresh.
    await page
      .getByLabel("Search catalog questions")
      .fill(SEARCH_TERM);
    await page.waitForTimeout(800);
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible();

    console.log(
      "  C. server question visible after full refresh",
    );
  });

  test("D. clearing search shows 35 built-in + 1 server = 36", async ({
    page,
  }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // The "Total Questions" stat is the merged catalog size.
    const totalValue = await page
      .getByText("Total Questions", { exact: true })
      .first()
      .locator("xpath=..")
      .innerText();

    const totalText = totalValue.replace(/\s+/g, " ").trim();
    console.log("  D. total stat:", totalText);

    // 35 built-in + 1 server question.
    expect(totalText).toMatch(/\b36\b/);

    // 35 built-in + 1 server row.
    const rowCount = page.locator(
      "button:has-text(\"Duplicate\")",
    );
    const count = await rowCount.count();
    console.log("  D. rows rendered:", count);
    expect(count).toBe(36);
  });

  test("E. repeated reloads never duplicate the server question", async ({
    page,
  }) => {
    for (const attempt of [1, 2, 3]) {
      await page.goto("/admin/questions");
      await expect(
        page.getByText(SEED.seedTitle, { exact: true }),
      ).toBeVisible({ timeout: 60_000 });

      const occurrences = await page
        .locator(`text=${SEED.seedId}`)
        .count();

      console.log(
        `  E. reload ${attempt}: id occurrences = ${occurrences}`,
      );
      expect(occurrences).toBe(1);
    }
  });

  test("F. the direct API still returns the D1 question", async ({
    request,
  }) => {
    const response = await request.get("/api/admin/questions", {
      headers: {
        Cookie: `${SEED.cookieName}=${SEED.cookieValue}`,
      },
    });

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      data: { count: number; questions: { id: string }[] };
    };

    expect(body.data.count).toBe(1);
    expect(
      body.data.questions.map((q) => q.id),
    ).toContain(SEED.seedId);
  });

  test("G. the draft is absent from the public catalog", async ({
    request,
  }) => {
    const list = await request.get("/api/questions");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data: { questions: { id: string }[] };
    };

    expect(
      body.data.questions.map((q) => q.id),
    ).not.toContain(SEED.seedId);

    // And a direct public read must 404.
    const direct = await request.get(
      `/api/questions/${SEED.seedId}`,
    );
    expect(direct.status()).toBe(404);

    console.log(
      "  G. draft correctly absent from the public catalog",
    );
  });

  test("H. publishing via the admin UI makes it public", async ({
    page,
    request,
  }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const row = page
      .getByText(SEED.seedTitle, { exact: true })
      .first()
      .locator("xpath=ancestor::*[.//button[normalize-space()='Duplicate']][1]");

    await row
      .getByRole("button", { name: "Publish", exact: true })
      .click();

    // The row must flip to Published.
    await expect(
      row.getByText("Published", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // The public API now contains it.
    const direct = await request.get(
      `/api/questions/${SEED.seedId}`,
    );
    expect(direct.status()).toBe(200);

    const body = (await direct.json()) as {
      data: { question: { id: string; title: string } };
    };
    expect(body.data.question.id).toBe(SEED.seedId);
    expect(body.data.question.title).toBe(SEED.seedTitle);

    console.log(
      "  H. published via the admin UI; public API now returns it",
    );
  });

  test("I. disabling removes it from the public catalog", async ({
    page,
    request,
  }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const row = page
      .getByText(SEED.seedTitle, { exact: true })
      .first()
      .locator("xpath=ancestor::*[.//button[normalize-space()='Duplicate']][1]");

    await row
      .getByRole("button", { name: "Disable", exact: true })
      .click();

    await expect(
      row.getByText("Disabled", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const direct = await request.get(
      `/api/questions/${SEED.seedId}`,
    );
    expect(direct.status()).toBe(404);

    console.log(
      "  I. disabled; public API no longer returns it",
    );
  });

  test("J. the admin UI still reflects server state after a refresh", async ({
    page,
  }) => {
    await page.goto("/admin/questions");
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const rowFor = () =>
      page
        .getByText(SEED.seedTitle, { exact: true })
        .first()
        .locator(
          "xpath=ancestor::*[.//button[normalize-space()='Duplicate']][1]",
        );

    // Self-contained: apply the state change inside this test so
    // it does not depend on test I having run first.
    await rowFor()
      .getByRole("button", { name: "Disable", exact: true })
      .click();

    await expect(
      rowFor().getByText("Disabled", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(
      page.getByTestId("server-sync-ok"),
    ).toBeVisible({ timeout: 60_000 });

    const rowAfter = rowFor();

    await expect(
      rowAfter.getByText("Disabled", { exact: true }),
    ).toBeVisible();

    // The question must still be searchable after the refresh.
    await page
      .getByLabel("Search catalog questions")
      .fill(SEARCH_TERM);
    await page.waitForTimeout(800);
    await expect(
      page.getByText(SEED.seedTitle, { exact: true }),
    ).toBeVisible();

    console.log(
      "  J. admin UI still accurate after refresh",
    );
  });
});
