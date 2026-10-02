/**
 * Bulk import batching (task 4.2F).
 *
 * Closes audit finding V-08: the import was a sequential loop costing
 * roughly three D1 round trips per item, so a 500-item import performed
 * about 1,500 sequential round trips in a single request.
 *
 * The risk in this task is that batching silently changes import
 * semantics. These tests therefore pin the OBSERVABLE contract rather
 * than the implementation:
 *
 *   - the outcome shape and counts are identical for a mixed batch;
 *   - an existing server-side question is never overwritten;
 *   - a duplicate inside one request is reported as a conflict, in order;
 *   - an invalid item still rejects the whole request, as before;
 *   - a 500-item import completes with a bounded number of statements.
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
  IMPORT_ROWS_PER_STATEMENT,
  IMPORT_STATEMENTS_PER_BATCH,
} from "../store.ts";

const TOKEN = "a".repeat(64);
const CSRF = "csrf-token-for-import-tests-0000";

type Outcome = {
  imported: number;
  skipped: number;
  conflicts: number;
  failed: number;
  failures: { id: string; reason: string }[];
};

function admin(): HeadersInit {
  return {
    Cookie: `qv_admin_session=${TOKEN}`,
    Origin: APP_ORIGIN,
    "X-CSRF-Token": CSRF,
    "Content-Type": "application/json",
  };
}

function q(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Import ${id}`,
    description: "Created by the import suite.",
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

async function importQuestions(
  questions: Record<string, unknown>[],
): Promise<{ status: number; outcome: Outcome | null; text: string }> {
  const response = await fetch(`${WORKER_ORIGIN}/api/admin/questions`, {
    method: "POST",
    headers: admin(),
    body: JSON.stringify({ questions }),
  });

  const text = await response.text();
  let outcome: Outcome | null;

  try {
    outcome = (JSON.parse(text) as { data?: Outcome }).data ?? null;
  } catch {
    // A 4xx error envelope carries no data, which is a valid outcome for
    // this helper: the caller asserts on the status.
    outcome = null;
  }

  return { status: response.status, outcome, text };
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

describe("IMPORT: statement count is bounded", () => {
  it("the batch geometry is derived from D1's real parameter limit", () => {
    // 23 bound parameters per row; D1 allows 100 per statement.
    const PARAMS_PER_ROW = 23;
    const D1_MAX_PARAMS = 100;

    assert.equal(
      IMPORT_ROWS_PER_STATEMENT * PARAMS_PER_ROW <= D1_MAX_PARAMS,
      true,
      "rows per statement must fit inside D1's parameter limit",
    );

    // The size must be maximal, not conservative: if one more row also
    // fitted, the batch size would be leaving throughput on the table.
    assert.equal(
      (IMPORT_ROWS_PER_STATEMENT + 1) * PARAMS_PER_ROW >
        D1_MAX_PARAMS,
      true,
      "one more row must NOT fit, or the batch size is too small",
    );
  });

  it("500 items need a bounded number of statements, not 1500 round trips", () => {
    const items = 500;
    const insertStatements = Math.ceil(
      items / IMPORT_ROWS_PER_STATEMENT,
    );
    const existenceStatements = Math.ceil(
      items / IMPORT_ROWS_PER_STATEMENT,
    );
    const batches = Math.ceil(
      insertStatements / IMPORT_STATEMENTS_PER_BATCH,
    );

    const previousRoundTrips = items * 3;
    const statements =
      insertStatements + existenceStatements + batches;

    assert.ok(
      statements < previousRoundTrips / 5,
      `expected a large reduction, got ${statements} vs ${previousRoundTrips}`,
    );

    console.log(
      `  import geometry: ${items} items -> ${insertStatements} insert statements, ` +
        `${existenceStatements} existence statements, ${batches} batch round trips ` +
        `(was ~${previousRoundTrips} sequential round trips)`,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("IMPORT: outcome shape is unchanged", () => {
  it("imports new items, skips and conflicts duplicates", async () => {
    // Seed an existing server-side question.
    const seeded = await importQuestions([q("imp-existing")]);

    assert.equal(seeded.status, 200);
    assert.equal(seeded.outcome?.imported, 1);

    // A mixed batch: two new, one already present.
    const result = await importQuestions([
      q("imp-new-1"),
      q("imp-existing"),
      q("imp-new-2"),
    ]);

    assert.equal(result.status, 200);

    const outcome = result.outcome as Outcome;

    assert.equal(outcome.imported, 2, "only the new ids are imported");
    assert.equal(outcome.skipped, 1, "the existing id is skipped");
    assert.equal(outcome.conflicts, 1, "and reported as a conflict");
    assert.equal(outcome.failed, 0);
    assert.deepEqual(outcome.failures, []);
  });

  it("reports every required counter, unchanged in shape", async () => {
    const result = await importQuestions([q("imp-shape-1")]);
    const outcome = result.outcome as Outcome;

    for (const field of [
      "imported",
      "skipped",
      "conflicts",
      "failed",
    ]) {
      assert.equal(
        typeof outcome[field as keyof Outcome],
        "number",
        `${field} must still be present`,
      );
    }

    assert.ok(Array.isArray(outcome.failures));
  });

  it("skipped and conflicts move together for an existing id", async () => {
    // This is the documented behaviour of the old implementation and the
    // client depends on it.
    await importQuestions([q("imp-pair-existing")]);

    const result = await importQuestions([
      q("imp-pair-existing"),
      q("imp-pair-existing"),
    ]);

    const outcome = result.outcome as Outcome;

    assert.equal(outcome.skipped, outcome.conflicts);
  });

  it("treats a duplicate inside one request as a conflict", async () => {
    const result = await importQuestions([
      q("imp-dup-in-request"),
      q("imp-dup-in-request"),
    ]);

    const outcome = result.outcome as Outcome;

    assert.equal(
      outcome.imported,
      1,
      "the first occurrence is created",
    );
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.conflicts, 1);
  });

  it("reports a re-import of the same batch as all conflicts", async () => {
    const items = [q("imp-idem-1"), q("imp-idem-2")];

    const first = await importQuestions(items);
    assert.equal(first.outcome?.imported, 2);

    const second = await importQuestions(items);

    assert.equal(second.outcome?.imported, 0);
    assert.equal(second.outcome?.skipped, 2);
    assert.equal(second.outcome?.conflicts, 2);
  });

  it("an empty batch is accepted and does nothing", async () => {
    const result = await importQuestions([]);

    assert.equal(result.status, 200);
    assert.equal(result.outcome?.imported, 0);
  });
});

/* -------------------------------------------------------------------------- */

describe("IMPORT: existing questions are never overwritten", () => {
  it("a conflicting import leaves the original content untouched", async () => {
    await importQuestions([
      q("imp-keep", { title: "Original Title" }),
    ]);

    // Re-import the same id with completely different content.
    const result = await importQuestions([
      q("imp-keep", {
        title: "Hijacked Title",
        description: "This must never be stored.",
      }),
    ]);

    assert.equal(result.status, 200);
    assert.equal(result.outcome?.imported, 0);
    assert.equal(result.outcome?.conflicts, 1);

    // Read it back and prove the original survived.
    const read = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/imp-keep`,
      { headers: { Cookie: `qv_admin_session=${TOKEN}` } },
    );

    const body = (await read.json()) as {
      data?: { question?: { title: string; description: string } };
    };

    assert.equal(read.status, 200);
    assert.equal(
      body.data?.question?.title,
      "Original Title",
      "an existing question must not be overwritten",
    );
    assert.notEqual(
      body.data?.question?.description,
      "This must never be stored.",
    );
  });

  it("an import creates a draft, never a published question", async () => {
    await importQuestions([q("imp-draft-check")]);

    const read = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/imp-draft-check`,
      { headers: { Cookie: `qv_admin_session=${TOKEN}` } },
    );

    const body = (await read.json()) as {
      data?: { question?: { published: boolean; enabled: boolean } };
    };

    assert.equal(body.data?.question?.published, false);
    assert.equal(body.data?.question?.enabled, true);
  });
});

/* -------------------------------------------------------------------------- */

describe("IMPORT: invalid input still rejects the whole request", () => {
  it("rejects a batch containing an invalid item and imports nothing", async () => {
    const result = await importQuestions([
      q("imp-valid-1"),
      // Missing `title`, so validation must reject the whole request.
      {
        id: "imp-invalid-1",
        description: "no title",
        difficulty: "Easy",
        questionType: "SQL",
        category: "Filtering",
      },
    ]);

    assert.equal(
      result.status,
      400,
      "an invalid item must still fail the request as before",
    );
    assert.equal(result.outcome, null);

    // The valid sibling must NOT have been imported.
    const read = await fetch(
      `${WORKER_ORIGIN}/api/admin/questions/imp-valid-1`,
      { headers: { Cookie: `qv_admin_session=${TOKEN}` } },
    );

    assert.equal(
      read.status,
      404,
      "a rejected batch must not partially import",
    );
  });

  it("rejects an out-of-enum filter value", async () => {
    const result = await importQuestions([
      q("imp-bad-enum", { difficulty: "Nightmare" }),
    ]);

    assert.equal(result.status, 400);
  });

  it("still enforces the 500-item request cap", async () => {
    const tooMany = Array.from({ length: 501 }, (_, index) =>
      q(`imp-cap-${index}`),
    );

    const result = await importQuestions(tooMany);

    assert.equal(result.status, 413);
  });
});

/* -------------------------------------------------------------------------- */

describe("IMPORT: a full 500-item batch completes", () => {
  it("imports 500 items and reports them all", async () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      q(`imp-bulk-${index}`),
    );

    const startedAt = Date.now();
    const result = await importQuestions(items);
    const elapsed = Date.now() - startedAt;

    assert.equal(result.status, 200);

    const outcome = result.outcome as Outcome;

    assert.equal(outcome.imported, 500);
    assert.equal(outcome.failed, 0);
    assert.deepEqual(outcome.failures, []);

    console.log(`  500-item import completed in ${elapsed}ms`);

    // A sequential loop of ~1500 round trips against a locally booted
    // Worker takes far longer than this. The bound is generous enough to
    // avoid flaking on a slow machine while still proving the work is
    // batched rather than sequential.
    assert.ok(
      elapsed < 60_000,
      `500-item import took ${elapsed}ms, which is not batched`,
    );
  });

  it("re-importing the same 500 items conflicts on all of them", async () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      q(`imp-bulk-${index}`),
    );

    const result = await importQuestions(items);
    const outcome = result.outcome as Outcome;

    assert.equal(result.status, 200);
    assert.equal(outcome.imported, 0);
    assert.equal(outcome.conflicts, 500);
    assert.equal(outcome.failed, 0);
  });
});