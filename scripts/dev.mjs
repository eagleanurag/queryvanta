/**
 * Target-aware dev server.
 *
 * `npm run dev` previously ran bare `vite`, which never received
 * `VITE_QV_SITE_URL`. Vite substitutes `%VITE_QV_SITE_URL%` in
 * index.html from the environment, so development served a literal
 * placeholder:
 *
 *   <link rel="canonical" href="%VITE_QV_SITE_URL%/" />
 *
 * Production was never affected: `scripts/build.mjs` sets the
 * variable, and `scripts/verify-build.mjs` fails any build that
 * leaves a placeholder unreplaced. But a broken canonical in dev is
 * still a defect, and the hundreds of Vite warnings it produced made
 * real warnings easy to miss.
 *
 * This wrapper reuses the same deployment-target table as the build
 * so the dev server and the production bundles cannot disagree:
 *
 *   npm run dev              -> pages target  (base /queryvanta/)
 *   npm run dev -- worker    -> worker target (base /)
 *
 * Any extra arguments are forwarded to Vite unchanged, so
 * `npm run dev -- --port 5173 --strictPort` still works.
 *
 * Nothing here is deployment.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

import { resolveTarget } from "../config/deploy-targets.ts";

const repoRoot = process.cwd();

// The first positional argument is the target; everything after it
// belongs to Vite.
const [maybeTarget, ...rest] = process.argv.slice(2);

const isViteFlag = (value) => value.startsWith("-");

// `npm run dev -- --port 5173` passes only Vite flags, so the first
// argument must be forwarded rather than consumed as a target name.
const targetName = isViteFlag(maybeTarget ?? "")
  ? process.env.QV_TARGET
  : maybeTarget;

const viteArgs = isViteFlag(maybeTarget ?? "")
  ? [maybeTarget, ...rest]
  : rest;

const target = resolveTarget(targetName);

const env = {
  ...process.env,
  QV_TARGET: target.name,
  QV_BASE: target.base,
  QV_SITE_URL: target.siteUrl,
  VITE_QV_SITE_URL: target.siteUrl,
};

console.log(
  `Dev target: ${target.name} (${target.label})\n` +
    `  base    : ${target.base}\n` +
    `  site URL: ${target.siteUrl}`,
);

const child = spawn(
  process.execPath,
  [join(repoRoot, "node_modules", "vite", "bin", "vite.js"), ...viteArgs],
  { cwd: repoRoot, env, stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
