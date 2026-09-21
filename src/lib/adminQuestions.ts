import type {
  ColumnType,
  Difficulty,
  Question,
} from "../data/questions";

const STORAGE_KEY = "queryvanta-admin-questions";

const ADMIN_QUESTIONS_EVENT =
  "queryvanta-admin-questions-changed";

const VALID_DIFFICULTIES: Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
];

const VALID_COLUMN_TYPES: ColumnType[] = [
  "INTEGER",
  "BIGINT",
  "DECIMAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
];

function isValidAdminQuestion(
  value: unknown,
): value is Question {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const question = value as Record<string, unknown>;

  return (
    typeof question.id === "string" &&
    question.id.trim() !== "" &&
    typeof question.title === "string" &&
    typeof question.description === "string" &&
    typeof question.difficulty === "string" &&
    typeof question.questionType === "string" &&
    typeof question.category === "string" &&
    Array.isArray(question.languages) &&
    Array.isArray(question.tags) &&
    Array.isArray(question.companies)
  );
}

function readAdminQuestions(): Question[] {
  try {
    const storedValue =
      window.localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown =
      JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isValidAdminQuestion);
  } catch {
    return [];
  }
}

function writeAdminQuestions(
  adminQuestions: Question[],
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(adminQuestions),
    );

    window.dispatchEvent(
      new Event(ADMIN_QUESTIONS_EVENT),
    );
  } catch {
    // Ignore storage failures so the page
    // continues working even if localStorage is unavailable.
  }
}

export function getAdminQuestions(): Question[] {
  return readAdminQuestions();
}

export function saveAdminQuestion(
  question: Question,
): Question[] {
  const adminQuestions = readAdminQuestions();

  adminQuestions.push(question);

  writeAdminQuestions(adminQuestions);

  return adminQuestions;
}

export function updateAdminQuestion(
  question: Question,
): Question[] {
  const adminQuestions = readAdminQuestions();

  const existingIndex = adminQuestions.findIndex(
    (item) => item.id === question.id,
  );

  if (existingIndex === -1) {
    return adminQuestions;
  }

  adminQuestions[existingIndex] = question;

  writeAdminQuestions(adminQuestions);

  return adminQuestions;
}

function generateAdminQuestionId(): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2, 8);

  return `admin-${Date.now()}-${randomSuffix}`;
}

export function duplicateAdminQuestion(
  questionId: string,
): Question | null {
  const adminQuestions = readAdminQuestions();

  const source = adminQuestions.find(
    (item) => item.id === questionId,
  );

  if (!source) {
    return null;
  }

  const copy: Question = JSON.parse(
    JSON.stringify(source),
  );

  copy.id = generateAdminQuestionId();
  copy.title = `${source.title} (Copy)`;
  copy.solved = false;

  adminQuestions.push(copy);

  writeAdminQuestions(adminQuestions);

  return copy;
}

export function deleteAdminQuestion(
  questionId: string,
): Question[] {
  return deleteAdminQuestions([questionId]);
}

export function deleteAdminQuestions(
  questionIds: string[],
): Question[] {
  const idsToDelete = new Set(questionIds);

  const adminQuestions = readAdminQuestions().filter(
    (question) => !idsToDelete.has(question.id),
  );

  writeAdminQuestions(adminQuestions);

  return adminQuestions;
}

export function clearAdminQuestions(): Question[] {
  writeAdminQuestions([]);

  return [];
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() !== ""
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is string =>
        typeof item === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateImportedColumn(
  value: unknown,
): string | null {
  if (!isRecord(value)) {
    return "has an invalid column (expected an object)";
  }

  if (!isNonEmptyString(value.name)) {
    return "has a column with a missing or empty name";
  }

  if (
    typeof value.type !== "string" ||
    !VALID_COLUMN_TYPES.includes(
      value.type.trim() as ColumnType,
    )
  ) {
    return `has a column with an unsupported type "${String(value.type)}"`;
  }

  return null;
}

function validateImportedTable(
  value: unknown,
): string | null {
  if (!isRecord(value)) {
    return "has an invalid table (expected an object)";
  }

  if (!isNonEmptyString(value.name)) {
    return "has a table with a missing or empty name";
  }

  if (!Array.isArray(value.columns)) {
    return `has a table "${String(value.name)}" with missing columns`;
  }

  if (!Array.isArray(value.rows)) {
    return `has a table "${String(value.name)}" with missing rows`;
  }

  for (const column of value.columns) {
    const columnError = validateImportedColumn(column);

    if (columnError !== null) {
      return columnError;
    }
  }

  if (!value.rows.every(isRecord)) {
    return `has a table "${String(value.name)}" with rows that must be JSON objects`;
  }

  return null;
}

function normalizeImportedQuestion(
  value: unknown,
):
  | { valid: true; question: Question }
  | { valid: false; error: string } {
  if (!isRecord(value)) {
    return {
      valid: false,
      error: "is not a JSON object",
    };
  }

  if (!isNonEmptyString(value.id)) {
    return {
      valid: false,
      error: 'has a missing or empty "id"',
    };
  }

  if (typeof value.title !== "string") {
    return {
      valid: false,
      error: 'has an invalid "title"',
    };
  }

  if (typeof value.description !== "string") {
    return {
      valid: false,
      error: 'has an invalid "description"',
    };
  }

  if (
    typeof value.difficulty !== "string" ||
    !VALID_DIFFICULTIES.includes(
      value.difficulty as Difficulty,
    )
  ) {
    return {
      valid: false,
      error: `has an invalid "difficulty" ("${String(value.difficulty)}")`,
    };
  }

  if (value.questionType !== "SQL") {
    return {
      valid: false,
      error: `has an unsupported "questionType" ("${String(value.questionType)}")`,
    };
  }

  if (typeof value.category !== "string") {
    return {
      valid: false,
      error: 'has an invalid "category"',
    };
  }

  if (!isStringArray(value.languages)) {
    return {
      valid: false,
      error: 'has invalid "languages" (expected an array of strings)',
    };
  }

  if (!isStringArray(value.tags)) {
    return {
      valid: false,
      error: 'has invalid "tags" (expected an array of strings)',
    };
  }

  if (!isStringArray(value.companies)) {
    return {
      valid: false,
      error:
        'has invalid "companies" (expected an array of strings)',
    };
  }

  let database: Question["database"];

  if (value.database !== undefined && value.database !== null) {
    if (!isRecord(value.database)) {
      return {
        valid: false,
        error: 'has an invalid "database"',
      };
    }

    if (value.database.engine !== "PostgreSQL") {
      return {
        valid: false,
        error: `has an unsupported database engine ("${String(value.database.engine)}")`,
      };
    }

    if (!Array.isArray(value.database.tables)) {
      return {
        valid: false,
        error: 'has a "database" with missing tables',
      };
    }

    for (const table of value.database.tables) {
      const tableError = validateImportedTable(table);

      if (tableError !== null) {
        return { valid: false, error: tableError };
      }
    }

    database = {
      engine: "PostgreSQL",
      tables: (
        value.database.tables as Record<string, unknown>[]
      ).map((table) => ({
        name: (table.name as string).trim(),
        columns: (
          table.columns as Record<string, unknown>[]
        ).map((column) => ({
          name: (column.name as string).trim(),
          type: (column.type as string).trim() as ColumnType,
        })),
        rows: table.rows as Record<string, unknown>[],
      })),
    };
  }

  if (
    value.starterCode !== undefined &&
    typeof value.starterCode !== "string"
  ) {
    return {
      valid: false,
      error: 'has an invalid "starterCode" (expected a string)',
    };
  }

  let validation: Question["validation"];

  if (
    value.validation !== undefined &&
    value.validation !== null
  ) {
    if (!isRecord(value.validation)) {
      return {
        valid: false,
        error: 'has an invalid "validation"',
      };
    }

    if (value.validation.type !== "result") {
      return {
        valid: false,
        error: `has an unsupported validation type ("${String(value.validation.type)}")`,
      };
    }

    if (
      !Array.isArray(value.validation.expectedResult) ||
      !value.validation.expectedResult.every(isRecord)
    ) {
      return {
        valid: false,
        error:
          'has an invalid "expectedResult" (expected an array of JSON objects)',
      };
    }

    if (
      value.validation.orderMatters !== undefined &&
      typeof value.validation.orderMatters !== "boolean"
    ) {
      return {
        valid: false,
        error:
          'has an invalid "orderMatters" (expected a boolean)',
      };
    }

    validation = {
      type: "result",
      orderMatters:
        value.validation.orderMatters === true,
      expectedResult: value.validation
        .expectedResult as Record<string, unknown>[],
    };
  }

  return {
    valid: true,
    question: {
      id: (value.id as string).trim(),
      title: value.title as string,
      description: value.description as string,
      difficulty: value.difficulty as Difficulty,
      questionType: "SQL",
      category: value.category as string,
      languages: value.languages as string[],
      tags: value.tags as string[],
      companies: value.companies as string[],
      solved:
        typeof value.solved === "boolean"
          ? value.solved
          : false,
      ...(database === undefined ? {} : { database }),
      starterCode:
        typeof value.starterCode === "string"
          ? value.starterCode
          : "",
      ...(validation === undefined
        ? {}
        : { validation }),
    },
  };
}

export function validateImportedQuestions(
  data: unknown,
): {
  valid: boolean;
  questions: Question[];
  error: string;
} {
  if (!Array.isArray(data)) {
    return {
      valid: false,
      questions: [],
      error:
        "Import failed: file must contain a JSON array of questions.",
    };
  }

  const normalized: Question[] = [];

  for (let index = 0; index < data.length; index += 1) {
    const result = normalizeImportedQuestion(data[index]);

    if (!result.valid) {
      return {
        valid: false,
        questions: [],
        error: `Import failed: question at index ${index} ${result.error}.`,
      };
    }

    normalized.push(result.question);
  }

  return { valid: true, questions: normalized, error: "" };
}

export function importAdminQuestions(
  questions: Question[],
): {
  imported: number;
  skipped: number;
  questions: Question[];
} {
  const existing = readAdminQuestions();
  const knownIds = new Set(
    existing.map((question) => question.id),
  );

  const merged = [...existing];
  let imported = 0;
  let skipped = 0;

  for (const question of questions) {
    if (knownIds.has(question.id)) {
      skipped += 1;
      continue;
    }

    knownIds.add(question.id);
    merged.push(question);
    imported += 1;
  }

  if (imported === 0) {
    return { imported, skipped, questions: existing };
  }

  writeAdminQuestions(merged);

  return { imported, skipped, questions: merged };
}

export { ADMIN_QUESTIONS_EVENT };
