import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  APP_ORIGIN,
  repoRootPath,
  startWorker,
  stopWorker,
  WORKER_ORIGIN,
} from "./harness.ts";

/**
 * Production-like test.
 *
 * Verifies the Worker serves the BUILT application from dist/ and
 * the API from the same origin, and — critically — that a client
 * deep link returns HTTP 200 with real SPA fallback semantics
 * rather than GitHub Pages' 404.html workaround.
 *
 * Builds the Worker target itself when dist/ is not already a
 * root-base bundle, so the suite never silently skips:
 *   npm run build:worker
 */

const distDir = join(repoRootPath, "dist");

/** True when dist/ was built for the Worker (root base). */
function builtForRootBase(): boolean {
  try {
    return readFileSync(
      join(distDir, "index.html"),
      "utf8",
    ).includes('src="/assets/');
  } catch {
    return false;
  }
}

/**
 * These assertions only apply to a Worker-targeted build: on a GitHub
 * Pages build the assets are served from `/queryvanta/`, so they would
 * be testing the wrong deployment.
 *
 * Rather than skip, the suite builds the target it needs. Skipping
 * quietly is how a Worker regression reaches production: the suite
 * exists precisely to prove the Worker serves a root-base bundle, so
 * it should guarantee that bundle exists.
 */
if (!builtForRootBase()) {
  const build = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      join(repoRootPath, "scripts", "build.mjs"),
      "worker",
    ],
    { cwd: repoRootPath, stdio: "pipe" },
  );

  if (build.status !== 0) {
    console.error(
      "Could not build the Worker target:\n" +
        String(build.stdout ?? "") +
        String(build.stderr ?? ""),
    );
    process.exit(1);
  }
}

const distPresent = existsSync(join(distDir, "index.html"));
const rootBase = builtForRootBase();

const skipReason =
  !distPresent || !rootBase
    ? "dist/index.html is not a Worker-targeted build. " +
      "Rebuild with: npm run build:worker"
    : false;

before(async () => {
  if (skipReason !== false) {
    return;
  }

  await startWorker();
}, { timeout: 180_000 });

after(async () => {
  if (skipReason !== false) {
    return;
  }

  await stopWorker();
}, { timeout: 60_000 });

describe(
  "WORKER STATIC ASSETS",
  { skip: skipReason !== false ? skipReason : false },
  () => {
    it("serves the built index at the root", async () => {
      const response = await fetch(`${WORKER_ORIGIN}/`);

      assert.equal(response.status, 200);

      const html = await response.text();

      assert.match(html, /<title>QueryVanta/);
      assert.match(html, /id="root"/);
      // Root-base build: assets are referenced from "/".
      assert.match(html, /src="\/assets\//);
    });

    it("returns HTTP 200 for a client deep link (real SPA fallback)", async () => {
      // This is the behaviour GitHub Pages cannot provide: Pages
      // answers deep links with 404 + the index document.
      //
      // Note: the generated SEO landing snapshots under
      // public/<slug>/index.html intentionally SHADOW the matching
      // React routes with a static, crawler-facing document. That is
      // pre-existing, verified production behaviour, so only routes
      // without a static counterpart are asserted here.
      for (const route of [
        "/learn",
        "/learn/topic/window-functions",
        "/interview",
        "/progress",
        "/practice",
        "/admin/questions",
        "/question/high-engagement-video-filtering",
      ]) {
        const response = await fetch(
          `${WORKER_ORIGIN}${route}`,
        );

        assert.equal(
          response.status,
          200,
          `deep link ${route} must return 200, not 404`,
        );

        const html = await response.text();

        assert.match(
          html,
          /id="root"/,
          `${route} must serve the React application shell`,
        );
      }
    });

    it("serves the static SEO landing snapshot for a landing path", async () => {
      // Intentional: the snapshot gives crawlers real content and
      // links into the interactive application.
      const response = await fetch(
        `${WORKER_ORIGIN}/sql-practice`,
      );

      assert.equal(response.status, 200);

      const html = await response.text();

      assert.match(html, /Free SQL Practice Online/);
      assert.match(html, /rel="canonical"/);
      // It must hand the visitor into the real application.
      assert.match(html, /Start practicing on QueryVanta/);
    });

    it("still serves the not-found page for an unknown API route", async () => {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/definitely-not-real`,
      );

      assert.equal(response.status, 404);

      const body = (await response.json()) as {
        ok: boolean;
      };

      assert.equal(body.ok, false);
    });

    it("serves cross-origin isolation headers for the PySpark worker", async () => {
      const response = await fetch(`${WORKER_ORIGIN}/`);

      // Required for SharedArrayBuffer, which the in-browser
      // PySpark worker depends on. GitHub Pages cannot send these.
      assert.equal(
        response.headers.get("cross-origin-opener-policy"),
        "same-origin",
      );
      assert.ok(
        response.headers
          .get("cross-origin-embedder-policy")
          ?.includes("credentialless"),
      );
    });

    it("keeps the API and the app on one origin", async () => {
      const appResponse = await fetch(`${WORKER_ORIGIN}/`);
      const apiResponse = await fetch(
        `${WORKER_ORIGIN}/api/health`,
      );

      assert.equal(
        appResponse.url.startsWith(WORKER_ORIGIN),
        true,
      );
      assert.equal(
        apiResponse.url.startsWith(WORKER_ORIGIN),
        true,
      );

      // No CORS headers are needed or emitted, which is what keeps
      // the admin session cookie first-party.
      assert.equal(
        apiResponse.headers.get(
          "access-control-allow-origin",
        ),
        null,
      );
    });

    it("serves the generated sitemap and robots from the same origin", async () => {
      const sitemap = await fetch(
        `${WORKER_ORIGIN}/sitemap.xml`,
      );
      assert.equal(sitemap.status, 200);
      assert.match(await sitemap.text(), /<urlset/);

      const robots = await fetch(`${WORKER_ORIGIN}/robots.txt`);
      assert.equal(robots.status, 200);
      assert.match(await robots.text(), /User-agent/);
    });

    it("APP_ORIGIN is the origin the worker validates against", () => {
      assert.equal(APP_ORIGIN, WORKER_ORIGIN);
    });
  },
);
