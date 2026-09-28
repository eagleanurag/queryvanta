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
  recordAudit,
  listAudit,
  type AuditEntry,
} from "./audit.ts";
import {
  isDevelopment,
  parseAdminGitHubIds,
  type Env,
} from "./env.ts";
import {
  fail,
  ok,
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
  parseQuestionId,
  parseQuestionInput,
} from "./questionSchema.ts";
import {
  assertCsrf,
  assertMethod,
  assertSameOrigin,
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
    await recordAudit(env.DB, {
      actorGithubId: null,
      actorLogin: null,
      action: "session_denied",
      outcome: "failure",
      metadata: { reason: lookup.reason },
      now: nowIso(),
    });

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
    assertSameOrigin(request, env.APP_ORIGIN);

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

    const questions = await listPublicQuestions(
      env.DB,
      {
        engine: url.searchParams.get("engine"),
        category: url.searchParams.get("category"),
        difficulty: url.searchParams.get("difficulty"),
      },
    );

    return ok(
      { questions, count: questions.length },
      noStore(),
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
      return fail({
        code: "not_found",
        message: "Question not found.",
      });
    }

    return ok({ question }, noStore());
  }

  return fail({
    code: "not_found",
    message: "Unknown endpoint.",
  });
}

/* -------------------------------------------------------------------------- */
/* admin questions                                                             */
/* -------------------------------------------------------------------------- */

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
          if (pathname === "/api/admin/audit") {
            return await handleAudit(
              env,
              request,
              url,
              pathname,
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
      const apiError = toError(error);

      if (apiError.code === "server_error") {
        console.error(
          "unhandled worker error:",
          error instanceof Error ? error.name : "unknown",
        );
      }

      return fail(apiError);
    } finally {
      // Opportunistic housekeeping; never blocks the response.
      if (pathname.startsWith("/api/auth/session")) {
        ctx.waitUntil(
          Promise.allSettled([
            purgeExpiredSessions(env.DB),
            purgeExpiredOAuthTransactions(env.DB),
          ]),
        );
      }
    }
  },
};
