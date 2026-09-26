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
npm run build      # TypeScript + production build
npm run lint       # ESLint
git diff --check   # whitespace check
```

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
  fails with an explanatory error and everything else keeps working.
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

| Route | Page |
| --- | --- |
| `/` | Questions discovery |
| `/question/:questionId` | Question workspace |
| `/practice` | Active practice / interview session |
| `/practice/history/:sessionId` | Historical session review |
| `/learn` | Learning home |
| `/learn/:pathId` | Learning path detail |
| `/learn/topic/:topicId` | Topic explorer |
| `/interview` | Interview setup |
| `/progress` | Progress + practice analytics |
| `/admin`, `/admin/questions` | Admin + Question Management |
| `/admin/preview` | Admin question preview |
| `/pyspark-test` | PySpark engine diagnostics |
| any other path | Not-found page |

## Browser storage keys

| Key | Store | Contents |
| --- | --- | --- |
| `queryvanta-admin-questions` | localStorage | Admin-managed questions |
| `queryvanta-solved-questions` | localStorage | Solved question IDs |
| `queryvanta-bookmarked-questions` | localStorage | Bookmarked question IDs |
| `queryvanta-practice-history` | localStorage | Finished sessions (max 20) |
| `queryvanta-question-attempts` | localStorage | Execution attempts (max 10/question) |
| `queryvanta-practice-session` | sessionStorage | Active session (incl. interview deadline) |

All readers tolerate missing or malformed data and fall back to safe
defaults without touching unrelated keys.
