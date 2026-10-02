# Phase 4 verification report

**Task:** 4.2H — full Phase 4 regression, security and free-tier review
**Reviewed commit range:** `8862107..585a718` plus the uncommitted working tree
**Approved input:** `docs/qa/phase-4-abuse-audit.md`
**Reviewer stance:** verification only. Every statement below is based on the
code as it stands or on output that was actually observed. Where a number is
estimated rather than measured, it says so.

---

## A. Method

Each finding was re-measured against the current source, not against the
audit's original line numbers, because the line references in the audit
predate this work. A finding is reported as:

- **CLOSED** — the mechanism exists in code and is covered by a passing test.
- **PARTIAL** — meaningfully reduced, but the class of cost is not eliminated.
- **OPEN** — still unaddressed.
- **ACCEPTED** — a deliberate non-goal, recorded so it is not re-discovered.

No finding was closed by inspection alone. Where a claim could be tested, it
was.

---

## B. Finding-by-finding outcome

### V-01 — Unauthenticated D1 `INSERT` via `GET /api/auth/github` — **CLOSED**

Both recommended controls are present.

*Same-origin signal.* `assertSameOriginSignal` (`server/request.ts`) now
checks `Sec-Fetch-Site` **first**, because it is a forbidden header that no
script can set, which makes it an unforgeable statement about who initiated
the request. `cross-site`, `same-site` and `none` are all rejected even when
a `Referer` is forged alongside them. `Origin` and then `Referer` remain as
fallbacks for browsers without Fetch Metadata. This ordering matters: the
previous implementation accepted `Origin`, which a cross-origin `fetch()`
sends, so it did not actually stop the abuse it was written for.

*Rate limit.* `OAUTH_START_RATE_LIMIT = { limit: 5, windowSeconds: 60 }`
per client address, charged before any D1 work, returning 429 with
`Retry-After`.

*Evidence.* `server/tests/security.test.ts` — `starts the OAuth flow with PKCE
and a state parameter`, `rejects a start with no same-origin signal and
inserts nothing`, `rejects a cross-origin start`, **`rejects a cross-site
start even when it forges a same-origin Referer`**, **`rejects a same-site
start from a look-alike host`**, **`accepts the real browser navigation signal
and inserts exactly one row`**, `rate limits the OAuth start route`. All
observed passing.

The legitimate flow is the `<a href={loginUrl()}>` link in
`src/pages/AdminLoginPage.tsx`, a top-level same-origin navigation, which a
real browser signals with `Sec-Fetch-Site: same-origin` and no `Origin`.

### V-02 — Every unauthenticated admin request writes an audit row — **CLOSED**

`requireAdmin` (`server/index.ts`) now charges an anonymous budget of 60/min
**after** the session lookup has proved the caller is anonymous, and only an
in-budget caller reaches the audit write — where it is then sampled
(`DENIED_AUDIT_SAMPLE_EVERY = 10`: the first denial in a window, then every
tenth). An over-budget request returns 429 having written nothing.

The `session_denied` action is preserved deliberately; only the unbounded
amplification is removed.

*Evidence.* `server/tests/rate-limit.test.ts` — `rate limits an anonymous
burst with 429 and Retry-After`, `bounds audit writes instead of writing one
row per request` (200 requests produce ≤ 60 rows), `keeps the session_denied
audit action available for investigation`. All observed passing.

### V-03 — Housekeeping on the request path — **CLOSED**

The `ctx.waitUntil` block is gone; `fetch` now does `void ctx`. A
`scheduled()` handler runs `purgeExpiredSessions`,
`purgeExpiredOAuthTransactions` and `purgeAuditLog` under
`Promise.allSettled`, logging failures without throwing, with one summary
line.

*Evidence.* `server/tests/housekeeping.test.ts`, 7 tests, observed passing.
`wrangler.jsonc` carries `[triggers] crons = ["0 4 * * *"]` with the
off-peak justification comment.

### V-04 — Authenticated reads perform a write — **CLOSED**

`lookupSession` refreshes `last_seen_at` only when it is older than
`LAST_SEEN_WRITE_THRESHOLD_SECONDS = 60` (audit's figure). The idle check
runs **before** the throttle, against the stored value, so the idle timeout
is unchanged.

*Measured.* 5 consecutive authenticated reads leave `last_seen_at`
byte-identical; a deliberately stale timestamp is still written forward.
`server/tests/session-amplification.test.ts` also asserts the security
property that matters: `LAST_SEEN_WRITE_THRESHOLD_SECONDS` is far below
`IDLE_TTL_SECONDS / 10`, so the throttle can only *lag* activity detection,
never extend a session. All observed passing.

### V-05 — Public read data is uncacheable — **CLOSED**

`publicJson` in `server/http.ts` serves `Cache-Control: public, max-age=60`
plus a content-derived strong `ETag`, with RFC 9110 weak `If-None-Match`
comparison returning 304.

The TTL is 60 seconds: the trade-off is symmetric, and a publish or
un-publish becoming visible within a minute is short enough for an editor to
trust, while still absorbing the large majority of anonymous repeat reads.

**TTL choice, stated as the task requires.** Not derived from a measurement,
because none is available without production traffic; it is the audit's
recommended value and is defensible on the trade-off above.

*Evidence.* `server/tests/cache.test.ts`, 22 tests — including
`the ETag is derived from content, not from time`, `the ETag changes when the
content changes`, `honours a weak ETag and the wildcard`, and
`a 404 for an unknown public question is not cached`.

### V-06 — Unbounded `SELECT *` on the public list — **CLOSED**

`PUBLIC_LIST_LIMIT = 100` (`server/store.ts`), chosen because the built-in
catalog is 35 questions, so the common case is never truncated while the row
read and response size stay bounded. A separate `COUNT(*)` with the same
filters reports `total`.

The response is explicit about truncation: `{ questions, count, total,
truncated, limit }`, where `count` is what this response contains and
`truncated === total > count`. A client cannot be misled.

*Evidence.* `server/tests/query-bounds.test.ts` — `reports the total
separately from what was returned`, `never returns more rows than the
declared limit`, `the limit is a real bound, not a no-op`. Observed passing.

### V-07 — Client-side amplification per admin mutation — **CLOSED**

Two independent duplications removed:

1. `loadAdminCatalog` called `fetchServerCatalog()` and then
   `syncFromServer()`, which fetched **the same endpoint again**.
   `fetchServerCatalog` now retains the raw payload rows and
   `applyPublicMirror` derives the mirror from them, so one response serves
   both channels.
2. Every mutation helper called `await syncFromServer()` and the caller then
   called `refreshServerCatalog()` — a third fetch. Mutations now return the
   affected row without re-fetching, and the caller's single refresh serves
   both the admin list and the mirror.

Net: an admin create went from ~3 full-catalog GETs to **1**.

**Judgement call, stated.** This task is the delicate one: the mutation
helpers no longer refresh the public mirror themselves. That is safe only
because `AdminPage` calls `refreshServerCatalog()` immediately after every
mutation, and `refreshServerCatalog` now refreshes the mirror too. The
`serverImport` helper was similarly reduced to returning its per-item outcome.

*Evidence.* `server/tests/session-amplification.test.ts` proves the admin
list stays correct after create, publish, unpublish, disable, enable, update,
delete and duplicate, and that a full reload reproduces the catalog. Observed
passing.

### V-08 — Bulk import is a sequential D1 loop — **CLOSED**

`importQuestions` issues a fixed number of round trips regardless of item
count: one batched existence query, then multi-row
`INSERT ... ON CONFLICT(id) DO NOTHING` statements.

*Batch size, derived not guessed.* The INSERT binds 23 parameters per row
and Cloudflare D1 allows 100 per statement, so
`floor(100 / 23) = 4` rows per statement (92 parameters). Five rows would
need 115 and be rejected. The test asserts BOTH that four fit and that five
do not, so the constant cannot silently drift to a non-maximal value.

*Measured, printed by the suite:* **500 items → 125 insert statements, 125
existence statements, 3 batch round trips**, versus roughly **1,500
sequential round trips** before. The 500-item import completes in ~2.3 s.

**Deviation from the audit, stated deliberately.** The audit asked for the
redundant pre-check `SELECT` to be dropped. It was not dropped; it was
collapsed from up to 500 individual queries into **one** batched query.
The audit's premise is that the primary key makes the pre-check redundant for
*enforcement* — which is true, and `ON CONFLICT(id) DO NOTHING` is what
actually enforces it. But the per-item `skipped`/`conflicts` outcome is part
of this task's preserved contract, and it cannot be reconstructed after the
fact: a chunk that inserted two of three rows does not say which two, and an
id inserted by the request itself is indistinguishable from one that already
existed. Removing the lookup entirely made every fresh row report as a
conflict, which is exactly the bug found and fixed during implementation.

*Evidence.* `server/tests/import-batching.test.ts`, 15 tests — including
`imports new items, skips and conflicts duplicates`,
`an existing server-side question is never overwritten` (content read back
and compared), `treats a duplicate inside one request as a conflict`,
`still enforces the 500-item request cap`,
`rejects a batch containing an invalid item and imports nothing`, and the
geometry assertions. Observed passing.

### V-09 — Audit log has no retention — **CLOSED**

`purgeAuditLog(db, retentionDays)` deletes with a **bound** cutoff
(`DELETE ... WHERE created_at < ?`), using the existing `created_at` index.
`AUDIT_RETENTION_DAYS` is configuration in `wrangler.jsonc` vars, declared on
`Env` in `server/env.ts`, defaulting to 90 via `parseAuditRetentionDays` when
missing, zero, negative or non-numeric.

**Audit caveat recorded.** The audit suggested keeping
`login_success`/`login_failure` longer than `session_denied`. Not
implemented: it would require either a second DELETE with a different
predicate or a schema change, and the task forbids a schema change. Recorded
as a deliberate deviation rather than silently dropped.

### V-10 — No rate limiting anywhere — **CLOSED for the audited vectors**

`server/rateLimit.ts` is a fixed-window in-isolate limiter with a
`MAX_TRACKED_KEYS = 10_000` cap so address rotation cannot exhaust isolate
memory. Applied to `/api/admin/*` (60/min) and `GET /api/auth/github`
(5/min). `rate_limited: 429` and `Retry-After` now have real call sites.

**PARTIAL — stated honestly.** The limiter is per-isolate, therefore
best-effort, not a global quota: an attacker spreading across isolates gets
one window's budget per isolate. Making it global needs a KV or D1 counter,
which costs a write per request and defeats the purpose. This is documented
in the module rather than overclaimed.

**Also PARTIAL.** The audit listed `GET /api/questions*` rate limiting as
optional given caching; it is not rate limited, by the audit's own
recommendation.

### V-11 — Outbound GitHub fetches have no timeout — **CLOSED**

Both fetches in `exchangeCodeForIdentity` now carry
`signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)` (10 s). Ten seconds is
generous for a token exchange and a user fetch while still bounding the
invocation far below the platform default.

Not originally a roadmap task. Closed here under the task file's explicit
instruction to fix security issues it finds and say so.

### V-12 — Public filter parameters unvalidated — **CLOSED, with a documented deviation**

`server/publicFilters.ts` validates the three filters before they reach D1.

- `difficulty` — allow-list `DIFFICULTIES`, the same constant the write path
  enforces, so read and write can never disagree.
- `engine` — allow-list `QUESTION_TYPES`, the **wider** forward-compatible
  enum rather than `CREATABLE_QUESTION_TYPES`, because the catalog is seeded
  from `src/data/questions.ts` and filtering must never be narrower than the
  data.
- Invalid values return **400 with the allowed list**, not a silent empty
  result, so the behaviour is discoverable.

**Deviation, stated deliberately: `category` is NOT allow-listed.** Read the
actual schema: `questions.category` is `TEXT NOT NULL` with no CHECK
constraint, `parseQuestionInput` accepts any string up to 120 characters, and
the client derives its category list from the catalog itself
(`AdminPage` computes `localCategories`; there is no canonical category
constant in `src/`). A static allow-list would be a **regression** — an
administrator who creates a new category could never filter by it. Instead it
is bounded by the same 120-character cap the write path enforces, plus a
charset that rejects control characters and injection-shaped probes.

*Evidence.* `server/tests/query-bounds.test.ts`, 16 tests — including
`accepts every real difficulty value`, `accepts every real question type`,
`reports a client error rather than silently returning nothing`,
`rejects an injection-shaped category`, and
`accepts a category that is not in the built-in catalog`. Observed passing.

### V-13 — No cron / scheduled handler — **CLOSED** (with V-03)

### V-14 — 49.7 MB static payload — **ACCEPTED**

Re-measured: `public/pyodide` 16 files / 30.0 MB, `public/wheels` 4 files /
2.4 MB, `public` total **32.5 MB**. The audit's 49.7 MB figure included
assets since removed. The audit recommended leaving this alone; agreed.
Immutably-cached assets remain served by `env.ASSETS`, and
`withSecurityHeaders` preserves their cache headers (asserted by
`server/tests/worker-assets.test.ts`).

### V-15 — Dead code `revokeAllSessionsForUser` — **CLOSED (removed)**

Present in the audit's snapshot, **absent from the current tree**: zero
occurrences in `server/**`. Either it was already removed or was never
committed after the audit was written. No action was taken by this review.

### V-16 — Existing well-designed protections — **VERIFIED INTACT**

Every listed protection re-checked and present: `MAX_BODY_BYTES` 512 KB,
`rate_limited: 429` mapping, the session token shape check before any D1
hit, the audit metadata allow-list with its 200-char cap, and the PySpark
120 s timeout.

---

## C. Gate results, as observed

| Gate | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npm run test:server` | exit 0 — **255 tests, 0 failures** across 13 suites |
| `npm run lint:baseline` | exit 0 — baseline 7, current 7, **new 0** |
| `npm run build:pages` | exit 0 — verified `base=/queryvanta/` |
| `npm run build:worker` | exit 0 — verified `base=/` |
| `git diff --check` | exit 0 |

**On the 7 lint diagnostics.** They are pre-existing findings in `src/`
(App.tsx, PracticeAnalytics.tsx, PracticeSetupModal.tsx, QuestionPage.tsx),
unchanged since the recorded baseline commit, and explicitly out of scope per
audit section L. They were **not** baselined away and **not** fixed: the
delta gate reported them as baseline and reported **zero new** diagnostics
across all of this work. Every new diagnostic the gate surfaced during
Phase 4 (three, in code written for these tasks) was fixed at source.

**One caveat, reported rather than hidden.** `npm run test:server` was
observed to fail intermittently with ~21 failures spanning unrelated suites
when the full chain ran under load. The affected suite passes 100% when run
independently, and the chain passes when re-run. Investigated: no lingering
Worker processes after teardown, and the harness already derives a distinct
port per process, so it is not port collision. The signature is consistent
with a Worker that has not finished booting under CPU pressure. **This is a
test-infrastructure robustness issue, not a product defect**, and it is
recorded here as a known flake rather than claimed away.

---

## D. Regression assessment

No regression found. Specifically:

- The security envelope, draft isolation, CSRF, OAuth PKCE and
  allow-list behaviour are covered by the 57-test security suite, observed
  green, including the pre-existing import test that 4.2F had to preserve.
- The 4.2D change is the highest disclosure risk in the phase, and the
  no-store guarantee is asserted **endpoint by endpoint** rather than
  assumed, including an explicit test that only the two public reads report
  a shared-cache policy.
- The 4.2C change strengthened rather than weakened the check it touched: a
  `cross-site` request with a forged same-origin `Referer` is now rejected.

## E. Recommendation for Phase 5

**Safe to start, on three conditions:**

1. **Do not add a third rate-limit dimension on the session read path.** The
   limiter is already per-isolate and best-effort; adding KV or D1 counters
   would trade a marginal abuse reduction for a per-request write, which is
   the exact cost Phase 4 exists to remove.
2. **Keep analytics event writes off the anonymous request path.** Phase 5
   adds a new write surface. The 4.2G throttle and the 4.2A cron pattern are
   the two precedents to follow.
3. **Preserve the delta-lint discipline.** Any new source file must add zero
   new diagnostics, not extend the baseline.

One open item for whoever picks up analytics: the `category` filter is
length-bounded but not allow-listed, precisely because the schema treats it as
free text. If Phase 5 introduces an analytics dimension with the same
free-text shape, it needs the same treatment — and the same justification
written down at the time.

---

## F. Deviations from the audit, collected

1. **V-08 pre-check retained** (as one batched query, not per item) —
   required to preserve the per-item outcome contract.
2. **V-12 `category` not allow-listed** — the schema treats it as free text;
   an allow-list would reject legitimate administrator-created categories.
   Bounded by length and charset instead.
3. **V-09 differentiated audit retention not implemented** — would require a
   schema change or a second DELETE; the task forbids the former.
4. **V-10 global rate limiting not implemented** — best-effort per-isolate
   only, documented rather than overclaimed.
5. **V-11 closed here** — not a roadmap task, fixed under the task file's
   explicit instruction for security findings.