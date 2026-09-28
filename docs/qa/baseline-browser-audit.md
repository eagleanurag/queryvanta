# QueryVanta — Baseline Browser Audit

Audit of the **current** application (before any admin-architecture
change), performed with a real Chromium browser via Playwright.

## Test identification

| Field | Value |
| --- | --- |
| Timestamp | 2026-09-27 (local) |
| Commit SHA | `b4c8bb1f7f4e13f5d588da0fa980fe4782f7c892` |
| Branch | `main` (clean working tree) |
| Browser | Chromium (Playwright bundled, `chromium-headless-shell` 153.0.8010.12) |
| Projects | `desktop` (1280x720) and `mobile` (390x844, touch, mobile UA) |
| Local URL | `http://localhost:5173/queryvanta/` — reachable, HTTP 200 |
| Production URL | `https://eagleanurag.github.io/queryvanta/` — reachable, HTTP 200 |
| Production metadata | title `QueryVanta — Free SQL & PySpark Practice for Data Engineering`; canonical present; `msvalidate.01` present; IndexNow key file HTTP 200 |
| Harness | `tests/e2e/*.spec.ts` + `playwright.config.ts` |
| Baseline totals (local) | **169 passed, 0 failed, 5 skipped** |
| Baseline totals (production, PySpark excluded) | 55 passed, 21 failed — all 21 caused by the documented GitHub Pages 404-status behaviour (see L-01) |

Production browser testing was **not** blocked by the environment.

## How to reproduce

```powershell
# local
npm run dev -- --port 5173 --strictPort
$env:QV_BASE_URL="http://localhost:5173/queryvanta/"
npx playwright test

# production
$env:QV_BASE_URL="https://eagleanurag.github.io/queryvanta/"
npx playwright test --project=desktop --grep-invert "pyspark"
```

Navigation inside the suite is **base-relative** (`"learn"`, never
`"/learn"`). A leading slash resolves against the origin and silently
drops the `/queryvanta` base segment.

---

## 1. Baseline build / lint / typecheck

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | **PASS** (exit 0; `tsc -b && vite build`; `SEO assets generated: sitemap.xml + 7 landing pages`; `built in 2.77s`) |
| Typecheck | `tsc -b` (part of build) | **PASS** |
| Lint | `npm run lint` | **FAIL (pre-existing)** — 7 problems: 5 errors, 2 warnings |
| Dependency audit | `npm install` | 0 vulnerabilities |

### Pre-existing lint failures (present at `b4c8bb1`, not introduced by this work)

| File | Line | Rule | Severity |
| --- | --- | --- | --- |
| `src/App.tsx` | 226 | `setState` synchronously within an effect | error |
| `src/App.tsx` | 317 | `setState` synchronously within an effect | error |
| `src/components/PracticeAnalytics.tsx` | 226 | impure function during render (`Date.now`) | error |
| `src/components/PracticeSetupModal.tsx` | 7 | `react-refresh/only-export-components` | error |
| `src/pages/QuestionPage.tsx` | 706 | `setState` synchronously within an effect | error |
| `src/pages/QuestionPage.tsx` | 428 | unnecessary `useMemo` dependencies | warning |
| `src/pages/QuestionPage.tsx` | 738 | missing effect dependencies | warning |

---

## 2. Phase 1A — public application tests

### 2.1 Home

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| A1 | Load `/` | HTTP 200, discovery renders | 200; `Showing 35 of 35 questions`; H1 + `Total Questions` visible | PASS |
| A2 | Title | Contains `QueryVanta` | `QueryVanta — Free SQL & PySpark Practice for Data Engineering` | PASS |
| A3 | Built-in catalog size | 35 questions | `Showing 35 of 35 questions` | PASS |
| A4 | Refresh | Same content | Identical after reload | PASS |
| A5 | Console errors | none | none | PASS |

### 2.2 Primary navigation

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| B1 | Nav → `/learn` | correct route + refresh | `/queryvanta/learn`, breadcrumbs + path list render, refresh stable | PASS |
| B2 | Nav → `/progress` | correct route + refresh | `/queryvanta/progress`, `Progress Dashboard` renders | PASS |
| B3 | Nav → `/interview` | correct route + refresh | `/queryvanta/interview`, `Mock Interview Setup` renders | PASS |
| B4 | Back / forward | restore routes | Back → `/`, forward → `/learn` | PASS |
| B5 | Mobile drawer | opens, links reachable, closes | `Learn` link box `x=12` when open, `x=-240` when closed via backdrop | PASS |

### 2.3 SEO landing pages (all 7)

Each verified for direct load, HTTP 200, unique title, description
> 50 chars, `robots: index,follow`, canonical, OG title containing
`QueryVanta`, visible breadcrumbs, parseable JSON-LD, refresh stability
and crawlable internal links.

| Page | H1 | Questions listed | Status |
| --- | --- | --- | --- |
| `/sql-practice` | Free SQL Practice Online | 24 | PASS |
| `/pyspark-practice` | Free PySpark Practice Online | 11 | PASS |
| `/data-engineering-practice` | Data Engineering Practice Questions | 35 | PASS |
| `/sql-interview-prep` | SQL Interview Preparation | 15 (Medium+Hard SQL) | PASS |
| `/pyspark-interview-prep` | PySpark Interview Preparation | 8 (Medium+Hard PySpark) | PASS |
| `/data-analyst-sql` | SQL for Data Analysts | subset by category | PASS |
| `/big-data-practice` | Big Data Practice | subset by category | PASS |

### 2.4 Question discovery

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| C1 | Search narrows list | fewer than 35 | 5 for `join` | PASS |
| C2 | Search syncs to URL | `?q=` present | `?q=window` | PASS |
| C3 | Clear search restores | 35 of 35, no param | restored, param removed | PASS |
| C4 | Difficulty filter | exact bucket | `difficulty=Medium` → 14 | PASS |
| C5 | Engine filter | exact bucket | `type=PySpark` → 11 | PASS |
| C6 | Category filter | narrower | `Window Functions` → >0, <35 | PASS |
| C7 | Combined filters | intersection | PySpark + Medium → ≤ 11, > 0 | PASS |
| C8 | Result → question → next | navigates, prev/next preserve context | `/question/…`, Next moves to a different question | PASS |
| C9 | Breadcrumbs on question | visible | visible (`Home / SQL Practice / …`) | PASS |
| C10 | Related questions | 3–5 crawlable links | ≥ 3 | PASS |

### 2.5 Question detail (SQL representative)

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| D1 | Prompt + metadata | title, difficulty, category, run control | `High-Engagement Video Filtering`, `Easy`, `Filtering`, `Run Query` | PASS |
| D2 | Hint | hidden until requested | revealed on request | PASS |
| D3 | Solution + explanation | hidden until requested | revealed on request, `Explanation` shown | PASS |
| D4 | Starter code + reset | editor prefilled, reset restores | `SELECT` prefilled; Reset restores exact value | PASS |
| D5 | Deep link + refresh | stable | stable | PASS |

### 2.6 SQL execution (real PGlite in-browser)

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| E1 | Valid SQL graded | `Correct answer!` | `Correct answer!` in **5.4 s** | PASS |
| E2 | Invalid SQL | error shown, no crash, control re-enabled | error rendered, button re-enabled, 0 page errors | PASS |
| E3 | Empty SQL | no crash | no page errors | PASS |
| E4 | Repeated execution | stable correct | 2/2 attempts `Correct answer` | PASS |
| E5 | Stale execution cannot overwrite newer result | newer result survives | `pg_sleep(4)` result did not clobber the newer correct result after 10 s | PASS |
| E6 | Result table | table renders | table visible | PASS |
| E7 | Session continuity | navigate away/back, no corruption | no page errors | PASS |

### 2.7 PySpark execution — **BLOCKED by environment**

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| F1 | Cross-origin isolation | `crossOriginIsolated === true`, `SharedArrayBuffer` present | `{"crossOriginIsolated":true,"hasSharedArrayBuffer":true}` | PASS |
| F2 | Valid PySpark graded | `Correct answer!` on real Spark | `Query failed` after **27.4 s**; `PYSPARK_REACHABLE: false` | **BLOCKED** |
| F3 | In-browser stack really runs | pyspark modules load | traceback originates at `pyspark/sql/connect/session.py:532` (`SparkSession.builder` → `client.get_config_dict`) | PASS |
| F4 | Warm re-run reuses worker | faster second run | not testable without a backend | **BLOCKED** |
| F5 | Invalid PySpark + recovery | error, then reset restores starter code | error surfaced, `Reset Code` restored original | PASS |
| F6 | Diagnostics page | loads | loads, no page errors | PASS |

**Root cause of F2/F4 (environment, not application):** the Spark
Connect backend is not running. `Test-NetConnection localhost -Port
8081` returns `False`, and `docker ps` fails with
`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`
(Docker Desktop is not started). The browser-side stack is proven
healthy by F3: Pyodide booted, the pinned pyspark wheels installed and
`SparkSession` construction was attempted; the failure is the network
call to `localhost:8081`.

**To unblock:** start the Spark Connect + Envoy stack
(`docker/`) so port 8081 listens, then re-run
`npx playwright test --project=desktop tests/e2e/05-pyspark-execution.spec.ts`.

> **UPDATE — this limitation no longer applies.** Later in the same
> session the Spark Connect backend became reachable. The PySpark
> suite was re-run and now records:
>
> ```
> PYSPARK_ENV: {"crossOriginIsolated":true,"hasSharedArrayBuffer":true}
> PYSPARK wall=41.4s verdict="Correct answer!" reachable=true
> PYSPARK_RESULT: PASS (real Spark execution)
> PYSPARK_STARTER: correctly graded incorrect (raw 5 rows vs 3-row aggregation)
> ```
>
> Real Spark 4.2.0 execution and real grading, on both desktop and
> mobile. The baseline table above is retained unchanged as the
> point-in-time record. See
> `docs/qa/post-implementation-browser-audit.md`.

### 2.8 Learning

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| G1 | `/learn` lists paths | all 6 paths with real counts | `SQL Foundations 0 of 24`, `SQL Advanced 0 of 15`, `PySpark Foundations 0 of 10`, `PySpark Advanced 0 of 8`, `Data Engineering Core 0 of 29`, plus interview prep | PASS |
| G2 | Every path opens | breadcrumbs + heading | all 6, no console errors | PASS |
| G3 | Topic deep link | questions listed | `Window Functions 0 of 6 completed`, `Employee Department Ranking`, `Running Order Totals` | PASS |
| G4 | Topic practice launch | session with `origin=learning` | navigated to `/practice`, session contains `learning` | PASS |
| G5 | Unknown topic | not-found state | `Topic not found` | PASS |
| G6 | Unknown path | not-found state | `Learning path not found` | PASS |
| G7 | Weak areas empty state | explains why empty | `Practice Weak Areas` + `Not enough practice data yet.` | PASS |
| G8 | Quick preset | launches learning session | `/practice`, session contains `learning` | PASS |

### 2.9 Practice

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| H1 | Empty state | clear message | `No active practice session` | PASS |
| H2 | Setup dialog semantics | `role=dialog`, `aria-modal=true`, size + order controls | all present (`5/10/20/All Available (35)`, Sequential/Random) | PASS |
| H3 | 5-question session | `1 of 5` | `1 of 5` | PASS |
| H4 | 10-question session | `1 of 10` | `1 of 10` | PASS |
| H5 | 20-question session | `1 of 20` | `1 of 20` | PASS |
| H6 | All-available session | `1 of 35` | `1 of 35` | PASS |
| H7 | Random mode | recorded in session | sessionStorage contains `"random"` | PASS |
| H8 | Refresh + resume | session intact | survives reload, still `active` | PASS |
| H9 | Finish produces summary | factual summary | `Practice Complete 5 Questions · 0 Completed · 5 Not Completed` | PASS |
| H10 | Duplicate finish protection | no second history entry | `1` after first finish, `1` after second attempt | PASS |

### 2.10 Progress / analytics (values cross-checked against storage)

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| I1 | Empty state totals | catalog-derived | `Solved 0 / 35 · 0%`, `SQL 0 / 24`, `PySpark 0 / 11`, `Easy 0 / 12`, `Medium 0 / 14`, `Hard 0 / 9`, `No attempts yet` | PASS |
| I2 | Solved count reflects storage | `1` solved → `1 / 35`, `Easy 1 / 12`, `SQL 1 / 24`, `Unsolved 34` | exactly those values, `· 3%` (1/35 rounded) | PASS |
| I3 | Deep link + refresh | stable | stable | PASS |

### 2.11 Interview

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| J1 | Setup controls | 4 presets, sizes 5/10/15/20, type, difficulty, order, timing | all present | PASS |
| J2 | Preparation guides | links to landing pages | `Interview preparation guides` nav visible | PASS |
| J3 | SQL untimed interview | session, no `endsAt` | `origin=interview`, no `endsAt` | PASS |
| J4 | PySpark interview | session | `origin=interview` | PASS |
| J5 | Timed timer | visible countdown | `30:00` | PASS |
| J6 | Timer survives refresh | absolute `endsAt` | `30:00` before and after reload; session contains `endsAt` | PASS |
| J7 | Manual finish | factual summary, no invented score | `Time used 0:29 29:31 remaining at finish`; no `Score: n/m` | PASS |

### 2.12 Bookmarks and history

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| K1 | Bookmark toggle | one id stored | `high-engagement-video-filtering` | PASS |
| K2 | Persistence | survives reload | identical value | PASS |
| K3 | Bookmark filter | `Showing 1 of 35` | matches | PASS |
| K4 | Removal | storage cleared | `[]` | PASS |
| L1 | History entry | one entry with origin metadata | 1 entry, fields `["sessionId","startedAt","finishedAt","questionIds","totalQuestions","completedQuestionIds","completedCount","availableCount","launchSearch","selectionMode","status","origin"]` | PASS |

---

## 3. Phase 1B — current admin behaviour

**Storage classification: (A) browser-local.** Admin questions are stored
exclusively in `window.localStorage` under the key
`queryvanta-admin-questions` (`src/lib/adminQuestions.ts:9`). There is no
backend, no bundling into the app build, and no sharing. Evidence below.

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| M1 | Direct `/admin/questions` with clean profile | — | HTTP 200, full CRUD reachable | PASS (see F-01) |
| M2 | All admin controls present | create/preview/export/import | all four visible | PASS |
| M3 | Client-side validation | rejects incomplete | `Please fix the following errors` + `Category is required.` + `Starter SQL is required.`; nothing persisted | PASS |
| M4 | Valid create | question appears + persists | banner `Question "…" created successfully`; survives reload | PASS |
| M5 | Storage location | localStorage | `queryvanta-admin-questions` contains the record | PASS (see F-02) |
| M6 | Cross-context isolation | separate profile does not see it | context B had no `Context A Only` | PASS (see F-02) |
| M7 | Public discovery reflects admin questions | count increases | `Showing 36 of 36 questions` | PASS |
| M8 | Disable | removed from public catalog, kept in admin | `enabled: true` → `false`; public `35 of 35`; still in admin list | PASS |
| M9 | Re-enable | restored | `enabled: false` → `true`; public `36 of 36` | PASS |
| M10 | Duplicate | new record + opens for editing | ids `audit-duplicate, admin-1790468457356-6usw50` | PASS |
| M11 | Delete is two-step | first click only arms | button becomes `Confirm delete`; nothing deleted until second click | PASS |
| M12 | Delete removes only the target | other records + built-ins intact | target gone; built-in catalog still 35 | PASS |
| M13 | Built-in list | 35 / 24 SQL / 11 PySpark | exact | PASS |
| M14 | Preview (fresh draft) | navigates to `/admin/preview` | navigated, question rendered | PASS |
| M15 | Preview after create | — | does **not** navigate | FAIL (see F-03) |

---

## 4. Phase 1C — responsive and accessibility

Measured on Chromium at 1280x720 and 390x844 (touch, mobile UA).

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| N1 | Horizontal overflow, desktop | ≤ 2 px, all 9 routes | 0 px on every route | PASS |
| N2 | Horizontal overflow, mobile | ≤ 2 px | `/admin/questions` = **6 px**; all other routes 0 px | FAIL (see F-04) |
| N3 | Focus visibility | visible outline | first Tab stop outline `solid 2px` | PASS |
| N4 | Button accessible names | every button named | `unnamed buttons: []` | PASS |
| N5 | Mobile drawer | opens / closes | open `x=12`, closed `x=-240` | PASS |
| N6 | 404 route | not-found + `noindex,follow` | `Page not found`, `noindex,follow` | PASS |
| N7 | Canonical base path | never drops `/queryvanta/` | all 5 audited routes correct | PASS |

Accessibility gaps found (see F-05): the three **discovery filter
selects** on `/` (Question type, Category, Difficulty) have no
accessible name, and the **admin filter selects** lack `<label for>`
associations (they rely on `aria-label`, which they do have, but the
`Category` form input collides with the `Filter by category` select
under substring label matching).

---

## 5. Phase 1D — reliability

| # | Test | Expected | Observed | Status |
| --- | --- | --- | --- | --- |
| O1 | Uncaught exceptions | none | `pageErrors: []` on `/`, `/learn`, `/interview`, `/sql-practice`, question page | PASS |
| O2 | Console errors | none | `consoleErrors: []` | PASS |
| O3 | Route 404 handling | in-app not-found | rendered by the SPA | PASS |
| O4 | Refresh failures | none across routes | none | PASS |
| O5 | Stale async results | newer result wins | guard held under `pg_sleep(4)` race | PASS |
| O6 | Double-submit / duplicate finish | idempotent | single history entry | PASS |
| O7 | Empty states | present | practice, progress, weak areas, admin | PASS |
| O8 | Unexpected crashes | none | none | PASS |

---

## 6. Findings

| ID | Severity | Area | Problem | Evidence | Recommended action |
| --- | --- | --- | --- | --- | --- |
| F-01 | **Critical** | Admin authz | `/admin/questions` and `/admin/preview` grant full question CRUD to any visitor. There is no server, no session, no identity check. Any visitor can rewrite the question catalog for their own browser. | M1: clean profile → HTTP 200 with `Create Question`, `Preview Question`, `Export Questions`, `Import Questions` all visible. Source: `src/main.tsx` routes `/admin/questions` straight to `AdminPage`. | Replace with server-enforced GitHub OAuth + HttpOnly session. Unauthenticated requests must be redirected to `/admin/login` and every admin API must independently verify the session. |
| F-02 | **High** | Data model | Admin-created questions are **browser-local only** (`localStorage["queryvanta-admin-questions"]`). They are not shared, not backed up, and are lost when storage is cleared. "Question Management" implies a shared catalog. | M5: record present in localStorage. M6: a second browser context saw nothing. | Persist to D1 behind authenticated admin APIs; add an explicit, reviewable migration of existing local records. |
| F-03 | Low | Admin UX | After a successful create, `Preview Question` silently fails: `handleSubmit` calls `resetForm()` (AdminPage.tsx:974), so the form-level Preview validates an empty form and only shows validation errors. | M15: click did not navigate; `Please fix the following errors` shown. Row-level `Preview` works. | Reset the form only when the user asks, or route the button to preview the last created question. |
| F-04 | Low | Responsive | `/admin/questions` overflows the viewport by 6 px at 390 px width, making the per-row action cluster (`Open / Preview / Delete / Duplicate`) partially unreachable. Root cause: the action wrapper is `ml-auto flex shrink-0 flex-wrap items-center gap-2` — `shrink-0` prevents compression and `ml-auto` pins it right. | N2: `overflow[/admin/questions] = 6px` on mobile, `0px` on desktop. Element bounds measured: action `<span>` left=57 width=339 right=396 > 390. | Allow the cluster to shrink/wrap (`min-w-0`, drop `shrink-0`) or stack actions below the metadata on small screens. |
| F-05 | Low | Accessibility | The three discovery filter `<select>` elements on `/` have no `aria-label` and no `<label for>`; keyboard/AT users get unlabelled comboboxes. | N4 covers buttons only. Source: `src/components/QuestionFilters.tsx` selects at lines 96/124/153 have no accessible name. | Add `aria-label` ("Filter by question type", "Filter by category", "Filter by difficulty"). |
| L-01 | Known limitation | Hosting | GitHub Pages returns **HTTP 404** for every client-side deep link while still serving the correct document (the deploy workflow copies `index.html` to `404.html`). Content is correct; only the status code is wrong. This is what causes the 21 production-only failures, not an application defect. | `prod-404.spec.ts` — `/learn`, `/progress`, `/practice`, `/admin/questions`, `/learn/topic/window-functions` all `status=404` and `rendered=true`. | Fixed by the Cloudflare Worker deployment, which can serve a real SPA fallback with HTTP 200. Keep the Pages workflow as a fallback meanwhile. |
| L-02 | Blocked (environment) | PySpark | Real Spark execution cannot be verified: no Spark Connect backend. The browser stack itself is proven healthy. | F1–F6 above; port 8081 closed; Docker Desktop not running. | Start the `docker/` stack and re-run the PySpark spec. |
| F-06 | Informational | Lint | 5 lint errors + 2 warnings pre-exist at `b4c8bb1` (`setState` in effects, `Date.now` in render, react-refresh export, effect deps). | Table in section 1. | Address separately; unrelated to this milestone and behaviour-risky to change blind. |
