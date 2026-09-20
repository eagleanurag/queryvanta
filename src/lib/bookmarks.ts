const STORAGE_KEY = "queryvanta-bookmarked-questions";
const BOOKMARKS_EVENT = "queryvanta-bookmarks-changed";

function readBookmarkedQuestionIds(): string[] {
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

function writeBookmarkedQuestionIds(
  questionIds: string[],
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(questionIds),
    );

    window.dispatchEvent(
      new Event(BOOKMARKS_EVENT),
    );
  } catch {
    // Ignore storage failures so the application
    // continues working even if localStorage is unavailable.
  }
}

export function getBookmarkedQuestionIds(): Set<string> {
  return new Set(readBookmarkedQuestionIds());
}

export function isQuestionBookmarked(
  questionId: string,
): boolean {
  return getBookmarkedQuestionIds().has(questionId);
}

export function toggleQuestionBookmark(
  questionId: string,
): boolean {
  const bookmarkedQuestionIds =
    getBookmarkedQuestionIds();

  const wasBookmarked =
    bookmarkedQuestionIds.has(questionId);

  if (wasBookmarked) {
    bookmarkedQuestionIds.delete(questionId);
  } else {
    bookmarkedQuestionIds.add(questionId);
  }

  writeBookmarkedQuestionIds(
    Array.from(bookmarkedQuestionIds),
  );

  return !wasBookmarked;
}

export { BOOKMARKS_EVENT };
