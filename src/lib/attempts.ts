export type QuestionAttempt = {
  timestamp: number;
  executedSuccessfully: boolean;
  isCorrect: boolean;
  rowCount: number;
  executionTimeMs: number | null;
};

export type NewQuestionAttempt = Omit<
  QuestionAttempt,
  "timestamp"
> & {
  timestamp?: number;
};

const STORAGE_KEY = "queryvanta-question-attempts";

const MAX_ATTEMPTS_PER_QUESTION = 10;

function isValidAttempt(value: unknown): value is QuestionAttempt {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const attempt = value as Record<string, unknown>;

  return (
    typeof attempt.timestamp === "number" &&
    typeof attempt.executedSuccessfully === "boolean" &&
    typeof attempt.isCorrect === "boolean" &&
    typeof attempt.rowCount === "number" &&
    (typeof attempt.executionTimeMs === "number" ||
      attempt.executionTimeMs === null)
  );
}

function readAllAttempts(): Record<string, QuestionAttempt[]> {
  try {
    const storedValue =
      window.localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      Array.isArray(parsedValue)
    ) {
      return {};
    }

    const attempts: Record<string, QuestionAttempt[]> = {};

    for (const [questionId, value] of Object.entries(
      parsedValue as Record<string, unknown>,
    )) {
      if (!Array.isArray(value)) {
        continue;
      }

      attempts[questionId] = value.filter(isValidAttempt);
    }

    return attempts;
  } catch {
    return {};
  }
}

function writeAllAttempts(
  attempts: Record<string, QuestionAttempt[]>,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(attempts),
    );
  } catch {
    // Ignore storage failures so query execution
    // continues working even if localStorage is unavailable.
  }
}

export function getAttempts(questionId: string): QuestionAttempt[] {
  return readAllAttempts()[questionId] ?? [];
}

export function recordAttempt(
  questionId: string,
  attempt: NewQuestionAttempt,
): QuestionAttempt[] {
  const allAttempts = readAllAttempts();

  const questionAttempts = allAttempts[questionId] ?? [];

  questionAttempts.push({
    timestamp: attempt.timestamp ?? Date.now(),
    executedSuccessfully: attempt.executedSuccessfully,
    isCorrect: attempt.isCorrect,
    rowCount: attempt.rowCount,
    executionTimeMs: attempt.executionTimeMs,
  });

  const trimmedAttempts = questionAttempts.slice(
    -MAX_ATTEMPTS_PER_QUESTION,
  );

  allAttempts[questionId] = trimmedAttempts;

  writeAllAttempts(allAttempts);

  return trimmedAttempts;
}

export function clearAttempts(questionId: string): void {
  const allAttempts = readAllAttempts();

  if (!(questionId in allAttempts)) {
    return;
  }

  delete allAttempts[questionId];

  writeAllAttempts(allAttempts);
}

export { MAX_ATTEMPTS_PER_QUESTION };
