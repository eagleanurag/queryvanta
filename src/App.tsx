import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Code2,
  FolderKanban,
  Home,
  Settings,
  Star,
  Target,
} from "lucide-react";

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
          {/* Search */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 flex-1 items-center rounded-lg border border-gray-200 bg-gray-50 px-4">
                <span className="text-sm text-gray-400">
                  Search questions...
                </span>
              </div>

              <button className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                Grouped Questions
              </button>
            </div>

            {/* Filters */}
            <div className="mt-4 flex flex-wrap gap-3">
              {[
                "All Questions",
                "Question Type",
                "Difficulty",
                "Language",
                "Company",
              ].map((filter) => (
                <button
                  key={filter}
                  className="flex min-w-[145px] items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
                >
                  {filter}
                  <ChevronDown size={15} />
                </button>
              ))}
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
                      Interactive Data Engineering problems
                    </p>
                  </div>

                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                    0 Solved
                  </span>
                </div>
              </div>

              {/* Temporary question preview */}
              <div className="p-5">
                <div className="rounded-lg border border-gray-100 p-5 transition hover:border-gray-200 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">
                          Easy
                        </span>

                        <span className="text-xs text-gray-400">
                          Filtering
                        </span>
                      </div>

                      <h3 className="mt-3 text-[15px] font-semibold text-gray-900">
                        High-Engagement Video Filtering
                      </h3>

                      <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                        Filter recent videos with more than 1 million views
                        and sort them by duration.
                      </p>
                    </div>

                    <button className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                      <Star size={18} />
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      PostgreSQL
                    </span>

                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      WHERE
                    </span>

                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      ORDER BY
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Progress */}
            <aside className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-gray-900">Your Progress</h2>

              <div className="mt-6 flex items-center justify-center">
                <div className="flex h-40 w-40 items-center justify-center rounded-full border-[14px] border-gray-100">
                  <div className="text-center">
                    <div className="text-3xl font-semibold text-gray-900">
                      0
                    </div>
                    <div className="text-xs text-gray-400">Solved</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-semibold text-emerald-500">
                    0
                  </div>
                  <div className="text-[11px] text-gray-400">Easy</div>
                </div>

                <div>
                  <div className="text-lg font-semibold text-amber-500">
                    0
                  </div>
                  <div className="text-[11px] text-gray-400">Medium</div>
                </div>

                <div>
                  <div className="text-lg font-semibold text-red-400">
                    0
                  </div>
                  <div className="text-[11px] text-gray-400">Hard</div>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Total Questions</span>
                  <span className="font-medium text-gray-900">1</span>
                </div>

                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Completed</span>
                  <span className="font-medium text-gray-900">0%</span>
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