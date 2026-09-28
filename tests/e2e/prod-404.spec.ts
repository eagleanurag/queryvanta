import {
  attachCollectors,
  expect,
  gotoPath,
  pageText,
  test,
} from "./helpers";

/**
 * Confirms the documented GitHub Pages SPA behaviour: deep links
 * return HTTP 404 while still serving the correct application
 * document from 404.html. Content correctness and HTTP status are
 * asserted separately so the two are never confused.
 *
 * Production-only: skip unless the target is the live Pages site.
 */

test("production deep link returns 404 status but renders the app", async ({
  page,
}) => {
  const baseURL = process.env.QV_BASE_URL ?? "";

  if (!baseURL.includes("eagleanurag.github.io")) {
    test.skip(
      true,
      "Production-only assertion. Run with " +
        "QV_BASE_URL=https://eagleanurag.github.io/queryvanta/",
    );

    return;
  }

  const collector = attachCollectors(page);
  const deepRoutes = [
    "learn",
    "progress",
    "practice",
    "admin/questions",
    "learn/topic/window-functions",
  ];

  for (const route of deepRoutes) {
    const response = await gotoPath(page, route);
    const status = response?.status();
    await page.waitForTimeout(1500);

    const text = await pageText(page);
    const rendered = !text.includes("404: Not Found");

    console.log(
      `prod[${route}] status=${status} rendered=${rendered} ` +
        `head="${text.slice(0, 70)}"`,
    );

    expect(status).toBe(404);
    expect(rendered).toBe(true);
  }

  expect(collector.pageErrors).toEqual([]);
});
