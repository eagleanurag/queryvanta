/**
 * GitHub OAuth (authorization code + PKCE) for administrator sign-in.
 *
 * Security properties:
 *  - `state` is a 256-bit random value; only its SHA-256 hash is
 *    stored, so a database dump cannot forge a live callback.
 *  - PKCE S256 is used, binding the code exchange to the transaction
 *    that created it (defense in depth against code interception).
 *  - The transaction is single-use: `consumed_at` is set inside the
 *    same read-modify-write and a replayed callback is rejected.
 *  - Transactions expire after 10 minutes.
 *  - The post-login redirect target is chosen from a strict
 *    allow-list, never from a raw URL parameter.
 *  - The client secret never leaves the Worker and is never logged.
 *  - Authorization uses the immutable GitHub NUMERIC user id.
 */

import {
  codeChallengeS256,
  createCodeVerifier,
  randomToken,
  sha256Hex,
} from "./crypto.ts";
import { nowIso } from "./session.ts";

/**
 * Only these relative paths may be used as a post-login redirect.
 * Anything else falls back to the admin questions page. This is an
 * allow-list, so an attacker cannot craft an open redirect.
 */
const ALLOWED_REDIRECT_PATHS = [
  "/admin/questions",
  "/admin",
] as const;

export const DEFAULT_REDIRECT_PATH = "/admin/questions";
export const OAUTH_TXN_TTL_SECONDS = 600; // 10 minutes

export type GithubIdentity = {
  id: string;
  login: string;
  avatarUrl: string | null;
};

type OAuthTxnRow = {
  state_hash: string;
  code_verifier: string;
  redirect_to: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

/** Shape of a row read back after a transaction is consumed. */
export type ConsumedRow = Pick<
  OAuthTxnRow,
  "code_verifier" | "redirect_to"
>;

export function safeRedirectPath(
  requested: string | null,
): string {
  if (requested === null) {
    return DEFAULT_REDIRECT_PATH;
  }

  // Reject anything that is not a simple allow-listed path.
  if (
    !requested.startsWith("/") ||
    requested.startsWith("//") ||
    requested.includes("\\") ||
    requested.includes(":")
  ) {
    return DEFAULT_REDIRECT_PATH;
  }

  const normalized = requested.split("?")[0] ?? "";

  return (
    ALLOWED_REDIRECT_PATHS.find(
      (allowed) => normalized === allowed,
    ) ?? DEFAULT_REDIRECT_PATH
  );
}

export function callbackUrl(appOrigin: string): string {
  return `${appOrigin}/api/auth/github/callback`;
}

export function authorizeUrl(options: {
  appOrigin: string;
  clientId: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(
    "https://github.com/login/oauth/authorize",
  );

  url.searchParams.set(
    "client_id",
    options.clientId,
  );
  // Authorization Code flow. Stated explicitly rather than relying
  // on GitHub's default behaviour.
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "redirect_uri",
    callbackUrl(options.appOrigin),
  );
  // Minimum scope that can read the authenticated user's identity.
  // QueryVanta never reads repositories, email or organisation data.
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", options.state);
  url.searchParams.set(
    "code_challenge",
    options.challenge,
  );
  url.searchParams.set(
    "code_challenge_method",
    "S256",
  );
  url.searchParams.set("allow_signup", "false");

  return url.toString();
}

/**
 * Create a single-use OAuth transaction and return the values the
 * browser redirect needs.
 */
export async function beginOAuthTransaction(
  db: D1Database,
  options: {
    appOrigin: string;
    clientId: string;
    requestedRedirect: string | null;
  },
): Promise<{ authorizeUrl: string; state: string }> {
  const state = randomToken(32);
  const stateHash = await sha256Hex(state);
  const verifier = createCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const redirectTo = safeRedirectPath(
    options.requestedRedirect,
  );

  const now = Date.now();
  const expiresAt = new Date(
    now + OAUTH_TXN_TTL_SECONDS * 1000,
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO oauth_transactions (
         state_hash, code_verifier, redirect_to,
         created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      stateHash,
      verifier,
      redirectTo,
      new Date(now).toISOString(),
      expiresAt,
    )
    .run();

  return {
    authorizeUrl: authorizeUrl({
      appOrigin: options.appOrigin,
      clientId: options.clientId,
      state,
      challenge,
    }),
    state,
  };
}

export type ConsumedTransaction = {
  codeVerifier: string;
  redirectTo: string;
};

export class OAuthCallbackError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`OAuth callback rejected: ${reason}`);
    this.name = "OAuthCallbackError";
    this.reason = reason;
  }
}

/**
 * Validate the callback and atomically consume the transaction.
 *
 * Rejects: missing/short state, unknown state, replayed state and
 * expired state. A caller that receives a `ConsumedTransaction` can
 * be confident the state was valid, fresh and used exactly once.
 */
export async function consumeOAuthTransaction(
  db: D1Database,
  state: string | null,
): Promise<ConsumedTransaction> {
  if (
    state === null ||
    !/^[a-f0-9]{64}$/.test(state)
  ) {
    throw new OAuthCallbackError("malformed_state");
  }

  const stateHash = await sha256Hex(state);

  // Conditional consume: a replayed callback updates zero rows.
  const result = await db
    .prepare(
      `UPDATE oauth_transactions
          SET consumed_at = ?
        WHERE state_hash = ?
          AND consumed_at IS NULL
          AND expires_at > ?`,
    )
    .bind(nowIso(), stateHash, nowIso())
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    // Distinguish "already used" from "never existed" purely for
    // the audit trail; both are rejected identically to the client.
    const existing = await db
      .prepare(
        `SELECT consumed_at, expires_at
           FROM oauth_transactions
          WHERE state_hash = ?`,
      )
      .bind(stateHash)
      .first<{
        consumed_at: string | null;
        expires_at: string;
      }>();

    if (!existing) {
      throw new OAuthCallbackError("unknown_state");
    }

    if (existing.consumed_at !== null) {
      throw new OAuthCallbackError("replayed_state");
    }

    throw new OAuthCallbackError("expired_state");
  }

  const row = await db
    .prepare(
      `SELECT code_verifier, redirect_to
         FROM oauth_transactions
        WHERE state_hash = ?`,
    )
    .bind(stateHash)
    .first<{
      code_verifier: string;
      redirect_to: string;
    }>();

  if (!row) {
    throw new OAuthCallbackError("unknown_state");
  }

  return {
    codeVerifier: row.code_verifier,
    redirectTo: safeRedirectPath(row.redirect_to),
  };
}

/**
 * Exchange the authorization code for a token and read the identity.
 * The access token is used once and never stored or returned.
 */
export async function exchangeCodeForIdentity(options: {
  appOrigin: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
}): Promise<GithubIdentity> {
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: options.code,
        redirect_uri: callbackUrl(options.appOrigin),
        code_verifier: options.codeVerifier,
      }),
    },
  );

  if (!tokenResponse.ok) {
    throw new OAuthCallbackError("token_exchange_failed");
  }

  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };

  if (
    typeof tokenPayload.access_token !== "string" ||
    tokenPayload.access_token === ""
  ) {
    throw new OAuthCallbackError(
      `token_exchange_rejected:${
        tokenPayload.error ?? "unknown"
      }`,
    );
  }

  const userResponse = await fetch(
    "https://api.github.com/user",
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "QueryVanta-Worker",
      },
    },
  );

  if (!userResponse.ok) {
    throw new OAuthCallbackError("identity_lookup_failed");
  }

  const user = (await userResponse.json()) as {
    id?: number;
    login?: string;
    avatar_url?: string;
  };

  if (
    typeof user.id !== "number" ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0
  ) {
    throw new OAuthCallbackError("identity_missing_id");
  }

  return {
    id: String(user.id),
    login:
      typeof user.login === "string" ? user.login : "unknown",
    avatarUrl:
      typeof user.avatar_url === "string"
        ? user.avatar_url
        : null,
  };
}

/**
 * Authorization decision.
 *
 * Identity is the IMMUTABLE GitHub numeric user id, never the
 * username (which can be renamed). A missing or empty allow-list
 * denies everyone, so the system fails closed.
 */
export function isAllowedAdmin(
  identity: GithubIdentity,
  allowList: ReadonlySet<string>,
): boolean {
  if (allowList.size === 0) {
    return false;
  }

  return allowList.has(identity.id);
}

export async function purgeExpiredOAuthTransactions(
  db: D1Database,
): Promise<void> {
  const cutoff = new Date(
    Date.now() - OAUTH_TXN_TTL_SECONDS * 1000,
  ).toISOString();

  await db
    .prepare(
      `DELETE FROM oauth_transactions WHERE expires_at < ?`,
    )
    .bind(cutoff)
    .run();
}
