/**
 * Minimal JavaScript/TypeScript source scanner.
 *
 * `scripts/verify-build.mjs` and `scripts/predeploy-worker.mjs` need
 * to assert that a Worker bundle contains no `/queryvanta/` asset
 * reference. A naive substring search also matches the same text
 * inside a comment, which produced a false positive on
 * `public/worker/pyspark-test-worker.js`, whose header documents
 * that it runs under a project-pages subpath.
 *
 * A false positive in a deploy guard is corrosive: the only ways to
 * make the guard pass would be to delete accurate documentation or
 * to weaken the guard, and both hide real regressions. So the
 * scanner strips comments before searching, and the scanner itself
 * is unit tested in `server/tests/build-target.test.ts`.
 *
 * Supported: line comments, block comments, single/double quoted
 * strings and template literals (including nested `${}`). Regular
 * expression literals are not tracked, which is acceptable here
 * because a regex literal containing `/queryvanta/` cannot resolve
 * to a network request.
 */

const LINE_COMMENT = "line";
const BLOCK_COMMENT = "block";
const CODE = "code";

/**
 * Remove comments from source text, preserving string literals.
 *
 * Line breaks are preserved so reported line numbers stay accurate.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let state = CODE;
  // Both are assigned immediately before their only read, inside the
  // string-literal branches below.
  let quote: string;
  let templateDepth: number;
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (state === LINE_COMMENT) {
      if (char === "\n") {
        state = CODE;
        out.push(char);
      } else {
        out.push(" ");
      }

      index += 1;
      continue;
    }

    if (state === BLOCK_COMMENT) {
      if (char === "*" && next === "/") {
        out.push("  ");
        index += 2;
        state = CODE;
        continue;
      }

      out.push(char === "\n" ? "\n" : " ");
      index += 1;
      continue;
    }

    // CODE
    if (char === "/" && next === "/") {
      out.push("  ");
      index += 2;
      state = LINE_COMMENT;
      continue;
    }

    if (char === "/" && next === "*") {
      out.push("  ");
      index += 2;
      state = BLOCK_COMMENT;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out.push(char);
      index += 1;

      while (index < source.length) {
        const inner = source[index] as string;

        if (inner === "\\") {
          out.push(inner, source[index + 1] ?? "");
          index += 2;
          continue;
        }

        out.push(inner);
        index += 1;

        if (inner === quote) {
          break;
        }
      }

      continue;
    }

    if (char === "`") {
      out.push(char);
      index += 1;
      templateDepth = 0;

      while (index < source.length) {
        const inner = source[index] as string;

        if (inner === "\\") {
          out.push(inner, source[index + 1] ?? "");
          index += 2;
          continue;
        }

        if (inner === "$" && source[index + 1] === "{") {
          out.push(inner, "{");
          index += 2;
          templateDepth += 1;

          // Keep the interpolated expression verbatim; it is code.
          let braces = 1;

          while (index < source.length && braces > 0) {
            const expr = source[index] as string;

            if (expr === "{") {
              braces += 1;
            } else if (expr === "}") {
              braces -= 1;

              if (braces === 0) {
                out.push(expr);
                index += 1;
                break;
              }
            }

            out.push(expr);
            index += 1;
          }

          templateDepth -= 1;
          continue;
        }

        out.push(inner);
        index += 1;

        if (inner === "`" && templateDepth === 0) {
          break;
        }
      }

      continue;
    }

    out.push(char);
    index += 1;
  }

  return out.join("");
}

/**
 * Count occurrences of `needle` in the live code of `source`,
 * ignoring comments.
 */
export function countInLiveCode(
  source: string,
  needle: string,
): number {
  if (needle === "") {
    return 0;
  }

  const live = stripComments(source);
  let count = 0;
  let index = live.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = live.indexOf(needle, index + needle.length);
  }

  return count;
}
