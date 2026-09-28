/**
 * Security test harness.
 *
 * Boots the real Worker locally with `wrangler dev --local` and a
 * local D1 database, then exercises the HTTP surface exactly as a
 * browser or attacker would. Nothing is mocked except GitHub's
 * OAuth endpoints, which are unreachable by design in CI.
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  execFileSync,
  spawnSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync as readMigrationFile,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A per-process port removes every cross-run interference risk: a worker left behind
 * by an interrupted run can never be mistaken for this run's worker, and two
 * concurrent suites cannot collide.
 */
export const WORKER_PORT =
  8000 + ((process.pid * 7919) % 19000);
export const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`;
export const APP_ORIGIN = WORKER_ORIGIN;

export const TEST_ADMIN_ID = "424242";
export const OTHER_ADMIN_ID = "999999";
export const SESSION_SECRET =
  "integration-test-session-secret-0000000000";
export const CLIENT_SECRET = "integration-test-client-secret";
export const CLIENT_ID = "Iv1.integrationtest";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const devVarsPath = join(repoRoot, ".dev.vars");
const d1StatePath = join(
  repoRoot,
  ".wrangler",
  "state",
  "v3",
  "d1",
  "miniflare-D1DatabaseObject",
);

/**
 * Wrangler is invoked through its entry script with the current
 * Node binary. Going through `npx` is unreliable here because
 * `npx` is a shell script, not an executable, on Windows.
 */
const WRANGLER_BIN = join(
  repoRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

export function runWrangler(args: string[]): string {
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

let worker: ChildProcess | null = null;
export let persistPath: string | null = null;
let workerLogPath: string | null = null;

export function writeDevVars(): void {
  const body = [
    `GITHUB_CLIENT_ID=${CLIENT_ID}`,
    `GITHUB_CLIENT_SECRET=${CLIENT_SECRET}`,
    `SESSION_SECRET=${SESSION_SECRET}`,
    `ADMIN_GITHUB_IDS=${TEST_ADMIN_ID}`,
    // Must match the origin the tests send, otherwise every
    // mutation is (correctly) rejected as cross-origin.
    `APP_ORIGIN=${APP_ORIGIN}`,
    `ENVIRONMENT=development`,
    "",
  ].join("\n");

  writeFileSync(devVarsPath, body, "utf8");
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

    await new Promise((resolveWait) =>
      setTimeout(resolveWait, 500),
    );
  }

  return false;
}

/** Boot the Worker against a fresh local D1 database. */
/**
 * Kill a process and every child it spawned.
 *
 * `wrangler dev` starts a separate `workerd` child; signalling only
 * the parent leaves the child holding the port, so the next run
 * silently talks to a stale worker. `taskkill /T` tears down the
 * whole tree.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    try {
      spawnSync(
        "taskkill",
        ["/F", "/T", "/PID", String(pid)],
        { stdio: "ignore" },
      );
    } catch {
      // Fall through to the signal below.
    }
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** True when something is already listening on the worker port. */
async function portInUse(): Promise<boolean> {
  try {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/health`,
      { signal: AbortSignal.timeout(1500) },
    );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reap any stale Worker/workerd processes left behind by an
 * interrupted run. Without this, a leftover process keeps the port
 * and the next run either fails confusingly or, worse, silently
 * tests a Worker backed by the wrong database.
 */
function reapStaleWorkers(): void {
  const script = [
    "Get-CimInstance Win32_Process",
    ' | Where-Object { $_.Name -eq "workerd.exe" -or',
    ' ($_.Name -eq "node.exe" -and $_.CommandLine -like "*wrangler*") }',
    " | ForEach-Object { taskkill /F /T /PID $_.ProcessId | Out-Null }",
  ].join(" ");

  try {
    spawnSync(
      "powershell",
      ["-NoProfile", "-Command", script],
      { stdio: "ignore" },
    );
  } catch {
    // Best effort only.
  }
}

/**
 * Create a fresh persistence directory for this run and return it.
 * Shared by `startWorker` and standalone environments so both use
 * the same layout.
 */
export function initPersistPath(): string {
  persistPath = join(
    repoRoot,
    ".wrangler",
    "test-state",
    `run-${Date.now()}-${process.pid}`,
  );
  mkdirSync(persistPath, { recursive: true });

  return persistPath;
}

export async function startWorker(): Promise<void> {
  if (await portInUse()) {
    reapStaleWorkers();

    await new Promise((done) => setTimeout(done, 3000));

    if (await portInUse()) {
      throw new Error(
        "A worker is already listening on port " +
          `${WORKER_PORT} and could not be reaped. Stop it ` +
          "manually before running the suite.",
      );
    }
  }

  // Use a throwaway persistence directory so every run starts from
  // an empty database.
  persistPath = join(
    repoRoot,
    ".wrangler",
    "test-state",
    `run-${Date.now()}`,
  );
  mkdirSync(persistPath, { recursive: true });

  writeDevVars();

  // The log lives outside the persistence directory so it survives
  // teardown for post-mortem inspection.
  const logPath = join(
    tmpdir(),
    `queryvanta-worker-${Date.now()}.log`,
  );
  workerLogPath = logPath;
  const logStream = createWriteStream(logPath, {
    flags: "a",
  });

  worker = spawn(
    process.execPath,
    [
      WRANGLER_BIN,
      "dev",
      "--local",
      "--port",
      String(WORKER_PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persistPath,
      "--log-level",
      "error",
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );

  worker.stdout?.pipe(logStream);
  worker.stderr?.pipe(logStream);

  const ready = await waitForWorker(90_000);

  if (!ready) {
    await stopWorker();
    throw new Error(
      "Worker did not become healthy in time",
    );
  }

  // Apply the schema to the fresh database. A relative path is
  // used because wrangler resolves `--file` against the cwd.
  runWrangler([
    "d1",
    "execute",
    "queryvanta",
    "--local",
    "--persist-to",
    persistPath,
    "--file=migrations/0001_init.sql",
    "--yes",
  ]);

  // Verify the schema actually landed, so a silent migration
  // failure surfaces as a clear error rather than a confusing 500
  // in every later assertion.
  const tables = runWrangler([
    "d1",
    "execute",
    "queryvanta",
    "--local",
    "--persist-to",
    persistPath,
    "--command",
    "SELECT name FROM sqlite_master WHERE type='table'",
    "--json",
    "--yes",
  ]);

  for (
    const required of [
      "questions",
      "admin_sessions",
      "oauth_transactions",
      "admin_audit_log",
    ]
  ) {
    if (!tables.includes(required)) {
      await stopWorker();
      throw new Error(
        `Migration did not create table "${required}"`,
      );
    }
  }
}

export async function stopWorker(): Promise<void> {
  if (worker !== null) {
    killTree(worker.pid);
    worker = null;
  }

  // Wait for the port to be released before returning, so the next
  // run cannot attach to a dying worker.
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (!(await portInUse())) {
      break;
    }

    await new Promise((done) => setTimeout(done, 500));
  }

  // Give the runtime a moment to release its persistence files
  // before cleaning up. Cleanup is best-effort: a locked temp
  // directory must never fail the security assertions.
  await new Promise((done) => setTimeout(done, 500));

  if (persistPath !== null) {
    try {
      rmSync(persistPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      });
    } catch {
      // Left behind under .wrangler/test-state, which is gitignored.
    }

    persistPath = null;
  }

  if (existsSync(devVarsPath)) {
    try {
      rmSync(devVarsPath, { force: true });
    } catch {
      // Best effort.
    }
  }
}

/** Insert a session row directly so HTTP tests can authenticate. */
export function mintSession(options: {
  adminGithubId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
  revokedAt?: string | null;
  lastSeenAt?: string;
}): void {
  const now = new Date().toISOString();
  const tokenHash = sha256HexSync(
    `${SESSION_SECRET}.${options.token}`,
  );
  const revoked =
    options.revokedAt === null ||
    options.revokedAt === undefined
      ? "NULL"
      : `'${options.revokedAt}'`;

  // A unique row id per insert: reusing a token across tests must
  // replace the row rather than violate the primary key.
  const rowId = `sess-${randomUUID()}`;

  runWrangler([
    "d1",
    "execute",
    "queryvanta",
    "--local",
    "--persist-to",
    persistPath as string,
    "--command",
    `DELETE FROM admin_sessions WHERE token_hash = '${tokenHash}'; ` +
      `INSERT INTO admin_sessions (id, admin_github_id, github_login, github_avatar_url, token_hash, csrf_token, created_at, updated_at, last_seen_at, expires_at, revoked_at) ` +
      `VALUES ('${rowId}', '${options.adminGithubId}', 'octocat', ` +
      `'https://avatars.example/octocat.png', '${tokenHash}', '${options.csrfToken}', ` +
      `'${now}', '${now}', '${options.lastSeenAt ?? now}', ` +
      `'${options.expiresAt.toISOString()}', ${revoked})`,
    "--yes",
  ]);
}

export function d1Command(sql: string): string {
  return runWrangler([
    "d1",
    "execute",
    "queryvanta",
    "--local",
    "--persist-to",
    persistPath as string,
    "--command",
    sql,
    "--yes",
  ]);
}

/**
 * Local SHA-256, so the harness can pre-compute the same token hash
 * the Worker will compute.
 */
export function sha256HexSync(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function workerLog(): string {
  return workerLogPath ?? "<no worker log>";
}

export const repoRootPath = repoRoot;
export const migrationPath = join(
  repoRoot,
  "migrations",
  "0001_init.sql",
);

export function readMigration(): string {
  return readMigrationFile(migrationPath, "utf8");
}

export { d1StatePath };