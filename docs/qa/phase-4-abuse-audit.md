# Phase 4 — Step 1: Abuse & Free-Tier Audit (Read-Only)

**Scope:** repository at `main` / `2cf3d57 Add deterministic build targets`.
**Mode:** read-only. No Cloudflare configuration, D1 schema, secret, package or
source file was modified. No deployment.
**Goal:** identify every meaningful abuse and cost vector so the project can
stay on a $0/month free tier.
**Production probes:** read-only `GET` requests only, limited to endpoints that
do not mutate. `GET /api/auth/github` was deliberately **not** called, because
it performs a D1 `INSERT` (see V-01).

**Notation:** "CONFIRMED" means the behaviour was read directly from the code at
the cited path, or observed in a read-only production response. "RECOMMENDATION"
is advice, not observed behaviour. Nothing in this report is inferred from
assumed behaviour.

---

## A. Executive summary

QueryVanta's Cloudflare surface is small — nine API routes plus a static asset
serving path — and its **security** posture is strong: every admin route
independently re-verifies a hashed server-side session, mutations are
double-submit CSRF protected and exact-origin checked, all SQL is parameterised,
and the public/draft boundary is enforced inside SQL rather than in the row
mapper. Fifty automated security tests cover that.

The **cost** posture is the opposite. The design has a consistent pattern that
this audit names the **write-on-read / unauthenticated-write** pattern:

> A request that a client perceives as a *read* performs D1 **writes**, and
> several of those reads are reachable **without authentication**.

Four specific instances are CONFIRMED in the current code:

1. `GET /api/auth/github` performs an unauthenticated D1 `INSERT` and is **not**
   origin-checked, because `assertSameOrigin()` returns early for `GET`
   (`server/request.ts:87-89`). Repeated calls grow `oauth_transactions` without
   bound. (V-01)
2. Every unauthenticated request to any admin route writes an `admin_audit_log`
   row via `requireAdmin()` (`server/index.ts:159-167`). There is no rate limit,
   no sampling and no de-duplication. (V-02)
3. `GET /api/auth/session` triggers two D1 `DELETE` statements on every call
   through `ctx.waitUntil()` (`server/index.ts:972-982`), plus one `SELECT` in
   `lookupSession()`. Unauthenticated and trivially repeatable. (V-03)
4. `lookupSession()` performs an `UPDATE admin_sessions SET last_seen_at` on
   **every successful session read** (`server/session.ts:222-230`), so an
   authenticated read is also a write. (V-04)

Net effect: an unauthenticated attacker can convert Worker invocations into D1
writes at a ratio of up to **3 D1 operations per HTTP request** with no
throttle of any kind, because the `rate_limited` / HTTP 429 machinery already
exists in the codebase (`server/http.ts:31,44`) but is **never invoked**.

The largest single-request cost amplifier is the bulk import path:
`importQuestions()` (`server/store.ts:555-591`) runs a **sequential** loop of up
to 500 iterations, each performing its own existence `SELECT` plus a redundant
second `SELECT` inside `createQuestion()` plus an `INSERT` — up to **~1,500
sequential D1 round trips in one HTTP request**. (V-08)

A major and counter-intitive positive finding: **PySpark and SQL execution
consume no Cloudflare compute at all.** There is no Spark, Envoy, or execution
route in `server/index.ts`; Pyodide/PGlite run in the browser. PySpark's only
Cloudflare cost is static-asset egress — `dist/` is **49.7 MB**, of which
~32.4 MB is `public/pyodide` and `public/wheels`. (Section E.)

**Overall: the application is safe to expose, and is at material risk of being
made expensive.** The fix set is small, additive, and mostly does not touch the
security model. Recommended order is in Section K.

---

## B. Architecture / request-flow map

```
Browser
  |
  |-- GET /  /assets/*  /pyodide/*  /wheels/*      ~49.7 MB total payload
  |     └─> env.ASSETS.fetch(request)               (static; not billed as Worker CPU)
  |         └─ withSecurityHeaders()  (server/index.ts:958)
  |
  |-- GET /api/questions            [PUBLIC, no auth] ---> D1 SELECT *  (no LIMIT)
  |-- GET /api/questions/:id        [PUBLIC, no auth] ---> D1 SELECT by PK
  |-- GET /api/health               [PUBLIC, no auth] ---> no D1
  |
  |-- GET /api/auth/session         [PUBLIC, no auth] ---> D1 SELECT (lookupSession)
  |                                                          D1 UPDATE (last_seen_at)   *** write
  |                                                          D1 DELETE x2 (waitUntil)   *** writes
  |-- GET /api/auth/github          [PUBLIC, no auth] ---> D1 INSERT  *** write
  |        (assertSameOrigin is a NO-OP for GET)
  |-- GET /api/auth/github/callback [PUBLIC, no auth] ---> D1 UPDATE (consume txn)
  |        |                                     --> outbound fetch() x2 to github.com
  |        |                                         (NO timeout / AbortSignal)
  |        +-- on success: D1 INSERT (session) + D1 INSERT (audit)
  |-- POST /api/auth/logout         [session]        ---> D1 UPDATE + D1 INSERT (audit)
  |
  |-- /api/admin/questions          [SESSION]        ---> D1 SELECT *  (no LIMIT)
  |     GET  / POST(bulk<=500) / PUT / DELETE
  |-- /api/admin/questions/:id/{duplicate,publish,unpublish,disable,enable,restore}
  |                                    [SESSION+CSRF]  ---> D1 UPDATE + D1 INSERT (audit)
  |-- /api/admin/audit               [SESSION]        ---> D1 SELECT ... LIMIT <=200
  |
  |   requireAdmin() failure ---> D1 INSERT admin_audit_log  *** unauthenticated write
  |
  +-- SQL execution  : PGlite, in-browser, PGlite.create("memory://")   [no Cloudflare cost]
  +-- PySpark exec    : browser Worker -> Pyodide -> pyspark-connect-web
                        -> localhost:8081 Envoy -> local Spark Connect   [no Cloudflare cost]
```

D1 tables (`migrations/0001_init.sql`): `questions` (6 indexes),
`admin_sessions` (3), `oauth_transactions` (1), `admin_audit_log` (4).

---

## C. Endpoint inventory

| # | Method | Path | Auth | CSRF/Origin | D1 read | D1 write | Cache header |
|---|--------|------|------|-------------|---------|----------|--------------|
| 1 | GET | `/api/health` | none | n/a | — | — | `no-store` |
| 2 | GET | `/api/auth/session` | none | n/a | `lookupSession` SELECT | **UPDATE** `last_seen_at`; **DELETE** ×2 (`waitUntil`) | `no-store` |
| 3 | GET | `/api/auth/github` | none | **none (GET bypass)** | — | **INSERT** `oauth_transactions` | `no-store` (302) |
| 4 | GET | `/api/auth/github/callback` | state | n/a | UPDATE/SELECT txn | UPDATE txn; INSERT session; INSERT audit | `no-store` (302) |
| 5 | POST | `/api/auth/logout` | session | both | `lookupSession` | UPDATE session; INSERT audit | `no-store` |
| 6 | GET | `/api/questions` | none | n/a | `SELECT *` **no LIMIT** | — | `no-store` |
| 7 | GET | `/api/questions/:id` | none | n/a | `SELECT` by PK | — | `no-store` |
| 8 | GET | `/api/admin/questions` | session | n/a | `SELECT *` **no LIMIT** | — | `no-store` |
| 9 | POST | `/api/admin/questions` | session | both | — | INSERT (+500 max import) | `no-store` |
| 10 | PUT | `/api/admin/questions/:id` | session | both | — | UPDATE | `no-store` |
| 11 | DELETE | `/api/admin/questions/:id` | session | both | — | UPDATE (soft) | `no-store` |
| 12 | POST | `/api/admin/questions/:id/:action` | session | both | `getAdminQuestion` | UPDATE + INSERT audit | `no-store` |
| 13 | GET | `/api/admin/questions/:id` | session | n/a | `SELECT` by PK | **UPDATE** `last_seen_at` | `no-store` |
| 14 | GET | `/api/admin/audit` | session | n/a | `SELECT` LIMIT ≤200 | **UPDATE** `last_seen_at` | `no-store` |
| 15 | GET/HEAD | any other path | none | n/a | — | — | asset headers preserved |
| 16 | other | `/api/*` unknown | none | n/a | — | — | `no-store` |

**Any request to an `/api/admin/*` route that fails `requireAdmin()` performs a
D1 `INSERT` (row 8–14 all funnel through `server/index.ts:149-185`).**

---

## D. Abuse / cost vector table

| ID | Vector | Affected path | Current protection | Potential impact | Severity | Recommended mitigation |
|----|--------|---------------|--------------------|------------------|----------|------------------------|
| V-01 | Unauthenticated D1 `INSERT` via a `GET`; origin check is a no-op for GET | `GET /api/auth/github` — `server/index.ts:227-239`; `assertSameOrigin` early-return `server/request.ts:83-89` | none | Unbounded `oauth_transactions` growth; D1 row-write quota consumed by any party; storage growth | **High** | Require a valid same-origin signal for this route specifically (do not rely on the mutation-only origin check); add per-IP rate limit; consider a WAF rule |
| V-02 | Every unauthenticated admin request writes an audit row | `requireAdmin()` — `server/index.ts:159-167` → `recordAudit` `server/audit.ts:86-103` | none | 1 D1 write per anonymous request to any admin route; write-amplification is the most expensive form of D1 usage | **High** | Sample/throttle `session_denied` (e.g. aggregate per IP per window, or drop repeats); rate limit the route family first |
| V-03 | Unauthenticated `GET` triggers 2 D1 `DELETE`s per call | `server/index.ts:972-982` (`ctx.waitUntil`) + `purgeExpiredSessions` `server/session.ts:282-296`, `purgeExpiredOAuthTransactions` `server/oauth.ts:383` | none | ~3 D1 ops per request; unbounded repeat cost; DELETEs also take write locks on the tables | **High** | Move housekeeping to a cron `scheduled` handler (Worker free tier supports cron triggers); remove from the request path entirely |
| V-04 | Authenticated reads perform a write | `lookupSession()` `server/session.ts:222-230` | none | Session poll by the admin SPA converts reads into writes; write volume scales with admin usage | **Medium-High** | Only update `last_seen_at` when older than a threshold (e.g. 60s), or fold it into a periodic sweep |
| V-05 | Public read-mostly data is explicitly uncacheable | `server/http.ts:64` sets `Cache-Control: no-store` on every JSON response; applied at `server/index.ts:416,439` | none (deliberate) | 100% of public catalog traffic hits D1; no edge absorption | **Medium-High** | Serve `/api/questions*` with `Cache-Control: public, max-age=…` + `ETag`; keep `no-store` on every `/api/admin/*` and `/api/auth/*` response |
| V-06 | Unbounded `SELECT *` on the public list | `listPublicQuestions` `server/store.ts:180-190`; `listAdminQuestions` `server/store.ts:216-225` | none | Response size and D1 row-reads grow linearly with catalog; amplification for free | **Medium** | Add a `LIMIT` (and consider a total count) to the public list; index already supports ordering |
| V-07 | Client-side request amplification on every admin mutation | `loadAdminCatalog` `src/lib/adminServerSync.ts:213,226`; `serverCreate`→`syncFromServer` `:278`; then `refreshServerCatalog` in `src/pages/AdminPage.tsx` | none | One admin create costs ~3–4 identical full-catalog GETs | **Medium** | Return the updated row from mutations and patch local state; fetch the catalog once per operation, not three times |
| V-08 | Bulk import is a sequential D1 loop | `importQuestions` `server/store.ts:555-591` + `createQuestion` `server/store.ts:257-264` | request capped at 500 items, body capped 512 KB (`server/request.ts:35,486-491`) | up to ~1,500 **sequential** D1 round trips in one request; likely to hit invocation wall-clock limits; high one-shot write cost | **Medium** | Batch into a single multi-row `INSERT`; drop the redundant pre-check `SELECT` (the unique PK already enforces the invariant) |
| V-09 | Audit log has no retention policy | `migrations/0001_init.sql:145-164`; purge helpers cover only sessions and OAuth txns | indexes on `created_at`, `actor`, `question`, `action` keep reads cheap | Table grows without bound; combined with V-02 this is the dominant storage cost | **Medium** | Add a retention window (e.g. 90 days) to a scheduled purge; keep `login_success`/`login_failure` longer than `session_denied` |
| V-10 | No rate limiting anywhere; 429 code exists but is unused | `server/http.ts:31` (`"rate_limited"`), `:44` (`rate_limited: 429`) — zero call sites | none | All of the above are unthrottled | **Medium** | Add a rate-limit helper and apply to V-01/V-02 first; the error plumbing is already present |
| V-11 | Outbound GitHub fetches have no timeout | `exchangeCodeForIdentity` `server/oauth.ts:286-334` (two `fetch` calls) | gated by a valid single-use `state` (so not directly triggerable anonymously) | A slow or hanging GitHub holds the invocation open for the platform default | **Low-Medium** | Add `AbortSignal.timeout(...)` to both fetches |
| V-12 | Public filter parameters unvalidated and unbounded in length | `server/index.ts:407-411` → `server/store.ts:153-178` | parameterised (no injection — CONFIRMED: `?engine=<script>` returns HTTP 200, 0 rows) | Arbitrary strings sent to D1 as bound values; always miss; minor CPU waste | **Low** | Allow-list the three filter values and cap length |
| V-13 | No cron / `scheduled` handler | verified: zero occurrences of `scheduled`/`cron` in `server/**` | n/a | Housekeeping only ever runs opportunistically on `/api/auth/session` (V-03) | **Low** | Add a `[triggers] crons` entry and a `scheduled()` export |
| V-14 | 49.7 MB static payload, ~32.4 MB of it Pyodide/wheels | `public/pyodide` (30.0 MB, 16 files), `public/wheels` (2.4 MB, 4 files) | immutable asset caching is preserved by `withSecurityHeaders` (`server/index.ts:90-98`) | Each PySpark boot pulls tens of MB of Worker bandwidth and invocations | **Low** | Leave as-is but monitor; consider hosting the heavy wheels on an external CDN/R2 if PySpark traffic grows |
| V-15 | Dead code: `revokeAllSessionsForUser` | `server/session.ts:266-280`; no call site in `server/**` | n/a | none | **Info** | Remove or wire up; a "log out everywhere" capability is worth having |
| V-16 | Well-designed protections already present (documented so they are not "regressed") | `MAX_BODY_BYTES` 512 KB `server/request.ts:35`; import cap 500 `server/index.ts:486-491`; `listAudit` limit clamp ≤200 `server/audit.ts:132-135`; session token shape check before any D1 hit `server/session.ts:168-171`; audit metadata allow-list + 200-char cap `server/audit.ts:30-72`; PySpark 120 s timeout + worker teardown `src/lib/pysparkClient.ts:16,342-352,355-386` | — | — | — |

---

## E. PySpark-specific resource risks

**CONFIRMED: PySpark consumes no Cloudflare compute.** `server/index.ts`
contains no Spark, Envoy, gRPC or `/pyspark` route (verified by search). The
execution chain is entirely client-side:

```
src/pages/QuestionPage.tsx
  -> src/lib/pysparkClient.ts  (new Worker(WORKER_URL), pysparkClient.ts:255)
     -> public/worker/pyspark-test-worker.js  (module worker; URLs from self.location)
        -> Pyodide (WASM) + pyspark-connect-web
           -> localhost:8081  Envoy grpc-web proxy  (local docker/ stack)
              -> Spark Connect
```

Consequences for the free tier:

| Resource | Consumed? | Notes |
|----------|-----------|-------|
| Worker CPU time | **No** | No execution route exists in the Worker |
| D1 rows | **No** | Zero D1 involvement |
| Worker invocations | **Yes, indirectly** | Only the static asset requests that boot the stack |
| Bandwidth | **Yes — dominant** | ~32.4 MB per full PySpark boot (pyodide 30.0 MB + wheels 2.4 MB) |

Largest individual assets, all served by the Worker:

```
 9.6 MB  public/pyodide/pyarrow-22.0.0-cp313-cp313-pyodide_2025_0_wasm32.whl
 8.2 MB  public/pyodide/pyodide.asm.wasm
 4.3 MB  public/pyodide/pandas-2.3.3-cp313-cp313-pyodide_2025_0_wasm32.whl
 3.0 MB  public/pyodide/numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl
 2.3 MB  public/pyodide/python_stdlib.zip
 1.9 MB  public/wheels/pyspark_client-4.2.0-py2.py3-none-any.whl
```

Specific risks:

1. **Boot cost is per visitor, not per run.** A visitor who runs PySpark 1 time
   or 10 times pays the same ~32 MB, because the assets are cached by the
   browser. Re-running is *cheap*. This is a positive finding.
2. **`PYSPARK_RUN_TIMEOUT_MS = 120_000`** (`src/lib/pysparkClient.ts:16`) and
   `failPendingAndTeardown()` (`:342-352`) terminate the worker and reject all
   pending calls on timeout, so an abandoned run does not leak a live worker
   indefinitely. **No orphan-execution risk in the client.**
3. **No Cloudflare-side amplification exists** — an attacker cannot make the
   Worker execute Spark. The worst they can do is request the 49.7 MB of
   static assets, which Cloudflare serves from its edge cache and which is
   already the case for any large site.
4. The only PySpark-related *policy* gap is the same V-05 caching question:
   `withSecurityHeaders()` deliberately preserves existing asset cache headers
   (`server/index.ts:90-98`), so immutable hashed assets are cached correctly.
   This is correct as-is.

**Conclusion: PySpark is the lowest-risk item on the platform.** It is
misleading to assume it is expensive.

---

## F. D1-specific risks

| Table | Growth driver | Retention mechanism | Risk |
|-------|---------------|---------------------|------|
| `questions` | admin creates/imports (authenticated) | soft delete only; `deleted_at` set, row retained forever | Low. Import path is the burst risk (V-08). |
| `admin_sessions` | one row per successful login | `purgeExpiredSessions` — **only invoked from `/api/auth/session`** (V-03) | Medium. Grows if the admin never loads an admin page. |
| `oauth_transactions` | **one row per `GET /api/auth/github` (V-01) and per login** | `purgeExpiredOAuthTransactions` — same opportunistic trigger (V-03) | **High.** Anonymous, unthrottled, GET-triggered growth. |
| `admin_audit_log` | **one row per unauthenticated admin request (V-02)** + every admin action | **none** (V-09) | **High.** Fastest-growing table under abuse; no cap at all. |

Query-pattern notes:

- All statements are parameterised — no interpolation. No SQL injection vector.
- Public visibility is enforced in SQL via
  `PUBLIC_PREDICATE = "enabled = 1 AND published = 1 AND deleted_at IS NULL"`
  (`server/store.ts:139-140`), so a row-mapper bug cannot leak a draft.
- `idx_questions_public (published, enabled, deleted_at, updated_at DESC)`
  supports the unfiltered public list; the three filter columns each have a
  supporting index. Reads are well covered.
- `admin_audit_log` has **no index on `outcome`**, so any future
  "count failures" query would be a full scan. Not currently a problem, but it
  constrains future audit analytics.
- No `LIMIT` on either list query (V-06) — the only real read-cost issue.

---

## G. Caching opportunities

| Endpoint | Current | Recommendation | Why it is safe |
|----------|---------|----------------|----------------|
| `GET /api/questions` | `no-store` | `public, max-age=60` + `ETag`/`304` | Content is derived only from rows that are `published AND enabled AND not deleted`. A short TTL bounds staleness after publish. CDN/edge absorbs repeat traffic, removing D1 reads entirely. |
| `GET /api/questions/:id` | `no-store` | `public, max-age=60` + `ETag` | Same predicate; per-id caching is safe and questions are immutable once published (edits bump `version`/`updated_at`). |
| `GET` static assets | preserved | **no change** | Already correct; `withSecurityHeaders` intentionally does not clobber asset cache headers. |
| `GET /api/admin/**` | `no-store` | **MUST remain `no-store`** | Contains unpublished drafts and the audit log. Never publicly cacheable (Section H). |
| `GET /api/auth/session` | `no-store` | **MUST remain `no-store`** | Per-user identity + CSRF token in the body. A shared cache would leak one admin's CSRF token to another. |
| `POST` / `PUT` / `DELETE` anything | `no-store` | **MUST remain `no-store`** | Standard. |

Highest-value single change: **`Cache-Control: public` on the two public read
endpoints.** They currently have **no client consumer at all** — verified, no
source file calls `api/questions` — so they are pure anonymous cost surface that
is also 100% uncacheable.

---

## H. Rate-limiting opportunities

### Recommended

| Target | Why | Suggested shape |
|--------|-----|----------------|
| `GET /api/auth/github` | unauthenticated D1 write (V-01) | per-IP, e.g. 5/min; plus an explicit same-origin requirement |
| `/api/admin/*` as a family | unauthenticated audit write (V-02) | per-IP token bucket, e.g. 60/min, returning 429 |
| `GET /api/auth/session` | 3 D1 ops per call (V-03) | per-IP, e.g. 30/min; or remove housekeeping from the path and rely on cron |
| `POST` bulk import | ~1,500 sequential D1 ops (V-08) | per-session, e.g. 5/hour, independent of the 500-item cap |
| `GET /api/questions*` | anonymous read amplification (V-05/V-06) | optional; caching (Section G) is the better first lever |

Recommended implementation: a small `server/rateLimit.ts` using the existing
KV/D1 binding or an in-isolate `Map` (best-effort per isolate, which is
acceptable and free), returning the already-defined
`{ code: "rate_limited" }` → HTTP 429 (`server/http.ts:31,44`) and setting
`Retry-After`.

### NOT recommended

| Target | Why not |
|--------|---------|
| `GET /api/health` | trivial, no D1, used by the client's `probeApi()`; throttling risks false "backend unavailable" UI states |
| Static asset GETs | served by `env.ASSETS` from the edge cache; rate limiting them would only add Worker CPU |
| `GET /api/questions` **before** caching is added | caching is strictly better than throttling for read-mostly public data; do both eventually, caching first |
| Authenticated admin **reads** | single administrator; throttling self-inflicted failure has no security benefit |
| `/api/auth/github/callback` | gated by a single-use state; an attacker cannot reach the GitHub exchange leg without a valid transaction. A cheap rate limit is still fine, but it is not the primary control |

---

## I. Concurrency / timeout risks

| Risk | Status | Detail |
|------|--------|--------|
| Worker fetch has no explicit timeout | n/a | Cloudflare enforces platform limits; nothing to change |
| Outbound `fetch` to GitHub has no `AbortSignal` | **CONFIRMED gap** (V-11) | `server/oauth.ts:286,324` |
| Sequential 500-iteration D1 loop | **CONFIRMED** (V-08) | `server/store.ts:555-591`; wall-clock and write cost compound |
| Concurrent admin writes | **Protected** | Optimistic concurrency via `version`; `updateQuestion` returns `version_conflict` → HTTP 409. Tested: *"rejects a stale-version update instead of clobbering"* |
| Abandoned PySpark run leaks resources | **Protected** | 120 s timeout + `worker.terminate()` (`src/lib/pysparkClient.ts:342-352`) |
| Abandoned SQL execution leaks resources | Protected | PGlite is in-browser; tab close reclaims it |
| `listAdminQuestions` concurrent with a mutation | Benign | Reads are non-transactional snapshots; the client re-fetches after every mutation, so the admin UI self-heals |
| Duplicate mutations from the UI | Benign | `handleSubmit` is user-triggered, not in a loop. The `setInterval` in `QuestionPage.tsx:604` is an elapsed-time display; `PracticePage.tsx:201` is the interview countdown. **No accidental infinite execution loop found.** |
| Client request amplification | **CONFIRMED** (V-07) | Not a concurrency bug, but the largest self-inflicted cost multiplier |

---

## J. Free-tier protection recommendations

1. **Eliminate unauthenticated writes.** V-01, V-02 and V-03 together are the
   whole problem. Fixing them converts an anonymous attacker's requests from up
   to 3 D1 writes each into at most 1 D1 read.
2. **Move housekeeping to cron.** Add `[triggers] crons` and a `scheduled()`
   export to the Worker; delete the `finally` block at `server/index.ts:972-982`.
   This removes 2 writes from the hottest anonymous endpoint and gives
   retention a real home.
3. **Cache the public catalog.** `Cache-Control: public` on `/api/questions*`
   removes the anonymous read path from D1 for almost all repeat traffic.
4. **Add bounded retention for `admin_audit_log`.** Without it, V-02 turns into
   unbounded storage growth even after rate limiting.
5. **Reduce session write amplification.** Throttle `last_seen_at` updates
   (V-04) so admin polling stops producing a write per read.
6. **Batch the import.** A single multi-row `INSERT` replaces up to 1,500
   sequential round trips with 1–2 statements.
7. **De-duplicate client fetches.** Return the mutated row from the API and
   patch local state instead of re-fetching the full catalog three times.
8. **Document the free-tier assumptions.** CONFIRMED: the README contains **no**
   free-tier, quota, rate-limit or cost documentation (searched for
   "free tier", "quota", "limit", "100000", "rate limit", "budget", "cost" —
   no matches on point). A single short section stating the assumptions
   (invocations/day, D1 rows written/day, `dist` size, and which of them are
   self-imposed) would prevent an unsafe assumption becoming a surprise bill.

**Unsafe free-tier assumptions currently baked in (CONFIRMED):**

- That anonymous traffic will not be frequent enough to matter — true today
  only because the site is new, and false the moment it is linked.
- That D1 row-writes are effectively unlimited — V-01/V-02 contradict this.
- That `/api/questions` will be cheap — it is uncacheable *and* has no client
  consumer *and* has no `LIMIT`.
- That housekeeping will happen — it only happens if an admin loads a page.

---

## K. Recommended implementation order

Each step is independently valuable and independently testable. Steps 1–4 are
the free-tier protection; 5–7 are efficiency.

| # | Step | Addresses | Risk of doing it | Why this order |
|---|------|-----------|------------------|----------------|
| 1 | **Remove housekeeping from the request path**; add a cron `scheduled()` export that runs both purges + audit retention | V-03, V-09, V-13 | Low | Biggest single reduction in writes on the hottest anonymous route; nothing depends on it |
| 2 | **Throttle `session_denied` auditing** (aggregate/skip repeats) and **add a rate limit to `/api/admin/*`** and `GET /api/auth/github` | V-01, V-02, V-10 | Low | Removes the unauthenticated-write class entirely; 429 plumbing already exists |
| 3 | **Make `GET /api/auth/github` require a verifiable same-origin signal** (route-specific check, since `assertSameOrigin` is a no-op for GET) | V-01 | Low | Turns an anonymous write into an authenticated one |
| 4 | **Add `Cache-Control: public` + `ETag` to `GET /api/questions*`**, keeping `no-store` everywhere else | V-05 | Low | Removes the anonymous D1 read path; no client depends on the current behaviour |
| 5 | **Add `LIMIT` to `listPublicQuestions`** and an allow-list + length cap to the three public filters | V-06, V-12 | Low | Bounds worst-case response amplification |
| 6 | **Batch `importQuestions`** into a multi-row `INSERT`; drop the redundant pre-check | V-08 | Medium — changes import semantics (conflict reporting must be preserved exactly) | Biggest one-request cost win, but the only step touching write semantics |
| 7 | **Throttle `last_seen_at` updates** and **de-duplicate client catalog fetches** | V-04, V-07 | Low-Medium — client change needs browser re-verification | Self-inflicted cost; no attacker benefit from doing it early |

Steps 1–5 require **no client changes** and no schema change. Step 1's cron
trigger is a `wrangler.jsonc` edit; the `scheduled()` export and the audit
retention delete are additive. **No D1 schema change is required for any step** —
`admin_audit_log` already has `created_at` indexed, so a time-windowed
retention delete uses the existing index.

---

## L. Items explicitly NOT recommended

| Item | Reason |
|------|--------|
| Do **not** rate-limit `GET /api/health` | no D1 access; used by the client to detect backend presence. Throttling risks false negatives in the admin gate |
| Do **not** make any `/api/admin/*` or `/api/auth/*` response publicly cacheable | contains drafts, the audit log, identity and the CSRF token. A shared cache would be a cross-admin information leak |
| Do **not** add CORS headers | there is currently no CORS surface at all, which is correct: the API is same-origin only. Adding CORS would widen the attack surface for no benefit |
| Do **not** add a server-side SQL or PySpark execution route | both run in the browser today, at zero Cloudflare compute cost. Moving execution server-side would be a large cost increase and a new abuse surface |
| Do **not** hash or rate-limit on IP alone for admin auth | authz is already by immutable numeric GitHub id and fails closed. IP-based authz would be a regression |
| Do **not** delete the `session_denied` audit action | it is genuinely useful for abuse investigation. Throttle/aggregate it; do not remove it |
| Do **not** move the heavy Pyodide/wheels payloads to the Worker bundle in a different form | they are already static assets served from the edge. Only consider an external CDN/R2 if PySpark traffic actually grows |
| Do **not** change the OAuth client, secrets, `ADMIN_GITHUB_IDS`, or the D1 schema | out of scope for Phase 4 Step 1, and unnecessary — every recommended mitigation is code-side |
| Do **not** "fix" the 5 pre-existing lint errors or the documented UI issues here | unrelated to abuse/cost; tracked separately |

---

## M. Tests that should exist

### Before implementation (characterisation tests — these should pass and lock current behaviour)

| Test | Asserts |
|------|---------|
| `GET /api/auth/github` inserts a row | CONFIRMS the V-01 write exists, so the fix is measurable |
| unauthenticated `GET /api/admin/questions` writes exactly one `session_denied` row | CONFIRMS V-02 |
| `GET /api/auth/session` performs a session `SELECT`, a `last_seen_at` `UPDATE` and 2 purges | CONFIRMS V-03/V-04 |
| `GET /api/questions` returns `Cache-Control: no-store` and full `SELECT *` | CONFIRMS V-05/V-06 |
| a 500-item import performs ~1,500 D1 operations | CONFIRMS V-08 |
| an existing `revokeAllSessionsForUser` remains unreferenced | CONFIRMS V-15 |

### After implementation (regression tests — these must pass)

| Test | Asserts |
|------|---------|
| `GET /api/auth/github` without a same-origin signal is rejected **and inserts nothing** | V-01 closed |
| repeated unauthenticated admin requests are rate limited with HTTP 429 and stop writing audit rows beyond the sampling threshold | V-02/V-10 closed |
| `GET /api/auth/session` performs **zero** writes (SELECT only) | V-03/V-04 closed |
| the `scheduled()` handler purges expired sessions, expired OAuth transactions and audit rows older than the retention window | V-09/V-13 closed |
| `GET /api/questions` returns `Cache-Control: public, max-age=…` and honours `If-None-Match` with 304 | V-05 closed |
| `GET /api/questions` honours a `LIMIT`; the count reflects the page, not the table | V-06 closed |
| a 500-item import completes in a bounded number of D1 statements and preserves the exact `{imported, skipped, conflicts, failed}` outcome | V-08 closed |
| **every** `/api/admin/*` and `/api/auth/*` response still carries `Cache-Control: no-store` | prevents an over-broad caching fix leaking drafts/CSRF |
| public filter values outside the allow-list are rejected (400) rather than silently missing | V-12 closed |
| `exchangeCodeForIdentity` aborts within its timeout when GitHub does not respond | V-11 closed |
| a single admin create issues **one** catalog fetch, not 3–4 | V-07 closed |
| all 50 existing `server/tests/security.test.ts` tests still pass | no security regression |
| the existing 29 `build-target` tests still pass | no build regression |

---

## Appendix — files inspected

`wrangler.jsonc` · `migrations/0001_init.sql` · `package.json` ·
`README.md` · `config/deploy-targets.ts` · `config/source-scanner.ts` ·
`scripts/build.mjs` · `scripts/dev.mjs` · `scripts/verify-build.mjs` ·
`scripts/predeploy-worker.mjs` · `scripts/generate-seo-assets.mjs` ·
`vite.config.ts` · `index.html` · `public/robots.txt` ·
`server/index.ts` · `server/http.ts` · `server/request.ts` ·
`server/session.ts` · `server/store.ts` · `server/oauth.ts` ·
`server/crypto.ts` · `server/audit.ts` · `server/env.ts` ·
`server/questionSchema.ts` · `server/tests/security.test.ts` (50 tests
enumerated) · `server/tests/harness.ts` · `docs/security/admin-auth.md` ·
`docs/architecture/admin-persistence.md` · `docs/qa/baseline-browser-audit.md` ·
`docs/qa/post-implementation-browser-audit.md` · `src/lib/adminApi.ts` ·
`src/lib/adminServerSync.ts` · `src/lib/questionCatalog.ts` ·
`src/lib/pysparkClient.ts` · `src/lib/pglite.ts` ·
`src/lib/seo.ts` · `src/main.tsx` · `src/routes.tsx` ·
`src/pages/AdminPage.tsx` · `src/pages/AdminLoginPage.tsx` ·
`src/components/AdminGate.tsx` · `public/worker/pyspark-test-worker.js`

Not changed by this audit: every file above, plus all configuration, schema,
secrets and deployed state. The only file created is this report.

---

## Phase 4 outcome (recorded by task 4.2H)

Full re-measurement against the implemented code, with evidence, is in
[phase-4-verification.md](./phase-4-verification.md). Summary:

| Finding | Outcome |
|---|---|
| V-01 unauthenticated OAuth-start INSERT | **CLOSED** - Sec-Fetch-Site-first same-origin check + 5/min limit |
| V-02 audit write per anonymous admin request | **CLOSED** - 60/min anonymous budget, 429 writes nothing, denials sampled |
| V-03 housekeeping on the request path | **CLOSED** - moved to scheduled() |
| V-04 authenticated reads perform a write | **CLOSED** - last_seen_at refreshed only past 60s; idle timeout unchanged |
| V-05 public reads uncacheable | **CLOSED** - public, max-age=60 + content-derived ETag + 304 |
| V-06 unbounded public SELECT * | **CLOSED** - limit 100, 	otal reported separately, 	runcated flag |
| V-07 client amplification per mutation | **CLOSED** - ~3 catalog GETs per mutation -> 1 |
| V-08 sequential import loop | **CLOSED** - 1500 round trips -> 253 statements / 3 batches |
| V-09 audit log has no retention | **CLOSED** - bound-cutoff delete, AUDIT_RETENTION_DAYS config, 90-day default |
| V-10 no rate limiting | **CLOSED for audited vectors**, still best-effort per-isolate |
| V-11 outbound GitHub fetches untimed | **CLOSED** - AbortSignal.timeout(10_000) on both calls |
| V-12 unvalidated public filters | **CLOSED**, category bounded by length/charset rather than allow-listed (see report) |
| V-13 no cron handler | **CLOSED** |
| V-14 large static payload | **ACCEPTED** - re-measured 32.5 MB; audit recommended no change |
| V-15 dead `revokeAllSessionsForUser` | **CLOSED** - absent from the current tree |
| V-16 existing protections | **VERIFIED INTACT** |

Five deliberate deviations from the audit's suggested remediations are
recorded in section F of the verification report, each with its reasoning.
Phase 5 is recommended as safe to start, subject to three stated conditions.
---

## Phase 5 outcome (recorded by task 5.4)

Phase 5 adds anonymous product analytics. Its privacy and security review is
in [`analytics-privacy-review.md`](./analytics-privacy-review.md), with the
design of record in [`analytics-architecture.md`](./analytics-architecture.md).

| Phase 5 area | Outcome |
|---|---|
| Storage shape | Six columns, no identifier column. Verified against live sqlite_master, not from the migration file |
| Personal data stored | **None.** Every stored value is a date, an allow-listed name, or a count |
| Fingerprinting | **None**, and not possible: nothing stable about a client is read and nothing is hashed |
| Cross-session linkage | **None.** Three distinct client addresses produced one shared, unattributable counter |
| Identifier / backdate injection | Refused with 400; an unrecognised event field is an error, never passed through |
| Admin read authorization | `requireAdmin`, same call as every other admin route; 401/403/405/405 all asserted |
| Admin read cache policy | `no-store`, no public, no ETag; the 4.2D invariant that only /api/questions is publicly cacheable is re-asserted |
| Ingest abuse resistance | 60/min per address, charged before the body is read; cross-site with a forged referrer is 403 |
| Free-tier cost | 6 rows for 28 measured events; 144 rows/day traffic-independent ceiling; ~0.43% of the daily write budget |
| Residual risk | Rate limiting is per-isolate and therefore best-effort, as already documented. Not overclaimed |

One low-severity finding was recorded rather than fixed, per the task
instruction not to change behaviour to make a finding disappear: the client
collector posts to a path that does not exist on the GitHub Pages deployment,
so each flush 404s. It collects nothing and has no user-visible effect.
Recommended as a new roadmap task.
