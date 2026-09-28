import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  APP_ORIGIN,
  startWorker,
  stopWorker,
  WORKER_ORIGIN,
} from "./harness.ts";

before(async () => {
  await startWorker();
}, { timeout: 180_000 });

after(async () => {
  await stopWorker();
}, { timeout: 60_000 });

test("worker boots and reports healthy", async () => {
  const response = await fetch(`${WORKER_ORIGIN}/api/health`);

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    ok: boolean;
    data: { status: string; environment: string };
  };

  assert.equal(body.ok, true);
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.environment, "development");
});

test("session endpoint reports unauthenticated with no cookie", async () => {
  const response = await fetch(
    `${WORKER_ORIGIN}/api/auth/session`,
  );

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    data: { authenticated: boolean };
  };

  assert.equal(body.data.authenticated, false);
});

test("security headers are present on API responses", async () => {
  const response = await fetch(
    `${WORKER_ORIGIN}/api/health`,
  );

  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
  );
  assert.equal(
    response.headers.get("x-frame-options"),
    "DENY",
  );
  assert.equal(
    response.headers.get("cross-origin-embedder-policy"),
    "credentialless",
  );
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
  );
});

test("APP_ORIGIN matches the running worker", () => {
  assert.match(APP_ORIGIN, /^http:\/\/127\.0\.0\.1:\d+$/);
});
