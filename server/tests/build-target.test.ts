import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  DEFAULT_TARGET,
  DEPLOY_TARGETS,
  resolveTarget,
  WORKER_FORBIDDEN_SEGMENT,
} from "../../config/deploy-targets.ts";
import {
  countInLiveCode,
  stripComments,
} from "../../config/source-scanner.ts";

/**
 * Build-target regression tests.
 *
 * Production incident: the deployed Cloudflare Worker served a
 * GitHub Pages bundle. The browser requested
 * `/queryvanta/assets/...` on the Worker, the SPA fallback answered
 * with index.html as text/html, and Chromium refused the module, so
 * the page was blank.
 *
 * The base mechanism itself worked; nothing tied the artefact to the
 * deployment target, so whichever `npm run build` ran last decided
 * what shipped. These tests lock in the two things that prevent a
 * repeat:
 *
 *   1. each target produces a verifiably different, correct dist/
 *   2. the pre-deploy guard rejects the wrong target
 *
 * The suite builds both targets for real rather than inspecting
 * source, because the bug lived entirely in the generated artefact.
 */

const repoRoot = process.cwd();
const distDir = join(repoRoot, "dist");
const manifestPath = join(repoRoot, ".qv-build.json");

function build(target: string): void {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      join(repoRoot, "scripts", "build.mjs"),
      target,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `build:${target} failed\n` +
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function runScript(script: string, arg: string): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      join(repoRoot, "scripts", script),
      arg,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function distIndex(): string {
  return readFileSync(join(distDir, "index.html"), "utf8");
}

/**
 * Vite preserves the source formatting of index.html, and these
 * tags are written across multiple lines in the source. Collapsing
 * whitespace keeps the assertions about VALUES rather than layout.
 */
function normalizedDistIndex(): string {
  return distIndex().replace(/\s+/g, " ");
}

/**
 * Every href/content attribute value in index.html.
 *
 * Assertions about "which origin does this build advertise" must
 * look at tag values, not raw text: index.html carries explanatory
 * comments that legitimately name BOTH deployments, and a naive
 * substring search would flag the comment.
 */
function advertisedUrls(): string[] {
  const html = distIndex();

  return [
    ...html.matchAll(/\b(?:href|content)="([^"]+)"/g),
  ].map((match) => match[1] as string);
}

function manifest(): { target: string; base: string; siteUrl: string } {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function assetRefs(html: string): string[] {
  return [
    ...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]*)"/g),
  ].map((match) => match[1]);
}

/* -------------------------------------------------------------------------- */

describe("TARGET TABLE", () => {
  it("defines exactly the two real deployment targets", () => {
    assert.deepEqual(Object.keys(DEPLOY_TARGETS).sort(), [
      "pages",
      "worker",
    ]);
  });

  it("defaults to GitHub Pages so the existing CI keeps working", () => {
    // The live Pages workflow runs `npm run build`. Changing the
    // default would silently repoint the published site.
    assert.equal(DEFAULT_TARGET, "pages");
  });

  it("gives each target a distinct base", () => {
    assert.equal(DEPLOY_TARGETS.pages.base, "/queryvanta/");
    assert.equal(DEPLOY_TARGETS.worker.base, "/");
  });

  it("gives each target a distinct, correct origin", () => {
    assert.equal(
      DEPLOY_TARGETS.pages.siteUrl,
      "https://eagleanurag.github.io/queryvanta",
    );
    assert.equal(
      DEPLOY_TARGETS.worker.siteUrl,
      "https://queryvanta.queryvanta.workers.dev",
    );
  });

  it("uses bases that start and end with a slash", () => {
    for (const target of Object.values(DEPLOY_TARGETS)) {
      assert.ok(
        target.base.startsWith("/") && target.base.endsWith("/"),
        `${target.name} base must start and end with "/"`,
      );
    }
  });

  it("never puts a secret in a site URL", () => {
    for (const target of Object.values(DEPLOY_TARGETS)) {
      assert.match(target.siteUrl, /^https:\/\/[a-z0-9.-]+/i);
      assert.doesNotMatch(
        target.siteUrl,
        /secret|token|key|password/i,
        `${target.name} siteUrl must not look like a credential`,
      );
    }
  });

  it("rejects an unknown target instead of guessing", () => {
    assert.throws(
      () => resolveTarget("cloudflare-pages"),
      /Unknown build target/,
    );
  });

  it("resolves an empty or absent target to the default", () => {
    assert.equal(resolveTarget(undefined).name, DEFAULT_TARGET);
    assert.equal(resolveTarget("  ").name, DEFAULT_TARGET);
    assert.equal(resolveTarget("WORKER").name, "worker");
  });
});

/* -------------------------------------------------------------------------- */

describe("SOURCE SCANNER", () => {
  it("ignores a line comment", () => {
    assert.equal(
      countInLiveCode('// see /queryvanta/a.js\nconst a = 1;', "/queryvanta/"),
      0,
    );
  });

  it("ignores a block comment", () => {
    assert.equal(
      countInLiveCode(
        "/*\n * base is /queryvanta/ on Pages\n */\nconst a = 1;",
        "/queryvanta/",
      ),
      0,
    );
  });

  it("still finds a real string literal", () => {
    assert.equal(
      countInLiveCode(
        'const u = "/queryvanta/assets/a.js";',
        "/queryvanta/",
      ),
      1,
    );
  });

  it("does not treat a comment marker inside a string as a comment", () => {
    assert.equal(
      countInLiveCode(
        'const s = "http://x/y // not a comment /queryvanta/a";',
        "/queryvanta/",
      ),
      1,
    );
  });

  it("handles template literals with interpolation", () => {
    assert.equal(
      countInLiveCode(
        "const u = `${base}/queryvanta/a-${x}.js`;",
        "/queryvanta/",
      ),
      1,
    );
  });

  it("preserves line count so reported positions stay usable", () => {
    const source = "// a\n/* b\n c */\nconst a = 1;";
    assert.equal(
      stripComments(source).split("\n").length,
      source.split("\n").length,
    );
  });

  it("returns 0 for an empty needle rather than counting characters", () => {
    assert.equal(countInLiveCode("abc", ""), 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("WORKER BUILD ARTEFACT", () => {
  before(() => {
    build("worker");
  });

  it("records the target in the build manifest", () => {
    const recorded = manifest();

    assert.equal(recorded.target, "worker");
    assert.equal(recorded.base, "/");
    assert.equal(
      recorded.siteUrl,
      DEPLOY_TARGETS.worker.siteUrl,
    );
  });

  it("references assets from /assets/, never /queryvanta/assets/", () => {
    const html = distIndex();
    const refs = assetRefs(html);

    assert.ok(
      refs.length > 0,
      "the Worker build must reference built assets",
    );

    for (const ref of refs) {
      assert.ok(
        ref.startsWith("/assets/"),
        `Worker asset reference must be root-based, got "${ref}"`,
      );
      assert.doesNotMatch(ref, /^\/queryvanta\//);
    }

    assert.doesNotMatch(html, /\/queryvanta\/assets\//);
    assert.doesNotMatch(html, new RegExp(WORKER_FORBIDDEN_SEGMENT));
  });

  it("contains no /queryvanta/ reference at all in index.html", () => {
    assert.doesNotMatch(
      distIndex(),
      /\/queryvanta\//,
      "a Worker build must not mention the Pages base anywhere",
    );
  });

  it("points canonical and Open Graph tags at the Worker origin", () => {
    const html = normalizedDistIndex();
    const siteUrl = DEPLOY_TARGETS.worker.siteUrl;

    assert.ok(
      html.includes(`<link rel="canonical" href="${siteUrl}/" />`),
      "canonical must be the Worker origin",
    );
    assert.ok(
      html.includes(`<meta property="og:url" content="${siteUrl}/" />`),
    );
    assert.ok(
      html.includes(
        `<meta property="og:image" content="${siteUrl}/og-image.svg" />`,
      ),
    );
    assert.ok(
      !advertisedUrls().some((url) =>
        url.startsWith("https://eagleanurag.github.io/"),
      ),
      "the Worker build must not advertise the Pages origin in any tag",
    );
  });

  it("serves the favicon from the root", () => {
    assert.ok(
      normalizedDistIndex().includes(
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      ),
      "the favicon must be root-based for the Worker",
    );
  });

  it("leaves no unreplaced HTML placeholder", () => {
    const html = distIndex();

    assert.doesNotMatch(html, /%BASE_URL%/);
    assert.doesNotMatch(html, /%VITE_[A-Z0-9_]+%/);
  });

  it("contains no live /queryvanta/ reference in any built script", () => {
    // A Worker bundle that asked for /queryvanta/... would be broken
    // in exactly the way production was.
    const offenders: string[] = [];

    for (const file of walkJs()) {
      const live = stripComments(readFileSync(file, "utf8"));
      const hits = live.match(/["'`]\/queryvanta\//g)?.length ?? 0;

      if (hits > 0) {
        offenders.push(`${file} (${hits})`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "Worker build embeds the Pages base in live code",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("PAGES BUILD ARTEFACT", () => {
  before(() => {
    build("pages");
  });

  it("records the target in the build manifest", () => {
    const recorded = manifest();

    assert.equal(recorded.target, "pages");
    assert.equal(recorded.base, "/queryvanta/");
  });

  it("references assets from /queryvanta/assets/", () => {
    const html = distIndex();
    const refs = assetRefs(html);

    assert.ok(refs.length > 0);
    assert.match(html, /\/queryvanta\/assets\//);

    for (const ref of refs) {
      assert.ok(
        ref.startsWith("/queryvanta/assets/"),
        `Pages asset reference must be prefixed, got "${ref}"`,
      );
    }
  });

  it("points canonical and Open Graph tags at the Pages origin", () => {
    const html = normalizedDistIndex();
    const siteUrl = DEPLOY_TARGETS.pages.siteUrl;

    assert.ok(
      html.includes(`<link rel="canonical" href="${siteUrl}/" />`),
    );
    assert.ok(
      html.includes(
        '<link rel="icon" type="image/svg+xml" ' +
          'href="/queryvanta/favicon.svg" />',
      ),
      "the favicon must resolve under the Pages base",
    );
    assert.ok(
      !advertisedUrls().some((url) =>
        url.startsWith("https://queryvanta.queryvanta.workers.dev"),
      ),
      "a Pages build must not advertise the Worker origin in any tag",
    );
  });

  it("keeps WASM/data URLs under the Pages base", () => {
    // PGlite embeds base-relative WASM URLs. A bare `/assets/`
    // substring search would wrongly flag `/queryvanta/assets/`,
    // which is correct here.
    let baseRelative = 0;
    let rootRelative = 0;

    for (const file of walkJs()) {
      const live = stripComments(readFileSync(file, "utf8"));

      baseRelative +=
        live.match(/["'`]\/queryvanta\/assets\//g)?.length ?? 0;
      rootRelative += live.match(/["'`]\/assets\//g)?.length ?? 0;
    }

    assert.equal(
      rootRelative,
      0,
      "a Pages build must not contain root-based asset literals",
    );
    assert.ok(
      baseRelative > 0,
      "expected base-rewritten WASM/data URLs in the Pages build",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("PRE-DEPLOY GUARD", () => {
  after(() => {
    // Leave the tree in the state the pre-deploy guard accepts so a
    // following `test:worker` run has the bundle it needs.
    build("worker");
  });

  it("rejects a GitHub Pages build with the required message", () => {
    // The previous block left dist/ as a Pages build.
    assert.equal(manifest().target, "pages");

    const result = runScript("predeploy-worker.mjs", "unused");

    assert.notEqual(
      result.status,
      0,
      "the guard must fail on a Pages build",
    );
    assert.match(
      result.output,
      /Worker build has GitHub Pages base \/queryvanta\/\. Rebuild with the Worker target\./,
      "the guard must print the documented remediation",
    );
    assert.match(result.output, /npm run build:worker/);
  });

  it("accepts a Worker build", () => {
    build("worker");

    const result = runScript("predeploy-worker.mjs", "unused");

    assert.equal(
      result.status,
      0,
      `the guard must pass on a Worker build:\n${result.output}`,
    );
    assert.match(result.output, /Worker pre-deploy check passed/);
  });

  it("fails post-build verification when a Pages dist is checked as a Worker", () => {
    build("pages");

    const result = runScript("verify-build.mjs", "worker");

    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /Worker build has GitHub Pages base \/queryvanta\//,
    );

    build("worker");
  });
});

/* -------------------------------------------------------------------------- */

/** Every built .js/.mjs file under dist/. */
function walkJs(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (/\.(js|mjs)$/.test(entry)) {
        out.push(full);
      }
    }
  }

  if (existsSync(distDir)) {
    walk(distDir);
  }

  return out;
}
