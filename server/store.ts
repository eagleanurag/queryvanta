/**
 * D1 question persistence.
 *
 * All statements are parameterised — no value is ever concatenated
 * into SQL. The public read path is restricted in SQL itself, so a
 * draft or disabled question cannot leak through a code change in
 * the row mapper.
 */

import type { QuestionInput } from "./questionSchema.ts";

export type QuestionRow = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  question_type: string;
  category: string;
  languages: string;
  tags: string;
  companies: string;
  database_json: string | null;
  starter_code: string | null;
  hint: string | null;
  solution_code: string | null;
  explanation: string | null;
  validation_json: string | null;
  enabled: number;
  published: number;
  deleted_at: string | null;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PublicQuestion = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  questionType: string;
  category: string;
  languages: string[];
  tags: string[];
  companies: string[];
  database: unknown | null;
  starterCode: string | null;
  hint: string | null;
  solutionCode: string | null;
  explanation: string | null;
  validation: unknown | null;
};

export type AdminQuestion = PublicQuestion & {
  enabled: boolean;
  published: boolean;
  source: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is string => typeof item === "string",
      );
    }
  } catch {
    // Fall through to the safe default.
  }

  return [];
}

function parseJsonOrNull(
  raw: string | null,
): unknown | null {
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toPublicQuestion(
  row: QuestionRow,
): PublicQuestion {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    questionType: row.question_type,
    category: row.category,
    languages: parseJsonArray(row.languages),
    tags: parseJsonArray(row.tags),
    companies: parseJsonArray(row.companies),
    database: parseJsonOrNull(row.database_json),
    starterCode: row.starter_code,
    hint: row.hint,
    solutionCode: row.solution_code,
    explanation: row.explanation,
    validation: parseJsonOrNull(row.validation_json),
  };
}

function toAdminQuestion(row: QuestionRow): AdminQuestion {
  return {
    ...toPublicQuestion(row),
    enabled: row.enabled === 1,
    published: row.published === 1,
    source: row.source,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/**
 * The public read predicate, applied inside SQL.
 *
 * Only enabled AND published AND not-deleted rows are selectable.
 */
const PUBLIC_PREDICATE =
  "enabled = 1 AND published = 1 AND deleted_at IS NULL";

/**
 * Public list page size (audit finding V-06).
 *
 * The catalog is 35 built-in questions plus whatever an administrator
 * adds. 100 is comfortably above the built-in catalog, so the common
 * case is never truncated, while still bounding both the row read and
 * the response size. The response reports `total` separately so a client
 * is never misled about how much exists.
 */
export const PUBLIC_LIST_LIMIT = 100;

export type PublicQuestionPage = {
  questions: PublicQuestion[];
  /** Total matching rows, independent of the page limit. */
  total: number;
};

export async function listPublicQuestions(
  db: D1Database,
  filters: {
    engine?: string | null;
    category?: string | null;
    difficulty?: string | null;
  } = {},
  limit: number = PUBLIC_LIST_LIMIT,
): Promise<PublicQuestionPage> {
  const conditions = [PUBLIC_PREDICATE];
  const bindings: string[] = [];

  if (
    filters.engine !== null &&
    filters.engine !== undefined &&
    filters.engine !== "All"
  ) {
    conditions.push("question_type = ?");
    bindings.push(filters.engine);
  }

  if (
    filters.category !== null &&
    filters.category !== undefined &&
    filters.category !== "All"
  ) {
    conditions.push("category = ?");
    bindings.push(filters.category);
  }

  if (
    filters.difficulty !== null &&
    filters.difficulty !== undefined &&
    filters.difficulty !== "All"
  ) {
    conditions.push("difficulty = ?");
    bindings.push(filters.difficulty);
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM questions
        WHERE ${conditions.join(" AND ")}
        ORDER BY category ASC, title ASC
        LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<QuestionRow>();

  const total = await countPublicQuestions(
    db,
    filters,
  );

  return {
    questions: results.map(toPublicQuestion),
    total,
  };
}

/**
 * Total matching rows for the same filters.
 *
 * Counted separately from the page so the response can report how much
 * exists in total even when the page is truncated. The existing
 * `enabled/published/deleted_at` index set supports both statements, so
 * this costs one cheap aggregate rather than a second full scan.
 */
async function countPublicQuestions(
  db: D1Database,
  filters: {
    engine?: string | null;
    category?: string | null;
    difficulty?: string | null;
  },
): Promise<number> {
  const conditions = [PUBLIC_PREDICATE];
  const bindings: string[] = [];

  if (
    filters.engine !== null &&
    filters.engine !== undefined &&
    filters.engine !== "All"
  ) {
    conditions.push("question_type = ?");
    bindings.push(filters.engine);
  }

  if (
    filters.category !== null &&
    filters.category !== undefined &&
    filters.category !== "All"
  ) {
    conditions.push("category = ?");
    bindings.push(filters.category);
  }

  if (
    filters.difficulty !== null &&
    filters.difficulty !== undefined &&
    filters.difficulty !== "All"
  ) {
    conditions.push("difficulty = ?");
    bindings.push(filters.difficulty);
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM questions
        WHERE ${conditions.join(" AND ")}`,
    )
    .bind(...bindings)
    .first<{ n: number }>();

  return Number(row?.n ?? 0);
}

export async function getPublicQuestion(
  db: D1Database,
  id: string,
): Promise<PublicQuestion | null> {
  const row = await db
    .prepare(
      `SELECT * FROM questions
        WHERE id = ? AND ${PUBLIC_PREDICATE}`,
    )
    .bind(id)
    .first<QuestionRow>();

  return row === null ? null : toPublicQuestion(row);
}

export async function listAdminQuestions(
  db: D1Database,
  options: { includeDeleted?: boolean } = {},
): Promise<AdminQuestion[]> {
  const where =
    options.includeDeleted === true
      ? "deleted_at IS NULL OR deleted_at IS NOT NULL"
      : "deleted_at IS NULL";

  const { results } = await db
    .prepare(
      `SELECT * FROM questions
        WHERE ${where}
        ORDER BY updated_at DESC, id ASC`,
    )
    .all<QuestionRow>();

  return results.map(toAdminQuestion);
}

export async function getAdminQuestion(
  db: D1Database,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<AdminQuestion | null> {
  const row = await db
    .prepare(
      `SELECT * FROM questions
        WHERE id = ? ${
          options.includeDeleted === true
            ? ""
            : "AND deleted_at IS NULL"
        }`,
    )
    .bind(id)
    .first<QuestionRow>();

  return row === null ? null : toAdminQuestion(row);
}

export type CreateOutcome =
  | { status: "created"; question: AdminQuestion }
  | { status: "conflict" };

export async function createQuestion(
  db: D1Database,
  input: QuestionInput,
  actorGithubId: string,
  now: string,
): Promise<CreateOutcome> {
  const existing = await db
    .prepare(`SELECT id FROM questions WHERE id = ?`)
    .bind(input.id)
    .first<{ id: string }>();

  if (existing !== null) {
    return { status: "conflict" };
  }

  await db
    .prepare(
      `INSERT INTO questions (
         id, title, description, difficulty, question_type,
         category, languages, tags, companies, database_json,
         starter_code, hint, solution_code, explanation,
         validation_json, enabled, published, deleted_at,
         source, version, created_at, updated_at,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.title,
      input.description,
      input.difficulty,
      input.questionType,
      input.category,
      JSON.stringify(input.languages),
      JSON.stringify(input.tags),
      JSON.stringify(input.companies),
      input.database === null
        ? null
        : JSON.stringify(input.database),
      input.starterCode,
      input.hint,
      input.solutionCode,
      input.explanation,
      input.validation === null
        ? null
        : JSON.stringify(input.validation),
      input.enabled ? 1 : 0,
      input.published ? 1 : 0,
      "admin",
      1,
      now,
      now,
      actorGithubId,
      actorGithubId,
    )
    .run();

  const created = await getAdminQuestion(db, input.id);

  return created === null
    ? { status: "conflict" }
    : { status: "created", question: created };
}

export type UpdateOutcome =
  | { status: "updated"; question: AdminQuestion }
  | { status: "not_found" }
  | { status: "version_conflict"; current: AdminQuestion };

/**
 * Optimistic-concurrency update. A caller that passes a stale
 * `expectedVersion` gets `version_conflict` and cannot silently
 * clobber a newer server-side edit.
 */
export async function updateQuestion(
  db: D1Database,
  input: QuestionInput,
  actorGithubId: string,
  now: string,
  expectedVersion: number | null,
): Promise<UpdateOutcome> {
  const current = await getAdminQuestion(db, input.id);

  if (current === null) {
    return { status: "not_found" };
  }

  if (
    expectedVersion !== null &&
    expectedVersion !== current.version
  ) {
    return {
      status: "version_conflict",
      current,
    };
  }

  await db
    .prepare(
      `UPDATE questions
          SET title = ?, description = ?, difficulty = ?,
              question_type = ?, category = ?, languages = ?,
              tags = ?, companies = ?, database_json = ?,
              starter_code = ?, hint = ?, solution_code = ?,
              explanation = ?, validation_json = ?,
              enabled = ?, published = ?, version = version + 1,
              updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
    )
    .bind(
      input.title,
      input.description,
      input.difficulty,
      input.questionType,
      input.category,
      JSON.stringify(input.languages),
      JSON.stringify(input.tags),
      JSON.stringify(input.companies),
      input.database === null
        ? null
        : JSON.stringify(input.database),
      input.starterCode,
      input.hint,
      input.solutionCode,
      input.explanation,
      input.validation === null
        ? null
        : JSON.stringify(input.validation),
      input.enabled ? 1 : 0,
      input.published ? 1 : 0,
      now,
      actorGithubId,
      input.id,
      current.version,
    )
    .run();

  const updated = await getAdminQuestion(db, input.id);

  if (
    updated === null ||
    updated.version !== current.version + 1
  ) {
    // A concurrent writer won the race; report it honestly.
    const latest = await getAdminQuestion(db, input.id);

    return latest === null
      ? { status: "not_found" }
      : { status: "version_conflict", current: latest };
  }

  return { status: "updated", question: updated };
}

export async function setQuestionFlag(
  db: D1Database,
  id: string,
  flag: "enabled" | "published",
  value: boolean,
  actorGithubId: string,
  now: string,
): Promise<AdminQuestion | null> {
  const current = await getAdminQuestion(db, id);

  if (current === null) {
    return null;
  }

  const column =
    flag === "enabled" ? "enabled" : "published";

  await db
    .prepare(
      `UPDATE questions
          SET ${column} = ?, version = version + 1,
              updated_at = ?, updated_by = ?
        WHERE id = ?`,
    )
    .bind(value ? 1 : 0, now, actorGithubId, id)
    .run();

  return getAdminQuestion(db, id);
}

export type DeleteOutcome =
  | { status: "deleted"; question: AdminQuestion }
  | { status: "not_found" };

/**
 * Soft delete.
 *
 * Historical references (audit log rows, past sessions) keep a
 * resolvable record; the row is retained and marked `deleted_at`
 * rather than destroyed. The public predicate already excludes it.
 */
export async function deleteQuestion(
  db: D1Database,
  id: string,
  actorGithubId: string,
  now: string,
): Promise<DeleteOutcome> {
  const current = await getAdminQuestion(db, id);

  if (current === null) {
    return { status: "not_found" };
  }

  await db
    .prepare(
      `UPDATE questions
          SET deleted_at = ?, enabled = 0, published = 0,
              version = version + 1, updated_at = ?,
              updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, actorGithubId, id)
    .run();

  const deleted = await getAdminQuestion(db, id, {
    includeDeleted: true,
  });

  return deleted === null
    ? { status: "not_found" }
    : { status: "deleted", question: deleted };
}

export async function duplicateQuestion(
  db: D1Database,
  id: string,
  newId: string,
  actorGithubId: string,
  now: string,
): Promise<CreateOutcome> {
  const source = await getAdminQuestion(db, id, {
    includeDeleted: true,
  });

  if (source === null) {
    return { status: "conflict" };
  }

  return createQuestion(
    db,
    {
      id: newId,
      title: `${source.title} (Copy)`.slice(0, 200),
      description: source.description,
      difficulty: source.difficulty,
      questionType: source.questionType,
      category: source.category,
      languages: source.languages,
      tags: source.tags,
      companies: source.companies,
      database:
        source.database === null
          ? null
          : (source.database as QuestionInput["database"]),
      starterCode: source.starterCode,
      hint: source.hint,
      solutionCode: source.solutionCode,
      explanation: source.explanation,
      validation:
        source.validation === null
          ? null
          : (source.validation as QuestionInput["validation"]),
      // A duplicate always starts disabled and unpublished so it is
      // never publicly visible by accident.
      enabled: true,
      published: false,
    },
    actorGithubId,
    now,
  );
}

/**
 * Deterministic bulk insert used by the local-question migration.
 *
 * Existing ids are skipped rather than overwritten, so a newer
 * server-side question is never silently replaced.
 */
export type ImportOutcome = {
  imported: number;
  skipped: number;
  failed: number;
  conflicts: number;
  failures: { id: string; reason: string }[];
};

/**
 * Maximum rows per multi-row INSERT.
 *
 * DERIVED FROM D1's real limit, not guessed: Cloudflare D1 allows 100
 * bound parameters per statement. The questions INSERT binds 23
 * parameters per row, so floor(100 / 23) = 4 rows fit in one statement
 * (92 parameters). Five rows would need 115 and would be rejected.
 */
export const IMPORT_ROWS_PER_STATEMENT = 4;

/**
 * Maximum statements per `db.batch()` call.
 *
 * `db.batch()` sends everything in one round trip, but chunking the batch
 * keeps peak memory bounded for a full 500-item import and keeps any
 * single failure attributable to a small, identifiable group of rows.
 */
export const IMPORT_STATEMENTS_PER_BATCH = 50;

/**
 * Bind values for one import row, in `IMPORT_COLUMNS` order.
 */
function importRowBindings(
  input: QuestionInput,
  actorGithubId: string,
  now: string,
): unknown[] {
  return [
    input.id,
    input.title,
    input.description,
    input.difficulty,
    input.questionType,
    input.category,
    JSON.stringify(input.languages),
    JSON.stringify(input.tags),
    JSON.stringify(input.companies),
    input.database === null ? null : JSON.stringify(input.database),
    input.starterCode,
    input.hint,
    input.solutionCode,
    input.explanation,
    input.validation === null
      ? null
      : JSON.stringify(input.validation),
    1, // enabled
    0, // published: an import is always a draft
    "admin",
    1,
    now,
    now,
    actorGithubId,
    actorGithubId,
  ];
}

const IMPORT_COLUMN_LIST =
  "id, title, description, difficulty, question_type, " +
  "category, languages, tags, companies, database_json, " +
  "starter_code, hint, solution_code, explanation, " +
  "validation_json, enabled, published, deleted_at, " +
  "source, version, created_at, updated_at, " +
  "created_by, updated_by";

function importRowPlaceholder(): string {
  return (
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " +
    "?, ?, NULL, ?, ?, ?, ?, ?, ?)"
  );
}

/**
 * Bulk import (audit finding V-08).
 *
 * WAS: a sequential loop performing three D1 round trips per item (an
 * existence `SELECT`, an `INSERT`, and a read-back), so a 500-item
 * import cost roughly 1,500 sequential round trips.
 *
 * NOW: a fixed number of round trips, independent of item count.
 *   1. ONE batched existence query covering every submitted id at once,
 *      replacing up to 500 individual `SELECT`s.
 *   2. Multi-row `INSERT ... ON CONFLICT(id) DO NOTHING` statements of
 *      four rows each, issued through `db.batch()`.
 *
 * WHY THE EXISTENCE QUERY SURVIVES
 *
 * The audit calls the old per-item pre-check redundant because the unique
 * primary key already enforces the invariant. It does: nothing is ever
 * overwritten, because `ON CONFLICT(id) DO NOTHING` refuses the write.
 *
 * What the primary key cannot do is TELL US WHICH id conflicted. The
 * per-item `skipped`/`conflicts` outcome is part of this task's
 * contract, and it cannot be reconstructed after the fact: a chunk that
 * inserted two of three rows gives no indication which two, and an id
 * inserted by this very request is indistinguishable from one that
 * already existed. One batched lookup is what preserves exact, ordered,
 * per-item reporting, and it is a single round trip rather than 500.
 */

export async function importQuestions(
  db: D1Database,
  inputs: QuestionInput[],
  actorGithubId: string,
  now: string,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    imported: 0,
    skipped: 0,
    failed: 0,
    conflicts: 0,
    failures: [],
  };

  if (inputs.length === 0) {
    return outcome;
  }

  const existing = await findExistingIds(
    db,
    inputs.map((input) => input.id),
  );

  // Decide each row's fate up front, in input order.
  //
  // An id repeated WITHIN this request conflicts on every occurrence after
  // the first, which is exactly what the old sequential loop reported: the
  // first occurrence created the row, the later ones found it present.
  const seenInRequest = new Set<string>();
  const toInsert: QuestionInput[] = [];

  for (const input of inputs) {
    if (existing.has(input.id) || seenInRequest.has(input.id)) {
      outcome.skipped += 1;
      outcome.conflicts += 1;
      continue;
    }

    seenInRequest.add(input.id);
    toInsert.push(input);
  }

  if (toInsert.length === 0) {
    return outcome;
  }

  const statements: D1PreparedStatement[] = [];

  for (
    let index = 0;
    index < toInsert.length;
    index += IMPORT_ROWS_PER_STATEMENT
  ) {
    const chunk = toInsert.slice(
      index,
      index + IMPORT_ROWS_PER_STATEMENT,
    );

    statements.push(
      db
        .prepare(
          `INSERT INTO questions (${IMPORT_COLUMN_LIST}) VALUES ` +
            chunk.map(() => importRowPlaceholder()).join(", ") +
            ` ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          ...chunk.flatMap((input) =>
            importRowBindings(input, actorGithubId, now),
          ),
        ),
    );
  }

  let written = 0;

  for (
    let index = 0;
    index < statements.length;
    index += IMPORT_STATEMENTS_PER_BATCH
  ) {
    const slice = statements.slice(
      index,
      index + IMPORT_STATEMENTS_PER_BATCH,
    );

    try {
      const batchResults = await db.batch(slice);

      for (const result of batchResults) {
        written += Number(result?.meta?.changes ?? 0);
      }
    } catch {
      // A group failed. The reason is deliberately not surfaced here:
      // falling back to per-row inserts reproduces the precise per-item
      // failure that caused it, and reporting the batch-level error as
      // well would double-count the same fault.
      const group = toInsert.slice(
        index,
        index + IMPORT_STATEMENTS_PER_BATCH,
      );

      for (const input of group) {
        const failure = await importSingleRow(
          db,
          input,
          actorGithubId,
          now,
        );

        if (failure === null) {
          written += 1;
        } else {
          outcome.failed += 1;
          outcome.failures.push({ id: input.id, reason: failure });
        }
      }
    }
  }

  outcome.imported = written;

  return outcome;
}

/**
 * Which of the given ids already exist.
 *
 * Used only for the rare ambiguous chunk, so the common import path does
 * no existence `SELECT` at all.
 */
async function findExistingIds(
  db: D1Database,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(ids)];

  for (
    let index = 0;
    index < unique.length;
    index += IMPORT_ROWS_PER_STATEMENT
  ) {
    const slice = unique.slice(index, index + IMPORT_ROWS_PER_STATEMENT);
    const placeholders = slice.map(() => "?").join(", ");

    const { results } = await db
      .prepare(
        `SELECT id FROM questions WHERE id IN (${placeholders})`,
      )
      .bind(...slice)
      .all<{ id: string }>();

    for (const row of results) {
      found.add(row.id);
    }
  }

  return found;
}

/**
 * Per-row insert used only by the error fallback.
 *
 * Returns null on success, or the failure reason.
 */
async function importSingleRow(
  db: D1Database,
  input: QuestionInput,
  actorGithubId: string,
  now: string,
): Promise<string | null> {
  try {
    await db
      .prepare(
        `INSERT INTO questions (${IMPORT_COLUMN_LIST}) VALUES ` +
          `${importRowPlaceholder()} ON CONFLICT(id) DO NOTHING`,
      )
      .bind(...importRowBindings(input, actorGithubId, now))
      .run();

    return null;
  }
  catch (error) {
    return error instanceof Error ? error.message : "unknown error";
  }
}
