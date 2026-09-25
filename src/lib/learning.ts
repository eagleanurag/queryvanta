import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  NavigateFunction,
} from "react-router-dom";

import {
  questions,
  type Difficulty,
  type Question,
  type QuestionType,
} from "../data/questions";
import {
  ADMIN_QUESTIONS_EVENT,
  combineQuestionCatalogs,
  getAdminQuestions,
  isQuestionEnabled,
} from "./adminQuestions";
import {
  createPracticeSession,
  selectSessionQuestionIds,
} from "./practiceSession";
import type {
  PracticeSelectionMode,
  PracticeSessionOrigin,
} from "./practiceSession";

export { selectSessionQuestionIds };
import {
  DEFAULT_FILTERS,
  filterQuestions,
} from "./questionFilter";
import type { DiscoveryFilters } from "./questionFilter";

export type { PracticeSelectionMode };

export type StageMatch = {
  questionTypes?: QuestionType[];
  categories?: string[];
  difficulties?: Difficulty[];
};

export type LearningStage = {
  id: string;
  title: string;
  description: string;
  match: StageMatch;
  size: number;
};

export type LearningPath = {
  id: string;
  title: string;
  description: string;
  icon: string;
  stages: LearningStage[];
};

export type TopicProfile = {
  id: string;
  name: string;
  total: number;
  completed: number;
  rate: number;
  byDifficulty: Record<Difficulty, number>;
};

export type WeakArea = {
  category: string;
  attempted: number;
  completed: number;
  remaining: string[];
  rate: number;
  attemptEvents: number;
  explanation: string;
};

export type PracticePreset = {
  id: string;
  label: string;
  description: string;
  size: number;
  mode: PracticeSelectionMode;
  filters: Partial<DiscoveryFilters>;
};

export type InterviewPreset = {
  id: string;
  label: string;
  description: string;
  size: number;
  filters: Partial<DiscoveryFilters>;
  difficulties?: Difficulty[];
};

export const INTERVIEW_DURATIONS = [
  15, 30, 45, 60,
] as const;

export const INTERVIEW_SIZES = [
  5, 10, 15, 20,
] as const;

export const MIN_WEAK_ATTEMPTED_QUESTIONS = 2;
export const MAX_WEAK_AREAS = 6;
export const WEAK_PRACTICE_SIZE = 10;

function matchesStage(
  question: Question,
  match: StageMatch,
): boolean {
  if (
    match.questionTypes !== undefined &&
    match.questionTypes.length > 0 &&
    !match.questionTypes.includes(
      question.questionType,
    )
  ) {
    return false;
  }

  if (
    match.categories !== undefined &&
    match.categories.length > 0 &&
    !match.categories.includes(question.category)
  ) {
    return false;
  }

  if (
    match.difficulties !== undefined &&
    match.difficulties.length > 0 &&
    !match.difficulties.includes(
      question.difficulty,
    )
  ) {
    return false;
  }

  return true;
}

export function resolveStageQuestions(
  catalog: Question[],
  match: StageMatch,
): Question[] {
  return catalog.filter((question) =>
    matchesStage(question, match),
  );
}

export function getPathPool(
  catalog: Question[],
  path: LearningPath,
): Question[] {
  const seen = new Set<string>();
  const pool: Question[] = [];

  for (const stage of path.stages) {
    for (const question of resolveStageQuestions(
      catalog,
      stage.match,
    )) {
      if (!seen.has(question.id)) {
        seen.add(question.id);
        pool.push(question);
      }
    }
  }

  return pool;
}

export function getPathProgress(
  poolIds: string[],
  solvedIds: Set<string>,
): {
  completed: number;
  total: number;
  rate: number;
} {
  const completed = poolIds.filter((id) =>
    solvedIds.has(id),
  ).length;
  const total = poolIds.length;

  return {
    completed,
    total,
    rate:
      total === 0
        ? 0
        : Math.round((completed / total) * 100),
  };
}

export const LEARNING_PATHS: LearningPath[] = [
  {
    id: "sql-foundations",
    title: "SQL Foundations",
    description:
      "Core SQL patterns: filtering, aggregation, joins and window basics.",
    icon: "Database",
    stages: [
      {
        id: "filtering-aggregation",
        title: "Filtering & Aggregation",
        description:
          "WHERE clauses, GROUP BY and aggregate functions.",
        match: {
          questionTypes: ["SQL"],
          categories: [
            "Filtering",
            "Aggregation",
            "Conditional Aggregation",
          ],
        },
        size: 5,
      },
      {
        id: "joins-subqueries",
        title: "Joins & Subqueries",
        description:
          "Combining tables with joins, self joins, subqueries and CTEs.",
        match: {
          questionTypes: ["SQL"],
          categories: [
            "Joins",
            "Self Join",
            "Subqueries",
            "CTEs",
          ],
        },
        size: 5,
      },
      {
        id: "window-ranking",
        title: "Windows & Ranking",
        description:
          "Window functions, ranking and Top-N queries.",
        match: {
          questionTypes: ["SQL"],
          categories: [
            "Window Functions",
            "Ranking",
            "Top-N",
          ],
        },
        size: 5,
      },
      {
        id: "data-quality",
        title: "Data Quality",
        description:
          "Cleaning, deduplication, NULL handling and date logic.",
        match: {
          questionTypes: ["SQL"],
          categories: [
            "Data Quality",
            "Duplicates",
            "NULL Handling",
            "Date Filtering",
            "Date Operations",
            "Conditional Logic",
            "Data Cleaning",
          ],
        },
        size: 5,
      },
    ],
  },
  {
    id: "sql-advanced",
    title: "SQL Advanced Practice",
    description:
      "Medium and hard SQL across the full category range.",
    icon: "Brain",
    stages: [
      {
        id: "medium-core",
        title: "Medium Core",
        description:
          "Intermediate SQL spanning joins, windows and aggregation.",
        match: {
          questionTypes: ["SQL"],
          difficulties: ["Medium"],
        },
        size: 8,
      },
      {
        id: "hard-challenges",
        title: "Hard Challenges",
        description:
          "The toughest SQL questions in the catalog.",
        match: {
          questionTypes: ["SQL"],
          difficulties: ["Hard"],
        },
        size: 5,
      },
    ],
  },
  {
    id: "pyspark-foundations",
    title: "PySpark Foundations",
    description:
      "Easy PySpark transforms to build Spark confidence.",
    icon: "Sparkles",
    stages: [
      {
        id: "easy-start",
        title: "Easy Start",
        description:
          "Entry-level PySpark questions with guided patterns.",
        match: {
          questionTypes: ["PySpark"],
          difficulties: ["Easy"],
        },
        size: 3,
      },
      {
        id: "core-transforms",
        title: "Core Transforms",
        description:
          "Aggregation, cleaning and data quality transforms.",
        match: {
          questionTypes: ["PySpark"],
          categories: [
            "Aggregation",
            "Data Cleaning",
            "Data Quality",
          ],
        },
        size: 5,
      },
      {
        id: "windows-joins",
        title: "Windows & Joins",
        description:
          "Window functions, joins and conditional logic in Spark.",
        match: {
          questionTypes: ["PySpark"],
          categories: [
            "Window Functions",
            "Joins",
            "Conditional Logic",
          ],
        },
        size: 5,
      },
    ],
  },
  {
    id: "pyspark-advanced",
    title: "PySpark Advanced Practice",
    description:
      "Medium and hard PySpark for production-ready skills.",
    icon: "Zap",
    stages: [
      {
        id: "medium-pyspark",
        title: "Medium PySpark",
        description:
          "Intermediate distributed transforms.",
        match: {
          questionTypes: ["PySpark"],
          difficulties: ["Medium"],
        },
        size: 4,
      },
      {
        id: "hard-pyspark",
        title: "Hard PySpark",
        description:
          "Complex pipelines and advanced patterns.",
        match: {
          questionTypes: ["PySpark"],
          difficulties: ["Hard"],
        },
        size: 4,
      },
    ],
  },
  {
    id: "data-engineering-core",
    title: "Data Engineering Core",
    description:
      "End-to-end pipeline skills: quality, cleaning, transforms and orchestration concepts.",
    icon: "Target",
    stages: [
      {
        id: "pipeline-foundations",
        title: "Pipeline Foundations",
        description:
          "Data quality, cleaning, deduplication and pipeline-shaped questions.",
        match: {
          categories: [
            "Data Engineering",
            "Data Quality",
            "Data Cleaning",
            "Duplicates",
          ],
        },
        size: 5,
      },
      {
        id: "transformations",
        title: "Transformations",
        description:
          "Aggregation, joins and conditional logic across SQL and PySpark.",
        match: {
          categories: [
            "Aggregation",
            "Conditional Aggregation",
            "Joins",
            "Conditional Logic",
          ],
        },
        size: 8,
      },
      {
        id: "production-pipelines",
        title: "Production Pipelines",
        description:
          "Medium and hard questions spanning windows, CTEs and subqueries.",
        match: {
          categories: [
            "Window Functions",
            "CTEs",
            "Subqueries",
            "Ranking",
          ],
        },
        size: 8,
      },
    ],
  },
  {
    id: "interview-prep",
    title: "Interview Preparation",
    description:
      "Mixed medium and hard questions under realistic pressure.",
    icon: "Briefcase",
    stages: [
      {
        id: "sql-pressure",
        title: "SQL Under Pressure",
        description:
          "Medium and hard SQL, interview style.",
        match: {
          questionTypes: ["SQL"],
          difficulties: ["Medium", "Hard"],
        },
        size: 5,
      },
      {
        id: "pyspark-pressure",
        title: "PySpark Under Pressure",
        description:
          "Medium and hard PySpark, interview style.",
        match: {
          questionTypes: ["PySpark"],
          difficulties: ["Medium", "Hard"],
        },
        size: 5,
      },
      {
        id: "mixed-bag",
        title: "Mixed Bag",
        description:
          "A cross-topic mix across types and difficulties.",
        match: {
          difficulties: ["Medium", "Hard"],
        },
        size: 10,
      },
    ],
  },
];

export function getLearningPath(
  pathId: string | undefined,
): LearningPath | null {
  if (!pathId) {
    return null;
  }

  return (
    LEARNING_PATHS.find(
      (path) => path.id === pathId,
    ) ?? null
  );
}

export function slugifyTopic(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTopics(
  catalog: Question[],
  solvedIds: Set<string>,
): TopicProfile[] {
  const byName = new Map<string, TopicProfile>();

  for (const question of catalog) {
    const name = question.category.trim();

    if (name === "") {
      continue;
    }

    let profile = byName.get(name);

    if (!profile) {
      profile = {
        id: slugifyTopic(name),
        name,
        total: 0,
        completed: 0,
        rate: 0,
        byDifficulty: {
          Easy: 0,
          Medium: 0,
          Hard: 0,
        },
      };
      byName.set(name, profile);
    }

    profile.total += 1;
    profile.byDifficulty[question.difficulty] += 1;

    if (solvedIds.has(question.id)) {
      profile.completed += 1;
    }
  }

  const topics = [...byName.values()];

  for (const topic of topics) {
    topic.rate =
      topic.total === 0
        ? 0
        : Math.round(
            (topic.completed / topic.total) * 100,
          );
  }

  topics.sort(
    (a, b) =>
      b.total - a.total ||
      a.name.localeCompare(b.name),
  );

  return topics;
}

export function getTopic(
  catalog: Question[],
  solvedIds: Set<string>,
  topicId: string | undefined,
): (TopicProfile & { questions: Question[] }) | null {
  if (!topicId) {
    return null;
  }

  const topics = getTopics(catalog, solvedIds);
  const topic = topics.find(
    (item) => item.id === topicId,
  );

  if (!topic) {
    return null;
  }

  return {
    ...topic,
    questions: catalog.filter(
      (question) =>
        slugifyTopic(question.category) ===
        topicId,
    ),
  };
}

export function getWeakAreas(
  catalog: Question[],
  solvedIds: Set<string>,
  attemptsByQuestion: Record<string, number>,
): WeakArea[] {
  const byCategory = new Map<
    string,
    {
      attempted: Set<string>;
      completed: number;
      remaining: string[];
      attemptEvents: number;
      total: number;
    }
  >();

  for (const question of catalog) {
    const name = question.category.trim();

    if (name === "") {
      continue;
    }

    let bucket = byCategory.get(name);

    if (!bucket) {
      bucket = {
        attempted: new Set<string>(),
        completed: 0,
        remaining: [],
        attemptEvents: 0,
        total: 0,
      };
      byCategory.set(name, bucket);
    }

    bucket.total += 1;
    const events =
      attemptsByQuestion[question.id] ?? 0;
    bucket.attemptEvents += events;

    const isSolved = solvedIds.has(question.id);

    if (isSolved || events > 0) {
      bucket.attempted.add(question.id);
    }

    if (isSolved) {
      bucket.completed += 1;
    } else {
      bucket.remaining.push(question.id);
    }
  }

  const areas: WeakArea[] = [];

  for (const [category, bucket] of byCategory) {
    if (
      bucket.attempted.size <
        MIN_WEAK_ATTEMPTED_QUESTIONS ||
      bucket.completed >= bucket.attempted.size
    ) {
      continue;
    }

    const attempted = bucket.attempted.size;
    const rate = Math.round(
      (bucket.completed / attempted) * 100,
    );

    areas.push({
      category,
      attempted,
      completed: bucket.completed,
      remaining: bucket.remaining,
      rate,
      attemptEvents: bucket.attemptEvents,
      explanation: `${bucket.completed} of ${attempted} attempted completed`,
    });
  }

  areas.sort(
    (a, b) =>
      a.rate - b.rate ||
      b.remaining.length - a.remaining.length ||
      a.category.localeCompare(b.category),
  );

  return areas.slice(0, MAX_WEAK_AREAS);
}

export type PresetFilters = {
  questionType?: string;
  difficulty?: string;
  bookmarkedOnly?: boolean;
};

export const PRACTICE_PRESETS: PracticePreset[] = [
  {
    id: "quick-5",
    label: "Quick 5",
    description: "Five questions, sequential order.",
    size: 5,
    mode: "sequential",
    filters: {},
  },
  {
    id: "core-10",
    label: "Core 10",
    description: "Ten questions, sequential order.",
    size: 10,
    mode: "sequential",
    filters: {},
  },
  {
    id: "deep-20",
    label: "Deep 20",
    description: "Twenty questions, sequential order.",
    size: 20,
    mode: "sequential",
    filters: {},
  },
  {
    id: "sql-focus",
    label: "SQL Focus",
    description: "Ten SQL questions.",
    size: 10,
    mode: "sequential",
    filters: { questionType: "SQL" },
  },
  {
    id: "pyspark-focus",
    label: "PySpark Focus",
    description: "Ten PySpark questions.",
    size: 10,
    mode: "sequential",
    filters: { questionType: "PySpark" },
  },
  {
    id: "mixed-de",
    label: "Mixed Practice",
    description:
      "Ten shuffled questions across SQL and PySpark.",
    size: 10,
    mode: "random",
    filters: {},
  },
  {
    id: "interview-warmup",
    label: "Interview Warm-up",
    description:
      "Five medium and hard questions.",
    size: 5,
    mode: "sequential",
    filters: { difficulty: "Medium" },
  },
];

function resolvePresetQuestions(
  catalog: Question[],
  solvedIds: Set<string>,
  bookmarkedIds: Set<string>,
  preset: PracticePreset,
): Question[] {
  return filterQuestions(
    catalog,
    {
      ...DEFAULT_FILTERS,
      questionType:
        preset.filters.questionType ?? "All",
      difficulty:
        preset.filters.difficulty ?? "All",
      bookmarkedOnly:
        preset.filters.bookmarkedOnly ?? false,
    },
    solvedIds,
    bookmarkedIds,
  );
}

export function getPresetAvailability(
  catalog: Question[],
  solvedIds: Set<string>,
  bookmarkedIds: Set<string>,
  preset: PracticePreset,
): number {
  return resolvePresetQuestions(
    catalog,
    solvedIds,
    bookmarkedIds,
    preset,
  ).length;
}

export const INTERVIEW_PRESETS: InterviewPreset[] = [
  {
    id: "sql-interview",
    label: "SQL Interview",
    description: "SQL questions across difficulties.",
    size: 10,
    filters: { questionType: "SQL" },
  },
  {
    id: "pyspark-interview",
    label: "PySpark Interview",
    description:
      "PySpark questions across difficulties.",
    size: 10,
    filters: { questionType: "PySpark" },
  },
  {
    id: "data-engineer-interview",
    label: "Data Engineer Interview",
    description:
      "Mixed SQL and PySpark, medium and hard.",
    size: 15,
    filters: {},
    difficulties: ["Medium", "Hard"],
  },
  {
    id: "mixed-technical-interview",
    label: "Mixed Technical Interview",
    description:
      "Shuffled mix across the catalog.",
    size: 10,
    filters: {},
  },
];

export type LaunchRequest = {
  questionIds: string[];
  launchSearch: string;
  availableCount: number;
  mode: PracticeSelectionMode;
  origin: PracticeSessionOrigin;
  originLabel?: string;
  originPath?: string;
  endsAt?: number;
  timeLimitSec?: number;
};

export function launchPracticeSession(
  navigate: NavigateFunction,
  request: LaunchRequest,
): boolean {
  const session = createPracticeSession(
    request.questionIds,
    request.launchSearch,
    request.availableCount,
    request.mode,
    {
      origin: request.origin,
      originLabel: request.originLabel,
      originPath: request.originPath,
      endsAt: request.endsAt,
      timeLimitSec: request.timeLimitSec,
    },
  );

  if (!session) {
    return false;
  }

  navigate("/practice");

  return true;
}

export function launchPresetSession(
  navigate: NavigateFunction,
  catalog: Question[],
  solvedIds: Set<string>,
  bookmarkedIds: Set<string>,
  preset: PracticePreset,
  origin: PracticeSessionOrigin,
  originPath: string,
): boolean {
  const pool = resolvePresetQuestions(
    catalog,
    solvedIds,
    bookmarkedIds,
    preset,
  );

  const selectedIds = selectSessionQuestionIds(
    pool.map((question) => question.id),
    preset.size,
    preset.mode,
  );

  if (selectedIds.length === 0) {
    return false;
  }

  return launchPracticeSession(navigate, {
    questionIds: selectedIds,
    launchSearch: "",
    availableCount: pool.length,
    mode: preset.mode,
    origin,
    originLabel: preset.label,
    originPath,
  });
}

export function useActiveCatalog(): Question[] {
  const [adminVersion, setAdminVersion] =
    useState(0);

  useEffect(() => {
    const syncAdminQuestions = () => {
      setAdminVersion(
        (version) => version + 1,
      );
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

  return useMemo(
    () =>
      combineQuestionCatalogs(
        questions,
        getAdminQuestions(),
      ).filter(isQuestionEnabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminVersion],
  );
}

export function formatCountdown(
  totalSeconds: number,
): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
