/**
 * QueryVanta deployment targets.
 *
 * SINGLE SOURCE OF TRUTH for the base path, the public site URL, and
 * whether a server-side API exists on the target at all.
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
 *   src/lib/analytics.ts         -> whether an ingest endpoint is reachable
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
  /**
   * Whether this target serves the `/api/*` family.
   *
   * A build-time fact, not a runtime guess. GitHub Pages is a static
   * host with no Worker, so EVERY `/api/*` path there answers 404 or
   * with HTML. That matters because a failed request is not silent: the
   * browser logs a console error for each one. A client cannot probe its
   * way to a negative answer without paying at least one such error, so
   * the only way to keep a static deployment's console clean is to know
   * before the first request that there is nothing to talk to.
   *
   * `worker: true` is not a promise that the deployment is healthy. The
   * client still confirms it at runtime, once, through the existing
   * `probeApi()`.
   */
  hasApi: boolean;
};

export const DEPLOY_TARGETS: Record<DeployTargetName, DeployTarget> = {
  pages: {
    name: "pages",
    label: "GitHub Pages",
    base: "/queryvanta/",
    siteUrl: "https://eagleanurag.github.io/queryvanta",
    hasApi: false,
  },
  worker: {
    name: "worker",
    label: "Cloudflare Worker",
    base: "/",
    siteUrl: "https://queryvanta.queryvanta.workers.dev",
    hasApi: true,
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
