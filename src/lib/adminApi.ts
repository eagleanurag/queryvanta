/**
 * Admin API client.
 *
 * Design rules enforced here:
 *  - The session is an HttpOnly cookie. There is NO bearer token in
 *    localStorage or sessionStorage, and this module never stores one.
 *  - Only the CSRF token is held in memory (module scope). It is read
 *    from /api/auth/session and echoed in X-CSRF-Token on mutations.
 *  - The API origin is same-origin by default (the Worker serves both
 *    the app and the API). A different origin is only used when the
 *    app is explicitly configured for one.
 *  - Every call reports a typed result; the UI never guesses.
 */

import type {
  Question,
} from "../data/questions.ts";

export type AdminIdentity = {
  githubId: string;
  login: string | null;
  avatarUrl: string | null;
};

export type SessionState =
  | { status: "unknown" }
  | { status: "loading" }
  | {
      status: "authenticated";
      admin: AdminIdentity;
      csrfToken: string;
      expiresAt: string;
    }
  | {
      status: "unauthenticated";
      /** "unavailable" means no backend is deployed (GitHub Pages). */
      reason:
        | "no-session"
        | "expired"
        | "revoked"
        | "forbidden"
        | "unavailable"
        | "error";
    };

/**
 * In-memory only. Deliberately NOT persisted: a CSRF token stored in
 * web storage would defeat the double-submit pattern.
 */
let csrfToken: string | null = null;

const API_BASE =
  import.meta.env.VITE_QV_API_BASE ??
  import.meta.env.BASE_URL ??
  "/";

/**
 * Resolve an API path against the configured base.
 *
 * A relative string is returned rather than an absolute URL: the
 * base is a path (`/queryvanta/` or `/`), which `new URL()` rejects
 * as a base. A relative path also keeps the request same-origin,
 * so the HttpOnly session cookie is sent without any CORS setup.
 */
function apiUrl(path: string): string {
  const base = API_BASE.endsWith("/")
    ? API_BASE
    : `${API_BASE}/`;

  return `${base}${path.replace(/^\/+/, "")}`;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      details: string[];
    };

async function readEnvelope<T>(
  response: Response,
): Promise<ApiResult<T>> {
  // A static host (GitHub Pages) or the Vite dev server answers
  // unknown /api paths with HTML. That means "no backend here",
  // not "the request failed".
  const contentType =
    response.headers.get("Content-Type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      status: response.status,
      code: "no_backend",
      message:
        "The QueryVanta API is not available on this deployment.",
      details: [],
    };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      status: response.status,
      code: "invalid_response",
      message: "The server returned an unreadable response.",
      details: [],
    };
  }

  if (typeof payload !== "object" || payload === null) {
    return {
      ok: false,
      status: response.status,
      code: "invalid_response",
      message: "The server returned an unexpected response.",
      details: [],
    };
  }

  const body = payload as {
    ok?: boolean;
    data?: T;
    error?: {
      code?: string;
      message?: string;
      details?: string[];
    };
  };

  if (body.ok === true) {
    return { ok: true, data: body.data as T };
  }

  return {
    ok: false,
    status: response.status,
    code: body.error?.code ?? "unknown",
    message:
      body.error?.message ??
      "The request could not be completed.",
    details: body.error?.details ?? [],
  };
}

async function request<T>(
  path: string,
  init: RequestInit & {
    mutation?: boolean;
  } = {},
): Promise<ApiResult<T>> {
  const { mutation = false, ...rest } = init;

  const headers = new Headers(rest.headers);

  if (rest.body !== undefined) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  if (mutation) {
    if (csrfToken === null) {
      return {
        ok: false,
        status: 0,
        code: "no_csrf",
        message:
          "No active administrator session. Sign in again.",
        details: [],
      };
    }

    headers.set("X-CSRF-Token", csrfToken);
  }

  headers.set("Accept", "application/json");

  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      // The session cookie must be sent and never read by JS.
      credentials: "same-origin",
      ...rest,
      headers,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message:
        "Could not reach the QueryVanta API. If you are using the GitHub Pages deployment, administrative features that require the server are unavailable.",
      details: [],
    };
  }

  if (response.status === 401 || response.status === 403) {
    // The server rejected our session; drop the CSRF token so no
    // further mutation can be attempted with a stale value.
    csrfToken = null;
  }

  return readEnvelope<T>(response);
}

/* -------------------------------------------------------------------------- */
/* session                                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchSession(): Promise<SessionState> {
  const result = await request<{
    authenticated: boolean;
    admin?: AdminIdentity;
    csrfToken?: string;
    expiresAt?: string;
  }>("api/auth/session");

  if (!result.ok) {
    if (
      result.code === "network_error" ||
      result.code === "no_backend"
    ) {
      return {
        status: "unauthenticated",
        reason: "unavailable",
      };
    }

    return {
      status: "unauthenticated",
      reason: "error",
    };
  }

  const data = result.data;

  if (
    data.authenticated !== true ||
    data.admin === undefined ||
    typeof data.csrfToken !== "string"
  ) {
    csrfToken = null;

    return {
      status: "unauthenticated",
      reason: "no-session",
    };
  }

  csrfToken = data.csrfToken;

  return {
    status: "authenticated",
    admin: data.admin,
    csrfToken: data.csrfToken,
    expiresAt: data.expiresAt ?? "",
  };
}

export function clearClientSession(): void {
  csrfToken = null;
}

export async function logout(): Promise<ApiResult<null>> {
  const result = await request<{ authenticated: boolean }>(
    "api/auth/logout",
    { method: "POST", mutation: true },
  );

  csrfToken = null;

  return result as ApiResult<null>;
}

export function loginUrl(): string {
  return apiUrl(
    "api/auth/github?redirect=%2Fadmin%2Fquestions",
  );
}

/** Probes whether a backend is deployed at all. */
export async function probeApi(): Promise<boolean> {
  const result = await request<{ status: string }>(
    "api/health",
  );

  return result.ok;
}

/* -------------------------------------------------------------------------- */
/* analytics                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One aggregated daily counter, as returned by the admin analytics
 * endpoint. Counts only: there is no per-event row, because the server
 * stores aggregates rather than events (5.1 design, section 5).
 */
export type AdminAnalyticsCount = {
  bucketDate: string;
  eventName: string;
  propKey: string;
  propValue: string;
  count: number;
};

/**
 * Aggregated analytics for an administrator.
 *
 * `from` and `to` are the range the SERVER actually served, which is not
 * necessarily the range that was requested: the endpoint clamps to at most
 * 90 days and never reaches back past the retention window. The page shows
 * these rather than its own inputs so that a clamped request is visible
 * instead of silently misleading.
 */
export type AdminAnalytics = {
  from: string;
  to: string;
  event: string | null;
  rows: AdminAnalyticsCount[];
  count: number;
};

export async function listAdminAnalytics(
  params: {
    from?: string;
    to?: string;
    event?: string | null;
  } = {},
): Promise<ApiResult<AdminAnalytics>> {
  const query = new URLSearchParams();

  if (params.from !== undefined) {
    query.set("from", params.from);
  }

  if (params.to !== undefined) {
    query.set("to", params.to);
  }

  if (
    params.event !== undefined &&
    params.event !== null
  ) {
    query.set("event", params.event);
  }

  const suffix = query.toString();

  return request<AdminAnalytics>(
    `api/admin/analytics${suffix === "" ? "" : `?${suffix}`}`,
  );
}

/* questions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A question row as returned by the admin API.
 *
 * Extends the learner-facing `Question` with the server-managed
 * lifecycle and provenance fields an administrator needs. All of
 * them are optional so the same type can be used for request
 * payloads, where the server owns those values.
 */
export type AdminQuestionPayload = Question & {
  published?: boolean;
  source?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export async function listAdminQuestions(): Promise<
  ApiResult<{ questions: AdminQuestionPayload[] }>
> {
  return request<{ questions: AdminQuestionPayload[] }>(
    "api/admin/questions",
  );
}

export async function createAdminQuestion(
  question: AdminQuestionPayload,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    "api/admin/questions",
    {
      method: "POST",
      mutation: true,
      body: JSON.stringify(question),
    },
  );
}

export async function updateAdminQuestion(
  question: AdminQuestionPayload,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    `api/admin/questions/${encodeURIComponent(question.id)}`,
    {
      method: "PUT",
      mutation: true,
      body: JSON.stringify(question),
    },
  );
}

export async function duplicateServerQuestion(
  id: string,
  newId: string,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    `api/admin/questions/${encodeURIComponent(id)}/duplicate`,
    {
      method: "POST",
      mutation: true,
      body: JSON.stringify({ id: newId }),
    },
  );
}

export async function setServerQuestionPublished(
  id: string,
  published: boolean,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    `api/admin/questions/${encodeURIComponent(id)}/${
      published ? "publish" : "unpublish"
    }`,
    { method: "POST", mutation: true },
  );
}

export async function setServerQuestionEnabled(
  id: string,
  enabled: boolean,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    `api/admin/questions/${encodeURIComponent(id)}/${
      enabled ? "enable" : "disable"
    }`,
    { method: "POST", mutation: true },
  );
}

export async function deleteServerQuestion(
  id: string,
): Promise<ApiResult<{ question: AdminQuestionPayload }>> {
  return request<{ question: AdminQuestionPayload }>(
    `api/admin/questions/${encodeURIComponent(id)}`,
    { method: "DELETE", mutation: true },
  );
}

export async function importServerQuestions(
  questions: AdminQuestionPayload[],
): Promise<
  ApiResult<{
    imported: number;
    skipped: number;
    failed: number;
    conflicts: number;
    failures: { id: string; reason: string }[];
  }>
> {
  return request<{
    imported: number;
    skipped: number;
    failed: number;
    conflicts: number;
    failures: { id: string; reason: string }[];
  }>("api/admin/questions", {
    method: "POST",
    mutation: true,
    body: JSON.stringify({ questions }),
  });
}
