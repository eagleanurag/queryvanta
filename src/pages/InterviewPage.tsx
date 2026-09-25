import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  Briefcase,
  Clock,
  Play,
} from "lucide-react";

import {
  Link,
  useNavigate,
} from "react-router-dom";

import type {
  Difficulty,
  QuestionType,
} from "../data/questions";
import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "../lib/progress";
import { getBookmarkedQuestionIds } from "../lib/bookmarks";
import {
  filterQuestions,
} from "../lib/questionFilter";
import {
  INTERVIEW_DURATIONS,
  INTERVIEW_PRESETS,
  INTERVIEW_SIZES,
  launchPracticeSession,
  selectSessionQuestionIds,
  useActiveCatalog,
} from "../lib/learning";
import type { PracticeSelectionMode } from "../lib/learning";

const INTERVIEW_TYPES: ("All" | QuestionType)[] = [
  "All",
  "SQL",
  "PySpark",
];

const INTERVIEW_DIFFICULTIES: ("All" | Difficulty)[] = [
  "All",
  "Easy",
  "Medium",
  "Hard",
];

function InterviewPage() {
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

  const categories = useMemo(() => {
    const names = new Set<string>();

    for (const question of catalog) {
      const name = question.category.trim();

      if (name !== "") {
        names.add(name);
      }
    }

    return [
      "All",
      ...[...names].sort((a, b) =>
        a.localeCompare(b),
      ),
    ];
  }, [catalog]);

  const [presetId, setPresetId] = useState<string>(
    INTERVIEW_PRESETS[0].id,
  );
  const [count, setCount] = useState<number>(
    INTERVIEW_PRESETS[0].size,
  );
  const [questionType, setQuestionType] =
    useState<"All" | QuestionType>(
      (INTERVIEW_PRESETS[0].filters
        .questionType as
        | "All"
        | QuestionType) ?? "All",
    );
  const [difficulty, setDifficulty] = useState<
    "All" | Difficulty
  >(
    (INTERVIEW_PRESETS[0].filters.difficulty as
      | "All"
      | Difficulty) ?? "All",
  );
  const [category, setCategory] =
    useState<string>("All");
  const [timed, setTimed] = useState(true);
  const [durationMin, setDurationMin] = useState<number>(
    INTERVIEW_DURATIONS[1],
  );
  const [mode, setMode] =
    useState<PracticeSelectionMode>("sequential");

  const applyPreset = (id: string) => {
    const preset = INTERVIEW_PRESETS.find(
      (item) => item.id === id,
    );

    if (!preset) {
      return;
    }

    setPresetId(preset.id);
    setCount(preset.size);
    setQuestionType(
      (preset.filters.questionType as
        | "All"
        | QuestionType) ?? "All",
    );
    setDifficulty(
      (preset.filters.difficulty as
        | "All"
        | Difficulty) ?? "All",
    );
    setCategory("All");
  };

  const activePreset = INTERVIEW_PRESETS.find(
    (item) => item.id === presetId,
  );

  const pool = useMemo(() => {
    const filtered = filterQuestions(
      catalog,
      {
        searchTerm: "",
        difficulty,
        questionType,
        language: "All",
        company: "All",
        status: "All",
        category,
        bookmarkedOnly: false,
      },
      solvedIds,
      getBookmarkedQuestionIds(),
    );

    if (
      activePreset?.difficulties !== undefined &&
      activePreset.difficulties.length > 0
    ) {
      const allowed = new Set(
        activePreset.difficulties,
      );

      return filtered.filter((question) =>
        allowed.has(question.difficulty),
      );
    }

    return filtered;
  }, [
    catalog,
    solvedIds,
    questionType,
    difficulty,
    category,
    activePreset,
  ]);

  const effectiveSize = Math.min(count, pool.length);
  const canStart = pool.length > 0;

  const startInterview = () => {
    const selectedIds = selectSessionQuestionIds(
      pool.map((question) => question.id),
      effectiveSize,
      mode,
    );

    if (selectedIds.length === 0) {
      return;
    }

    const typeLabel =
      pool.length > 0 &&
      pool.every(
        (question) => question.questionType === "SQL",
      )
        ? "SQL"
        : pool.length > 0 &&
            pool.every(
              (question) =>
                question.questionType ===
                "PySpark",
            )
          ? "PySpark"
          : "Mixed";

    const launched = launchPracticeSession(navigate, {
      questionIds: selectedIds,
      launchSearch: "",
      availableCount: pool.length,
      mode,
      origin: "interview",
      originLabel: `${typeLabel} Interview${
        timed ? ` · Timed ${durationMin}:00` : ""
      }`,
      originPath: "/interview",
      ...(timed
        ? {
            endsAt:
              Date.now() + durationMin * 60 * 1000,
            timeLimitSec: durationMin * 60,
          }
        : {}),
    });

    if (!launched) {
      return;
    }
  };

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

          <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <Briefcase size={17} />
            Interview Practice
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="text-2xl font-semibold text-gray-900">
            Mock Interview Setup
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Real questions, real validation, and
            an optional timer. Solved state only
            changes on correct answers.
          </p>

          <section
            aria-label="Interview presets"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">
              Presets
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {INTERVIEW_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    applyPreset(preset.id)
                  }
                  aria-pressed={
                    presetId === preset.id
                  }
                  className={`rounded-lg border px-4 py-3 text-left transition ${
                    presetId === preset.id
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span className="block text-sm font-medium">
                    {preset.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      presetId === preset.id
                        ? "text-gray-300"
                        : "text-gray-400"
                    }`}
                  >
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            aria-label="Interview configuration"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">
              Configuration
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p
                  id="interview-count-label"
                  className="text-sm font-medium text-gray-700"
                >
                  Questions
                </p>

                <div
                  role="group"
                  aria-labelledby="interview-count-label"
                  className="mt-2 grid grid-cols-4 gap-2"
                >
                  {INTERVIEW_SIZES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setCount(option);
                        setPresetId("custom");
                      }}
                      aria-pressed={
                        count === option
                      }
                      className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                        count === option
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p
                  id="interview-type-label"
                  className="text-sm font-medium text-gray-700"
                >
                  Question type
                </p>

                <div
                  role="group"
                  aria-labelledby="interview-type-label"
                  className="mt-2 grid grid-cols-3 gap-2"
                >
                  {INTERVIEW_TYPES.map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setQuestionType(
                            option,
                          );
                          setPresetId("custom");
                        }}
                        aria-pressed={
                          questionType === option
                        }
                        className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                          questionType === option
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {option}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div>
                <p
                  id="interview-difficulty-label"
                  className="text-sm font-medium text-gray-700"
                >
                  Difficulty
                </p>

                <div
                  role="group"
                  aria-labelledby="interview-difficulty-label"
                  className="mt-2 grid grid-cols-4 gap-2"
                >
                  {INTERVIEW_DIFFICULTIES.map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setDifficulty(option);
                          setPresetId("custom");
                        }}
                        aria-pressed={
                          difficulty === option
                        }
                        className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                          difficulty === option
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {option}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="interview-category"
                  className="text-sm font-medium text-gray-700"
                >
                  Category
                </label>

                <select
                  id="interview-category"
                  value={category}
                  onChange={(event) => {
                    setCategory(
                      event.target.value,
                    );
                    setPresetId("custom");
                  }}
                  className="mt-2 w-full cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-50"
                >
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name === "All"
                        ? "All categories"
                        : name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p
                  id="interview-order-label"
                  className="text-sm font-medium text-gray-700"
                >
                  Question order
                </p>

                <div
                  role="radiogroup"
                  aria-labelledby="interview-order-label"
                  className="mt-2 grid grid-cols-2 gap-2"
                >
                  {(
                    [
                      "sequential",
                      "random",
                    ] as const
                  ).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={
                        mode === option
                      }
                      onClick={() =>
                        setMode(option)
                      }
                      className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition ${
                        mode === option
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p
                  id="interview-timing-label"
                  className="text-sm font-medium text-gray-700"
                >
                  Timing
                </p>

                <div
                  role="group"
                  aria-labelledby="interview-timing-label"
                  className="mt-2 grid grid-cols-2 gap-2"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setTimed(false)
                    }
                    aria-pressed={!timed}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                      !timed
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Untimed
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setTimed(true)
                    }
                    aria-pressed={timed}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition ${
                      timed
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Clock size={14} />
                    Timed
                  </button>
                </div>

                {timed && (
                  <div
                    role="group"
                    aria-label="Interview duration"
                    className="mt-2 grid grid-cols-4 gap-2"
                  >
                    {INTERVIEW_DURATIONS.map(
                      (minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() =>
                            setDurationMin(
                              minutes,
                            )
                          }
                          aria-pressed={
                            durationMin ===
                            minutes
                          }
                          className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                            durationMin ===
                            minutes
                              ? "border-gray-900 bg-gray-900 text-white"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {minutes}m
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-lg bg-gray-50 p-4 sm:flex-row sm:items-center">
              <p className="text-sm text-gray-600">
                {pool.length === 0 ? (
                  <>
                    No questions match this
                    configuration.
                  </>
                ) : (
                  <>
                    {pool.length}{" "}
                    {pool.length === 1
                      ? "question"
                      : "questions"}{" "}
                    available · session of{" "}
                    {effectiveSize}
                    {timed &&
                      ` · ${durationMin} minutes`}
                  </>
                )}
              </p>

              <button
                type="button"
                disabled={!canStart}
                title={
                  canStart
                    ? "Start interview"
                    : "No matching questions available"
                }
                onClick={startInterview}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-900 sm:ml-auto"
              >
                <Play size={16} />
                Start Interview
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default InterviewPage;
