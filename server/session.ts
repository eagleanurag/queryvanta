/**
 * Server-side opaque admin sessions.
 *
 * - A cryptographically random token is generated per login.
 * - Only a salted SHA-256 hash of the token is persisted, so a
 *   database leak cannot be replayed as a live session.
 * - Expiry and revocation are enforced on EVERY read, server side.
 * - The raw token is returned to the browser only once, in an
 *   HttpOnly cookie. It is never exposed to JavaScript.
 */

import {
  randomToken,
  sessionTokenHash,
} from "./crypto.ts";
import {
  clearSessionCookie,
  sessionCookie,
} from "./http.ts";
import { readSessionCookie } from "./request.ts";

export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
export const IDLE_TTL_SECONDS = 60 * 60 * 2; // 2 hours

/**
 * How stale `last_seen_at` must be before a read refreshes it (audit
 * finding V-04).
 *
 * This is a WRITE-THROTTLE, not a lifetime. The idle timeout above is
 * unchanged and still evaluated against the stored value on every read.
 * Sixty seconds is the audit's figure and is comfortably below
 * IDLE_TTL_SECONDS, so the lag it introduces can never approach the
 * timeout it protects.
 */
export const LAST_SEEN_WRITE_THRESHOLD_SECONDS = 60;

export type AdminSession = {
  id: string;
  adminGithubId: string;
  githubLogin: string | null;
  githubAvatarUrl: string | null;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type SessionRow = {
  id: string;
  admin_github_id: string;
  github_login: string | null;
  github_avatar_url: string | null;
  csrf_token: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
};

function toSession(row: SessionRow): AdminSession {
  return {
    id: row.id,
    adminGithubId: row.admin_github_id,
    githubLogin: row.github_login ?? null,
    githubAvatarUrl: row.github_avatar_url ?? null,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at ?? null,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function createSession(
  db: D1Database,
  options: {
    adminGithubId: string;
    githubLogin: string | null;
    githubAvatarUrl: string | null;
    secret: string;
  },
): Promise<{
  session: AdminSession;
  token: string;
  cookie: string;
  secure: boolean;
}> {
  const token = randomToken(32);
  const tokenHash = await sessionTokenHash(
    token,
    options.secret,
  );
  const csrfToken = randomToken(32);
  const id = randomToken(16);

  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_TTL_SECONDS * 1000,
  );

  await db
    .prepare(
      `INSERT INTO admin_sessions (
         id, admin_github_id, github_login, github_avatar_url,
         token_hash, csrf_token, created_at, updated_at,
         last_seen_at, expires_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      id,
      options.adminGithubId,
      options.githubLogin,
      options.githubAvatarUrl,
      tokenHash,
      csrfToken,
      createdAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString(),
      expiresAt.toISOString(),
    )
    .run();

  const secure = true;

  return {
    session: {
      id,
      adminGithubId: options.adminGithubId,
      githubLogin: options.githubLogin,
      githubAvatarUrl: options.githubAvatarUrl,
      csrfToken,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: createdAt.toISOString(),
      revokedAt: null,
    },
    token,
    cookie: sessionCookie(token, {
      maxAgeSec: SESSION_TTL_SECONDS,
      secure,
      expires: expiresAt,
    }),
    secure,
  };
}

export type SessionLookup = {
  session: AdminSession | null;
  reason:
    | "ok"
    | "missing"
    | "malformed"
    | "revoked"
    | "expired";
};

/**
 * Resolve and validate the session cookie.
 *
 * Every protected endpoint calls this. There is no client-side
 * equivalent and no cached "is admin" flag.
 */
export async function lookupSession(
  db: D1Database,
  request: Request,
  secret: string,
): Promise<SessionLookup> {
  const token = readSessionCookie(request);

  if (token === null || token === "") {
    return { session: null, reason: "missing" };
  }

  if (!/^[a-f0-9]{64}$/.test(token)) {
    // Malformed token: never attempt a lookup.
    return { session: null, reason: "malformed" };
  }

  const tokenHash = await sessionTokenHash(token, secret);

  const row = await db
    .prepare(
      `SELECT * FROM admin_sessions WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!row) {
    return { session: null, reason: "missing" };
  }

  if (row.revoked_at !== null) {
    return { session: null, reason: "revoked" };
  }

  const now = Date.now();

  if (Date.parse(row.expires_at) <= now) {
    // Expiry is enforced here, not by trusting the cookie.
    await db
      .prepare(
        `UPDATE admin_sessions
            SET revoked_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(nowIso(), nowIso(), row.id)
      .run();

    return { session: null, reason: "expired" };
  }

  if (
    Date.parse(row.last_seen_at) + IDLE_TTL_SECONDS * 1000 <=
    now
  ) {
    await db
      .prepare(
        `UPDATE admin_sessions
            SET revoked_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(nowIso(), nowIso(), row.id)
      .run();

    return { session: null, reason: "expired" };
  }

  // V-04: a read used to be a write.
  //
  // Every authenticated read - including the admin SPA's session poll -
  // issued an `UPDATE` to bump `last_seen_at`, so D1 row-writes scaled with
  // admin usage rather than with anything the write was protecting.
  //
  // The timestamp is only refreshed once it is genuinely stale, measured
  // against LAST_SEEN_WRITE_THRESHOLD_SECONDS (60s, the audit's figure).
  //
  // THE IDLE TIMEOUT IS NOT WEAKENED
  // The idle check above runs BEFORE this, against the stored value, so a
  // session is still revoked the moment `last_seen_at` is older than
  // IDLE_TTL_SECONDS. The worst case this introduces is that a session
  // which is used continuously can live up to one threshold interval
  // longer than its nominal idle window: the timestamp lags real activity
  // by at most 60 seconds. That is the same order as the polling interval
  // the value was already quantised to, and it is strictly a LAG, never an
  // extension granted to an idle session.
  //
  // `lastSeenAt` in the returned session reflects the value actually
  // persisted, so a client can never observe a freshness the database
  // does not have.
  const staleAfterMs = LAST_SEEN_WRITE_THRESHOLD_SECONDS * 1000;
  const lastSeenAge = now - Date.parse(row.last_seen_at);
  const isStale = !Number.isFinite(lastSeenAge) || lastSeenAge >= staleAfterMs;

  if (!isStale) {
    return {
      session: toSession(row),
      reason: "ok",
    };
  }

  const lastSeen = nowIso();

  await db
    .prepare(
      `UPDATE admin_sessions
          SET last_seen_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(lastSeen, lastSeen, row.id)
    .run();

  return {
    session: { ...toSession(row), lastSeenAt: lastSeen },
    reason: "ok",
  };
}

export async function revokeSessionByToken(
  db: D1Database,
  request: Request,
  secret: string,
): Promise<boolean> {
  const token = readSessionCookie(request);

  if (token === null || !/^[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  const tokenHash = await sessionTokenHash(token, secret);
  const now = nowIso();

  const result = await db
    .prepare(
      `UPDATE admin_sessions
          SET revoked_at = ?, updated_at = ?
        WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(now, now, tokenHash)
    .run();

  return (
    (result.meta?.changes ?? 0) > 0
  );
}

export async function revokeAllSessionsForUser(
  db: D1Database,
  adminGithubId: string,
): Promise<void> {
  const now = nowIso();

  await db
    .prepare(
      `UPDATE admin_sessions
          SET revoked_at = ?, updated_at = ?
        WHERE admin_github_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, now, adminGithubId)
    .run();
}

export async function purgeExpiredSessions(
  db: D1Database,
): Promise<void> {
  const cutoff = new Date(
    Date.now() - SESSION_TTL_SECONDS * 1000,
  ).toISOString();

  await db
    .prepare(
      `DELETE FROM admin_sessions
        WHERE expires_at < ? OR revoked_at IS NOT NULL`,
    )
    .bind(cutoff)
    .run();
}

export function logoutCookie(secure: boolean): string {
  return clearSessionCookie(secure);
}
