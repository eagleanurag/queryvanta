-- Anonymous product analytics (Cloudflare D1)
--
-- Task 5.1 design, section 5. Implements the storage shape that the 5.1
-- design specifies. This migration is ADDITIVE ONLY: no existing table,
-- column, index or constraint is altered, dropped or renamed, so it is
-- safe to apply to a database that is already serving production data.
--
-- ---------------------------------------------------------------------------
-- A WORD ON COMMENT STYLE IN THIS FILE
-- ---------------------------------------------------------------------------
-- No comment in this file may contain a single-quote character.
--
-- `wrangler d1 execute --file` splits a migration file into statements
-- with a scanner that does not track SQL line comments when it looks for
-- string literals. A pair of single-quote characters inside a `--`
-- comment is therefore read as a string, and everything after it is
-- misparsed until the next quote. That surfaced as a confusing
-- `syntax error near "event_name"` pointing twenty lines away from the
-- comment that actually caused it.
--
-- A semicolon inside a comment is NOT a problem: statement splitting
-- does honour line comments, and 0001_init.sql has always carried two.
-- Only the quote character is unsafe, so only that is forbidden.
--
-- The 5.2 test suite asserts this property for every migration file, so
-- the constraint cannot silently regress.
--
-- ---------------------------------------------------------------------------
-- WHY THIS TABLE IS NOT AN EVENT LOG
-- ---------------------------------------------------------------------------
-- D1 bills rows written at 100,000/day on Workers Free against 5,000,000
-- rows read/day, so writes are the scarce resource by a factor of 50. An
-- event table would spend the scarce resource to protect the abundant one.
--
-- So each row is an already-aggregated daily counter, keyed by the
-- dimensions it is sliced by, and an incoming event is an UPSERT that
-- increments the matching counter in place, using the form
-- ON CONFLICT ... DO UPDATE SET count = count + excluded.count
--
-- Write cost is therefore proportional to the number of DISTINCT BUCKETS
-- touched, not to traffic. Once every bucket for a day exists, further
-- traffic writes no new rows at all.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO IDENTIFIER COLUMN
-- ---------------------------------------------------------------------------
-- There is no user id, no session id, no cookie, no device fingerprint, no
-- IP-derived pseudonymous value and no per-event timestamp. The composite
-- primary key is the entire identity of a row, and the privacy position
-- that makes this table safe to store is a consequence of its shape, not of
-- a policy that could later be relaxed. See docs/qa/analytics-architecture.md
-- section 4.1 for the full list of what is deliberately never collected.
--
-- The client address is used by the rate limiter to bound abuse, and is
-- never written here. It is not a column, so it cannot leak.
--
-- ---------------------------------------------------------------------------
-- CARDINALITY BOUND
-- ---------------------------------------------------------------------------
-- The bucket key is bounded by the server-side allow-lists in
-- server/analytics.ts, not by caller input. Every event name, property
-- name and property value is validated against a fixed enumeration before
-- any write is attempted, and an event may only carry the properties its
-- own definition permits. A hostile payload therefore cannot invent
-- buckets, and the row count is bounded by
--
--   days x events x (1 + sum of permitted property values per event)
--
-- which is a few tens of thousands of rows after a year at full
-- cardinality, not a function of traffic.
--
-- ---------------------------------------------------------------------------
-- THE prop_key / prop_value PAIR
-- ---------------------------------------------------------------------------
-- An empty prop_key holds the event daily total, so a query can always
-- read an event count without summing its dimension rows. One event with
-- three properties writes four rows: the total plus one per property.
--
-- Parameters are always bound and no value is ever interpolated.

CREATE TABLE IF NOT EXISTS analytics_daily (
  bucket_date    TEXT    NOT NULL,
  event_name     TEXT    NOT NULL,
  prop_key       TEXT    NOT NULL DEFAULT '',
  prop_value     TEXT    NOT NULL DEFAULT '',
  count          INTEGER NOT NULL DEFAULT 0
                         CHECK (count >= 0),
  updated_at     TEXT    NOT NULL,

  -- The primary key IS the aggregation. Uniqueness is enforced by the
  -- database rather than by application-level locking, so two concurrent
  -- increments of the same bucket cannot lose a count.
  PRIMARY KEY (bucket_date, event_name, prop_key, prop_value)
);

-- Supports the admin read view "every event for this date range" query,
-- which the primary key cannot serve because event_name is not its
-- leading column. This is the ONLY index on the table, and that is
-- deliberate: under the D1 billing definitions an indexed column adds an
-- additional written row per write, so the index set is part of the write
-- budget.
CREATE INDEX IF NOT EXISTS idx_analytics_event_date
  ON analytics_daily (event_name, bucket_date);
