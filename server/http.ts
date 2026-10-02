/**
 * Response construction.
 *
 * Every API response carries the security header baseline and a
 * consistent typed JSON envelope. Errors never include stack traces,
 * SQL text or secret material.
 */

import { sha256Hex } from "./crypto.ts";

export const SESSION_COOKIE = "qv_admin_session";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  // Required for SharedArrayBuffer, which the in-browser PySpark
  // worker needs. Without it the PySpark engine cannot boot.
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "method_not_allowed"
  | "csrf_failed"
  | "origin_rejected"
  | "server_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  method_not_allowed: 405,
  csrf_failed: 403,
  origin_rejected: 403,
  server_error: 500,
};

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  details?: string[];
};

export function json(
  body: unknown,
  init: ResponseInit = {},
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  for (const [name, value] of Object.entries({
    ...SECURITY_HEADERS,
    ...extraHeaders,
  })) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function ok(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ ok: true, data: body }, {}, extraHeaders);
}

export function fail(
  error: ApiError,
  extraHeaders: Record<string, string> = {},
): Response {
  const status = STATUS_BY_CODE[error.code] ?? 400;

  return json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && error.details.length > 0
          ? { details: error.details }
          : {}),
      },
    },
    { status },
    extraHeaders,
  );
}

/* -------------------------------------------------------------------------- */
/* public read caching (audit finding V-05)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cache policy for the two public read endpoints only.
 *
 * WHY 60 SECONDS
 * The audit recommends 60 and the trade-off is symmetric: a longer TTL
 * absorbs more repeat traffic, but it is also how long an unpublished or
 * disabled question stays visible to a cached reader. Sixty seconds keeps
 * that window short enough for an editor to trust what they see, while
 * still removing the great majority of anonymous repeat reads from the D1
 * path, which is the actual cost problem.
 *
 * `public` is required for a shared cache to store the response at all;
 * it is only safe here because these two responses contain nothing
 * per-user. Every other API response keeps the `no-store` default set by
 * `json()`.
 */
export const PUBLIC_CACHE_CONTROL = "public, max-age=60";

/**
 * Strong ETag derived from the exact response bytes.
 *
 * Hashing the serialized payload (rather than a timestamp or a row id)
 * is what makes identical content produce an identical tag, so a client
 * that already holds the current representation is correctly told it has
 * the latest one. The payload is the very string `json()` will send, so
 * the tag can never describe something other than the body.
 */
export async function computeEtag(
  payload: string,
): Promise<string> {
  const digest = await sha256Hex(payload);

  // 128 bits of the digest is far more than enough to avoid collisions
  // here and keeps the header short.
  return `"${digest.slice(0, 32)}"`;
}

/**
 * Weak comparison for `If-None-Match`, as RFC 9110 §13.1.2 requires.
 *
 * Handles the wildcard, comma-separated lists and weak tags (`W/"..."`).
 * A weak comparison is correct for a cache validator: it asks "is this
 * the same representation", not "is it byte-identical".
 */
export function matchesIfNoneMatch(
  header: string | null,
  etag: string,
): boolean {
  if (header === null) {
    return false;
  }

  const value = header.trim();

  if (value === "") {
    return false;
  }

  if (value === "*") {
    return true;
  }

  const normalise = (tag: string): string =>
    tag.trim().replace(/^W\//, "");

  const target = normalise(etag);

  return value
    .split(",")
    .some((candidate) => normalise(candidate) === target);
}

/**
 * Serve a public read payload with a cache policy, an ETag and
 * conditional-request handling.
 *
 * Deliberately the ONLY way to produce a cacheable API response, so the
 * blast radius is explicit: adding it to a handler is a deliberate act
 * rather than an accident. Everything else keeps `no-store`.
 */
export async function publicJson(
  data: unknown,
  request: Request,
): Promise<Response> {
  // Serialize exactly as `json()` will, so the ETag describes the bytes
  // that are actually sent.
  const payload = JSON.stringify({ ok: true, data });
  const etag = await computeEtag(payload);

  const cacheHeaders: Record<string, string> = {
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    ETag: etag,
  };

  if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    // 304 carries no body by definition. The validator and the cache
    // policy are still returned so the client refreshes its freshness
    // lifetime.
    return new Response(null, {
      status: 304,
      headers: { ...SECURITY_HEADERS, ...cacheHeaders },
    });
  }

  return json({ ok: true, data }, {}, cacheHeaders);
}

export function redirect(
  location: string,
  status: 302 | 303 | 307 = 302,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({
    Location: location,
    ...extraHeaders,
  });

  for (const [name, value] of Object.entries(
    SECURITY_HEADERS,
  )) {
    headers.set(name, value);
  }

  return new Response(null, { status, headers });
}

/** Build a `Set-Cookie` value for the admin session. */
export function sessionCookie(
  token: string,
  options: {
    maxAgeSec: number;
    secure: boolean;
    expires: Date;
  },
): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSec))}`,
    `Expires=${options.expires.toUTCString()}`,
  ];

  if (options.secure) {
    attributes.push("Secure");
  }

  // No Domain attribute: the cookie stays host-only, which prevents
  // it being sent to sibling subdomains.

  return attributes.join("; ");
}

/** Build a `Set-Cookie` value that clears the session cookie. */
export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", {
    maxAgeSec: 0,
    secure,
    expires: new Date(0),
  });
}
