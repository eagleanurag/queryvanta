/**
 * Post-build artefact verification.
 *
 * Proves that dist/ actually matches the selected build target by
 * inspecting the generated files, not the source. This is what
 * prevents a GitHub Pages build from being deployed as a Worker.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-build.mjs [target]
 *
 * Exits non-zero and prints a clear message on any mismatch.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  resolveTarget,
  WORKER_FORBIDDEN_SEGMENT,
} from "../config/deploy-targets.ts";
import { stripComments } from "../config/source-scanner.ts";

const repoRoot = process.cwd();
const distDir = join(repoRoot, "dist");
const target = resolveTarget(process.argv[2]);

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function relative(file) {
  return file.replace(`${repoRoot}\\`, "");
}

function walk(dir) {
  const out = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }

    if (/\.(js|mjs|css|html|json|map|wasm)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

const indexPath = join(distDir, "index.html");

let indexHtml = "";

try {
  indexHtml = readFileSync(indexPath, "utf8");
} catch {
  console.error(
    "dist/index.html not found. Run the build before verifying.",
  );
  process.exit(1);
}

const files = walk(distDir);

/* -------------------------------------------------------------------------- */
/* shared assertions                                                           */
/* -------------------------------------------------------------------------- */

const manifestPath = join(repoRoot, ".qv-build.json");

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.target !== target.name) {
    fail(
      `Build manifest says target "${manifest.target}" but the ` +
        `verifier was asked for "${target.name}".`,
    );
  } else {
    notes.push(
      `manifest target=${manifest.target} base=${manifest.base}`,
    );
  }
} catch {
  fail(
    ".qv-build.json is missing. Use `npm run build:<target>` rather " +
      "than invoking vite directly.",
  );
}

// The app must reference its own module entry point.
if (!/<script[^>]+src="[^"]*index-[^"]*\.js"/.test(indexHtml)) {
  fail("dist/index.html does not reference a built JS entry point.");
}

// Unreplaced HTML placeholders mean a required variable was absent,
// which would ship a broken canonical URL or favicon path.
const unreplaced = indexHtml.match(/%(?:BASE_URL|VITE_[A-Z0-9_]+)%/g);

if (unreplaced) {
  fail(
    "dist/index.html contains unreplaced placeholder(s): " +
      [...new Set(unreplaced)].join(", "),
  );
}

// Every asset reference in index.html must respect the target base.
const assetRefs = [
  ...indexHtml.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]*)"/g),
].map((match) => match[1]);

if (assetRefs.length === 0) {
  fail("dist/index.html contains no /assets/ references.");
}

const expectedPrefix = `${target.base}assets/`;
const wrongRefs = assetRefs.filter(
  (ref) => !ref.startsWith(expectedPrefix),
);

if (wrongRefs.length > 0) {
  fail(
    `dist/index.html has ${wrongRefs.length} asset reference(s) that do ` +
      `not start with "${expectedPrefix}": ` +
      wrongRefs.slice(0, 5).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* live-code base check                                                         */
/* -------------------------------------------------------------------------- */

/*
 * Two rules keep this precise:
 *
 *  1. Comments are stripped first. Documentation may legitimately
 *     mention the other deployment path (public/worker/
 *     pyspark-test-worker.js does exactly that), but live code must
 *     never reference it. Scanning comments would make the guard
 *     fail for harmless reasons, which is how real guards get
 *     switched off.
 *
 *  2. The match is anchored to a quoted string literal. In a Pages
 *     build `/queryvanta/assets/initdb-<hash>.wasm` is CORRECT, so a
 *     bare substring search for `/assets/` would wrongly reject it.
 *     The other base only counts when a string STARTS with it.
 */
const jsFiles = files.filter((file) => /\.(js|mjs)$/.test(file));
const cssFiles = files.filter((file) => /\.css$/.test(file));

const wrongBasePattern =
  target.name === "worker"
    ? /["'`]\/queryvanta\//g
    : /["'`]\/assets\//g;

const wrongBaseLabel = target.name === "worker" ? "/queryvanta/" : "/";

let wrongBaseHits = 0;
const wrongBaseFiles = [];

for (const file of [...jsFiles, ...cssFiles]) {
  const live = stripComments(readFileSync(file, "utf8"));
  const hits = live.match(wrongBasePattern)?.length ?? 0;

  if (hits > 0) {
    wrongBaseHits += hits;
    wrongBaseFiles.push(`${relative(file)} (${hits})`);
  }
}

if (wrongBaseHits > 0) {
  fail(
    `Built assets contain ${wrongBaseHits} string literal(s) starting ` +
      `with the wrong base "${wrongBaseLabel}": ` +
      wrongBaseFiles.slice(0, 3).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* target-specific assertions                                                   */
/* -------------------------------------------------------------------------- */

if (target.name === "worker") {
  if (target.base !== "/") {
    fail(`Worker target base must be "/" (found "${target.base}").`);
  }

  if (indexHtml.includes(WORKER_FORBIDDEN_SEGMENT)) {
    fail(
      "dist/index.html contains the GitHub Pages base " +
        `"${WORKER_FORBIDDEN_SEGMENT}".`,
    );
  }

  // The Worker origin must be the one the bundle points at.
  if (!indexHtml.includes(target.siteUrl)) {
    fail(
      `dist/index.html does not reference the Worker origin ` +
        `"${target.siteUrl}".`,
    );
  }

  notes.push(
    `worker build verified: ${assetRefs.length} root-based asset ` +
      "reference(s), 0 Pages-base references",
  );
} else {
  if (target.base !== "/queryvanta/") {
    fail(
      `Pages target base must be "/queryvanta/" (found ` +
        `"${target.base}").`,
    );
  }

  if (!indexHtml.includes("/queryvanta/assets/")) {
    fail("dist/index.html does not reference /queryvanta/assets/.");
  }

  if (!indexHtml.includes(target.siteUrl)) {
    fail(
      `dist/index.html does not reference the Pages origin ` +
        `"${target.siteUrl}".`,
    );
  }

  notes.push(
    `pages build verified: ${assetRefs.length} Pages-based asset ` +
      "reference(s)",
  );
}

/* -------------------------------------------------------------------------- */
/* report                                                                      */
/* -------------------------------------------------------------------------- */

for (const note of notes) {
  console.log(`  ok  ${note}`);
}

if (failures.length > 0) {
  console.error("");

  for (const message of failures) {
    console.error(`  FAIL  ${message}`);
  }

  console.error("");
  console.error(
    target.name === "worker"
      ? "Worker build has GitHub Pages base /queryvanta/. Rebuild with the Worker target."
      : "Build artefact does not match the GitHub Pages target.",
  );
  console.error(
    `Expected base "${target.base}" (target "${target.name}").`,
  );
  process.exit(1);
}

console.log(
  `\nVerified: dist/ matches the "${target.name}" target ` +
    `(base ${target.base}).`,
);
