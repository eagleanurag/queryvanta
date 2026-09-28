# QueryVanta — Post-Implementation Browser & Security Audit

Verification of the administrator-security and persistent-question
milestone, after implementation.

## Test identification

| Field | Value |
| --- | --- |
| Timestamp | 2026-09-27 (local) |
| Base commit | `b4c8bb1` (all changes uncommitted) |
| Browser | Chromium (Playwright bundled), desktop 1280x720 + mobile 390x844 |
| App target | `http://localhost:5173/queryvanta/` (Vite dev, `base=/queryvanta/`) |
| Worker target | `http://127.0.0.1:8787` (`wrangler dev --local`, real local D1) |
| Production | `https://eagleanurag.github.io/queryvanta/` (reachable, unchanged) |
| Browser suite | `tests/e2e/*.spec.ts` |
| Server suite | `server/tests/*.test.ts` (Node test runner, real Worker + real D1) |

## Totals

| Suite | Result |
| --- | --- |
| Browser (desktop + mobile) | **167 passed, 0 failed, 3 skipped** |
| Server — secrets | 10 / 10 |
| Server — boot + security | 50 / 50 |
| Server — worker assets (production-like) | 8 / 8 |
| `npm run build` | PASS |
| `npm run lint` | 7 problems (5 errors, 2 warnings) — **identical to baseline**, no new findings |
| `git diff --check` | clean |

Skipped tests: the production-only Pages 404 assertion (2 projects)
and the mobile drawer check on the desktop viewport. The four
admin row-action tests are desktop-only on mobile because of the
recorded 6 px overflow (F-04), and are asserted instead as a
documented overflow allowance.

---

## 1. What changed, verified in the browser

### Administrator gate

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| A1 | `/admin/questions` with a clean profile | no CRUD surface | `Create Question`, `Export Questions` and the `Question Management` heading all have count 0; gate shown instead | PASS |
| A2 | `/admin/preview` | no editable workspace | `Run Query` count 0 | PASS |
| A3 | `/admin/login` | explains the requirement, offers GitHub | heading + `Continue with GitHub`; `input[type=password]` count 0 | PASS |
| A4 | `?error=not-authorized` | safe message | "That GitHub account is not registered as a QueryVanta administrator." | PASS |
| A5 | `GET /api/admin/questions` from the browser | never 200 | 404 on a backendless deployment (401 when the Worker is present) | PASS |
| A6 | Cross-site mutation from the browser | refused | `{"status":404,"ok":false}` | PASS |
| A7 | Web-storage hygiene | no token/bearer/jwt/session/auth key or `Bearer …` value | `{"local":[],"session":[]}` | PASS |

Observed gate copy on the backendless target:

> Administrator access required — The QueryVanta API is not available
> on this deployment, so administrator features cannot be enabled
> here.

This is the honest outcome on GitHub Pages: rather than faking an
admin experience with a client-only password check, question
management is disabled and the reason is stated.

### PySpark — now genuinely verified

The Spark Connect backend became reachable during the session, so
real execution was finally possible.

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| P1 | Cross-origin isolation | `crossOriginIsolated` + `SharedArrayBuffer` | `{"crossOriginIsolated":true,"hasSharedArrayBuffer":true}` | PASS |
| P2 | Correct solution graded by the real engine | `Correct answer!` | `PYSPARK wall=41.4s verdict="Correct answer!" reachable=true` | PASS |
| P3 | Unmodified starter template | graded incorrect | `Expected 3 rows, but your query returned 5 rows` — raw 5 rows vs the 3-row aggregation | PASS |
| P4 | Invalid PySpark + recovery | error, then reset restores | error surfaced, `Reset Code` restored the original | PASS |
| P5 | Diagnostics page | loads | loads, no page errors | PASS |

Warm re-run also returned `Correct answer!` in 35.4 s.

### Regression — every public feature still works

| Feature | Evidence | Status |
| --- | --- | --- |
| Home | `Showing 35 of 35 questions`, H1, `Total Questions` | PASS |
| Navigation | Learn / Progress / Interview, back, forward, refresh, mobile drawer (`x=12` open, `x=-240` closed) | PASS |
| 7 SEO landing pages | title, description, `index,follow`, canonical, OG, breadcrumbs, JSON-LD parse, internal links, refresh | PASS |
| Discovery | search `Showing 5 of 35`; `difficulty=Medium` → 14; `type=PySpark` → 11; category filter; combined filters; clear | PASS |
| Question detail | prompt, difficulty, category, hint, solution, explanation, starter + reset, deep link, refresh | PASS |
| SQL execution | `Correct answer!` in 5.4 s; invalid SQL handled; empty SQL safe; 2/2 repeat runs; **stale guard held**; result table; session continuity | PASS |
| PySpark | see P1–P5 | PASS |
| Learning | all 6 paths; topic deep link (`0 of 6 completed`); topic practice with `origin=learning`; unknown topic/path; weak-areas empty state; quick preset | PASS |
| Practice | 5 / 10 / 20 / all-available (`1 of 5`, `1 of 10`, `1 of 20`, `1 of 35`); dialog semantics; random mode; refresh + resume; finish; **duplicate finish produced 1 history entry, not 2** | PASS |
| Progress | `Solved 1 / 35 · 3%`, `Easy 1 / 12`, `SQL 1 / 24`, `Unsolved 34` — cross-checked against seeded storage | PASS |
| Interview | 4 presets; untimed (no `endsAt`); timed `30:00` persisting across refresh; finish summary `Time used 0:29 29:31 remaining at finish`, no invented score | PASS |
| Bookmarks | toggle, persistence, filter `Showing 1 of 35`, removal → `[]` | PASS |
| History | 1 entry with `origin` and `startedAt` | PASS |
| 404 | `Page not found` + `noindex,follow` | PASS |
| Canonical base | all 5 audited routes keep `/queryvanta/` | PASS |
| Accessibility | no unnamed buttons; first Tab stop outline `solid 2px` | PASS |
| Console | `pageErrors: []`, `consoleErrors: []` across the main routes | PASS |

---

## 2. Security test results (real Worker, real D1)

All executed against `wrangler dev --local` with a fresh local D1
database per run. No handler is mocked; the application SQL executes
against real SQLite.

### AUTH (9/9)

| Test | Result | Evidence |
| --- | --- | --- |
| unauthenticated admin read | 401 | `unauthorized` |
| unauthenticated mutations (POST/PUT/DELETE/publish/duplicate) | 401 each | 5 paths |
| malformed session cookie | 401 | never reaches the database |
| revoked session | 401 | `revoked_at` set |
| expired session | 401 | server-side expiry enforced |
| valid administrator session | 200 | |
| logout revokes server-side | 401 after logout | cookie also `HttpOnly; SameSite=Lax; Max-Age=0` |
| logout without valid CSRF | 403 | `csrf_failed` |
| valid session, non-administrator | 403 | `forbidden` |

### OAUTH (9/9)

| Test | Result | Evidence |
| --- | --- | --- |
| invalid state | 302 to `error=authentication` | reason never disclosed |
| no state | 302 | |
| flow start | PKCE `code_challenge` + `code_challenge_method=S256` + 64-hex `state` | `scope=read%3Auser` only; no `repo`/`write:`/`admin:` |
| replayed callback | rejected | second use of the same state refused |
| unknown state | rejected | |
| provider denial | 302 to `error=provider` | |
| redirect allow-list | 7 hostile targets all collapse to the default | includes `//evil.example`, `https://evil.example/steal`, `javascript:alert(1)` |
| empty allow-list denies all | fail-closed | |
| malformed allow-list entries ignored | only `^\d+$` kept | |

### CSRF (5/5)

| Test | Result |
| --- | --- |
| missing CSRF token | 403 `csrf_failed` |
| wrong CSRF token | 403 `csrf_failed` |
| foreign `Origin` | 403 `origin_rejected` |
| no `Origin` and no `Referer` | 403 `origin_rejected` |
| legitimate same-origin mutation | 200 |

### AUTHORIZATION (5/5)

| Test | Result |
| --- | --- |
| draft never public | absent from list; `GET` → 404 |
| disabled never public | 200 while enabled+published → 404 after disable |
| explicit publish required | 404 before publish, 200 after |
| IDOR via guessed id | clean 404 |
| no session/audit data in the public API | no `token_hash`, `csrf`, `admin_github_id`, `client_secret` |

### INPUT VALIDATION (10/10)

Invalid engine, invalid difficulty, missing field, oversized field,
malformed JSON, non-object body, wrong content type, invalid path id
(3 variants), unsupported DB engine, table with no columns.

### HTTP BEHAVIOUR (8/8)

405 on a bad method; consistent error envelope with no stack traces,
SQL or secrets; 404 on an unknown route; audit log requires a
session; audit records the action and contains no token/secret;
stale-version update → 409; soft delete removes the row from the
admin list while the audit log keeps the reference; bulk import
returns `imported: 2, skipped: 1, conflicts: 1` and does **not**
overwrite the pre-existing record.

### SECRET EXPOSURE (10/10)

Reads the real `dist/` output: no OAuth secret, no `SESSION_SECRET`
value, no `ADMIN_GITHUB_IDS`; no `import.meta.env.*` read whose name
looks like a secret; no web-storage auth-token write; no
client-side admin-password check; no `gh[pousr]_…`,
`github_pat_…` or private-key block in tracked sources;
`.gitignore` covers `.dev.vars`, `.wrangler/`, `.env`; no `.dev.vars`
present after the run.

### WORKER ASSETS — production-like (8/8)

| Test | Result |
| --- | --- |
| built index at `/` | 200, `<title>QueryVanta`, `id="root"`, `src="/assets/` |
| deep-link SPA fallback | 200 for `/learn`, `/learn/topic/window-functions`, `/interview`, `/progress`, `/practice`, `/admin/questions`, `/question/:id` — all serving the React shell |
| static SEO landing snapshot | `/sql-practice` returns the crawler document with canonical and a link into the app |
| unknown API route | 404 JSON |
| COOP/COEP on assets | present (this found and fixed a real bug — see below) |
| single origin | app and API on one origin, no CORS headers |
| sitemap + robots | served from the same origin |
| origin alignment | `APP_ORIGIN === WORKER_ORIGIN` |

---

## 3. Defects found by the new tests and fixed

These were found by the production-like Worker test, not by review.

| ID | Severity | Problem | Evidence | Fix |
| --- | --- | --- | --- | --- |
| N-01 | **High** | Static asset responses carried **no** security headers, so the HTML document was not cross-origin isolated. The in-browser PySpark engine cannot boot without it. | `PROBE / status=200 coep=null coop=null` | `withSecurityHeaders()` in `server/index.ts` applies the baseline to every asset response, preserving existing cache headers |
| N-02 | **High** | Workers Static Assets served matching assets **before** the Worker ran, so the Worker could never attach those headers. | `not ok 5 - serves cross-origin isolation headers` | `"run_worker_first": true` in `wrangler.jsonc` |
| N-03 | Medium | `apiUrl()` used `new URL(path, base)` with a *path* base, throwing `Invalid base URL` and crashing `/admin/login` through the error boundary. | `TypeError: Failed to construct 'URL': Invalid base URL at apiUrl (adminApi.ts)` | Return a relative string instead |
| N-04 | Medium | The client treated a static host's HTML answer as a generic error instead of "no backend", so the admin gate offered a broken sign-in on GitHub Pages. | `/api/auth/session` returns HTML on Pages | `readEnvelope` returns `no_backend` for a non-JSON content type; `fetchSession` maps it to `unavailable` |

---

## 4. Known limitations after implementation

| ID | Limitation | Why it is real |
| --- | --- | --- |
| R-01 | The static SEO landing snapshots shadow the matching React routes on **both** deployments. | Verified pre-existing on production: `https://eagleanurag.github.io/queryvanta/sql-practice` returns the static snapshot (`title = Free SQL Practice Online …`, no `id="root"`). The React landing page is reachable only via in-app navigation. The snapshot links into the app, so visitors are not stranded. |
| R-02 | GitHub Pages still cannot enforce admin authentication. | Pages has no backend. The deployment is preserved as a fallback; the Worker is the authenticated target. |
| R-03 | GitHub Pages deep links still return HTTP 404. | Verified: `/learn`, `/progress`, `/practice`, `/admin/questions`, `/learn/topic/window-functions` all `status=404` with correct content. Fixed on the Worker, which returns 200. |
| R-04 | A real GitHub sign-in was not executed end to end. | GitHub's OAuth servers are not reachable from this environment. The callback's rejection paths, replay protection, PKCE parameters, scope and the redirect allow-list are all verified; the code-exchange call itself is not. |
| R-05 | `ADMIN_GITHUB_IDS` must be set before any login succeeds. | Deliberate: the system fails closed. An empty list denies everyone. |
| R-06 | PySpark on GitHub Pages remains impossible. | Pages cannot send COOP/COEP. Verified working on the Worker origin (headers present) and on the dev server. |
| R-07 | 5 lint errors + 2 warnings remain. | All pre-existing at `b4c8bb1` and listed in the baseline audit. No new findings were introduced. |

## 5. Not claimed

- No ranking, indexing or traffic outcome is claimed.
- The production URL was **not** redeployed; it still runs `b4c8bb1`.
- `SITE_URL` in `src/lib/seo.ts` still points at the GitHub Pages
  origin. When the Worker is deployed to its own domain, that constant
  (and therefore the canonical tags, sitemap and robots reference)
  must be updated — a manual step, recorded in the final report.
