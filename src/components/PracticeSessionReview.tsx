import { useState } from "react";

import {
  ArrowRight,
  CheckCircle2,
  Circle,
} from "lucide-react";

import { Link } from "react-router-dom";

import type { Question } from "../data/questions";
import { getAttempts } from "../lib/attempts";

type ReviewFilter =
  | "all"
  | "completed"
  | "not-completed";

type PracticeSessionReviewProps = {
  questionIds: string[];
  completedIds: Set<string>;
  questionById: Map<string, Question>;
  launchSearch: string;
};

function PracticeSessionReview({
  questionIds,
  completedIds,
  questionById,
  launchSearch,
}: PracticeSessionReviewProps) {
  const [filter, setFilter] =
    useState<ReviewFilter>("all");

  const reviewSearch = launchSearch
    ? `?${launchSearch}`
    : "";

  const orderedEntries = questionIds.map(
    (id, position) => ({
      id,
      position: position + 1,
      question: questionById.get(id) ?? null,
      completed: completedIds.has(id),
    }),
  );

  const completedTotal = orderedEntries.filter(
    (entry) => entry.completed,
  ).length;
  const notCompletedTotal =
    orderedEntries.length - completedTotal;

  const firstUncompleted = orderedEntries.find(
    (entry) => !entry.completed,
  );

  const visibleEntries = orderedEntries.filter(
    (entry) => {
      if (filter === "completed") {
        return entry.completed;
      }

      if (filter === "not-completed") {
        return !entry.completed;
      }

      return true;
    },
  );

  const filters: {
    value: ReviewFilter;
    label: string;
    count: number;
  }[] = [
    {
      value: "all",
      label: "All",
      count: orderedEntries.length,
    },
    {
      value: "completed",
      label: "Completed",
      count: completedTotal,
    },
    {
      value: "not-completed",
      label: "Not Completed",
      count: notCompletedTotal,
    },
  ];

  return (
    <section
      aria-label="Session review"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 className="text-base font-semibold text-gray-900">
        Session Review
      </h2>

      {firstUncompleted && (
        <Link
          to={{
            pathname: `/question/${firstUncompleted.id}`,
            search: reviewSearch,
          }}
          state={{ fromPracticeReview: true }}
          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Review {notCompletedTotal}{" "}
          Uncompleted
          <ArrowRight size={16} />
        </Link>
      )}

      <div
        role="group"
        aria-label="Filter session review"
        className="mt-4 flex flex-wrap gap-2"
      >
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              setFilter(option.value)
            }
            aria-pressed={filter === option.value}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === option.value
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {option.label} ({option.count})
          </button>
        ))}
      </div>

      {visibleEntries.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No questions match this filter.
        </p>
      ) : (
        <ul
          aria-label="Session review questions"
          className="mt-4 space-y-3"
        >
          {visibleEntries.map((entry) => {
            const attemptCount = entry.question
              ? getAttempts(entry.question.id)
                  .length
              : 0;

            return (
              <li
                key={entry.id}
                className="flex flex-col gap-3 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-center"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600"
                >
                  {entry.position}
                </span>

                <div className="min-w-0 flex-1">
                  {entry.question ? (
                    <>
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {entry.question.title}
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        {entry.question
                          .questionType}
                        {" · "}
                        {entry.question.category ||
                          "Uncategorized"}
                        {" · "}
                        {attemptCount}{" "}
                        {attemptCount === 1
                          ? "attempt"
                          : "attempts"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        Question unavailable
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        This question is no
                        longer available.
                      </p>
                    </>
                  )}

                  <span
                    className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                      entry.completed
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {entry.completed ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      <Circle size={13} />
                    )}
                    {entry.completed
                      ? "Completed"
                      : "Not Completed"}
                  </span>
                </div>

                {entry.question && (
                  <Link
                    to={{
                      pathname: `/question/${entry.question.id}`,
                      search: reviewSearch,
                    }}
                    state={{
                      fromPracticeReview: true,
                    }}
                    aria-label={`Review ${entry.question.title}`}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Review
                    <ArrowRight size={16} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default PracticeSessionReview;
