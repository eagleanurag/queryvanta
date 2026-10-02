# Analytics production verification plan

**Task:** 5.5 — verify the analytics feature in the real deployment
**Status: NOT STARTED. BLOCKED.**

This document is the *plan* required by scope item 1. It is deliberately not
a verification record: no production check has been performed, and no
production number in this repository is a measurement. The completion
criteria for 5.5 require "real measured numbers", which cannot be produced
until the feature is deployed. Producing a record now would be a fabricated
one, so none was written.

---

## 1. Why this task is blocked

The task states its own stop condition:

> Stop and report BLOCKED if the feature is not deployed.

**The feature is not deployed.** Observed, not assumed:

| check | result |
|---|---|
| `git log -1` | `585a718` — the same commit Phase 4 ended on |
| `migrations/0002_analytics.sql` | untracked |
| `server/analytics.ts` | untracked |
| `src/lib/analytics.ts` | untracked |
| `server/tests/analytics.test.ts` | untracked |
| `docs/qa/analytics-architecture.md` | untracked |

Untracked files are, by definition, not in the deployed revision. The entire
Phase 5 feature is uncommitted, so there is nothing in production to verify.

Two further constraints independently prevent deployment from this run:

1. **5.5 explicitly does not grant permission to deploy.** Its own non-goals
   say so, and its implementation requirements say: "If the roadmap is not
   amended to permit a deployment, do not deploy, and say so plainly rather
   than working around it."
2. **The standing operator instruction for this run forbids commit, push and
   deploy.** The Git rule has not been amended.

The blocker is therefore **neither product code nor test code**. It is an
operator-controlled precondition: a deployment decision that this task is not
authorised to make.

## 2. No remote command was run

For the record, and because it is the obvious shortcut: **no remote Cloudflare
or database command was executed at any point in this run.** No read-only
production query, no `wrangler d1 execute --remote`, no metrics API call.

It would have been permitted by 5.5 in isolation, and it would have answered
exactly one question — what the production D1 currently contains — whose
answer is already certain from the git state above. The standing
"do not run any remote Cloudflare or database command" instruction is
additionally restrictive, so the shortcut was not taken.

## 3. What the operator must do, in order

None of these steps were taken by this run.

1. **Apply the migration to the remote database.** The analytics table does
   not exist remotely, and until it does the ingest endpoint returns 500.

   ```
   npm run d1:migrate          # applies 0001 then 0002, in order
   ```

   `npm run d1:migrate` was rewritten in task 5.2 to discover migrations
   rather than name them, precisely so this step cannot silently apply only
   `0001_init.sql`. It is idempotent, so running it twice is safe.

2. **Confirm the table exists remotely**, read-only:

   ```
   npx wrangler d1 execute queryvanta --remote \
     --command "SELECT name FROM sqlite_master WHERE name='analytics_daily'" --json
   ```

3. **Commit and deploy** the working tree, then confirm the deployed revision
   is the one containing Phase 5.

4. **Leave it running for a representative period.** A verification reading
   taken minutes after deploy is not meaningful: analytics is aggregate-only,
   so a fresh deployment legitimately has near-zero rows, and the interesting
   question is the *rate* once real traffic exists. A useful first reading is
   after several days of ordinary traffic.

5. **Then run the checks in section 4.**

## 4. What will be read, and what will not

Every production interaction this plan proposes is read-only. Nothing in
section 4 writes, and nothing alters production data.

### 4.1 Read-only checks

| # | question | how |
|---|---|---|
| 1 | Does the deployed revision contain Phase 5? | `git log -1` on the deployed ref; `wrangler deployments list` |
| 2 | Does the remote schema match? | `SELECT sql FROM sqlite_master WHERE name='analytics_daily'` |
| 3 | What is actually stored? | `SELECT * FROM analytics_daily` — read the rows, confirm only the six known columns and no identifier |
| 4 | How many rows, over what span? | `SELECT COUNT(*), MIN(bucket_date), MAX(bucket_date) FROM analytics_daily` |
| 5 | Is growth traffic-independent? | the same count read again after a known interval; if rows/day stops growing once the buckets exist, the design claim holds |
| 6 | D1 rows written | Cloudflare dashboard → D1 → Metrics → Row Metrics, or the GraphQL Analytics API |
| 7 | Worker request volume | dashboard → Workers → Requests |
| 8 | Storage growth | dashboard → D1 → Storage, compared against the 500 MB per-database limit |
| 9 | Is the throttle firing? | dashboard → Workers → subrequests/errors; 429s do not appear in D1 metrics because a throttled request spends no D1 operation |
| 10 | Are any errors occurring on the ingest path? | dashboard → Workers → Logs, filtered to the analytics route |

Check 3 is the one that matters most and is deliberately a **read of the data
itself**, not of the migration file. The 5.4 review established the privacy
position against a local database; check 3 establishes it against production.

### 4.2 Explicitly not done

- **No synthetic traffic.** The task forbids creating it, and it would
  corrupt every measurement in section 4.1 anyway. Real usage only.
- **No production writes of any kind**, including seeding a bucket to "see
  if it works". A write would require amending the roadmap, and would also
  put test data in the aggregate.
- **No secret or OAuth app change.**
- **No deploying.** That is a separate, unauthorised action.

## 5. The free-tier assumptions to compare against

These are the numbers 5.1 and the 5.4 review committed to. Verification means
comparing reality against them, not re-deriving new targets.

| assumption | source | value | status before deploy |
|---|---|---|---|
| Sustained written rows/day | 5.4 review §F | ~432 (0.43% of budget) | modelled, unmeasured in production |
| Absolute rows/day ceiling | 5.4 review §F | 144, traffic-independent | derived from the allow-lists |
| Lifetime rows over 400-day retention | 5.4 review §F | 57,600 | derived |
| Written rows per event | 5.4 review §F | 0.21 table-only, ~0.64 incl. indexes | measured locally, not in production |
| D1 rows written/day allowance | Cloudflare Free | 100,000 | published |
| D1 queries per Worker invocation | Cloudflare Free | 50 | asserted `<= 7` in tests |
| Storage per database | Cloudflare Free | 500 MB | projected under 6 MB |

**The two that could invalidate the design are rows written per day and
storage growth.** If either exceeds the modelled figures by an order of
magnitude, the aggregation is not doing its job in production and the
allow-lists should be re-examined before anything else.

## 6. What "verified" would require

5.5 completes only when all of the following are true, and the record states
each with a real number:

1. The deployed revision contains Phase 5.
2. `analytics_daily` exists remotely with the six-column shape.
3. A read of the production rows confirms no identifier is present, using
   the same sweep the 5.4 review used.
4. Rows written per day is measured and compared against 100,000.
5. Rows per day is compared against the 144-row ceiling, and the comparison
   states whether growth is traffic-independent.
6. Storage is measured and compared against 500 MB.
7. The verdict on the free-tier assumptions is stated explicitly as holding
   or not holding.

Until then this task is blocked, and `FINAL-final-release-audit.md` — which
declares `Depends on: 5.5` — is blocked behind it.
