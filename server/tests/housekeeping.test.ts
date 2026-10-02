/**
 * Housekeeping / scheduled-retention tests (roadmap task 4.2A).
 *
 * Covers moving session and OAuth-transaction purges off the request
 * path, the Worker `scheduled()` handler, and the bounded audit-log
 * retention window.
 *
 * The suite boots the real Worker (for the HTTP assertions) against a
 * local D1 via the shared harness, then invokes the `scheduled()`
 * export directly with a real D1 handle. The handle is a thin D1 shim
 * over the harness's own persist-path SQLite file, so the scheduled
 * handler runs against the same database the Worker uses.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  APP_ORIGIN,
  d1Command,
  mintSession,
  openLocalSqlite,
  startWorker,
  stopWorker,
  TEST_ADMIN_ID,
  toD1Handle,
  WORKER_ORIGIN,
  type D1Handle,
} from "./harness.ts";

import worker from "../index.ts";

import {
  DEFAULT_AUDIT_RETENTION_DAYS,
  parseAuditRetentionDays,
  type Env,
} from "../env.ts";

/* -------------------------------------------------------------------------- */
/* D1 shim over the harness's persist-path SQLite file                        */
/* -------------------------------------------------------------------------- */

/**
 * The D1 handle used to invoke the Worker's `scheduled()` export directly
 * against the same local database the harness booted.
 *
 * The shim itself (`toD1Handle` / `openLocalSqlite`) lives in the harness
 * rather than here, so every suite that needs to call a store helper
 * directly shares one implementation instead of growing its own.
 */
function d1Handle(): D1Handle {
  return toD1Handle(openLocalSqlite());
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

const SESSION_COLUMNS =
  "id, admin_github_id, github_login, github_avatar_url, " +
  "token_hash, csrf_token, created_at, updated_at, last_seen_at, " +
  "expires_at, revoked_at";

function insertSession(
  id: string,
  tokenHash: string,
  expiresAt: string,
): void {
  const timestamp = "2020-01-01T00:00:00.000Z";
  d1Command(
    `INSERT INTO admin_sessions (${SESSION_COLUMNS}) ` +
      `VALUES ('${id}', '${TEST_ADMIN_ID}', 'octocat', NULL, ` +
      `'${tokenHash}', 'csrf', '${timestamp}', '${timestamp}', ` +
      `'${timestamp}', '${expiresAt}', NULL)`,
  );
}

function insertOAuthTransaction(
  stateHash: string,
  expiresAt: string,
  consumedAt: string | null,
): void {
  const consumed = consumedAt === null ? "NULL" : `'${consumedAt}'`;
  d1Command(
    `INSERT INTO oauth_transactions (state_hash, code_verifier, ` +
      `redirect_to, created_at, expires_at, consumed_at) ` +
      `VALUES ('${stateHash}', 'verifier', '/admin/questions', ` +
      `'2020-01-01T00:00:00.000Z', '${expiresAt}', ${consumed})`,
  );
}

function insertAuditRow(id: string, createdAt: string): void {
  d1Command(
    `INSERT INTO admin_audit_log (id, actor_github_id, actor_login, ` +
      `action, question_id, outcome, metadata_json, created_at) ` +
      `VALUES ('${id}', NULL, NULL, 'login_success', NULL, ` +
      `'success', '{}', '${createdAt}')`,
  );
}

function count(sql: string): number {
  const row = d1Sync.prepare(sql).bind().first<{ n: number }>();
  return row?.n ?? 0;
}

function makeEnv(db: D1Database, retentionDays?: string): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    SESSION_SECRET: "test-session-secret",
    ADMIN_GITHUB_IDS: TEST_ADMIN_ID,
    ENVIRONMENT: "test",
    APP_ORIGIN,
    AUDIT_RETENTION_DAYS: retentionDays ?? "",
    ANALYTICS_RETENTION_DAYS: "",
  };
}

async function runScheduled(
  retentionDays?: string,
  db?: D1Database,
): Promise<void> {
  const event = {
    cron: "0 4 * * *",
    type: "scheduled",
    scheduledTime: Date.now(),
  } as ScheduledEvent;
  const ctx = {} as ExecutionContext;

  await worker.scheduled(
    event,
    makeEnv(db ?? (d1Sync as unknown as D1Database), retentionDays),
    ctx,
  );
}

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

let d1Sync: D1Handle;

before(async () => {
  await startWorker();
  d1Sync = d1Handle();
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */
/* request path                                                                */
/* -------------------------------------------------------------------------- */

describe("REQUEST PATH", () => {
  it("GET /api/auth/session performs no D1 write", async () => {
    // A valid session with a known last_seen_at, an expired session,
    // and an expired OAuth transaction. A request-path purge would
    // remove the expired rows; removing the finally block must leave
    // every row and every last_seen_at untouched.
    insertSession("h1-valid", "h1-valid-hash", "2099-01-01T00:00:00.000Z");
    insertSession("h1-expired", "h1-expired-hash", "2020-01-01T00:00:00.000Z");
    insertOAuthTransaction(
      "h1-oauth",
      "2020-01-01T00:00:00.000Z",
      null,
    );

    const lastSeenBefore = d1Sync
      .prepare(
        "SELECT last_seen_at FROM admin_sessions WHERE id = 'h1-valid'",
      )
      .bind()
      .first<{ last_seen_at: string }>();
    const sessionsBefore = count("SELECT COUNT(*) AS n FROM admin_sessions");
    const oauthBefore = count(
      "SELECT COUNT(*) AS n FROM oauth_transactions",
    );

    // Unauthenticated: no session cookie, so lookupSession returns
    // early and nothing is written.
    const response = await fetch(`${WORKER_ORIGIN}/api/auth/session`);
    assert.equal(response.status, 200);

    const lastSeenAfter = d1Sync
      .prepare(
        "SELECT last_seen_at FROM admin_sessions WHERE id = 'h1-valid'",
      )
      .bind()
      .first<{ last_seen_at: string }>();
    const sessionsAfter = count("SELECT COUNT(*) AS n FROM admin_sessions");
    const oauthAfter = count(
      "SELECT COUNT(*) AS n FROM oauth_transactions",
    );
    const expiredStillThere = count(
      "SELECT COUNT(*) AS n FROM admin_sessions WHERE id = 'h1-expired'",
    );

    assert.equal(
      lastSeenAfter?.last_seen_at,
      lastSeenBefore?.last_seen_at,
      "last_seen_at must be unchanged by the request",
    );
    assert.equal(
      sessionsAfter,
      sessionsBefore,
      "admin_sessions row count must be unchanged by the request",
    );
    assert.equal(
      oauthAfter,
      oauthBefore,
      "oauth_transactions row count must be unchanged by the request",
    );
    assert.equal(
      expiredStillThere,
      1,
      "expired session must NOT be purged by the request path",
    );
  });

  it("/api/auth/session returns the same envelope for authenticated and unauthenticated callers", async () => {
    // Unauthenticated.
    const anon = await fetch(`${WORKER_ORIGIN}/api/auth/session`);
    assert.equal(anon.status, 200);
    const anonBody = (await anon.json()) as {
      ok: boolean;
      data: { authenticated: boolean };
    };
    assert.equal(anonBody.ok, true);
    assert.equal(anonBody.data.authenticated, false);
    assert.equal(anon.headers.get("cache-control"), "no-store");

    // Authenticated.
    const token = "a".repeat(64);
    mintSession({
      adminGithubId: TEST_ADMIN_ID,
      token,
      csrfToken: "csrf-token-for-tests-000000000000",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const auth = await fetch(`${WORKER_ORIGIN}/api/auth/session`, {
      headers: { Cookie: `qv_admin_session=${token}` },
    });
    assert.equal(auth.status, 200);
    const authBody = (await auth.json()) as {
      ok: boolean;
      data: {
        authenticated: boolean;
        admin: { githubId: string };
        csrfToken: string;
        expiresAt: string;
      };
    };
    assert.equal(authBody.ok, true);
    assert.equal(authBody.data.authenticated, true);
    assert.equal(authBody.data.admin.githubId, TEST_ADMIN_ID);
    assert.equal(typeof authBody.data.csrfToken, "string");
    assert.equal(typeof authBody.data.expiresAt, "string");
    assert.equal(auth.headers.get("cache-control"), "no-store");
  });
});

/* -------------------------------------------------------------------------- */
/* scheduled handler                                                           */
/* -------------------------------------------------------------------------- */

describe("SCHEDULED HANDLER", () => {
  it("removes expired sessions", async () => {
    insertSession("h3-expired", "h3-expired-hash", "2020-01-01T00:00:00.000Z");
    insertSession("h3-valid", "h3-valid-hash", "2099-01-01T00:00:00.000Z");

    await runScheduled("90");

    assert.equal(
      count("SELECT COUNT(*) AS n FROM admin_sessions WHERE id = 'h3-expired'"),
      0,
      "expired session must be purged",
    );
    assert.equal(
      count("SELECT COUNT(*) AS n FROM admin_sessions WHERE id = 'h3-valid'"),
      1,
      "valid session must be kept",
    );
  });

  it("removes expired and already-consumed OAuth transactions", async () => {
    insertOAuthTransaction(
      "h4-expired-consumed",
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000Z",
    );
    insertOAuthTransaction(
      "h4-expired-unconsumed",
      "2020-01-01T00:00:00.000Z",
      null,
    );
    insertOAuthTransaction(
      "h4-fresh",
      "2099-01-01T00:00:00.000Z",
      null,
    );

    await runScheduled("90");

    assert.equal(
      count(
        "SELECT COUNT(*) AS n FROM oauth_transactions WHERE state_hash = 'h4-expired-consumed'",
      ),
      0,
      "expired+consumed transaction must be purged",
    );
    assert.equal(
      count(
        "SELECT COUNT(*) AS n FROM oauth_transactions WHERE state_hash = 'h4-expired-unconsumed'",
      ),
      0,
      "expired transaction must be purged",
    );
    assert.equal(
      count(
        "SELECT COUNT(*) AS n FROM oauth_transactions WHERE state_hash = 'h4-fresh'",
      ),
      1,
      "fresh transaction must be kept",
    );
  });

  it("enforces the audit retention window", async () => {
    const old = new Date(
      Date.now() - 100 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recent = new Date().toISOString();
    insertAuditRow("h5-old", old);
    insertAuditRow("h5-recent", recent);

    await runScheduled("90");

    assert.equal(
      count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE id = 'h5-old'"),
      0,
      "audit row older than the retention window must be purged",
    );
    assert.equal(
      count(
        "SELECT COUNT(*) AS n FROM admin_audit_log WHERE id = 'h5-recent'",
      ),
      1,
      "audit row inside the retention window must be kept",
    );
  });

  it("a missing or invalid AUDIT_RETENTION_DAYS falls back to the safe default", async () => {
    // The parser falls back for missing, empty, zero, negative and
    // non-numeric values.
    assert.equal(DEFAULT_AUDIT_RETENTION_DAYS, 90);
    assert.equal(
      parseAuditRetentionDays(undefined),
      DEFAULT_AUDIT_RETENTION_DAYS,
    );
    assert.equal(parseAuditRetentionDays(""), DEFAULT_AUDIT_RETENTION_DAYS);
    assert.equal(
      parseAuditRetentionDays("   "),
      DEFAULT_AUDIT_RETENTION_DAYS,
    );
    assert.equal(
      parseAuditRetentionDays("0"),
      DEFAULT_AUDIT_RETENTION_DAYS,
    );
    assert.equal(
      parseAuditRetentionDays("-5"),
      DEFAULT_AUDIT_RETENTION_DAYS,
    );
    assert.equal(
      parseAuditRetentionDays("abc"),
      DEFAULT_AUDIT_RETENTION_DAYS,
    );
    assert.equal(parseAuditRetentionDays("90"), 90);

    // An invalid value falls back to the default window, so a recent
    // audit row survives a scheduled run.
    insertAuditRow("h6-recent", new Date().toISOString());

    await runScheduled("not-a-number");

    assert.equal(
      count(
        "SELECT COUNT(*) AS n FROM admin_audit_log WHERE id = 'h6-recent'",
      ),
      1,
      "recent audit row must survive when AUDIT_RETENTION_DAYS is invalid",
    );
  });

  it("a failure in one purge does not prevent the others from running", async () => {
    const runs: string[] = [];
    const mockDb = {
      prepare(sql: string) {
        if (sql.includes("admin_sessions")) {
          throw new Error(
            "injected failure: admin_sessions unavailable",
          );
        }
        return {
          bind: () => ({
            run: async () => {
              runs.push(sql);
              return { meta: { changes: 0 } };
            },
          }),
        };
      },
    } as unknown as D1Database;

    const event = {
      cron: "0 4 * * *",
      type: "scheduled",
      scheduledTime: Date.now(),
    } as ScheduledEvent;
    const ctx = {} as ExecutionContext;

    // Must not throw despite the injected failure.
    await worker.scheduled(event, makeEnv(mockDb, "90"), ctx);

    // Every healthy purge ran; only the injected one was skipped. The
    // count is derived from the known purge set rather than hard-coded, so
    // adding a purge later does not silently make this assertion pass for
    // the wrong reason.
    const healthyPurges = [
      "oauth_transactions",
      "admin_audit_log",
      "analytics_daily",
    ];

    assert.equal(
      runs.length,
      healthyPurges.length,
      "every healthy purge must run",
    );

    for (const table of healthyPurges) {
      assert.ok(
        runs.some((sql) => sql.includes(table)),
        `${table} purge must have run despite the injected failure`,
      );
    }
  });
});
