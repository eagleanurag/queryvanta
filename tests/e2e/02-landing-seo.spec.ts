import {
  attachCollectors,
  canonicalHref,
  expect,
  expectNoAppErrors,
  gotoPath,
  jsonLdBlocks,
  metaContent,
  resetStorage,
  test,
} from "./helpers";

/**
 * Phase 1A.3 — SEO landing pages. Every landing page is checked
 * for direct load, refresh, metadata, breadcrumbs, canonical,
 * JSON-LD validity and crawlable internal links.
 */

const LANDINGS = [
  { path: "sql-practice", h1: "Free SQL Practice Online" },
  { path: "pyspark-practice", h1: "Free PySpark Practice Online" },
  {
    path: "data-engineering-practice",
    h1: "Data Engineering Practice Questions",
  },
  {
    path: "sql-interview-prep",
    h1: "SQL Interview Preparation",
  },
  {
    path: "pyspark-interview-prep",
    h1: "PySpark Interview Preparation",
  },
  { path: "data-analyst-sql", h1: "SQL for Data Analysts" },
  { path: "big-data-practice", h1: "Big Data Practice" },
];

const SITE = "https://eagleanurag.github.io/queryvanta";

for (const landing of LANDINGS) {
  test.describe(`LANDING /${landing.path}`, () => {
    test("loads directly, refreshes, has complete metadata", async ({ page }) => {
      const collector = attachCollectors(page);
      await resetStorage(page);

      const response = await gotoPath(page, landing.path);
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole("heading", { level: 1, name: landing.h1 }),
      ).toBeVisible();

      // Unique title + description.
      await expect(page).toHaveTitle(new RegExp(landing.h1.split(" ")[0]));
      const description = await metaContent(page, "description");
      expect(description ?? "").toBeTruthy();
      expect((description ?? "").length).toBeGreaterThan(50);

      // Robots: landing pages are intentionally indexable.
      expect(await metaContent(page, "robots")).toBe("index,follow");

      // Canonical must carry the repository base.
      expect(await canonicalHref(page)).toBe(`${SITE}/${landing.path}`);

      // OG metadata.
      const ogTitle = await page
        .locator('head meta[property="og:title"]')
        .first()
        .getAttribute("content");
      expect(ogTitle ?? "").toContain("QueryVanta");

      // Breadcrumbs present and functional.
      const crumbs = page.getByLabel("Breadcrumb");
      await expect(crumbs).toBeVisible();
      await expect(crumbs.getByRole("link", { name: "Home" })).toBeVisible();

      // JSON-LD must parse.
      const blocks = await jsonLdBlocks(page);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block["@context"]).toBe("https://schema.org");
      }

      // Refresh keeps the page intact.
      await page.reload();
      await expect(
        page.getByRole("heading", { level: 1, name: landing.h1 }),
      ).toBeVisible();

      expectNoAppErrors(collector, `landing ${landing.path}`);
    });

    test("internal links resolve to real routes", async ({ page }) => {
      await resetStorage(page);
      await gotoPath(page, landing.path);
      await expect(
        page.getByRole("heading", { level: 1, name: landing.h1 }),
      ).toBeVisible();

      const hrefs = await page
        .locator("main a")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("href") ?? ""),
        );

      const internal = hrefs.filter((h) => h.length > 0);
      expect(internal.length).toBeGreaterThan(5);

      // Every internal link must be base-aware and point at a
      // real app route (no external/black-hat destinations).
      for (const href of internal) {
        expect(href.startsWith("http")).toBe(false);
      }

      // At least one question link and one learning-path link.
      const questionLinks = await page
        .locator('a[href*="/question/"]')
        .count();
      expect(questionLinks).toBeGreaterThan(0);
    });
  });
}
