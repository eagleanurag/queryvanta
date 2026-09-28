/**
 * Cryptographic helpers.
 *
 * Uses the Web Crypto API available in the Workers runtime. No raw
 * session token is ever persisted: only a salted SHA-256 hash.
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(byteLength),
  );

  return toHex(bytes.buffer);
}

export async function sha256Hex(
  value: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );

  return toHex(digest);
}

/**
 * Session token digest. A deployment-scoped salt is mixed in so that
 * an identical token value cannot be correlated across deployments
 * and a stolen database dump cannot be replayed without the secret.
 */
export async function sessionTokenHash(
  token: string,
  salt: string,
): Promise<string> {
  return sha256Hex(`${salt}.${token}`);
}

const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * RFC 4648 §5 base64url encoding, WITHOUT padding.
 *
 * Three input bytes become four output characters, so a 32-byte
 * SHA-256 digest becomes exactly 43 characters — which is what
 * GitHub requires for an S256 `code_challenge`.
 *
 * The previous implementation emitted two characters per input byte
 * via a nibble lookup into the 64-character alphabet. That produced
 * a 64-character "challenge" and was rejected by GitHub.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] as number;
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];

    // 18 bits from bytes 0-1, always emitted.
    output +=
      BASE64_URL_ALPHABET[(byte0 >> 2) & 0x3f];
    output +=
      BASE64_URL_ALPHABET[
        (((byte0 & 0x03) << 4) | ((byte1 ?? 0) >> 4)) & 0x3f
      ];

    if (byte1 === undefined) {
      // One trailing byte: two characters, no third.
      break;
    }

    output +=
      BASE64_URL_ALPHABET[(((byte1 & 0x0f) << 2) | ((byte2 ?? 0) >> 6)) & 0x3f];

    if (byte2 === undefined) {
      // Two trailing bytes: three characters, no fourth.
      break;
    }

    output += BASE64_URL_ALPHABET[byte2 & 0x3f];
  }

  return output;
}

/**
 * PKCE `code_verifier` (RFC 7636 §4.1).
 *
 * 32 bytes of `crypto.getRandomValues` -> exactly 43 base64url
 * characters, which is the minimum permitted length and uses only
 * the unreserved set `[A-Za-z0-9-._~]`. 256 bits of entropy.
 */
export function createCodeVerifier(): string {
  return base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(32)),
  );
}

/**
 * PKCE `code_challenge` for the S256 method (RFC 7636 §4.2):
 *
 *   BASE64URL_NO_PADDING(SHA-256(ASCII(code_verifier)))
 *
 * Always 43 characters, matching /^[A-Za-z0-9_-]{43}$/.
 */
export async function codeChallengeS256(
  verifier: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(verifier),
  );

  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Constant-time-ish string comparison. Both operands are compared in
 * full; the early exit is over the hash output, which is fixed length.
 */
export function safeEqual(
  a: string,
  b: string,
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (
    let index = 0;
    index < a.length;
    index += 1
  ) {
    difference |=
      a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}
