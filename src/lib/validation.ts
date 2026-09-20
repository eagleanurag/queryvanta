export type ValidationResult = {
  correct: boolean;
  message: string;
};

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeDateValue(value: Date): string {
  return [
    value.getUTCFullYear(),
    padNumber(value.getUTCMonth() + 1),
    padNumber(value.getUTCDate()),
  ].join("-");
}

function normalizeTimestampValue(value: Date): string {
  return [
    [
      value.getFullYear(),
      padNumber(value.getMonth() + 1),
      padNumber(value.getDate()),
    ].join("-"),
    [
      padNumber(value.getHours()),
      padNumber(value.getMinutes()),
      padNumber(value.getSeconds()),
    ].join(":"),
  ].join(" ");
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    const isDateOnly =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;

    return isDateOnly
      ? normalizeDateValue(value)
      : normalizeTimestampValue(value);
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (/^-?\d+(?:\.\d+)?$/.test(trimmedValue)) {
      return Number(trimmedValue);
    }

    const timestampMatch = trimmedValue.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})?$/,
    );

    if (timestampMatch) {
      const [, datePart, timePart] = timestampMatch;

      return `${datePart} ${timePart}`;
    }

    return trimmedValue;
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

function rowsHaveSameValues(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): boolean {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);

  if (firstKeys.length !== secondKeys.length) {
    return false;
  }

  return firstKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(
        second,
        key,
      ) && first[key] === second[key],
  );
}

function rowsEqualIgnoringOrder(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const normalizedActual = actual.map(normalizeRow);
  const normalizedExpected = expected.map(normalizeRow);

  const matchedExpected = new Set<number>();

  return normalizedActual.every((actualRow) => {
    const matchingIndex =
      normalizedExpected.findIndex(
        (expectedRow, index) =>
          !matchedExpected.has(index) &&
          rowsHaveSameValues(
            actualRow,
            expectedRow,
          ),
      );

    if (matchingIndex === -1) {
      return false;
    }

    matchedExpected.add(matchingIndex);

    return true;
  });
}

function rowsEqualInOrder(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const normalizedActual = actual.map(normalizeRow);
  const normalizedExpected = expected.map(normalizeRow);

  return normalizedActual.every(
    (actualRow, index) =>
      rowsHaveSameValues(
        actualRow,
        normalizedExpected[index],
      ),
  );
}

export function validateResult(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
  orderMatters = false,
): ValidationResult {
  const correct = orderMatters
    ? rowsEqualInOrder(actual, expected)
    : rowsEqualIgnoringOrder(
        actual,
        expected,
      );

  if (correct) {
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