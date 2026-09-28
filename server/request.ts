/**
 * Inbound request guards: method checks, same-origin / CSRF
 * enforcement, strict JSON parsing and cookie reading.
 */

import { safeEqual } from "./crypto.ts";
import { SESSION_COOKIE } from "./http.ts";
import type { ApiError, ApiErrorCode } from "./http.ts";

export class RequestError extends Error {
  readonly code: ApiErrorCode;
  readonly details: string[];

  constructor(
    code: ApiErrorCode,
    message: string,
    details: string[] = [],
  ) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.details = details;
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/** Maximum accepted JSON body size, in bytes. */
export const MAX_BODY_BYTES = 512 * 1024;

export function readCookie(
  request: Request,
  name: string,
): string | null {
  const header = request.headers.get("Cookie");

  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();

    if (key === name) {
      return decodeURIComponent(
        part.slice(separator + 1).trim(),
      );
    }
  }

  return null;
}

export function readSessionCookie(
  request: Request,
): string | null {
  return readCookie(request, SESSION_COOKIE);
}

/**
 * Exact-match origin check against the deployment origin.
 *
 * There is no wildcard and no "same registrable domain" allowance:
 * a mutation is accepted only when the browser sent an Origin (or,
 * failing that, a same-origin Referer) that matches exactly.
 */
export function assertSameOrigin(
  request: Request,
  appOrigin: string,
): void {
  const method = request.method.toUpperCase();
  const isMutation =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (!isMutation) {
    return;
  }

  const origin = request.headers.get("Origin");

  if (origin !== null) {
    if (origin !== appOrigin) {
      throw new RequestError(
        "origin_rejected",
        "Request origin is not allowed.",
      );
    }

    return;
  }

  // Some clients omit Origin on same-origin form posts. Fall back to
  // a strict Referer prefix comparison.
  const referer = request.headers.get("Referer");

  if (
    referer === null ||
    !referer.startsWith(`${appOrigin}/`)
  ) {
    throw new RequestError(
      "origin_rejected",
      "Request is missing a verifiable origin.",
    );
  }
}

/**
 * Double-submit CSRF verification.
 *
 * The expected value is the CSRF token bound to the server-side
 * session; the client must echo it in `X-CSRF-Token`. Because the
 * token is only ever readable by same-origin JavaScript that already
 * holds the session cookie, a cross-site attacker cannot produce it.
 */
export function assertCsrf(
  request: Request,
  expectedToken: string,
): void {
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const provided =
    request.headers.get("X-CSRF-Token") ?? "";

  if (
    provided === "" ||
    !safeEqual(provided, expectedToken)
  ) {
    throw new RequestError(
      "csrf_failed",
      "Missing or invalid CSRF token.",
    );
  }
}

export function assertMethod(
  request: Request,
  allowed: readonly string[],
): void {
  if (!allowed.includes(request.method.toUpperCase())) {
    throw new RequestError(
      "method_not_allowed",
      `Method not allowed. Expected: ${allowed.join(", ")}.`,
    );
  }
}

/**
 * Strict JSON body parsing.
 *
 * Rejects an oversized body, a wrong content type and malformed
 * JSON. Parsed values must be plain objects.
 */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType =
    request.headers.get("Content-Type") ?? "";

  if (
    !contentType
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw new RequestError(
      "bad_request",
      "Content-Type must be application/json.",
    );
  }

  const declaredLength = request.headers.get(
    "Content-Length",
  );

  if (
    declaredLength !== null &&
    Number(declaredLength) > MAX_BODY_BYTES
  ) {
    throw new RequestError(
      "too_large",
      "Request body is too large.",
    );
  }

  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new RequestError(
      "too_large",
      "Request body is too large.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestError(
      "bad_request",
      "Request body is not valid JSON.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new RequestError(
      "bad_request",
      "Request body must be a JSON object.",
    );
  }

  return parsed as Record<string, unknown>;
}

export function requireString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = source[key];

  if (typeof value !== "string") {
    throw new RequestError(
      "bad_request",
      `"${key}" must be a string.`,
    );
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    throw new RequestError(
      "bad_request",
      `"${key}" must not be empty.`,
    );
  }

  if (trimmed.length > maxLength) {
    throw new RequestError(
      "bad_request",
      `"${key}" exceeds the maximum length of ${maxLength}.`,
    );
  }

  return trimmed;
}

export function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = source[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RequestError(
      "bad_request",
      `"${key}" must be a string.`,
    );
  }

  if (value.length > maxLength) {
    throw new RequestError(
      "bad_request",
      `"${key}" exceeds the maximum length of ${maxLength}.`,
    );
  }

  return value;
}

export function requireStringArray(
  source: Record<string, unknown>,
  key: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  const value = source[key];

  if (!Array.isArray(value)) {
    throw new RequestError(
      "bad_request",
      `"${key}" must be an array of strings.`,
    );
  }

  if (value.length > maxItems) {
    throw new RequestError(
      "bad_request",
      `"${key}" exceeds the maximum of ${maxItems} entries.`,
    );
  }

  return value.map((item) => {
    if (typeof item !== "string") {
      throw new RequestError(
        "bad_request",
        `"${key}" must contain only strings.`,
      );
    }

    if (item.length > maxItemLength) {
      throw new RequestError(
        "bad_request",
        `"${key}" contains an oversized entry.`,
      );
    }

    return item;
  });
}

export function requireBoolean(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = source[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new RequestError(
      "bad_request",
      `"${key}" must be a boolean.`,
    );
  }

  return value;
}
