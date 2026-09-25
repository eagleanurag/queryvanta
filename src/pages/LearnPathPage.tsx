import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Play,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "../lib/progress";
import {
  getLearningPath,
  getPathPool,
  getPathProgress,
  launchPracticeSession,
  resolveStageQuestions,
  selectSessionQuestionIds,
  useActiveCatalog,
} from "../lib/learning";

function LearnPathPage() {
  const { pathId } = useParams();
  const navigate = useNavigate();
  const catalog = useActiveCatalog();

  const [solvedIds, setSolvedIds] = useState<Set<string>>(
    () => getSolvedQuestionIds(),
  );

  useEffect(() => {
    const syncProgress = () => {
      setSolvedIds(getSolvedQuestionIds());
    };

    window.addEventListener(
      PROGRESS_EVENT,
      syncProgress,
    );
    window.addEventListener(
      "storage",
      syncProgress,
    );

    return () => {
      window.removeEventListener(
        PROGRESS_EVENT,
        syncProgress,
      );
      window.removeEventListener(
        "storage",
        syncProgress,
      );
    };
  }, []);

  const path = getLearningPath(pathId);

  const stages = useMemo(() => {
    if (!path) {
      return [];
    }

    return path.stages.map((stage) => {
      const questions = resolveStageQuestions(
        catalog,
        stage.match,
      );
      const progress = getPathProgress(
        questions.map((question) => question.id),
        solvedIds,
      );

      return { stage, questions, progress };
    });
  }, [path, catalog, solvedIds]);

  const pool = useMemo(
    () => (path ? getPathPool(catalog, path) : []),
    [path, catalog],
  );

  const overall = useMemo(
    () =>
      getPathProgress(
        pool.map((question) => question.id),
        solvedIds,
      ),
    [pool, solvedIds],
  );

  const nextStage = useMemo(
    () =>
      stages.find(
        (entry) =>
          entry.questions.length > 0 &&
          entry.progress.completed <
            entry.progress.total,
      ) ??
      stages.find(
        (entry) => entry.questions.length > 0,
      ) ??
      null,
    [stages],
  );

  const startStage = (stageId: string) => {
    const entry = stages.find(
      (item) => item.stage.id === stageId,
    );

    if (
      !entry ||
      !path ||
      entry.questions.length === 0
    ) {
      return;
    }

    const selectedIds = selectSessionQuestionIds(
      entry.questions.map(
        (question) => question.id,
      ),
      entry.stage.size,
      "sequential",
    );

    launchPracticeSession(navigate, {
      questionIds: selectedIds,
      launchSearch: "",
      availableCount: entry.questions.length,
      mode: "sequential",
      origin: "learning",
      originLabel: `${path.title} · ${entry.stage.title}`,
      originPath: `/learn/${path.id}`,
    });
  };

  if (!path) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Learning path not found
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            This learning path does not exist.
          </p>

          <Link
            to="/learn"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Learn
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/learn"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Learn
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Learning Path
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="text-2xl font-semibold text-gray-900">
            {path.title}
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            {path.description}
          </p>

          <section
            aria-label="Path progress"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-500">
                {overall.completed} of{" "}
                {overall.total} completed ·{" "}
                {overall.rate}%
              </p>

              {nextStage && (
                <button
                  type="button"
                  onClick={() =>
                    startStage(nextStage.stage.id)
                  }
                  className="ml-auto flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  <Play size={16} />
                  {overall.completed === 0
                    ? `Start: ${nextStage.stage.title}`
                    : `Continue: ${nextStage.stage.title}`}
                </button>
              )}
            </div>

            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={overall.total}
              aria-valuenow={overall.completed}
              aria-label={`${path.title} progress`}
            >
              <div
                className="h-full rounded-full bg-gray-900 transition-all"
                style={{
                  width: `${overall.rate}%`,
                }}
              />
            </div>
          </section>

          <section
            aria-label="Path stages"
            className="mt-6 space-y-4"
          >
            {stages.map((entry) => (
              <div
                key={entry.stage.id}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                      {entry.progress.completed >=
                        entry.progress.total &&
                      entry.progress.total > 0 ? (
                        <CheckCircle2
                          size={16}
                          className="shrink-0 text-emerald-600"
                        />
                      ) : (
                        <Circle
                          size={16}
                          className="shrink-0 text-gray-300"
                        />
                      )}
                      {entry.stage.title}
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      {
                        entry.stage
                          .description
                      }
                    </p>

                    <p className="mt-2 text-xs text-gray-500">
                      {
                        entry.progress
                          .completed
                      }{" "}
                      of {entry.progress.total}{" "}
                      completed ·{" "}
                      {entry.progress.rate}%
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={
                      entry.questions.length ===
                      0
                    }
                    title={
                      entry.questions.length ===
                      0
                        ? "No matching questions available"
                        : `Start ${entry.stage.title}`
                    }
                    onClick={() =>
                      startStage(entry.stage.id)
                    }
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-900"
                  >
                    Start
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ))}

            {stages.length === 0 && (
              <p className="text-sm text-gray-500">
                This path has no stages.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default LearnPathPage;
