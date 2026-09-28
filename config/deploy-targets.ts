/**
 * QueryVanta deployment targets.
 *
 * SINGLE SOURCE OF TRUTH for the base path and the public site URL.
 *
 *   GitHub Pages  ->  /queryvanta/   (existing fallback, CI default)
 *   Cloudflare    ->  /             (Worker serves app + API on one origin)
 *
 * Every consumer reads this file, so one target can never disagree
 * with another:
 *
 *   vite.config.ts              -> `base`
 *   scripts/generate-seo-assets -> sitemap.xml, canonical, JSON-LD
 *   src/lib/seo.ts               -> canonical + Open Graph URLs
 *   scripts/verify-build.mjs     -> post-build assertions
 *   scripts/predeploy-worker.mjs -> pre-deploy guard
 *
 * Written in erasable TypeScript only (enforced by the
 * `erasableSyntaxOnly` compiler option) so it can be imported both
 * by Vite and by the Node scripts running with type-stripping.
 */

export type DeployTargetName = "pages" | "worker";

export type DeployTarget = {
  name: DeployTargetName;
  label: string;
  base: string;
  siteUrl: string;
};

export const DEPLOY_TARGETS: Record<DeployTargetName, DeployTarget> = {
  pages: {
    name: "pages",
    label: "GitHub Pages",
    base: "/queryvanta/",
    siteUrl: "https://eagleanurag.github.io/queryvanta",
  },
  worker: {
    name: "worker",
    label: "Cloudflare Worker",
    base: "/",
    siteUrl: "https://queryvanta.queryvanta.workers.dev",
  },
};

/**
 * The default target.
 *
 * `npm run build` maps to this. The existing GitHub Pages workflow
 * runs `npm run build`, so keeping the default on `pages` leaves the
 * live Pages deployment unaffected. Worker deployments must use the
 * explicit `npm run build:worker`, which is what the pre-deploy
 * guard enforces.
 */
export const DEFAULT_TARGET: DeployTargetName = "pages";

/** Path segment that must never appear in a Worker build. */
export const WORKER_FORBIDDEN_SEGMENT = "/queryvanta/";

export function resolveTarget(
  name?: string | null,
): DeployTarget {
  const key = (name ?? DEFAULT_TARGET).trim().toLowerCase();

  if (key === "") {
    return DEPLOY_TARGETS[DEFAULT_TARGET];
  }

  const target = DEPLOY_TARGETS[key as DeployTargetName];

  if (!target) {
    throw new Error(
      `Unknown build target "${name}". Expected one of: ` +
        Object.keys(DEPLOY_TARGETS).join(", "),
    );
  }

  return target;
}
