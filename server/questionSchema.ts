/**
 * Question validation.
 *
 * This is the server-side mirror of the existing client model in
 * `src/data/questions.ts` and the client import validation in
 * `src/lib/adminQuestions.ts`. The allowed enumerations are
 * identical, so a question that the admin UI can create is a
 * question the API accepts.
 *
 * Validation happens BEFORE any database call.
 */

import {
  optionalString,
  requireString,
  requireStringArray,
  RequestError,
} from "./request.ts";

export const DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard",
] as const;

export const QUESTION_TYPES = [
  "SQL",
  "PySpark",
  "Data Modeling",
  "Data Engineering",
  "Architecture",
] as const;

/**
 * Only SQL and PySpark are creatable through the API, matching
 * `normalizeImportedQuestion` in the client. The wider enum exists
 * for the built-in catalog's forward compatibility.
 */
export const CREATABLE_QUESTION_TYPES = [
  "SQL",
  "PySpark",
] as const;

export const COLUMN_TYPES = [
  "INTEGER",
  "BIGINT",
  "DECIMAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
] as const;

export const LIMITS = {
  id: 120,
  title: 200,
  description: 20_000,
  category: 120,
  code: 60_000,
  hint: 5_000,
  explanation: 20_000,
  tags: 30,
  companies: 30,
  languages: 10,
  tables: 20,
  columnsPerTable: 60,
  rowsPerTable: 5_000,
  tagLength: 60,
} as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export type TableColumnInput = {
  name: string;
  type: string;
  nullable?: boolean;
};

export type TableInput = {
  name: string;
  columns: TableColumnInput[];
  rows: Record<string, unknown>[];
};

export type QuestionInput = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  questionType: string;
  category: string;
  languages: string[];
  tags: string[];
  companies: string[];
  database: {
    engine: "PostgreSQL";
    tables: TableInput[];
  } | null;
  starterCode: string | null;
  hint: string | null;
  solutionCode: string | null;
  explanation: string | null;
  validation: {
    type: "result";
    orderMatters: boolean;
    expectedResult: Record<string, unknown>[];
  } | null;
  enabled: boolean;
  published: boolean;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseTableColumn(
  value: unknown,
  tableLabel: string,
): TableColumnInput {
  if (!isRecord(value)) {
    throw new RequestError(
      "bad_request",
      `${tableLabel} has a column that is not an object.`,
    );
  }

  const name = requireString(value, "name", 120);
  const type = requireString(value, "type", 32);

  if (
    !COLUMN_TYPES.includes(
      type as (typeof COLUMN_TYPES)[number],
    )
  ) {
    throw new RequestError(
      "bad_request",
      `${tableLabel} has an unsupported column type "${type}".`,
    );
  }

  if (
    value.nullable !== undefined &&
    typeof value.nullable !== "boolean"
  ) {
    throw new RequestError(
      "bad_request",
      `${tableLabel} column "${name}" has an invalid "nullable".`,
    );
  }

  return {
    name,
    type,
    ...(typeof value.nullable === "boolean"
      ? { nullable: value.nullable }
      : {}),
  };
}

function parseTable(
  value: unknown,
  index: number,
): TableInput {
  const label = `Table ${index + 1}`;

  if (!isRecord(value)) {
    throw new RequestError(
      "bad_request",
      `${label} is not an object.`,
    );
  }

  const name = requireString(value, "name", 120);

  if (!Array.isArray(value.columns)) {
    throw new RequestError(
      "bad_request",
      `${label} ("${name}") is missing "columns".`,
    );
  }

  if (value.columns.length === 0) {
    throw new RequestError(
      "bad_request",
      `${label} ("${name}") must define at least one column.`,
    );
  }

  if (value.columns.length > LIMITS.columnsPerTable) {
    throw new RequestError(
      "bad_request",
      `${label} exceeds ${LIMITS.columnsPerTable} columns.`,
    );
  }

  if (!Array.isArray(value.rows)) {
    throw new RequestError(
      "bad_request",
      `${label} ("${name}") is missing "rows".`,
    );
  }

  if (value.rows.length > LIMITS.rowsPerTable) {
    throw new RequestError(
      "bad_request",
      `${label} ("${name}") exceeds ${LIMITS.rowsPerTable} rows.`,
    );
  }

  const columns = value.columns.map((column) =>
    parseTableColumn(column, label),
  );

  const rows = value.rows.map((row) => {
    if (!isRecord(row)) {
      throw new RequestError(
        "bad_request",
        `${label} ("${name}") has a row that is not a JSON object.`,
      );
    }

    return row;
  });

  return { name, columns, rows };
}

function parseDatabase(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new RequestError(
      "bad_request",
      '"database" must be an object.',
    );
  }

  if (value.engine !== "PostgreSQL") {
    throw new RequestError(
      "bad_request",
      'Only the "PostgreSQL" database engine is supported.',
    );
  }

  if (!Array.isArray(value.tables)) {
    throw new RequestError(
      "bad_request",
      '"database" is missing "tables".',
    );
  }

  if (
    value.tables.length === 0 ||
    value.tables.length > LIMITS.tables
  ) {
    throw new RequestError(
      "bad_request",
      `"database" must define between 1 and ${LIMITS.tables} tables.`,
    );
  }

  return {
    engine: "PostgreSQL" as const,
    tables: value.tables.map(parseTable),
  };
}

function parseValidation(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new RequestError(
      "bad_request",
      '"validation" must be an object.',
    );
  }

  if (value.type !== "result") {
    throw new RequestError(
      "bad_request",
      'Only the "result" validation type is supported.',
    );
  }

  if (
    !Array.isArray(value.expectedResult) ||
    !value.expectedResult.every(isRecord)
  ) {
    throw new RequestError(
      "bad_request",
      '"validation.expectedResult" must be an array of JSON objects.',
    );
  }

  if (
    value.orderMatters !== undefined &&
    typeof value.orderMatters !== "boolean"
  ) {
    throw new RequestError(
      "bad_request",
      '"validation.orderMatters" must be a boolean.',
    );
  }

  return {
    type: "result" as const,
    orderMatters: value.orderMatters === true,
    expectedResult:
      value.expectedResult as Record<string, unknown>[],
  };
}

function parseId(value: unknown): string {
  const id =
    typeof value === "string" ? value.trim() : "";

  if (!ID_PATTERN.test(id)) {
    throw new RequestError(
      "bad_request",
      '"id" must be 1-120 characters of letters, digits, dot, ' +
        "underscore or hyphen, starting with a letter or digit.",
    );
  }

  return id;
}

/** Validate a create/update payload into a normalized question. */
export function parseQuestionInput(
  body: Record<string, unknown>,
): QuestionInput {
  const id = parseId(body.id);

  const difficulty = requireString(
    body,
    "difficulty",
    20,
  );

  if (
    !DIFFICULTIES.includes(
      difficulty as (typeof DIFFICULTIES)[number],
    )
  ) {
    throw new RequestError(
      "bad_request",
      `Unsupported difficulty "${difficulty}".`,
    );
  }

  const questionType = requireString(
    body,
    "questionType",
    40,
  );

  if (
    !CREATABLE_QUESTION_TYPES.includes(
      questionType as (typeof CREATABLE_QUESTION_TYPES)[number],
    )
  ) {
    throw new RequestError(
      "bad_request",
      `Unsupported questionType "${questionType}". Allowed: ${CREATABLE_QUESTION_TYPES.join(", ")}.`,
    );
  }

  return {
    id,
    title: requireString(body, "title", LIMITS.title),
    description: requireString(
      body,
      "description",
      LIMITS.description,
    ),
    difficulty,
    questionType,
    category: requireString(
      body,
      "category",
      LIMITS.category,
    ),
    languages: requireStringArray(
      body,
      "languages",
      LIMITS.languages,
      LIMITS.tagLength,
    ),
    tags: requireStringArray(
      body,
      "tags",
      LIMITS.tags,
      LIMITS.tagLength,
    ),
    companies: requireStringArray(
      body,
      "companies",
      LIMITS.companies,
      LIMITS.tagLength,
    ),
    database: parseDatabase(body.database),
    starterCode: optionalString(
      body,
      "starterCode",
      LIMITS.code,
    ),
    hint: optionalString(body, "hint", LIMITS.hint),
    solutionCode: optionalString(
      body,
      "solutionCode",
      LIMITS.code,
    ),
    explanation: optionalString(
      body,
      "explanation",
      LIMITS.explanation,
    ),
    validation: parseValidation(body.validation),
    enabled: body.enabled === undefined
      ? true
      : body.enabled === true,
    published: body.published === undefined
      ? false
      : body.published === true,
  };
}

/** Validate a `:id` path parameter. */
export function parseQuestionId(
  raw: string,
): string {
  return parseId(raw);
}
