/**
 * Admin analytics read endpoint (task 5.3).
 *
 * Covers the five behaviours the task names, plus the regression that
 * matters most: 5.3 adds a new authenticated read endpoint, and the single
 * most damaging possible mistake would be to make analytics readable by
 * anyone or cacheable by anyone. Both are asserted directly rather than
 * inferred from the route being under `/api/admin/`.
 */

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
  ANALYTICS_EVENTS,
  currentUtcDate,
  MAX_LOOKBACK_DAYS,
  MAX_RANGE_DAYS,
  parseAnalyticsQuery,
} from "../analytics.ts";

const TOKEN = "a".repeat(64);
const CSRF = "csrf-token-for-admin-analytics-00";

function adminCookie(): string {
  return `qv_admin_session=${TOKEN}`;
}

type AnalyticsResponse = {
  status: number;
  headers: Headers;
  text: string;
  body: {
    ok?: boolean;
    data?: {
      from: string;
      to: string;
      event: string | null;
      rows: {
        bucketDate: string;
        eventName: string;
        propKey: string;
        propValue: string;
        count: number;
      }[];
      count: number;
    };
    error?: { code?: string };
  };
};

async function readAnalytics(
  query = "",
  cookie: string | null = adminCookie(),
): Promise<AnalyticsResponse> {
  const response = await fetch(
    `${WORKER_ORIGIN}/api/admin/analytics${query}`,
    {
      headers:
        cookie === null
          ? {}
          : { Cookie: cookie },
      redirect: "manual",
    },
  );

  const text = await response.text();

  let body: AnalyticsResponse["body"];

  try {
    body = JSON.parse(text) as AnalyticsResponse["body"];
  } catch {
    // A non-JSON body (an error page, say) is a legitimate value for a
    // caller that only inspects the status.
    body = {};
  }

  return {
    status: response.status,
    headers: response.headers,
    text,
    body,
  };
}

/**
 * Seed a bucket directly, so the read tests do not depend on ingest.
 *
 * `INSERT OR REPLACE` rather than a bare `INSERT`: the suite deliberately
 * re-seeds the same key from several tests, and a plain INSERT turns that
 * into a UNIQUE violation that looks like a product failure.
 */
function seed(
  date: string,
  event: string,
  propKey: string,
  propValue: string,
  count: number,
): void {
  d1Command(
    "INSERT OR REPLACE INTO analytics_daily " +
      "(bucket_date, event_name, prop_key, prop_value, count, updated_at) " +
      `VALUES ('${date}', '${event}', '${propKey}', '${propValue}', ` +
      `${count}, '${date}T00:00:00.000Z');`,
  );
}

/**
 * The server's own current UTC date, read once from a real response.
 *
 * This suite runs inside a multi-minute chain, and the endpoint stamps
 * buckets with the SERVER's date, which is authoritative. Deriving every
 * fixture date from the server's own answer rather than from the test
 * process's clock makes the suite immune to the UTC date rolling over
 * mid-run, which previously produced three unrelated-looking failures.
 */
let SERVER_TODAY = "";

function daysAgo(days: number): string {
  return new Date(
    Date.parse(`${SERVER_TODAY}T00:00:00Z`) -
      days * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

before(async () => {
  await startWorker();

  mintSession({
    adminGithubId: TEST_ADMIN_ID,
    token: TOKEN,
    csrfToken: CSRF,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  // Establish the server's own date basis before any fixture is created.
  const probe = await readAnalytics();

  SERVER_TODAY =
    probe.body.data?.to ?? currentUtcDate();

  assert.match(
    SERVER_TODAY,
    /^\d{4}-\d{2}-\d{2}$/,
    "the server must report a usable date",
  );
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */
/* the page renders for an administrator                                       */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: an administrator gets the data", () => {
  it("returns aggregated rows for the default window", async () => {
    const today = SERVER_TODAY;

    seed(today, "page_viewed", "", "", 12);
    seed(today, "page_viewed", "page_kind", "discover", 12);
    seed(
      today,
      "question_viewed",
      "engine",
      "SQL",
      5,
    );

    const result = await readAnalytics();

    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.ok, true);

    const data = result.body.data;

    assert.ok(data, "a data envelope is required");
    assert.equal(data.to, today);
    assert.equal(data.event, null);
    assert.ok(data.count > 0);

    const total = data.rows.find(
      (row) =>
        row.eventName === "page_viewed" &&
        row.propKey === "",
    );

    assert.ok(total, "the event total row must be returned");
    assert.equal(total.count, 12);
    assert.equal(total.bucketDate, today);
  });

  it("filters to a single event", async () => {
    const today = SERVER_TODAY;

    seed(today, "interview_started", "", "", 3);
    seed(today, "interview_started", "engine", "SQL", 3);

    const result = await readAnalytics(
      "?event=interview_started",
    );

    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.data?.event, "interview_started");

    for (const row of result.body.data?.rows ?? []) {
      assert.equal(row.eventName, "interview_started");
    }
  });

  it("ignores an unknown event filter rather than trusting it", async () => {
    const result = await readAnalytics(
      "?event=not_an_event",
    );

    assert.equal(result.status, 200, result.text);
    assert.equal(
      result.body.data?.event,
      null,
      "an unrecognised event name must be dropped, not queried",
    );
  });

  it("returns every declared event name without error", async () => {
    for (const name of ANALYTICS_EVENTS) {
      const result = await readAnalytics(
        `?event=${name}`,
      );

      assert.equal(
        result.status,
        200,
        `event "${name}" must be queryable`,
      );
    }
  });

  it("honours an explicit in-window date range", async () => {
    seed(daysAgo(3), "page_viewed", "", "", 7);
    seed(daysAgo(60), "page_viewed", "", "", 99);

    const result = await readAnalytics(
      `?from=${daysAgo(5)}&to=${daysAgo(1)}`,
    );

    assert.equal(result.status, 200, result.text);

    const rows = result.body.data?.rows ?? [];

    assert.equal(
      rows.length,
      1,
      "only the in-window bucket may be returned",
    );
    assert.equal(rows[0]?.count, 7);
  });
});

/* -------------------------------------------------------------------------- */
/* it is unreachable without a session                                         */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: authorization", () => {
  it("refuses a request with no session", async () => {
    const result = await readAnalytics("", null);

    assert.equal(
      result.status,
      401,
      "no session must be refused",
    );
    assert.equal(
      result.body.error?.code,
      "unauthorized",
    );
  });

  it("refuses a request with a bogus session cookie", async () => {
    const result = await readAnalytics(
      "",
      "qv_admin_session=" + "f".repeat(64),
    );

    assert.equal(result.status, 401);
  });

  it("refuses a non-administrator session", async () => {
    mintSession({
      adminGithubId: "999999",
      token: "b".repeat(64),
      csrfToken: CSRF,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const result = await readAnalytics(
      "",
      `qv_admin_session=${"b".repeat(64)}`,
    );

    assert.equal(
      result.status,
      403,
      "a non-admin identity must be forbidden",
    );
  });

  it("refuses a non-GET method even with a valid session", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/admin/analytics`,
        {
          method,
          headers: {
            Cookie: adminCookie(),
            Origin: APP_ORIGIN,
            "X-CSRF-Token": CSRF,
          },
        },
      );

      assert.equal(
        response.status,
        405,
        `${method} must not be allowed on a read endpoint`,
      );
    }
  });

  it("does not accept a client-asserted admin flag instead of a session", async () => {
    // A query parameter must never be a substitute for the session check.
    const result = await readAnalytics(
      "?admin=true&adminGithubId=424242",
      null,
    );

    assert.equal(result.status, 401);
  });

  it("is not reachable through the public analytics ingest path", async () => {
    // The public endpoint must not double as a read surface.
    const response = await fetch(
      `${WORKER_ORIGIN}/api/analytics/events`,
    );

    assert.equal(response.status, 405);
  });
});

/* -------------------------------------------------------------------------- */
/* the endpoint is not publicly cacheable                                      */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: response policy", () => {
  it("is served no-store, never publicly cacheable", async () => {
    const result = await readAnalytics();

    const cacheControl =
      result.headers.get("cache-control") ?? "";

    assert.match(
      cacheControl,
      /no-store/,
      `admin analytics must stay no-store, got "${cacheControl}"`,
    );
    assert.doesNotMatch(
      cacheControl,
      /public/,
      "admin analytics must never become shared-cacheable",
    );
    assert.equal(
      result.headers.get("etag"),
      null,
      "a no-store response must not carry a validator",
    );
  });

  it("keeps the two public reads the ONLY cacheable API responses", async () => {
    // The 4.2D invariant, re-asserted now that a third family of API
    // responses exists. This is the regression that matters: adding an
    // endpoint must not quietly widen what is cacheable.
    const paths = [
      "/api/health",
      "/api/auth/session",
      "/api/questions",
      "/api/admin/questions",
      "/api/admin/audit",
      "/api/admin/analytics",
    ];

    const publicCacheable: string[] = [];

    for (const path of paths) {
      const response = await fetch(
        `${WORKER_ORIGIN}${path}`,
        {
          headers: { Cookie: adminCookie() },
        },
      );

      const cacheControl =
        response.headers.get("cache-control") ?? "";

      if (/public/.test(cacheControl)) {
        publicCacheable.push(path);
      }
    }

    assert.deepEqual(
      publicCacheable,
      ["/api/questions"],
      "only the public catalog may be shared-cacheable",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* it degrades honestly when there is no data                                  */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: empty data", () => {
  it("returns an empty, well-formed envelope rather than an error", async () => {
    // An event nothing has been recorded for. Asking for a range far
    // outside the retention window would NOT test emptiness, because the
    // endpoint clamps such a request back into the window rather than
    // refusing it, so it would legitimately return data.
    const result = await readAnalytics(
      "?event=practice_completed",
    );

    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.ok, true);

    const data = result.body.data;

    assert.ok(data, "an envelope is still required");
    assert.deepEqual(
      data.rows,
      [],
      "no rows is a valid answer",
    );
    assert.equal(data.count, 0);
    assert.equal(data.event, "practice_completed");
    assert.equal(
      typeof data.from,
      "string",
    );
    assert.equal(typeof data.to, "string");
  });

  it("returns an empty envelope for an event with no rows in range", async () => {
    seed(daysAgo(2), "practice_completed", "", "", 4);

    const result = await readAnalytics(
      `?event=practice_completed&from=${daysAgo(1)}`,
    );

    assert.equal(result.status, 200, result.text);
    assert.deepEqual(result.body.data?.rows, []);
    assert.equal(result.body.data?.count, 0);
  });

  it("never reports a negative count", async () => {
    const result = await readAnalytics();

    for (const row of result.body.data?.rows ?? []) {
      assert.ok(
        row.count >= 0,
        `count must never be negative, got ${row.count}`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* the range is bounded server-side                                            */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: the range is clamped server-side", () => {
  it("clamps a request wider than the maximum range", async () => {
    seed(daysAgo(1), "page_viewed", "", "", 1);
    seed(daysAgo(200), "page_viewed", "", "", 500);

    const result = await readAnalytics(
      `?from=${daysAgo(200)}&to=${SERVER_TODAY}`,
    );

    assert.equal(result.status, 200, result.text);

    const from =
      result.body.data?.from ?? "";

    const spanDays =
      Math.floor(
        (Date.parse(
          `${result.body.data?.to}T00:00:00Z`,
        ) -
          Date.parse(`${from}T00:00:00Z`)) /
          86_400_000,
      ) + 1;

    assert.ok(
      spanDays <= MAX_RANGE_DAYS,
      `span must be clamped to ${MAX_RANGE_DAYS} days, got ${spanDays}`,
    );

    // The far-bucket row must NOT be in the response.
    assert.ok(
      !(result.body.data?.rows ?? []).some(
        (row) => row.count === 500,
      ),
      "an out-of-window row must not be served",
    );
  });

  it("never reaches back past the retention window", async () => {
    const result = await readAnalytics(
      "?from=1970-01-01",
    );

    assert.equal(result.status, 200, result.text);

    const earliest = new Date(
      Date.now() - MAX_LOOKBACK_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    assert.ok(
      (result.body.data?.from ?? "") >= earliest,
      "the lower bound must be clamped to the retention window",
    );
  });

  it("refuses a future upper bound", async () => {
    const result = await readAnalytics(
      `?to=2099-01-01`,
    );

    assert.equal(result.status, 200, result.text);
    assert.equal(
      result.body.data?.to,
      SERVER_TODAY,
      "a future upper bound must be pulled back to today",
    );
  });

  it("normalises a reversed range instead of failing", async () => {
    const result = await readAnalytics(
      `?from=${SERVER_TODAY}&to=${daysAgo(5)}`,
    );

    assert.equal(result.status, 200, result.text);

    const data = result.body.data;

    assert.ok(data);
    assert.ok(
      data.from <= data.to,
      `from (${data.from}) must not be after to (${data.to})`,
    );
  });

  it("falls back to the default window on a malformed date", async () => {
    for (const raw of [
      "not-a-date",
      // Syntactically well formed but not a real calendar day: this is the
      // case a shape-only check would wrongly accept.
      "2026-13-45",
      "2026-02-30",
      "12345",
      "",
    ]) {
      const result = await readAnalytics(
        `?from=${encodeURIComponent(raw)}`,
      );

      assert.equal(
        result.status,
        200,
        `"${raw}" must not error`,
      );
      assert.equal(
        result.body.data?.from,
        daysAgo(29),
        `"${raw}" must fall back to the default window`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* unit-level: the query parser                                                */
/* -------------------------------------------------------------------------- */

describe("ADMIN ANALYTICS: query parser (unit)", () => {
  const now = () =>
    Date.parse("2026-10-02T12:00:00.000Z");

  it("defaults to a 30-day window ending today", () => {
    const query = parseAnalyticsQuery(
      new URLSearchParams(),
      { now },
    );

    assert.equal(query.to, "2026-10-02");
    assert.equal(query.from, "2026-09-03");
    assert.equal(query.event, null);
  });

  it("clamps every window it returns to the maximum range", () => {
    const cases = [
      { from: "2020-01-01", to: "2026-10-02" },
      { from: "2026-09-01", to: "2026-10-02" },
      { from: "2026-10-02", to: "2026-10-01" },
      { from: "2026-10-01", to: "2099-01-01" },
      { from: "1999-01-01", to: "1999-02-01" },
    ];

    for (const bounds of cases) {
      const query = parseAnalyticsQuery(
        new URLSearchParams(bounds),
        { now },
      );

      const span =
        Math.floor(
          (Date.parse(`${query.to}T00:00:00Z`) -
            Date.parse(`${query.from}T00:00:00Z`)) /
            86_400_000,
        ) + 1;

      assert.ok(
        query.from <= query.to,
        `${JSON.stringify(bounds)} must yield from <= to`,
      );
      assert.ok(
        span >= 1 && span <= MAX_RANGE_DAYS,
        `${JSON.stringify(bounds)} yielded a ${span}-day span`,
      );
    }
  });

  it("accepts only a real event name", () => {    assert.equal(
      parseAnalyticsQuery(
        new URLSearchParams({ event: "page_viewed" }),
        { now },
      ).event,
      "page_viewed",
    );

    for (const bad of [
      "nope",
      "",
      "PAGE_VIEWED",
      "page_viewed;DROP",
    ]) {
      assert.equal(
        parseAnalyticsQuery(
          new URLSearchParams({ event: bad }),
          { now },
        ).event,
        null,
        `"${bad}" must not be accepted as an event`,
      );
    }
  });

  it("rejects a well-formed but impossible calendar date", () => {
    for (const bad of [
      "2026-13-45",
      "2026-02-30",
      "2026-00-10",
      "2026-01-32",
    ]) {
      const query = parseAnalyticsQuery(
        new URLSearchParams({ from: bad }),
        { now },
      );

      assert.equal(
        query.from,
        "2026-09-03",
        `"${bad}" is not a real date and must fall back to the default`,
      );
    }
  });

  it("accepts a real date on a leap day", () => {
    // Guards the round-trip check against being over-strict. The clock is
    // moved past the date so it is in the recent PAST: a future date would
    // be clamped to today, which would hide whether the leap day itself
    // was recognised as real.
    const query = parseAnalyticsQuery(
      new URLSearchParams({ from: "2028-02-29" }),
      { now: () => Date.parse("2028-03-01T00:00:00.000Z") },
    );

    assert.equal(query.from, "2028-02-29");
  });

  it("rejects a non-leap 29 February", () => {
    // The other half of the guard: 2027 is not a leap year, so the same
    // day-of-month must be rejected.
    const query = parseAnalyticsQuery(
      new URLSearchParams({ from: "2027-02-29" }),
      { now: () => Date.parse("2027-03-01T00:00:00.000Z") },
    );

    assert.notEqual(
      query.from,
      "2027-02-29",
      "a non-leap 29 February is not a real date",
    );
  });
});
