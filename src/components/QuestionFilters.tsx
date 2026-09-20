import { Filter, Search, X } from "lucide-react";

type QuestionFiltersProps = {
  searchTerm: string;
  selectedQuestionType: string;
  selectedDifficulty: string;
  selectedLanguage: string;
  selectedCompany: string;
  questionTypes: string[];
  difficulties: string[];
  languages: string[];
  companies: string[];
  hasActiveFilters: boolean;
  setSearchTerm: (value: string) => void;
  setSelectedQuestionType: (value: string) => void;
  setSelectedDifficulty: (value: string) => void;
  setSelectedLanguage: (value: string) => void;
  setSelectedCompany: (value: string) => void;
  clearFilters: () => void;
};

function QuestionFilters({
  searchTerm,
  selectedQuestionType,
  selectedDifficulty,
  selectedLanguage,
  selectedCompany,
  questionTypes,
  difficulties,
  languages,
  companies,
  hasActiveFilters,
  setSearchTerm,
  setSelectedQuestionType,
  setSelectedDifficulty,
  setSelectedLanguage,
  setSelectedCompany,
  clearFilters,
}: QuestionFiltersProps) {
  return (
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
              setSearchTerm(
                event.target.value,
              )
            }
            placeholder="Search questions..."
            className="h-full flex-1 bg-transparent px-3 text-sm text-gray-700 outline-none placeholder:text-gray-400"
          />

          {searchTerm && (
            <button
              onClick={() =>
                setSearchTerm("")
              }
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
            setSelectedQuestionType(
              event.target.value,
            )
          }
          className="min-w-[155px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
        >
          <option value="All">
            All Question Types
          </option>

          {questionTypes
            .filter(
              (type) => type !== "All",
            )
            .map((type) => (
              <option
                key={type}
                value={type}
              >
                {type}
              </option>
            ))}
        </select>

        {/* Difficulty */}
        <select
          value={selectedDifficulty}
          onChange={(event) =>
            setSelectedDifficulty(
              event.target.value,
            )
          }
          className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
        >
          <option value="All">
            All Difficulties
          </option>

          {difficulties
            .filter(
              (difficulty) =>
                difficulty !== "All",
            )
            .map((difficulty) => (
              <option
                key={difficulty}
                value={difficulty}
              >
                {difficulty}
              </option>
            ))}
        </select>

        {/* Language */}
        <select
          value={selectedLanguage}
          onChange={(event) =>
            setSelectedLanguage(
              event.target.value,
            )
          }
          className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
        >
          <option value="All">
            All Languages
          </option>

          {languages
            .filter(
              (language) =>
                language !== "All",
            )
            .map((language) => (
              <option
                key={language}
                value={language}
              >
                {language}
              </option>
            ))}
        </select>

        {/* Company */}
        <select
          value={selectedCompany}
          onChange={(event) =>
            setSelectedCompany(
              event.target.value,
            )
          }
          className="min-w-[145px] cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 outline-none hover:bg-gray-50"
        >
          <option value="All">
            All Companies
          </option>

          {companies
            .filter(
              (company) =>
                company !== "All",
            )
            .map((company) => (
              <option
                key={company}
                value={company}
              >
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
  );
}

export default QuestionFilters;
