import {
  attachCollectors,
  gotoPath,
  openNavIfNeeded,
  expect,
  expectNoAppErrors,
  resetStorage,
  test,
} from "./helpers";

/**
 * Phase 1A.1 / 1A.2 — home page and primary navigation.
 */

test.describe("HOME", () => {
  test("loads, renders discovery, refreshes cleanly", async ({ page }) => {
    const collector = attachCollectors(page);
    await resetStorage(page);

    const response = await gotoPath(page, "");
    expect(response?.status()).toBe(200);

    await expect(page.getByText(/Showing \d+ of \d+ questions/)).toBeVisible();

    // Major content renders.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Total Questions")).toBeVisible();

    // Title + description are present and unique.
    await expect(page).toHaveTitle(/QueryVanta/);

    // Refresh must not change behavior.
    await page.reload();
    await expect(page.getByText(/Showing \d+ of \d+ questions/)).toBeVisible();

    expectNoAppErrors(collector, "home");
  });

  test("built-in catalog count is visible", async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "");
    await expect(page.getByText(/Showing 35 of 35 questions/)).toBeVisible();
  });
});

test.describe("PRIMARY NAVIGATION", () => {
  const routes = [
    { link: "Learn", path: "/learn", marker: "Learn" },
    { link: "Progress", path: "/progress", marker: "Progress" },
    { link: "Interview", path: "/interview", marker: "Mock Interview Setup" },
  ];

  for (const route of routes) {
    test(`navigates to ${route.path} and refreshes`, async ({ page }) => {
      const collector = attachCollectors(page);
      await resetStorage(page);
      await gotoPath(page, "");

      // On mobile the sidebar lives behind the drawer.
      await openNavIfNeeded(page);

      await page
        .getByRole("link", { name: route.link, exact: true })
        .first()
        .click();

      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByText(route.marker).first()).toBeVisible();

      await page.reload();
      await expect(page.getByText(route.marker).first()).toBeVisible();

      expectNoAppErrors(collector, `nav ${route.path}`);
    });
  }

  test("browser back and forward restore routes", async ({ page }) => {
    await resetStorage(page);

    await gotoPath(page, "");
    await gotoPath(page, "learn");
    await expect(page.getByText("Learn").first()).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/Showing \d+ of \d+ questions/)).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/learn$/);
  });

  test("admin route is publicly reachable in the baseline (finding)", async ({ page }) => {
    await resetStorage(page);
    await gotoPath(page, "admin/questions");

    // Baseline behavior: no authentication gate at all.
    await expect(
      page.getByText("Question Management"),
    ).toBeVisible();
  });
});
