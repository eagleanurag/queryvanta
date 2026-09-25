import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  History,
  Tags,
} from "lucide-react";

import { Link } from "react-router-dom";

import type { Question } from "../data/questions";
import {
  getPracticeHistory,
  getPracticeHistoryStatus,
  PRACTICE_HISTORY_EVENT,
} from "../lib/practiceSession";
import type { PracticeHistoryEntry } from "../lib/practiceSession";

const RECENT_SESSION_COUNT = 5;
const TOP_CATEGORY_COUNT = 6;
const TREND_DAY_COUNT = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type PracticeAnalyticsProps = {
  allQuestions: Question[];
};

type TrendDay = {
  key: string;
  label: string;
  title: string;
  sessionCount: number;
};

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(
    undefined,
    { month: "numeric", day: "numeric" },
  );
}

function PracticeAnalytics({
  allQuestions,
}: PracticeAnalyticsProps) {
  const [entries, setEntries] = useState<
    PracticeHistoryEntry[]
  >(() => getPracticeHistory());

  useEffect(() => {
    const syncHistory = () => {
      setEntries(getPracticeHistory());
    };

    window.addEventListener(
      PRACTICE_HISTORY_EVENT,
      syncHistory,
    );

    window.addEventListener(
      "storage",
      syncHistory,
    );

    return () => {
      window.removeEventListener(
        PRACTICE_HISTORY_EVENT,
        syncHistory,
      );

      window.removeEventListener(
        "storage",
        syncHistory,
      );
    };
  }, []);

  const questionById = useMemo(() => {
    const lookup = new Map<string, Question>();

    for (const question of allQuestions) {
      lookup.set(question.id, question);
    }

    return lookup;
  }, [allQuestions]);

  const analytics = useMemo(() => {
    let practiced = 0;
    let completed = 0;
    let completedSessions = 0;
    let partialSessions = 0;
    let notCompletedSessions = 0;
    let sequentialSessions = 0;
    let randomSessions = 0;
    let standardSessions = 0;
    let learningSessions = 0;
    let interviewSessions = 0;
    let weakTopicSessions = 0;
    let timedInterviews = 0;
    let interviewQuestions = 0;
    let interviewCompleted = 0;

    const byType = new Map<string, number>();
    const byCategory = new Map<string, number>();
    let knownTypeTotal = 0;

    for (const entry of entries) {
      practiced += entry.totalQuestions;
      completed += entry.completedCount;

      const status =
        getPracticeHistoryStatus(entry);

      if (status === "Completed") {
        completedSessions += 1;
      } else if (status === "Partially Completed") {
        partialSessions += 1;
      } else {
        notCompletedSessions += 1;
      }

      if (entry.selectionMode === "random") {
        randomSessions += 1;
      } else {
        sequentialSessions += 1;
      }

      const origin = entry.origin ?? "standard";

      if (origin === "learning") {
        learningSessions += 1;
      } else if (origin === "interview") {
        interviewSessions += 1;
        interviewQuestions +=
          entry.totalQuestions;
        interviewCompleted +=
          entry.completedCount;

        if (
          typeof entry.timeLimitSec ===
            "number" &&
          Number.isFinite(entry.timeLimitSec) &&
          entry.timeLimitSec > 0
        ) {
          timedInterviews += 1;
        }
      } else if (origin === "weak-topic") {
        weakTopicSessions += 1;
      } else {
        standardSessions += 1;
      }

      for (const questionId of entry.questionIds) {
        const question =
          questionById.get(questionId);

        if (!question) {
          continue;
        }

        knownTypeTotal += 1;
        byType.set(
          question.questionType,
          (byType.get(question.questionType) ??
            0) + 1,
        );

        const category = question.category.trim();

        if (category !== "") {
          byCategory.set(
            category,
            (byCategory.get(category) ?? 0) + 1,
          );
        }
      }
    }

    const completionRate =
      practiced === 0
        ? 0
        : Math.round(
            (completed / practiced) * 100,
          );

    const averagePerSession =
      entries.length === 0
        ? 0
        : Math.round(
            (practiced / entries.length) * 10,
          ) / 10;

    const typeRows = [...byType.entries()]
      .map(([questionType, count]) => ({
        questionType,
        count,
        share:
          knownTypeTotal === 0
            ? 0
            : Math.round(
                (count / knownTypeTotal) * 100,
              ),
      }))
      .sort((a, b) => b.count - a.count);

    const categoryRows = [...byCategory.entries()]
      .map(([category, count]) => ({
        category,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_CATEGORY_COUNT);

    const todayStart = startOfLocalDay(Date.now());
    const perDay: TrendDay[] = [];

    for (
      let offset = TREND_DAY_COUNT - 1;
      offset >= 0;
      offset -= 1
    ) {
      const dayStart =
        todayStart - offset * MS_PER_DAY;
      const dayEnd = dayStart + MS_PER_DAY;

      const sessionCount = entries.filter(
        (entry) =>
          entry.finishedAt >= dayStart &&
          entry.finishedAt < dayEnd,
      ).length;

      const label = formatDayLabel(dayStart);

      perDay.push({
        key: String(dayStart),
        label,
        title: `${label}: ${sessionCount} ${
          sessionCount === 1
            ? "session"
            : "sessions"
        }`,
        sessionCount,
      });
    }

    const last7Days = entries.filter(
      (entry) =>
        entry.finishedAt >=
        todayStart - 6 * MS_PER_DAY,
    ).length;

    const last30Days = entries.filter(
      (entry) =>
        entry.finishedAt >=
        todayStart - 29 * MS_PER_DAY,
    ).length;

    return {
      sessionCount: entries.length,
      practiced,
      completed,
      completionRate,
      averagePerSession,
      completedSessions,
      partialSessions,
      notCompletedSessions,
      sequentialSessions,
      randomSessions,
      standardSessions,
      learningSessions,
      interviewSessions,
      weakTopicSessions,
      timedInterviews,
      interviewQuestions,
      interviewCompleted,
      typeRows,
      knownTypeTotal,
      categoryRows,
      perDay,
      last7Days,
      last30Days,
      recent: entries.slice(0, RECENT_SESSION_COUNT),
    };
  }, [entries, questionById]);

  const maxTrendCount = Math.max(
    1,
    ...analytics.perDay.map(
      (day) => day.sessionCount,
    ),
  );

  return (
    <section
      aria-label="Practice analytics"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="font-semibold text-gray-900">
        Practice Analytics
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Descriptive summary of your completed
        practice sessions.
      </p>

      {analytics.sessionCount === 0 ? (
        <p className="mt-4 text-sm text-gray-400">
          No completed practice sessions yet.
          Finish a practice session and your
          analytics will appear here.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Practice Sessions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.sessionCount}
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Questions Practiced
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.practiced}
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Questions Completed
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.completed}
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Overall Completion Rate
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.completionRate}%
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Average Questions Per Session
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.averagePerSession}
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">
                Completed Sessions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {analytics.completedSessions}
              </p>

              <p className="mt-1 text-xs text-gray-400">
                {analytics.partialSessions}{" "}
                partial ·{" "}
                {
                  analytics.notCompletedSessions
                }{" "}
                not completed
              </p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">
              Sessions by Order
            </h3>

            <div className="mt-3 space-y-3">
              {(
                [
                  {
                    label: "Sequential",
                    count:
                      analytics.sequentialSessions,
                  },
                  {
                    label: "Random",
                    count:
                      analytics.randomSessions,
                  },
                ] as const
              ).map((row) => {
                const share =
                  analytics.sessionCount === 0
                    ? 0
                    : Math.round(
                        (row.count /
                          analytics.sessionCount) *
                          100,
                      );

                return (
                  <div key={row.label}>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        {row.label}
                      </span>

                      <span className="ml-auto text-xs text-gray-500">
                        {row.count}{" "}
                        {row.count === 1
                          ? "session"
                          : "sessions"}{" "}
                        · {share}%
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-900 transition-all"
                        style={{
                          width: `${share}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">
              Sessions by Mode
            </h3>

            <div className="mt-3 space-y-3">
              {(
                [
                  {
                    label: "Standard Practice",
                    count:
                      analytics.standardSessions,
                  },
                  {
                    label: "Learning",
                    count:
                      analytics.learningSessions,
                  },
                  {
                    label: "Interview",
                    count:
                      analytics.interviewSessions,
                  },
                  {
                    label: "Weak Areas",
                    count:
                      analytics.weakTopicSessions,
                  },
                ] as const
              ).map((row) => {
                const share =
                  analytics.sessionCount === 0
                    ? 0
                    : Math.round(
                        (row.count /
                          analytics.sessionCount) *
                          100,
                      );

                return (
                  <div key={row.label}>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        {row.label}
                      </span>

                      <span className="ml-auto text-xs text-gray-500">
                        {row.count}{" "}
                        {row.count === 1
                          ? "session"
                          : "sessions"}{" "}
                        · {share}%
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-900 transition-all"
                        style={{
                          width: `${share}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {analytics.interviewSessions > 0 && (
              <div className="mt-3 rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">
                  {analytics.interviewSessions}{" "}
                  {analytics.interviewSessions ===
                  1
                    ? "interview"
                    : "interviews"}{" "}
                  · {analytics.timedInterviews}{" "}
                  timed · avg{" "}
                  {Math.round(
                    (analytics.interviewQuestions /
                      analytics.interviewSessions) *
                      10,
                  ) / 10}{" "}
                  questions ·{" "}
                  {analytics.interviewQuestions ===
                  0
                    ? 0
                    : Math.round(
                        (analytics.interviewCompleted /
                          analytics.interviewQuestions) *
                          100,
                      )}
                  % completion
                </p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <BarChart3
                size={16}
                className="text-gray-500"
              />

              <h3 className="text-sm font-semibold text-gray-900">
                Practice by Question Type
              </h3>
            </div>

            {analytics.typeRows.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">
                No practiced questions found.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {analytics.typeRows.map((row) => (
                  <div key={row.questionType}>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                        {row.questionType}
                      </span>

                      <span className="ml-auto text-xs text-gray-500">
                        {row.count} practiced ·{" "}
                        {row.share}%
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{
                          width: `${row.share}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {analytics.categoryRows.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2">
                <Tags
                  size={16}
                  className="text-gray-500"
                />

                <h3 className="text-sm font-semibold text-gray-900">
                  Practice by Category
                </h3>
              </div>

              <div className="mt-3 space-y-3">
                {analytics.categoryRows.map(
                  (row) => (
                    <div key={row.category}>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                          {row.category}
                        </span>

                        <span className="ml-auto text-xs text-gray-500">
                          {row.count}{" "}
                          {row.count === 1
                            ? "question"
                            : "questions"}
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <CalendarDays
                size={16}
                className="text-gray-500"
              />

              <h3 className="text-sm font-semibold text-gray-900">
                Recent Activity
              </h3>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              {analytics.last7Days}{" "}
              {analytics.last7Days === 1
                ? "session"
                : "sessions"}{" "}
              in the last 7 days ·{" "}
              {analytics.last30Days}{" "}
              {analytics.last30Days === 1
                ? "session"
                : "sessions"}{" "}
              in the last 30 days
            </p>

            <div
              className="mt-3 flex h-16 items-end gap-1"
              role="img"
              aria-label={`Practice sessions per day over the last ${TREND_DAY_COUNT} days`}
            >
              {analytics.perDay.map((day) => (
                <div
                  key={day.key}
                  title={day.title}
                  className={`min-w-0 flex-1 rounded-t ${
                    day.sessionCount === 0
                      ? "bg-gray-100"
                      : "bg-gray-900"
                  }`}
                  style={{
                    height: `${
                      day.sessionCount === 0
                        ? 8
                        : Math.max(
                            12,
                            Math.round(
                              (day.sessionCount /
                                maxTrendCount) *
                                100,
                            ),
                          )
                    }%`,
                  }}
                />
              ))}
            </div>

            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>
                {
                  analytics.perDay[0].label
                }
              </span>
              <span>
                Sessions per day, last{" "}
                {TREND_DAY_COUNT} days
              </span>
              <span>
                {
                  analytics.perDay[
                    analytics.perDay.length - 1
                  ].label
                }
              </span>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <History
                size={16}
                className="text-gray-500"
              />

              <h3 className="text-sm font-semibold text-gray-900">
                Recent Practice
              </h3>
            </div>

            <ul className="mt-2 divide-y divide-gray-100">
              {analytics.recent.map((entry) => {
                const rate =
                  entry.totalQuestions === 0
                    ? 0
                    : Math.round(
                        (entry.completedCount /
                          entry.totalQuestions) *
                          100,
                      );

                return (
                  <li
                    key={entry.sessionId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                  >
                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                      {entry.selectionMode ===
                      "random"
                        ? "Random"
                        : "Sequential"}
                    </span>

                    <span className="text-xs text-gray-500">
                      {entry.totalQuestions}{" "}
                      {entry.totalQuestions === 1
                        ? "question"
                        : "questions"}{" "}
                      · {entry.completedCount}{" "}
                      completed · {rate}%
                    </span>

                    <span className="text-xs text-gray-500">
                      {getPracticeHistoryStatus(
                        entry,
                      )}
                    </span>

                    <Link
                      to={`/practice/history/${entry.sessionId}`}
                      aria-label={`Review practice session from ${new Date(
                        entry.finishedAt,
                      ).toLocaleString()}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 hover:underline"
                    >
                      Review
                      <ChevronRight size={13} />
                    </Link>

                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(
                        entry.finishedAt,
                      ).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

export default PracticeAnalytics;
