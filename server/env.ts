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

  /**
   * Retention window for `admin_audit_log`, in days. Not a secret: it
   * is a storage bound read from `wrangler.jsonc` `vars`, never a
   * credential. A missing, zero, negative or non-numeric value falls
   * back to DEFAULT_AUDIT_RETENTION_DAYS at read time.
   */
  AUDIT_RETENTION_DAYS: string;

  /**
   * Retention window for `analytics_daily`, in days. Not a secret: it is a
   * storage bound read from `wrangler.jsonc` `vars`, never a credential. A
   * missing, zero, negative or non-numeric value falls back to
   * DEFAULT_ANALYTICS_RETENTION_DAYS at read time.
   *
   * Deliberately a different, longer window from AUDIT_RETENTION_DAYS:
   * analytics is a product trend record where an old daily bucket is
   * worthless, while the audit log is an investigation record where it is
   * not. The two must not share a window.
   */
  ANALYTICS_RETENTION_DAYS: string;
};

/**
 * Safe fallback retention window for `admin_audit_log`, in days. Used
 * when AUDIT_RETENTION_DAYS is missing, zero, negative or non-numeric,
 * so a bad configuration can never delete everything or nothing.
 */
export const DEFAULT_AUDIT_RETENTION_DAYS = 90;

/**
 * Parse the audit-log retention window in days.
 *
 * A missing, empty, zero, negative or non-numeric value yields
 * DEFAULT_AUDIT_RETENTION_DAYS rather than deleting everything or
 * nothing. Any positive finite number is accepted as-is.
 */
export function parseAuditRetentionDays(
  raw: string | undefined,
): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }

  return parsed;
}

/**
 * Safe fallback retention window for `analytics_daily`, in days.
 *
 * A year of daily buckets, which keeps a year of trend data while bounding
 * the table at a few MB. Used when ANALYTICS_RETENTION_DAYS is missing,
 * zero, negative or non-numeric.
 */
export const DEFAULT_ANALYTICS_RETENTION_DAYS = 400;

/**
 * Parse the analytics retention window in days.
 *
 * Mirrors `parseAuditRetentionDays` exactly, including the fail-safe
 * behaviour: a bad configuration falls back to the default rather than
 * deleting everything or nothing. Kept next to the audit parser so both
 * retention policies are visible together.
 */
export function parseAnalyticsRetentionDays(
  raw: string | undefined,
): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_ANALYTICS_RETENTION_DAYS;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ANALYTICS_RETENTION_DAYS;
  }

  return parsed;
}

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
