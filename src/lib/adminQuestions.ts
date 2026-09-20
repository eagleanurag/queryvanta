import type { Question } from "../data/questions";

const STORAGE_KEY = "queryvanta-admin-questions";

const ADMIN_QUESTIONS_EVENT =
  "queryvanta-admin-questions-changed";

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

export function deleteAdminQuestion(
  questionId: string,
): Question[] {
  const adminQuestions = readAdminQuestions().filter(
    (question) => question.id !== questionId,
  );

  writeAdminQuestions(adminQuestions);

  return adminQuestions;
}

export function clearAdminQuestions(): Question[] {
  writeAdminQuestions([]);

  return [];
}

export { ADMIN_QUESTIONS_EVENT };
