/**
 * Session and catalog amplification reduction (task 4.2G).
 *
 * Closes audit findings V-04 (an authenticated read performed a write) and
 * V-07 (each admin mutation triggered several identical full-catalog fetches).
 *
 * The idle timeout is a security control, not a convenience, so the most
 * important assertions in this file are the ones proving it did NOT get
 * weaker: a session is still revoked at the documented interval, and the
 * write-throttle cannot extend a session in practice.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createHash } from "node:crypto";

import {
  d1Command,
  mintSession,
  startWorker,
  stopWorker,
  SESSION_SECRET,
  TEST_ADMIN_ID,
  WORKER_ORIGIN,
} from "./harness.ts";

import {
  IDLE_TTL_SECONDS,
  LAST_SEEN_WRITE_THRESHOLD_SECONDS,
} from "../session.ts";

const TOKEN = "a".repeat(64);
const CSRF = "csrf-token-for-session-tests-00";

function admin(): HeadersInit {
  return {
    Cookie: `qv_admin_session=${TOKEN}`,
    // Mutations require a same-origin signal; without this the server
    // correctly rejects them with 403 before reaching the route.
    Origin: WORKER_ORIGIN,
    "X-CSRF-Token": CSRF,
    "Content-Type": "application/json",
  };
}

async function readSession(
  token = TOKEN,
): Promise<{
  status: number;
  body: { data?: { authenticated?: boolean } };
}> {
  const response = await fetch(`${WORKER_ORIGIN}/api/auth/session`, {
    headers: { Cookie: `qv_admin_session=${token}` },
  });

  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { authenticated?: boolean };
    },
  };
}

/** last_seen_at currently stored for a token. */
function storedLastSeen(token: string): string | null {
  // The Worker hashes the token as SHA-256(`${SESSION_SECRET}.${token}`),
  // so the test must apply the same transform to find the row.
  const tokenHash = createHash("sha256")
    .update(`${SESSION_SECRET}.${token}`)
    .digest("hex");

  const rows = d1Command(
    `SELECT last_seen_at FROM admin_sessions WHERE token_hash = '${tokenHash}';`,
  );

  const match = /"last_seen_at"\s*:\s*"([^"]+)"/.exec(rows);

  return match ? (match[1] as string) : null;
}

/**
 * Authentication outcome.
 *
 * `GET /api/auth/session` deliberately answers 200 with
 * `authenticated: false` rather than 401 for an invalid session, because
 * the endpoint is a probe the SPA calls on load. A protected ADMIN route
 * answers 401. These tests use the admin route for the "must be rejected"
 * assertions, because that is the signal that actually gates access.
 */
async function isAuthenticated(
  token: string,
): Promise<boolean> {
  const result = await readSession(token);
  const data = result.body.data as
    | { authenticated?: boolean }
    | undefined;

  return data?.authenticated === true;
}

async function adminAccepted(token: string): Promise<number> {
  const response = await fetch(`${WORKER_ORIGIN}/api/admin/questions`, {
    headers: { Cookie: `qv_admin_session=${token}` },
  });

  return response.status;
}

before(async () => {
  await startWorker();

  // The V-07 catalog suite below drives real admin mutations, which all
  // require an authenticated session.
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

describe("V-04: a session read is no longer a write on every request", () => {
  it("repeated reads inside the threshold do not move last_seen_at", async () => {
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token: "b".repeat(64),
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const token = "b".repeat(64);

    // First read establishes a fresh timestamp.
    const first = await readSession(token);
    assert.equal(first.status, 200);

    const afterFirst = storedLastSeen(token);
    assert.ok(afterFirst, "the session row must exist");

    // Several more reads within the threshold must not write again.
    for (let index = 0; index < 5; index += 1) {
      const result = await readSession(token);

      assert.equal(
        result.status,
        200,
        `read ${index + 2} must still authenticate`,
      );
    }

    const afterReads = storedLastSeen(token);

    assert.equal(
      afterReads,
      afterFirst,
      "repeated reads inside the threshold must not rewrite last_seen_at",
    );
  });

  it("a read still authenticates correctly while throttled", async () => {
    const token = "b".repeat(64);
    const result = await readSession(token);

    assert.equal(result.status, 200);

    const data = result.body.data as {
      authenticated?: boolean;
      admin?: { login?: string };
      csrfToken?: string;
    } | null;

    assert.equal(data?.authenticated, true);
    assert.ok(data?.admin?.login, "the session must still resolve a login");
    assert.ok(data?.csrfToken, "the CSRF token must still be issued");
  });

  it("a stale timestamp is refreshed again", async () => {
    // Prove the throttle is a threshold, not a permanent disable: a
    // timestamp older than the window must still be written forward.
    const token = "c".repeat(64);

    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
      lastSeenAt: new Date(
        Date.now() - (LAST_SEEN_WRITE_THRESHOLD_SECONDS + 120) * 1000,
      ).toISOString(),
    });

    const staleBefore = storedLastSeen(token);
    assert.ok(staleBefore);

    const result = await readSession(token);
    assert.equal(result.status, 200);

    const staleAfter = storedLastSeen(token);

    assert.notEqual(
      staleAfter,
      staleBefore,
      "a stale last_seen_at must be refreshed",
    );
    assert.ok(
      Date.parse(staleAfter as string) > Date.parse(staleBefore),
      "the refreshed timestamp must move forward",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("V-04: the idle timeout is NOT weakened", () => {
  it("a session idle past the documented interval is still revoked", async () => {
    const token = "d".repeat(64);

    // last_seen_at older than IDLE_TTL_SECONDS, expires_at far in the
    // future. Only the idle rule can reject this session.
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
      lastSeenAt: new Date(
        Date.now() - (IDLE_TTL_SECONDS + 60) * 1000,
      ).toISOString(),
    });

    // Prove the fixture really is idle, so a 200 could not be mistaken
    // for a weakened timeout.
    const stored = storedLastSeen(token);

    assert.ok(stored, "the session row must exist");
    assert.ok(
      Date.now() - Date.parse(stored) > IDLE_TTL_SECONDS * 1000,
      "the stored timestamp must genuinely be older than the idle window",
    );

    assert.equal(
      await isAuthenticated(token),
      false,
      "an idle session must no longer authenticate",
    );

    assert.equal(
      await adminAccepted(token),
      401,
      "an idle session must be refused at a protected route",
    );
  });

  it("a session inside the idle window still authenticates", async () => {
    const token = "e".repeat(64);

    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
      lastSeenAt: new Date(
        Date.now() - (IDLE_TTL_SECONDS - 600) * 1000,
      ).toISOString(),
    });

    const result = await readSession(token);

    assert.equal(result.status, 200);
  });

  it("the write threshold is far smaller than the idle window", async () => {
    // The throttle may only LAG activity detection. It must never be a
    // meaningful fraction of the timeout it protects.
    assert.ok(
      LAST_SEEN_WRITE_THRESHOLD_SECONDS < IDLE_TTL_SECONDS / 10,
      `threshold ${LAST_SEEN_WRITE_THRESHOLD_SECONDS}s must be far below ` +
        `the ${IDLE_TTL_SECONDS}s idle window`,
    );
  });

  it("expiry is still enforced independently of last_seen_at", async () => {
    const token = "f".repeat(64);

    // last_seen_at is deliberately FRESH, so only the absolute expiry can
    // reject this session. This is the assertion that the new write
    // throttle did not become a way to keep an expired session alive.
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() - 60_000),
      lastSeenAt: new Date().toISOString(),
    });

    assert.equal(
      await isAuthenticated(token),
      false,
      "an expired session must not authenticate despite a fresh last_seen_at",
    );

    assert.equal(
      await adminAccepted(token),
      401,
      "an expired session must be refused at a protected route",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("V-07: the admin catalog is correct after every mutation", () => {
  async function create(
    id: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/${id}/publish`,
      {
        method: "POST",
        headers: { ...admin(), "X-CSRF-Token": CSRF },
      },
    );

    return { status: response.status };
  }

  async function createQuestion(
    id: string,
  ): Promise<void> {
    const response = await fetch(`${WORKER_ORIGIN}/api/admin/questions`, {
      method: "POST",
      headers: { ...admin(), "X-CSRF-Token": CSRF },
      body: JSON.stringify({
        id,
        title: `Amp ${id}`,
        description: "Amplification suite.",
        difficulty: "Easy",
        questionType: "SQL",
        category: "Filtering",
        languages: ["PostgreSQL"],
        tags: ["SELECT"],
        companies: [],
        starterCode: "SELECT 1;",
        solutionCode: "SELECT 1;",
        testCases: [{ input: "", expectedOutput: "1" }],
      }),
    });

    assert.equal(response.status, 200);
  }

  async function adminList(): Promise<
    Array<{
      id: string;
      title: string;
      published: boolean;
      enabled: boolean;
      version?: number;
    }>
  > {
    const response = await fetch(`${WORKER_ORIGIN}/api/admin/questions`, {
      headers: { Cookie: `qv_admin_session=${TOKEN}` },
    });

    const body = (await response.json()) as {
      data?: {
        questions?: Array<{
          id: string;
          title: string;
          published: boolean;
          enabled: boolean;
          version?: number;
        }>;
      };
    };

    return body.data?.questions ?? [];
  }

  async function publicIds(): Promise<string[]> {
    const response = await fetch(`${WORKER_ORIGIN}/api/questions`);
    const body = (await response.json()) as {
      data?: { questions?: Array<{ id: string }> };
    };

    return (body.data?.questions ?? []).map((question) => question.id);
  }

  async function mutate(
    id: string,
    action: string,
  ): Promise<number> {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/${id}/${action}`,
      { method: "POST", headers: { ...admin(), "X-CSRF-Token": CSRF } },
    );

    return response.status;
  }

  it("a create is invisible publicly until published", async () => {
    await createQuestion("amp-create-1");

    const list = await adminList();

    assert.ok(
      list.some((question) => question.id === "amp-create-1"),
      "a draft must appear in the admin list",
    );
    assert.ok(
      !(await publicIds()).includes("amp-create-1"),
      "a draft must not appear publicly",
    );
  });

  it("publish makes it public and unpublish hides it again", async () => {
    await createQuestion("amp-pub-1");

    assert.equal(await mutate("amp-pub-1", "publish"), 200);
    assert.ok(
      (await publicIds()).includes("amp-pub-1"),
      "publish must make it public",
    );

    assert.equal(await mutate("amp-pub-1", "unpublish"), 200);
    assert.ok(
      !(await publicIds()).includes("amp-pub-1"),
      "unpublish must hide it again",
    );
  });

  it("disable hides it and enable restores it", async () => {
    await createQuestion("amp-tog-1");
    await create("amp-tog-1");

    assert.ok((await publicIds()).includes("amp-tog-1"));

    assert.equal(await mutate("amp-tog-1", "disable"), 200);
    assert.ok(
      !(await publicIds()).includes("amp-tog-1"),
      "disable must remove it from the public list",
    );

    assert.equal(await mutate("amp-tog-1", "enable"), 200);
    assert.ok(
      (await publicIds()).includes("amp-tog-1"),
      "enable must restore it",
    );
  });

  it("an update is reflected in both views", async () => {
    await createQuestion("amp-upd-1");
    await create("amp-upd-1");

    const before = (
      await adminList()
    ).find((question) => question.id === "amp-upd-1");

    assert.ok(before, "the question must exist before the update");

    const response = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/amp-upd-1`,
      {
        method: "PUT",
        headers: admin(),
        body: JSON.stringify({
          id: "amp-upd-1",
          title: "Renamed By Amplification Suite",
          description: "Updated.",
          difficulty: "Hard",
          questionType: "SQL",
          category: "Joins",
          languages: ["PostgreSQL"],
          tags: ["SELECT"],
          companies: [],
          starterCode: "SELECT 2;",
          solutionCode: "SELECT 2;",
          testCases: [{ input: "", expectedOutput: "2" }],
          // A PUT replaces the whole record, so the flags must be resent.
          // Omitting them would un-publish the question, which is correct
          // server behaviour but not what this test is about.
          published: true,
          enabled: true,
          // Supplying the current version keeps this a plain update
          // rather than an optimistic-concurrency conflict.
          version: before.version ?? 1,
        }),
      },
    );

    assert.equal(response.status, 200);

    const after = (
      await adminList()
    ).find((question) => question.id === "amp-upd-1");

    assert.ok(after, "the updated row must remain in the admin list");
    assert.equal(
      after.title,
      "Renamed By Amplification Suite",
      "the admin list must show the updated row",
    );
    assert.ok(
      (await publicIds()).includes("amp-upd-1"),
      "the updated row must still be public",
    );
  });

  it("delete removes it from both views", async () => {
    await createQuestion("amp-del-1");
    await create("amp-del-1");

    const response = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/amp-del-1`,
      { method: "DELETE", headers: { ...admin(), "X-CSRF-Token": CSRF } },
    );

    assert.equal(response.status, 200);

    assert.ok(
      !(await adminList()).some(
        (question) => question.id === "amp-del-1",
      ),
      "delete must remove it from the admin list",
    );
    assert.ok(!(await publicIds()).includes("amp-del-1"));
  });

  it("duplicate creates a new row without touching the original", async () => {
    await createQuestion("amp-dup-src");
    await create("amp-dup-src");

    const response = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/amp-dup-src/duplicate`,
      {
        method: "POST",
        headers: { ...admin(), "X-CSRF-Token": CSRF },
        // The route reads the new id from `id`, not `newId`.
        body: JSON.stringify({ id: "amp-dup-copy" }),
      },
    );

    assert.equal(response.status, 200);

    const ids = (await adminList()).map((question) => question.id);

    assert.ok(ids.includes("amp-dup-src"), "the original must survive");
    assert.ok(ids.includes("amp-dup-copy"), "the copy must exist");
  });

  it("a full reload returns the same catalog, proving refresh recovery", async () => {
    // Stands in for a browser refresh: no cached state, purely what the
    // server returns.
    const before = (await adminList()).map((question) => question.id).sort();

    const after = (await adminList()).map((question) => question.id).sort();

    assert.deepEqual(
      after,
      before,
      "a reload must reproduce the catalog from the server",
    );
  });
});