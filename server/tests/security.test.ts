import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  APP_ORIGIN,
  d1Command,
  mintSession,
  startWorker,
  stopWorker,
  TEST_ADMIN_ID,
  WORKER_ORIGIN,
} from "./harness.ts";

import {
  DEFAULT_REDIRECT_PATH,
  isAllowedAdmin,
  safeRedirectPath,
} from "../oauth.ts";

import {
  parseQuestionInput,
} from "../questionSchema.ts";

import { parseAdminGitHubIds } from "../env.ts";

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);
const CSRF = "csrf-token-for-tests-000000000000";

function validQuestion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sec-test-1",
    title: "Security Test Question",
    description: "Created by the security suite.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Filtering",
    languages: ["PostgreSQL"],
    tags: ["SELECT"],
    companies: [],
    database: {
      engine: "PostgreSQL",
      tables: [
        {
          name: "t",
          columns: [{ name: "id", type: "INTEGER" }],
          rows: [{ id: 1 }],
        },
      ],
    },
    starterCode: "SELECT * FROM t;",
    validation: {
      type: "result",
      expectedResult: [{ id: 1 }],
    },
    ...overrides,
  };
}

type Envelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
};

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{
  status: number;
  body: Envelope;
  headers: Headers;
  setCookie: string | null;
}> {
  const response = await fetch(
    `${WORKER_ORIGIN}${path}`,
    init,
  );

  const text = await response.text();
  let body: Envelope;

  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    body = { ok: false };
  }

  return {
    status: response.status,
    body,
    headers: response.headers,
    setCookie: response.headers.get("set-cookie"),
  };
}

function cookieHeader(token: string): string {
  return `qv_admin_session=${token}`;
}

/**
 * One source address per OAuth-start test.
 *
 * The route is rate limited to 5 requests per minute per client address,
 * so tests sharing the default loopback address would consume each
 * other's budget and fail depending on execution order. Giving each test
 * its own address keeps them independent and makes a genuine 429 the only
 * reason a test sees a 429.
 */
const OAUTH_START_ADDRESSES = {
  origin: "203.0.113.21",
  bare: "203.0.113.22",
  evilOrigin: "203.0.113.23",
  crossSite: "203.0.113.24",
  sameSite: "203.0.113.25",
  fetchSite: "203.0.113.26",
  refererOnly: "203.0.113.27",
  replay: "203.0.113.28",
};

function auth(
  token: string,
  csrf: string,
  extra: HeadersInit = {},
): HeadersInit {
  return {
    Cookie: cookieHeader(token),
    Origin: APP_ORIGIN,
    "X-CSRF-Token": csrf,
    ...extra,
  };
}

/** Count rows in the OAuth transaction table. */
function oauthTransactionCount(): number {
  const out = d1Command(
    "SELECT COUNT(*) AS n FROM oauth_transactions;",
  );

  const match = /"n"\s*:\s*(\d+)/.exec(out);

  assert.ok(match, `could not read transaction count from: ${out}`);

  return Number(match[1]);
}

/* -------------------------------------------------------------------------- */

before(async () => {
  await startWorker();
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */
/* AUTH                                                                        */
/* -------------------------------------------------------------------------- */

describe("AUTH", () => {
  it("rejects an unauthenticated admin read with 401", async () => {
    const result = await api("/api/admin/questions");

    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error?.code, "unauthorized");
  });

  it("rejects every unauthenticated admin mutation with 401", async () => {
    const mutations: [string, string][] = [
      ["/api/admin/questions", "POST"],
      ["/api/admin/questions/sec-test-1", "PUT"],
      ["/api/admin/questions/sec-test-1", "DELETE"],
      ["/api/admin/questions/sec-test-1/publish", "POST"],
      ["/api/admin/questions/sec-test-1/duplicate", "POST"],
    ];

    for (const [path, method] of mutations) {
      const result = await api(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: APP_ORIGIN,
          "X-CSRF-Token": CSRF,
        },
        body: method === "GET" ? undefined : "{}",
      });

      assert.equal(
        result.status,
        401,
        `${method} ${path} must require a session`,
      );
    }
  });

  it("rejects a malformed session cookie", async () => {
    const result = await api("/api/admin/questions", {
      headers: { Cookie: "qv_admin_session=not-a-valid-token" },
    });

    // Treated as unauthenticated.
    assert.equal(result.status, 401);
  });

  it("rejects a revoked session", async () => {
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token: OTHER_TOKEN,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
      revokedAt: new Date().toISOString(),
    });

    const result = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(OTHER_TOKEN) },
    });

    assert.equal(result.status, 401);
  });

  it("rejects an expired session", async () => {
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token: OTHER_TOKEN,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(OTHER_TOKEN) },
    });

    assert.equal(result.status, 401);
  });

  it("allows a valid administrator session", async () => {
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token: TOKEN,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const result = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });

  it("revokes the session server-side on logout", async () => {
    const token = "c".repeat(64);

    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const before = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(token) },
    });
    assert.equal(before.status, 200);

    const logout = await api("/api/auth/logout", {
      method: "POST",
      headers: auth(token, CSRF),
    });
    assert.equal(logout.status, 200);

    // The cookie is cleared with the correct hardening attributes.
    const setCookie = logout.setCookie ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Max-Age=0/);

    // A request with the old token is now rejected.
    const after = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(token) },
    });
    assert.equal(after.status, 401);
  });

  it("rejects a logout without a valid CSRF token", async () => {
    const token = "d".repeat(64);

    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const result = await api("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(token),
        Origin: APP_ORIGIN,
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "csrf_failed");
  });

  it("rejects a valid session belonging to a non-administrator", async () => {
    const token = "e".repeat(64);

    mintSession({
      adminGithubId: "111111",
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const result = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(token) },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "forbidden");
  });
});

/* -------------------------------------------------------------------------- */
/* OAUTH                                                                       */
/* -------------------------------------------------------------------------- */

describe("OAUTH", () => {
  it("rejects a callback with an invalid state", async () => {
    const result = await api(
      "/api/auth/github/callback?state=deadbeef&code=abc",
      { redirect: "manual" },
    );

    assert.equal(result.status, 302);

    const location = result.headers.get("location") ?? "";
    assert.match(location, /error=authentication/);
    // The specific reason is never disclosed to the browser.
    assert.doesNotMatch(location, /state|expired|replay/);
  });

  it("rejects a callback with no state at all", async () => {
    const result = await api(
      "/api/auth/github/callback?code=abc",
      { redirect: "manual" },
    );

    assert.equal(result.status, 302);
    assert.match(
      result.headers.get("location") ?? "",
      /error=authentication/,
    );
  });

  it("starts the OAuth flow with PKCE and a state parameter", async () => {
    // A legitimate start carries a verifiable same-origin signal.
    // Here an exact Origin match; the Referer-only and Sec-Fetch-Site
    // navigation cases are covered separately below.
    //
    // Each start test uses its own source address so it owns its own
    // 5/min budget and cannot be made to fail by an unrelated test
    // consuming the shared default address's budget.
    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.origin,
        Origin: APP_ORIGIN,
      },
    });

    assert.equal(result.status, 302);

    const location = result.headers.get("location") ?? "";
    assert.match(location, /github\.com\/login\/oauth\/authorize/);
    assert.match(location, /code_challenge=/);
    assert.match(location, /code_challenge_method=S256/);
    assert.match(location, /state=[a-f0-9]{64}/);
    // Minimum identity scope only.
    assert.match(location, /scope=read%3Auser/);
    // No repository, email or organisation scope.
    assert.doesNotMatch(location, /repo|write:|admin:/);
  });

  it("rejects a start with no same-origin signal and inserts nothing", async () => {
    const before = oauthTransactionCount();

    // No Sec-Fetch-Site, no Origin and no Referer: a script or a bare
    // client cannot prove the request came from the app.
    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.bare,
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
    assert.equal(
      oauthTransactionCount(),
      before,
      "a rejected start must not insert a transaction row",
    );
  });

  it("rejects a cross-origin start", async () => {
    const before = oauthTransactionCount();

    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.evilOrigin,
        Origin: "https://evil.example",
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
    assert.equal(
      oauthTransactionCount(),
      before,
      "a cross-origin start must not insert a transaction row",
    );
  });

  it("rejects a cross-site start even when it forges a same-origin Referer", async () => {
    // This is the actual abuse shape behind audit finding V-01: a page on
    // another origin triggers the write with <img src=...> or fetch().
    // The browser sets Sec-Fetch-Site: cross-site, and that header cannot
    // be overridden by script. It must win over a spoofed Referer.
    const before = oauthTransactionCount();

    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.crossSite,
        "Sec-Fetch-Site": "cross-site",
        Referer: `${APP_ORIGIN}/admin/login`,
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
    assert.equal(
      oauthTransactionCount(),
      before,
      "a cross-site start must not insert a transaction row",
    );
  });

  it("rejects a same-site start from a look-alike host", async () => {
    // same-site is not same-origin: a sibling subdomain must not be able
    // to drive this deployment's D1 write.
    const before = oauthTransactionCount();

    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.sameSite,
        "Sec-Fetch-Site": "same-site",
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
    assert.equal(
      oauthTransactionCount(),
      before,
      "a same-site start must not insert a transaction row",
    );
  });

  it("accepts the real browser navigation signal and inserts exactly one row", async () => {
    // The legitimate flow is a top-level same-origin navigation from the
    // admin login page. A real browser sends Sec-Fetch-Site: same-origin
    // for that and no Origin header at all, so this is the case that
    // matters most and must not regress.
    const before = oauthTransactionCount();

    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.fetchSite,
        "Sec-Fetch-Site": "same-origin",
        Referer: `${APP_ORIGIN}/admin/login`,
      },
    });

    assert.equal(result.status, 302);
    assert.match(
      result.headers.get("location") ?? "",
      /github\.com\/login\/oauth\/authorize/,
    );
    assert.equal(
      oauthTransactionCount(),
      before + 1,
      "a legitimate start must create exactly one transaction",
    );
  });

  it("accepts a same-origin navigation that sends only a Referer", async () => {
    // A plain link click from the app's own login page in a browser
    // without Fetch Metadata sends a same-origin Referer and no Origin
    // header. This fallback must keep working.
    const before = oauthTransactionCount();

    const result = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.refererOnly,
        Referer: `${APP_ORIGIN}/admin/login`,
      },
    });

    assert.equal(result.status, 302);
    assert.match(
      result.headers.get("location") ?? "",
      /github\.com\/login\/oauth\/authorize/,
    );
    assert.equal(
      oauthTransactionCount(),
      before + 1,
      "a legitimate start must create exactly one transaction",
    );
  });

  it("rate limits the OAuth start route", async () => {
    // A distinct source address so this burst gets its own budget.
    const address = "203.0.113.90";

    const send = () =>
      api("/api/auth/github", {
        redirect: "manual",
        headers: {
          "CF-Connecting-IP": address,
          Origin: APP_ORIGIN,
        },
      });

    // The first 5 requests in a window are allowed.
    for (let index = 0; index < 5; index++) {
      const result = await send();

      assert.equal(
        result.status,
        302,
        `request ${index + 1} inside the budget must be allowed`,
      );
    }

    // The 6th is throttled.
    const limited = await send();

    assert.equal(limited.status, 429);
    assert.equal(limited.body.error?.code, "rate_limited");

    const retryAfter = limited.headers.get("retry-after");

    assert.ok(retryAfter, "429 must carry a Retry-After header");
    assert.ok(
      Number(retryAfter) >= 1,
      "Retry-After must be at least 1 second",
    );
  });

  it("rejects a replayed OAuth callback", async () => {
    const first = await api("/api/auth/github", {
      redirect: "manual",
      headers: {
        "CF-Connecting-IP": OAUTH_START_ADDRESSES.replay,
        Origin: APP_ORIGIN,
      },
    });
    const location = first.headers.get("location") ?? "";
    const state = new URL(location).searchParams.get("state");

    assert.ok(state);

    // Consume it once.
    const consume = await api(
      `/api/auth/github/callback?state=${state}&code=fake`,
      { redirect: "manual" },
    );
    assert.equal(consume.status, 302);

    // The same state must never work twice.
    const replay = await api(
      `/api/auth/github/callback?state=${state}&code=fake`,
      { redirect: "manual" },
    );
    assert.equal(replay.status, 302);
    assert.match(
      replay.headers.get("location") ?? "",
      /error=authentication/,
    );
  });

  it("rejects an unknown OAuth state", async () => {
    const result = await api(
      `/api/auth/github/callback?state=${"f".repeat(64)}&code=x`,
      { redirect: "manual" },
    );

    assert.equal(result.status, 302);
    assert.match(
      result.headers.get("location") ?? "",
      /error=authentication/,
    );
  });

  it("rejects a provider-side denial", async () => {
    const result = await api(
      "/api/auth/github/callback?error=access_denied",
      { redirect: "manual" },
    );

    assert.equal(result.status, 302);
    assert.match(
      result.headers.get("location") ?? "",
      /error=provider/,
    );
  });

  it("allows only allow-listed redirect paths (no open redirect)", () => {
    assert.equal(
      safeRedirectPath("/admin/questions"),
      "/admin/questions",
    );

    // Absolute URLs, protocol-relative URLs, backslashes and
    // anything outside the allow-list all collapse to the default.
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example",
      "/admin/questions/../../etc",
      "/progress",
      "javascript:alert(1)",
      "",
    ]) {
      assert.equal(
        safeRedirectPath(hostile),
        DEFAULT_REDIRECT_PATH,
        `redirect target "${hostile}" must not be honoured`,
      );
    }

    assert.equal(
      safeRedirectPath(null),
      DEFAULT_REDIRECT_PATH,
    );
  });

  it("denies every login when the allow-list is empty", () => {
    const empty = parseAdminGitHubIds("");
    assert.equal(empty.size, 0);
    assert.equal(
      isAllowedAdmin(
        { id: "1", login: "x", avatarUrl: null },
        empty,
      ),
      false,
    );

    const allowed = parseAdminGitHubIds(" 42 , 424242 ,");
    assert.equal(
      isAllowedAdmin(
        { id: "424242", login: "x", avatarUrl: null },
        allowed,
      ),
      true,
    );
    assert.equal(
      isAllowedAdmin(
        { id: "999", login: "x", avatarUrl: null },
        allowed,
      ),
      false,
    );
  });

  it("ignores malformed entries in the allow-list", () => {
    const ids = parseAdminGitHubIds("abc, 12, ;rm -rf, 34");

    assert.deepEqual([...ids].sort(), ["12", "34"]);
  });
});

/* -------------------------------------------------------------------------- */
/* CSRF                                                                        */
/* -------------------------------------------------------------------------- */

describe("CSRF", () => {
  it("rejects a mutation with a missing CSRF token", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(TOKEN),
        "Content-Type": "application/json",
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify(validQuestion({ id: "csrf-missing" })),
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "csrf_failed");
  });

  it("rejects a mutation with a wrong CSRF token", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(TOKEN),
        "Content-Type": "application/json",
        Origin: APP_ORIGIN,
        "X-CSRF-Token": "wrong-token",
      },
      body: JSON.stringify(validQuestion({ id: "csrf-wrong" })),
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "csrf_failed");
  });

  it("rejects a mutation from a foreign origin", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(TOKEN),
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "X-CSRF-Token": CSRF,
      },
      body: JSON.stringify(validQuestion({ id: "csrf-origin" })),
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
  });

  it("rejects a mutation with neither Origin nor Referer", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(TOKEN),
        "Content-Type": "application/json",
        "X-CSRF-Token": CSRF,
      },
      body: JSON.stringify(validQuestion({ id: "csrf-noorigin" })),
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "origin_rejected");
  });

  it("accepts a legitimate same-origin mutation", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(validQuestion({ id: "csrf-ok" })),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });
});

/* -------------------------------------------------------------------------- */
/* AUTHORIZATION + public visibility                                           */
/* -------------------------------------------------------------------------- */

describe("AUTHORIZATION", () => {
  it("never exposes a draft question publicly", async () => {
    await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "draft-question" }),
      ),
    });

    const publicList = await api("/api/questions");
    const listed = (
      (publicList.body.data?.questions as { id: string }[]) ??
      []
    ).map((question) => question.id);

    assert.ok(
      !listed.includes("draft-question"),
      "an unpublished question must not be listed publicly",
    );

    const direct = await api("/api/questions/draft-question");
    assert.equal(direct.status, 404);
  });

  it("never exposes a disabled question publicly", async () => {
    await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "disabled-question" }),
      ),
    });

    // Publish, then disable.
    await api("/api/admin/questions/disabled-question/publish", {
      method: "POST",
      headers: auth(TOKEN, CSRF),
    });

    const afterPublish = await api(
      "/api/questions/disabled-question",
    );
    assert.equal(afterPublish.status, 200);

    await api("/api/admin/questions/disabled-question/disable", {
      method: "POST",
      headers: auth(TOKEN, CSRF),
    });

    const afterDisable = await api(
      "/api/questions/disabled-question",
    );
    assert.equal(
      afterDisable.status,
      404,
      "a disabled question must disappear from the public API",
    );
  });

  it("publishes a question only after an explicit publish call", async () => {
    await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "publish-me" }),
      ),
    });

    const beforePublish = await api(
      "/api/questions/publish-me",
    );
    assert.equal(beforePublish.status, 404);

    await api("/api/admin/questions/publish-me/publish", {
      method: "POST",
      headers: auth(TOKEN, CSRF),
    });

    const afterPublish = await api(
      "/api/questions/publish-me",
    );
    assert.equal(afterPublish.status, 200);

    const question = afterPublish.body.data
      ?.question as Record<string, unknown>;

    assert.equal(question?.id, "publish-me");
    // Internal/admin fields must not be present in the public shape.
    assert.equal(question?.createdBy, undefined);
    assert.equal(question?.version, undefined);
    assert.equal(question?.source, undefined);
  });

  it("cannot escalate privilege by guessing another question id", async () => {
    // A valid session for the allowed admin, but an id that does not
    // exist must be a clean 404, not a leak.
    const result = await api("/api/admin/questions/does-not-exist", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    assert.equal(result.status, 404);
    assert.equal(result.body.error?.code, "not_found");
  });

  it("does not leak session or audit data through the public API", async () => {
    const result = await api("/api/questions");

    const serialised = JSON.stringify(result.body);

    assert.doesNotMatch(serialised, /token_hash/);
    assert.doesNotMatch(serialised, /csrf/);
    assert.doesNotMatch(serialised, /admin_github_id/);
    assert.doesNotMatch(serialised, /client_secret/i);
  });
});

/* -------------------------------------------------------------------------- */
/* INPUT VALIDATION                                                            */
/* -------------------------------------------------------------------------- */

describe("INPUT VALIDATION", () => {
  it("rejects an invalid question type", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({
          id: "bad-engine",
          questionType: "Cobol",
        }),
      ),
    });

    assert.equal(result.status, 400);
    assert.match(
      result.body.error?.message ?? "",
      /questionType/,
    );
  });

  it("rejects an invalid difficulty", () => {
    assert.throws(
      () =>
        parseQuestionInput(
          validQuestion({ difficulty: "Impossible" }),
        ),
      /difficulty/,
    );
  });

  it("rejects a missing required field", async () => {
    const payload = validQuestion();
    delete payload.category;

    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });

    assert.equal(result.status, 400);
  });

  it("rejects an oversized field", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({
          id: "too-long",
          title: "x".repeat(5000),
        }),
      ),
    });

    assert.equal(result.status, 400);
  });

  it("rejects malformed JSON", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: "{not json at all",
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, "bad_request");
  });

  it("rejects a non-object JSON body", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify([1, 2, 3]),
    });

    assert.equal(result.status, 400);
  });

  it("rejects a wrong content type", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "text/plain",
      }),
      body: "hello",
    });

    assert.equal(result.status, 400);
  });

  it("rejects an invalid question id in the path", async () => {
    for (const badId of [
      "..%2F..%2Fetc%2Fpasswd",
      "%3Cscript%3E",
      "has%20space",
    ]) {
      const result = await api(
        `/api/admin/questions/${badId}`,
        { headers: { Cookie: cookieHeader(TOKEN) } },
      );

      assert.equal(
        result.status,
        400,
        `id "${badId}" must be rejected`,
      );
    }
  });

  it("rejects an unsupported database engine", () => {
    assert.throws(
      () =>
        parseQuestionInput(
          validQuestion({
            database: { engine: "MySQL", tables: [] },
          }),
        ),
      /PostgreSQL/,
    );
  });

  it("rejects a table with no columns", () => {
    assert.throws(
      () =>
        parseQuestionInput(
          validQuestion({
            database: {
              engine: "PostgreSQL",
              tables: [
                { name: "t", columns: [], rows: [] },
              ],
            },
          }),
        ),
      /at least one column/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* METHODS, ERRORS, AUDIT                                                      */
/* -------------------------------------------------------------------------- */

describe("HTTP BEHAVIOUR", () => {
  it("rejects an unsupported method", async () => {
    const result = await api("/api/admin/questions", {
      method: "DELETE",
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    assert.equal(result.status, 405);
  });

  it("returns a consistent error envelope with no internals", async () => {
    const result = await api("/api/admin/questions/nope");

    assert.equal(result.body.ok, false);
    assert.equal(typeof result.body.error?.code, "string");
    assert.equal(typeof result.body.error?.message, "string");

    const serialised = JSON.stringify(result.body);

    // No stack traces, SQL, or secret material.
    assert.doesNotMatch(serialised, /at \w+ \(/);
    assert.doesNotMatch(serialised, /SELECT .* FROM/i);
    assert.doesNotMatch(serialised, /client_secret/i);
    assert.doesNotMatch(serialised, /SESSION_SECRET/);
  });

  it("returns 404 for an unknown API route", async () => {
    const result = await api("/api/nope");

    assert.equal(result.status, 404);
  });

  it("requires a session for the audit log", async () => {
    assert.equal(
      (await api("/api/admin/audit")).status,
      401,
    );

    const allowed = await api("/api/admin/audit", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    assert.equal(allowed.status, 200);
  });

  it("records administrative actions in the audit log without secrets", async () => {
    await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "audit-me" }),
      ),
    });

    const result = await api("/api/admin/audit", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    const entries = (
      result.body.data?.entries as {
        action: string;
        metadata: Record<string, unknown>;
      }[]
    ).map((entry) => entry.action);

    assert.ok(entries.includes("question_create"));
    assert.ok(entries.includes("session_denied"));

    const serialised = JSON.stringify(result.body);

    assert.doesNotMatch(serialised, /access_token/);
    assert.doesNotMatch(serialised, /client_secret/);
    assert.doesNotMatch(serialised, new RegExp(TOKEN));
  });

  it("rejects a stale-version update instead of clobbering", async () => {
    const created = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "versioned" }),
      ),
    });

    assert.equal(created.status, 200);

    const stale = await api("/api/admin/questions/versioned", {
      method: "PUT",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({
          id: "versioned",
          title: "Stale write",
          version: 0,
        }),
      ),
    });

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error?.code, "conflict");
  });

  it("soft-deletes without destroying the audit trail", async () => {
    await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(
        validQuestion({ id: "to-delete" }),
      ),
    });

    const removed = await api(
      "/api/admin/questions/to-delete",
      {
        method: "DELETE",
        headers: auth(TOKEN, CSRF),
      },
    );

    assert.equal(removed.status, 200);
    assert.equal(removed.body.data?.softDeleted, true);

    // Gone from the admin list...
    const list = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    const ids = (
      list.body.data?.questions as { id: string }[]
    ).map((question) => question.id);

    assert.ok(!ids.includes("to-delete"));

    // ...but the audit log still references it.
    const audit = await api("/api/admin/audit", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    const questionIds = (
      audit.body.data?.entries as { questionId: string }[]
    ).map((entry) => entry.questionId);

    assert.ok(questionIds.includes("to-delete"));
  });

  it("imports legacy browser-local questions without overwriting", async () => {
    const result = await api("/api/admin/questions", {
      method: "POST",
      headers: auth(TOKEN, CSRF, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        questions: [
          validQuestion({ id: "legacy-a" }),
          validQuestion({ id: "legacy-b" }),
          // `draft-question` already exists server-side.
          validQuestion({
            id: "draft-question",
            title: "Should not overwrite",
          }),
        ],
      }),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data?.imported, 2);
    assert.equal(result.body.data?.skipped, 1);
    assert.equal(result.body.data?.conflicts, 1);

    // The pre-existing record was preserved.
    const existing = await api(
      "/api/admin/questions/draft-question",
      { headers: { Cookie: cookieHeader(TOKEN) } },
    );

    const question = existing.body.data
      ?.question as Record<string, unknown>;

    assert.notEqual(question?.title, "Should not overwrite");
  });
});
