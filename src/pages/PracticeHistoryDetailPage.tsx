import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

import {
  Link,
  useParams,
} from "react-router-dom";

import { questions } from "../data/questions";
import {
  ADMIN_QUESTIONS_EVENT,
  getAdminQuestions,
} from "../lib/adminQuestions";
import {
  getPracticeHistory,
  getPracticeHistoryStatus,
  PRACTICE_HISTORY_EVENT,
} from "../lib/practiceSession";

import PracticeSessionReview from "../components/PracticeSessionReview";

function PracticeHistoryDetailPage() {
  const { sessionId } = useParams();

  const [historyVersion, setHistoryVersion] =
    useState(0);
  const [adminVersion, setAdminVersion] =
    useState(0);

  useEffect(() => {
    const syncHistory = () => {
      setHistoryVersion(
        (version) => version + 1,
      );
    };

    const syncAdminQuestions = () => {
      setAdminVersion(
        (version) => version + 1,
      );
    };

    window.addEventListener(
      PRACTICE_HISTORY_EVENT,
      syncHistory,
    );
    window.addEventListener(
      "storage",
      syncHistory,
    );
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
        PRACTICE_HISTORY_EVENT,
        syncHistory,
      );
      window.removeEventListener(
        "storage",
        syncHistory,
      );
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

  const entry = useMemo(
    () =>
      getPracticeHistory().find(
        (item) => item.sessionId === sessionId,
      ) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, historyVersion],
  );

  const questionById = useMemo(() => {
    const lookup = new Map(
      [...questions, ...getAdminQuestions()].map(
        (question) => [question.id, question],
      ),
    );

    return lookup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminVersion]);

  const completedIds = useMemo(
    () =>
      new Set(entry?.completedQuestionIds ?? []),
    [entry],
  );

  if (!entry) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Session not found
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            This practice session is no longer
            in your history.
          </p>

          <Link
            to="/practice"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Practice
          </Link>
        </div>
      </div>
    );
  }

  const total = entry.totalQuestions;
  const notCompleted = Math.max(
    total - entry.completedCount,
    0,
  );
  const completionRate =
    total === 0
      ? 0
      : Math.round(
          (entry.completedCount / total) * 100,
        );

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/practice"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Practice
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Session Review
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-2xl">
          <section className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={24} />
            </span>

            <h1 className="mt-4 text-xl font-semibold text-gray-900">
              Practice Complete
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              {new Date(
                entry.finishedAt,
              ).toLocaleString()}
            </p>

            <p className="mt-2 text-sm text-gray-500">
              {total}{" "}
              {total === 1
                ? "Question"
                : "Questions"}{" "}
              · {entry.completedCount} Completed ·{" "}
              {notCompleted} Not Completed
            </p>

            <p className="mt-4 text-3xl font-semibold text-gray-900">
              {completionRate}%
            </p>

            <p className="mt-1 text-xs text-gray-500">
              Completion rate ·{" "}
              {getPracticeHistoryStatus(entry)}
            </p>
          </section>

          {entry.questionIds.length > 0 && (
            <PracticeSessionReview
              questionIds={entry.questionIds}
              completedIds={completedIds}
              questionById={questionById}
              launchSearch={entry.launchSearch}
              reviewReturnPath={`/practice/history/${entry.sessionId}`}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default PracticeHistoryDetailPage;
