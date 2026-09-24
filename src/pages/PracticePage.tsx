import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  RotateCcw,
  Target,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { questions } from "../data/questions";
import {
  ADMIN_QUESTIONS_EVENT,
  getAdminQuestions,
} from "../lib/adminQuestions";
import {
  clearPracticeSession,
  finishPracticeSession,
  getPracticeSession,
  markSessionQuestionCompleted,
  PRACTICE_SESSION_EVENT,
  updateSessionIndex,
} from "../lib/practiceSession";
import type { PracticeSession } from "../lib/practiceSession";

import QuestionPage from "./QuestionPage";
import PracticeHistoryList from "../components/PracticeHistoryList";
import PracticeSessionReview from "../components/PracticeSessionReview";

function PracticePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] =
    useSearchParams();

  const [session, setSession] =
    useState<PracticeSession | null>(() =>
      getPracticeSession(),
    );

  const [adminVersion, setAdminVersion] =
    useState(0);

  useEffect(() => {
    const syncSession = () => {
      setSession(getPracticeSession());
    };

    const syncAdminQuestions = () => {
      setAdminVersion(
        (version) => version + 1,
      );
    };

    window.addEventListener(
      PRACTICE_SESSION_EVENT,
      syncSession,
    );
    window.addEventListener(
      "storage",
      syncSession,
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
        PRACTICE_SESSION_EVENT,
        syncSession,
      );
      window.removeEventListener(
        "storage",
        syncSession,
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

  const allQuestions = useMemo(
    () => [...questions, ...getAdminQuestions()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminVersion],
  );

  const questionById = useMemo(() => {
    const lookup = new Map(
      allQuestions.map((question) => [
        question.id,
        question,
      ]),
    );

    return lookup;
  }, [allQuestions]);

  const validQuestionIds = useMemo(() => {
    if (!session) {
      return [];
    }

    return session.questionIds.filter((id) =>
      questionById.has(id),
    );
  }, [session, questionById]);

  const safeIndex = useMemo(() => {
    if (!session || validQuestionIds.length === 0) {
      return 0;
    }

    return Math.min(
      Math.max(session.currentIndex, 0),
      validQuestionIds.length - 1,
    );
  }, [session, validQuestionIds]);

  const currentQuestionId =
    validQuestionIds[safeIndex] ?? null;

  const completedCount = useMemo(() => {
    if (!session) {
      return 0;
    }

    const validIds = new Set(validQuestionIds);

    return session.completedQuestionIds.filter(
      (id) => validIds.has(id),
    ).length;
  }, [session, validQuestionIds]);

  const completedIds = useMemo(
    () =>
      new Set(session?.completedQuestionIds ?? []),
    [session],
  );

  useEffect(() => {
    if (!session || !currentQuestionId) {
      return;
    }

    if (
      searchParams.get("question") !==
      currentQuestionId
    ) {
      setSearchParams(
        { question: currentQuestionId },
        { replace: true },
      );
    }
  }, [session, currentQuestionId, searchParams, setSearchParams]);

  if (!session) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <main className="p-8">
          <div className="mx-auto max-w-2xl">
            <div className="flex flex-col items-center px-8 py-12 text-center">
              <Target
                size={32}
                className="text-gray-300"
              />

              <h1 className="mt-4 text-xl font-semibold text-gray-900">
                No active practice session
              </h1>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Start a practice session from
                the Questions page to solve a
                focused set of questions.
              </p>

              <Link
                to="/"
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <ArrowLeft size={16} />
                Back to Questions
              </Link>
            </div>

            <PracticeHistoryList />
          </div>
        </main>
      </div>
    );
  }

  if (
    session.status === "finished" ||
    validQuestionIds.length === 0
  ) {
    const total = validQuestionIds.length;
    const notCompleted = Math.max(
      total - completedCount,
      0,
    );
    const completionRate =
      total === 0
        ? 0
        : Math.round(
            (completedCount / total) * 100,
          );

    const backSearch = session.launchSearch
      ? `?${session.launchSearch}`
      : "";

    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <header className="border-b border-gray-200 bg-white">
          <div className="flex h-[72px] items-center px-8">
            <Link
              to={{
                pathname: "/",
                search: backSearch,
              }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft size={17} />
              Back to Questions
            </Link>

            <div className="mx-4 h-5 w-px bg-gray-200" />

            <span className="text-sm font-medium text-gray-900">
              Practice Session
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
                {validQuestionIds.length === 0
                  ? "Session unavailable"
                  : "Practice Complete"}
              </h1>

              {validQuestionIds.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  The questions in this session
                  are no longer available.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-gray-500">
                    {total}{" "}
                    {total === 1
                      ? "Question"
                      : "Questions"}{" "}
                    · {completedCount} Completed ·{" "}
                    {notCompleted} Not Completed
                  </p>

                  <p className="mt-4 text-3xl font-semibold text-gray-900">
                    {completionRate}%
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    Completion rate
                  </p>
                </>
              )}

              <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
                {validQuestionIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const launchSearch =
                        session.launchSearch;

                      clearPracticeSession();

                      navigate(
                        {
                          pathname: "/",
                          search:
                            launchSearch
                              ? `?${launchSearch}`
                              : "",
                        },
                        {
                          state: {
                            openPracticeSetup: true,
                          },
                        },
                      );
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto"
                  >
                    <RotateCcw size={16} />
                    Practice Again
                  </button>
                )}

                <Link
                  to={{
                    pathname: "/",
                    search: backSearch,
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 sm:w-auto"
                >
                  <ArrowLeft size={16} />
                  Back to Questions
                </Link>
              </div>
            </section>

            {session.questionIds.length > 0 && (
              <PracticeSessionReview
                questionIds={
                  session.questionIds
                }
                completedIds={completedIds}
                questionById={questionById}
                launchSearch={
                  session.launchSearch
                }
              />
            )}
          </div>
        </main>
      </div>
    );
  }

  const total = validQuestionIds.length;
  const isLast = safeIndex === total - 1;
  const positionRate = Math.round(
    ((safeIndex + 1) / total) * 100,
  );
  const completionRate =
    total === 0
      ? 0
      : Math.round(
          (completedCount / total) * 100,
        );

  const backSearch = session.launchSearch
    ? `?${session.launchSearch}`
    : "";

  const handlePrevious = () => {
    if (safeIndex > 0) {
      setSession(
        updateSessionIndex(
          session,
          safeIndex - 1,
        ),
      );
    }
  };

  const handleNext = () => {
    if (!isLast) {
      setSession(
        updateSessionIndex(
          session,
          safeIndex + 1,
        ),
      );
    }
  };

  const handleFinish = () => {
    setSession(finishPracticeSession(session));
  };

  const handleSolved = (questionId: string) => {
    if (questionId === currentQuestionId) {
      setSession(
        markSessionQuestionCompleted(
          session,
          questionId,
        ),
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to={{
              pathname: "/",
              search: backSearch,
            }}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Questions
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Practice Session
          </span>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span
            className="text-xs text-gray-500"
            aria-live="polite"
          >
            Question {safeIndex + 1} of {total}{" "}
            · Completed {completedCount} of{" "}
            {total}
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1400px]">
          <section
            aria-label="Session progress"
            className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-gray-900">
                Question {safeIndex + 1} of{" "}
                {total}
              </p>

              <p className="text-xs text-gray-500">
                Completed {completedCount} of{" "}
                {total} · {completionRate}%
              </p>
            </div>

            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completedCount}
              aria-label={`Completed ${completedCount} of ${total} questions`}
            >
              <div
                className="h-full rounded-full bg-gray-900 transition-all"
                style={{
                  width: `${completionRate}%`,
                }}
              />
            </div>

            <p className="mt-2 text-xs text-gray-400">
              Position {positionRate}% through
              the session
            </p>
          </section>

          {currentQuestionId && (
            <QuestionPage
              key={session.sessionId}
              embeddedQuestionId={
                currentQuestionId
              }
              hideChrome
              onSolved={handleSolved}
            />
          )}

          <nav
            aria-label="Practice session navigation"
            className="mt-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <button
              type="button"
              onClick={handlePrevious}
              disabled={safeIndex <= 0}
              aria-label="Previous session question"
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft size={16} />
              Previous
            </button>

            <span className="text-center text-xs text-gray-500">
              Question {safeIndex + 1} of{" "}
              {total}
            </span>

            {isLast ? (
              <button
                type="button"
                onClick={handleFinish}
                aria-label="Finish practice session"
                className="flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Flag size={16} />
                Finish Session
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next session question"
                className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Next
                <ChevronRight size={16} />
              </button>
            )}
          </nav>
        </div>
      </main>
    </div>
  );
}

export default PracticePage;
