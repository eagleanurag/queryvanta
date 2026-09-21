import type { Question } from "../data/questions";
import type { QuestionAttempt } from "./attempts";

export type AttemptActivity = QuestionAttempt & {
  questionId: string;
  questionTitle: string;
};

export type DifficultyBreakdown = {
  difficulty: string;
  total: number;
  solved: number;
};

export type QuestionTypeBreakdown = {
  questionType: string;
  total: number;
  solved: number;
};

export type DashboardStats = {
  totalQuestions: number;
  solvedQuestions: number;
  unsolvedQuestions: number;
  completionPercentage: number;
  byDifficulty: DifficultyBreakdown[];
  byQuestionType: QuestionTypeBreakdown[];
  bookmarkedCount: number;
  totalAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  recentActivity: AttemptActivity[];
};

const DIFFICULTY_ORDER = ["Easy", "Medium", "Hard"];

export function computeDashboardStats(
  allQuestions: Question[],
  solvedIds: Set<string>,
  bookmarkedIds: Set<string>,
  allAttempts: Record<string, QuestionAttempt[]>,
  recentLimit = 8,
): DashboardStats {
  const totalQuestions = allQuestions.length;

  const solvedQuestions = allQuestions.filter(
    (question) => solvedIds.has(question.id),
  ).length;

  const unsolvedQuestions =
    totalQuestions - solvedQuestions;

  const completionPercentage =
    totalQuestions === 0
      ? 0
      : Math.round(
          (solvedQuestions / totalQuestions) * 100,
        );

  const byDifficulty: DifficultyBreakdown[] =
    DIFFICULTY_ORDER.map((difficulty) => {
      const inGroup = allQuestions.filter(
        (question) =>
          question.difficulty === difficulty,
      );

      return {
        difficulty,
        total: inGroup.length,
        solved: inGroup.filter((question) =>
          solvedIds.has(question.id),
        ).length,
      };
    });

  const seenTypes: string[] = [];

  for (const question of allQuestions) {
    if (!seenTypes.includes(question.questionType)) {
      seenTypes.push(question.questionType);
    }
  }

  const byQuestionType: QuestionTypeBreakdown[] =
    seenTypes.map((questionType) => {
      const inGroup = allQuestions.filter(
        (question) =>
          question.questionType === questionType,
      );

      return {
        questionType,
        total: inGroup.length,
        solved: inGroup.filter((question) =>
          solvedIds.has(question.id),
        ).length,
      };
    });

  const titles = new Map(
    allQuestions.map((question) => [
      question.id,
      question.title,
    ]),
  );

  const activity: AttemptActivity[] = [];

  for (const [questionId, attempts] of Object.entries(
    allAttempts,
  )) {
    for (const attempt of attempts) {
      activity.push({
        ...attempt,
        questionId,
        questionTitle:
          titles.get(questionId) ?? questionId,
      });
    }
  }

  activity.sort(
    (first, second) =>
      second.timestamp - first.timestamp,
  );

  const totalAttempts = activity.length;

  const correctAttempts = activity.filter(
    (attempt) => attempt.isCorrect,
  ).length;

  return {
    totalQuestions,
    solvedQuestions,
    unsolvedQuestions,
    completionPercentage,
    byDifficulty,
    byQuestionType,
    bookmarkedCount: bookmarkedIds.size,
    totalAttempts,
    correctAttempts,
    incorrectAttempts: totalAttempts - correctAttempts,
    recentActivity: activity.slice(0, recentLimit),
  };
}
