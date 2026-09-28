# QueryVanta — Admin Persistence Architecture

How the question catalog became a shared, server-persisted resource
without breaking the browser-local application.

## Before

```
GitHub repo
   └── GitHub Pages  (static)
         └── React app
               └── questions = bundled catalog
                                + localStorage["queryvanta-admin-questions"]
```

Admin questions lived only in the visitor's own browser. They were
never shared, never backed up, and vanished when storage was cleared,
while the UI implied a shared catalog. Recorded as findings
**F-01** (critical) and **F-02** (high) in
`docs/qa/baseline-browser-audit.md`.

## After

```
GitHub repo
   └── Cloudflare Worker  (one origin)
         ├── Workers Static Assets → dist/  (SPA)
         ├── /api/auth/*      → GitHub OAuth + sessions
         ├── /api/questions/* → public read-only
         ├── /api/admin/*     → protected CRUD + audit
         └── D1  (SQLite)
               ├── questions
               ├── admin_sessions
               ├── oauth_transactions
               └── admin_audit_log

GitHub Pages  ── preserved as a fallback (static, no admin)
```

Static assets and the API share an origin, so the session cookie is
first-party: no CORS, no third-party-cookie blocking, and
`SameSite=Lax` is meaningful.

## Data flow

The rest of QueryVanta reads the catalog **synchronously** from one
place: the bundled catalog plus the
`queryvanta-admin-questions` `localStorage` record. Rather than
rewriting every consumer, the server is the source of truth for
*administration*, and published server questions are **mirrored into
that same key** by `src/lib/adminServerSync.ts`.

```
AdminPage mutation
   ├── local write  (immediate UI, unchanged behaviour)
   └── server call  (source of truth)
         └── syncFromServer()
               └── writes enabled AND published rows → localStorage
                     └── dispatchEvent(ADMIN_QUESTIONS_EVENT)
                           └── every consumer re-reads, as before
```

Consequences:

- Discovery, practice, learning, interview and progress needed **no
  changes**. They keep reading `getActiveQuestions()`.
- A **draft or disabled** server question is never mirrored, so it
  cannot appear in the public catalog.
- On GitHub Pages (no backend) `serverBackedSessionActive()` returns
  false and the app keeps its previous browser-local behaviour, so the
  existing deployment is not broken.
- `solved` is per-learner browser state and is never persisted
  server-side; it is merged back from the local record.

## Schema

`migrations/0001_init.sql` mirrors the existing TypeScript model
**exactly** — the column set was derived from
`src/data/questions.ts`, not invented. `solved` is intentionally
absent because it is learner state, not catalog data.

### questions

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$` |
| `title` | TEXT | |
| `description` | TEXT | |
| `difficulty` | TEXT | `CHECK IN ('Easy','Medium','Hard')` |
| `question_type` | TEXT | `CHECK IN ('SQL','PySpark','Data Modeling','Data Engineering','Architecture')` |
| `category` | TEXT | |
| `languages` | TEXT | JSON array |
| `tags` | TEXT | JSON array |
| `companies` | TEXT | JSON array |
| `database_json` | TEXT | `QuestionDatabase` `{ engine, tables[] }` |
| `starter_code` | TEXT | |
| `hint` | TEXT | |
| `solution_code` | TEXT | |
| `explanation` | TEXT | |
| `validation_json` | TEXT | `{ type: 'result', orderMatters, expectedResult[] }` |
| `enabled` | INTEGER | `CHECK IN (0,1)` |
| `published` | INTEGER | `CHECK IN (0,1)` |
| `deleted_at` | TEXT | soft delete |
| `source` | TEXT | `CHECK IN ('builtin','admin','import')` |
| `version` | INTEGER | optimistic concurrency |
| `created_at` / `updated_at` | TEXT | ISO 8601 |
| `created_by` / `updated_by` | TEXT | GitHub numeric id |

Nested structures are stored as JSON text rather than split across
columns, which keeps the shape identical to the TypeScript model and
makes round-tripping lossless.

### Indexes

| Index | Serves |
| --- | --- |
| `idx_questions_public (published, enabled, deleted_at, updated_at DESC)` | public discovery |
| `idx_questions_type (question_type, published, enabled)` | engine filter |
| `idx_questions_category (category, published, enabled)` | topic filter |
| `idx_questions_difficulty (difficulty, published, enabled)` | difficulty filter |
| `idx_questions_updated (updated_at DESC)` | admin ordering |
| `idx_questions_created (created_at)` | correlation |

### admin_sessions

`id`, `admin_github_id`, `github_login`, `github_avatar_url`,
`token_hash` (UNIQUE), `csrf_token`, `created_at`, `updated_at`,
`last_seen_at`, `expires_at`, `revoked_at`.
Indexed on `token_hash`, `expires_at`, `admin_github_id`.

### oauth_transactions

`state_hash` PK, `code_verifier`, `redirect_to`, `created_at`,
`expires_at`, `consumed_at`. Indexed on `expires_at`.

### admin_audit_log

`id` PK, `actor_github_id`, `actor_login`, `action`, `question_id`,
`outcome`, `metadata_json`, `created_at`.
Indexed on `created_at DESC`, `(actor_github_id, created_at DESC)`,
`(question_id, created_at DESC)`, `(action, created_at DESC)`.

Audit metadata is restricted to an allow-list of scalar keys
(`reason`, `count`, `imported`, `skipped`, `conflicts`, `failed`,
`source`, `version`, `published`, `enabled`, `githubId`, `endpoint`,
`method`, `status`) and capped at 200 characters per value, so a token
can never be smuggled into the log.

## Public visibility rule

Enforced **in SQL**, not in the row mapper:

```sql
enabled = 1 AND published = 1 AND deleted_at IS NULL
```

A newly created question is `published = 0`, so it is a draft until an
administrator explicitly publishes it. A code change in the mapper
cannot leak it. Verified by the tests "never exposes a draft question
publicly" and "never exposes a disabled question publicly".

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | liveness |
| GET | `/api/auth/session` | optional | current admin + CSRF token |
| GET | `/api/auth/github` | none | start OAuth |
| GET | `/api/auth/github/callback` | state+PKCE | complete OAuth |
| POST | `/api/auth/logout` | session + CSRF | revoke session |
| GET | `/api/questions` | none | published questions (filterable) |
| GET | `/api/questions/:id` | none | one published question |
| GET | `/api/admin/questions` | session | all non-deleted questions |
| POST | `/api/admin/questions` | session + CSRF | create, or bulk import |
| GET | `/api/admin/questions/:id` | session | read one |
| PUT | `/api/admin/questions/:id` | session + CSRF | update (version-checked) |
| DELETE | `/api/admin/questions/:id` | session + CSRF | soft delete |
| POST | `/api/admin/questions/:id/duplicate` | session + CSRF | copy as a draft |
| POST | `/api/admin/questions/:id/publish` | session + CSRF | publish |
| POST | `/api/admin/questions/:id/disable` | session + CSRF | disable |
| POST | `/api/admin/questions/:id/enable` | session + CSRF | enable |
| GET | `/api/admin/audit` | session | audit entries |

## Conflict and delete semantics

- **Create** with an existing id → `409 conflict`. No silent overwrite.
- **Update** with a stale `version` → `409 conflict`. Optimistic
  concurrency prevents one administrator silently discarding another's
  edit.
- **Delete** is a **soft delete**: the row is retained with
  `deleted_at` set, `enabled` and `published` forced to 0. Historical
  audit entries and past sessions keep a resolvable reference. The
  public predicate already excludes it.

## Migration of existing browser-local questions

Deliberate, administrator-initiated, and never automatic.

1. `AdminPage` detects an active server session and shows a **Shared
   catalog** panel.
2. **Migrate browser-local questions** reports the exact count and
   asks for confirmation.
3. On confirm, the local records are posted to
   `POST /api/admin/questions` as a bulk import.
4. The server reports `imported` / `skipped` / `conflicts` / `failed`,
   and each failure carries `{ id, reason }`.
5. Existing ids are **skipped, never overwritten**, so a newer
   server-side question is preserved.
6. Imported questions land as `published = 0` — **drafts**, so a bulk
   import cannot make something public without review.

Verified by the test "imports legacy browser-local questions without
overwriting".

**Export** (`Export Questions`, unchanged) continues to download
`queryvanta-admin-questions.json`, so an administrator always has a
portable copy.

## Base path

The Worker serves at `/`; GitHub Pages serves at `/queryvanta/`. The
deployment target is an explicit build argument, not an ambient
environment variable:

- `config/deploy-targets.ts` is the single source of truth for each
  target's `base` and public `siteUrl`.
- `npm run build:worker` → base `/`, origin
  `https://queryvanta.queryvanta.workers.dev`.
- `npm run build:pages` → base `/queryvanta/`, origin
  `https://eagleanurag.github.io/queryvanta`. `npm run build` is an
  alias of this, because the live Pages workflow runs it.
- `vite.config.ts` resolves the base from the target table via
  `QV_TARGET`, which the build wrapper sets. `QV_BASE` is still
  honoured as an ad-hoc override, but is not the supported entry
  point.
- The router uses `basename={import.meta.env.BASE_URL}`.
- The API client resolves against `import.meta.env.BASE_URL`, or an
  explicit `VITE_QV_API_BASE` when the API lives on another origin.
  This holds a public URL only — never a credential.
- The SEO generator and `src/lib/seo.ts` read the same target table,
  so `sitemap.xml`, canonical URLs, Open Graph tags and the favicon
  path always match the deployment actually serving the site.

### Why the target is an argument

Setting `QV_BASE` by hand worked, which is exactly why it shipped a
broken bundle: nothing tied `dist/` to the deployment target, so
whichever `npm run build` ran last decided what `wrangler deploy`
uploaded. The default was the Pages base, so an ordinary build
produced a Pages bundle and the Worker then served
`/queryvanta/assets/...`, which the SPA fallback answered with
`index.html` as `text/html`. Chromium refused the module and every
page rendered blank.

Three mechanisms now prevent a repeat:

1. `scripts/build.mjs` records the target in `.qv-build.json` and
   runs `scripts/verify-build.mjs` on every build.
2. `npm run verify:worker` is a hard pre-deploy gate over the real
   `dist/`, and prints the remediation `npm run build:worker`.
3. `tests/e2e/13-worker-build-base.spec.ts` drives the real Worker in
   a browser and fails if any request is made under `/queryvanta/`
   or any module is served as `text/html`.

Both verifiers ignore comments when scanning bundles, because
`public/worker/pyspark-test-worker.js` legitimately documents that it
also runs under a project-pages subpath. A guard that fails on
accurate documentation gets switched off; `config/source-scanner.ts`
is unit tested for this.

## Rollback

The GitHub Pages workflow is untouched. Reverting the app to the
Pages-only behaviour is a code revert; no data migration is required,
because D1 is additive and the localStorage mirror still works.
