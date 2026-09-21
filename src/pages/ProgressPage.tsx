import { useEffect, useMemo, useState } from "react";

import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  History,
  Star,
  Target,
  XCircle,
} from "lucide-react";

import { Link } from "react-router-dom";

import { questions } from "../data/questions";
import type { Question } from "../data/questions";
import {
  ADMIN_QUESTIONS_EVENT,
  getAdminQuestions,
} from "../lib/adminQuestions";
import {
  ATTEMPTS_EVENT,
  getAllAttempts,
} from "../lib/attempts";
import type { QuestionAttempt } from "../lib/attempts";
import {
  BOOKMARKS_EVENT,
  getBookmarkedQuestionIds,
} from "../lib/bookmarks";
import { computeDashboardStats } from "../lib/dashboard";
import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "../lib/progress";

function useSyncedState<T>(
  read: () => T,
  events: string[],
): T {
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const sync = () => {
      setValue(read());
    };

    for (const event of events) {
      window.addEventListener(event, sync);
    }

    window.addEventListener("storage", sync);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, sync);
      }

      window.removeEventListener("storage", sync);
    };
    // `read` is a stable module function in every call site below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>

      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {value}
      </p>

      {sub !== undefined && (
        <p className="mt-1 text-xs text-gray-400">
          {sub}
        </p>
      )}
    </div>
  );
}

function ProgressPage() {
  const solvedIds = useSyncedState(
    getSolvedQuestionIds,
    [PROGRESS_EVENT],
  );

  const bookmarkedIds = useSyncedState(
    getBookmarkedQuestionIds,
    [BOOKMARKS_EVENT],
  );

  const allAttempts = useSyncedState<
    Record<string, QuestionAttempt[]>
  >(getAllAttempts, [ATTEMPTS_EVENT]);

  const [adminQuestions, setAdminQuestions] = useState<
    Question[]
  >(() => getAdminQuestions());

  useEffect(() => {
    const syncAdminQuestions = () => {
      setAdminQuestions(getAdminQuestions());
    };

    window.addEventListener(
      ADMIN_QUESTIONS_EVENT,
      syncAdminQuestions,
    );

    window.addEventListener(
      "storage",
      syncAdminQuestions,
    );

    return () => {
      window.removeEventListener(
        ADMIN_QUESTIONS_EVENT,
        syncAdminQuestions,
      );

      window.removeEventListener(
        "storage",
        syncAdminQuestions,
      );
    };
  }, []);

  const stats = useMemo(
    () =>
      computeDashboardStats(
        [...questions, ...adminQuestions],
        solvedIds,
        bookmarkedIds,
        allAttempts,
      ),
    [
      adminQuestions,
      solvedIds,
      bookmarkedIds,
      allAttempts,
    ],
  );

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Questions
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Progress
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="text-2xl font-semibold text-gray-900">
            Progress Dashboard
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Your learning progress across all
            questions.
          </p>

          {/* Overall completion */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white">
                <Target size={17} />
              </span>

              <div>
                <h2 className="font-semibold text-gray-900">
                  Overall completion
                </h2>

                <p className="mt-0.5 text-xs text-gray-500">
                  Solved {stats.solvedQuestions} /{" "}
                  {stats.totalQuestions} ·{" "}
                  {stats.completionPercentage}%
                </p>
              </div>

              <span className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                {stats.solvedQuestions} Solved
              </span>
            </div>

            <div
              className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-valuenow={
                stats.completionPercentage
              }
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall completion"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{
                  width: `${stats.completionPercentage}%`,
                }}
              />
            </div>
          </section>

          {/* Key stats */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Questions"
              value={String(stats.totalQuestions)}
            />

            <StatCard
              label="Solved Questions"
              value={String(stats.solvedQuestions)}
            />

            <StatCard
              label="Unsolved Questions"
              value={String(stats.unsolvedQuestions)}
            />

            <StatCard
              label="Bookmarked Questions"
              value={String(stats.bookmarkedCount)}
              sub={
                stats.bookmarkedCount === 0
                  ? "No bookmarks yet"
                  : undefined
              }
            />
          </div>

          {/* Difficulty + type breakdown */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900">
                Progress by Difficulty
              </h2>

              <div className="mt-4 space-y-4">
                {stats.byDifficulty.map((row) => {
                  const percentage =
                    row.total === 0
                      ? 0
                      : Math.round(
                          (row.solved / row.total) *
                            100,
                        );

                  return (
                    <div key={row.difficulty}>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${
                            row.difficulty === "Easy"
                              ? "bg-emerald-50 text-emerald-600"
                              : row.difficulty ===
                                  "Medium"
                                ? "bg-amber-50 text-amber-600"
                                : "bg-red-50 text-red-500"
                          }`}
                        >
                          {row.difficulty}
                        </span>

                        <span className="ml-auto text-xs text-gray-500">
                          {row.solved} / {row.total} ·{" "}
                          {percentage}%
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gray-900 transition-all"
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <BarChart3
                  size={16}
                  className="text-gray-500"
                />

                <h2 className="font-semibold text-gray-900">
                  Progress by Question Type
                </h2>
              </div>

              {stats.byQuestionType.length === 0 ? (
                <p className="mt-4 text-sm text-gray-400">
                  No questions yet.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {stats.byQuestionType.map((row) => {
                    const percentage =
                      row.total === 0
                        ? 0
                        : Math.round(
                            (row.solved / row.total) *
                              100,
                          );

                    return (
                      <div key={row.questionType}>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                            {row.questionType}
                          </span>

                          <span className="ml-auto text-xs text-gray-500">
                            {row.solved} / {row.total}{" "}
                            · {percentage}%
                          </span>
                        </div>

                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Attempts */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900">
              Attempt Summary
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">
                  Total Attempts
                </p>

                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {stats.totalAttempts}
                </p>
              </div>

              <div className="rounded-lg bg-emerald-50 px-4 py-3">
                <p className="text-xs text-emerald-600">
                  Correct Attempts
                </p>

                <p className="mt-1 text-xl font-semibold text-emerald-700">
                  {stats.correctAttempts}
                </p>
              </div>

              <div className="rounded-lg bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-600">
                  Incorrect Attempts
                </p>

                <p className="mt-1 text-xl font-semibold text-amber-700">
                  {stats.incorrectAttempts}
                </p>
              </div>
            </div>

            {stats.totalAttempts === 0 && (
              <p className="mt-4 text-sm text-gray-400">
                No attempts yet. Run a query on any
                question to start tracking attempts.
              </p>
            )}
          </section>

          {/* Recent activity */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <History
                size={16}
                className="text-gray-500"
              />

              <h2 className="font-semibold text-gray-900">
                Recent Attempt Activity
              </h2>
            </div>

            {stats.recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-gray-400">
                No recent activity yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {stats.recentActivity.map(
                  (attempt, index) => {
                    const status = !attempt.executedSuccessfully
                      ? "error"
                      : attempt.isCorrect
                        ? "correct"
                        : "incorrect";

                    return (
                      <li
                        key={`${attempt.questionId}-${attempt.timestamp}-${index}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            status === "correct"
                              ? "text-emerald-600"
                              : status === "error"
                                ? "text-red-600"
                                : "text-amber-600"
                          }`}
                        >
                          {status === "correct" ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <XCircle size={13} />
                          )}

                          {status === "correct"
                            ? "Correct"
                            : status === "error"
                              ? "Error"
                              : "Incorrect"}
                        </span>

                        <Link
                          to={`/question/${attempt.questionId}`}
                          className="min-w-0 max-w-full truncate text-xs font-medium text-gray-700 hover:text-gray-900 hover:underline"
                        >
                          {attempt.questionTitle}
                        </Link>

                        <span className="text-xs text-gray-500">
                          {attempt.rowCount}{" "}
                          {attempt.rowCount === 1
                            ? "row"
                            : "rows"}
                        </span>

                        {attempt.executionTimeMs !==
                          null && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock3 size={12} />
                            {attempt.executionTimeMs.toFixed(
                              2,
                            )}{" "}
                            ms
                          </span>
                        )}

                        <span className="ml-auto text-xs text-gray-400">
                          {new Date(
                            attempt.timestamp,
                          ).toLocaleString()}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            )}
          </section>

          {stats.bookmarkedCount > 0 && (
            <p className="mt-6 flex items-center gap-2 text-xs text-gray-400">
              <Star
                size={12}
                className="text-amber-500"
                fill="currentColor"
              />
              You have {stats.bookmarkedCount}{" "}
              bookmarked{" "}
              {stats.bookmarkedCount === 1
                ? "question"
                : "questions"}
              .
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default ProgressPage;
