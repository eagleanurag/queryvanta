import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Briefcase,
  CheckCircle2,
  Database,
  Flame,
  Play,
  Shuffle,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import { getAllAttempts } from "../lib/attempts";
import { getBookmarkedQuestionIds } from "../lib/bookmarks";
import SEO from "../components/SEO";
import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "../lib/progress";
import {
  getPathPool,
  getPathProgress,
  getPresetAvailability,
  getTopics,
  getWeakAreas,
  launchPracticeSession,
  launchPresetSession,
  LEARNING_PATHS,
  PRACTICE_PRESETS,
  selectSessionQuestionIds,
  useActiveCatalog,
  WEAK_PRACTICE_SIZE,
} from "../lib/learning";
import type { PracticePreset } from "../lib/learning";
import { LEARN_SEO } from "../lib/seo";

const PATH_ICONS: Record<string, typeof Database> = {
  Database,
  Brain,
  Sparkles,
  Zap,
  Briefcase,
  Target,
};

function pathIcon(name: string) {
  return PATH_ICONS[name] ?? BookOpen;
}

function LearnPage() {
  const navigate = useNavigate();
  const catalog = useActiveCatalog();

  const [solvedIds, setSolvedIds] = useState<Set<string>>(
    () => getSolvedQuestionIds(),
  );
  const [bookmarkedIds, setBookmarkedIds] = useState<
    Set<string>
  >(() => getBookmarkedQuestionIds());
  const [attemptsVersion, setAttemptsVersion] =
    useState(0);

  useEffect(() => {
    const syncProgress = () => {
      setSolvedIds(getSolvedQuestionIds());
      setBookmarkedIds(getBookmarkedQuestionIds());
      setAttemptsVersion(
        (version) => version + 1,
      );
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

  const attemptsByQuestion = useMemo(() => {
    const counts: Record<string, number> = {};
    const all = getAllAttempts();

    for (const [questionId, attempts] of Object.entries(
      all,
    )) {
      counts[questionId] = attempts.length;
    }

    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptsVersion, solvedIds]);

  const pathSummaries = useMemo(
    () =>
      LEARNING_PATHS.map((path) => {
        const pool = getPathPool(catalog, path);
        const progress = getPathProgress(
          pool.map((question) => question.id),
          solvedIds,
        );

        return { path, pool, progress };
      }).filter(
        (summary) => summary.pool.length > 0,
      ),
    [catalog, solvedIds],
  );

  const continuePaths = useMemo(
    () =>
      pathSummaries.filter(
        (summary) =>
          summary.progress.completed > 0 &&
          summary.progress.completed <
            summary.progress.total,
      ),
    [pathSummaries],
  );

  const topics = useMemo(
    () => getTopics(catalog, solvedIds),
    [catalog, solvedIds],
  );

  const weakAreas = useMemo(
    () =>
      getWeakAreas(
        catalog,
        solvedIds,
        attemptsByQuestion,
      ),
    [catalog, solvedIds, attemptsByQuestion],
  );

  const presetAvailability = useMemo(() => {
    const available = new Map<string, number>();

    for (const preset of PRACTICE_PRESETS) {
      available.set(
        preset.id,
        getPresetAvailability(
          catalog,
          solvedIds,
          bookmarkedIds,
          preset,
        ),
      );
    }

    return available;
  }, [catalog, solvedIds, bookmarkedIds]);

  const startPreset = (preset: PracticePreset) => {
    launchPresetSession(
      navigate,
      catalog,
      solvedIds,
      bookmarkedIds,
      preset,
      "learning",
      "/learn",
    );
  };

  const startWeakArea = (category: string) => {
    const remaining = catalog
      .filter(
        (question) =>
          question.category === category &&
          !solvedIds.has(question.id),
      )
      .map((question) => question.id);

    launchPracticeSession(navigate, {
      questionIds: selectSessionQuestionIds(
        remaining,
        Math.min(WEAK_PRACTICE_SIZE, remaining.length),
        "sequential",
      ),
      launchSearch: "",
      availableCount: remaining.length,
      mode: "sequential",
      origin: "weak-topic",
      originLabel: `Weak areas · ${category}`,
      originPath: "/learn",
    });
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <SEO meta={LEARN_SEO} />

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

          <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <BookOpen size={17} />
            Learn
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="text-2xl font-semibold text-gray-900">
            Learning Paths
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Structured routes through real
            QueryVanta questions.
          </p>

          <section
            aria-label="Continue learning"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <Target size={16} className="text-gray-500" />
              Continue Learning
            </h2>

            {continuePaths.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                {solvedIds.size === 0
                  ? "Solve your first question to unlock continue suggestions."
                  : "No paths in progress. Start a path below or finish one you began."}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {continuePaths.map((summary) => (
                  <li
                    key={summary.path.id}
                    className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {summary.path.title}
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        {summary.progress.completed}{" "}
                        of{" "}
                        {summary.progress.total}{" "}
                        completed ·{" "}
                        {summary.progress.rate}%
                      </p>
                    </div>

                    <Link
                      to={`/learn/${summary.path.id}`}
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      Continue
                      <ArrowRight size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="Learning Paths"
            className="mt-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {pathSummaries.map((summary) => {
                const IconComponent = pathIcon(
                  summary.path.icon,
                );

                return (
                  <Link
                    key={summary.path.id}
                    to={`/learn/${summary.path.id}`}
                    className="block rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-gray-300 hover:shadow"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
                      <IconComponent size={18} />
                    </span>

                    <h2 className="mt-3 font-semibold text-gray-900">
                      {summary.path.title}
                    </h2>

                    <p className="mt-1 text-sm leading-6 text-gray-500">
                      {
                        summary.path
                          .description
                      }
                    </p>

                    <p className="mt-3 text-xs text-gray-500">
                      {
                        summary.progress
                          .completed
                      }{" "}
                      of{" "}
                      {summary.progress.total}{" "}
                      completed ·{" "}
                      {summary.progress.rate}%
                    </p>

                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={
                        summary.progress.total
                      }
                      aria-valuenow={
                        summary.progress.completed
                      }
                      aria-label={`${summary.path.title} progress`}
                    >
                      <div
                        className="h-full rounded-full bg-gray-900 transition-all"
                        style={{
                          width: `${summary.progress.rate}%`,
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>

            {pathSummaries.length === 0 && (
              <p className="mt-3 text-sm text-gray-500">
                No learning paths match the
                current catalog.
              </p>
            )}
          </section>

          <section
            aria-label="Topics"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">
              Topics
            </h2>

            {topics.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                No topics available right now.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {topics.map((topic) => (
                  <li
                    key={topic.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                  >
                    <Link
                      to={`/learn/topic/${topic.id}`}
                      className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:underline"
                    >
                      {topic.name}
                    </Link>

                    <span className="text-xs text-gray-500">
                      {topic.completed} /{" "}
                      {topic.total} · {topic.rate}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="Practice weak areas"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <Flame
                size={16}
                className="text-gray-500"
              />
              Practice Weak Areas
            </h2>

            {weakAreas.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-gray-500">
                Not enough practice data yet.
                Attempt at least two questions
                in a topic and weak areas will
                appear here with an explanation
                of what makes them weak.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {weakAreas.map((area) => (
                  <li
                    key={area.category}
                    className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {area.category}
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        {area.explanation} ·{" "}
                        {
                          area.attemptEvents
                        }{" "}
                        {area.attemptEvents === 1
                          ? "attempt"
                          : "attempts"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        startWeakArea(
                          area.category,
                        )
                      }
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      <Play size={16} />
                      Practice
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="Quick practice"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <Shuffle
                size={16}
                className="text-gray-500"
              />
              Quick Practice
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PRACTICE_PRESETS.map((preset) => {
                const available =
                  presetAvailability.get(
                    preset.id,
                  ) ?? 0;
                const disabled =
                  available === 0;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      startPreset(preset)
                    }
                    title={
                      disabled
                        ? "No matching questions available"
                        : `${preset.description} (${available} available)`
                    }
                    className="flex flex-col rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <Play size={14} />
                      {preset.label}
                    </span>

                    <span className="mt-1 text-xs text-gray-500">
                      {preset.description}{" "}
                      ({available} available)
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            aria-label="Interview practice"
            className="mt-6 rounded-xl border border-gray-900 bg-gray-900 p-6 text-white shadow-sm"
          >
            <h2 className="font-semibold">
              Interview Practice
            </h2>

            <p className="mt-1 text-sm leading-6 text-gray-300">
              Timed or untimed mock interviews
              with real questions and factual
              summaries.
            </p>

            <Link
              to="/interview"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
            >
              Open Interview Practice
              <ArrowRight size={16} />
            </Link>

            <p className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <CheckCircle2 size={13} />
              Solved state only changes on
              correct answers, as always.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

export default LearnPage;
