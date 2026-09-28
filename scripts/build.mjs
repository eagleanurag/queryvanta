/**
 * Target-driven build wrapper.
 *
 * Replaces "set an environment variable by hand before running
 * npm run build", which was the root cause of the production
 * incident: the previous mechanism worked, but nothing tied the
 * deployed artefact to the deployment target, so the last
 * `npm run build` run decided what shipped.
 *
 * Usage:
 *   node scripts/build.mjs            -> pages  (default)
 *   node scripts/build.mjs worker     -> worker
 *
 * Portable on Windows, macOS and Linux: the environment is set in
 * this process, so the child processes inherit it without any
 * shell-specific syntax.
 *
 * Steps mirror the previous pipeline exactly, in the same order:
 *   1. prebuild  - generate sitemap.xml + landing snapshots
 *   2. tsc -b    - typecheck
 *   3. vite build
 *   4. verify    - assert the artefact matches the target
 *
 * Nothing here is deployment. `wrangler deploy` is never invoked.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveTarget } from "../config/deploy-targets.ts";

const repoRoot = process.cwd();
const target = resolveTarget(process.argv[2]);

const env = {
  ...process.env,
  QV_TARGET: target.name,
  QV_BASE: target.base,
  QV_SITE_URL: target.siteUrl,
  // Vite only exposes vars prefixed with VITE_ to the client. This
  // carries a public site URL only, never a credential.
  VITE_QV_SITE_URL: target.siteUrl,
};

console.log(
  `Build target: ${target.name} (${target.label})\n` +
    `  base    : ${target.base}\n` +
    `  site URL: ${target.siteUrl}`,
);

function run(command, args, label) {
  console.log(`\n> ${label}`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(
      `\nBuild failed during "${label}" (exit ${result.status}).`,
    );
    process.exit(result.status ?? 1);
  }
}

const node = process.execPath;

// 1. prebuild
run(
  node,
  ["--experimental-strip-types", "scripts/generate-seo-assets.mjs"],
  "prebuild: generate SEO assets",
);

// 2. typecheck
run(
  node,
  ["node_modules/typescript/bin/tsc", "-b"],
  "typecheck: tsc -b",
);

// 3. build
run(
  node,
  ["node_modules/vite/bin/vite.js", "build"],
  "build: vite build",
);

// 4. record what was built, then verify the artefact really matches
const manifestPath = join(repoRoot, ".qv-build.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      target: target.name,
      label: target.label,
      base: target.base,
      siteUrl: target.siteUrl,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (!existsSync(join(repoRoot, "dist", "index.html"))) {
  console.error(
    "\ndist/index.html is missing. The build produced no artefact.",
  );
  process.exit(1);
}

run(
  node,
  ["scripts/verify-build.mjs", target.name],
  "verify: assert artefact matches the target",
);

console.log(`\nBuild complete for target "${target.name}".`);
