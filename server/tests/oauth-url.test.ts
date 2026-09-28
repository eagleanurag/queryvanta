import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  codeChallengeS256,
  createCodeVerifier,
} from "../crypto.ts";
import { authorizeUrl } from "../oauth.ts";

import {
  startWorker,
  stopWorker,
  WORKER_ORIGIN,
} from "./harness.ts";

/**
 * Authorization-URL regression suite.
 *
 * Two layers:
 *  1. A pure unit test that builds a real URL and parses it.
 *  2. An end-to-end HTTP test that fetches `/api/auth/github` from
 *     the running Worker and parses the redirect it returns, so the
 *     actual production code path is exercised.
 */

const APP_ORIGIN = "https://queryvanta.queryvanta.workers.dev";
const CLIENT_ID = "Ov23liesFfVbuqjvWt7A";

/** Every assertion GitHub's own error message enumerates. */
function assertAuthorizationUrl(
  rawUrl: string,
  expectedClientId: string,
  expectedOrigin: string,
): URLSearchParams {
  const parsed = new URL(rawUrl);

  assert.equal(
    parsed.host,
    "github.com",
    "host must be github.com",
  );
  assert.equal(
    parsed.pathname,
    "/login/oauth/authorize",
    "path must be /login/oauth/authorize",
  );

  const p = parsed.searchParams;

  assert.equal(
    p.get("client_id"),
    expectedClientId,
    "client_id must match the configured client id",
  );
  assert.equal(
    p.get("redirect_uri"),
    `${expectedOrigin}/api/auth/github/callback`,
    "redirect_uri must be the registered callback",
  );
  assert.equal(
    p.get("scope"),
    "read:user",
    "scope must be read:user",
  );
  assert.equal(
    p.get("response_type"),
    "code",
    "response_type must be code",
  );
  assert.ok(
    (p.get("state") ?? "").length >= 32,
    "state must exist and be long",
  );

  const challenge = p.get("code_challenge") ?? "";

  assert.ok(challenge !== "", "code_challenge must exist");
  assert.equal(
    challenge.length,
    43,
    "code_challenge must be exactly 43 characters",
  );
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    p.get("code_challenge_method"),
    "S256",
    "code_challenge_method must be S256",
  );

  // Minimum privilege: no repository or write scopes.
  assert.doesNotMatch(
    p.get("scope") ?? "",
    /repo|write:|admin:|delete_repo/,
  );

  return p;
}

describe("AUTHORIZATION URL (unit)", () => {
  it("generates a URL GitHub accepts", async () => {
    const challenge = await codeChallengeS256(
      createCodeVerifier(),
    );

    const url = authorizeUrl({
      appOrigin: APP_ORIGIN,
      clientId: CLIENT_ID,
      state: "a".repeat(64),
      challenge,
    });

    const p = assertAuthorizationUrl(url, CLIENT_ID, APP_ORIGIN);

    // The URL must carry exactly the derived challenge.
    assert.equal(p.get("code_challenge"), challenge);
  });

  it("stays compliant across 100 generated URLs", async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const challenge = await codeChallengeS256(
        createCodeVerifier(),
      );

      const url = authorizeUrl({
        appOrigin: APP_ORIGIN,
        clientId: CLIENT_ID,
        state: "b".repeat(64),
        challenge,
      });

      assertAuthorizationUrl(url, CLIENT_ID, APP_ORIGIN);
    }
  });
});

describe("AUTHORIZATION URL (live Worker)", () => {
  before(async () => {
    await startWorker();
  }, { timeout: 180_000 });

  after(async () => {
    await stopWorker();
  }, { timeout: 60_000 });

  it("GET /api/auth/github redirects to a compliant URL", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/auth/github`,
      { redirect: "manual" },
    );

    assert.equal(
      response.status,
      302,
      "the endpoint must redirect to GitHub",
    );

    const location =
      response.headers.get("location") ?? "";

    assert.notEqual(location, "");

    console.log("  authorization URL:", location);

    assertAuthorizationUrl(
      location,
      "Iv1.integrationtest",
      WORKER_ORIGIN,
    );
  });

  it("the stored verifier reproduces the served challenge", async () => {
    // Proves end to end that the verifier persisted in D1 is the
    // exact value the challenge was derived from, so the callback
    // can complete the exchange.
    const response = await fetch(
      `${WORKER_ORIGIN}/api/auth/github`,
      { redirect: "manual" },
    );

    const location = response.headers.get("location") ?? "";
    const servedChallenge =
      new URL(location).searchParams.get("code_challenge") ?? "";

    assert.equal(servedChallenge.length, 43);

    // The transaction row holds the verifier. Reproducing the
    // challenge from it must yield the served value.
    const { d1Command } = await import("./harness.ts");

    const rows = d1Command(
      "SELECT code_verifier FROM oauth_transactions ORDER BY created_at DESC LIMIT 1",
    );

    const match =
      /"code_verifier"\s*:\s*"([^"]+)"/.exec(rows) ??
      /code_verifier[^\w]*([A-Za-z0-9._~-]{43})/.exec(rows);

    assert.ok(
      match !== null,
      "a stored verifier must be readable from the transaction",
    );

    const storedVerifier = match[1] as string;

    console.log("  stored verifier:", storedVerifier);
    console.log("  served challenge:", servedChallenge);

    assert.equal(
      storedVerifier.length,
      43,
      "the stored verifier is a 43-character base64url value",
    );
    assert.match(storedVerifier, /^[A-Za-z0-9._~-]{43}$/);

    assert.equal(
      await codeChallengeS256(storedVerifier),
      servedChallenge,
      "the served challenge must be derived from the stored verifier",
    );
  });

  it("state and the PKCE challenge are independent", async () => {
    const response = await fetch(
      `${WORKER_ORIGIN}/api/auth/github`,
      { redirect: "manual" },
    );

    const first =
      new URL(
        response.headers.get("location") ?? "",
      ).searchParams;

    const second = new URL(
      (
        await fetch(`${WORKER_ORIGIN}/api/auth/github`, {
          redirect: "manual",
        })
      ).headers.get("location") ?? "",
    ).searchParams;

    assert.notEqual(
      first.get("state"),
      second.get("state"),
      "state must be fresh per request",
    );
    assert.notEqual(
      first.get("code_challenge"),
      second.get("code_challenge"),
      "the challenge must be fresh per request",
    );

    // Neither value is derived from the other.
    assert.notEqual(
      first.get("state"),
      first.get("code_challenge"),
    );
    assert.notEqual(
      first.get("state")?.length,
      first.get("code_challenge")?.length,
    );
  });
});
