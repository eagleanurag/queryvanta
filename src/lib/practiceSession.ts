const STORAGE_KEY =
  "queryvanta-practice-session";

const HISTORY_STORAGE_KEY =
  "queryvanta-practice-history";

const PRACTICE_SESSION_EVENT =
  "queryvanta-practice-session-changed";

const PRACTICE_HISTORY_EVENT =
  "queryvanta-practice-history-changed";

export const MAX_PRACTICE_HISTORY_ENTRIES = 20;

export type PracticeSessionStatus =
  | "active"
  | "finished";

export type PracticeSelectionMode =
  | "sequential"
  | "random";

export type PracticeSession = {
  sessionId: string;
  questionIds: string[];
  currentIndex: number;
  startedAt: number;
  completedQuestionIds: string[];
  launchSearch: string;
  availableCount: number;
  selectionMode: PracticeSelectionMode;
  status: PracticeSessionStatus;
  finishedAt?: number;
};

function generateSessionId(): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2, 10);

  return `session-${Date.now()}-${randomSuffix}`;
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== ""
  );
}

function sanitizeSession(
  value: unknown,
): PracticeSession | null {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return null;
  }

  const raw = value as Record<string, unknown>;

  if (!isNonEmptyString(raw.sessionId)) {
    return null;
  }

  if (
    !Array.isArray(raw.questionIds) ||
    raw.questionIds.length === 0 ||
    !raw.questionIds.every(isNonEmptyString)
  ) {
    return null;
  }

  const questionIds = (
    raw.questionIds as string[]
  ).map((id) => id.trim());

  const completedQuestionIds = Array.isArray(
    raw.completedQuestionIds,
  )
    ? (raw.completedQuestionIds as unknown[])
        .filter(isNonEmptyString)
        .map((id) => id.trim())
        .filter((id) =>
          questionIds.includes(id),
        )
    : [];

  const uniqueCompleted = Array.from(
    new Set(completedQuestionIds),
  );

  const currentIndex =
    typeof raw.currentIndex === "number" &&
    Number.isFinite(raw.currentIndex)
      ? Math.min(
          Math.max(
            Math.floor(raw.currentIndex),
            0,
          ),
          questionIds.length - 1,
        )
      : 0;

  const startedAt =
    typeof raw.startedAt === "number" &&
    Number.isFinite(raw.startedAt)
      ? raw.startedAt
      : Date.now();

  const status: PracticeSessionStatus =
    raw.status === "finished"
      ? "finished"
      : "active";

  const finishedAt =
    typeof raw.finishedAt === "number" &&
    Number.isFinite(raw.finishedAt)
      ? raw.finishedAt
      : undefined;

  return {
    sessionId: raw.sessionId.trim(),
    questionIds,
    currentIndex,
    startedAt,
    completedQuestionIds: uniqueCompleted,
    launchSearch:
      typeof raw.launchSearch === "string"
        ? raw.launchSearch
        : "",
    availableCount:
      typeof raw.availableCount === "number" &&
      Number.isFinite(raw.availableCount) &&
      raw.availableCount >= questionIds.length
        ? Math.floor(raw.availableCount)
        : questionIds.length,
    selectionMode:
      raw.selectionMode === "random"
        ? "random"
        : "sequential",
    status,
    ...(finishedAt === undefined
      ? {}
      : { finishedAt }),
  };
}

function readSession(): PracticeSession | null {
  try {
    const storedValue =
      window.sessionStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return null;
    }

    const parsed: unknown =
      JSON.parse(storedValue);

    const session = sanitizeSession(parsed);

    if (!session) {
      window.sessionStorage.removeItem(
        STORAGE_KEY,
      );
    }

    return session;
  } catch {
    try {
      window.sessionStorage.removeItem(
        STORAGE_KEY,
      );
    } catch {
      // Ignore secondary storage failures.
    }

    return null;
  }
}

function writeSession(
  session: PracticeSession | null,
): void {
  try {
    if (session) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(session),
      );
    } else {
      window.sessionStorage.removeItem(
        STORAGE_KEY,
      );
    }

    window.dispatchEvent(
      new Event(PRACTICE_SESSION_EVENT),
    );
  } catch {
    // Ignore storage failures so the application
    // continues working even if sessionStorage is unavailable.
  }
}

export function getPracticeSession(): PracticeSession | null {
  return readSession();
}

export function createPracticeSession(
  questionIds: string[],
  launchSearch: string,
  availableCount: number,
  selectionMode: PracticeSelectionMode = "sequential",
): PracticeSession | null {
  const cleanIds = questionIds
    .filter(isNonEmptyString)
    .map((id) => id.trim());

  if (cleanIds.length === 0) {
    return null;
  }

  const session: PracticeSession = {
    sessionId: generateSessionId(),
    questionIds: cleanIds,
    currentIndex: 0,
    startedAt: Date.now(),
    completedQuestionIds: [],
    launchSearch,
    availableCount:
      Number.isFinite(availableCount) &&
      availableCount >= cleanIds.length
        ? Math.floor(availableCount)
        : cleanIds.length,
    selectionMode,
    status: "active",
  };

  writeSession(session);

  return session;
}

/**
 * Select session question IDs from a source list.
 * Sequential preserves source order; random shuffles
 * once with Fisher-Yates. Always returns distinct IDs
 * within the source set, capped at the source length.
 */
export function selectSessionQuestionIds(
  sourceIds: string[],
  size: number,
  mode: PracticeSelectionMode,
): string[] {
  const cleanIds = Array.from(
    new Set(
      sourceIds
        .filter(isNonEmptyString)
        .map((id) => id.trim()),
    ),
  );

  const count = Math.min(
    Math.max(Math.floor(size), 0),
    cleanIds.length,
  );

  if (mode !== "random") {
    return cleanIds.slice(0, count);
  }

  const shuffled = [...cleanIds];

  for (
    let index = shuffled.length - 1;
    index > 0;
    index -= 1
  ) {
    const otherIndex = Math.floor(
      Math.random() * (index + 1),
    );
    const temporary = shuffled[index];
    shuffled[index] = shuffled[otherIndex];
    shuffled[otherIndex] = temporary;
  }

  return shuffled.slice(0, count);
}

export function savePracticeSession(
  session: PracticeSession,
): void {
  const sanitized = sanitizeSession(session);

  writeSession(sanitized);
}

export function updateSessionIndex(
  session: PracticeSession,
  nextIndex: number,
): PracticeSession {
  const updated: PracticeSession = {
    ...session,
    currentIndex: Math.min(
      Math.max(Math.floor(nextIndex), 0),
      session.questionIds.length - 1,
    ),
  };

  writeSession(updated);

  return updated;
}

export function markSessionQuestionCompleted(
  session: PracticeSession,
  questionId: string,
): PracticeSession {
  if (
    !questionId ||
    !session.questionIds.includes(questionId) ||
    session.completedQuestionIds.includes(
      questionId,
    )
  ) {
    return session;
  }

  const updated: PracticeSession = {
    ...session,
    completedQuestionIds: [
      ...session.completedQuestionIds,
      questionId,
    ],
  };

  writeSession(updated);

  return updated;
}

export function finishPracticeSession(
  session: PracticeSession,
): PracticeSession {
  const updated: PracticeSession = {
    ...session,
    status: "finished",
    finishedAt:
      session.status === "finished" &&
      typeof session.finishedAt === "number" &&
      Number.isFinite(session.finishedAt)
        ? session.finishedAt
        : Date.now(),
  };

  writeSession(updated);
  recordFinishedSession(updated);

  return updated;
}

export function clearPracticeSession(): void {
  writeSession(null);
}

export type PracticeHistoryEntry = {
  sessionId: string;
  startedAt: number;
  finishedAt: number;
  questionIds: string[];
  totalQuestions: number;
  completedQuestionIds: string[];
  completedCount: number;
  availableCount: number;
  launchSearch: string;
  selectionMode: PracticeSelectionMode;
  status: PracticeSessionStatus;
};

export type PracticeHistoryStatus =
  | "Completed"
  | "Partially Completed"
  | "Not Completed";

export function getPracticeHistoryStatus(
  entry: Pick<
    PracticeHistoryEntry,
    "totalQuestions" | "completedCount"
  >,
): PracticeHistoryStatus {
  if (entry.totalQuestions <= 0) {
    return "Not Completed";
  }

  if (
    entry.completedCount >= entry.totalQuestions
  ) {
    return "Completed";
  }

  if (entry.completedCount <= 0) {
    return "Not Completed";
  }

  return "Partially Completed";
}

function sanitizeHistoryEntry(
  value: unknown,
): PracticeHistoryEntry | null {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return null;
  }

  const raw = value as Record<string, unknown>;

  if (!isNonEmptyString(raw.sessionId)) {
    return null;
  }

  if (
    !Array.isArray(raw.questionIds) ||
    raw.questionIds.length === 0 ||
    !raw.questionIds.every(isNonEmptyString)
  ) {
    return null;
  }

  if (
    typeof raw.finishedAt !== "number" ||
    !Number.isFinite(raw.finishedAt)
  ) {
    return null;
  }

  const questionIds = (
    raw.questionIds as string[]
  ).map((id) => id.trim());

  const completedQuestionIds = Array.from(
    new Set(
      (Array.isArray(raw.completedQuestionIds)
        ? (raw.completedQuestionIds as unknown[])
        : []
      )
        .filter(isNonEmptyString)
        .map((id) => id.trim())
        .filter((id) =>
          questionIds.includes(id),
        ),
    ),
  );

  const startedAt =
    typeof raw.startedAt === "number" &&
    Number.isFinite(raw.startedAt)
      ? raw.startedAt
      : raw.finishedAt;

  return {
    sessionId: (raw.sessionId as string).trim(),
    startedAt,
    finishedAt: raw.finishedAt as number,
    questionIds,
    totalQuestions: questionIds.length,
    completedQuestionIds,
    completedCount: completedQuestionIds.length,
    availableCount:
      typeof raw.availableCount === "number" &&
      Number.isFinite(raw.availableCount) &&
      raw.availableCount >= questionIds.length
        ? Math.floor(raw.availableCount)
        : questionIds.length,
    launchSearch:
      typeof raw.launchSearch === "string"
        ? raw.launchSearch
        : "",
    selectionMode:
      raw.selectionMode === "random"
        ? "random"
        : "sequential",
    status: "finished",
  };
}

function readHistory(): PracticeHistoryEntry[] {
  try {
    const storedValue =
      window.localStorage.getItem(
        HISTORY_STORAGE_KEY,
      );

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown =
      JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      window.localStorage.removeItem(
        HISTORY_STORAGE_KEY,
      );

      return [];
    }

    const entries: PracticeHistoryEntry[] = [];

    for (const item of parsedValue) {
      const entry = sanitizeHistoryEntry(item);

      if (
        entry &&
        !entries.some(
          (existing) =>
            existing.sessionId ===
            entry.sessionId,
        )
      ) {
        entries.push(entry);
      }
    }

    entries.sort(
      (a, b) => b.finishedAt - a.finishedAt,
    );

    return entries.slice(
      0,
      MAX_PRACTICE_HISTORY_ENTRIES,
    );
  } catch {
    try {
      window.localStorage.removeItem(
        HISTORY_STORAGE_KEY,
      );
    } catch {
      // Ignore secondary storage failures.
    }

    return [];
  }
}

function writeHistory(
  entries: PracticeHistoryEntry[],
): void {
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(entries),
    );

    window.dispatchEvent(
      new Event(PRACTICE_HISTORY_EVENT),
    );
  } catch {
    // Ignore storage failures so the application
    // continues working even if localStorage is unavailable.
  }
}

export function getPracticeHistory(): PracticeHistoryEntry[] {
  return readHistory();
}

export function recordFinishedSession(
  session: PracticeSession,
): PracticeHistoryEntry[] {
  const current = readHistory();

  if (
    current.some(
      (entry) =>
        entry.sessionId === session.sessionId,
    )
  ) {
    return current;
  }

  const entry = sanitizeHistoryEntry({
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    finishedAt:
      typeof session.finishedAt === "number" &&
      Number.isFinite(session.finishedAt)
        ? session.finishedAt
        : Date.now(),
    questionIds: session.questionIds,
    completedQuestionIds:
      session.completedQuestionIds,
    availableCount: session.availableCount,
    launchSearch: session.launchSearch,
    selectionMode: session.selectionMode,
  });

  if (!entry) {
    return current;
  }

  const updated = [entry, ...current].slice(
    0,
    MAX_PRACTICE_HISTORY_ENTRIES,
  );

  writeHistory(updated);

  return updated;
}

export function clearPracticeHistory(): void {
  writeHistory([]);
}

export { PRACTICE_SESSION_EVENT };
export { PRACTICE_HISTORY_EVENT };
