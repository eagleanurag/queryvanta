/**
 * Response construction.
 *
 * Every API response carries the security header baseline and a
 * consistent typed JSON envelope. Errors never include stack traces,
 * SQL text or secret material.
 */

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
