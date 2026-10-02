/**
 * Boots a production-like environment for the admin catalog test:
 *
 *   - the real Worker serving the BUILT dist/ bundle
 *   - a real local D1 database with the schema applied
 *   - a minted administrator session cookie
 *   - one seeded DRAFT question in D1
 *
 * Writes the connection details to a JSON file that the Playwright
 * spec consumes, then keeps the Worker alive until told to stop.
 *
 * Usage:
 *   node --experimental-strip-types server/tests/admin-env.ts up
 *   node --experimental-strip-types server/tests/admin-env.ts down
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_ORIGIN,
  mintSession,
  runWrangler,
  WORKER_ORIGIN,
  WORKER_PORT,
  SESSION_SECRET,
  TEST_ADMIN_ID,
  initPersistPath,
  writeDevVars,
  persistPath,
} from "./harness.ts";

import { applyMigrations } from "../../scripts/migrate.mjs";

const INFO_PATH = join(
  process.cwd(),
  "server",
  "tests",
  ".admin-env.json",
);

export const SEED_ID = "test-prod-d1-crud-001";
export const SEED_TITLE = "TEST - Production D1 CRUD";

const SESSION_TOKEN =
  "f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f00";
const CSRF_TOKEN = "admin-env-csrf-token-000000000000000";

function seedDraftQuestion(now: string): void {
  // Written straight into D1 so the test starts from the exact state
  // reported in production: one draft (published = false).
  const payload = JSON.stringify({
    engine: "PostgreSQL",
    tables: [
      {
        name: "orders",
        columns: [
          { name: "id", type: "INTEGER" },
          { name: "amount", type: "DECIMAL" },
        ],
        rows: [{ id: 1, amount: 10 }],
      },
    ],
  });

  const validation = JSON.stringify({
    type: "result",
    orderMatters: false,
    expectedResult: [{ id: 1, amount: 10 }],
  });

  runWrangler([
    "d1",
    "execute",
    "queryvanta",
    "--local",
    "--persist-to",
    persistPath as string,
    "--command",
    `DELETE FROM questions WHERE id = '${SEED_ID}'; ` +
      `INSERT INTO questions (id, title, description, difficulty, question_type, category, languages, tags, companies, database_json, starter_code, hint, solution_code, explanation, validation_json, enabled, published, deleted_at, source, version, created_at, updated_at, created_by, updated_by) ` +
      `VALUES ('${SEED_ID}', '${SEED_TITLE}', 'Seeded draft used by the admin catalog test.', 'Easy', 'SQL', 'Aggregation', '["PostgreSQL"]', '["SELECT"]', '[]', '${payload.replace(/'/g, "''")}', 'SELECT * FROM orders;', 'Order by id.', 'SELECT * FROM orders ORDER BY id;', 'Selecting all columns ordered by id.', '${validation.replace(/'/g, "''")}', 1, 0, NULL, 'admin', 1, '${now}', '${now}', '${TEST_ADMIN_ID}', '${TEST_ADMIN_ID}')`,
    "--yes",
  ]);
}

async function waitForWorker(
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${WORKER_ORIGIN}/api/health`,
      );

      if (response.ok) {
        return true;
      }
    } catch {
      // Not up yet.
    }

    await new Promise((done) => setTimeout(done, 400));
  }

  return false;
}

async function up(): Promise<void> {
  writeDevVars();
  initPersistPath();

  const { spawn } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { createWriteStream } = await import("node:fs");

  const log = createWriteStream(
    join(tmpdir(), `qv-admin-env-${WORKER_PORT}.log`),
    { flags: "a" },
  );

  const child = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--local",
      "--port",
      String(WORKER_PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistPath as string,
      "--log-level",
      "error",
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  // Detach so this script can exit while the Worker keeps serving.
  child.unref();

  const ready = await waitForWorker(120_000);

  if (!ready) {
    throw new Error("Worker did not start");
  }

  // Every migration, discovered rather than named. Hard-coding
  // `0001_init.sql` here meant this environment's database silently
  // lacked `0002_analytics.sql`, so the analytics ingest endpoint
  // returned 500 and the admin analytics e2e suite could not run at all.
  applyMigrations({
    local: true,
    persistTo: persistPath as string,
    database: "queryvanta",
  });

  const now = new Date().toISOString();

  mintSession({
    adminGithubId: TEST_ADMIN_ID,
    token: SESSION_TOKEN,
    csrfToken: CSRF_TOKEN,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  seedDraftQuestion(now);

  writeFileSync(
    INFO_PATH,
    JSON.stringify(
      {
        origin: WORKER_ORIGIN,
        appOrigin: APP_ORIGIN,
        cookieName: "qv_admin_session",
        cookieValue: SESSION_TOKEN,
        csrfToken: CSRF_TOKEN,
        sessionSecret: SESSION_SECRET,
        adminId: TEST_ADMIN_ID,
        seedId: SEED_ID,
        seedTitle: SEED_TITLE,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `admin-env up on ${WORKER_ORIGIN} (port ${WORKER_PORT})`,
  );
  console.log(`info written to ${INFO_PATH}`);
}

const command = process.argv[2];

if (command === "up") {
  await up();
} else {
  console.log("usage: admin-env.ts up");
}
