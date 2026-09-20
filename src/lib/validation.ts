export type ValidationResult = {
  correct: boolean;
  message: string;
};

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    const isoValue = value.toISOString();

    if (isoValue.endsWith("T00:00:00.000Z")) {
      return isoValue.slice(0, 10);
    }

    return isoValue;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return value;
}

function normalizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  Object.keys(row)
    .sort()
    .forEach((key) => {
      normalized[key] = normalizeValue(row[key]);
    });

  return normalized;
}

function rowsEqual(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const normalizedActual = actual.map(normalizeRow);
  const normalizedExpected = expected.map(normalizeRow);

  return normalizedActual.every(
    (actualRow, index) => {
      const expectedRow =
        normalizedExpected[index];

      const actualKeys = Object.keys(actualRow);
      const expectedKeys = Object.keys(expectedRow);

      if (actualKeys.length !== expectedKeys.length) {
        return false;
      }

      return actualKeys.every(
        (key) =>
          actualRow[key] === expectedRow[key],
      );
    },
  );
}

export function validateResult(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): ValidationResult {
  if (rowsEqual(actual, expected)) {
    return {
      correct: true,
      message: "Correct answer!",
    };
  }

  if (actual.length !== expected.length) {
    return {
      correct: false,
      message: `Expected ${expected.length} rows, but your query returned ${actual.length} rows.`,
    };
  }

  return {
    correct: false,
    message:
      "The query ran successfully, but the result does not match the expected answer.",
  };
}