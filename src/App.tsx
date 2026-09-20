import { useMemo, useState } from "react";

import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Code2,
  Filter,
  FolderKanban,
  Home,
  Search,
  Settings,
  Star,
  Target,
  X,
} from "lucide-react";

import { questions } from "./data/questions";

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
  const [selectedDifficulty, setSelectedDifficulty] = useState("All");
  const [selectedQuestionType, setSelectedQuestionType] = useState("All");
  const [selectedLanguage, setSelectedLanguage] = useState("All");
  const [selectedCompany, setSelectedCompany] = useState("All");

  const difficulties = [
    "All",
    ...Array.from(new Set(questions.map((question) => question.difficulty))),
  ];

  const questionTypes = [
    "All",
    ...Array.from(
      new Set(questions.map((question) => question.questionType)),
    ),
  ];

  const languages = [
    "All",
    ...Array.from(
      new Set(
        questions.flatMap((question) => question.languages),
      ),
    ),
  ];

  const companies = [
    "All",
    ...Array.from(
      new Set(
        questions.flatMap((question) => question.companies),
      ),
    ),
  ];

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return questions.filter((question) => {
      const matchesSearch =
        normalizedSearch === "" ||
        question.title.toLowerCase().includes(normalizedSearch) ||
        question.description.toLowerCase().includes(normalizedSearch) ||
        question.category.toLowerCase().includes(normalizedSearch) ||
        question.tags.some((tag) =>
          tag.toLowerCase().includes(normalizedSearch),
        );

      const matchesDifficulty =
        selectedDifficulty === "All" ||
        question.difficulty === selectedDifficulty;

      const matchesQuestionType =
        selectedQuestionType === "All" ||
        question.questionType === selectedQuestionType;

      const matchesLanguage =
        selectedLanguage === "All" ||
        question.languages.includes(selectedLanguage);

      const matchesCompany =
        selectedCompany === "All" ||
        question.companies.includes(selectedCompany);

      return (
        matchesSearch &&
        matchesDifficulty &&
        matchesQuestionType &&
        matchesLanguage &&
        matchesCompany
      );
    });
  }, [
    searchTerm,
    selectedDifficulty,
    selectedQuestionType,
    selectedLanguage,
    selectedCompany,
  ]);

  const totalQuestions = questions.length;

  const solvedQuestions = questions.filter(
    (question) => question.solved,
  ).length;

  const easyQuestions = questions.filter(
    (question) => question.difficulty === "Easy",
  ).length;

  const mediumQuestions = questions.filter(
    (question) => question.difficulty === "Medium",
  ).length;

  const hardQuestions = questions.filter(
    (question) => question.difficulty === "Hard",
  ).length;

  const completionPercentage =
    totalQuestions === 0
      ? 0
      : Math.round((solvedQuestions / totalQuestions) * 100);

  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    selectedDifficulty !== "All" ||
    selectedQuestionType !== "All" ||
    selectedLanguage !== "All" ||
    selectedCompany !== "All";

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedDifficulty("All");
    setSelectedQuestionType("All");
    setSelectedLanguage("All");
    setSelectedCompany("All");
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
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            {/* Practice */}
            <div className="mt-3">
              <button className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-gray-800">
                <span className="flex items-center gap-3">
                  <Code2 size={17} strokeWidth={1.8} />
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
                      <Icon size={15} strokeWidth={1.8} />
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
              <Settings size={17} strokeWidth={1.8} />
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

            <button className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm hover:bg-gray-50">
              <Star size={16} />
              Bookmarks
            </button>
          </div>
        </header>

        {/* Page */}
        <div className="p-8">
          {/* Search + Filters */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {/* Search */}
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 flex-1 items-center rounded-lg border border-gray-200 bg-gray-50">
                <Search
                  size={17}
                  className="ml-4 text-gray-400"
                />

                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) =>
                    setSearchTerm(event.target.value)
                  }
                  placeholder="Search questions..."
                  className="h-full flex-1 bg-transparent px-3 text-sm text-gray-700 outline-none placeholder:text-gray-400"
                />

                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="mr-2 rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    aria-label="Clear search"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                <Filter size={15} />
                Grouped Questions
              </button>
            </div>

            {/* Filters */}
            <div className="mt-4 flex flex-wrap gap-3">
              {/* Question Type */}
              <select
                value={selectedQuestionType}
                onChange={(event) =>
                  setSelectedQuestionType(event.target.value)
                }
                className="min-w-[155px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
              >
                <option value="All">All Question Types</option>

                {questionTypes
                  .filter((type) => type !== "All")
                  .map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
              </select>

              {/* Difficulty */}
              <select
                value={selectedDifficulty}
                onChange={(event) =>
                  setSelectedDifficulty(event.target.value)
                }
                className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
              >
                <option value="All">All Difficulties</option>

                {difficulties
                  .filter((difficulty) => difficulty !== "All")
                  .map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {difficulty}
                    </option>
                  ))}
              </select>

              {/* Language */}
              <select
                value={selectedLanguage}
                onChange={(event) =>
                  setSelectedLanguage(event.target.value)
                }
                className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
              >
                <option value="All">All Languages</option>

                {languages
                  .filter((language) => language !== "All")
                  .map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
              </select>

              {/* Company */}
              <select
                value={selectedCompany}
                onChange={(event) =>
                  setSelectedCompany(event.target.value)
                }
                className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
              >
                <option value="All">All Companies</option>

                {companies
                  .filter((company) => company !== "All")
                  .map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
              </select>

              {/* Clear */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                >
                  <X size={15} />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Content grid */}
          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            {/* Question area */}
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      Questions
                    </h2>

                    <p className="mt-1 text-xs text-gray-500">
                      Showing {filteredQuestions.length} of{" "}
                      {totalQuestions} questions
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
                  filteredQuestions.map((question) => (
                    <div
                      key={question.id}
                      className="rounded-lg border border-gray-100 p-5 transition hover:border-gray-200 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          {/* Difficulty + type + category */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-md px-2 py-1 text-xs font-medium ${
                                question.difficulty === "Easy"
                                  ? "bg-emerald-50 text-emerald-600"
                                  : question.difficulty === "Medium"
                                    ? "bg-amber-50 text-amber-600"
                                    : "bg-red-50 text-red-500"
                              }`}
                            >
                              {question.difficulty}
                            </span>

                            <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                              {question.questionType}
                            </span>

                            <span className="text-xs text-gray-400">
                              {question.category}
                            </span>
                          </div>

                          {/* Title */}
                          <h3 className="mt-3 text-[15px] font-semibold text-gray-900">
                            {question.title}
                          </h3>

                          {/* Description */}
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                            {question.description}
                          </p>
                        </div>

                        {/* Bookmark */}
                        <button className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                          <Star size={18} />
                        </button>
                      </div>

                      {/* Tags */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {question.languages.map((language) => (
                          <span
                            key={language}
                            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
                          >
                            {language}
                          </span>
                        ))}

                        {question.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
                          >
                            {tag}
                          </span>
                        ))}

                        {question.companies.map((company) => (
                          <span
                            key={company}
                            className="rounded-md bg-purple-50 px-2 py-1 text-xs text-purple-600"
                          >
                            {company}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
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