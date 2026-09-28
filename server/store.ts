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

export async function listPublicQuestions(
  db: D1Database,
  filters: {
    engine?: string | null;
    category?: string | null;
    difficulty?: string | null;
  } = {},
): Promise<PublicQuestion[]> {
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
        ORDER BY category ASC, title ASC`,
    )
    .bind(...bindings)
    .all<QuestionRow>();

  return results.map(toPublicQuestion);
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

  for (const input of inputs) {
    const existing = await db
      .prepare(`SELECT id FROM questions WHERE id = ?`)
      .bind(input.id)
      .first<{ id: string }>();

    if (existing !== null) {
      outcome.skipped += 1;
      outcome.conflicts += 1;
      continue;
    }

    try {
      const result = await createQuestion(
        db,
        { ...input, published: false, enabled: true },
        actorGithubId,
        now,
      );

      if (result.status === "created") {
        outcome.imported += 1;
      } else {
        outcome.skipped += 1;
        outcome.conflicts += 1;
      }
    } catch (error) {
      outcome.failed += 1;
      outcome.failures.push({
        id: input.id,
        reason:
          error instanceof Error
            ? error.message
            : "unknown error",
      });
    }
  }

  return outcome;
}
