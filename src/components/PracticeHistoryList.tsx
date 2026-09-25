import { useEffect, useState } from "react";

import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  History,
  Trash2,
} from "lucide-react";

import { Link } from "react-router-dom";

import {
  clearPracticeHistory,
  getPracticeHistory,
  getPracticeHistoryStatus,
  PRACTICE_HISTORY_EVENT,
} from "../lib/practiceSession";
import type {
  PracticeHistoryEntry,
  PracticeHistoryStatus,
} from "../lib/practiceSession";

const STATUS_STYLES: Record<
  PracticeHistoryStatus,
  string
> = {
  Completed: "bg-emerald-50 text-emerald-600",
  "Partially Completed": "bg-amber-50 text-amber-600",
  "Not Completed": "bg-gray-100 text-gray-500",
};

const ORIGIN_LABELS: Record<string, string> = {
  standard: "Standard",
  learning: "Learning",
  interview: "Interview",
  "weak-topic": "Weak Areas",
};

function originLabelFor(
  entry: PracticeHistoryEntry,
): string {
  const base =
    ORIGIN_LABELS[entry.origin ?? "standard"] ??
    "Standard";

  if (
    (entry.origin ?? "standard") ===
      "interview" &&
    typeof entry.timeLimitSec === "number" &&
    Number.isFinite(entry.timeLimitSec) &&
    entry.timeLimitSec > 0
  ) {
    return `${base} · Timed`;
  }

  return base;
}

function HistoryStatusBadge({
  entry,
}: {
  entry: PracticeHistoryEntry;
}) {
  const status = getPracticeHistoryStatus(entry);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status === "Completed" ? (
        <CheckCircle2 size={13} />
      ) : status === "Partially Completed" ? (
        <CircleDot size={13} />
      ) : (
        <Circle size={13} />
      )}
      {status}
    </span>
  );
}

function PracticeHistoryList() {
  const [entries, setEntries] = useState<
    PracticeHistoryEntry[]
  >(() => getPracticeHistory());

  const [confirmingClear, setConfirmingClear] =
    useState(false);

  useEffect(() => {
    const syncHistory = () => {
      setEntries(getPracticeHistory());
      setConfirmingClear(false);
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

  const handleClear = () => {
    clearPracticeHistory();
    setEntries(getPracticeHistory());
    setConfirmingClear(false);
  };

  return (
    <section
      aria-label="Practice history"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <History size={17} />
          Practice History
          {entries.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              {entries.length}
            </span>
          )}
        </h2>

        {entries.length > 0 &&
          !confirmingClear && (
            <button
              type="button"
              onClick={() =>
                setConfirmingClear(true)
              }
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            >
              <Trash2 size={13} />
              Clear History
            </button>
          )}
      </div>

      {confirmingClear && entries.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-gray-900">
            Delete all practice history?
          </p>

          <p className="mt-1 text-xs text-gray-500">
            This removes completed session
            records only. Your active
            session, solved questions, and
            bookmarks are kept.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Yes, delete history
            </button>

            <button
              type="button"
              onClick={() =>
                setConfirmingClear(false)
              }
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-gray-500">
          No completed sessions yet. Finished
          practice sessions will appear here.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => {
            const completionRate =
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
                className="flex flex-col gap-3 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {new Date(
                      entry.finishedAt,
                    ).toLocaleString()}
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    {entry.totalQuestions}{" "}
                    {entry.totalQuestions === 1
                      ? "question"
                      : "questions"}{" "}
                    · {entry.completedCount}{" "}
                    completed · {completionRate}% ·{" "}
                    Order:{" "}
                    {entry.selectionMode ===
                    "random"
                      ? "Random"
                      : "Sequential"}{" "}
                    · Mode:{" "}
                    {originLabelFor(entry)}
                    {entry.originLabel
                      ? ` · ${entry.originLabel}`
                      : ""}
                  </p>

                  <div className="mt-2">
                    <HistoryStatusBadge
                      entry={entry}
                    />
                  </div>
                </div>

                <Link
                  to={`/practice/history/${entry.sessionId}`}
                  aria-label={`Review practice session from ${new Date(
                    entry.finishedAt,
                  ).toLocaleString()}`}
                  className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Review
                  <ChevronRight size={16} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default PracticeHistoryList;
