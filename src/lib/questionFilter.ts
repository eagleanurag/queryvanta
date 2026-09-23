import type { Question } from "../data/questions";

export type DiscoveryFilters = {
  searchTerm: string;
  difficulty: string;
  questionType: string;
  language: string;
  company: string;
  status: string;
  category: string;
  bookmarkedOnly: boolean;
};

export const DEFAULT_FILTERS: DiscoveryFilters = {
  searchTerm: "",
  difficulty: "All",
  questionType: "All",
  language: "All",
  company: "All",
  status: "All",
  category: "All",
  bookmarkedOnly: false,
};

const PARAM_KEYS = [
  "q",
  "difficulty",
  "type",
  "language",
  "company",
  "status",
  "category",
  "bookmarked",
] as const;

export function hasDiscoveryParams(
  search: string,
): boolean {
  const params = new URLSearchParams(search);

  return PARAM_KEYS.some(
    (key) => params.get(key) !== null,
  );
}

export function parseFilterSearchParams(
  search: string,
): DiscoveryFilters {
  const params = new URLSearchParams(search);

  return {
    searchTerm: params.get("q") ?? "",
    difficulty: params.get("difficulty") ?? "All",
    questionType: params.get("type") ?? "All",
    language: params.get("language") ?? "All",
    company: params.get("company") ?? "All",
    status: params.get("status") ?? "All",
    category: params.get("category") ?? "All",
    bookmarkedOnly: params.get("bookmarked") === "1",
  };
}

export function filtersToSearchParams(
  filters: DiscoveryFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.searchTerm.trim() !== "") {
    params.set("q", filters.searchTerm.trim());
  }

  if (filters.difficulty !== "All") {
    params.set("difficulty", filters.difficulty);
  }

  if (filters.questionType !== "All") {
    params.set("type", filters.questionType);
  }

  if (filters.language !== "All") {
    params.set("language", filters.language);
  }

  if (filters.company !== "All") {
    params.set("company", filters.company);
  }

  if (filters.status !== "All") {
    params.set("status", filters.status);
  }

  if (filters.category !== "All") {
    params.set("category", filters.category);
  }

  if (filters.bookmarkedOnly) {
    params.set("bookmarked", "1");
  }

  return params;
}

export function filterQuestions(
  allQuestions: Question[],
  filters: DiscoveryFilters,
  solvedIds: Set<string>,
  bookmarkedIds: Set<string>,
): Question[] {
  const normalizedSearch =
    filters.searchTerm.trim().toLowerCase();

  return allQuestions.filter((question) => {
    const matchesBookmark =
      !filters.bookmarkedOnly ||
      bookmarkedIds.has(question.id);

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
      filters.difficulty === "All" ||
      question.difficulty === filters.difficulty;

    const matchesQuestionType =
      filters.questionType === "All" ||
      question.questionType ===
        filters.questionType;

    const matchesLanguage =
      filters.language === "All" ||
      question.languages.includes(filters.language);

    const matchesCompany =
      filters.company === "All" ||
      question.companies.includes(filters.company);

    const matchesStatus =
      filters.status === "All" ||
      (filters.status === "Solved"
        ? solvedIds.has(question.id)
        : !solvedIds.has(question.id));

    const matchesCategory =
      filters.category === "All" ||
      question.category === filters.category;

    return (
      matchesBookmark &&
      matchesSearch &&
      matchesDifficulty &&
      matchesQuestionType &&
      matchesLanguage &&
      matchesCompany &&
      matchesStatus &&
      matchesCategory
    );
  });
}
