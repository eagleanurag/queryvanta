/**
 * Public query and filter bounds (task 4.2E).
 *
 * Closes audit findings V-06 (unbounded `SELECT *` on the public list)
 * and V-12 (unvalidated, unbounded-length filter parameters).
 *
 * The allow-lists are derived from the repository's own enums, so these
 * tests also pin down that the read path and the write path agree about
 * what a valid value is.
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

import {
  DIFFICULTIES,
  LIMITS,
  QUESTION_TYPES,
} from "../questionSchema.ts";

import { PUBLIC_LIST_LIMIT } from "../store.ts";

const TOKEN = "a".repeat(64);
const CSRF = "csrf-token-for-bounds-tests-0000";

function admin(): HeadersInit {
  return {
    Cookie: `qv_admin_session=${TOKEN}`,
    Origin: APP_ORIGIN,
    "X-CSRF-Token": CSRF,
  };
}

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{
  status: number;
  body: {
    ok?: boolean;
    data?: {
      questions?: unknown[];
      count?: number;
      total?: number;
      truncated?: boolean;
      limit?: number;
    };
    error?: { code?: string; message?: string };
  };
}> {
  const response = await fetch(`${WORKER_ORIGIN}${path}`, init);
  const text = await response.text();

  let body: Awaited<ReturnType<typeof api>>["body"] = {};

  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }

  return { status: response.status, body };
}

function validQuestion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "bounds-test-1",
    title: "Bounds Test Question",
    description: "Created by the bounds suite.",
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

async function createAndPublish(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const created = await api("/api/admin/questions", {
    method: "POST",
    headers: { ...admin(), "Content-Type": "application/json" },
    body: JSON.stringify(validQuestion({ id, ...overrides })),
  });

  assert.equal(
    created.status,
    200,
    `failed to create ${id}: ${JSON.stringify(created.body)}`,
  );

  const published = await api(
    `/api/admin/questions/${id}/publish`,
    { method: "POST", headers: admin() },
  );

  assert.equal(published.status, 200, `failed to publish ${id}`);
}

before(async () => {
  await startWorker();

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

describe("BOUNDS: the public list is bounded", () => {
  it("reports the total separately from what was returned", async () => {
    const result = await api("/api/questions");

    assert.equal(result.status, 200);

    const data = result.body.data;

    assert.ok(data, "the response must carry a data envelope");
    assert.equal(
      typeof data.count,
      "number",
      "count must describe this response",
    );
    assert.equal(
      typeof data.total,
      "number",
      "total must describe the whole matching set",
    );
    assert.equal(typeof data.truncated, "boolean");

    // The honest-reporting invariant: the response never claims to have
    // returned more than it did, and never under-reports the total.
    assert.equal(
      data.count,
      Array.isArray(data.questions) ? data.questions.length : -1,
      "count must equal the number of questions actually returned",
    );
    assert.ok(
      (data.total ?? 0) >= (data.count ?? 0),
      "total must never be smaller than the returned count",
    );
    assert.equal(
      data.truncated,
      (data.total ?? 0) > (data.count ?? 0),
      "truncated must be exactly total > count",
    );
    assert.equal(data.limit, PUBLIC_LIST_LIMIT);
  });

  it("never returns more rows than the declared limit", async () => {
    const result = await api("/api/questions");
    const questions = result.body.data?.questions ?? [];

    assert.ok(
      questions.length <= PUBLIC_LIST_LIMIT,
      `returned ${questions.length} rows, limit is ${PUBLIC_LIST_LIMIT}`,
    );
  });

  it("the limit is a real bound, not a no-op", async () => {
    // A page that could never be exceeded would prove nothing.
    assert.ok(
      PUBLIC_LIST_LIMIT > 0 && Number.isFinite(PUBLIC_LIST_LIMIT),
      "the limit must be a positive finite number",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("BOUNDS: filter validation", () => {
  it("rejects a difficulty outside the allow-list", async () => {
    const result = await api("/api/questions?difficulty=Impossible");

    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, "bad_request");
    assert.match(
      result.body.error?.message ?? "",
      /difficulty/,
      "the error must name the offending filter",
    );
  });

  it("rejects an engine outside the allow-list", async () => {
    const result = await api("/api/questions?engine=Cobol");

    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, "bad_request");
    assert.match(result.body.error?.message ?? "", /engine/);
  });

  it("rejects an over-long difficulty", async () => {
    const result = await api(
      `/api/questions?difficulty=${"E".repeat(500)}`,
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, "bad_request");
  });

  it("rejects an over-long category", async () => {
    const result = await api(
      `/api/questions?category=${"c".repeat(LIMITS.category + 1)}`,
    );

    assert.equal(result.status, 400, "an over-long category must be rejected");
    assert.equal(result.body.error?.code, "bad_request");
  });

  it("rejects an injection-shaped category", async () => {
    const result = await api(
      `/api/questions?category=${encodeURIComponent("<script>alert(1)</script>")}`,
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, "bad_request");
  });

  it("reports a client error rather than silently returning nothing", async () => {
    // The task requires the rejection to be discoverable, so an invalid
    // filter must NOT degrade into a 200 with zero rows.
    const result = await api("/api/questions?difficulty=Nope");

    assert.notEqual(
      result.status,
      200,
      "an invalid filter must not look like an empty result",
    );
    assert.equal(result.status, 400);
  });

  it("accepts every real difficulty value", async () => {
    for (const difficulty of DIFFICULTIES) {
      const result = await api(
        `/api/questions?difficulty=${encodeURIComponent(difficulty)}`,
      );

      assert.equal(
        result.status,
        200,
        `difficulty "${difficulty}" is a real value and must be accepted`,
      );
    }
  });

  it("accepts every real question type", async () => {
    for (const engine of QUESTION_TYPES) {
      const result = await api(
        `/api/questions?engine=${encodeURIComponent(engine)}`,
      );

      assert.equal(
        result.status,
        200,
        `engine "${engine}" is a real value and must be accepted`,
      );
    }
  });

  it("still honours the All sentinel", async () => {
    const result = await api("/api/questions?difficulty=All&engine=All");

    assert.equal(result.status, 200);
  });

  it("accepts a valid filter and actually filters", async () => {
    await createAndPublish("bounds-filter-1", {
      difficulty: "Hard",
      category: "Joins",
      questionType: "PySpark",
    });

    const filtered = await api(
      "/api/questions?difficulty=Hard&category=Joins",
    );

    assert.equal(filtered.status, 200);

    const questions =
      (filtered.body.data?.questions ?? []) as Array<{
        difficulty: string;
        category: string;
      }>;

    for (const question of questions) {
      assert.equal(
        question.difficulty,
        "Hard",
        "every returned row must match the difficulty filter",
      );
      assert.equal(
        question.category,
        "Joins",
        "every returned row must match the category filter",
      );
    }
  });

  it("accepts combined filters", async () => {
    const result = await api(
      "/api/questions?engine=SQL&difficulty=Easy&category=Filtering",
    );

    assert.equal(result.status, 200);

    const questions =
      (result.body.data?.questions ?? []) as Array<{
        questionType: string;
      }>;

    for (const question of questions) {
      assert.equal(question.questionType, "SQL");
    }
  });

  it("accepts a category that is not in the built-in catalog", async () => {
    // `category` is a free-form TEXT column by design, so an
    // administrator-created category must remain filterable. A static
    // allow-list here would be a regression.
    await createAndPublish("bounds-new-category-1", {
      category: "Zzz Newly Invented Category",
    });

    const result = await api(
      `/api/questions?category=${encodeURIComponent("Zzz Newly Invented Category")}`,
    );

    assert.equal(
      result.status,
      200,
      "an admin-created category must still be filterable",
    );

    const questions =
      (result.body.data?.questions ?? []) as Array<{ id: string }>;

    assert.ok(
      questions.some(
        (question) => question.id === "bounds-new-category-1",
      ),
      "the newly created category must be selectable",
    );
  });

  it("a blank filter value is treated as absent, not as an error", async () => {
    const result = await api("/api/questions?difficulty=");

    assert.equal(result.status, 200);
  });
});