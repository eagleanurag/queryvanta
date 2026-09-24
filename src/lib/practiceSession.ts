const STORAGE_KEY =
  "queryvanta-practice-session";

const PRACTICE_SESSION_EVENT =
  "queryvanta-practice-session-changed";

export type PracticeSessionStatus =
  | "active"
  | "finished";

export type PracticeSession = {
  sessionId: string;
  questionIds: string[];
  currentIndex: number;
  startedAt: number;
  completedQuestionIds: string[];
  launchSearch: string;
  availableCount: number;
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
    status: "active",
  };

  writeSession(session);

  return session;
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
    finishedAt: Date.now(),
  };

  writeSession(updated);

  return updated;
}

export function clearPracticeSession(): void {
  writeSession(null);
}

export { PRACTICE_SESSION_EVENT };
