/**
 * QueryVanta Worker entry.
 *
 * Serves the built SPA from Workers Static Assets and the
 * authenticated admin/public API from the same origin, so the
 * admin session cookie is first-party and needs no CORS.
 *
 * Routing order:
 *   /api/*  -> API (auth, public questions, admin CRUD, audit)
 *   /*      -> static asset, with SPA fallback for client routes
 */

import {
  purgeAuditLog,
  recordAudit,
  listAudit,
  type AuditEntry,
} from "./audit.ts";
import {
  isDevelopment,
  parseAdminGitHubIds,
  parseAnalyticsRetentionDays,
  parseAuditRetentionDays,
  type Env,
} from "./env.ts";
import {
  parseAnalyticsBatch,
  recordAnalytics,
  purgeAnalyticsOlderThan,
  parseAnalyticsQuery,
  readAnalytics,
} from "./analytics.ts";
import {
  fail,
  ok,
  publicJson,
  redirect,
  SECURITY_HEADERS,
  type ApiError,
} from "./http.ts";
import {
  beginOAuthTransaction,
  consumeOAuthTransaction,
  exchangeCodeForIdentity,
  isAllowedAdmin,
  OAuthCallbackError,
  purgeExpiredOAuthTransactions,
} from "./oauth.ts";
import {
  parsePublicFilters,
} from "./publicFilters.ts";
import {
  parseQuestionId,
  parseQuestionInput,
} from "./questionSchema.ts";
import {
  clientAddress,
  consume,
  createBuckets,
  shouldAuditDenied,
  type RateLimitDecision,
} from "./rateLimit.ts";
import {
  assertCsrf,
  assertMethod,
  assertSameOrigin,
  assertSameOriginSignal,
  readJsonObject,
  RequestError,
  requireString,
} from "./request.ts";
import {
  createSession,
  lookupSession,
  logoutCookie,
  nowIso,
  purgeExpiredSessions,
  revokeSessionByToken,
  type AdminSession,
} from "./session.ts";
import {
  createQuestion,
  deleteQuestion,
  duplicateQuestion,
  getAdminQuestion,
  getPublicQuestion,
  importQuestions,
  listAdminQuestions,
  listPublicQuestions,
  PUBLIC_LIST_LIMIT,
  setQuestionFlag,
  updateQuestion,
  type AdminQuestion,
  type PublicQuestion,
} from "./store.ts";

function noStore(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "Cache-Control": "no-store", ...extra };
}

/* -------------------------------------------------------------------------- */
/* rate limiting                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-isolate rate-limit buckets.
 *
 * BEST EFFORT BY DESIGN. This map lives in one isolate, so the limit is
 * per isolate rather than global; see the honesty note in
 * server/rateLimit.ts. It costs no D1 operations, which is the point:
 * the abuse being defended against spends D1 writes on every rejected
 * request.
 */
const buckets = createBuckets();

/**
 * Anonymous budget for the `/api/admin/*` family.
 *
 * 60/minute per client address. The audit suggests exactly this shape.
 * It is generous enough that an ordinary script cannot lock out a real
 * administrator, and the legitimate administrator is exempt anyway
 * because `enforceAdminRateLimit` runs only before the session lookup.
 */
const ADMIN_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/**
 * How many anonymous `session_denied` audit rows are written per
 * window.
 *
 * The first denial in a window is always recorded. After that, one row
 * is written every Nth denial, so a sustained flood costs a bounded,
 * constant number of writes instead of one per request. The action
 * itself is preserved because it is real abuse evidence.
 */
const DENIED_AUDIT_SAMPLE_EVERY = 10;

/**
 * Rate-limit key for one client on one route family.
 */
function adminRateKey(request: Request): string {
  return `admin:${clientAddress(request)}`;
}

/**
 * Consume one anonymous admin budget unit.
 *
 * Only ever called for a caller with NO valid admin session. That is
 * what guarantees the task's hard requirement that the single
 * legitimate administrator can never be throttled: the exemption is
 * decided by a real server-side session lookup, never by anything the
 * client asserts, and the audit explicitly lists "authenticated admin
 * reads" as NOT recommended for throttling because self-inflicted
 * failure buys no security.
 */
function consumeAnonymousAdminBudget(
  request: Request,
): RateLimitDecision {
  return consume(buckets, adminRateKey(request), ADMIN_RATE_LIMIT);
}

/**
 * Build the 429 response for an exhausted anonymous budget.
 */
function rateLimitedResponse(
  decision: RateLimitDecision,
): Response {
  return fail(
    {
      code: "rate_limited",
      message: "Too many requests. Try again shortly.",
    },
    {
      // Retry-After is required by RFC 9110 on a 429 and is what tells
      // a well-behaved client when the window resets.
      "Retry-After": String(decision.retryAfterSeconds),
    },
  );
}

/**
 * Anonymous budget for the OAuth start route.
 *
 * 5/minute per client address, the shape the abuse audit suggests
 * for this route (section H). A human clicks "Continue with GitHub"
 * once per sign-in, so 5/min is generous for the legitimate flow and
 * still caps the D1 write amplification an anonymous caller can
 * cause through this GET.
 */
const OAUTH_START_RATE_LIMIT = { limit: 5, windowSeconds: 60 } as const;

/**
 * Rate-limit key for one client on the OAuth start route.
 */
function oauthStartRateKey(request: Request): string {
  return `oauth-start:${clientAddress(request)}`;
}

/**
 * Analytics ingest budget: 60 requests/minute per client address.
 *
 * The 5.1 design section 6.4 specifies this endpoint as an
 * unauthenticated write, so it inherits exactly the abuse class Phase 4
 * closed on the other anonymous write path and uses the same control. The
 * number is deliberately far above any honest client, which batches its
 * events (section 6.3), and far below the point at which a single caller
 * could make a material dent in the 100,000 rows/day free-tier budget.
 */
const ANALYTICS_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/**
 * Rate-limit key for one client on the analytics ingest route.
 *
 * Namespaced so analytics traffic can never consume the OAuth-start or
 * admin budgets, and vice versa: one abusive caller on one route family
 * must not be able to deny service to the others.
 */
function analyticsRateKey(request: Request): string {
  return `analytics:${clientAddress(request)}`;
}

/**
 * Apply the security header baseline to an asset response.
 *
 * The HTML document MUST carry these headers: without
 * Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy the page
 * is not cross-origin isolated, SharedArrayBuffer is unavailable and
 * the in-browser PySpark worker cannot boot. Assets served by
 * Workers Static Assets do not get them for free, so they are set
 * here.
 *
 * Existing cache headers (immutable asset caching, ETag) are
 * preserved; only headers that are not already correct are added.
 */
function withSecurityHeaders(
  response: Response,
): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(
    SECURITY_HEADERS,
  )) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Session payload exposed to the client. Deliberately excludes the
 * token hash, the session id and the raw cookie value.
 */
function sessionPayload(session: AdminSession) {
  return {
    authenticated: true,
    admin: {
      githubId: session.adminGithubId,
      login: session.githubLogin,
      avatarUrl: session.githubAvatarUrl,
    },
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
}

/**
 * Raised when an anonymous caller has exhausted its request budget.
 *
 * A distinct type, not a `RequestError`, because it carries a
 * `Retry-After` value that the error envelope does not model, and
 * because it must be distinguishable from an ordinary 401 in the logs.
 * The action performed is identical: nothing is written to the audit
 * log on this path, which is the D1 saving this task exists to make.
 */
class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Anonymous request budget exhausted.");
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toError(error: unknown): ApiError {
  if (error instanceof RequestError) {
    return error.toApiError();
  }

  if (error instanceof OAuthCallbackError) {
    return {
      code: "unauthorized",
      message: "Authentication could not be completed.",
    };
  }

  // Never leak internals: no stack traces, no SQL, no env values.
  return {
    code: "server_error",
    message: "An unexpected error occurred.",
  };
}

async function requireAdmin(
  env: Env,
  request: Request,
): Promise<AdminSession> {
  const lookup = await lookupSession(
    env.DB,
    request,
    env.SESSION_SECRET,
  );

  if (lookup.session === null) {
    // V-02 + V-10.
    //
    // Order matters and is the whole point of this task:
    //
    //   1. the session lookup has already proved the caller is NOT an
    //      administrator, so nothing here can throttle the legitimate
    //      administrator;
    //   2. the anonymous budget is charged next, and an over-budget
    //      caller returns 429 having spent ZERO D1 writes;
    //   3. only a caller still inside its budget reaches the audit
    //      write, and even then it is SAMPLED, so a flood bounded by
    //      the window still costs a bounded number of rows.
    //
    // The `session_denied` action is preserved because it is real
    // abuse evidence; what is removed is the unbounded write
    // amplification of one row per request.
    const budget = consumeAnonymousAdminBudget(request);

    if (!budget.allowed) {
      // Thrown, not returned, so the single audit write is also skipped.
      // The router converts this to the 429 plus Retry-After.
      throw new RateLimitExceededError(
        budget.retryAfterSeconds,
      );
    }

    const key = `${adminRateKey(request)}:denied`;

    if (
      shouldAuditDenied(buckets, key, {
        ...ADMIN_RATE_LIMIT,
        sampleEvery: DENIED_AUDIT_SAMPLE_EVERY,
      })
    ) {
      await recordAudit(env.DB, {
        actorGithubId: null,
        actorLogin: null,
        action: "session_denied",
        outcome: "failure",
        metadata: {
          reason: lookup.reason,
          endpoint: new URL(request.url).pathname,
        },
        now: nowIso(),
      });
    }

    throw new RequestError(
      "unauthorized",
      "Administrator authentication is required.",
    );
  }

  const allowList = parseAdminGitHubIds(env.ADMIN_GITHUB_IDS);

  if (!allowList.has(lookup.session.adminGithubId)) {
    throw new RequestError(
      "forbidden",
      "This account is not an administrator.",
    );
  }

  return lookup.session;
}

/* -------------------------------------------------------------------------- */
/* auth routes                                                                 */
/* -------------------------------------------------------------------------- */

async function handleAuth(
  env: Env,
  request: Request,
  url: URL,
  pathname: string,
): Promise<Response> {
  // --- GET /api/auth/session ---------------------------------------------
  if (pathname === "/api/auth/session") {
    assertMethod(request, ["GET"]);

    const lookup = await lookupSession(
      env.DB,
      request,
      env.SESSION_SECRET,
    );

    if (lookup.session === null) {
      return ok(
        { authenticated: false },
        noStore(),
      );
    }

    const allowList = parseAdminGitHubIds(env.ADMIN_GITHUB_IDS);

    if (!allowList.has(lookup.session.adminGithubId)) {
      return ok(
        { authenticated: false },
        noStore(),
      );
    }

    return ok(sessionPayload(lookup.session), noStore());
  }

  // --- GET /api/auth/github (start) --------------------------------------
  if (pathname === "/api/auth/github") {
    assertMethod(request, ["GET"]);

    // V-01: this GET performs a D1 INSERT, so it must not be an
    // unauthenticated write amplifier. Two independent guards:
    //
    //   1. the 4.2B rate limiter (5/min per client address, the shape the
    //      audit recommends), charged before anything else so an
    //      over-budget caller is refused with 429 having spent zero D1
    //      writes;
    //   2. `assertSameOriginSignal`, because the generic mutation-only
    //      origin check is a no-op for GET. It trusts `Sec-Fetch-Site`
    //      first (unforgeable, and what a browser sends for the "Continue
    //      with GitHub" link), then an exact Origin match, then a
    //      same-origin Referer.
    //
    // The limiter is charged first deliberately: it must bound the cost of
    // the check itself, not just the write behind it.
    const budget = consume(
      buckets,
      oauthStartRateKey(request),
      OAUTH_START_RATE_LIMIT,
    );

    if (!budget.allowed) {
      throw new RateLimitExceededError(budget.retryAfterSeconds);
    }

    assertSameOriginSignal(request, env.APP_ORIGIN);

    const { authorizeUrl } =
      await beginOAuthTransaction(env.DB, {
        appOrigin: env.APP_ORIGIN,
        clientId: env.GITHUB_CLIENT_ID,
        requestedRedirect: url.searchParams.get("redirect"),
      });

    return redirect(authorizeUrl, 302, noStore());
  }

  // --- GET /api/auth/github/callback -------------------------------------
  if (pathname === "/api/auth/github/callback") {
    assertMethod(request, ["GET"]);

    const providerError =
      url.searchParams.get("error");

    if (providerError !== null) {
      await recordAudit(env.DB, {
        actorGithubId: null,
        actorLogin: null,
        action: "login_failure",
        outcome: "failure",
        metadata: { reason: "provider_denied" },
        now: nowIso(),
      });

      return redirect(
        "/admin/login?error=provider",
        302,
        noStore(),
      );
    }

    try {
      const transaction =
        await consumeOAuthTransaction(
          env.DB,
          url.searchParams.get("state"),
        );

      const identity = await exchangeCodeForIdentity({
        appOrigin: env.APP_ORIGIN,
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        code: url.searchParams.get("code") ?? "",
        codeVerifier: transaction.codeVerifier,
      });

      const allowList = parseAdminGitHubIds(
        env.ADMIN_GITHUB_IDS,
      );

      if (!isAllowedAdmin(identity, allowList)) {
        await recordAudit(env.DB, {
          actorGithubId: identity.id,
          actorLogin: identity.login,
          action: "login_rejected_user",
          outcome: "failure",
          metadata: { reason: "not_in_allowlist" },
          now: nowIso(),
        });

        return redirect(
          "/admin/login?error=not-authorized",
          302,
          noStore(),
        );
      }

      const created = await createSession(env.DB, {
        adminGithubId: identity.id,
        githubLogin: identity.login,
        githubAvatarUrl: identity.avatarUrl,
        secret: env.SESSION_SECRET,
      });

      await recordAudit(env.DB, {
        actorGithubId: identity.id,
        actorLogin: identity.login,
        action: "login_success",
        outcome: "success",
        metadata: { githubId: identity.id },
        now: nowIso(),
      });

      return redirect(
        transaction.redirectTo,
        302,
        noStore({ "Set-Cookie": created.cookie }),
      );
    } catch (error) {
      const reason =
        error instanceof OAuthCallbackError
          ? error.reason
          : "unexpected";

      await recordAudit(env.DB, {
        actorGithubId: null,
        actorLogin: null,
        action: "login_failure",
        outcome: "failure",
        metadata: { reason },
        now: nowIso(),
      });

      // The reason is recorded in the audit log, never shown to
      // the browser.
      return redirect(
        "/admin/login?error=authentication",
        302,
        noStore(),
      );
    }
  }

  // --- POST /api/auth/logout ---------------------------------------------
  if (pathname === "/api/auth/logout") {
    assertMethod(request, ["POST"]);
    assertSameOrigin(request, env.APP_ORIGIN);

    const lookup = await lookupSession(
      env.DB,
      request,
      env.SESSION_SECRET,
    );

    if (lookup.session !== null) {
      assertCsrf(request, lookup.session.csrfToken);

      await revokeSessionByToken(
        env.DB,
        request,
        env.SESSION_SECRET,
      );

      await recordAudit(env.DB, {
        actorGithubId: lookup.session.adminGithubId,
        actorLogin: lookup.session.githubLogin,
        action: "logout",
        metadata: {},
        now: nowIso(),
      });
    }

    return ok(
      { authenticated: false },
      noStore({
        "Set-Cookie": logoutCookie(
          !isDevelopment(env),
        ),
      }),
    );
  }

  return fail({
    code: "not_found",
    message: "Unknown auth endpoint.",
  });
}

/* -------------------------------------------------------------------------- */
/* public questions                                                            */
/* -------------------------------------------------------------------------- */

async function handlePublicQuestions(
  env: Env,
  request: Request,
  url: URL,
  pathname: string,
): Promise<Response> {
  if (pathname === "/api/questions") {
    assertMethod(request, ["GET"]);

    // V-06 / V-12: the filters are validated against the real catalog
    // enums before they reach D1, and the query is bounded. An invalid
    // filter is a 400 rather than a silent empty result.
    const filters = parsePublicFilters(url);

    const page = await listPublicQuestions(env.DB, filters);

    // The response is explicit about truncation: `count` is what this
    // response actually contains, `total` is how many match overall, and
    // `truncated` says whether the two differ. A client is never misled
    // into believing it received the whole catalog.
    return publicJson(
      {
        questions: page.questions,
        count: page.questions.length,
        total: page.total,
        truncated: page.total > page.questions.length,
        limit: PUBLIC_LIST_LIMIT,
      },
      request,
    );
  }

  if (pathname.startsWith("/api/questions/")) {
    assertMethod(request, ["GET"]);

    const id = parseQuestionId(
      decodeURIComponent(
        pathname.slice("/api/questions/".length),
      ),
    );

    const question: PublicQuestion | null =
      await getPublicQuestion(env.DB, id);

    if (question === null) {
      // A miss stays uncached: caching a negative result would let an
      // unpublished question be pinned as "not found" for the whole TTL
      // even after it is published.
      return fail({
        code: "not_found",
        message: "Question not found.",
      });
    }

    // The second and last cacheable response. Same predicate, same
    // reasoning.
    return publicJson({ question }, request);
  }

  return fail({
    code: "not_found",
    message: "Unknown endpoint.",
  });
}

/* -------------------------------------------------------------------------- */
/* analytics ingest                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/analytics/events` - anonymous product analytics ingest.
 *
 * Implements the 5.1 design section 6. The four guards are ordered by
 * cost, cheapest and most abusable first, and the ordering is deliberate
 * rather than incidental:
 *
 *   1. method
 *   2. RATE LIMIT, charged before the body is even read. This is the same
 *      choice made on the OAuth start route (4.2C): the limiter must bound
 *      the cost of everything that follows it, not just of the write. A
 *      429 here has therefore spent zero D1 operations and zero body
 *      parsing.
 *   3. SAME-ORIGIN SIGNAL, reusing the 4.2C control unchanged rather than
 *      adding a second, subtly different check. `sendBeacon` is
 *      same-origin by construction, so this costs the honest client
 *      nothing while denying scripted cross-origin injection. The generic
 *      `assertSameOrigin` is not used because it is a no-op for GET and
 *      knows nothing about Fetch Metadata; `assertSameOriginSignal` trusts
 *      `Sec-Fetch-Site` first, which is the header a script cannot forge.
 *   4. parse, which applies the body cap, the batch cap and every
 *      allow-list. Nothing reaches D1 until all of it has passed.
 *
 * NO SESSION, NO COOKIE, NO CSRF TOKEN
 * ------------------------------------
 * The endpoint is unauthenticated by design, so `assertCsrf` has no meaning
 * here and is deliberately absent. CSRF protects a state change made *on
 * behalf of* a cookie-authenticated user; there is no such user here and
 * nothing is changed on anyone's behalf.
 *
 * The response is `no-store` and deliberately says nothing about what was
 * written. A public endpoint that echoed its own counts back would let a
 * caller verify a write landed and would be one more oracle on the write
 * budget.
 */
async function handleAnalytics(
  env: Env,
  request: Request,
): Promise<Response> {
  assertMethod(request, ["POST"]);

  const budget = consume(
    buckets,
    analyticsRateKey(request),
    ANALYTICS_RATE_LIMIT,
  );

  if (!budget.allowed) {
    throw new RateLimitExceededError(budget.retryAfterSeconds);
  }

  assertSameOriginSignal(request, env.APP_ORIGIN);

  const body = await readJsonObject(request);
  const parsed = parseAnalyticsBatch(body);

  const statements = await recordAnalytics(
    env.DB,
    parsed,
    nowIso(),
  );

  console.log(
    `analytics ingest: ${parsed.eventsAccepted} event(s) -> ` +
      `${parsed.deltas.length} bucket(s) in ${statements} statement(s)`,
  );

  return ok(
    { accepted: parsed.eventsAccepted },
    noStore(),
  );
}

/* -------------------------------------------------------------------------- */
/* admin questions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/admin/analytics` - aggregated daily counters.
 *
 * Implements the 5.1 design, section 7. The design's rule for this
 * endpoint is short and the implementation is only that rule:
 *
 *   - It requires a valid administrator session, exactly like every other
 *     admin endpoint, via the same `requireAdmin` call. There is no
 *     client-side flag, no "admin" query parameter and no public
 *     analytics route.
 *   - It is `no-store`. The public endpoints in 4.2D are the ONLY cacheable
 *     API responses in this application, and this is emphatically not one
 *     of them: the body is internal product data, and a shared cache would
 *     hand it to anyone who could reach the edge.
 *   - Its range is clamped server-side to at most 90 days and never more
 *     than 400 days back. The clamp is not advisory: the accepted window
 *     is decided here, so a caller cannot widen the scan.
 *
 * The response reports the range actually served, alongside the rows, so
 * the page can tell the operator when a request was clamped rather than
 * silently showing them a truncated window.
 */
async function handleAdminAnalytics(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  assertMethod(request, ["GET"]);

  // A real server-side session lookup against a hashed token. Not
  // throttled and not cached, exactly like the other admin reads.
  await requireAdmin(env, request);

  const query = parseAnalyticsQuery(url.searchParams);
  const rows = await readAnalytics(env.DB, query);

  return ok(
    {
      from: query.from,
      to: query.to,
      event: query.event,
      rows,
      count: rows.length,
    },
    noStore(),
  );
}

async function handleAdminQuestions(
  env: Env,
  request: Request,
  pathname: string,
): Promise<Response> {
  // Every route below requires a valid, unexpired, unrevoked
  // server-side session. There is no client-side equivalent.
  const session = await requireAdmin(env, request);
  const now = nowIso();
  const actor = session.adminGithubId;

  const guardMutation = () => {
    assertSameOrigin(request, env.APP_ORIGIN);
    assertCsrf(request, session.csrfToken);
  };

  /* --- collection ------------------------------------------------------ */
  if (pathname === "/api/admin/questions") {
    if (request.method === "GET") {
      const questions = await listAdminQuestions(env.DB);
      return ok(
        { questions, count: questions.length },
        noStore(),
      );
    }

    if (request.method === "POST") {
      guardMutation();
      const body = await readJsonObject(request);

      // A bulk import is explicitly flagged.
      if (Array.isArray(body.questions)) {
        const rawList = body.questions;

        if (rawList.length > 500) {
          throw new RequestError(
            "too_large",
            "Import is limited to 500 questions per request.",
          );
        }

        const inputs = rawList.map((entry) =>
          parseQuestionInput(
            entry as Record<string, unknown>,
          ),
        );

        const outcome = await importQuestions(
          env.DB,
          inputs,
          actor,
          now,
        );

        await recordAudit(env.DB, {
          actorGithubId: actor,
          actorLogin: session.githubLogin,
          action: "question_import",
          outcome:
            outcome.failed > 0 ? "failure" : "success",
          metadata: {
            imported: outcome.imported,
            skipped: outcome.skipped,
            conflicts: outcome.conflicts,
            failed: outcome.failed,
          },
          now,
        });

        return ok(outcome);
      }

      const input = parseQuestionInput(body);
      const created = await createQuestion(
        env.DB,
        input,
        actor,
        now,
      );

      if (created.status === "conflict") {
        return fail({
          code: "conflict",
          message:
            "A question with that id already exists.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_create",
        questionId: created.question.id,
        metadata: { published: created.question.published },
        now,
      });

      return ok(
        { question: created.question },
        noStore(),
      );
    }

    throw new RequestError(
      "method_not_allowed",
      "Method not allowed.",
    );
  }

  /* --- item routes ----------------------------------------------------- */
  const itemMatch = /^\/api\/admin\/questions\/([^/]+)$/.exec(
    pathname,
  );
  const actionMatch =
    /^\/api\/admin\/questions\/([^/]+)\/(duplicate|publish|unpublish|disable|enable|restore)$/.exec(
      pathname,
    );

  if (actionMatch !== null) {
    const id = parseQuestionId(
      decodeURIComponent(actionMatch[1] ?? ""),
    );
    const action = actionMatch[2] ?? "";

    assertMethod(request, ["POST"]);
    guardMutation();

    if (action === "duplicate") {
      const body = await readJsonObject(request);
      const newId = requireString(body, "id", 120);
      const created = await duplicateQuestion(
        env.DB,
        id,
        newId,
        actor,
        now,
      );

      if (created.status === "conflict") {
        return fail({
          code: "conflict",
          message:
            "The source question does not exist, or the new id is taken.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_duplicate",
        questionId: created.question.id,
        metadata: { source: id },
        now,
      });

      return ok(
        { question: created.question },
        noStore(),
      );
    }

    const flag =
      action === "publish"
        ? "published"
        : action === "disable"
          ? "enabled"
          : action === "enable"
            ? "enabled"
            : null;

    if (action === "unpublish") {
      const updated = await setQuestionFlag(
        env.DB,
        id,
        "published",
        false,
        actor,
        now,
      );

      if (updated === null) {
        return fail({
          code: "not_found",
          message: "Question not found.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_unpublish",
        questionId: id,
        metadata: { published: false },
        now,
      });

      return ok({ question: updated }, noStore());
    }

    if (action === "restore") {
      const updated = await setQuestionFlag(
        env.DB,
        id,
        "enabled",
        true,
        actor,
        now,
      );

      if (updated === null) {
        return fail({
          code: "not_found",
          message: "Question not found.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_enable",
        questionId: id,
        metadata: { enabled: true },
        now,
      });

      return ok({ question: updated }, noStore());
    }

    const value =
      action === "publish" ? true : action === "enable" ? true : false;

    const updated = await setQuestionFlag(
      env.DB,
      id,
      flag as "enabled" | "published",
      value,
      actor,
      now,
    );

    if (updated === null) {
      return fail({
        code: "not_found",
        message: "Question not found.",
      });
    }

    await recordAudit(env.DB, {
      actorGithubId: actor,
      actorLogin: session.githubLogin,
      action:
        action === "publish"
          ? "question_publish"
          : action === "disable"
            ? "question_disable"
            : "question_enable",
      questionId: id,
      metadata: { published: updated.published },
      now,
    });

    return ok({ question: updated }, noStore());
  }

  if (itemMatch !== null) {
    const id = parseQuestionId(
      decodeURIComponent(itemMatch[1] ?? ""),
    );

    if (request.method === "GET") {
      const question: AdminQuestion | null =
        await getAdminQuestion(env.DB, id);

      if (question === null) {
        return fail({
          code: "not_found",
          message: "Question not found.",
        });
      }

      return ok({ question }, noStore());
    }

    if (request.method === "PUT") {
      guardMutation();
      const body = await readJsonObject(request);
      const input = parseQuestionInput(body);
      const expectedVersion =
        body.version === undefined
          ? null
          : Number(body.version);

      const outcome = await updateQuestion(
        env.DB,
        input,
        actor,
        now,
        Number.isInteger(expectedVersion)
          ? expectedVersion
          : null,
      );

      if (outcome.status === "not_found") {
        return fail({
          code: "not_found",
          message: "Question not found.",
        });
      }

      if (outcome.status === "version_conflict") {
        return fail({
          code: "conflict",
          message:
            "The question was modified by another administrator. Reload and try again.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_update",
        questionId: id,
        metadata: {
          version: outcome.question.version,
          published: outcome.question.published,
        },
        now,
      });

      return ok({ question: outcome.question }, noStore());
    }

    if (request.method === "DELETE") {
      guardMutation();
      const outcome = await deleteQuestion(
        env.DB,
        id,
        actor,
        now,
      );

      if (outcome.status === "not_found") {
        return fail({
          code: "not_found",
          message: "Question not found.",
        });
      }

      await recordAudit(env.DB, {
        actorGithubId: actor,
        actorLogin: session.githubLogin,
        action: "question_delete",
        questionId: id,
        metadata: {},
        now,
      });

      return ok(
        {
          question: outcome.question,
          softDeleted: true,
        },
        noStore(),
      );
    }

    throw new RequestError(
      "method_not_allowed",
      "Method not allowed.",
    );
  }

  return fail({
    code: "not_found",
    message: "Unknown endpoint.",
  });
}

/* -------------------------------------------------------------------------- */
/* audit                                                                       */
/* -------------------------------------------------------------------------- */

async function handleAudit(
  env: Env,
  request: Request,
  url: URL,
  pathname: string,
): Promise<Response> {
  if (pathname === "/api/admin/audit") {
    assertMethod(request, ["GET"]);
    const session = await requireAdmin(env, request);

    const limitParam = url.searchParams.get("limit");
    const entries: AuditEntry[] = await listAudit(
      env.DB,
      {
        limit:
          limitParam === null
            ? 50
            : Number(limitParam),
        questionId: url.searchParams.get("questionId"),
      },
    );

    void session;

    return ok({ entries, count: entries.length }, noStore());
  }

  return fail({
    code: "not_found",
    message: "Unknown endpoint.",
  });
}

/* -------------------------------------------------------------------------- */
/* router                                                                      */
/* -------------------------------------------------------------------------- */

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // `ctx` is unused on the request path: housekeeping now runs from
    // the scheduled handler, so there is nothing to waitUntil here.
    void ctx;

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (pathname.startsWith("/api/")) {
        if (pathname === "/api/health") {
          assertMethod(request, ["GET"]);

          return ok({
            status: "ok",
            environment: env.ENVIRONMENT,
          });
        }

        if (pathname.startsWith("/api/auth/")) {
          return await handleAuth(
            env,
            request,
            url,
            pathname,
          );
        }

        if (pathname.startsWith("/api/admin/")) {
          // The whole family shares one anonymous budget, enforced
          // inside requireAdmin once the session lookup has proved the
          // caller is anonymous. Authenticated administrators are never
          // charged.
          if (pathname === "/api/admin/audit") {
            return await handleAudit(
              env,
              request,
              url,
              pathname,
            );
          }

          if (pathname === "/api/admin/analytics") {
            return await handleAdminAnalytics(
              env,
              request,
              url,
            );
          }

          if (
            pathname === "/api/admin/questions" ||
            pathname.startsWith("/api/admin/questions/")
          ) {
            return await handleAdminQuestions(
              env,
              request,
              pathname,
            );
          }

          return fail({
            code: "not_found",
            message: "Unknown endpoint.",
          });
        }

        if (
          pathname === "/api/questions" ||
          pathname.startsWith("/api/questions/")
        ) {
          return await handlePublicQuestions(
            env,
            request,
            url,
            pathname,
          );
        }

        // Analytics is matched before the catch-all 404 but deliberately
        // AFTER the public question routes, and it is not part of the
        // /api/admin family, so it can never inherit the admin budget or
        // the admin session requirement.
        if (
          pathname === "/api/analytics/events"
        ) {
          return await handleAnalytics(env, request);
        }

        return fail({
          code: "not_found",
          message: "Unknown endpoint.",
        });
      }

      // Static assets. The SPA fallback serves index.html for any
      // unmatched GET so client-side deep links return HTTP 200
      // (unlike the GitHub Pages 404.html workaround).
      if (
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        return fail({
          code: "method_not_allowed",
          message: "Method not allowed.",
        });
      }

      return withSecurityHeaders(
        await env.ASSETS.fetch(request),
      );
    } catch (error) {
      // A throttled anonymous caller gets 429 plus Retry-After and, by
      // construction, zero audit writes.
      if (error instanceof RateLimitExceededError) {
        // Deliberately NOT logged. This is the hottest path under abuse,
        // so logging every rejection would let an attacker turn the
        // throttle into a log-flooding amplifier and spend Worker CPU
        // doing it. The 429 itself is the signal, and the first denial
        // of each window is still recorded in the audit log.
        return rateLimitedResponse({
          allowed: false,
          retryAfterSeconds: error.retryAfterSeconds,
          remaining: 0,
        });
      }

      const apiError = toError(error);

      if (apiError.code === "server_error") {
        console.error(
          "unhandled worker error:",
          error instanceof Error ? error.name : "unknown",
        );
      }

      return fail(apiError);
    }
  },

  /**
   * Scheduled housekeeping, driven by the Worker cron trigger.
   *
   * Runs the session and OAuth-transaction purges, the audit-log
   * retention delete and the analytics retention delete. Each purge is
   * isolated with Promise.allSettled so one failure cannot prevent the
   * others; failures are logged, never thrown. This replaces the
   * request-path housekeeping that used to run on /api/auth/session.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    void event;
    void ctx;

    const retentionDays = parseAuditRetentionDays(
      env.AUDIT_RETENTION_DAYS,
    );

    // Analytics keeps its own, longer window: it is a product trend
    // record, not a security record. Sharing the audit window would
    // discard a year of trend data for no investigative benefit.
    const analyticsRetentionDays =
      parseAnalyticsRetentionDays(env.ANALYTICS_RETENTION_DAYS);

    const results = await Promise.allSettled([
      purgeExpiredSessions(env.DB),
      purgeExpiredOAuthTransactions(env.DB),
      purgeAuditLog(env.DB, retentionDays),
      purgeAnalyticsOlderThan(env.DB, analyticsRetentionDays),
    ]);

    const failed = results.filter(
      (result) => result.status === "rejected",
    );

    for (const failure of failed) {
      console.error("housekeeping purge failed:", failure.reason);
    }

    console.log(
      `housekeeping complete: ${results.length - failed.length}/${results.length} purges succeeded`,
    );
  },
};
