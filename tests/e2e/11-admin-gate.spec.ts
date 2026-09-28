import {
  attachCollectors,
  expect,
  gotoPath,
  pageText,
  resetStorage,
  test,
} from "./helpers";

/**
 * Post-implementation administrator gate.
 *
 * The previous suite (09-admin-baseline.spec.ts) proved the admin
 * surface was reachable with no authentication at all. These tests
 * assert the NEW behaviour: the admin surface is not usable without
 * a server-issued session, and the API refuses direct calls.
 */

test.describe("ADMIN ROUTE PROTECTION", () => {
  test("an unauthenticated visitor cannot reach the admin form", async ({
    page,
  }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);

    await gotoPath(page, "admin/questions");
    await page.waitForTimeout(2500);

    const text = await pageText(page);
    console.log("GATE_TEXT:", text.slice(0, 220));

    // The full CRUD surface must NOT be rendered.
    await expect(
      page.getByRole("button", { name: "Create Question" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export Questions" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Question Management" }),
    ).toHaveCount(0);

    // A gate is shown instead.
    expect(text).toMatch(
      /Administrator access required|Administrator sign-in|API is not available/,
    );

    expect(collector.pageErrors).toEqual([]);
  });

  test("the admin preview route is gated too", async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/preview");
    await page.waitForTimeout(2500);

    // No editable question workspace is exposed.
    await expect(
      page.getByText("Run Query"),
    ).toHaveCount(0);
  });

  test("/admin/login explains the sign-in requirement", async ({ page }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);

    await gotoPath(page, "admin/login");
    await page.waitForTimeout(2500);

    await expect(
      page.getByRole("heading", { name: "Administrator sign-in" }),
    ).toBeVisible();

    // GitHub is the only offered identity provider.
    const github = page.locator('a[href*="api/auth/github"]');
    await expect(github).toHaveCount(1);
    await expect(github).toContainText("Continue with GitHub");

    const body = await pageText(page);
    expect(body).toMatch(/minimum permission/i);

    // No password field of any kind: authentication is delegated
    // entirely to GitHub.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      page.getByLabel(/password/i),
    ).toHaveCount(0);

    expect(collector.pageErrors).toEqual([]);
  });

  test("an error code from the provider is surfaced safely", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/login?error=not-authorized");
    await page.waitForTimeout(2000);

    await expect(
      page.getByText(/not registered as a QueryVanta administrator/),
    ).toBeVisible();
  });
});

test.describe("ADMIN API FROM THE BROWSER", () => {
  test("direct unauthenticated API calls are refused", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "");

    const endpoints = [
      "/api/admin/questions",
      "/api/admin/audit",
    ];

    for (const endpoint of endpoints) {
      const status = await page.evaluate(async (path) => {
        const response = await fetch(path, {
          credentials: "same-origin",
        });

        return response.status;
      }, endpoint);

      console.log(`browser GET ${endpoint} -> ${status}`);

      // Either the API does not exist on this deployment, or it
      // refuses the call. It must never return 200 with data.
      expect([401, 403, 404]).toContain(status);
    }
  });

  test("a cross-site mutation attempt is blocked by the browser", async ({
    page,
  }) => {
    await resetStorage(page);
    await gotoPath(page, "");

    const result = await page.evaluate(async () => {
      try {
        const response = await fetch("/api/admin/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "xss-probe",
            title: "probe",
          }),
        });

        return { status: response.status, ok: response.ok };
      } catch {
        return { status: 0, ok: false };
      }
    });

    console.log("browser cross-site mutation:", JSON.stringify(result));
    expect(result.ok).toBe(false);
  });
});

test.describe("ADMIN SESSION STORAGE HYGIENE", () => {
  test("no admin token is written to web storage", async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/questions");
    await page.waitForTimeout(2500);
    await gotoPath(page, "admin/login");
    await page.waitForTimeout(1500);

    const storage = await page.evaluate(() => ({
      local: Object.entries(
        window.localStorage as unknown as Record<string, string>,
      ),
      session: Object.entries(
        window.sessionStorage as unknown as Record<
          string,
          string
        >,
      ),
    }));

    const suspicious = [...storage.local, ...storage.session].filter(
      ([key, value]) =>
        /token|bearer|jwt|session|auth|secret|password/i.test(key) ||
        /Bearer\s+[A-Za-z0-9._-]{16,}/.test(value),
    );

    console.log(
      "STORAGE_KEYS:",
      JSON.stringify({
        local: storage.local.map(([key]) => key),
        session: storage.session.map(([key]) => key),
      }),
    );

    expect(suspicious).toEqual([]);
  });
});
