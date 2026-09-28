import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const distDir = join(repoRoot, "dist");

/**
 * Secret-exposure checks.
 *
 * These read the ACTUAL production build output, not the source, so
 * a value that is merely referenced in a `VITE_` variable would
 * still be caught.
 */

function walk(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }

    if (/\.(js|mjs|css|html|json|map)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

const buildFiles = existsSync(distDir)
  ? walk(distDir)
  : [];

const buildText = buildFiles
  .map((file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

describe("SECRET EXPOSURE", () => {
  it("the production build exists", () => {
    assert.ok(
      buildFiles.length > 0,
      "dist/ is missing — run `npm run build` first",
    );
  });

  it("does not embed the OAuth client secret", () => {
    assert.ok(
      buildFiles.length > 0,
      "run `npm run build` first",
    );

    // A distinctive sentinel, so a generic word never trips this.
    assert.doesNotMatch(
      buildText,
      /qv-should-never-appear-in-client-bundle/,
    );
  });

  it("does not embed the session secret name with a value", () => {
    assert.doesNotMatch(
      buildText,
      /SESSION_SECRET\s*[:=]\s*["'][^"']{8,}/,
    );
  });

  it("does not embed the admin allow-list", () => {
    assert.doesNotMatch(
      buildText,
      /ADMIN_GITHUB_IDS\s*[:=]\s*["'][^"']*\d{4,}["']/,
    );
  });

  it("never reads a server secret from a VITE_ variable", () => {
    const srcDir = join(repoRoot, "src");

    for (const file of walk(srcDir)) {
      const text = readFileSync(file, "utf8");

      const matches = text.matchAll(
        /import\.meta\.env\.([A-Z0-9_]+)/g,
      );

      for (const match of matches) {
        const name = match[1] as string;

        assert.ok(
          !/SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|CLIENT_SECRET/i.test(
            name,
          ),
          `${file} reads import.meta.env.${name}, which looks like a secret`,
        );
      }
    }
  });

  it("never stores an admin token in web storage", () => {
    const srcDir = join(repoRoot, "src");

    for (const file of walk(srcDir)) {
      const text = readFileSync(file, "utf8");

      assert.doesNotMatch(
        text,
        /localStorage\.setItem\(\s*["'][^"']*(token|bearer|jwt|session|auth)/i,
        `${file} writes an auth token to localStorage`,
      );

      assert.doesNotMatch(
        text,
        /sessionStorage\.setItem\(\s*["'][^"']*(token|bearer|jwt|session|auth)/i,
        `${file} writes an auth token to sessionStorage`,
      );
    }
  });

  it("does not implement a client-side admin password check", () => {
    const srcDir = join(repoRoot, "src");

    for (const file of walk(srcDir)) {
      const text = readFileSync(file, "utf8");

      assert.doesNotMatch(
        text,
        /admin[_-]?password/i,
        `${file} references an admin password`,
      );
    }
  });

  it("keeps real credentials out of source-controlled files", () => {
    const trackedText = [
      join(repoRoot, "server"),
      join(repoRoot, "src"),
      join(repoRoot, "migrations"),
    ]
      .flatMap((dir) => (existsSync(dir) ? walk(dir) : []))
      .map((file) => {
        try {
          return readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");

    // Real GitHub OAuth secrets and real Web Crypto private keys.
    assert.doesNotMatch(
      trackedText,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
    );
    assert.doesNotMatch(
      trackedText,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    );
    assert.doesNotMatch(
      trackedText,
      /github_pat_[A-Za-z0-9_]{20,}/,
    );
  });

  it("gitignores the local secrets file", () => {
    const gitignore = readFileSync(
      join(repoRoot, ".gitignore"),
      "utf8",
    );

    assert.match(gitignore, /^\.dev\.vars$/m);
    assert.match(gitignore, /^\.wrangler\/$/m);
    assert.match(gitignore, /^\.env$/m);
  });

  it("never committed a .dev.vars file", () => {
    assert.ok(
      !existsSync(join(repoRoot, ".dev.vars")),
      ".dev.vars must be removed after the test run",
    );
  });
});
