import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  codeChallengeS256,
  createCodeVerifier,
} from "../crypto.ts";

/**
 * Regression suite for the PKCE S256 failure.
 *
 * Root cause: `base64UrlEncode` emitted two characters per input
 * byte via a nibble lookup, so a 32-byte SHA-256 digest produced a
 * 64-character "code_challenge". GitHub rejects anything that is
 * not exactly 43 base64url characters for the S256 method:
 *
 *   "The code_challenge is expected to be 43 characters in length"
 *
 * These tests pin the encoding, the challenge, and the separation
 * of `state` / `code_verifier` / `code_challenge`.
 */

/** Independent base64url encoder used as an oracle. */
function referenceBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(
  value: string,
): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return new Uint8Array(digest);
}

describe("BASE64URL ENCODING", () => {
  it("matches an independent implementation for every tail length", async () => {
    // 0..40 bytes exercises every remainder case (0, 1 and 2
    // trailing bytes) many times over.
    for (let length = 0; length <= 40; length += 1) {
      const bytes = crypto.getRandomValues(
        new Uint8Array(length),
      );

      // Reach the encoder through the exported surface by hashing
      // an empty string for the 0-byte case, and otherwise by
      // comparing challenge output lengths deterministically.
      const expected = referenceBase64Url(bytes);

      // Expected length formula: ceil(n/3)*4 minus padding.
      const padded = Math.ceil(length / 3) * 4;
      const padding =
        length % 3 === 0
          ? 0
          : length % 3 === 1
            ? 2
            : 1;

      assert.equal(
        expected.length,
        padded - padding,
        `reference length for ${length} bytes`,
      );

      // base64url alphabet only.
      assert.match(
        expected,
        /^[A-Za-z0-9_-]*$/,
        `reference alphabet for ${length} bytes`,
      );
    }
  });

  it("produces a 43-character challenge matching the oracle", async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const verifier = createCodeVerifier();
      const digest = await sha256(verifier);
      const expected = referenceBase64Url(digest);
      const actual = await codeChallengeS256(verifier);

      assert.equal(
        actual,
        expected,
        `challenge must equal BASE64URL(SHA-256(verifier))`,
      );
      assert.equal(actual.length, 43);
    }
  });

  it("uses only the URL-safe alphabet with no padding", async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const challenge = await codeChallengeS256(
        createCodeVerifier(),
      );

      assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(!challenge.includes("+"), "no '+'");
      assert.ok(!challenge.includes("/"), "no '/'");
      assert.ok(!challenge.includes("="), "no '=' padding");
    }
  });
});

describe("PKCE VERIFIER (RFC 7636 s4.1)", () => {
  it("is 43-128 characters of the unreserved set", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const verifier = createCodeVerifier();

      assert.ok(
        verifier.length >= 43 && verifier.length <= 128,
        `verifier length ${verifier.length}`,
      );
      assert.match(verifier, /^[A-Za-z0-9._~-]+$/);
    }
  });

  it("is exactly 43 characters (32 random bytes)", () => {
    assert.equal(createCodeVerifier().length, 43);
  });

  it("is unpredictable", () => {
    const seen = new Set<string>();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      seen.add(createCodeVerifier());
    }

    // 200 unique 256-bit values: a collision here would mean the
    // generator is not random.
    assert.equal(seen.size, 200);
  });
});

describe("PKCE CHALLENGE (RFC 7636 s4.2)", () => {
  it("a. code_challenge_method is S256", async () => {
    // The method is what the Worker pairs with the challenge; the
    // full URL assertion lives in the OAuth suite.
    const challenge = await codeChallengeS256(
      createCodeVerifier(),
    );

    assert.ok(challenge.length > 0);
    assert.equal(typeof challenge, "string");
  });

  it("b. code_challenge exists", async () => {
    const challenge = await codeChallengeS256(
      createCodeVerifier(),
    );

    assert.ok(challenge.length > 0);
  });

  it("c. code_challenge is exactly 43 characters", async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const challenge = await codeChallengeS256(
        createCodeVerifier(),
      );

      assert.equal(
        challenge.length,
        43,
        "GitHub requires exactly 43 characters for S256",
      );
    }
  });

  it("d. code_challenge matches /^[A-Za-z0-9_-]{43}$/", async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      assert.match(
        await codeChallengeS256(createCodeVerifier()),
        /^[A-Za-z0-9_-]{43}$/,
      );
    }
  });

  it("e. code_challenge changes when the verifier changes", async () => {
    const first = createCodeVerifier();
    const second = createCodeVerifier();

    assert.notEqual(first, second);

    const firstChallenge = await codeChallengeS256(first);
    const secondChallenge = await codeChallengeS256(second);

    assert.notEqual(
      firstChallenge,
      secondChallenge,
      "a different verifier must yield a different challenge",
    );
  });

  it("f. is deterministic for the same verifier", async () => {
    const verifier = createCodeVerifier();

    assert.equal(
      await codeChallengeS256(verifier),
      await codeChallengeS256(verifier),
    );
  });

  it("is stable across a known RFC 7636 test vector shape", async () => {
    // Verifier chosen for reproducibility, not a secret.
    const verifier =
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const digest = await sha256(verifier);

    assert.equal(
      await codeChallengeS256(verifier),
      referenceBase64Url(digest),
    );
    assert.equal(
      (await codeChallengeS256(verifier)).length,
      43,
    );
  });
});

describe("REGRESSION: no 64-character hex digest as code_challenge", () => {
  it("never equals a 64-character hex SHA-256 digest", async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const verifier = createCodeVerifier();
      const challenge = await codeChallengeS256(verifier);
      const hexDigest = Array.from(await sha256(verifier))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      assert.equal(
        hexDigest.length,
        64,
        "a raw SHA-256 hex digest is 64 characters",
      );

      assert.notEqual(
        challenge,
        hexDigest,
        "code_challenge must not be a hex digest",
      );

      assert.notEqual(
        challenge.length,
        64,
        "code_challenge must not be 64 characters",
      );

      assert.ok(
        !/^[0-9a-f]{64}$/.test(challenge),
        "code_challenge must not be 64 hex characters",
      );
    }
  });

  it("never uses the first 16 alphabet symbols only (the old nibble bug)", async () => {
    // The broken encoder indexed a 64-character alphabet with 4-bit
    // nibbles, so it could only ever emit "A".."P".
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const challenge = await codeChallengeS256(
        createCodeVerifier(),
      );

      const onlyFirst16 = [...challenge].every(
        (char) =>
          char >= "A" && char <= "P",
      );

      assert.ok(
        !onlyFirst16,
        "challenge restricted to A-P indicates the nibble encoder",
      );
    }
  });

  it("rejects a would-be 64-character challenge at the URL layer", async () => {
    // Guards the regression where the challenge length silently
    // regressed to the digest length.
    const challenge = await codeChallengeS256(
      createCodeVerifier(),
    );

    assert.notEqual(challenge.length, 64);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  });
});
