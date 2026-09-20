const STORAGE_KEY = "queryvanta-solved-questions";
const PROGRESS_EVENT = "queryvanta-progress-changed";

function readSolvedQuestionIds(): string[] {
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

    return parsedValue.filter(
      (value): value is string =>
        typeof value === "string",
    );
  } catch {
    return [];
  }
}

function writeSolvedQuestionIds(
  questionIds: string[],
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(questionIds),
    );

    window.dispatchEvent(
      new Event(PROGRESS_EVENT),
    );
  } catch {
    // Ignore storage failures so the application
    // continues working even if localStorage is unavailable.
  }
}

export function getSolvedQuestionIds(): Set<string> {
  return new Set(readSolvedQuestionIds());
}

export function isQuestionSolved(
  questionId: string,
): boolean {
  return getSolvedQuestionIds().has(questionId);
}

export function markQuestionSolved(
  questionId: string,
): void {
  const solvedQuestionIds =
    getSolvedQuestionIds();

  solvedQuestionIds.add(questionId);

  writeSolvedQuestionIds(
    Array.from(solvedQuestionIds),
  );
}

export function clearQuestionProgress(): void {
  try {
    window.localStorage.removeItem(
      STORAGE_KEY,
    );

    window.dispatchEvent(
      new Event(PROGRESS_EVENT),
    );
  } catch {
    // Ignore storage failures.
  }
}

export { PROGRESS_EVENT };