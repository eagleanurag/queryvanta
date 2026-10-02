/**
 * Public API caching and ETag (task 4.2D).
 *
 * Closes audit finding V-05: the two public read endpoints were served
 * with `Cache-Control: no-store`, so every anonymous request re-read D1
 * and nothing was ever absorbed by a shared cache.
 *
 * This task is the highest-risk one in Phase 4 for information
 * disclosure, so the suite is weighted towards proving what must NOT
 * become cacheable:
 *
 *   - the public list and detail carry a public policy plus an ETag, and
 *     a matching `If-None-Match` returns 304;
 *   - EVERY other API response still carries `no-store`, checked
 *     explicitly endpoint by endpoint rather than assumed;
 *   - drafts and disabled questions stay unreachable, before AND after
 *     the cache is populated, which is the case caching could plausibly
 *     have broken.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  APP_ORIGIN,
  mintSession,
  startWorker,
  stopWorker,
  TEST_ADMIN_ID,
  WORKER_ORIGIN,
} from "./harness.ts";

const TOKEN = "a".repeat(64);
const CSRF = "csrf-token-for-cache-tests-0000";

function cookieHeader(token: string): string {
  return `qv_admin_session=${token}`;
}

function admin(
  extra: HeadersInit = {},
): HeadersInit {
  return {
    Cookie: cookieHeader(TOKEN),
    Origin: APP_ORIGIN,
    "X-CSRF-Token": CSRF,
    ...extra,
  };
}

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  text: string;
}> {
  const response = await fetch(
    `${WORKER_ORIGIN}${path}`,
    init,
  );
  const text = await response.text();

  let body: Record<string, unknown>;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A 304 has no body, so an empty envelope is the correct fallback
    // rather than a failure.
    body = {};
  }

  return { status: response.status, body, headers: response.headers, text };
}

function validQuestion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "cache-test-1",
    title: "Cache Test Question",
    description: "Created by the caching suite.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Filtering",
    languages: ["PostgreSQL"],
    tags: ["SELECT"],
    companies: [],
    starterCode: "SELECT 1;",
    solutionCode: "SELECT 1;",
    testCases: [{ input: "", expectedOutput: "1" }],
    ...overrides,
  };
}

async function createQuestion(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const created = await api("/api/admin/questions", {
    method: "POST",
    headers: admin({ "Content-Type": "application/json" }),
    body: JSON.stringify(validQuestion({ id, ...overrides })),
  });

  assert.equal(
    created.status,
    200,
    `failed to create ${id}: ${created.text}`,
  );
}

async function publish(id: string): Promise<void> {
  const result = await api(`/api/admin/questions/${id}/publish`, {
    method: "POST",
    headers: admin(),
  });

  assert.equal(result.status, 200, `failed to publish ${id}`);
}

before(async () => {
  await startWorker();

  // The administrator session is required by the very first assertions,
  // so it is established here rather than in a trailing setup block.
  mintSession({
    adminGithubId: TEST_ADMIN_ID,
    token: TOKEN,
    csrfToken: CSRF,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */

describe("CACHE: public reads are cacheable", () => {
  it("the public list carries a public cache policy and an ETag", async () => {
    const result = await api("/api/questions");

    assert.equal(result.status, 200);

    const cacheControl = result.headers.get("cache-control") ?? "";
    assert.match(
      cacheControl,
      /public/,
      "the public list must be publicly cacheable",
    );
    assert.match(cacheControl, /max-age=\d+/);

    const etag = result.headers.get("etag");
    assert.ok(etag, "the public list must carry an ETag");
    assert.match(
      etag,
      /^"[\w-]+"$/,
      `ETag must be a quoted entity tag, got ${etag}`,
    );
  });

  it("a conditional request with a matching ETag returns 304", async () => {
    const first = await api("/api/questions");
    const etag = first.headers.get("etag") ?? "";

    assert.ok(etag);

    const second = await api("/api/questions", {
      headers: { "If-None-Match": etag },
    });

    assert.equal(
      second.status,
      304,
      "a matching ETag must produce 304 Not Modified",
    );
    assert.equal(
      second.text,
      "",
      "304 must not carry a body",
    );
    assert.equal(
      second.headers.get("etag"),
      etag,
      "304 must echo the validator",
    );
    assert.match(
      second.headers.get("cache-control") ?? "",
      /public/,
      "304 must repeat the cache policy",
    );
  });

  it("a stale ETag returns a fresh 200 with new content", async () => {
    const result = await api("/api/questions", {
      headers: { "If-None-Match": '"stale-tag-value"' },
    });

    assert.equal(result.status, 200);
    assert.ok(result.text.length > 0);
  });

  it("honours a weak ETag and the wildcard", async () => {
    const first = await api("/api/questions");
    const etag = first.headers.get("etag") ?? "";

    const weak = await api("/api/questions", {
      headers: { "If-None-Match": `W/${etag}` },
    });

    assert.equal(weak.status, 304, "weak comparison must match a strong tag");

    const wildcard = await api("/api/questions", {
      headers: { "If-None-Match": "*" },
    });

    assert.equal(wildcard.status, 304);
  });

  it("the public detail endpoint is cacheable too", async () => {
    await createQuestion("cache-detail-1");
    await publish("cache-detail-1");

    const first = await api("/api/questions/cache-detail-1");

    assert.equal(first.status, 200);
    assert.match(
      first.headers.get("cache-control") ?? "",
      /public/,
    );

    const etag = first.headers.get("etag") ?? "";
    assert.ok(etag, "the public detail must carry an ETag");

    const second = await api("/api/questions/cache-detail-1", {
      headers: { "If-None-Match": etag },
    });

    assert.equal(second.status, 304);
  });

  it("the ETag is derived from content, not from time", async () => {
    // Identical content must produce an identical tag, otherwise the
    // validator is worthless and clients re-download forever.
    const first = await api("/api/questions");
    const second = await api("/api/questions");

    assert.equal(
      second.headers.get("etag"),
      first.headers.get("etag"),
      "unchanged content must yield a stable ETag",
    );
  });

  it("the ETag changes when the content changes", async () => {
    const before = await api("/api/questions");
    const beforeTag = before.headers.get("etag") ?? "";

    await createQuestion("cache-etag-change-1");
    await publish("cache-etag-change-1");

    const after = await api("/api/questions");

    assert.notEqual(
      after.headers.get("etag"),
      beforeTag,
      "publishing a question must change the list ETag",
    );

    // And the old validator must no longer be honoured.
    const stale = await api("/api/questions", {
      headers: { "If-None-Match": beforeTag },
    });

    assert.equal(stale.status, 200);
  });

  it("a 404 for an unknown public question is not cached", async () => {
    const result = await api("/api/questions/no-such-question-xyz");

    assert.equal(result.status, 404);
    assert.match(
      result.headers.get("cache-control") ?? "",
      /no-store/,
      "caching a negative result would pin a question as missing",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("CACHE: nothing else became cacheable", () => {
  // The audit is explicit that the risk here is information disclosure,
  // so every one of these is an explicit assertion rather than an
  // assumption. `/api/admin/*` holds unpublished drafts and the audit
  // log; `/api/auth/session` holds the identity and the CSRF token,
  // which a shared cache would hand to the wrong administrator.

  async function assertNoStore(
    label: string,
    path: string,
    init: RequestInit = {},
  ): Promise<void> {
    const result = await api(path, init);
    const cacheControl = result.headers.get("cache-control") ?? "";

    assert.match(
      cacheControl,
      /no-store/,
      `${label} (${path}) must stay no-store, got "${cacheControl}"`,
    );
  }

  it("the admin question list stays no-store", async () => {
    await assertNoStore("admin list", "/api/admin/questions", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });
  });

  it("an admin question detail stays no-store", async () => {
    await assertNoStore("admin detail", "/api/admin/questions/cache-detail-1", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });
  });

  it("the admin audit log stays no-store", async () => {
    await assertNoStore("admin audit", "/api/admin/audit", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });
  });

  it("the session endpoint stays no-store", async () => {
    await assertNoStore("session", "/api/auth/session");
  });

  it("an authenticated session response stays no-store", async () => {
    // The dangerous one: this body carries the CSRF token.
    await assertNoStore("authenticated session", "/api/auth/session", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });
  });

  it("the health probe stays no-store", async () => {
    await assertNoStore("health", "/api/health");
  });

  it("error responses stay no-store", async () => {
    await assertNoStore("unknown route", "/api/nope");
  });

  it("no API response ever reports a shared-cache policy except the two public reads", async () => {
    const shared: string[] = [];

    const paths = [
      "/api/health",
      "/api/auth/session",
      "/api/admin/questions",
      "/api/admin/audit",
      "/api/questions",
      "/api/questions/cache-detail-1",
      "/api/nope",
    ];

    for (const path of paths) {
      const headers: Record<string, string> = {};

      if (path.startsWith("/api/admin")) {
        headers.Cookie = cookieHeader(TOKEN);
      }

      const result = await api(path, { headers });
      const cacheControl = result.headers.get("cache-control") ?? "";

      if (/public/.test(cacheControl)) {
        shared.push(path);
      }
    }

    assert.deepEqual(
      shared.sort(),
      ["/api/questions", "/api/questions/cache-detail-1"].sort(),
      "only the two public read endpoints may be publicly cacheable",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("CACHE: draft isolation survives caching", () => {
  it("a draft is never reachable publicly", async () => {
    // Created but never published.
    await createQuestion("cache-draft-1");

    const detail = await api("/api/questions/cache-draft-1");
    assert.equal(detail.status, 404, "a draft must not be readable");

    const list = await api("/api/questions");
    const serialised = JSON.stringify(list.body);

    assert.ok(
      !serialised.includes("cache-draft-1"),
      "a draft must not appear in the public list",
    );
  });

  it("a disabled question becomes unreachable again", async () => {
    await createQuestion("cache-disable-1");
    await publish("cache-disable-1");

    const visible = await api("/api/questions/cache-disable-1");
    assert.equal(visible.status, 200);

    // Warm the LIST cache while the question is legitimately
    // published. The validator must be the list's own ETag: the list and
    // the detail are different representations and never share a tag.
    const listBefore = await api("/api/questions");
    const listTag = listBefore.headers.get("etag") ?? "";

    const warm = await api("/api/questions", {
      headers: { "If-None-Match": listTag },
    });
    assert.equal(warm.status, 304, "the warm-up should hit the validator");

    const disabled = await api(
      "/api/admin/questions/cache-disable-1/disable",
      { method: "POST", headers: admin() },
    );
    assert.equal(disabled.status, 200);

    const after = await api("/api/questions/cache-disable-1");
    assert.equal(
      after.status,
      404,
      "a disabled question must stop being served",
    );

    // The list must have produced a new validator rather than continuing
    // to honour the pre-disable one.
    const listAfter = await api("/api/questions", {
      headers: { "If-None-Match": listTag },
    });

    assert.equal(
      listAfter.status,
      200,
      "disabling a question must invalidate the list validator",
    );
  });

  it("a soft-deleted question is unreachable", async () => {
    await createQuestion("cache-delete-1");
    await publish("cache-delete-1");

    assert.equal(
      (await api("/api/questions/cache-delete-1")).status,
      200,
    );

    const deleted = await api(
      "/api/admin/questions/cache-delete-1",
      { method: "DELETE", headers: admin() },
    );
    assert.equal(deleted.status, 200);

    const after = await api("/api/questions/cache-delete-1");
    assert.equal(after.status, 404);
  });

  it("a question that was never published does not become visible via a cached list", async () => {
    // Read the list first so a cache entry exists, then create a draft,
    // then read again: the draft must not appear.
    await api("/api/questions");

    await createQuestion("cache-draft-after-warm-1");

    const after = await api("/api/questions");
    const serialised = JSON.stringify(after.body);

    assert.ok(
      !serialised.includes("cache-draft-after-warm-1"),
      "caching must not surface an unpublished draft",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("CACHE: the administrator session is real", () => {
  it("accepts an authenticated admin read", async () => {
    // Proves the authenticated no-store assertions elsewhere in this
    // file were meaningful: an unauthenticated admin call returns 401
    // and would make a cache-header check vacuous.
    const result = await api("/api/admin/questions", {
      headers: { Cookie: cookieHeader(TOKEN) },
    });

    assert.equal(result.status, 200);
  });

  it("still rejects an unauthenticated admin read", async () => {
    const result = await api("/api/admin/questions");

    assert.equal(result.status, 401);
  });
});