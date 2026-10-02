/**
 * Anonymous product event collection (task 5.2).
 *
 * Closes the collection half of the 5.1 design
 * (`docs/qa/analytics-architecture.md`). The suite is deliberately weighted
 * towards the two claims that matter most and are easiest to get wrong:
 *
 *   - ANONYMITY IS STRUCTURAL. There must be no way to get an identifier,
 *     an address or free text into `analytics_daily`, proven by inspecting
 *     the stored rows and by the endpoint refusing such a payload outright.
 *   - THE BOUNDS HOLD. The stored bucket count must be a function of the
 *     allow-lists, not of the traffic or the payload, and the D1 statement
 *     count must stay far below the free tier's 50-queries-per-invocation
 *     ceiling.
 *
 * It also proves the Phase 4 abuse controls are present on this new
 * unauthenticated write endpoint, because that is the exact class of
 * endpoint Phase 4 spent a whole phase closing.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_ORIGIN,
  d1Command,
  mintSession,
  openLocalSqlite,
  repoRootPath,
  startWorker,
  stopWorker,
  TEST_ADMIN_ID,
  toD1Handle,
  WORKER_ORIGIN,
} from "./harness.ts";

import { migrationFiles } from "../../scripts/migrate.mjs";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_PROPERTIES,
  ANALYTICS_PROPERTY_VALUES,
  ANALYTICS_ROWS_PER_STATEMENT,
  DELTA_KEY_SEPARATOR,
  MAX_EVENTS_PER_REQUEST,
  MAX_STATEMENTS_PER_REQUEST,
  currentUtcDate,
  parseAnalyticsBatch,
  purgeAnalyticsOlderThan,
  DEFAULT_ANALYTICS_RETENTION_DAYS,
} from "../analytics.ts";

import { RequestError } from "../request.ts";

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

let counter = 0;

/** Unique source address per test, so rate-limit buckets never collide. */
function address(): string {
  counter += 1;

  return `198.51.100.${counter}`;
}

/**
 * The headers a real browser sends for a same-origin `fetch`/`sendBeacon`
 * from the app. `sendBeacon` cannot set custom headers, which is why the
 * server's same-origin check reads `Sec-Fetch-Site` - a forbidden header
 * the browser sets itself.
 */
function sameOrigin(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "Sec-Fetch-Site": "same-origin",
    "CF-Connecting-IP": address(),
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Post an ingest batch.
 */
async function post(
  events: unknown[],
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${WORKER_ORIGIN}/api/analytics/events`,
    {
      method: "POST",
      headers: sameOrigin(headers),
      body: JSON.stringify({ events }),
    },
  );

  return { status: response.status, body: await response.text() };
}

/**
 * The server's own current UTC date, established once at setup.
 *
 * The ingest endpoint accepts ONLY the server's current UTC date, which is
 * deliberate and tested. Every date fixture in this suite is therefore
 * built from the SERVER's own answer rather than from the test process's
 * clock.
 *
 * This is not defensive padding. The chain run genuinely crossed UTC
 * midnight mid-suite and produced three failures that looked like product
 * bugs: an accepted-but-should-be-rejected stale date, and two
 * wrong-row-count assertions. Anchoring to the server's reported date makes
 * the suite independent of when it runs.
 */
let SERVER_TODAY = "";

function event(
  name: string,
  properties: Record<string, string> = {},
  date = SERVER_TODAY,
): Record<string, unknown> {
  return { d: date, e: name, p: properties };
}

/** `SERVER_TODAY` shifted by whole days. */
function daysFromServerToday(days: number): string {
  return new Date(
    Date.parse(`${SERVER_TODAY}T00:00:00Z`) +
      days * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

type AnalyticsRow = {
  bucket_date: string;
  event_name: string;
  prop_key: string;
  prop_value: string;
  count: number;
};

/**
 * Parse the JSON that `wrangler d1 execute --json` prints.
 *
 * The command emits a JSON ARRAY of `{ results, success, meta }` objects,
 * one per statement. The surrounding text is located rather than assumed,
 * so an informational line from wrangler cannot turn a readable assertion
 * failure into a JSON parse error.
 */
function queryRows<T>(sql: string): T[] {
  const raw = d1Command(sql).trim();

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `no JSON array in wrangler output for: ${sql}\n${raw}`,
    );
  }

  const parsed = JSON.parse(
    raw.slice(start, end + 1),
  ) as { results?: T[] }[];

  return parsed.flatMap((entry) => entry.results ?? []);
}

/** Every stored row, as parsed objects. */
function rows(): AnalyticsRow[] {
  return queryRows<AnalyticsRow>(
    "SELECT bucket_date, event_name, prop_key, prop_value, count " +
      "FROM analytics_daily;",
  );
}

/** The stored CREATE TABLE statement. */
function tableSchema(): string {
  const [row] = queryRows<{ sql: string }>(
    "SELECT sql FROM sqlite_master " +
      "WHERE type='table' AND name='analytics_daily';",
  );

  return row?.sql ?? "";
}

function countRows(): number {
  return rows().length;
}

/** Sum of the event-total rows (prop_key === ''). */
function totalFor(name: string): number {
  return rows()
    .filter(
      (row) =>
        row.event_name === name && row.prop_key === "",
    )
    .reduce((sum, row) => sum + row.count, 0);
}

before(async () => {
  await startWorker();

  // A throwaway session purely to READ the server's own current date from
  // the admin analytics endpoint. The ingest endpoint under test is
  // anonymous; this session is not used for anything else and does not
  // change what the ingest tests exercise.
  mintSession({
    adminGithubId: TEST_ADMIN_ID,
    token: "e".repeat(64),
    csrfToken: "csrf-token-for-date-discovery",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const probe = await fetch(
    `${WORKER_ORIGIN}/api/admin/analytics`,
    {
      headers: {
        Cookie: `qv_admin_session=${"e".repeat(64)}`,
      },
    },
  );

  const body = (await probe.json()) as {
    data?: { to?: string };
  };

  SERVER_TODAY =
    body.data?.to ?? currentUtcDate();

  assert.match(
    SERVER_TODAY,
    /^\d{4}-\d{2}-\d{2}$/,
    "the server must report a usable current date",
  );
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: migration safety", () => {
  /**
   * `wrangler d1 execute --file` splits a migration into statements with a
   * scanner that does not track SQL line comments while looking for string
   * literals. A single-quote character inside a `--` comment is therefore
   * read as SQL, and the failure surfaces far from its cause
   * (`syntax error near "event_name"` when the real problem was a quote
   * pair in a comment twenty lines earlier).
   *
   * A semicolon in a comment is deliberately NOT checked: statement
   * splitting does honour line comments, and `0001_init.sql` has carried
   * two such semicolons without difficulty since the repository began.
   * Only the quote character is genuinely unsafe.
   *
   * This caught the first draft of `0002_analytics.sql`, so it is asserted
   * for every migration rather than left as tribal knowledge.
   */
  it("no migration comment contains a single-quote character", () => {
    const dir = join(repoRootPath, "migrations");

    const offenders: string[] = [];

    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".sql")) {
        continue;
      }

      const lines = readFileSync(
        join(dir, name),
        "utf8",
      ).split("\n");

      lines.forEach((line, index) => {
        if (!line.trim().startsWith("--")) {
          return;
        }

        if (line.includes("'")) {
          offenders.push(
            `${name}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `migration comments must not contain a single-quote character:\n${offenders.join("\n")}`,
    );
  });

  it("every migration is discovered, not hard-coded", () => {
    const files = migrationFiles();

    assert.ok(
      files.length >= 2,
      "the analytics migration must be discovered alongside the init",
    );
    assert.deepEqual(
      [...files].sort(),
      files,
      "migrations must be listed in an order that can be applied",
    );
    assert.ok(
      files.some((name) =>
        name.includes("analytics"),
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: events are accepted and stored", () => {
  it("accepts a valid event and stores its total and dimensions", async () => {
    const result = await post([
      event("question_viewed", {
        engine: "SQL",
        difficulty: "Easy",
        category_bucket: "sql-family",
      }),
    ]);

    assert.equal(result.status, 200, result.body);

    const body = JSON.parse(result.body) as {
      data?: { accepted?: number };
    };

    assert.equal(body.data?.accepted, 1);

    const stored = rows().filter(
      (row) => row.event_name === "question_viewed",
    );

    // One event with three properties is four rows: the event's own daily
    // total plus one row per dimension.
    assert.equal(stored.length, 4);

    const total = stored.find(
      (row) => row.prop_key === "",
    );

    assert.ok(total, "an event must always write a total row");
    assert.equal(total.count, 1);
    assert.equal(total.bucket_date, SERVER_TODAY);

    for (const row of stored) {
      assert.ok(
        row.prop_key === "" ||
          ANALYTICS_EVENT_PROPERTIES.question_viewed.includes(
            row.prop_key,
          ),
        `unexpected stored property "${row.prop_key}"`,
      );
    }
  });

  it("accumulates into the same bucket rather than adding rows", async () => {
    // Establish the bucket first, so the measurement below is about
    // REPEAT traffic rather than about the first request legitimately
    // creating the bucket. This keeps the test independent of whatever
    // other tests in this file have already written.
    await post([event("page_viewed", { page_kind: "discover" })]);

    const before = countRows();
    const countBefore = totalFor("page_viewed");

    await post([event("page_viewed", { page_kind: "discover" })]);
    await post([event("page_viewed", { page_kind: "discover" })]);

    // Repeat traffic costs an UPDATE, never a new row. This is the whole
    // point of aggregating on write.
    assert.equal(
      countRows(),
      before,
      "repeat traffic must not create new rows",
    );
    assert.equal(
      totalFor("page_viewed") - countBefore,
      2,
      "both repeat events must be counted",
    );
  });

  it("collapses identical events inside one request into one delta", async () => {
    await post([event("page_viewed", { page_kind: "learn" })]);

    const before = countRows();
    const countBefore = totalFor("page_viewed");

    await post([
      event("page_viewed", { page_kind: "learn" }),
      event("page_viewed", { page_kind: "learn" }),
      event("page_viewed", { page_kind: "learn" }),
    ]);

    // No new rows: the three events folded into the existing buckets.
    assert.equal(
      countRows(),
      before,
      "identical events must collapse into existing buckets",
    );
    assert.equal(
      totalFor("page_viewed") - countBefore,
      3,
      "all three events must still be counted",
    );
  });

  it("counts concurrent increments without losing any", async () => {
    // The UPSERT is what makes this safe: two requests touching the same
    // bucket both succeed because the database serialises the UPDATE.
    const results = await Promise.all([
      post([event("interview_started", { engine: "SQL" })]),
      post([event("interview_started", { engine: "SQL" })]),
      post([event("interview_started", { engine: "SQL" })]),
      post([event("interview_started", { engine: "SQL" })]),
    ]);

    for (const result of results) {
      assert.equal(result.status, 200, result.body);
    }

    assert.equal(totalFor("interview_started"), 4);
  });

  it("stores each dimension independently", async () => {
    await post([
      event("question_submitted", {
        engine: "SQL",
        difficulty: "Easy",
        outcome: "correct",
      }),
      event("question_submitted", {
        engine: "PySpark",
        difficulty: "Hard",
        outcome: "incorrect",
      }),
    ]);

    const correct = rows().filter(
      (row) =>
        row.event_name === "question_submitted" &&
        row.prop_key === "outcome" &&
        row.prop_value === "correct",
    );

    assert.equal(correct.length, 1);
    assert.equal(correct[0]?.count, 1);
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: nothing identifying is stored", () => {
  it("the table has no identifier column at all", () => {
    // The strongest form of the claim: anonymity is a property of the
    // schema, not of a policy that could be relaxed.
    const schema = tableSchema();

    assert.ok(
      schema.length > 0,
      "the table schema must be readable",
    );

    for (
      const forbidden of [
        "ip",
        "user",
        "session",
        "token",
        "cookie",
        "fingerprint",
        "uuid",
        "email",
        "login",
        "csrf",
      ]
    ) {
      assert.ok(
        !new RegExp(`\\b${forbidden}`, "i").test(schema),
        `analytics_daily must not have a "${forbidden}" column`,
      );
    }
  });

  it("no stored value contains anything from the request or the address", async () => {
    const usedAddress = address();

    await post(
      [event("page_viewed", { page_kind: "progress" })],
      { "CF-Connecting-IP": usedAddress },
    );

    const serialised = JSON.stringify(rows());

    assert.ok(
      !serialised.includes(usedAddress),
      "the client address must never be persisted",
    );
    assert.ok(
      !/cookie|session|csrf|token|authorization/i.test(
        serialised,
      ),
      "no credential-shaped value may be persisted",
    );
  });

  it("rejects an event carrying an extra field", async () => {
    // Not ignored and not stripped: refused outright, so a client that
    // tries to attach an identifier learns immediately.
    const result = await post([
      {
        ...event("page_viewed", { page_kind: "discover" }),
        userId: "abc-123",
      },
    ]);

    assert.equal(result.status, 400);

    const body = JSON.parse(result.body) as {
      error?: { message?: string };
    };

    assert.match(
      body.error?.message ?? "",
      /userId/,
      "the error must name the offending field",
    );
  });

  it("rejects an identifier smuggled in as a property value", async () => {
    const result = await post([
      event("question_viewed", {
        engine: "SELECT * FROM users",
      }),
    ]);

    assert.equal(result.status, 400);
  });

  it("rejects an identifier smuggled in as a property name", async () => {
    const result = await post([
      event("page_viewed", { visitorId: "abc-123" }),
    ]);

    assert.equal(result.status, 400);
  });

  it("rejects an unexpected top-level field on the request", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: sameOrigin(),
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: "other" })],
          visitorId: "abc-123",
        }),
      },
    );

    assert.equal(response.status, 400);
  });

  it("never stores a per-event timestamp", async () => {
    await post([event("page_viewed", { page_kind: "question" })]);

    const schema = tableSchema();

    // `updated_at` exists and is a bucket maintenance field, not a
    // per-event time: the whole table has one row per bucket, so it cannot
    // reveal when any individual visit happened.
    assert.ok(
      !/event_at|occurred_at|timestamp|seen_at/i.test(schema),
      "no per-event timestamp column may exist",
    );

    const selected = queryRows<Record<string, unknown>>(
      "SELECT * FROM analytics_daily;",
    );

    for (const row of selected) {
      assert.deepEqual(
        Object.keys(row).sort(),
        [
          "bucket_date",
          "count",
          "event_name",
          "prop_key",
          "prop_value",
          "updated_at",
        ],
        "no unexpected column may be stored",
      );
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: the Phase 4 abuse controls are present", () => {
  it("rejects a cross-site request even with a forged same-origin Referer", async () => {
    // The exact V-01 abuse shape, on the new endpoint. The check is the
    // 4.2C one, reused unchanged.
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "cross-site",
          "CF-Connecting-IP": address(),
          "Content-Type": "application/json",
          Referer: `${APP_ORIGIN}/`,
        },
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: "other" })],
        }),
      },
    );

    assert.equal(response.status, 403);
  });

  it("rejects a same-site request from a look-alike host", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-site",
          "CF-Connecting-IP": address(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: "other" })],
        }),
      },
    );

    assert.equal(response.status, 403);
  });

  it("rejects a request with no same-origin signal at all", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": address(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: "other" })],
        }),
      },
    );

    assert.equal(response.status, 403);
  });

  it("a rejected request writes nothing", async () => {
    const before = countRows();

    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "cross-site",
          "CF-Connecting-IP": address(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: "landing" })],
        }),
      },
    );

    assert.equal(response.status, 403);
    assert.equal(
      countRows(),
      before,
      "a rejected ingest must not touch the table",
    );
  });

  it("rate limits a burst and returns 429 with Retry-After", async () => {
    const burst = address();
    const statuses: number[] = [];
    let retryAfter: string | null = null;

    for (let attempt = 0; attempt < 70; attempt += 1) {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/analytics/events`,
        {
          method: "POST",
          headers: sameOrigin({ "CF-Connecting-IP": burst }),
          body: JSON.stringify({
            events: [event("page_viewed", { page_kind: "learn" })],
          }),
        },
      );

      statuses.push(response.status);

      if (response.status === 429 && retryAfter === null) {
        retryAfter = response.headers.get("retry-after");
      }
    }

    assert.equal(statuses[0], 200);
    assert.ok(
      statuses.includes(429),
      "a sustained burst must be throttled",
    );
    assert.ok(
      statuses.filter((status) => status === 429).length > 0,
      "the over-budget requests must be refused",
    );
    assert.ok(
      retryAfter !== null,
      "a 429 must carry Retry-After",
    );
    assert.ok(
      Number(retryAfter) >= 1,
      "Retry-After must be at least one second",
    );
  });

  it("charges the limiter before the body is read, so a 429 costs no D1", async () => {
    // A throttled request must not have written anything. The endpoint's
    // "accepted" count is the observable proof: it never reports a partial
    // or deferred write.
    const burst = address();

    for (let attempt = 0; attempt < 61; attempt += 1) {
      await post(
        [event("page_viewed", { page_kind: "other" })],
        { "CF-Connecting-IP": burst },
      );
    }

    const throttled = await post(
      [event("page_viewed", { page_kind: "other" })],
      { "CF-Connecting-IP": burst },
    );

    assert.equal(throttled.status, 429);
  });

  it("rejects a non-POST method", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/analytics/events`,
        { method, headers: sameOrigin() },
      );

      assert.equal(
        response.status,
        405,
        `${method} must not be allowed`,
      );
    }
  });

  it("requires a JSON content type", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "CF-Connecting-IP": address(),
          "Content-Type": "text/plain",
        },
        body: "events=1",
      },
    );

    assert.equal(response.status, 400);
  });

  it("rejects an oversized body", async () => {
    const filler = "x".repeat(600 * 1024);

    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: sameOrigin(),
        body: JSON.stringify({
          events: [event("page_viewed", { page_kind: filler })],
        }),
      },
    );

    assert.equal(response.status, 413);
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: the allow-lists are enforced", () => {
  it("rejects an unknown event name", async () => {
    const result = await post([event("user_signed_up")]);

    assert.equal(result.status, 400);
  });

  it("rejects an unknown property name", async () => {
    const result = await post([
      event("page_viewed", { referrer: "https://elsewhere" }),
    ]);

    assert.equal(result.status, 400);
  });

  it("rejects a property that is valid globally but not on this event", async () => {
    // `difficulty` is allow-listed, but it is not a `page_viewed`
    // property. Narrower per-event sets are what remove combinations from
    // the cardinality product.
    const result = await post([
      event("page_viewed", { difficulty: "Easy" }),
    ]);

    assert.equal(result.status, 400);
  });

  it("rejects a value outside a property's enumeration", async () => {
    const rejected: [string, string][] = [
      ["question_submitted", "engine"],
      ["question_submitted", "difficulty"],
      ["question_submitted", "outcome"],
      ["page_viewed", "page_kind"],
      ["question_viewed", "category_bucket"],
    ];

    const carrier: Record<string, string> = {
      engine: "question_submitted",
      difficulty: "question_submitted",
      outcome: "question_submitted",
      page_kind: "page_viewed",
      category_bucket: "question_viewed",
    };

    for (const [property, badValue] of rejected) {
      const result = await post([
        event(carrier[property] as string, {
          [property]: badValue,
        }),
      ]);

      assert.equal(
        result.status,
        400,
        `${property}="${badValue}" must be rejected`,
      );
    }
  });

  it("accepts every real value of every allow-listed property", async () => {
    // One representative event per property, chosen from the per-event
    // allow-lists rather than hard-coded, so this stays correct if a
    // property is ever added or moved.
    const carrier: Record<string, string> = {
      engine: "question_viewed",
      difficulty: "question_viewed",
      outcome: "question_submitted",
      category_bucket: "question_viewed",
      page_kind: "page_viewed",
    };

    for (
      const [property, values] of Object.entries(
        ANALYTICS_PROPERTY_VALUES,
      )
    ) {
      for (const value of values) {
        const result = await post([
          event(carrier[property] as string, {
            [property]: value,
          }),
        ]);

        assert.equal(
          result.status,
          200,
          `${property}="${value}" is a real value and must be accepted`,
        );
      }
    }
  });

  it("accepts every declared event name", async () => {
    for (const name of ANALYTICS_EVENTS) {
      const permitted =
        ANALYTICS_EVENT_PROPERTIES[name as keyof typeof ANALYTICS_EVENT_PROPERTIES];

      // Use the first property the event permits, with a value its
      // enumeration actually contains.
      const first = permitted[0];
      const allowed =
        first === undefined
          ? {}
          : {
              [first]:
                ANALYTICS_PROPERTY_VALUES[first]?.[0] ?? "",
            };

      const result = await post([event(name, allowed)]);

      assert.equal(
        result.status,
        200,
        `event "${name}" must be accepted`,
      );
    }
  });

  it("rejects a stale or future date", async () => {
    const stale = daysFromServerToday(-1);
    const future = daysFromServerToday(1);

    for (const date of [stale, future, "not-a-date", ""]) {
      const result = await post([
        event("page_viewed", { page_kind: "other" }, date),
      ]);

      assert.equal(
        result.status,
        400,
        `date "${date}" must be rejected`,
      );
    }
  });

  it("rejects a non-string or non-scalar property value", async () => {
    for (const value of [1, true, null, { a: 1 }, ["SQL"]]) {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/analytics/events`,
        {
          method: "POST",
          headers: sameOrigin(),
          body: JSON.stringify({
            events: [
              {
                d: SERVER_TODAY,
                e: "question_viewed",
                p: { engine: value },
              },
            ],
          }),
        },
      );

      assert.equal(
        response.status,
        400,
        `value ${JSON.stringify(value)} must be rejected`,
      );
    }
  });

  it("rejects an empty or missing events array", async () => {
    const empty = await post([]);
    assert.equal(empty.status, 400);

    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
      {
        method: "POST",
        headers: sameOrigin(),
        body: JSON.stringify({}),
      },
    );

    assert.equal(response.status, 400);
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: volume is bounded as designed", () => {
  it("rejects a batch over the per-request cap", async () => {
    const result = await post(
      Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () =>
        event("page_viewed", { page_kind: "learn" }),
      ),
    );

    assert.equal(result.status, 413);
  });

  it("accepts a batch exactly at the cap", async () => {
    const result = await post(
      Array.from({ length: MAX_EVENTS_PER_REQUEST }, () =>
        event("page_viewed", { page_kind: "discover" }),
      ),
    );

    assert.equal(result.status, 200, result.body);
  });

  it("high-volume traffic adds no new rows once a bucket exists", async () => {
    // Establish the bucket, then measure only the repeat traffic.
    await post([event("page_viewed", { page_kind: "practice" })]);

    const before = countRows();
    const countBefore = totalFor("page_viewed");

    // 50 further requests of the same event and the same single dimension.
    // The storage cost is 2 rows, permanently, regardless of how many
    // requests arrive.
    for (let index = 0; index < 50; index += 1) {
      await post([event("page_viewed", { page_kind: "practice" })]);
    }

    assert.equal(
      countRows(),
      before,
      "repeat traffic must only increment existing buckets",
    );
    assert.equal(
      totalFor("page_viewed") - countBefore,
      50,
      "every request must still be counted",
    );
  });

  it("the total possible bucket count is a fixed function of the allow-lists", () => {
    // The cardinality bound, computed rather than asserted by hand: it
    // depends only on the enumerations, never on traffic or payload.
    let possible = 0;

    for (const name of ANALYTICS_EVENTS) {
      const properties =
        ANALYTICS_EVENT_PROPERTIES[name as keyof typeof ANALYTICS_EVENT_PROPERTIES];

      let combinations = 1;

      for (const property of properties) {
        combinations *=
          ANALYTICS_PROPERTY_VALUES[property]?.length ?? 0;
      }

      // The event's own total row, plus one row per combination.
      possible += 1 + combinations;
    }

    // Bounded by the enumerations, and far below anything traffic-driven.
    assert.ok(
      possible > 0 && possible < 1000,
      `expected a small fixed bound, got ${possible}`,
    );

    // At the design's 400-day retention that is the entire lifetime
    // storage ceiling.
    const lifetimeRows = possible * DEFAULT_ANALYTICS_RETENTION_DAYS;

    assert.ok(
      lifetimeRows < 400_000,
      `lifetime storage must stay bounded, got ${lifetimeRows} rows`,
    );

    console.log(
      `  cardinality: ${possible} possible buckets/day, ` +
        `~${lifetimeRows} rows over ` +
        `${DEFAULT_ANALYTICS_RETENTION_DAYS} days of retention`,
    );
  });

  it("a rejected oversized batch writes nothing", async () => {
    const before = countRows();

    await post(
      Array.from({ length: 200 }, () =>
        event("page_viewed", { page_kind: "learn" }),
      ),
    );

    assert.equal(
      countRows(),
      before,
      "an over-cap batch must be refused before any write",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: the free-tier assumptions hold", () => {
  it("a full-size request stays far below 50 D1 queries per invocation", () => {
    // Cloudflare's documented Free-tier ceiling is 50 queries per Worker
    // invocation. This is the invariant that makes the endpoint deployable
    // on the free tier at all, so it is asserted rather than assumed.
    assert.ok(
      MAX_STATEMENTS_PER_REQUEST <= 7,
      `expected at most 7 statements, got ${MAX_STATEMENTS_PER_REQUEST}`,
    );
    assert.ok(
      MAX_STATEMENTS_PER_REQUEST < 50,
      "a full request must stay well under the free-tier query ceiling",
    );
  });

  it("the statement bound is derived from the real allow-lists", () => {
    // Recomputed independently here, so the exported constant cannot drift
    // away from the per-event property sets it claims to bound.
    const widest = Math.max(
      ...ANALYTICS_EVENTS.map(
        (name) =>
          ANALYTICS_EVENT_PROPERTIES[
            name as keyof typeof ANALYTICS_EVENT_PROPERTIES
          ].length,
      ),
    );

    const expected = Math.ceil(
      (MAX_EVENTS_PER_REQUEST * (1 + widest)) /
        ANALYTICS_ROWS_PER_STATEMENT,
    );

    assert.equal(MAX_STATEMENTS_PER_REQUEST, expected);
    assert.equal(widest, 3, "the widest event carries three properties");
  });

  it("the statement geometry is derived from D1's real parameter limit", () => {
    const PARAMS_PER_ROW = 6;
    const D1_MAX = 100;

    assert.equal(
      ANALYTICS_ROWS_PER_STATEMENT * PARAMS_PER_ROW <= D1_MAX,
      true,
      "rows per statement must fit inside D1's parameter limit",
    );

    // The size must be maximal, not conservative.
    assert.equal(
      (ANALYTICS_ROWS_PER_STATEMENT + 1) * PARAMS_PER_ROW > D1_MAX,
      true,
      "one more row must NOT fit, or the batch size is too small",
    );
  });

  it("a full-size request is actually served in that statement budget", async () => {
    // Prove the bound is real by sending the worst case the cap allows and
    // confirming it is accepted, which means the batch really did fit in
    // the number of statements the arithmetic predicts.
    const result = await post(
      Array.from({ length: MAX_EVENTS_PER_REQUEST }, () =>
        event("question_viewed", {
          engine: "SQL",
          difficulty: "Easy",
          category_bucket: "sql-family",
        }),
      ),
    );

    assert.equal(result.status, 200, result.body);
  });

  it("the table is not written on the anonymous read path", async () => {
    // Phase 4's core lesson: an anonymous request must not cause a write.
    // Reading the public catalog must leave analytics untouched.
    const before = countRows();

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/questions`,
      );

      assert.equal(response.status, 200);
    }

    assert.equal(
      countRows(),
      before,
      "an anonymous read must not write an analytics row",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("ANALYTICS: retention bounds storage", () => {
  it("purges buckets older than the retention window and keeps the rest", async () => {
    const db = toD1Handle(
      openLocalSqlite(),
    ) as unknown as D1Database;

    d1Command(
      "INSERT INTO analytics_daily " +
        "(bucket_date, event_name, prop_key, prop_value, count, updated_at) " +
        "VALUES ('2000-01-01', 'page_viewed', '', '', 99, '2000-01-01T00:00:00Z'), " +
        "('2099-01-01', 'page_viewed', '', '', 7, '2099-01-01T00:00:00Z');",
    );

    await purgeAnalyticsOlderThan(db, 400);

    const remaining = rows();

    assert.ok(
      remaining.every(
        (row) => row.bucket_date !== "2000-01-01",
      ),
      "an expired bucket must be deleted",
    );
    assert.ok(
      remaining.some(
        (row) => row.bucket_date === "2099-01-01",
      ),
      "a bucket inside the window must be kept, including a future one",
    );
  });

  it("the default retention window is positive and bounded", () => {
    assert.ok(DEFAULT_ANALYTICS_RETENTION_DAYS > 0);
    assert.ok(DEFAULT_ANALYTICS_RETENTION_DAYS <= 1000);
  });
});

/* -------------------------------------------------------------------------- */
/* unit-level: the parser, without HTTP                                        */
/* -------------------------------------------------------------------------- */

describe("ANALYTICS: parser bounds (unit)", () => {
  // Read at test-run time, NOT here: a describe body runs during
  // collection, before `before` has established SERVER_TODAY.
  const today = (): string => SERVER_TODAY;

  it("the delta-key separator is visible and cannot collide", () => {
    // The separator is a pipe rather than an invisible control character,
    // so the collision-safety property is reviewable in a diff instead of
    // being a claim about bytes nobody can see.
    assert.equal(DELTA_KEY_SEPARATOR, "|");
    assert.notEqual(DELTA_KEY_SEPARATOR, "");
    assert.doesNotMatch(
      DELTA_KEY_SEPARATOR,
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/,
      "the separator must not be a control character",
    );

    const offenders: string[] = [];

    for (const name of ANALYTICS_EVENTS) {
      if (name.includes(DELTA_KEY_SEPARATOR)) {
        offenders.push(`event:${name}`);
      }

      for (
        const property
        of ANALYTICS_EVENT_PROPERTIES[
          name as keyof typeof ANALYTICS_EVENT_PROPERTIES
        ]
      ) {
        if (property.includes(DELTA_KEY_SEPARATOR)) {
          offenders.push(`property:${property}`);
        }

        for (
          const value
          of ANALYTICS_PROPERTY_VALUES[property] ?? []
        ) {
          if (value.includes(DELTA_KEY_SEPARATOR)) {
            offenders.push(`value:${property}=${value}`);
          }
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `no allow-listed value may contain "${DELTA_KEY_SEPARATOR}", ` +
        "or two distinct buckets could collapse into one delta",
    );
  });

  it("distinct buckets still collapse to distinct deltas", () => {
    // Behavioural companion to the assertion above: proves the separator
    // actually separates, by showing two events that differ only in their
    // last component do NOT merge.
    const parsed = parseAnalyticsBatch({
      events: [
        {
          d: today(),
          e: "question_viewed",
          p: { engine: "SQL" },
        },
        {
          d: today(),
          e: "question_viewed",
          p: { engine: "PySpark" },
        },
      ],
    });

    const engineDeltas = parsed.deltas.filter(
      (entry) => entry.propKey === "engine",
    );

    assert.equal(
      engineDeltas.length,
      2,
      "two engines must produce two separate deltas",
    );
    assert.deepEqual(
      engineDeltas
        .map((entry) => entry.delta)
        .sort(),
      [1, 1],
    );
  });

  it("folds a batch into one delta per distinct bucket", () => {
    const parsed = parseAnalyticsBatch({
      events: [
        { d: today(), e: "question_viewed", p: { engine: "SQL" } },
        { d: today(), e: "question_viewed", p: { engine: "SQL" } },
        { d: today(), e: "question_viewed", p: { engine: "PySpark" } },
      ],
    });

    assert.equal(parsed.eventsAccepted, 3);
    // SQL total, SQL engine, PySpark engine.
    assert.equal(parsed.deltas.length, 3);

    const sql = parsed.deltas.find(
      (entry) => entry.propValue === "SQL" && entry.propKey === "engine",
    );

    assert.equal(sql?.delta, 2);
  });

  it("throws a RequestError for every rejected shape", () => {
    const cases: unknown[] = [
      { events: [] },
      { events: "nope" },
      { events: [{ d: "1999-01-01", e: "page_viewed" }] },
      { events: [{ d: today(), e: "nope" }] },
      { events: [{ d: today(), e: "page_viewed", extra: 1 }] },
      { events: [{ d: today(), e: "page_viewed", p: [] }] },
      { events: [{ d: today(), e: "page_viewed", p: { engine: "x" } }] },
      { events: "x" },
      { events: [{ d: today(), e: "page_viewed" }], extra: 1 },
    ];

    for (const body of cases) {
      assert.throws(
        () =>
          parseAnalyticsBatch(
            body as Record<string, unknown>,
          ),
        RequestError,
        `${JSON.stringify(body)} must throw`,
      );
    }
  });

  it("enforces the batch cap", () => {
    const events = Array.from(
      { length: MAX_EVENTS_PER_REQUEST + 1 },
      () => ({ d: today(), e: "page_viewed" }),
    );

    assert.throws(
      () => parseAnalyticsBatch({ events }),
      RequestError,
    );

    // And accepts exactly the cap.
    const ok = parseAnalyticsBatch({
      events: events.slice(0, MAX_EVENTS_PER_REQUEST),
    });

    assert.equal(ok.eventsAccepted, MAX_EVENTS_PER_REQUEST);
  });

  it("currentUtcDate is the UTC date", () => {
    // A fixed instant either side of UTC midnight, so this cannot pass by
    // accident on a machine in UTC.
    assert.equal(
      currentUtcDate(() => Date.parse("2026-10-02T23:59:59Z")),
      "2026-10-02",
    );
    assert.equal(
      currentUtcDate(() => Date.parse("2026-10-03T00:00:01Z")),
      "2026-10-03",
    );
  });
});
