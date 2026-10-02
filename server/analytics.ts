/**
 * Anonymous product analytics: validation and on-write aggregation.
 *
 * Implements the storage and collection rules of the 5.1 design
 * (`docs/qa/analytics-architecture.md`). This module is the ONLY place that
 * decides what may be written to `analytics_daily`, and every decision is
 * an allow-list lookup rather than a filter, so the cardinality bound the
 * design depends on is enforced by construction and provable by test.
 *
 * ANONYMITY IS STRUCTURAL, NOT A POLICY
 * -------------------------------------
 * There is no identifier to validate because there is no column to put one
 * in. The table's composite primary key is `(bucket_date, event_name,
 * prop_key, prop_value)`, and all four are drawn from fixed enumerations.
 * A payload that tries to smuggle in a user id, session token or address
 * has nowhere to land: the event object is checked to contain exactly the
 * keys `d`, `e` and `p`, and every property name and value is checked
 * against an allow-list, so an extra key is a 400 rather than a silently
 * dropped field.
 *
 * The client address is read by the rate limiter to bound abuse and is
 * never passed to anything in this module.
 *
 * AGGREGATE ON WRITE, NOT ON READ
 * -------------------------------
 * D1 bills 100,000 rows written/day against 5,000,000 rows read/day, so an
 * event log would spend the scarce resource to protect the abundant one.
 * Every accepted event is folded into a set of counter deltas and applied
 * with `ON CONFLICT ... DO UPDATE SET count = count + excluded.count`, so
 * storage and write cost are proportional to the number of DISTINCT BUCKETS
 * touched rather than to traffic.
 */

import {
  DIFFICULTIES,
  QUESTION_TYPES,
} from "./questionSchema.ts";
import { RequestError } from "./request.ts";

/* -------------------------------------------------------------------------- */
/* event allow-list                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The complete set of measurable events.
 *
 * Six events, each answering one product question. There is deliberately
 * no "generic" event and no client-defined event name: an open event name
 * would make cardinality caller-controlled, which is the failure mode the
 * whole storage design exists to prevent.
 */
export const ANALYTICS_EVENTS = [
  "question_viewed",
  "question_submitted",
  "practice_started",
  "practice_completed",
  "interview_started",
  "page_viewed",
] as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[number];

const EVENT_NAME_SET: ReadonlySet<string> =
  new Set(ANALYTICS_EVENTS);

/* -------------------------------------------------------------------------- */
/* property allow-lists                                                        */
/* -------------------------------------------------------------------------- */

/** Result of a submission. */
const OUTCOMES = [
  "correct",
  "incorrect",
  "abandoned",
] as const;

/**
 * Coarse topic bucket, NOT the raw question category.
 *
 * `questions.category` is a free-form `TEXT NOT NULL` column with no CHECK
 * constraint and no canonical enumeration (see the 4.2E deviation recorded
 * in `phase-4-verification.md`): an administrator can create any string. A
 * raw category would therefore be unbounded caller input and would turn the
 * bucket key into a row-per-visit, silently restoring the event-table
 * problem. Bucketing keeps the key bounded no matter what is typed.
 */
const CATEGORY_BUCKETS = [
  "sql-family",
  "pyspark-family",
  "modeling",
  "other",
] as const;

/**
 * Route classes, derived from the routes actually registered in
 * `src/main.tsx` plus the generated landing pages. A class, not a URL, so
 * the value set is fixed regardless of how many pages exist.
 */
const PAGE_KINDS = [
  "discover",
  "practice",
  "learn",
  "interview",
  "progress",
  "question",
  "landing",
  "other",
] as const;

/**
 * Allowed value for each property name.
 *
 * `engine` and `difficulty` reuse the SAME exported constants the question
 * write path enforces, exactly as task 4.2E did for the public filters, so
 * the read path and the write path can never disagree about what a valid
 * value is.
 */
export const ANALYTICS_PROPERTY_VALUES: Readonly<
  Record<string, readonly string[]>
> = {
  engine: QUESTION_TYPES,
  difficulty: DIFFICULTIES,
  outcome: OUTCOMES,
  category_bucket: CATEGORY_BUCKETS,
  page_kind: PAGE_KINDS,
};

/**
 * Properties each event is permitted to carry.
 *
 * Narrower than the global property set on purpose. A property that is
 * meaningful for `question_submitted` but not for `page_viewed` is rejected
 * for `page_viewed`, which removes combinations from the cardinality
 * product rather than merely bounding their value.
 */
export const ANALYTICS_EVENT_PROPERTIES: Readonly<
  Record<AnalyticsEventName, readonly string[]>
> = {
  question_viewed: ["engine", "difficulty", "category_bucket"],
  question_submitted: ["engine", "difficulty", "outcome"],
  practice_started: ["engine"],
  practice_completed: ["engine", "outcome"],
  interview_started: ["engine"],
  page_viewed: ["page_kind"],
};

/* -------------------------------------------------------------------------- */
/* bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Maximum events accepted in one request.
 *
 * Chosen so the resulting D1 statement count stays far below the free
 * tier's 50-queries-per-invocation ceiling even at the maximum property
 * count: 25 events x (1 total + 3 properties) = 100 counter rows, which is
 * 7 multi-row statements at 16 rows each.
 */
export const MAX_EVENTS_PER_REQUEST = 25;

/**
 * Maximum properties on a single event.
 *
 * DERIVED FROM THE ALLOW-LISTS, not declared independently, so the D1
 * statement bound below cannot drift away from what the endpoint actually
 * accepts. The widest event carries three properties, so the real ceiling
 * is four rows per event including the event total.
 */
const MAX_PROPERTIES_PER_EVENT = Math.max(
  ...Object.values(ANALYTICS_EVENT_PROPERTIES).map(
    (properties) => properties.length,
  ),
);

/**
 * Rows per multi-row UPSERT.
 *
 * Six bound parameters per row against D1's limit of 100 parameters per
 * statement: floor(100 / 6) = 16 rows, 96 parameters. Seventeen rows would
 * need 102 and would be rejected. The same derivation and the same
 * "assert it is maximal" test as the 4.2F import batching.
 */
export const ANALYTICS_ROWS_PER_STATEMENT = 16;

/** Bound parameters bound per counter row. */
export const ANALYTICS_BOUND_PARAMETERS_PER_ROW = 6;

/** Statements a full-size request can produce. Asserted in tests. */
export const MAX_STATEMENTS_PER_REQUEST = Math.ceil(
  (MAX_EVENTS_PER_REQUEST *
    (1 + MAX_PROPERTIES_PER_EVENT)) /
    ANALYTICS_ROWS_PER_STATEMENT,
);

/**
 * Retention window for `analytics_daily`, in days.
 *
 * The default itself and its parser live in `env.ts` alongside
 * `parseAuditRetentionDays`, so both retention policies can be read and
 * compared in one place rather than being split across modules.
 */
export { DEFAULT_ANALYTICS_RETENTION_DAYS } from "./env.ts";

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

/** Today's UTC date as YYYY-MM-DD, the only bucket date accepted. */
export function currentUtcDate(
  now: () => number = Date.now,
): string {
  return new Date(now()).toISOString().slice(0, 10);
}

/** One validated, fully-enumerated event. */
export type ValidatedEvent = {
  eventName: AnalyticsEventName;
  properties: Readonly<Record<string, string>>;
};

/**
 * Validate one event object.
 *
 * Rejects anything that is not exactly the shape the design specifies. The
 * check on unknown top-level keys is the important one: it is what makes
 * "no identifier can be stored" a property of the code rather than a
 * promise, because there is no branch that would forward an unrecognised
 * field even if one were added to the payload.
 */
function parseEvent(
  raw: unknown,
  today: string,
): ValidatedEvent {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    throw new RequestError(
      "bad_request",
      "Each event must be an object.",
    );
  }

  const event = raw as Record<string, unknown>;

  // d / e / p only. An extra key is refused, not ignored.
  for (const key of Object.keys(event)) {
    if (key !== "d" && key !== "e" && key !== "p") {
      throw new RequestError(
        "bad_request",
        `Unexpected event field "${key}". Only "d", "e" and "p" are accepted.`,
      );
    }
  }

  // The server's own current UTC date, and nothing else. A client cannot
  // backdate a bucket, pre-create a future one, or write into a day that
  // retention has already cleared. An exact equality check also makes a
  // shape check redundant: anything that is not today's exact string is
  // refused, whether or not it looks like a date at all.
  if (event.d !== today) {
    throw new RequestError(
      "bad_request",
      'Event date must be the current UTC date ("YYYY-MM-DD").',
    );
  }

  if (
    typeof event.e !== "string" ||
    !EVENT_NAME_SET.has(event.e)
  ) {
    throw new RequestError(
      "bad_request",
      `Unsupported event "${String(event.e)}". Allowed: ${ANALYTICS_EVENTS.join(", ")}.`,
    );
  }

  const eventName = event.e as AnalyticsEventName;
  const permitted =
    ANALYTICS_EVENT_PROPERTIES[eventName];

  const properties: Record<string, string> = {};

  if (event.p !== undefined) {
    if (
      typeof event.p !== "object" ||
      event.p === null ||
      Array.isArray(event.p)
    ) {
      throw new RequestError(
        "bad_request",
        'Event "p" must be an object.',
      );
    }

    const supplied = event.p as Record<string, unknown>;
    const suppliedKeys = Object.keys(supplied);

    if (suppliedKeys.length > MAX_PROPERTIES_PER_EVENT) {
      throw new RequestError(
        "bad_request",
        `An event may carry at most ${MAX_PROPERTIES_PER_EVENT} properties.`,
      );
    }

    for (const [key, value] of Object.entries(supplied)) {
      if (!permitted.includes(key)) {        throw new RequestError(
          "bad_request",
          `Property "${key}" is not allowed on "${eventName}". Allowed: ${permitted.join(", ")}.`,
        );
      }

      if (typeof value !== "string") {
        throw new RequestError(
          "bad_request",
          `Property "${key}" must be a string.`,
        );
      }

      const allowed =
        ANALYTICS_PROPERTY_VALUES[key] ?? [];

      if (!allowed.includes(value)) {
        throw new RequestError(
          "bad_request",
          `Unsupported value "${value}" for "${key}". Allowed: ${allowed.join(", ")}.`,
        );
      }

      properties[key] = value;
    }
  }

  return { eventName, properties };
}

/** One counter delta: which bucket, and by how much. */
export type CounterDelta = {
  eventName: AnalyticsEventName;
  propKey: string;
  propValue: string;
  delta: number;
};

/**
 * Separator for the in-request delta-collapse key.
 *
 * A pipe, chosen so the separator is VISIBLE in the source. An earlier
 * revision used literal NUL bytes, which is collision-safe but makes the
 * file read as binary to ordinary tooling and is invisible in a diff, so
 * the property it was chosen for was not observable to a reviewer.
 *
 * Collision-safety rests on no allow-listed value containing a pipe, and
 * that is asserted rather than assumed: `server/tests/analytics.test.ts`
 * checks every event name and every property key and value against this
 * constant, so adding a value containing a pipe fails a test instead of
 * silently merging two buckets.
 */
export const DELTA_KEY_SEPARATOR = "|";

/** The key a delta is collapsed on. */
function deltaKey(
  eventName: string,
  propKey: string,
  propValue: string,
): string {
  return [
    eventName,
    propKey,
    propValue,
  ].join(DELTA_KEY_SEPARATOR);
}

export type ParsedAnalyticsBatch = {
  bucketDate: string;
  eventsAccepted: number;
  deltas: CounterDelta[];
};

/**
 * Validate a request body and fold it into counter deltas.
 *
 * Identical events within one batch are collapsed into a single delta with
 * a summed increment. That is observationally identical to writing them
 * separately and costs one row instead of N, which matters because writes
 * are the scarce resource.
 */
export function parseAnalyticsBatch(
  body: Record<string, unknown>,
  options: {
    now?: () => number;
    maxEvents?: number;
  } = {},
): ParsedAnalyticsBatch {
  const today = currentUtcDate(options.now);
  const maxEvents =
    options.maxEvents ?? MAX_EVENTS_PER_REQUEST;

  for (const key of Object.keys(body)) {
    if (key !== "events") {
      throw new RequestError(
        "bad_request",
        `Unexpected field "${key}". Only "events" is accepted.`,
      );
    }
  }

  if (!Array.isArray(body.events)) {
    throw new RequestError(
      "bad_request",
      '"events" must be an array.',
    );
  }

  if (body.events.length === 0) {
    throw new RequestError(
      "bad_request",
      '"events" must not be empty.',
    );
  }

  if (body.events.length > maxEvents) {
    throw new RequestError(
      "too_large",
      `A request may carry at most ${maxEvents} events.`,
    );
  }

  const collapsed = new Map<string, CounterDelta>();

  for (const raw of body.events) {
    const { eventName, properties } = parseEvent(
      raw,
      today,
    );

    // The event's own total, with an empty dimension so a query can read
    // the count without summing the property rows.
    const total = collapsed.get(deltaKey(eventName, "", ""));

    if (total === undefined) {
      collapsed.set(deltaKey(eventName, "", ""), {
        eventName,
        propKey: "",
        propValue: "",
        delta: 1,
      });
    } else {
      total.delta += 1;
    }

    for (const [key, value] of Object.entries(properties)) {
      const key2 = deltaKey(eventName, key, value);
      const existing = collapsed.get(key2);

      if (existing === undefined) {
        collapsed.set(key2, {
          eventName,
          propKey: key,
          propValue: value,
          delta: 1,
        });
      } else {
        existing.delta += 1;
      }
    }
  }

  return {
    bucketDate: today,
    eventsAccepted: body.events.length,
    deltas: [...collapsed.values()],
  };
}

/* -------------------------------------------------------------------------- */
/* storage                                                                     */
/* -------------------------------------------------------------------------- */

const UPSERT_ROW = "(?, ?, ?, ?, ?, ?)";

/**
 * Apply counter deltas.
 *
 * One multi-row UPSERT per statement group, all issued through
 * `db.batch()` so the whole request is a small, fixed number of round
 * trips regardless of how many events it carried.
 *
 * The conflict clause is what makes concurrent increments safe: two
 * requests touching the same bucket both succeed and the counts add,
 * because the database serialises the UPDATE rather than the application
 * having to.
 */
export async function recordAnalytics(
  db: D1Database,
  parsed: ParsedAnalyticsBatch,
  now: string,
): Promise<number> {
  if (parsed.deltas.length === 0) {
    return 0;
  }

  const statements: D1PreparedStatement[] = [];

  for (
    let index = 0;
    index < parsed.deltas.length;
    index += ANALYTICS_ROWS_PER_STATEMENT
  ) {
    const slice = parsed.deltas.slice(
      index,
      index + ANALYTICS_ROWS_PER_STATEMENT,
    );

    statements.push(
      db
        .prepare(
          `INSERT INTO analytics_daily (
             bucket_date, event_name, prop_key, prop_value,
             count, updated_at
           ) VALUES ${slice
             .map(() => UPSERT_ROW)
             .join(", ")}
           ON CONFLICT (bucket_date, event_name, prop_key, prop_value)
           DO UPDATE SET
             count = analytics_daily.count + excluded.count,
             updated_at = excluded.updated_at`,
        )
        .bind(
          ...slice.flatMap((entry) => [
            parsed.bucketDate,
            entry.eventName,
            entry.propKey,
            entry.propValue,
            entry.delta,
            now,
          ]),
        ),
    );
  }

  await db.batch(statements);

  return statements.length;
}

/* -------------------------------------------------------------------------- */
/* admin read (design section 7)                                              */
/* -------------------------------------------------------------------------- */

/** One aggregated daily counter, as read back for the admin view. */
export type AnalyticsCount = {
  bucketDate: string;
  eventName: AnalyticsEventName;
  propKey: string;
  propValue: string;
  count: number;
};

/** Parsed and clamped query for the admin analytics endpoint. */
export type AnalyticsQuery = {
  /** Inclusive YYYY-MM-DD lower bound. */
  from: string;
  /** Inclusive YYYY-MM-DD upper bound. */
  to: string;
  /** Event filter, or null for every event. */
  event: AnalyticsEventName | null;
};

/**
 * Widest range a single request may ask for, in days.
 *
 * The design caps a request at 90 days. That is a response-size bound, not
 * a correctness one: the number of rows is a function of the retention
 * window and the allow-lists, never of traffic, so this is about keeping
 * one response small rather than about protecting the database.
 */
export const MAX_RANGE_DAYS = 90;

/** Largest `from` a request may reach back, matching the retention window. */
export const MAX_LOOKBACK_DAYS = 400;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a syntactically well-formed AND real calendar date.
 *
 * The shape check alone is not enough: `2026-13-45` matches
 * `^\d{4}-\d{2}-\d{2}$` but is not a date, and accepting it would let a
 * nonsense value through as if it were a real one. The round-trip check
 * rejects it, because parsing it does not produce the same calendar day.
 *
 * This matters for correctness rather than safety, since the result is
 * clamped either way: without it a caller would silently get today's
 * window when they asked for something impossible, and would have no way
 * to tell that their input was discarded.
 */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);

  if (!Number.isFinite(parsed)) {
    return false;
  }

  return (
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

/** UTC date `offsetDays` from today. */
function utcDateOffset(
  offsetDays: number,
  now: () => number,
): string {
  return new Date(now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Validate and clamp the admin analytics query parameters.
 *
 * Every bound here is a CLAMP rather than an error, because this is a
 * dashboard an administrator types a date range into: rejecting a
 * 6-month range would teach the operator the wrong thing, whereas serving
 * a bounded window and saying so in the response is honest and keeps
 * working.
 *
 * The clamp is also the security-relevant part. An unbounded or
 * unvalidated range would let a caller drive an arbitrary scan, so the
 * accepted window is decided by the server and the client cannot widen it.
 */
export function parseAnalyticsQuery(
  searchParams: URLSearchParams,
  options: { now?: () => number } = {},
): AnalyticsQuery {
  const now = options.now ?? Date.now;
  const today = currentUtcDate(now);
  const earliest = utcDateOffset(-MAX_LOOKBACK_DAYS, now);
  const dayMs = 86_400_000;

  /**
   * Read one date parameter, clamped into the retention window.
   *
   * A missing or unparseable value falls back rather than throwing, so a
   * malformed query string still renders a useful page instead of an
   * error. A value outside the window is pulled back to the nearest legal
   * bound rather than rejected, which is the same "clamp, do not error"
   * contract the whole endpoint uses.
   */
  const readDate = (
    raw: string | null,
    fallback: string,
  ): string => {
    const trimmed = (raw ?? "").trim();

    if (!isRealDate(trimmed)) {
      return fallback;
    }

    if (trimmed > today) {
      return today;
    }

    if (trimmed < earliest) {
      return earliest;
    }

    return trimmed;
  };

  // Default window: the last 30 days, which is what an operator almost
  // always wants and keeps the default response small.
  const to = readDate(searchParams.get("to"), today);
  const from = readDate(
    searchParams.get("from"),
    utcDateOffset(-29, now),
  );

  // A reversed range is normalized rather than refused, so typing the two
  // dates in the wrong order still shows something sensible.
  const lowFrom = from <= to ? from : to;

  // Enforce the width by keeping the requested upper bound and pulling the
  // lower bound forward. Because `to` is at most today and MAX_RANGE_DAYS
  // is far below MAX_LOOKBACK_DAYS, the result is always inside the
  // retention window without a second clamp.
  const widestFrom = new Date(
    Date.parse(`${to}T00:00:00Z`) -
      (MAX_RANGE_DAYS - 1) * dayMs,
  )
    .toISOString()
    .slice(0, 10);

  const eventParam = searchParams.get("event");

  return {
    from: lowFrom < widestFrom ? widestFrom : lowFrom,
    to,
    event:
      eventParam !== null && EVENT_NAME_SET.has(eventParam)
        ? (eventParam as AnalyticsEventName)
        : null,
  };
}

/**
 * Read aggregated daily counters.
 *
 * Every bound is decided before the query runs: the date range is already
 * clamped to the retention window and to MAX_RANGE_DAYS by
 * `parseAnalyticsQuery`, the event filter is an allow-listed name, and the
 * row count is inherently bounded by the retention window times the
 * allow-list cardinality. There is no `LIMIT` to add, because the result
 * set cannot grow with traffic - which is the property 5.2 built in.
 *
 * `ORDER BY bucket_date` is served by the table's primary key, so this is
 * an index range scan and not a sort.
 */
export async function readAnalytics(
  db: D1Database,
  query: AnalyticsQuery,
): Promise<AnalyticsCount[]> {
  const conditions = [
    "bucket_date >= ?",
    "bucket_date <= ?",
  ];
  const bindings: string[] = [query.from, query.to];

  if (query.event !== null) {
    conditions.push("event_name = ?");
    bindings.push(query.event);
  }

  const { results } = await db
    .prepare(
      `SELECT bucket_date, event_name, prop_key, prop_value, count
         FROM analytics_daily
        WHERE ${conditions.join(" AND ")}
        ORDER BY bucket_date ASC`,
    )
    .bind(...bindings)
    .all<{
      bucket_date: string;
      event_name: string;
      prop_key: string;
      prop_value: string;
      count: number;
    }>();

  return results.map((row) => ({
    bucketDate: row.bucket_date,
    eventName: row.event_name as AnalyticsEventName,
    propKey: row.prop_key,
    propValue: row.prop_value,
    count: Number(row.count),
  }));
}

/**
 * Delete daily counters older than the retention window.
 *
 * Bounded cutoff delete, run from the `scheduled()` handler alongside the
 * other purges. This is what makes storage growth bounded rather than
 * merely small: without it the table would grow by one row per distinct
 * bucket per day forever.
 */
export async function purgeAnalyticsOlderThan(
  db: D1Database,
  retentionDays: number,
  now: () => number = Date.now,
): Promise<void> {
  const cutoff = new Date(
    now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10);

  await db
    .prepare(
      `DELETE FROM analytics_daily
        WHERE bucket_date < ?`,
    )
    .bind(cutoff)
    .run();
}

/**
 * Parse the analytics retention window in days.
 *
 * Mirrors `parseAuditRetentionDays`: a missing, empty, zero, negative or
 * non-numeric value yields the default, so a bad configuration can never
 * delete everything or nothing.
 */
export { parseAnalyticsRetentionDays } from "./env.ts";
