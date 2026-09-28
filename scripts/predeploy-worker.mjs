/**
 * Worker pre-deploy safety check.
 *
 * Run this immediately before `npx wrangler deploy --config
 * ./wrangler.jsonc`. It refuses to let a GitHub Pages build reach
 * the Cloudflare Worker, which is the failure that produced blank
 * pages with MIME-type errors:
 *
 *   the browser requested /queryvanta/assets/... on the Worker,
 *   the SPA fallback answered with index.html as text/html, and
 *   Chromium refused the module.
 *
 * The check inspects the real dist/ artefact. It never deploys.
 *
 * Usage:
 *   npm run verify:worker
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  DEPLOY_TARGETS,
  WORKER_FORBIDDEN_SEGMENT,
} from "../config/deploy-targets.ts";
import { countInLiveCode } from "../config/source-scanner.ts";

const repoRoot = process.cwd();
const distDir = join(repoRoot, "dist");
const indexPath = join(distDir, "index.html");
const problems = [];

function walk(dir) {
  const out = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }

    if (/\.(js|mjs|css|html|map)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

if (!existsSync(indexPath)) {
  problems.push(
    "dist/index.html does not exist. Nothing has been built.",
  );
}

if (problems.length === 0) {
  const indexHtml = readFileSync(indexPath, "utf8");
  const files = walk(distDir);

  // 1. index.html must not reference the Pages base.
  if (indexHtml.includes(`${WORKER_FORBIDDEN_SEGMENT}assets/`)) {
    problems.push(
      `index.html contains ${WORKER_FORBIDDEN_SEGMENT}assets/`,
    );
  }

  if (indexHtml.includes(WORKER_FORBIDDEN_SEGMENT)) {
    problems.push(
      `index.html contains the GitHub Pages base ${WORKER_FORBIDDEN_SEGMENT}`,
    );
  }

  // 2. index.html must reference root-based assets.
  if (!/<script[^>]+src="\/assets\//.test(indexHtml)) {
    problems.push(
      'index.html does not reference a root-based "/assets/..." script.',
    );
  }

  // 3. No JS/CSS artefact may embed the Pages base in live code.
  //    Comments are ignored: a file may legitimately document that
  //    it also runs under a project-pages subpath.
  const offenders = files.filter(
    (file) =>
      countInLiveCode(
        readFileSync(file, "utf8"),
        WORKER_FORBIDDEN_SEGMENT,
      ) > 0,
  );

  if (offenders.length > 0) {
    problems.push(
      `${offenders.length} built asset(s) embed the GitHub Pages base: ` +
        offenders
          .slice(0, 3)
          .map((file) => file.replace(`${repoRoot}\\`, ""))
          .join(", "),
    );
  }

  // 4. The build must be recorded as a Worker build.
  const manifestPath = join(repoRoot, ".qv-build.json");

  if (!existsSync(manifestPath)) {
    problems.push(
      ".qv-build.json is missing, so the build target is unknown.",
    );
  } else {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    );

    if (manifest.target !== DEPLOY_TARGETS.worker.name) {
      problems.push(
        `The last build was for target "${manifest.target}", not ` +
          `"${DEPLOY_TARGETS.worker.name}".`,
      );
    }

    if (manifest.base !== "/") {
      problems.push(
        `The last build used base "${manifest.base}", not "/".`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("");
  console.error("Worker pre-deploy check FAILED:");
  console.error("");

  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }

  console.error("");
  console.error(
    "Worker build has GitHub Pages base /queryvanta/. Rebuild with the Worker target.",
  );
  console.error("");
  console.error("  npm run build:worker");
  console.error(
    "  npm run verify:worker",
  );
  console.error("  npx wrangler deploy --config ./wrangler.jsonc");
  process.exit(1);
}

console.log(
  "Worker pre-deploy check passed: dist/ is a root-base " +
    '(base "/") build with no /queryvanta/ references.',
);
console.log(
  "Safe to run: npx wrangler deploy --config ./wrangler.jsonc",
);
