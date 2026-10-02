/**
 * Validation for the public list's query filters (task 4.2E).
 *
 * Audit finding V-12: the three public filter parameters were accepted as
 * arbitrary strings of unbounded length and passed straight to D1 as bound
 * values. Injection was already impossible (they are bound parameters, and
 * `?engine=<script>` returns 200 with zero rows rather than executing), so
 * the real cost is CPU wasted on queries that can never match and an
 * unbounded response path.
 *
 * THE ALLOW-LISTS ARE DERIVED FROM THE CODE, NOT GUESSED
 * ------------------------------------------------------
 * `difficulty` and `engine` are genuinely closed enums in this repository:
 * `server/questionSchema.ts` rejects any write whose difficulty is not in
 * `DIFFICULTIES` or whose questionType is not in `CREATABLE_QUESTION_TYPES`.
 * The same exported constants are reused here, so the read path and the
 * write path can never disagree about what a valid value is.
 *
 * `engine` deliberately uses the WIDER `QUESTION_TYPES` enum rather than
 * `CREATABLE_QUESTION_TYPES`. The catalog is seeded from
 * `src/data/questions.ts`, which can contain types an administrator
 * cannot create through the API today, and the wider enum exists precisely
 * for that forward compatibility. Filtering must not be narrower than the
 * data.
 *
 * `category` IS DELIBERATELY NOT ENUMERATED
 * -------------------------------------------
 * `questions.category` is a free-form `TEXT NOT NULL` column with no CHECK
 * constraint and no enum table, and the write path accepts any string up to
 * `LIMITS.category` characters. The client derives its category list from
 * the catalog itself (`AdminPage` computes `localCategories`; there is no
 * canonical category constant anywhere in `src/`).
 *
 * A static allow-list would therefore be a REGRESSION: an administrator who
 * creates a question in a new category could then never filter by it, and
 * every historical category would have to be hard-coded and kept in sync.
 * Instead `category` is bounded by the same length cap the write path
 * enforces, plus a charset that rejects control characters and the shapes
 * an injected probe would take. That closes the V-12 cost without breaking
 * legitimate data.
 */

import {
  DIFFICULTIES,
  LIMITS,
  QUESTION_TYPES,
} from "./questionSchema.ts";
import { RequestError } from "./request.ts";

/**
 * The sentinel the client sends for "no filter".
 *
 * Preserved because the store already treats it as "do not filter", and
 * removing it would break every existing caller.
 */
const NO_FILTER = "All";

/** Longest category accepted, matching the write path exactly. */
const MAX_CATEGORY_LENGTH = LIMITS.category;

/**
 * Upper bound applied to every filter before any other check.
 *
 * Cheap and unconditional: an enormous value is rejected without being
 * compared against anything.
 */
const MAX_FILTER_LENGTH = 200;

export type PublicFilters = {
  engine: string | null;
  category: string | null;
  difficulty: string | null;
};

/**
 * Read a query parameter, collapsing absent/blank to `null`.
 */
function readFilter(
  url: URL,
  name: string,
): string | null {
  const raw = url.searchParams.get(name);

  if (raw === null) {
    return null;
  }

  const trimmed = raw.trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * Reject a filter that is not one of the known values.
 *
 * The error lists the allowed values so the behaviour is discoverable
 * rather than a silent empty result.
 */
function requireAllowListed(
  name: string,
  value: string,
  allowed: readonly string[],
): string {
  if (value.length > MAX_FILTER_LENGTH) {
    throw new RequestError(
      "bad_request",
      `"${name}" exceeds the maximum length of ${MAX_FILTER_LENGTH}.`,
    );
  }

  if (value === NO_FILTER) {
    return NO_FILTER;
  }

  if (!allowed.includes(value)) {
    throw new RequestError(
      "bad_request",
      `Unsupported ${name} "${value}". Allowed: ${allowed.join(", ")}.`,
    );
  }

  return value;
}

/**
 * Bound and sanity-check a category value.
 *
 * Length is capped at the same limit the admin write path enforces, so a
 * value that could not have been stored cannot be filtered on. Control
 * characters and the angle brackets that would mark an injected probe are
 * rejected outright.
 */
function requireValidCategory(value: string): string {
  if (value.length > MAX_CATEGORY_LENGTH) {
    throw new RequestError(
      "bad_request",
      `"category" exceeds the maximum length of ${MAX_CATEGORY_LENGTH}.`,
    );
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>"'\\]/.test(value)) {
    throw new RequestError(
      "bad_request",
      '"category" contains characters that are not allowed.',
    );
  }

  return value;
}

/**
 * Validate the three public list filters.
 *
 * Throws a `RequestError` with `bad_request` (HTTP 400) rather than
 * silently returning nothing, which is what the task requires and what
 * makes the rule discoverable to a caller.
 */
export function parsePublicFilters(
  url: URL,
): PublicFilters {
  const engine = readFilter(url, "engine");
  const category = readFilter(url, "category");
  const difficulty = readFilter(url, "difficulty");

  return {
    engine:
      engine === null
        ? null
        : requireAllowListed("engine", engine, QUESTION_TYPES),
    category:
      category === null
        ? null
        : requireValidCategory(category),
    difficulty:
      difficulty === null
        ? null
        : requireAllowListed(
            "difficulty",
            difficulty,
            DIFFICULTIES,
          ),
  };
}