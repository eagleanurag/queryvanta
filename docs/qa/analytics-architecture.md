# Analytics architecture (Task 5.1)

**Status:** design only. Nothing in this document has been implemented.
**Scope:** anonymous product analytics for QueryVanta.
**Precondition:** task 4.2H passed (see `phase-4-verification.md`).
**Grounding:** the current source tree, `migrations/0001_init.sql`,
`docs/qa/phase-4-abuse-audit.md`, and Cloudflare's published D1 and Workers
limits (cited below, retrieved 2026-10-02).

---

## 1. Objective, in one sentence

Measure which public learning features anonymous visitors actually use, in a
form cheap enough to run on the free tier and anonymous enough that it can
never become a tracking system.

---

## 2. What this design deliberately is NOT

Stated first, because the cost of getting this wrong is permanent and the
data is the part that cannot be un-collected.

- **Not a user tracking system.** No cross-request identity, no cookie, no
  device fingerprint, no IP-derived pseudonymous identifier.
- **Not a funnel that needs a user id.** Every question below is answerable
  from a *count per bucket per day*.
- **Not on the critical path.** Analytics must never be able to delay,
  fail, or alter a request the learner actually made.
- **Not a general event pipeline.** There is no event bus, no queue, no
  third-party SDK, and no new dependency.
- **Not a replacement for the audit log.** `admin_audit_log` remains the
  security record. Analytics is a product record. They have different
  retention, different access control, and different purposes, and merging
  them would give product metrics a security surface and security records a
  cardinality problem.

---

## 3. The free-tier baseline, quantitatively

Cloudflare Workers Free, as published:

| Resource | Free-tier allowance |
|---|---|
| D1 rows read | **5,000,000 / day** |
| D1 rows written | **100,000 / day** |
| D1 storage (per account) | **5 GB** |
| D1 storage (per database) | 500 MB |
| D1 queries per Worker invocation | **50** |
| Worker requests | 100,000 / day |

Two of these dominate the design, and they are asymmetric by a factor of
**50**:

- **Rows written are the scarce resource.** 100,000/day.
- **Rows read are comparatively abundant.** 5,000,000/day, i.e. 50x.

**Therefore: writes are the currency, and aggregation must happen on the
write path, not at query time.** This single asymmetry drives almost every
decision below.

Two further facts from Cloudflare's billing definitions that materially
shape the storage design:

1. **A row counts as one regardless of its size.** "A row that is 1 KB and a
   row that is 100 KB both count as one row." Wide JSON payloads are
   therefore *free* in billing terms but expensive in storage terms.
2. **Each index column adds a written row.** "Indexes will add an additional
   written row when writes include the indexed column." Every index on the
   analytics table is a direct multiplier on the write budget, so the index
   set must be minimal and justified.

What Phase 4 already removed, which is the budget this design inherits
(measured values are in `phase-4-verification.md`):

| Vector | Before Phase 4 | After |
|---|---|---|
| Anonymous admin audit writes | 1 per request, unbounded | bounded, sampled |
| Housekeeping per `/api/auth/session` | 2 `DELETE`s per call | 0 (cron) |
| Public catalog reads | 100% hit D1 | cacheable, `ETag`/304 |
| Bulk import | ~1,500 sequential round trips | 253 statements / 3 batches |
| Admin mutation catalog fetches | ~3 | 1 |

---

## 4. What is measured

Only feature usage that answers a product question. Each event is a fixed,
low-cardinality name plus a small allow-listed property set. Every one of
them is answerable from a daily aggregate.

| Event | Question it answers | Properties |
|---|---|---|
| `question_viewed` | Which question types are actually read? | `engine`, `difficulty`, `category_bucket` |
| `question_submitted` | Where do learners give up? | `engine`, `difficulty`, `outcome` (`correct`/`incorrect`) |
| `practice_started` | Do learners use practice, or only read? | `engine` |
| `practice_completed` | Is a practice session finished or abandoned? | `engine`, `outcome` |
| `interview_started` | Is interview mode used at all? | `engine` |
| `page_viewed` | Which landing pages earn their keep? | `page_kind` |

Six events, all with enumerable property values. No event carries free text,
no identifiers, or per-user data.

### 4.1 Deliberately NOT measured

This list is the privacy position. Each entry is a decision, not an omission.

| Not collected | Why |
|---|---|
| Any user identifier | There is no anonymous-user concept in this design. The admin has exactly one account; a "user id" could only mean a browser fingerprint, which is tracking. |
| IP addresses | An IP is personal data in several jurisdictions and is a re-identification vector. The rate limiter already needs a per-address bucket for abuse control; analytics must not reuse or retain it. |
| Cookies or local-storage analytics ids | Creates a durable cross-visit identity. Nothing in the product needs it. |
| Free-text of any kind | Question titles, descriptions, code submissions and error messages are the user's content and may contain anything. There is no safe way to truncate PII. |
| Code or SQL submitted by the learner | Highest-sensitivity content in the product. Excluded absolutely. |
| OAuth identifiers, tokens, `state`, PKCE verifiers | Security credentials. The repo's posture is already explicit: the audit log's metadata allow-list exists precisely to keep these out (`server/audit.ts`). |
| Session identifiers, even hashed | The existing model hashes session tokens with a deployment salt so a database dump cannot be replayed. Analytics has no need for a session reference, so it does not get one. |
| GitHub account details of the administrator | A single known admin; recording it would add nothing and create a link between product and identity data. |
| Precise timestamps per event | Second-resolution timestamps multiply cardinality and serve no product question. Daily buckets are enough (see §5). |
| Referring URLs and search queries | Classic tracking vectors with no product value here. |
| Errors and stack traces from the learner client | Can contain file paths and user content. |
| Anything about *which specific question* a given visitor looked at, over time | Without an identity this is just an aggregate, and the aggregate is what we store. |

The governing rule, stated so it can be applied to future ideas:

> If answering the question does not require knowing *who* or *exactly
> when*, the answer belongs in an aggregate. If it does, do not collect it.

---

## 5. Storage shape

### 5.1 The core decision: aggregate on write, not on read

The alternative — storing one row per event and aggregating at query time —
is the obvious design and it is the wrong one here. With a 100,000
rows-written/day ceiling and a 5,000,000 rows-read ceiling, an event table
burns the scarce resource to protect the abundant one.

So the design inverts it: **one counter row per (day, event, dimension set),
updated in place.** An event is a `UPSERT` on a unique key.

Consequences, all favourable:

- Storage is bounded by `days x events x distinct dimension combinations`,
  not by traffic. Traffic stops mattering after the first write of each
  bucket.
- Reads for the admin view are a handful of indexed range scans.
- Write cost is proportional to *distinct buckets touched*, not to users.

### 5.2 Table

One table, added by a new migration (`0002_analytics.sql`), written by the
scheduled handler only in this phase.

```sql
CREATE TABLE IF NOT EXISTS analytics_daily (
  bucket_date    TEXT NOT NULL,          -- YYYY-MM-DD, UTC
  event_name     TEXT NOT NULL,          -- allow-listed, see section 4
  prop_key       TEXT NOT NULL,          -- property name, or '' for none
  prop_value     TEXT NOT NULL,          -- allow-listed value
  count          INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (bucket_date, event_name, prop_key, prop_value)
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_date
  ON analytics_daily (event_name, bucket_date);
```

### 5.3 Why this exact shape

- **The primary key is the aggregation.** Uniqueness is enforced by the
  database, so no application-level locking is needed and concurrent
  increments cannot lose a count.
- **The composite primary key means the lookup path needs no extra index.**
  The one added index exists only for the admin's "all events for a date"
  query, which the primary key cannot serve because `event_name` is not its
  leading column.
- **One index, not five.** Each indexed column costs an extra written row per
  write (Cloudflare's billing definition 6). One index is the entire index
  budget for this table.
- **`prop_key`/`prop_value` rather than a column per property.** Six events
  with three properties each would mean ~18 columns and a migration every
  time a property is added. The pair costs one extra index entry only when
  both are present, which is always.
- **One row per (date, event, property)** keeps rows small and counts
  meaningful. Storing a property *combination* per row would be smaller
  still, but it multiplies rows by the filter combinations and makes the
  admin view need a fan-out query. Not worth it at this scale.

### 5.4 Cardinality budget, enforced

Dimensions are the risk: an unbounded value would turn the bucket key into a
unique row per visit and silently restore the event-table problem.

Every property value is validated against an **allow-list derived from the
repository's own constants**, exactly as task 4.2E did for the public
filters:

- `engine` -> `QUESTION_TYPES`
- `difficulty` -> `DIFFICULTIES`
- `outcome` -> `correct` | `incorrect` | `abandoned`
- `page_kind` -> a fixed route-class enum
- `category_bucket` -> a **bucketed** category, not the raw category.
  Categories are free text with ~21 live values and no upper bound (see the
  4.2E deviation), so raw categories are bucketed into a small fixed set
  (SQL-family / pyspark-family / modeling / other). This is the one place
  where the design departs from "use the real value", and it is deliberate:
  it keeps the bucket key bounded no matter what an administrator types.

Worst case therefore: `365 days x 6 events x (1 + 4 engine + 3 difficulty +
3 outcome + 5 page_kind + 5 category_bucket) ~= 365 x 6 x 21 ~= 46,000 rows`
after a full year of every combination being touched. At roughly 100 bytes
per row plus one index entry that is well under 10 MB — comfortably inside
the 500 MB per-database limit, and it does not grow with traffic.

### 5.5 Retention

Daily rows older than **400 days** are deleted by the existing `scheduled()`
handler, alongside the other purges.

This is a retention *policy for the data we choose to keep*, deliberately
separate from `admin_audit_log`, which keeps 90 days for security. The two
must not share a window: analytics is a trend record where an old daily
bucket is worthless, and audit is an investigation record where it is not.

---

## 6. Collection: where and how

### 6.1 Where events are produced

**On the client, at the point of user action, and sent to the Worker's own
origin.** Not on the server request path.

Rationale, and it is the most important decision in this document:

- A server-side hook on a public API request would make analytics a **write
  on an anonymous read path**, which is precisely the class of defect Phase
  4 existed to remove (V-01, V-02, V-03). It would also mean an anonymous
  visitor could be made to write to D1 by making a request.
- Phase 4 established that anonymous traffic should reach D1 as *reads at
  most, and ideally none at all* (the public catalog is now cacheable).

So: **the public request path is untouched by analytics.**

### 6.2 The ingest endpoint

`POST /api/analytics/events`, public, no session, no cookie, no CORS
credentials. It exists solely to accept a small batch of pre-aggregated
counter deltas.

```
POST /api/analytics/events
{ "d": "2026-10-01", "e": "question_viewed", "p": { "engine": "SQL", "difficulty": "Easy" } }
```

- `d` must equal the server's current UTC date. A stale or future date is
  rejected, so a client with a wrong clock cannot poison a historical bucket
  or pre-create a future one.
- `e` must be in the event allow-list.
- Every key in `p` must be in the property allow-list, and every value must
  be in that property's value allow-list. Anything else is a **400**.
- No identifier of any kind is accepted, because there is no column to put one
  in. There is no "anonymous id" parameter, because that is the thing being
  refused.

### 6.3 Client batching and delivery

The client accumulates events in memory and flushes them on a timer and on
`visibilitychange`, with:

- a **hard cap** on the queue length, dropping the oldest beyond it, so a
  long-lived tab cannot grow unbounded memory;
- `navigator.sendBeacon` on unload, falling back to `fetch(..., { keepalive: true })`;
- **no retry loop**. A failed send is dropped. Retrying an analytics event
  amplifies load for a non-critical signal and risks duplicate counting;
- failure swallowed. No analytics error may surface to the learner or
  interfere with a question, an editor, or a navigation.

### 6.4 Abuse posture

The endpoint is an unauthenticated write, so it inherits exactly the problem
class Phase 4 solved, and must use the same answers:

- **Rate limit.** Reuse `server/rateLimit.ts`, which is already deployed and
  tested (task 4.2B). Per-client-address, on the order of 60 writes/minute —
  comfortably above any honest client, and low enough that the write budget
  cannot be spent by one caller. It returns 429 with `Retry-After`.
- **Batch cap.** A bounded number of events per request, matching the 512 KB
  `MAX_BODY_BYTES` convention already in `server/request.ts`, with an
  allow-list on every key and value, so a hostile payload cannot create
  buckets. Cardinality is bounded by the allow-list, not by the request.
- **Writes are aggregated**, so even a fully successful burst of accepted
  events moves a bounded number of *rows*: at most
  `events x distinct dimension values` per burst, and permanently bounded by
  section 5.4.

The residual risk, stated plainly: an attacker can still consume some of the
write budget, because any unauthenticated write endpoint can. The mitigation
is the rate limit plus a permanently bounded set of buckets. The design does
**not** claim the endpoint is abuse-proof, and 5.4 must be implemented as an
enforced allow-list rather than a convention, or the bound does not hold.

### 6.5 Same-origin requirement

The endpoint is a write, so it takes the **same** same-origin check as the
OAuth start route (task 4.2C): `Sec-Fetch-Site` first, then `Origin`, then
`Referer`. This is deliberate reuse of an existing, tested control rather
than a new one. Because `sendBeacon` is same-origin by construction, this
costs the honest client nothing while denying scripted cross-origin
injection.

---

## 7. The admin-facing view

**Only aggregates are ever read, and only through an authenticated admin
route.** No raw event is stored, so there is nothing raw to leak.

`GET /api/admin/analytics?from=&to=&event=` returns daily counts, bounded:

- `from`/`to` clamped to at most **90 days** in a single request, and never
  more than 400 days back (the retention window);
- at most **6 events** (the whole allow-list), so the response cannot grow
  with traffic;
- a fixed response shape, so a large catalog cannot inflate it.

Every route is behind `requireAdmin`, which performs a real server-side
session lookup against a hashed token. There is no client-side flag, no
"admin" query parameter, and no public analytics endpoint. The public
`/api/questions*` route is the only thing an anonymous visitor can read, and
it returns catalog data, not analytics.

Aggregation queries are `GROUP BY bucket_date` over an indexed range, so they
are bounded by the retention window rather than by traffic. Empty datasets
return empty aggregates, not errors.

---

## 8. Failure behaviour

| Failure | Behaviour |
|---|---|
| Client cannot reach the endpoint | Events drop. No retry. Nothing user-visible. |
| D1 rejects the ingest write | 500 to the client; client discards the batch. Learner unaffected. |
| Daily limit exceeded | D1 returns an error; ingest fails closed. No partial counters, because the counters are UPDATEs on a key and a failed statement writes nothing. |
| Malformed or oversized payload | 400, discarded, never reaches D1. |
| Admin view query fails | Error state in the UI. Does not affect the public site. |
| Ingest is entirely unavailable | The product is unaffected. Analytics is not on any critical path. |

The deliberate choice is **fail-closed on the write and fail-silent on the
client**. A lost count is acceptable; a wrong count, an unbounded write, or
a broken learner flow is not.

---

## 9. Cost model, quantitatively

Worst realistic case: one visitor performs ~10 events per session, ~4
sessions/day, and every event lands as its own accepted write.

- 40 accepted writes per visitor-day.
- At the rate limit of 60/min, an honest client is far below the ceiling.

What the budget actually looks like:

| Scenario | Rows written/day | Share of 100,000 |
|---|---|---|
| 10 visitors/day, one flush per event | ~400 | 0.4% |
| 100 visitors/day, batched flushes | ~4,000 | 4% |
| 1,000 visitors/day, batched flushes | ~40,000 | 40% |
| Steady state after first touch of a bucket | ~`distinct buckets x visitors` | bounded by §5.4, not by traffic |

The row at "steady state" is the point of the design: because writes are
UPSERTs on a fixed key set, the *daily write count is proportional to
distinct buckets touched, not to traffic*. Traffic above the first touch of
each bucket costs zero additional rows.

Storage after one year at full cardinality: **under 10 MB** of a 500 MB
per-database allowance, with the daily retention purge bounding it in
practice to far less.

**Conclusion: this design does not require a paid tier.** The stop condition
in the task file — "if a sound design appears to require a paid Cloudflare
tier" — is not reached.

---

## 10. Phasing

Each phase is independently valuable and independently shippable, and no
phase depends on an unbuilt later phase.

| Phase | Task | Delivers |
|---|---|---|
| 5.1 | this document | design only |
| 5.2 | anonymous event collection | migration, ingest route, rate limit, client queue/flush, no UI |
| 5.3 | admin analytics page | authenticated read route + aggregate UI |
| 5.4 | privacy/security review | adversarial pass over 5.2–5.3 |
| 5.5 | production verification | read-only verification of the deployed behaviour |

5.2 deliberately ships **without** the admin view: collection can be
deployed and its cost and cardinality observed in the dashboard before
anything is displayed. That is the cheap way to find out whether the model
is wrong.

---

## 11. Open questions for 5.2

Named rather than hidden, because each is a decision 5.2 must make:

1. **Where does the client flush live?** A shared module in `src/lib` used
   by the question, practice and interview surfaces, so exactly one queue
   exists for the app.
2. **Does a failed flush clear the queue or retain it?** Recommendation:
   clear. Retaining risks duplicate counting on the next successful flush,
   and analytics is not worth a correctness guarantee.
3. **Should events be sampled client-side under load?** Recommendation: no.
   Aggregation on write already bounds cost; sampling would add a second,
   less predictable bound.
4. **Should `question_viewed` count repeat views?** Recommendation: no, count
   once per question per page load, so the number means "visitors who opened
   this", not "views".

---

## 12. Traceability

| Design element | Grounded in |
|---|---|
| Writes are the scarce resource | Cloudflare D1 pricing: 100,000 rows written/day vs 5,000,000 read/day |
| Aggregation on write | The 50:1 asymmetry above; Phase 4's own conclusion that anonymous writes are the cost problem |
| Minimal index set | D1 billing definition: an index column adds a written row per write |
| Server-side aggregation, client-side collection | Phase 4 V-01/V-02/V-03: anonymous request paths must not write |
| Reuse `rateLimit.ts` | Task 4.2B, deployed and tested |
| Reuse the 4.2C same-origin check | Task 4.2C, deployed and tested |
| Engine/difficulty allow-lists | `server/questionSchema.ts`, the same constants 4.2E used |
| Category bucketing | 4.2E finding: `category` is free text with no upper bound |
| No identifiers, no cookies, no IPs | Existing posture: hashed salted session tokens, audit metadata allow-list |
| Separate from `admin_audit_log` | Different purpose, access control and retention from the security record |

**Limits cited:** Cloudflare D1 limits and pricing pages, retrieved
2026-10-02 (documents last updated 2026-04-21). The two figures this design
depends on most — 100,000 rows written/day and 5,000,000 rows read/day on
Workers Free — should be re-checked before 5.2 if this document is read
again much later.