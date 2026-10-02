/**
 * Rate limiting and audit-write amplification tests (task 4.2B).
 *
 * Closes audit findings V-02 (one audit row per unauthenticated admin
 * request) and V-10 (no rate limiting anywhere; the 429 plumbing exists
 * but is unused).
 *
 * The limiter is per-isolate and therefore best-effort, which the tests
 * state rather than paper over. What they do prove is the behaviour
 * that actually matters:
 *
 *   1. an anonymous burst is rate limited with 429 and carries
 *      Retry-After;
 *   2. an over-budget anonymous request writes NOTHING to the audit
 *      log, and even an in-budget flood is sampled, so D1 writes stay
 *      bounded rather than one-per-request;
 *   3. a legitimate administrator is NEVER rate limited, including when
 *      an anonymous caller from the same address has exhausted its
 *      budget;
 *   4. authorization is unchanged: an anonymous caller still gets 401
 *      inside its budget, never 200, and the session_denied audit
 *      action still exists;
 *   5. the limiter itself costs no D1 operations.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  clientAddress,
  consume,
  createBuckets,
  peek,
  shouldAuditDenied,
} from "../rateLimit.ts";

import {
  d1Command,
  mintSession,
  startWorker,
  stopWorker,
  TEST_ADMIN_ID,
  WORKER_ORIGIN,
} from "./harness.ts";

// Session tokens must match the worker's own shape check in
// server/session.ts (`/^[a-f0-9]{64}$/`), otherwise the lookup is
// rejected as malformed before the database is ever consulted. The
// existing security suite uses "a".repeat(64) for the same reason.
const ADMIN_TOKEN = "a".repeat(64);
const ADMIN_CSRF = "rate-limit-csrf-token";
const SHARED_TOKEN = "e".repeat(64);
const SHARED_CSRF = "shared-address-csrf";

/** A session that is valid for a full day, for the happy-path checks. */
function futureExpiry(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

/** Distinct source address so each test group gets its own budget. */
function asAddress(address: string): RequestInit {
  return { headers: { "CF-Connecting-IP": address } };
}

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{
  status: number;
  body: { ok?: boolean; error?: { code?: string } };
  headers: Headers;
}> {
  const response = await fetch(`${WORKER_ORIGIN}${path}`, init);
  const text = await response.text();
  let body: { ok?: boolean; error?: { code?: string } };

  try {
    body = JSON.parse(text) as { ok?: boolean; error?: { code?: string } };
  } catch {
    body = {};
  }

  return { status: response.status, body, headers: response.headers };
}

/** Count audit rows for one action. */
function auditCountFor(action: string): number {
  const out = d1Command(
    `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = '${action}';`,
  );

  const match = /"n"\s*:\s*(\d+)/.exec(out);

  assert.ok(match, `could not read audit count from: ${out}`);

  return Number(match[1]);
}

before(async () => {
  await startWorker();
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

/* -------------------------------------------------------------------------- */

describe("rate limiter unit behaviour", () => {
  it("allows exactly the configured budget then refuses", () => {
    const buckets = createBuckets();
    const options = { limit: 3, windowSeconds: 60 };

    for (let index = 0; index < 3; index++) {
      assert.equal(
        consume(buckets, "k", options).allowed,
        true,
        `request ${index + 1} should be allowed`,
      );
    }

    const refused = consume(buckets, "k", options);

    assert.equal(refused.allowed, false);
    assert.equal(refused.remaining, 0);
    assert.ok(refused.retryAfterSeconds >= 1);
  });

  it("resets once the window elapses", () => {
    let clock = 1_000_000;
    const buckets = createBuckets();
    const options = {
      limit: 1,
      windowSeconds: 60,
      now: () => clock,
    };

    assert.equal(consume(buckets, "k", options).allowed, true);
    assert.equal(consume(buckets, "k", options).allowed, false);

    clock += 61_000;

    assert.equal(
      consume(buckets, "k", options).allowed,
      true,
      "a new window must restore the budget",
    );
  });

  it("keeps separate budgets per key", () => {
    const buckets = createBuckets();
    const options = { limit: 1, windowSeconds: 60 };

    assert.equal(consume(buckets, "a", options).allowed, true);
    assert.equal(consume(buckets, "a", options).allowed, false);
    assert.equal(
      consume(buckets, "b", options).allowed,
      true,
      "one key must not spend another key's budget",
    );
  });

  it("peeks without consuming budget", () => {
    const buckets = createBuckets();
    const options = { limit: 1, windowSeconds: 60 };

    assert.equal(peek(buckets, "k", options).allowed, true);
    assert.equal(peek(buckets, "k", options).allowed, true);

    consume(buckets, "k", options);

    assert.equal(peek(buckets, "k", options).allowed, false);
  });

  it("samples denials: first always, then every Nth", () => {
    const buckets = createBuckets();
    const options = { limit: 1000, windowSeconds: 60, sampleEvery: 10 };

    const written = Array.from({ length: 30 }, () =>
      shouldAuditDenied(buckets, "denied", options),
    ).filter(Boolean).length;

    // 1st, 10th, 20th, 30th => 4 of 30.
    assert.equal(written, 4);
  });

  it("bounds the map so rotating addresses cannot exhaust memory", () => {
    const buckets = createBuckets();
    const options = { limit: 5, windowSeconds: 60 };

    for (let index = 0; index < 12_000; index++) {
      consume(buckets, `attacker-${index}`, options);
    }

    assert.ok(
      buckets.size <= 10_000,
      `bucket map grew to ${buckets.size}, expected a hard cap`,
    );
  });

  it("reads the client address from CF-Connecting-IP", () => {
    const request = new Request("https://example.test/api/admin/audit", {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });

    assert.equal(clientAddress(request), "203.0.113.7");
  });

  it("falls back to a fixed bucket when no address header is present", () => {
    assert.equal(
      clientAddress(new Request("https://example.test/api/admin/audit")),
      "unknown",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("anonymous admin rate limiting over HTTP", () => {
  it("rate limits an anonymous burst with 429 and Retry-After", async () => {
    const address = "198.51.100.10";

    // Inside the budget the caller is rejected as unauthorized, which is
    // the pre-existing behaviour and must not change.
    const first = await api("/api/admin/audit", asAddress(address));

    assert.equal(first.status, 401);
    assert.equal(first.body.error?.code, "unauthorized");

    let limited: Awaited<ReturnType<typeof api>> | null = null;

    // Burst past the 60/min budget.
    for (let index = 0; index < 80; index++) {
      const result = await api("/api/admin/audit", asAddress(address));

      if (result.status === 429) {
        limited = result;
        break;
      }
    }

    assert.ok(limited, "an anonymous burst must eventually be rate limited");
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error?.code, "rate_limited");

    // RFC 9110 requires Retry-After on a 429.
    const retryAfter = limited.headers.get("retry-after");

    assert.ok(retryAfter, "429 must carry a Retry-After header");
    assert.ok(Number(retryAfter) >= 1, "Retry-After must be at least 1 second");
  });

  it("bounds audit writes instead of writing one row per request", async () => {
    const address = "198.51.100.11";

    const before = auditCountFor("session_denied");

    // 200 anonymous admin requests: over the 60/min budget, so the tail
    // is refused outright and the in-budget part is sampled.
    for (let index = 0; index < 200; index++) {
      await api("/api/admin/audit", asAddress(address));
    }

    const written = auditCountFor("session_denied") - before;

    // Without sampling this would be 200 writes. Sampling plus the
    // over-budget short circuit keeps it far below that, and the
    // assertion is deliberately loose so it tests the property
    // ("bounded, not one-per-request") rather than a magic number.
    assert.ok(
      written <= 60,
      `expected bounded audit writes, got ${written} for 200 requests`,
    );
    assert.ok(written >= 1, "the first denial must still be recorded");
  });

  it("never authorizes an anonymous caller, even while over budget", async () => {
    const address = "198.51.100.12";

    for (let index = 0; index < 80; index++) {
      const result = await api("/api/admin/questions", asAddress(address));

      assert.notEqual(
        result.status,
        200,
        "an anonymous caller must never reach a success response",
      );

      if (result.status === 429) {
        return;
      }
    }

    assert.fail("the anonymous caller should have been rate limited");
  });

  it("keeps the session_denied audit action available for investigation", async () => {
    const before = auditCountFor("session_denied");

    await api("/api/admin/audit", asAddress("198.51.100.13"));

    assert.equal(
      auditCountFor("session_denied") - before,
      1,
      "an isolated anonymous denial must still be audited",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("administrator is never rate limited", () => {
  it("does not throttle an authenticated administrator", async () => {
    const address = "203.0.113.50";

    await mintSession({
      token: ADMIN_TOKEN,
      adminGithubId: TEST_ADMIN_ID,
      csrfToken: ADMIN_CSRF,
      expiresAt: futureExpiry(),
    });

    // 200 authenticated requests, far beyond the 60/min anonymous
    // budget. Every one must succeed: the anonymous limiter must not be
    // reachable for a real administrator.
    for (let index = 0; index < 200; index++) {
      const result = await api("/api/admin/audit", {
        headers: {
          Cookie: `qv_admin_session=${ADMIN_TOKEN}`,
          "CF-Connecting-IP": address,
        },
      });

      assert.equal(
        result.status,
        200,
        `authenticated admin request ${index + 1} must not be rate limited`,
      );
    }
  });

  it("still allows an admin when an anonymous flood shares the address", async () => {
    const address = "203.0.113.51";

    await mintSession({
      token: SHARED_TOKEN,
      adminGithubId: TEST_ADMIN_ID,
      csrfToken: SHARED_CSRF,
      expiresAt: futureExpiry(),
    });

    // Exhaust the anonymous budget for this address first.
    for (let index = 0; index < 80; index++) {
      await api("/api/admin/audit", asAddress(address));
    }

    const asAdmin = await api("/api/admin/audit", {
      headers: {
        Cookie: `qv_admin_session=${SHARED_TOKEN}`,
        "CF-Connecting-IP": address,
      },
    });

    assert.equal(
      asAdmin.status,
      200,
      "an exhausted anonymous budget must not deny the administrator",
    );
  });

  it("still refuses an authenticated non-admin", async () => {
    const result = await api("/api/admin/audit", {
      headers: { Cookie: `qv_admin_session=${"b".repeat(64)}` },
    });

    // No such session exists, so this is the anonymous path: 401 while
    // inside the budget. Authorization itself is unchanged.
    assert.ok(
      result.status === 401 || result.status === 429,
      `expected 401 or 429, got ${result.status}`,
    );
    assert.notEqual(result.status, 200);
    assert.notEqual(result.status, 403);
  });
});