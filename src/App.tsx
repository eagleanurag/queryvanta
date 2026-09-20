import { useEffect, useMemo, useState } from "react";

import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Code2,
  FolderKanban,
  Home,
  Search,
  Settings,
  Star,
  Target,
} from "lucide-react";

import { questions } from "./data/questions";
import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "./lib/progress";
import {
  BOOKMARKS_EVENT,
  getBookmarkedQuestionIds,
  toggleQuestionBookmark,
} from "./lib/bookmarks";
import QuestionCard from "./components/QuestionCard";
import QuestionFilters from "./components/QuestionFilters";

const navigation = [
  { label: "Home", icon: Home },
  { label: "Learn", icon: BookOpen },
  { label: "Tracks", icon: Target },
  { label: "Projects", icon: FolderKanban },
];

const practiceItems = [
  { label: "Coding Problems", icon: Code2, active: true },
  { label: "Data Modeling", icon: BarChart3 },
  { label: "Architecture Design", icon: BookOpen },
  { label: "Cloud Labs", icon: FolderKanban },
];

function App() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] =
    useState("All");
  const [selectedQuestionType, setSelectedQuestionType] =
    useState("All");
  const [selectedLanguage, setSelectedLanguage] =
    useState("All");
  const [selectedCompany, setSelectedCompany] =
    useState("All");
  const [selectedStatus, setSelectedStatus] =
    useState("All");

  const [solvedQuestionIds, setSolvedQuestionIds] =
    useState<Set<string>>(
      () => getSolvedQuestionIds(),
    );

  const [bookmarkedQuestionIds, setBookmarkedQuestionIds] =
    useState<Set<string>>(
      () => getBookmarkedQuestionIds(),
    );

  const [showBookmarkedOnly, setShowBookmarkedOnly] =
    useState(false);

  useEffect(() => {
    const syncProgress = () => {
      setSolvedQuestionIds(
        getSolvedQuestionIds(),
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

  useEffect(() => {
    const syncBookmarks = () => {
      setBookmarkedQuestionIds(
        getBookmarkedQuestionIds(),
      );
    };

    window.addEventListener(
      BOOKMARKS_EVENT,
      syncBookmarks,
    );

    window.addEventListener(
      "storage",
      syncBookmarks,
    );

    return () => {
      window.removeEventListener(
        BOOKMARKS_EVENT,
        syncBookmarks,
      );

      window.removeEventListener(
        "storage",
        syncBookmarks,
      );
    };
  }, []);

  const handleToggleBookmark = (questionId: string) => {
    toggleQuestionBookmark(questionId);
    setBookmarkedQuestionIds(
      getBookmarkedQuestionIds(),
    );
  };

  const difficulties = [
    "All",
    ...Array.from(
      new Set(
        questions.map(
          (question) => question.difficulty,
        ),
      ),
    ),
  ];

  const questionTypes = [
    "All",
    ...Array.from(
      new Set(
        questions.map(
          (question) => question.questionType,
        ),
      ),
    ),
  ];

  const languages = [
    "All",
    ...Array.from(
      new Set(
        questions.flatMap(
          (question) => question.languages,
        ),
      ),
    ),
  ];

  const companies = [
    "All",
    ...Array.from(
      new Set(
        questions.flatMap(
          (question) => question.companies,
        ),
      ),
    ),
  ];

  const statuses = ["All", "Solved", "Unsolved"];

  const filteredQuestions = useMemo(() => {
    const normalizedSearch =
      searchTerm.trim().toLowerCase();

    return questions.filter((question) => {
      const matchesBookmark =
        !showBookmarkedOnly ||
        bookmarkedQuestionIds.has(question.id);

      const matchesSearch =
        normalizedSearch === "" ||
        question.title
          .toLowerCase()
          .includes(normalizedSearch) ||
        question.description
          .toLowerCase()
          .includes(normalizedSearch) ||
        question.category
          .toLowerCase()
          .includes(normalizedSearch) ||
        question.tags.some((tag) =>
          tag
            .toLowerCase()
            .includes(normalizedSearch),
        );

      const matchesDifficulty =
        selectedDifficulty === "All" ||
        question.difficulty ===
          selectedDifficulty;

      const matchesQuestionType =
        selectedQuestionType === "All" ||
        question.questionType ===
          selectedQuestionType;

      const matchesLanguage =
        selectedLanguage === "All" ||
        question.languages.includes(
          selectedLanguage,
        );

      const matchesCompany =
        selectedCompany === "All" ||
        question.companies.includes(
          selectedCompany,
        );

      const matchesStatus =
        selectedStatus === "All" ||
        (selectedStatus === "Solved"
          ? solvedQuestionIds.has(question.id)
          : !solvedQuestionIds.has(question.id));

      return (
        matchesBookmark &&
        matchesSearch &&
        matchesDifficulty &&
        matchesQuestionType &&
        matchesLanguage &&
        matchesCompany &&
        matchesStatus
      );
    });
  }, [
    searchTerm,
    selectedDifficulty,
    selectedQuestionType,
    selectedLanguage,
    selectedCompany,
    selectedStatus,
    solvedQuestionIds,
    showBookmarkedOnly,
    bookmarkedQuestionIds,
  ]);

  const totalQuestions = questions.length;

  const solvedQuestions = questions.filter(
    (question) =>
      solvedQuestionIds.has(question.id),
  ).length;

  const easyQuestions = questions.filter(
    (question) =>
      question.difficulty === "Easy",
  ).length;

  const mediumQuestions = questions.filter(
    (question) =>
      question.difficulty === "Medium",
  ).length;

  const hardQuestions = questions.filter(
    (question) =>
      question.difficulty === "Hard",
  ).length;

  const completionPercentage =
    totalQuestions === 0
      ? 0
      : Math.round(
          (solvedQuestions /
            totalQuestions) *
            100,
        );

  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    selectedDifficulty !== "All" ||
    selectedQuestionType !== "All" ||
    selectedLanguage !== "All" ||
    selectedCompany !== "All" ||
    selectedStatus !== "All";

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedDifficulty("All");
    setSelectedQuestionType("All");
    setSelectedLanguage("All");
    setSelectedCompany("All");
    setSelectedStatus("All");
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 w-[252px] border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          {/* Brand */}
          <div className="flex h-[76px] items-center px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">
              Q
            </div>

            <div className="ml-3">
              <div className="text-[15px] font-semibold text-gray-900">
                QueryVanta
              </div>

              <div className="text-[11px] text-gray-400">
                Data Engineering Practice
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="px-3">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.label}
                  className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                >
                  <Icon
                    size={17}
                    strokeWidth={1.8}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}

            {/* Practice */}
            <div className="mt-3">
              <button className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-gray-800">
                <span className="flex items-center gap-3">
                  <Code2
                    size={17}
                    strokeWidth={1.8}
                  />
                  Practice
                </span>

                <ChevronDown size={16} />
              </button>

              <div className="ml-4 border-l border-gray-200 pl-2">
                {practiceItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.label}
                      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] ${
                        item.active
                          ? "bg-gray-100 font-medium text-gray-900"
                          : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                      }`}
                    >
                      <Icon
                        size={15}
                        strokeWidth={1.8}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Bottom navigation */}
          <div className="mt-auto border-t border-gray-100 p-3">
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-gray-600 hover:bg-gray-100">
              <Settings
                size={17}
                strokeWidth={1.8}
              />
              Settings
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[252px] min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="flex h-[76px] items-center justify-between px-8">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                Coding Problems
              </h1>

              <p className="mt-0.5 text-xs text-gray-500">
                Practice SQL, PySpark and Data Engineering
              </p>
            </div>

            <button
              onClick={() =>
                setShowBookmarkedOnly(
                  (previous) => !previous,
                )
              }
              aria-pressed={showBookmarkedOnly}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm ${
                showBookmarkedOnly
                  ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Star
                size={16}
                fill={
                  showBookmarkedOnly
                    ? "currentColor"
                    : "none"
                }
              />
              Bookmarks
              {bookmarkedQuestionIds.size > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    showBookmarkedOnly
                      ? "bg-white/20 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {bookmarkedQuestionIds.size}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Page */}
        <div className="p-8">
          {/* Search + Filters */}
          <QuestionFilters
            searchTerm={searchTerm}
            selectedQuestionType={
              selectedQuestionType
            }
            selectedDifficulty={
              selectedDifficulty
            }
            selectedLanguage={
              selectedLanguage
            }
            selectedCompany={selectedCompany}
            selectedStatus={selectedStatus}
            questionTypes={questionTypes}
            difficulties={difficulties}
            languages={languages}
            companies={companies}
            statuses={statuses}
            hasActiveFilters={hasActiveFilters}
            setSearchTerm={setSearchTerm}
            setSelectedQuestionType={
              setSelectedQuestionType
            }
            setSelectedDifficulty={
              setSelectedDifficulty
            }
            setSelectedLanguage={
              setSelectedLanguage
            }
            setSelectedCompany={
              setSelectedCompany
            }
            setSelectedStatus={setSelectedStatus}
            clearFilters={clearFilters}
          />

          {/* Content grid */}
          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            {/* Question area */}
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                      Questions
                      {showBookmarkedOnly && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600">
                          <Star
                            size={12}
                            fill="currentColor"
                          />
                          Bookmarked
                        </span>
                      )}
                    </h2>

                    <p className="mt-1 text-xs text-gray-500">
                      Showing{" "}
                      {filteredQuestions.length}{" "}
                      of {totalQuestions} questions
                      {showBookmarkedOnly && (
                        <>
                          {" "}
                          ·{" "}
                          <button
                            onClick={() =>
                              setShowBookmarkedOnly(
                                false,
                              )
                            }
                            className="font-medium text-gray-700 underline hover:text-gray-900"
                          >
                            Show all
                          </button>
                        </>
                      )}
                    </p>
                  </div>

                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                    {solvedQuestions} Solved
                  </span>
                </div>
              </div>

              {/* Questions */}
              <div className="space-y-4 p-5">
                {filteredQuestions.length > 0 ? (
                  filteredQuestions.map(
                    (question) => (
                      <QuestionCard
                        key={question.id}
                        question={question}
                        isSolved={solvedQuestionIds.has(
                          question.id,
                        )}
                        isBookmarked={bookmarkedQuestionIds.has(
                          question.id,
                        )}
                        onToggleBookmark={
                          handleToggleBookmark
                        }
                      />
                    ),
                  )
                ) : showBookmarkedOnly ? (
                  <div className="rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center">
                    <Star
                      size={28}
                      className="mx-auto text-gray-300"
                    />

                    <h3 className="mt-3 text-sm font-semibold text-gray-800">
                      {bookmarkedQuestionIds.size ===
                      0
                        ? "No bookmarks yet"
                        : "No bookmarked questions found"}
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      {bookmarkedQuestionIds.size ===
                      0
                        ? "Bookmark questions with the star icon to find them here later."
                        : "Try changing your search or filters."}
                    </p>

                    <div className="mt-4 flex items-center justify-center gap-2">
                      {hasActiveFilters && (
                        <button
                          onClick={clearFilters}
                          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                        >
                          Clear Filters
                        </button>
                      )}

                      <button
                        onClick={() =>
                          setShowBookmarkedOnly(
                            false,
                          )
                        }
                        className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Show all questions
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center">
                    <Search
                      size={28}
                      className="mx-auto text-gray-300"
                    />

                    <h3 className="mt-3 text-sm font-semibold text-gray-800">
                      No questions found
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      Try changing your search or filters.
                    </p>

                    <button
                      onClick={clearFilters}
                      className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Progress */}
            <aside className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-gray-900">
                Your Progress
              </h2>

              <div className="mt-6 flex items-center justify-center">
                <div className="flex h-40 w-40 items-center justify-center rounded-full border-[14px] border-gray-100">
                  <div className="text-center">
                    <div className="text-3xl font-semibold text-gray-900">
                      {solvedQuestions}
                    </div>

                    <div className="text-xs text-gray-400">
                      Solved
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-semibold text-emerald-500">
                    {easyQuestions}
                  </div>

                  <div className="text-[11px] text-gray-400">
                    Easy
                  </div>
                </div>

                <div>
                  <div className="text-lg font-semibold text-amber-500">
                    {mediumQuestions}
                  </div>

                  <div className="text-[11px] text-gray-400">
                    Medium
                  </div>
                </div>

                <div>
                  <div className="text-lg font-semibold text-red-400">
                    {hardQuestions}
                  </div>

                  <div className="text-[11px] text-gray-400">
                    Hard
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    Total Questions
                  </span>

                  <span className="font-medium text-gray-900">
                    {totalQuestions}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    Completed
                  </span>

                  <span className="font-medium text-gray-900">
                    {completionPercentage}%
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;