# QueryVanta

QueryVanta is a browser-local Data Engineering learning and interview-practice
platform: question discovery, real SQL execution, real browser PySpark
execution, structured learning paths, timed mock interviews, practice
analytics, and admin question management — with no backend.

## What it does

- **Questions discovery** — search, filter (type, difficulty, language,
  company, status, category, bookmarks) with URL-synced filters, pagination,
  and previous/next navigation that preserves the discovery context.
- **SQL execution** — PostgreSQL runs directly in the browser via PGlite;
  answers are validated against expected result sets.
- **PySpark execution** — real Spark 4.2.0 execution in the browser through a
  Pyodide Web Worker + Spark Connect (see “PySpark requirements” below).
- **Learning help** — hints, solutions and explanations per question. Viewing
  them never marks anything solved.
- **Bookmarks & solved progress** — persisted locally, synced across tabs.
- **Practice sessions** — sequential or random, bookmarked sets, frozen
  question order, resume after refresh, review, and a bounded history
  (latest 20) with analytics.
- **Learning** (`/learn`) — learning paths generated from live catalog
  metadata, topic explorer, deterministic weak-area practice, and quick
  practice presets.
- **Interview practice** (`/interview`) — SQL / PySpark / mixed mock
  interviews, timed (15/30/45/60 min) or untimed, with an absolute persisted
  end timestamp, auto-finish at expiry, and factual summaries (no fake
  scores).
- **Admin Question Management** (`/admin/questions`) — create, edit,
  duplicate, preview, enable/disable, delete (two-step confirm), JSON
  import/export, and real SQL / PySpark validation of solution code.

All application data lives in the browser (`localStorage` for catalog
overrides, progress, bookmarks, history and attempts; `sessionStorage` for
the active practice session). There is no backend, no account, and no
network dependency except the Spark Connect proxy required for PySpark.

## Development

Requirements: Node.js 22+, Docker (only for the optional local Spark stack
used by PySpark execution).

```sh
npm install
npm run dev        # serves on http://localhost:5173 with COOP/COEP headers
```

Optional local Spark stack (needed for PySpark execution and validation):

```sh
docker compose up -d   # provides the Envoy grpc-web proxy + Spark Connect
```

Quality checks:
```sh
npm run build           # TypeScript + production build
npm run lint            # ESLint
git diff --check        # whitespace check
npm run test:unit       # secret-exposure checks (reads real dist/)
npm run test:security   # security suite against a real local Worker + local D1
npm run test:worker     # production-like Worker asset/API suite
npm run test:server     # all of the above
npm run test:browser    # Playwright E2E (desktop + mobile)
```

Browser tests target `QV_BASE_URL` (which must keep its trailing
slash) and navigate with base-relative paths:

```sh
npm run dev -- --port 5173 --strictPort
$env:QV_BASE_URL = "http://localhost:5173/queryvanta/"
npm run test:browser
```

The server suites boot their own Worker on port 8787 against a
throwaway local D1 database, and tear it down afterwards.

Two suites need a live Worker serving the real built bundle and skip
unless `QV_BASE_URL` points at `server/tests/.admin-env.json`:

```sh
npm run build:worker
node --experimental-strip-types server/tests/admin-env.ts up
$env:QV_BASE_URL = "http://127.0.0.1:<port printed by the script>/"
npx playwright test tests/e2e/12-admin-d1-catalog.spec.ts tests/e2e/13-worker-build-base.spec.ts
```

They only ever touch a **local** D1. `12-` proves the admin catalog
comes from D1 (TEST A–J); `13-` proves a Worker build never requests
`/queryvanta/assets/` and never serves a module as `text/html`.

## Architecture

QueryVanta is a browser-local learning application with an optional
server tier for administration.

```
GitHub repo
   ├── GitHub Pages (static, existing fallback)  -> no admin
   └── Cloudflare Worker (preferred)
         ├── Workers Static Assets -> dist/  (SPA, HTTP 200 deep links)
         ├── /api/auth/*      GitHub OAuth + server sessions
         ├── /api/questions/* public read-only catalog
         ├── /api/admin/*     protected CRUD + audit log
         └── D1 (SQLite)  questions, sessions, oauth transactions, audit
```

Static assets and the API share one origin, so the administrator
session cookie is first-party — no CORS, and `SameSite=Lax` is
meaningful.

- `docs/security/admin-auth.md` — authentication and session model.
- `docs/architecture/admin-persistence.md` — schema, API and data flow.
- `docs/qa/baseline-browser-audit.md` — audit **before** the change.
- `docs/qa/post-implementation-browser-audit.md` — audit **after**.

### Administrator access

`/admin/questions` and `/admin/preview` are wrapped in
`src/components/AdminGate.tsx`. That gate is **user experience only**:
every admin API endpoint independently verifies the server session, so
removing the gate would grant nothing. Sign-in is GitHub OAuth with
PKCE, and authorization uses the **immutable GitHub numeric user id**.

On a deployment with no backend (GitHub Pages) the gate detects this
and disables question management with an explanation, rather than
offering a client-only password check.

### Question storage

- The bundled catalog in `src/data/questions.ts` is unchanged and
  always wins on ID collision.
- D1 is the source of truth for administration. Published server
  questions are mirrored into the existing
  `queryvanta-admin-questions` localStorage record, so discovery,
  practice, learning and interview needed no changes.
- A question is publicly visible only when `enabled AND published AND
  NOT deleted`, enforced in SQL.
- Deletion is a soft delete, so history and audit references survive.
- Existing browser-local questions are migrated deliberately from the
  admin UI (count shown, confirmation required, existing ids skipped,
  imports land as unpublished drafts). They are never auto-migrated and
  never overwritten.

### Build targets

The deployment target is an explicit argument, not an ambient
environment variable. Both deployments are built from the same
pipeline; only the base path and the public origin differ.

| Command | Base | Public origin |
| --- | --- | --- |
| `npm run build:pages` | `/queryvanta/` | `https://eagleanurag.github.io/queryvanta` |
| `npm run build:worker` | `/` | `https://queryvanta.queryvanta.workers.dev` |
| `npm run build` | alias of `build:pages` | — |

`npm run build` stays on the GitHub Pages target because the live
Pages workflow runs it; changing the default would silently repoint
the published site.

Each build:

1. regenerates `public/sitemap.xml` and the landing snapshots for
   the selected origin,
2. typechecks (`tsc -b`),
3. builds with the target base,
4. writes `.qv-build.json` (gitignored) recording the target, and
5. runs `scripts/verify-build.mjs`, which fails the build if the
   artefact does not match the target.

The target table lives in `config/deploy-targets.ts` and is the
single source of truth for `vite.config.ts`, the SEO generator,
`src/lib/seo.ts` and both verification scripts.

`VITE_QV_API_BASE` may point the API client at a different origin. It
is public configuration and must never carry a credential.

## Cloudflare deployment

### One-time setup

```sh
npm install
npx wrangler login

# Create the D1 database and note the id
npx wrangler d1 create queryvanta
```

Put the returned id in `wrangler.jsonc` -> `d1_databases[0].database_id`.

### GitHub OAuth app

Create an OAuth app at <https://github.com/settings/developers> ->
**OAuth Apps** -> **New OAuth App**:

- **Homepage URL**: your Worker URL, e.g.
  `https://queryvanta.example.workers.dev`
- **Authorization callback URL**:
  `https://queryvanta.example.workers.dev/api/auth/github/callback`

### Secrets and configuration

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` should be a long random value, for example:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Non-secret values live in `wrangler.jsonc` `vars`:

| Var | Purpose |
| --- | --- |
| `GITHUB_CLIENT_ID` | public OAuth client id |
| `ADMIN_GITHUB_IDS` | comma-separated **numeric** GitHub user ids allowed to administer |
| `APP_ORIGIN` | the deployment origin, used for OAuth redirects and origin checks |
| `ENVIRONMENT` | `production` for the live deployment |

Find your numeric GitHub id at `https://api.github.com/users/<your-login>`.

`ADMIN_GITHUB_IDS` **fails closed**: an empty list denies every login.

### Apply the schema and deploy

```sh
npm run build:worker
npm run d1:migrate
npm run verify:worker
npx wrangler deploy --config ./wrangler.jsonc
```

`npm run d1:migrate` applies **every** file in `migrations/`, in filename
order, via `scripts/migrate.mjs`. Do not replace it with a
`wrangler d1 execute --file=migrations/<one-file>.sql` invocation: naming a
single file silently skips the others, and the endpoint that needs the newer
table then fails in production. Every statement in every migration is
idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so
running the whole set on every deploy is safe and is the intended procedure.

One migration-file constraint is worth knowing before editing any `.sql` in
`migrations/`: `wrangler d1 execute --file` splits a file into statements
with a scanner that does not track `--` comments while looking for string
literals, so a **single-quote character inside a comment** corrupts statement
splitting. A semicolon inside a comment is fine. `server/tests/analytics.test.ts`
asserts this for every migration file.

`npm run verify:worker` is a hard gate. It inspects the real `dist/`
and refuses to let a GitHub Pages build reach the Worker — the
failure that produced blank pages with MIME-type errors, because the
browser requested `/queryvanta/assets/...` on the Worker and the SPA
fallback answered with `index.html` as `text/html`. It fails when:

- `dist/index.html` contains `/queryvanta/`
- any built JS/CSS embeds the Pages base in live code
- `dist/index.html` does not reference a root-based `/assets/...`
- the recorded build target is not `worker`, or its base is not `/`

The remediation it prints is always `npm run build:worker`.

`npm run build:worker` also runs `scripts/verify-build.mjs`, so a
malformed artefact is caught at build time rather than at deploy
time.

### Local Worker development

```sh
Copy-Item .dev.vars.example .dev.vars   # then fill in real values
npm run d1:migrate:local
npm run worker:dev
```

`.dev.vars` is gitignored. `.dev.vars.example` documents the shape
with placeholders only.

### Rollback

The GitHub Pages workflow is untouched and remains the fallback. If
the Worker deployment is abandoned, revert the code; no data migration
is required, because D1 is additive and the localStorage mirror keeps
working.

## PySpark requirements

PySpark runs against a Spark Connect endpoint through a same-origin Envoy
grpc-web proxy:

- Browser bundle requests `sc://localhost:8081/;transport=grpcweb` and loads
  the worker from `<base>/worker/pyspark-test-worker.js` (base-aware: `/`
  in dev, `/queryvanta/` in the production build; the worker itself resolves
  Pyodide/wheel assets relative to its own URL).
- `SharedArrayBuffer` requires cross-origin isolation: the dev server already
  sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless` (see `vite.config.ts`).
  **Production hosting must send equivalent headers**, otherwise PySpark boot
  fails with an explanatory error and everything else keeps working. The
  Cloudflare Worker sends them on every asset response. **GitHub Pages
  cannot send them**, so PySpark cannot boot there; SQL, learning, practice,
  interviews and reading all work normally.
- Without a reachable Spark stack, PySpark questions show a clear execution
  error after the documented 120-second timeout; SQL, learning, practice and
  admin flows are unaffected.

## Deployment (static hosting)

The production build (`dist/`, produced by `npm run build`) is a static
site with client-side routing:

- Serve `dist/` from any static host. Configure an **SPA fallback** so every
  unknown path serves `index.html` (required for deep links and refresh on
  routes such as `/learn/sql-foundations` or `/question/<id>`).
- Send the COOP/COEP headers above on all responses (required for PySpark;
  harmless otherwise).
- The production build uses Vite `base: "/queryvanta/"` for project-pages
  hosting. For domain-root hosting instead, change `base` to `"/"` (and keep
  the router `basename` on `import.meta.env.BASE_URL`) and rebuild.
- PySpark in production needs the Envoy proxy reachable at the configured
  same-origin endpoint; SQL/PGlite needs no server at all (WASM assets ship
  in `dist/assets`).
- No environment variables or secrets are required.

### GitHub Pages (configured)

Target URL: `https://eagleanurag.github.io/queryvanta/`

Deployment is automated by `.github/workflows/deploy.yml` (push to `main`
or manual dispatch): checkout → setup Node 22 → `npm ci` → `npm run build`
→ copy `dist/index.html` to `dist/404.html` → upload artifact → deploy. No
secrets are required beyond the built-in `GITHUB_TOKEN` permissions
(`contents: read`, `pages: write`, `id-token: write`).

GitHub Pages specifics and honest limitations:

- **Base path:** the build already targets `/queryvanta/`; the router uses
  the same base, so links, lazy chunks, WASM and worker assets resolve.
- **SPA fallback:** Pages offers no server rewrite config. The workflow
  ships a `404.html` duplicate of the app, so deep links and refreshes load
  the app instead of a blank GitHub 404 page. Known limitation: those loads
  return HTTP status 404 (content is correct; the in-app Not Found page is
  used only for genuinely unknown in-app addresses reached via client
  navigation).
- **PySpark on Pages:** GitHub Pages cannot send COOP/COEP headers, so pages
  are not cross-origin isolated there and `SharedArrayBuffer` is unavailable.
  Consequence, verified by design: **PySpark execution does not boot on the
  GitHub Pages deployment** (it shows the explanatory isolation error);
  everything else — SQL/PGlite, learning, practice, interviews (untimed and
  timed logic), admin — works fully. Running PySpark additionally requires
  the external Spark/Envoy service from the deployment notes above; the
  static frontend and the Spark service are separate deployment components,
  and no backend was added to this repository.

## Routes

| Route | Page | Indexed |
| --- | --- | --- |
| `/` | Questions discovery | Yes |
| `/sql-practice`, `/pyspark-practice`, `/data-engineering-practice`, `/sql-interview-prep`, `/pyspark-interview-prep`, `/data-analyst-sql`, `/big-data-practice` | Topical practice landing pages (static snapshots for crawlers, React experience in-app) | Yes |
| `/question/:questionId` | Question workspace | Yes |
| `/practice` | Active practice / interview session | No (personal) |
| `/practice/history/:sessionId` | Historical session review | No (personal) |
| `/learn` | Learning home | Yes |
| `/learn/:pathId` | Learning path detail | Yes |
| `/learn/topic/:topicId` | Topic explorer | Yes |
| `/interview` | Interview setup | Yes |
| `/progress` | Progress + practice analytics | No (personal) |
| `/admin`, `/admin/questions` | Admin + Question Management | No |
| `/admin/preview` | Admin question preview | No |
| `/pyspark-test` | PySpark engine diagnostics | No |
| any other path | Not-found page | No |

SEO implementation: per-route metadata via `src/components/SEO.tsx` +
`src/lib/seo.ts` (unique titles/descriptions, canonical URLs under
`/queryvanta/`, robots directives, Open Graph/Twitter cards, truthful
JSON-LD only). Filtered discovery states (`?q=…`, bookmark-only) canonical
to `/` with `noindex,follow`. Sitemap and static landing snapshots are
generated at build time from the canonical catalog by
`scripts/generate-seo-assets.mjs` (invoked by `scripts/build.mjs`;
`public/robots.txt`
allows public crawlers including `OAI-SearchBot` and references the
sitemap).

## Browser storage keys

| Key | Store | Contents |
| --- | --- | --- |
| `queryvanta-admin-questions` | localStorage | Published questions mirrored from D1 (or browser-local when there is no backend) |
| `queryvanta-solved-questions` | localStorage | Solved question IDs |
| `queryvanta-bookmarked-questions` | localStorage | Bookmarked question IDs |
| `queryvanta-practice-history` | localStorage | Finished sessions (max 20) |
| `queryvanta-question-attempts` | localStorage | Execution attempts (max 10/question) |
| `queryvanta-practice-session` | sessionStorage | Active session (incl. interview deadline) |
| `qv_admin_session` | cookie (HttpOnly) | Administrator session. **Never readable by JavaScript**, never mirrored into web storage. |

All readers tolerate missing or malformed data and fall back to safe
defaults without touching unrelated keys. No authentication token,
bearer token or password is ever written to web storage.

## Search Console / webmaster actions (post-deployment)

Submissions help discovery; none of them guarantees ranking.

Google:
- Verify the `https://eagleanurag.github.io/queryvanta/` property in Search
  Console, submit `sitemap.xml`, and use URL Inspection on `/`,
  `/sql-practice`, `/pyspark-practice` and one question page.
- Request indexing for the major landing pages after each content change.

Bing:
- Verify the site in Bing Webmaster Tools, submit the sitemap, and use URL
  inspection. Consider IndexNow if question content changes frequently.

OpenAI / Perplexity:
- Confirm `OAI-SearchBot` is not blocked in `public/robots.txt` (it is
  allowed). Note that `GPTBot` is a separate training crawler; allowing
  search visibility here implies no training consent.
- Confirm `PerplexityBot` is not blocked (covered by the generic allow
  rule; no bot-specific exception exists).

## Search performance monitoring

- Google Search Console: indexed page count, impressions, clicks, ranking
  queries, top landing pages, crawl errors, canonical issues. Search Console
  also provides generative-AI visibility reporting for supported
  properties — a monitoring capability, not a ranking lever.
- Bing Webmaster Tools: same coverage for Bing-powered surfaces (including
  Copilot grounding).
- Application side: nothing phones home (local-first by design), so ranking
  and click data come only from the webmaster tools above.

## Future content roadmap (not implemented)

One authoritative page per intent family; no thin keyword pages. Candidates
based on real user needs and current catalog coverage:

- SQL joins deep-dive practice set
- SQL window functions patterns
- SQL aggregation patterns
- SQL interview pattern walkthroughs
- PySpark DataFrame operations guide
- PySpark window functions practice
- Deduplication patterns (SQL + PySpark)
- Spark performance notes (only if backed by real executable content)
- Data Engineering interview preparation guide
- ETL interview problem set
- Big Data fundamentals practice set