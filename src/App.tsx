import { useEffect, useMemo, useRef, useState } from "react";

import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  FolderKanban,
  Home,
  Play,
  Search,
  Settings,
  Star,
  Target,
  Timer,
} from "lucide-react";

import { questions } from "./data/questions";
import type { Question } from "./data/questions";
import {
  ADMIN_QUESTIONS_EVENT,
  combineQuestionCatalogs,
  getAdminQuestions,
  isQuestionEnabled,
} from "./lib/adminQuestions";
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
import PracticeSetupModal from "./components/PracticeSetupModal";
import {
  createPracticeSession,
  selectSessionQuestionIds,
} from "./lib/practiceSession";
import type { DiscoveryFilters } from "./lib/questionFilter";
import {
  DEFAULT_FILTERS,
  filterQuestions,
  filtersToSearchParams,
  parseFilterSearchParams,
} from "./lib/questionFilter";

type PracticeSource = "filtered" | "bookmarked";

// Canonical discovery context for bookmarked-only
// practice: Back to Questions returns to the
// bookmarked-filtered Questions view.
const BOOKMARKED_DISCOVERY_SEARCH =
  filtersToSearchParams({
    ...DEFAULT_FILTERS,
    bookmarkedOnly: true,
  }).toString();

const navigation = [
  { label: "Home", icon: Home },
  { label: "Learn", icon: BookOpen, to: "/learn" },
  { label: "Tracks", icon: Target },
  { label: "Projects", icon: FolderKanban },
  { label: "Progress", icon: BarChart3, to: "/progress" },
  { label: "Interview", icon: Timer, to: "/interview" },
  {
    label: "Question Management",
    icon: Database,
    to: "/admin/questions",
  },
];

const practiceItems = [
  { label: "Coding Problems", icon: Code2, active: true },
  { label: "Data Modeling", icon: BarChart3 },
  { label: "Architecture Design", icon: BookOpen },
  { label: "Cloud Labs", icon: FolderKanban },
];

const PAGE_SIZE = 10;

function App() {
  const [searchParams, setSearchParams] =
    useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [practiceSource, setPracticeSource] =
    useState<PracticeSource | null>(null);

  const [initialFilters] =
    useState<DiscoveryFilters>(() =>
      parseFilterSearchParams(window.location.search),
    );

  const [searchTerm, setSearchTerm] = useState(
    initialFilters.searchTerm,
  );
  const [selectedDifficulty, setSelectedDifficulty] =
    useState(initialFilters.difficulty);
  const [selectedQuestionType, setSelectedQuestionType] =
    useState(initialFilters.questionType);
  const [selectedLanguage, setSelectedLanguage] =
    useState(initialFilters.language);
  const [selectedCompany, setSelectedCompany] =
    useState(initialFilters.company);
  const [selectedStatus, setSelectedStatus] =
    useState(initialFilters.status);
  const [selectedCategory, setSelectedCategory] =
    useState(initialFilters.category);

  const [solvedQuestionIds, setSolvedQuestionIds] =
    useState<Set<string>>(
      () => getSolvedQuestionIds(),
    );

  const [bookmarkedQuestionIds, setBookmarkedQuestionIds] =
    useState<Set<string>>(
      () => getBookmarkedQuestionIds(),
    );

  const [showBookmarkedOnly, setShowBookmarkedOnly] =
    useState(initialFilters.bookmarkedOnly);

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

  // Active public catalog: built-in questions plus
  // enabled admin questions, without duplicates.
  // Disabled admin questions stay stored and
  // resolvable elsewhere but leave discovery,
  // counts and new practice sessions.
  const allQuestions = useMemo(
    () =>
      combineQuestionCatalogs(
        questions,
        adminQuestions,
      ).filter(isQuestionEnabled),
    [adminQuestions],
  );

  const [currentPage, setCurrentPage] = useState(1);

  const suppressUrlSync = useRef(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedDifficulty,
    selectedQuestionType,
    selectedLanguage,
    selectedCompany,
    selectedStatus,
    selectedCategory,
    showBookmarkedOnly,
  ]);

  useEffect(() => {
    const next = filtersToSearchParams({
      searchTerm,
      difficulty: selectedDifficulty,
      questionType: selectedQuestionType,
      language: selectedLanguage,
      company: selectedCompany,
      status: selectedStatus,
      category: selectedCategory,
      bookmarkedOnly: showBookmarkedOnly,
    });

    if (next.toString() !== searchParams.toString()) {
      suppressUrlSync.current = true;
      setSearchParams(next, { replace: true });
    }
  }, [
    searchParams,
    setSearchParams,
    searchTerm,
    selectedDifficulty,
    selectedQuestionType,
    selectedLanguage,
    selectedCompany,
    selectedStatus,
    selectedCategory,
    showBookmarkedOnly,
  ]);

  useEffect(() => {
    if (suppressUrlSync.current) {
      suppressUrlSync.current = false;
      return;
    }

    const parsed = parseFilterSearchParams(
      searchParams.toString(),
    );

    setSearchTerm(parsed.searchTerm);
    setSelectedDifficulty(parsed.difficulty);
    setSelectedQuestionType(parsed.questionType);
    setSelectedLanguage(parsed.language);
    setSelectedCompany(parsed.company);
    setSelectedStatus(parsed.status);
    setSelectedCategory(parsed.category);
    setShowBookmarkedOnly(parsed.bookmarkedOnly);
  }, [searchParams]);

  const discoverySearch = useMemo(
    () =>
      filtersToSearchParams({
        searchTerm,
        difficulty: selectedDifficulty,
        questionType: selectedQuestionType,
        language: selectedLanguage,
        company: selectedCompany,
        status: selectedStatus,
        category: selectedCategory,
        bookmarkedOnly: showBookmarkedOnly,
      }).toString(),
    [
      searchTerm,
      selectedDifficulty,
      selectedQuestionType,
      selectedLanguage,
      selectedCompany,
      selectedStatus,
      selectedCategory,
      showBookmarkedOnly,
    ],
  );

  useEffect(() => {
    const state = location.state as {
      openPracticeSetup?: boolean;
    } | null;

    if (state?.openPracticeSetup) {
      setPracticeSource("filtered");
      navigate(
        location.pathname + location.search,
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        allQuestions.map(
          (question) => question.difficulty,
        ),
      ),
    ),
  ];

  const questionTypes = [
    "All",
    ...Array.from(
      new Set(
        allQuestions.map(
          (question) => question.questionType,
        ),
      ),
    ),
  ];

  const languages = [
    "All",
    ...Array.from(
      new Set(
        allQuestions.flatMap(
          (question) => question.languages,
        ),
      ),
    ),
  ];

  const companies = [
    "All",
    ...Array.from(
      new Set(
        allQuestions.flatMap(
          (question) => question.companies,
        ),
      ),
    ),
  ];

  const statuses = ["All", "Solved", "Unsolved"];

  const categories = [
    "All",
    ...Array.from(
      new Set(
        allQuestions
          .map((question) => question.category)
          .filter(
            (category) => category.trim() !== "",
          ),
      ),
    ).sort((a, b) => a.localeCompare(b)),
  ];

  const filteredQuestions = useMemo(
    () =>
      filterQuestions(
        allQuestions,
        {
          searchTerm,
          difficulty: selectedDifficulty,
          questionType: selectedQuestionType,
          language: selectedLanguage,
          company: selectedCompany,
          status: selectedStatus,
          category: selectedCategory,
          bookmarkedOnly: showBookmarkedOnly,
        },
        solvedQuestionIds,
        bookmarkedQuestionIds,
      ),
    [
      allQuestions,
      searchTerm,
      selectedDifficulty,
      selectedQuestionType,
      selectedLanguage,
      selectedCompany,
      selectedStatus,
      selectedCategory,
      solvedQuestionIds,
      showBookmarkedOnly,
      bookmarkedQuestionIds,
    ],
  );

  const totalQuestions = allQuestions.length;

  // Canonical bookmarked collection in
  // Questions-page ordering, used as the source
  // set for bookmarked practice sessions.
  const bookmarkedQuestions = useMemo(
    () =>
      allQuestions.filter((question) =>
        bookmarkedQuestionIds.has(question.id),
      ),
    [allQuestions, bookmarkedQuestionIds],
  );

  // Question list + discovery context for the
  // currently open practice setup. Snapshots are
  // frozen at session start; later bookmark or
  // filter changes cannot mutate the session.
  const practiceQuestions =
    practiceSource === "bookmarked"
      ? bookmarkedQuestions
      : filteredQuestions;

  const practiceSearch =
    practiceSource === "bookmarked"
      ? BOOKMARKED_DISCOVERY_SEARCH
      : discoverySearch;

  const totalPages = Math.max(
    1,
    Math.ceil(filteredQuestions.length / PAGE_SIZE),
  );

  const safeCurrentPage = Math.min(
    Math.max(currentPage, 1),
    totalPages,
  );

  const paginatedQuestions = filteredQuestions.slice(
    (safeCurrentPage - 1) * PAGE_SIZE,
    safeCurrentPage * PAGE_SIZE,
  );

  const showPagination = filteredQuestions.length > PAGE_SIZE;

  const solvedQuestions = allQuestions.filter(
    (question) =>
      solvedQuestionIds.has(question.id),
  ).length;

  const easyQuestions = allQuestions.filter(
    (question) =>
      question.difficulty === "Easy",
  ).length;

  const mediumQuestions = allQuestions.filter(
    (question) =>
      question.difficulty === "Medium",
  ).length;

  const hardQuestions = allQuestions.filter(
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
    selectedStatus !== "All" ||
    selectedCategory !== "All";

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedDifficulty("All");
    setSelectedQuestionType("All");
    setSelectedLanguage("All");
    setSelectedCompany("All");
    setSelectedStatus("All");
    setSelectedCategory("All");
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

              if ("to" in item && item.to) {
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                  >
                    <Icon
                      size={17}
                      strokeWidth={1.8}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              }

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

            <div className="flex items-center gap-4">
              <div className="hidden sm:block">
                <div className="flex items-center justify-end gap-1.5 text-xs text-gray-500">
                  <span>
                    Solved {solvedQuestions} /{" "}
                    {totalQuestions}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-gray-700">
                    {completionPercentage}%
                  </span>
                </div>

                <div
                  className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-gray-100"
                  role="progressbar"
                  aria-valuenow={
                    completionPercentage
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Overall progress"
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${completionPercentage}%`,
                    }}
                  />
                </div>
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
            selectedCategory={selectedCategory}
            questionTypes={questionTypes}
            difficulties={difficulties}
            languages={languages}
            companies={companies}
            statuses={statuses}
            categories={categories}
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
            setSelectedCategory={
              setSelectedCategory
            }
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

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPracticeSource("filtered")
                      }
                      disabled={
                        filteredQuestions.length ===
                        0
                      }
                      className="flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-900"
                    >
                      <Play size={12} />
                      Start Practice
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPracticeSource(
                          "bookmarked",
                        )
                      }
                      disabled={
                        bookmarkedQuestions.length ===
                        0
                      }
                      title={
                        bookmarkedQuestions.length ===
                        0
                          ? "No bookmarked questions to practice."
                          : `Practice ${bookmarkedQuestions.length} bookmarked question${bookmarkedQuestions.length === 1 ? "" : "s"}`
                      }
                      className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                    >
                      <Star
                        size={12}
                        fill="currentColor"
                        className="text-amber-500"
                      />
                      Practice Bookmarked
                    </button>

                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                      {solvedQuestions} Solved
                    </span>
                  </div>
                </div>
              </div>

              {/* Questions */}
              <div className="space-y-4 p-5">
                {filteredQuestions.length > 0 ? (
                  <>
                    {paginatedQuestions.map(
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
                          discoverySearch={
                            discoverySearch
                          }
                        />
                      ),
                    )}

                    {showPagination && (
                      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentPage(
                              (previous) =>
                                Math.max(
                                  previous - 1,
                                  1,
                                ),
                            )
                          }
                          disabled={
                            safeCurrentPage <= 1
                          }
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                        >
                          <ChevronLeft size={16} />
                          Previous
                        </button>

                        <span className="text-xs text-gray-500">
                          Page{" "}
                          {safeCurrentPage} of{" "}
                          {totalPages}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setCurrentPage(
                              (previous) =>
                                Math.min(
                                  previous + 1,
                                  totalPages,
                                ),
                            )
                          }
                          disabled={
                            safeCurrentPage >=
                            totalPages
                          }
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                        >
                          Next
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </>
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

      {practiceSource !== null &&
        practiceQuestions.length > 0 && (
          <PracticeSetupModal
            availableCount={
              practiceQuestions.length
            }
            onClose={() =>
              setPracticeSource(null)
            }
            onStart={(size, mode) => {
              const selectedIds =
                selectSessionQuestionIds(
                  practiceQuestions.map(
                    (question) =>
                      question.id,
                  ),
                  size,
                  mode,
                );

              const session =
                createPracticeSession(
                  selectedIds,
                  practiceSearch,
                  practiceQuestions.length,
                  mode,
                );

              setPracticeSource(null);

              if (session) {
                navigate("/practice");
              }
            }}
          />
        )}
    </div>
  );
}

export default App;