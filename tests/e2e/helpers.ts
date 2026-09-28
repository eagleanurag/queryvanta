import {
  expect,
  test,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

/**
 * Shared helpers for QueryVanta browser audits.
 *
 * Collectors are attached before navigation so that console
 * errors, page errors and failed network requests are recorded
 * per test and asserted explicitly rather than ignored.
 */

export type Collector = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

/** Console/page/network noise that is not an app defect. */
const IGNORED_CONSOLE = [
  // React Router future-flag notices (informational).
  /React Router Future Flag/i,
  // Vite dev-server HMR chatter.
  /\[vite\]/i,
  /Download the React DevTools/i,
];

export function attachCollectors(page: Page): Collector {
  const collector: Collector = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") {
      return;
    }

    const text = message.text();

    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) {
      return;
    }

    collector.consoleErrors.push(text);
  });

  page.on("pageerror", (error: Error) => {
    collector.pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    collector.failedRequests.push(
      `${request.method()} ${request.url()} :: ${
        request.failure()?.errorText ?? "unknown"
      }`,
    );
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      collector.failedRequests.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  return collector;
}

/**
 * Asserts the collector is clean. Assets under the pyodide /
 * wheels directories are only fetched by the PySpark flow and are
 * excluded because a plain page view must not request them.
 */
export function expectNoAppErrors(
  collector: Collector,
  label: string,
): void {
  expect(
    collector.pageErrors,
    `${label}: uncaught page exceptions`,
  ).toEqual([]);
  expect(
    collector.consoleErrors,
    `${label}: console errors`,
  ).toEqual([]);
}

export function expectNoFailedRequests(
  collector: Collector,
  label: string,
): void {
  expect(
    collector.failedRequests,
    `${label}: failed network requests`,
  ).toEqual([]);
}

/** Reads a <meta> content value by name. */
export async function metaContent(
  page: Page,
  name: string,
): Promise<string | null> {
  return page
    .locator(`head meta[name="${name}"]`)
    .first()
    .getAttribute("content");
}

/** Reads the canonical href, or null when absent. */
export async function canonicalHref(
  page: Page,
): Promise<string | null> {
  return page
    .locator('head link[rel="canonical"]')
    .first()
    .getAttribute("href");
}

/** Parses every JSON-LD block on the page. */
export async function jsonLdBlocks(
  page: Page,
): Promise<Record<string, unknown>[]> {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();

  return raw.map((text) => JSON.parse(text) as Record<string, unknown>);
}

/**
 * Reads visible text with whitespace collapsed.
 *
 * `innerText` inserts a newline at every block boundary, so
 * assertions must run against normalized text to avoid
 * false negatives on multi-word labels.
 */
export async function pageText(
  page: Page,
  selector = "body",
): Promise<string> {
  const raw = await page.locator(selector).first().innerText();

  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Opens the mobile navigation drawer when the viewport is narrow.
 *
 * Visibility alone is not a reliable signal: the closed drawer is
 * translated off-canvas but still reports a non-empty bounding
 * box, so the decision is made on viewport width (the `lg`
 * breakpoint in App.tsx is 1024px).
 */
export async function openNavIfNeeded(
  page: Page,
): Promise<void> {
  const size = page.viewportSize();

  if (!size || size.width >= 1024) {
    return;
  }

  const menu = page
    .getByRole("button", { name: /open navigation menu/i })
    .first();

  await menu.scrollIntoViewIfNeeded();
  await menu.click();
  await page.waitForTimeout(600);
}

/** Navigates using a BASE-RELATIVE path.
 *
 * `page.goto("/learn")` would resolve against the origin and drop
 * the /queryvanta base segment, so every navigation in this suite
 * goes through this helper.
 */
export async function gotoPath(
  page: Page,
  path: string,
): Promise<Response | null> {
  const clean = path.replace(/^\/+/, "");

  return page.goto(clean === "" ? "./" : clean);
}

/** Clears every QueryVanta storage key for a deterministic run. */
export async function resetStorage(page: Page): Promise<void> {
  await gotoPath(page, "");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

export { expect, test };
