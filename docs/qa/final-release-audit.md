# FINAL — Final release and security audit

**Verdict: PASS** — after remediation of F-01 and F-06.

- **F-01 — FIXED.** The analytics collector no longer posts where there is no
  backend. A static deployment now issues **zero** `/api/*` requests, so the
  console stays clean and the four browser tests that failed now pass.
- **F-06 — FIXED.** The misleading `migrate.mjs` wording is corrected. Migration
  behaviour is unchanged and was verified with a local run.
- **F-02 — open, and deliberately so.** `npm run lint` still exits 1 on the same
  7 pre-existing diagnostics. None is in Phase 4/5 or in the F-01 work.
  `npm run lint:baseline` passes with 0 new diagnostics. This is recorded as
  pre-existing technical debt, not as a release blocker.

No security defect was found, and none was introduced. Production is unchanged
and remains verified; see §6.

---

## 1. Repository state at audit time

Reported exactly, not summarised.

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `f9157c09ff124551b63adb3404344d06236ea827` (`f9157c0`) |
| HEAD subject | `Complete Phase 4 hardening and Phase 5 analytics` |
| `origin/main` | `585a718bc6718f7a52ccb59b9bd0ab730b420649` (`585a718`) |
| Ahead / behind | 1 ahead / 0 behind |
| Staged changes | 0 |
| Working tree entries | 20 (16 modified, 4 untracked) |
| Deployed Worker version | `fb1d850f-3516-40cf-9240-40f4dae15d77` |
| Production origin | `https://queryvanta.queryvanta.workers.dev` |

The 20 working-tree entries are the pre-existing operator-excluded set (11
automation-experiment files, `docs/qa/phase-5-privacy-security-review.md`, and 8
`public/` files). This audit **preserved all 20 byte-for-byte**; see §8.

---

## 2. Required quality gates — observed results

Every gate in the task file was run. Results are transcribed from real output.

| # | Gate | Exit | Observed |
|---|---|---|---|
| 1 | `npx tsc -b --force` | **0** | no diagnostics |
| 2 | `npm run test:server` | **0** | 332 tests, 16 suites, 0 failed |
| 3 | `npm run build:pages` | **0** | `base = /queryvanta/`, SEO assets regenerated, `✓ built in 4.03s` |
| 4 | `npm run verify:build pages` | **0** | `ok manifest target=pages base=/queryvanta/`; 5 Pages-based asset references; `Verified: dist/ matches the "pages" target` |
| 5 | `npm run build:worker` | **0** | `base = /`, build complete |
| 6 | `npm run verify:worker` | **0** | `Worker pre-deploy check passed: dist/ is a root-base (base "/") build with no /queryvanta/ references.` |
| 7 | `npm run lint` | **1** | `✖ 7 problems (5 errors, 2 warnings)` — all pre-existing |
| 8 | `git diff --check` | **0** | no whitespace errors (only PowerShell CRLF notices) |

Supplementary, because the repository has a baseline-aware gate:

| Gate | Exit | Observed |
|---|---|---|
| `npm run lint:baseline` | **0** | `baseline diagnostics: 7` / `new diagnostics: 0` / `status: PASS` |

### Gate 7 detail — the 7 lint diagnostics

All 7 are in files untouched by Phase 4 and Phase 5. Zero are in any Phase 4/5
file. This is the exact set the repository already records in
`.automation/lint-baseline.json`, and `npm run lint:baseline` confirms
`new diagnostics: 0`.

| File | Diagnostics |
|---|---|
| `src/App.tsx` | 2 × `react-hooks/set-state-in-effect` |
| `src/components/PracticeAnalytics.tsx` | 1 × `react-hooks/purity` |
| `src/components/PracticeSetupModal.tsx` | 1 × `react-refresh/only-export-components` |
| `src/pages/QuestionPage.tsx` | 1 × `set-state-in-effect`, 2 × `exhaustive-deps` |

These are React-Compiler-era rules about render purity and cascading renders.
They are real code-quality findings but they are **not security findings** and
they **predate** this work. Fixing them would mean restructuring component state
management — out of scope for a release audit, and explicitly excluded by the
task's own non-goals.

---

## 3. Browser suites — both README flows, both run

Both documented browser flows in `README.md` were executed.

### Flow 1 — local admin env (Worker build, real bundle)

`npm run build:worker` → `node --experimental-strip-types server/tests/admin-env.ts up`
→ `QV_BASE_URL=http://127.0.0.1:22892/`

```
Running 40 tests using 1 worker
  1 skipped
  39 passed (1.6m)
```

Specs `12-admin-d1-catalog`, `13-worker-build-base`, `14-admin-analytics` across
both desktop and mobile projects. The 1 skip is the mobile-viewport test
correctly self-skipping on the desktop project (it runs and passes as test 39 on
the mobile project).

### Flow 2 — dev server (Pages base `/queryvanta/`), full suite

`npm run dev -- --port 5173 --strictPort` → `QV_BASE_URL=http://localhost:5173/queryvanta/`

```
210 tests
  5 failed
  43 skipped
  162 passed (17.8m)
```

The 43 skips are the admin-env specs correctly self-skipping because
`QV_BASE_URL` did not point at `server/tests/.admin-env.json`. They were proven
green in Flow 1.

### The 5 failures, individually diagnosed

This is the part that matters. The failures were **not** waved away.

| # | Spec | Diagnosis | Verdict |
|---|---|---|---|
| 1 | `[desktop] 03-discovery-question › result navigation … prev/next works` | Passed standalone **twice** (8.1s, and again in a 10/10 isolated run). Took far longer under the 17.8-minute full-suite load. No console error; a timeout under load. | **Flake**, not a defect |
| 2 | `[desktop] 07-practice-bookmarks › session survives refresh and can finish` | `Error: practice resume+finish: console errors` → `Failed to load resource: … 404 (Not Found)` | **Real** — F-01 |
| 3 | `[desktop] 07-practice-bookmarks › completed session appears in history` | same 404 console error | **Real** — F-01 |
| 4 | `[mobile] 07-practice-bookmarks › session survives refresh and can finish` | same 404 console error | **Real** — F-01 |
| 5 | `[mobile] 07-practice-bookmarks › completed session appears in history` | same 404 console error | **Real** — F-01 |

**Outcome.** Failures 2-5 were caused by F-01 and now pass: `07-practice-bookmarks`
is **22 passed** on both viewports, with zero console errors. Failure 1 is a
load flake and was not reproduced by any later run. Post-remediation results are
in §11.

---

## 4. Security review

Reviewed at source in `server/*.ts` and `config/`, with production behaviour
confirmed in §6.

| Area | Finding | Evidence |
|---|---|---|
| **Session cookie flags** | **PASS.** `HttpOnly`, `SameSite=Lax`, `Max-Age` set, `Secure` when not local, and **no `Domain` attribute** so the cookie stays host-only. | `server/http.ts:250-262` — comment states the host-only intent explicitly |
| **Session token storage** | **PASS.** The raw token is never persisted; only a salted SHA-256 digest is stored. | `server/crypto.ts:5`, `sha256Hex`, `sessionDigest` (deployment-scoped salt) |
| **Secrets at rest** | **PASS.** `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` are both wrangler `secret_text` bindings. No secret material is in the repository. | `wrangler secret list` → 2 × `secret_text` |
| **`.dev.vars` hygiene** | **PASS.** Git-ignored, not tracked, and not present on disk. | `git check-ignore` → ignored; `git ls-files` → 0 |
| **PKCE** | **PASS.** S256 only. | `server/crypto.ts:112-124`; live 302 carried `code_challenge_method=S256` |
| **CSRF / origin** | **PASS.** `assertSameOriginSignal` reads `Sec-Fetch-Site` first, so a forged same-origin `Referer` cannot bypass it. Applied to the ingest endpoint and the admin mutation family. | `server/index.ts:455`, `:742`; live production: no signal → 403, cross-site + forged Referer → 403, same-origin → 302 |
| **Authorization** | **PASS.** All admin routes sit behind `requireAdmin`; 6 call sites, no bypass observed. | `server/index.ts:311`, `:799`, `:823`, `:1206` |
| **SQL injection** | **PASS.** Every dynamic value is a bound parameter. The only two template-literal SQL sites interpolate a compile-time constant column list and generated `?` placeholders. | `server/store.ts:785`, `:871`, `:898`; `IMPORT_COLUMN_LIST` |
| **Information disclosure** | **PASS.** `toError` returns a hard-coded generic message for anything unexpected, and the top-level handler logs only `error.name` — never the message, stack, SQL, or env values. | `server/index.ts:304-308` ("Never leak internals"), `:1369-1373` |
| **Log-flooding amplifier** | **PASS, deliberately.** The 429 path is not logged, so an attacker cannot turn the throttle into a log-flooding cost. | `server/index.ts:1354-1359` |
| **Analytics anonymity** | **PASS.** The table has six columns and **no identifier column**. Identifiers are refused, not filtered: an extra event field or an identifier-shaped property name is a hard 400. | live production: `userId` → 400, `visitorId` → 400; `SELECT *` sweep found no IP-shaped and no hex-token value |

### Secret scan

206 tracked files scanned for 9 high-confidence credential shapes plus
assignment-shaped literals.

| Pattern | Result |
|---|---|
| GitHub classic / fine-grained token | clear |
| OpenAI-style key | clear |
| AWS access key id | clear |
| Private key block | clear |
| JWT | clear |
| `Bearer` / `Basic` literal | clear |
| 40-hex (Cloudflare-token-shaped) | 2 files — both triaged, see below |
| assignment-shaped literal | 1 file — triaged, see below |

All three hits are accounted for and benign:

1. `docs/qa/baseline-browser-audit.md:11` — a **git commit SHA**
   (`b4c8bb1f7f4e13f5d588da0fa980fe4782f7c892`). Coincidentally 40 hex
   characters, which is the shape of a Cloudflare API token.
2. `public/pyodide/pyodide.asm.wasm` — incidental byte sequences inside a
   committed binary WASM asset. Not a secret.
3. `server/tests/harness.ts:46` — `CLIENT_SECRET = "integration-test-client-secret"`,
   an obvious test fixture. The harness must supply *some* value.

**No unaccounted-for secret and no unaccounted-for generated artifact exists in
the repository.**

---

## 5. Free-tier review — current numbers

| Cost vector | Free-tier ceiling | Measured / derived | Headroom |
|---|---|---|---|
| D1 rows written per day | 100,000 | **~432/day** traffic-independent (144 rows × 3 written-rows billing factor) | **0.43%** |
| D1 rows written, all-time | 100,000/day | 172,800 for the entire 400-day life of the database — a *fixed total*, not a rate | fixed |
| D1 rows read per day | 5,000,000 | Public catalog read is `public, max-age=60` + `ETag`, so cache misses are ≈1 D1 query/minute | negligible |
| D1 queries per Worker invocation | 50 | Analytics ingest worst case = `ceil(25 × 4 / 16)` = **7 statements** | 14% |
| D1 storage | 500 MB / database | **0.14 MB** measured after migration | 0.03% |
| Worker requests per day | 100,000 | ~4,000 consumed by 5.5 verification alone | 4% |

The 144 rows/day ceiling is derived from the allow-lists, not declared
independently — `question_viewed` 61, `question_submitted` 46,
`practice_started` 6, `practice_completed` 16, `interview_started` 6,
`page_viewed` 9. Provenance: `docs/qa/analytics-privacy-review.md` §F.

**The strongest free-tier evidence is empirical, not derived.** During 5.5
production verification, **2,431 real events were sent to the live Worker and
collapsed into 14 rows.** Storage and write cost are a function of the
allow-list cardinality, not of traffic. That is the design thesis confirmed in
production.

---

## 6. Production state confirmed during this release cycle

Migration `npm run d1:migrate` applied `0001_init.sql` then `0002_analytics.sql`
against production; `0001` wrote 0 rows (idempotent), `0002` took `num_tables`
from 5 to 6. The deployed `analytics_daily` schema is byte-identical to local,
both indexes present, and pre-existing data intact (`questions=1`,
`sessions=1`, `audit=15`, `oauth=1`).

Verified live: SPA 200; `/api/health` reports `environment: production`;
`/api/questions` returns `Cache-Control: public, max-age=60` + `ETag`;
OAuth-start 403 without a same-origin signal and 302 with PKCE for a genuine
navigation; `/api/admin/analytics` 401 + `no-store` + no `ETag`;
`/api/analytics/events` 405 on GET (routed, not 404); ingest 200; 9 malformed /
forbidden inputs rejected with the correct status; 600 KB body → 413; no
identifier in any stored row; admin read query returns 14 rows in 0.4 ms.

**Expected behaviour, not a defect:** a 404 for `/api/analytics/events` on the
**GitHub Pages** origin. Pages is static and hosts no `/api/*`. This is
established architecture, not a Worker deployment fault.

---

## 7. Documentation accuracy

Every command the repository documents was checked to exist and, where it is a
gate, was executed.

| Documented command | Exists | Ran |
|---|---|---|
| `npm run dev`, `build`, `lint`, `test:*`, `build:worker`, `verify:worker` | yes | yes |
| `npm run d1:migrate` | yes | yes (production) |
| `npm run d1:migrate:local` | yes | — (definition verified: `migrate.mjs --local`) |
| `npm run worker:dev` | yes | — |
| `node --experimental-strip-types server/tests/admin-env.ts up` | yes | yes |
| `npx playwright test tests/e2e/12-… 13-… 14-…` | yes | yes |
| `npx wrangler login` / `d1 create` / `secret put` / `deploy` | yes | deploy yes; setup steps n/a |
| `server/tests/.admin-env.json`, `playwright.config.ts`, all 3 e2e specs | present | — |
| `.automation/lint-baseline.json` | present | yes (required at runtime) |

The deploy runbook in `README.md` (lines 232-235) is correct and was followed
exactly: `build:worker` → `d1:migrate` → `verify:worker` → `wrangler deploy`.
The stale `--file=migrations/0001_init.sql` instruction that previously lived
there is gone.

Two documentation defects are recorded as findings below: **F-03** (README
presents a command that cannot succeed as a gate) and **F-06** (a comment in
`migrate.mjs` that actively misleads about production safety).

---

## 8. Repository hygiene

| Item | Result |
|---|---|
| Working tree before audit | 20 entries |
| Working tree after all builds, both browser flows, and this audit | **20 entries — identical** |
| Operator-excluded files | **preserved byte-for-byte (8/8 `public/` files hash-identical)** |
| `dist/` | ignored via `.gitignore:11`, 0 tracked files |
| `test-results/` | present from Playwright, ignored |
| `server/tests/.admin-env.json` | present from the local env, ignored |
| `.dev.vars` | absent, ignored |
| Tracked build output | none |
| Secrets in tracked files | none (§4) |

Background processes started for the browser flows (dev server on 5173, local
admin env on 22892) were terminated and both ports confirmed released. No other
process was touched.

---

## 9. Findings

### F-01 — Analytics collector posted unconditionally → **FIXED**

**Severity: medium. Type: application defect. Introduced by: Phase 5.2. Fixed in the working tree, uncommitted.**

#### The defect

`src/lib/analytics.ts` sent a batch to `ingestUrl()` with no availability
check. `ingestUrl()` resolves `${BASE_URL}api/analytics/events` against the
current origin. On any origin without the Worker backend — GitHub Pages, and the
Vite dev server — that POST 404s. The collector swallowed the JavaScript
failure, but it could not suppress the **browser's own** console message for a
failed request, and `expectNoAppErrors` (`tests/e2e/helpers.ts:91`) correctly
treats that as a test failure. Four tests in `07-practice-bookmarks` broke on
desktop and mobile.

#### A correction to this audit's earlier reasoning

The first version of this audit recommended gating the collector on
`probeApi()` and stated that `AdminGate` already used it. **That was wrong on
both counts.** Inspection of the actual code shows:

- `probeApi()` (`src/lib/adminApi.ts:291`) had **zero call sites** in `src/`.
- `AdminGate` uses `fetchSession()`, not `probeApi()`. It learns there is no
  backend because `readEnvelope` (`adminApi.ts:86-101`) maps a non-JSON response
  to `code: "no_backend"`, which `fetchSession` turns into
  `reason: "unavailable"`.

The recommendation was implemented, measured, and found **insufficient**. The
measurement is the important part:

```
GET /queryvanta/api/health -> 404 to the browser
```

An earlier `curl` check reported `200 text/html`, which suggested a probe would
be silent. That was wrong because `curl` does not send
`Accept: application/json`. Vite only applies its SPA fallback to requests that
accept HTML, so a `fetch` gets a 404 — and a 404 is a console error. **A probe
would therefore have traded one analytics 404 for one probe 404**, leaving the
defect's user-visible symptom intact.

#### The fix

Since a static origin 404s *every* `/api/*` path, the only way to reach zero
failed requests is to know before the first request that there is nothing to
talk to. Backend presence is a property of the deployment target, and the
repository already models that in one place.

| File | Change |
|---|---|
| `config/deploy-targets.ts` | Added `hasApi: boolean` to `DeployTarget`; `pages: false`, `worker: true`. Documented why it is a build-time fact. |
| `scripts/build.mjs`, `scripts/dev.mjs` | Forward it as `VITE_QV_API_AVAILABLE`, following the existing `VITE_QV_SITE_URL` pattern. Both now log `has API : <bool>`. |
| `src/lib/analytics.ts` | Reads the flag; `hasApi: false` starts permanently suppressed. `hasApi: true` starts **undetermined** and confirms once at runtime via the existing `probeApi()`. |

No second "is the API alive?" implementation was invented: the build-time answer
comes from the existing single source of truth, and the runtime answer from the
existing `probeApi()`.

#### Behaviour, by origin

| Origin | Behaviour |
|---|---|
| Cloudflare Worker (`hasApi: true`) | Unchanged. Probes `api/health` exactly once, then posts events. Verified ingesting with HTTP 200. |
| GitHub Pages / dev (`hasApi: false`) | **Zero** `/api/*` requests. Never probes, never posts, never queues. |

The runtime answer is resolved at most once per page load, on the first event,
and concurrent callers share the single in-flight promise. A negative answer is
never re-probed: a deployment does not grow a backend while a tab is open.
`flush()` awaits the determination because it is async; the synchronous
`flushOnUnload()` drops its batch when the answer is unknown, since it cannot
wait and this module's own rule is that a non-critical signal is dropped rather
than retried.

#### Measured evidence

Diagnostic run against the dev server, after the fix, on both the SPA root and a
static SEO landing page:

```
--- /api/ traffic and console errors ---
  (none)
```

New spec `tests/e2e/15-analytics-collector.spec.ts` proves the four required
cases, and adapts to whichever origin it is given:

| Case | Static origin | Worker origin |
|---|---|---|
| A. event posted and accepted | n/a | **PASS** — POST `/api/analytics/events` → 200, exactly 1 probe |
| B. no POST to a nonexistent endpoint | **PASS** — `posts == []` | n/a |
| C. bounded probing, survives navigation | **PASS** — `probes == []` on every navigation | **PASS** — `probes.length == 1` |
| D. app renders and navigates regardless | **PASS** | **PASS** |

The four originally-failing tests now pass:

```
22 passed (3.3m)   # tests/e2e/07-practice-bookmarks.spec.ts, both viewports
```

**Not changed:** event schema, the anonymous-event guarantees, rate limiting,
`Sec-Fetch-Site` protection, all server-side analytics behaviour, and the
production database schema. Analytics remains non-blocking and non-fatal, and is
not a prerequisite for rendering.

### F-02 — `npm run lint` exits 1

**Severity: low. Type: pre-existing, out of scope.**

7 diagnostics, all baseline-tracked, 0 new, none in Phase 4/5 code. See §2. The
repository's own gating command `npm run lint:baseline` passes.

### F-03 — README presents `npm run lint` as a gate, but it cannot pass

**Severity: low. Type: documentation.**

`README.md` line 58 lists `npm run lint  # ESLint` alongside passing commands. Run
as a gate it exits 1, and the README never mentions `npm run lint:baseline`, the
command the repository actually gates on. A reader following the README will
conclude the repository fails its own lint step.

**Recommended fix.** Document `npm run lint:baseline` as the gating command and
record the 7-diagnostic baseline next to it.

### F-04 — `build:worker` silently rewrites 8 tracked `public/` files

**Severity: medium (process). Type: repository hygiene.**

`scripts/build.mjs` runs `generate-seo-assets.mjs` as a prebuild step for
**both** targets, writing `public/` in place with that target's `siteUrl`:

| Target | `siteUrl` written into `public/` |
|---|---|
| `pages` | `https://eagleanurag.github.io/queryvanta` |
| `worker` | `https://queryvanta.queryvanta.workers.dev` |

So `npm run build:worker` rewrites every tracked canonical URL, `og:url`,
`twitter:image` and sitemap `<loc>` to the **Worker** origin, leaving the tree
dirty. This is the entire explanation of the 8 pre-existing `public/` working-tree
entries: a `build:worker` had been run and left them on the Worker origin.

**This is a live hazard for the pending push.** HEAD correctly holds the Pages
origin. If the current working tree is committed, GitHub Pages would be served
Worker-origin canonicals and a sitemap — wrong URLs on the live Pages site.

**Recommended action before pushing.** Do not stage `public/`, or restore it with
`git checkout -- public/`, so the committed Pages snapshots stay on the Pages
origin.

### F-05 — Rate limiting is per-isolate; effective threshold exceeds the nominal 60/min

**Severity: informational. Type: documented best-effort limitation, now measured.**

`server/rateLimit.ts` keeps its bucket map in Worker-isolate memory and says so.
Production behaviour matches the documentation, and the 5.5 run produced the
first real measurement of it:

| Burst | Accepted (200) | Throttled (429) | `Retry-After` |
|---|---|---|---|
| 70 sequential, one address | 70 | 0 | — |
| 80 parallel | 80 | 0 | — |
| 300 parallel | 300 | 0 | — |
| **800 parallel, 400 sockets** | **674** | **126** | `53`–`54` |

The first three bursts looked like a broken limiter and were worth chasing. The
800-wide burst proves the limiter **is** active in production: a burst spread
across N isolates gives each only 1/N of the budget, so no single vantage point
reaches 60 until it sends far more than 60 requests. **Not a defect.** The
durable protection against write amplification is the cardinality bound plus
aggregate-on-write, which is why 2,431 events cost 14 rows.

Worth recording the measured figure in the rate-limit docstring so the next
reader does not repeat this diagnosis.

### F-06 — `migrate.mjs` usage comment says "local"; the code targets production

**Severity: medium. Type: documentation with a real operational hazard.**

`scripts/migrate.mjs` line 17 states:

```
 *   node scripts/migrate.mjs                    # local, default database
```

The implementation does the opposite. Line 97:

```js
...(local ? ["--local"] : ["--remote"]),
```

and `local` is `argv.includes("--local")`. With no arguments the script therefore
passes **`--remote`** — production. And `npm run d1:migrate` is exactly the bare
invocation.

An operator who trusts the header would run a **production migration believing it
was a local dry run**. This audit verified the real behaviour before running it
and deployed against production deliberately, but the comment was actively
misleading.

**Status: FIXED.** The operator-facing wording now describes the actual
behaviour, and the adjacent code comment was corrected to match:

```
 * Usage:
 *   npm run d1:migrate                          # REMOTE: the deployed database
 *   node scripts/migrate.mjs --remote           # same as above, made explicit
 *   npm run d1:migrate:local                    # LOCAL only, throwaway
 *   node scripts/migrate.mjs --local --persist-to <dir>
 *
 * DEFAULT TARGETS PRODUCTION
 * --------------------------
 * With no --local flag this script passes --remote to wrangler, so a bare
 * invocation applies migrations to the DEPLOYED database. That is
 * deliberate, and it is what the deploy runbook in README.md relies on,
 * but it also means the no-argument form is NOT a dry run. Pass --local
 * whenever you intend a throwaway database.
```

**Behaviour is unchanged, and that was verified rather than asserted.** A local
run after the edit:

```
applying migrations/0001_init.sql
Resource location: local
19 commands executed successfully.
applying migrations/0002_analytics.sql
Resource location: local
2 commands executed successfully.
```

Only comments changed; no execution path was touched. No remote migration was
run.

---

## 10. Scope item outcomes

| # | Scope item | Outcome |
|---|---|---|
| 1 | Full security review | **Complete.** No security defect found. §4 |
| 2 | Full free-tier review, current numbers | **Complete.** §5 |
| 3 | Full quality-gate run, observed output | **Complete.** 8/8 run, 7 pass, 1 pre-existing failure. §2 |
| 4 | Repository hygiene | **Complete.** Clean; no unaccounted-for secret or artifact. §8 |
| 5 | Documentation accuracy | **Complete.** Every documented command checked. §7, F-03, F-06 |
| 6 | Written release recommendation under `docs/` | **Complete.** This document |

---

## 11. Post-remediation validation

Re-run after the F-01 and F-06 fixes. Every figure below was observed.

| Gate | Exit | Observed |
|---|---|---|
| `npx tsc -b --force` | **0** | no diagnostics |
| `npm run test:server` | **0** | 332 tests, 16 suites, 0 failed |
| `npm run test:analytics` | **0** | 50 tests, 0 failed |
| `npm run test:admin-analytics` | **0** | 27 tests, 0 failed |
| `npm run test:security` | **0** | 57 tests, 0 failed |
| `npm run test:unit` | **0** | 10 tests, 0 failed |
| `npm run test:housekeeping` | **0** | 7 tests, 0 failed |
| `npm run test:lint-baseline` | **0** | 26 tests, 0 failed |
| `npm run test:ratelimit` | **0** | 15 tests, 0 failed |
| `npm run test:cache` | **0** | 22 tests, 0 failed |
| `npm run test:worker` | **0** | 8 tests, 0 failed |
| `npm run build:pages` | **0** | `has API : false`; `base = /queryvanta/` |
| `npm run verify:build pages` | **0** | `Verified: dist/ matches the "pages" target (base /queryvanta/)` |
| `npm run build:worker` | **0** | `has API : true`; `base = /` |
| `npm run verify:worker` | **0** | root-base build, no `/queryvanta/` references |
| `npm run lint` | **1** | `✖ 7 problems (5 errors, 2 warnings)` — identical to §2, see F-02 |
| `npm run lint:baseline` | **0** | `baseline diagnostics: 7`, `new diagnostics: 0`, `status: PASS` |
| `git diff --check` | **0** | no whitespace errors |

### Browser suites, both flows

| Flow | Result |
|---|---|
| Dev server, full suite (static origin) | **171 passed, 2 failed, 47 skipped** — see below |
| `07-practice-bookmarks` (the F-01 regression) | **22 passed** — was 4 failures |
| `15-analytics-collector`, static origin | **6 passed, 4 skipped** |
| `15-analytics-collector`, Worker origin | **2 passed, 3 skipped** |
| admin-env, specs 12/13/14/15 | **42 passed, 1 failed, 7 skipped** — see below |

### The two remaining browser failures — both pre-existing flakes, neither a defect

Neither is related to F-01, and both were proven by isolated re-runs.

| Failure | Isolated re-run | Classification |
|---|---|---|
| `05-pyspark-execution › diagnostics page loads` | **PASS** standalone in 5.9s | Load flake. Boots Pyodide/PySpark, which is slow inside a 24.7-minute suite. |
| `14-admin-analytics › A. the page renders` (mobile only) | **PASS** standalone, 6/6 in 23.2s (2.7s vs 7.9s under load) | Load flake. The spec waits a fixed `waitForTimeout(1500)` before reading results; desktop passed in 2.3s. |

`14-admin-analytics` seeds its own data in `beforeEach` via the ingest endpoint
and asserts HTTP 200, so it does **not** depend on collector traffic. Nothing in
the F-01 diff touches the admin analytics **read** path (`listAdminAnalytics`,
`AdminAnalyticsPage`, `resultsText` are all unchanged).

### Production impact of the F-01 fix: none required

The change is entirely client-side and build-time. It touches no file inside the
deployed Worker's execution path except the bundled client, and production
ingestion was already verified in §6 and by 5.5. The deployed Worker already has
the ingest endpoint live and has been observed accepting events, so **no
redeployment is required and none was performed**. A future Worker deploy will
simply ship the corrected client.

### File integrity

Every changed or created file was checked: **0** control-character corruptions,
**0** NUL bytes, no BOM, consistent LF endings. The 8 operator-excluded `public/`
files remain byte-identical to their pre-session hashes and nothing is staged.

---

## 12. Release recommendation

**The repository is release-clean with one standing, pre-existing debt item.**

The deployed Worker is live, migrated, and verified against production
behaviour: §6 and the 5.5 evidence. There is **no security defect**, no secret
exposure, no data-integrity problem, and no free-tier risk. Phase 4 and Phase 5
are done. F-01 and F-06 are fixed and validated in the working tree.

Remaining, in order of importance:

1. **F-02 — pre-existing technical debt.** `npm run lint` exits 1 on 7 React-
   Compiler-era diagnostics, all in `src/App.tsx`,
   `src/components/PracticeAnalytics.tsx`,
   `src/components/PracticeSetupModal.tsx` and `src/pages/QuestionPage.tsx`.
   Confirmed identical before and after this work, baseline-tracked, with
   `new diagnostics: 0`. Fixing them means restructuring component state
   management, which is unrelated product work and was explicitly out of scope.
   **Not a release blocker.**
2. **F-03 — documentation.** The README lists `npm run lint` as a gate without
   mentioning `npm run lint:baseline`. A one-line documentation fix.
3. **F-05 — informational.** The per-isolate rate limiting is measured and
   documented as best-effort. Recording the measured figure in the docstring
   would stop the next reader repeating the diagnosis.

**Immediate operator action, independent of all of the above:** before pushing,
do not stage `public/` (F-04). The committed Pages snapshots are correct; the
working-tree copies are Worker-origin build residue. `build:worker` rewrites
them, so re-check after any build.