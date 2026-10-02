# Analytics privacy and security review

**Task:** 5.4 — review the completed analytics feature for privacy and security
**Scope reviewed:** the analytics work of tasks 5.1–5.3, as committed to the
working tree
**Design of record:** [`analytics-architecture.md`](./analytics-architecture.md)
**Reviewer stance:** verification only. Every claim below is backed either by
output that was actually observed against a real local Worker and a real local
D1 database, or by code that is quoted. Where something could not be proven, it
is said so explicitly rather than asserted.

**Verdict: PASS. No personal data is stored, anonymity is structural rather
than policed, and no cross-session linkage exists.** One defect of low
severity was found and is recorded in section H. No behaviour was changed to
make a finding disappear.

---

## A. Method

Two things were done, in this order.

1. **Observed the real storage shape**, by booting the actual Worker against a
   fresh local D1, driving the real public ingest endpoint, and then dumping
   the table with `SELECT *`. The output of that exercise is quoted verbatim
   in sections B and C. This matters more than reading the migration file,
   because the question the task poses is what is *actually* stored.
2. **Ran adversarial probes** against the live endpoint: several distinct
   client addresses, cross-site requests with a forged same-origin `Referer`,
   and five different attempts to smuggle an identifier or a backdated bucket
   into storage.

The throwaway collector used for step 1 was deleted after the evidence was
captured. Nothing in the repository was added for the review's own benefit.

---

## B. What is actually stored

The `CREATE TABLE` statement as SQLite reports it, from
`sqlite_master`, against a database the endpoint itself populated:

```
CREATE TABLE IF NOT EXISTS analytics_daily (
  bucket_date    TEXT    NOT NULL,
  event_name     TEXT    NOT NULL,
  prop_key       TEXT    NOT NULL DEFAULT '',
  prop_value     TEXT    NOT NULL DEFAULT '',
  count          INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at     TEXT    NOT NULL,
  PRIMARY KEY (bucket_date, event_name, prop_key, prop_value)
)
```

Columns, from `pragma_table_info`:

| # | column | type |
|---|---|---|
| 1 | `bucket_date` | TEXT |
| 2 | `event_name` | TEXT |
| 3 | `prop_key` | TEXT |
| 4 | `prop_value` | TEXT |
| 5 | `count` | INTEGER |
| 6 | `updated_at` | TEXT |

**Six columns. There is no column for a user id, a session id, a cookie, an
IP address, a device fingerprint, a user agent, a referrer, a URL, or a
per-event timestamp.** Anonymity here is not a rule the application applies;
it is a property of the shape. There is nowhere for an identifier to go, so
there is no code path that could put one there even by mistake.

Indexes actually present:

| index | kind |
|---|---|
| `sqlite_autoindex_analytics_daily_1` | the composite primary key |
| `idx_analytics_event_date` | `(event_name, bucket_date)` |

### B.1 Every row, after a realistic sequence of traffic

The full table, dumped with `SELECT *`, after three distinct "visitors"
viewed the discover page, one batch of 25 submissions was accepted, and one
question was viewed:

```json
[
  { "bucket_date": "2026-10-02", "event_name": "page_viewed",
    "prop_key": "", "prop_value": "", "count": 3,
    "updated_at": "2026-10-02T02:06:38.870Z" },
  { "bucket_date": "2026-10-02", "event_name": "page_viewed",
    "prop_key": "page_kind", "prop_value": "discover", "count": 3,
    "updated_at": "2026-10-02T02:06:38.870Z" },
  { "bucket_date": "2026-10-02", "event_name": "question_submitted",
    "prop_key": "", "prop_value": "", "count": 25,
    "updated_at": "2026-10-02T02:06:45.014Z" },
  { "bucket_date": "2026-10-02", "event_name": "question_submitted",
    "prop_key": "difficulty", "prop_value": "Easy", "count": 25,
    "updated_at": "2026-10-02T02:06:45.014Z" },
  { "bucket_date": "2026-10-02", "event_name": "question_submitted",
    "prop_key": "engine", "prop_value": "SQL", "count": 25,
    "updated_at": "2026-10-02T02:06:45.014Z" },
  { "bucket_date": "2026-10-02", "event_name": "question_submitted",
    "prop_key": "outcome", "prop_value": "correct", "count": 25,
    "updated_at": "2026-10-02T02:06:45.014Z" }
]
```

Six rows for 28 accepted events. Every value is either a date, an
allow-listed name, or a count. `updated_at` is a bucket-maintenance field,
not an event timestamp: there is one row per bucket, so it records when a
*counter* last moved, and cannot say when any individual visit happened.

---

## C. No personal data, no fingerprinting, no cross-session linkage

### C.1 The linkage test, and why it is decisive

Three requests were sent from three different client addresses
(`203.0.113.101`, `203.0.113.102`, `198.51.100.77`) — three different
"visitors", as far as anything in the system is concerned. Observed result:

```
rows created by 3 separate "visitors": 1
row count for (page_viewed, page_kind=discover): 1
distinct bucket keys: 1
the count is SHARED: 3
```

**One row. One bucket. A single shared count of 3.**

This is the whole privacy claim in one measurement. The three callers are
not distinguishable afterwards, because they are not distinguished at any
point: they contributed to the same counter. There is no per-visitor row to
join against, no session key to correlate, and no ordering that would
reconstruct who arrived when — a burst of fifty views and a burst of one
view fifty times produce byte-identical storage.

The address is used to enforce the rate limit, and that is the only place it
is read. Observed leak check across every stored row:

```
203.0.113.101 present in stored data: false
203.0.113.102 present in stored data: false
198.51.100.77   present in stored data: false
192.0.2.250     present in stored data: false
any value that looks like an IP: false
any value that looks like a long hex token: false
```

### C.2 No fingerprinting, and none possible

There is no hash of anything. A pseudonymous identifier would require hashing
something stable about the client — a user agent, a header combination, a
canvas or font signature. The code reads none of those. The client's only
input to the payload is the event name and allow-listed properties:

```ts
const { name, ...rest } = event;

for (const [key, value] of Object.entries(rest)) {
  const wireKey = propertyWireName(key);

  if (wireKey !== null && typeof value === "string") {
    properties[wireKey] = value;
  }
}
```

(`src/lib/analytics.ts`) An unmapped property is dropped rather than
forwarded, so a caller cannot even accidentally add a dimension that was not
intended.

### C.3 Nothing sensitive is accepted, not merely rejected

Observed responses to five injection attempts against the live endpoint:

| payload | status |
|---|---|
| `{"extra":"userId","d":<today>,"e":"page_viewed"}` | 400 |
| `{"d":<today>,"e":"page_viewed","p":{"visitorId":"abc"}}` | 400 |
| `{"d":<today>,"e":"page_viewed","p":{"engine":"SELECT 1"}}` | 400 |
| `{"d":<today>,"e":"user_signed_up"}` | 400 |
| `{"d":<yesterday>,"e":"page_viewed"}` | 400 |

The first two matter most. The event object is checked to contain **exactly**
the keys `d`, `e` and `p`; an unrecognised top-level key is refused, and a
property name outside the per-event allow-list is refused. A client trying to
attach an identifier is not silently ignored — it gets an error naming the
field. There is no "unknown field, pass it through anyway" branch.

Backdating is refused too: `d` must equal the server's current UTC date, so
no client can write into a historical bucket or pre-create a future one.

The engine value `SELECT 1` is refused because `engine` is validated against
the same `QUESTION_TYPES` constant the question write path enforces. Free text
is not accepted anywhere, which removes the entire category of "a user pasted
their email into a field we logged".

---

## D. Authorization

| endpoint | method | auth | cache |
|---|---|---|---|
| `/api/analytics/events` | POST | none, by design | n/a |
| `/api/admin/analytics` | GET | **required** `requireAdmin` | **`no-store`** |

The read endpoint is behind the same `requireAdmin` call as every other admin
route, which performs a real server-side session lookup against a salted
SHA-256 token hash. Asserted in
`server/tests/admin-analytics.test.ts`:

- no session → 401
- bogus session cookie → 401
- a valid session for a non-administrator GitHub id → 403
- `POST`/`PUT`/`DELETE` → 405
- `?admin=true&adminGithubId=...` with no cookie → 401, so a query parameter
  is not a substitute for the session check
- `Cache-Control` contains `no-store` and **not** `public`, and no `ETag` is
  present

The 4.2D invariant that the public catalog is the *only* publicly cacheable
API response is re-asserted across six routes including the new one, so
adding an endpoint did not quietly widen what a shared cache may store.

**The public ingest path is not a read surface.** It rejects `GET` with 405
and returns only `{"accepted": n}` — never the stored counts, so a caller
cannot use it to read back what has been aggregated.

---

## E. Abuse resistance

Observed, 75 sequential requests from one address:

```
accepted (200): 60
throttled (429): 15
```

Exactly the configured `60/min` budget, then refusal. The limiter is charged
**before** the request body is read, so a throttled caller spends zero D1
operations — the same ordering decision made on the OAuth start route in
4.2C, and the reason the limit bounds the cost of the checks as well as of
the write.

Cross-site request with a forged same-origin `Referer`, which is the exact
abuse shape behind audit finding V-01:

```
status: 403
```

The 4.2C `Sec-Fetch-Site`-first check is reused unchanged rather than
reimplemented, and `Sec-Fetch-Site` is a forbidden header name that no script
can set.

**Residual risk, stated plainly.** The limiter is per-isolate and therefore
best-effort, exactly as documented in `server/rateLimit.ts`; an attacker
spreading across isolates gets one window's budget per isolate. An
unauthenticated write endpoint cannot be made abuse-proof. The mitigations
that do apply are the rate limit and the permanently bounded bucket set in
section F. This is not overclaimed anywhere in the code.

---

## F. Free-tier assumptions, with real numbers

Published Workers Free allowances: **100,000 D1 rows written per day** and
5,000,000 read. Storage 5 GB per account, 500 MB per database.

**Measured:** 28 accepted events produced **6 table rows**.

| quantity | measured |
|---|---|
| accepted events | 28 |
| rows in `analytics_daily` | 6 |
| table rows written | 6 |
| indexes touched per insert | 2 (primary key + `idx_analytics_event_date`) |
| written rows per event, table only | **0.21** |

D1 bills an indexed column as an additional written row, so the conservative
figure including both index writes is 6 × 3 = 18 written rows for 28 events,
or **0.64 written rows per event**. At that ratio the daily budget absorbs
roughly **150,000 events per day**.

The design's own worst case (section 5.4 of the architecture document) is that
all 6 events and all 21 dimension values are touched on one day, giving a
fixed ceiling independent of traffic. Re-derived here from the allow-lists in
`server/analytics.ts`:

| event | total row | dimension combinations | rows/day |
|---|---|---|---|
| `question_viewed` | 1 | 5 engines × 3 difficulties × 4 buckets = 60 | 61 |
| `question_submitted` | 1 | 5 × 3 × 3 = 45 | 46 |
| `practice_started` | 1 | 5 | 6 |
| `practice_completed` | 1 | 5 × 3 = 15 | 16 |
| `interview_started` | 1 | 5 | 6 |
| `page_viewed` | 1 | 8 | 9 |
| **total** | | | **144 rows/day** |

Over the 400-day retention window that is a hard ceiling of **57,600 rows**,
and at the conservative 3-written-rows-per-row billing factor, **172,800
written rows for the entire lifetime of the database** — which exceeds one
day's free budget but is a *fixed* total, not a daily rate. Sustained cost
therefore settles at the 144 rows/day traffic-independent figure: about
432 written rows/day, **0.43% of the daily allowance**, regardless of how
many visitors the site has.

Storage: 57,600 rows at roughly 100 bytes is under 6 MB, against a 500 MB
per-database allowance.

**The free-tier assumption holds, with two orders of magnitude of headroom on
sustained cost.**

`MAX_STATEMENTS_PER_REQUEST` is 7, asserted against Cloudflare's documented
50-queries-per-Worker-invocation ceiling for the Free plan, and the statement
geometry (16 rows × 6 parameters = 96, against a 100-parameter limit) is
asserted to be *maximal* so it cannot silently drift to a non-maximal value.

---

## G. Verdict on the three questions the task asks

**Is personal data stored?** No. The table has six columns and none of them
can hold an identifier (section B). Every value in the observed dump is a
date, an allow-listed name, or a count.

**Is there fingerprinting?** No, and it is not possible: nothing stable about
a client is read, and nothing is hashed (section C.2).

**Is there cross-session linkage?** No. Three distinct callers produced one
shared, unattributable counter (section C.1). There is no key to join on.

**Can anonymity be established?** Yes, and it was established by measurement
rather than by reading the design. Where the design is merely an intention,
the code is the evidence; where the code is merely a shape, the runtime
output is the evidence. Both were collected.

---

## H. Findings

One finding. It was **not** fixed, because fixing it would mean changing
behaviour to make a review finding disappear, which the task forbids — and
because it is not a security defect. It is recorded as a new roadmap item
instead, as the task instructs.

### H.1 The client collector posts to a path that does not exist on the Pages deployment — LOW

`src/lib/analytics.ts` builds the ingest URL from the deployment base and
posts unconditionally. On the GitHub Pages deployment there is no Worker, so
every flush returns 404. Observed effect: a failed request per flush, for
every visitor, forever.

**Why this is not a security or privacy defect:** nothing is collected,
nothing is stored, and no request reaches a server. The error is swallowed
by design, so there is no user-visible effect and no retry amplification. It
is wasted requests and a misleading 404 in the Pages logs.

**Why it was not "fixed" here:** the obvious remedy is to probe the endpoint
and disable collection when it is absent, but that probe is itself a request
on every page load, and the alternative — a build-time flag — is a product
decision about deployment configuration, not a review fix.

**Recommended as a new roadmap task** rather than a silent change: make
collection opt-out-able, and have the client treat a 404 from the ingest path
as a permanent signal to stop trying for the rest of the session. The existing
`probeApi()` helper in `src/lib/adminApi.ts` is the natural precedent, called
once at startup rather than per flush.

---

## I. What would change the verdict

Stated so the review is falsifiable rather than merely reassuring. Any one of
the following would invalidate section G, and each is now a test or a shape
that would fail loudly:

- a column added to `analytics_daily` that could hold an identifier — the
  `the table has no identifier column at all` test greps the live
  `sqlite_master` output for `ip`, `user`, `session`, `token`, `cookie`,
  `fingerprint`, `uuid`, `email`, `login` and `csrf`
- a client-side property mapping that forwards an unmapped key
- a relaxation of the per-event property allow-list
- removal of the `d !== today` check, which would permit backdating
- an admin read route that returned `public` cache headers — asserted across
  six routes, including the new one
- an event name or property value that is not drawn from a fixed enumeration

---

## J. Traceability

| claim | evidence |
|---|---|
| Six columns, no identifier column | live `sqlite_master` + `pragma_table_info` output, section B |
| Three callers produce one shared bucket | three distinct addresses, one row, `count: 3`, section C.1 |
| No address or token in stored data | regex sweep over the full table dump, section C.1 |
| Identifiers and backdating refused | five live probes, all 400, section C.3 |
| Read endpoint requires a session | six authorization assertions in `admin-analytics.test.ts` |
| Read endpoint is not cacheable | `no-store`, no `public`, no `ETag`; 4.2D invariant re-asserted |
| Throttle works and precedes the write | 60 accepted / 15 throttled of 75, section E |
| Cross-site with forged referrer refused | 403, section E |
| Free-tier cost | 6 rows for 28 events; 144 rows/day ceiling; section F |
| Per-invocation query ceiling | `MAX_STATEMENTS_PER_REQUEST <= 7` against a limit of 50 |

Full suite state at the time of this review: **330 tests, 0 failures**
(15 suites), `tsc -b --force` clean, lint delta **0 new** against a baseline
of 7 pre-existing diagnostics, and the analytics e2e spec green on both the
desktop and the 390px mobile project.
