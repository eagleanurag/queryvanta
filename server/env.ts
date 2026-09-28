/**
 * Worker environment bindings.
 *
 * Secrets are supplied with `wrangler secret put` and are never
 * exposed to the browser bundle. The Vite build has no knowledge of
 * any of these values, and no `VITE_`-prefixed variable is used to
 * carry a credential.
 */

export type Env = {
  /** D1 binding. */
  DB: D1Database;

  /**
   * Workers Static Assets binding. Serves the built SPA and
   * provides the single-page-application fallback.
   */
  ASSETS: Fetcher;

  /**
   * Public GitHub OAuth client id. Not a secret: it appears in the
   * authorization URL the browser is redirected to.
   */
  GITHUB_CLIENT_ID: string;

  /**
   * GitHub OAuth client secret. SERVER ONLY — stored as a Worker
   * secret, never sent to the client.
   */
  GITHUB_CLIENT_SECRET: string;

  /**
   * Secret used to derive the OAuth state and PKCE verifier, and to
   * hash session tokens with a per-deployment salt. SERVER ONLY.
   */
  SESSION_SECRET: string;

  /**
   * Comma-separated allow-list of immutable GitHub numeric user IDs
   * permitted to administer QueryVanta. Empty means "deny all",
   * which fails closed.
   */
  ADMIN_GITHUB_IDS: string;

  /** "production" | "development" | "test". */
  ENVIRONMENT: string;

  /**
   * Absolute origin of the deployment, used for OAuth redirects and
   * strict origin comparison. No trailing slash.
   */
  APP_ORIGIN: string;

  /**
   * Development-only authentication bypass.
   *
   * Refuses to activate unless ENVIRONMENT is explicitly "development"
   * or "test" AND the secret matches. It is rejected outright in
   * production, so the bypass cannot be enabled by accident.
   */
  DEV_AUTH_BYPASS_SECRET?: string;
};

/** True only for an explicit non-production deployment. */
export function isDevelopment(env: Env): boolean {
  return (
    env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test"
  );
}

/**
 * Parse the admin allow-list into immutable GitHub numeric IDs.
 * A malformed or empty list yields an empty set (deny all).
 */
export function parseAdminGitHubIds(
  raw: string | undefined,
): ReadonlySet<string> {
  if (typeof raw !== "string" || raw.trim() === "") {
    return new Set<string>();
  }

  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));

  return new Set(ids);
}
