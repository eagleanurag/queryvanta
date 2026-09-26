import type {
  Difficulty,
  QuestionType,
} from "../data/questions.ts";

export type LandingMatcher = {
  questionTypes?: QuestionType[];
  categories?: string[];
  difficulties?: Difficulty[];
};

export type LandingSection = {
  heading: string;
  body: string[];
  bullets?: string[];
};

export type LandingPageDef = {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  h1: string;
  standfirst: string;
  intro: string[];
  matcher: LandingMatcher;
  execution: "sql" | "pyspark" | "mixed";
  sections: LandingSection[];
  learnPaths: { id: string; label: string }[];
  siblings: { slug: string; label: string }[];
};

export const LANDING_PAGES: LandingPageDef[] = [
  {
    slug: "sql-practice",
    navLabel: "SQL Practice",
    title:
      "Free SQL Practice Online with Real Browser Execution | QueryVanta",
    description:
      "Practice SQL online for free with browser-based PostgreSQL execution. Filter, aggregate, join and window-function questions with hints, solutions, learning paths and mock interviews.",
    h1: "Free SQL Practice Online",
    standfirst:
      "Solve real SQL problems directly in your browser — no setup, no account, no database to install.",
    intro: [
      "QueryVanta gives you SQL exercises you can run immediately. Every question ships with its own PostgreSQL dataset loaded in your browser, so you write queries against real tables and get validated results in seconds.",
      "Questions span filtering, aggregation, joins, subqueries, common table expressions, window functions, ranking, date logic and data-quality patterns, across easy, medium and hard difficulties.",
    ],
    matcher: { questionTypes: ["SQL"] },
    execution: "sql",
    sections: [
      {
        heading: "Who is SQL practice for?",
        body: [
          "Data analysts preparing SQL screens, data engineers keeping query skills sharp, students learning PostgreSQL, and anyone revising before a database interview will find questions at their level.",
        ],
        bullets: [
          "Data analysts: filtering, aggregation, conditional logic and date patterns",
          "Data engineers: joins, CTEs, subqueries and window functions",
          "Interview candidates: medium and hard problems under timed conditions",
        ],
      },
      {
        heading: "How SQL practice works on QueryVanta",
        body: [
          "Open a question to see the task, the schema explorer with sample tables, and a SQL editor preloaded with starter code. Run your query to see rows instantly; when the result matches the expected answer, the question is marked correct and solved.",
        ],
        bullets: [
          "PostgreSQL execution in the browser via PGlite — nothing to install",
          "Hints, complete solutions and explanations on every question",
          "Sequential or shuffled practice sessions with progress tracking",
          "Timed mock interviews using the same real execution path",
        ],
      },
      {
        heading: "What to practice next",
        body: [
          "Start with filtering and aggregation, move on to joins and subqueries, then tackle window functions and ranking. When you are comfortable, switch to interview mode for timed mixed-difficulty sessions.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "sql-foundations",
        label: "SQL Foundations",
      },
      {
        id: "sql-advanced",
        label: "SQL Advanced Practice",
      },
      {
        id: "interview-prep",
        label: "Interview Preparation",
      },
    ],
    siblings: [
      {
        slug: "sql-interview-prep",
        label: "SQL interview preparation",
      },
      {
        slug: "data-analyst-sql",
        label: "SQL for data analysts",
      },
      {
        slug: "data-engineering-practice",
        label: "Data Engineering practice",
      },
    ],
  },
  {
    slug: "pyspark-practice",
    navLabel: "PySpark Practice",
    title:
      "Free PySpark Practice Online with Real Spark Execution | QueryVanta",
    description:
      "Practice PySpark online with real Spark execution in the browser. DataFrame exercises on aggregation, joins, windows and cleaning, plus interview questions and learning paths.",
    h1: "Free PySpark Practice Online",
    standfirst:
      "Write PySpark against a real Spark engine without installing anything.",
    intro: [
      "QueryVanta runs your PySpark code on a real Spark 4.2.0 engine through Spark Connect, right from the browser. Each exercise asks you to build a `result` DataFrame; the platform collects it and validates it against the expected answer.",
      "Exercises cover group-by aggregations, joins, window functions, conditional logic, data cleaning and data-quality checks — the everyday vocabulary of Spark data work.",
    ],
    matcher: { questionTypes: ["PySpark"] },
    execution: "pyspark",
    sections: [
      {
        heading: "Who is PySpark practice for?",
        body: [
          "Aspiring data engineers learning the DataFrame API, analysts moving from SQL to Spark, and candidates preparing for PySpark interview loops with live coding.",
        ],
        bullets: [
          "Foundations: easy transforms that teach groupBy, filtering and column expressions",
          "Core work: aggregations, data cleaning and data-quality patterns",
          "Advanced: window functions, joins and multi-step pipelines",
        ],
      },
      {
        heading: "How PySpark practice works on QueryVanta",
        body: [
          "Each question provides starter code with the input DataFrames already built. You complete the transform, assign it to `result`, and run. First runs boot a Python worker (timed interviews account for this separately); subsequent runs reuse it.",
        ],
        bullets: [
          "Real Spark 4.2.0 execution via Spark Connect — not a simulation",
          "Structured validation of your `result` DataFrame",
          "Hints, solutions and explanations written for Spark idioms",
          "PySpark learning paths from foundations to advanced practice",
        ],
      },
      {
        heading: "What to practice next",
        body: [
          "Begin with the PySpark Foundations path, then move to advanced practice and timed PySpark interviews. Pair Spark work with SQL window-function practice — the concepts transfer directly.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "pyspark-foundations",
        label: "PySpark Foundations",
      },
      {
        id: "pyspark-advanced",
        label: "PySpark Advanced Practice",
      },
      {
        id: "interview-prep",
        label: "Interview Preparation",
      },
    ],
    siblings: [
      {
        slug: "pyspark-interview-prep",
        label: "PySpark interview preparation",
      },
      {
        slug: "big-data-practice",
        label: "Big Data practice",
      },
      {
        slug: "sql-practice",
        label: "SQL practice",
      },
    ],
  },
  {
    slug: "data-engineering-practice",
    navLabel: "Data Engineering Practice",
    title:
      "Data Engineering Practice Questions — SQL & PySpark | QueryVanta",
    description:
      "Practice practical Data Engineering questions with SQL and PySpark: pipelines, transforms, data quality and cleaning, with learning paths and mock interviews.",
    h1: "Data Engineering Practice Questions",
    standfirst:
      "Hands-on SQL and PySpark problems drawn from real pipeline work.",
    intro: [
      "Data engineering interviews and day-to-day work both come down to the same skills: reading messy data, transforming it correctly, and proving the result. QueryVanta collects practical problems across SQL and PySpark so you can drill exactly those skills.",
      "The catalog covers pipeline-shaped questions, data-quality checks, deduplication, cleaning, aggregation, joins and windowed transforms at easy, medium and hard levels.",
    ],
    matcher: {},
    execution: "mixed",
    sections: [
      {
        heading: "Who is this track for?",
        body: [
          "Data engineers preparing interviews, analytics engineers strengthening transform skills, and backend developers moving into data-platform roles.",
        ],
        bullets: [
          "Pipeline thinking: quality, cleaning and deduplication problems",
          "Transform fluency: aggregations, joins and conditional logic in both SQL and PySpark",
          "Production readiness: medium and hard multi-step questions",
        ],
      },
      {
        heading: "How Data Engineering practice works on QueryVanta",
        body: [
          "Everything runs in the browser: SQL executes on embedded PostgreSQL and PySpark executes on a real Spark engine. Solved questions feed your progress, weak-area practice targets the topics you struggle with, and mock interviews simulate timed pressure.",
        ],
        bullets: [
          "Mixed SQL and PySpark catalog with shared topic taxonomy",
          "Data Engineering Core learning path with staged progression",
          "Weak-area sessions generated from your own attempt history",
          "Timed Data Engineer interviews with factual summaries",
        ],
      },
      {
        heading: "What to practice next",
        body: [
          "Follow the Data Engineering Core path end to end, then book a timed mixed interview. Revisit the topics your summary flags as incomplete.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "data-engineering-core",
        label: "Data Engineering Core",
      },
      {
        id: "sql-foundations",
        label: "SQL Foundations",
      },
      {
        id: "pyspark-foundations",
        label: "PySpark Foundations",
      },
    ],
    siblings: [
      {
        slug: "sql-practice",
        label: "SQL practice",
      },
      {
        slug: "pyspark-practice",
        label: "PySpark practice",
      },
      {
        slug: "big-data-practice",
        label: "Big Data practice",
      },
    ],
  },
  {
    slug: "sql-interview-prep",
    navLabel: "SQL Interview Prep",
    title:
      "SQL Interview Preparation — Timed Mock Interviews | QueryVanta",
    description:
      "Prepare for SQL interviews with timed mock interviews and medium-to-hard practice questions. Real browser execution, reviewable sessions and factual summaries.",
    h1: "SQL Interview Preparation",
    standfirst:
      "Rehearse SQL interviews under realistic timed conditions.",
    intro: [
      "SQL interviews typically combine medium-difficulty query writing with a hard problem under time pressure. QueryVanta recreates that format: pick a SQL interview, choose 5–20 questions and a 15–60 minute timer, then solve with real execution and review every answer afterwards.",
      "The interview pool draws on medium and hard SQL across joins, windows, aggregation, subqueries and data-quality patterns.",
    ],
    matcher: {
      questionTypes: ["SQL"],
      difficulties: ["Medium", "Hard"],
    },
    execution: "sql",
    sections: [
      {
        heading: "How SQL mock interviews work",
        body: [
          "Configure type, difficulty, category, question count, order and timing, then work through the session shell with a visible countdown that survives refresh. Finish early or let the timer expire — either way you get a factual summary with per-question review.",
        ],
        bullets: [
          "Timed (15, 30, 45, 60 minutes) or untimed sessions",
          "Viewing a question never marks it solved — only correct answers count",
          "Summaries report completion, mix and time used — no invented scores",
          "Every session is saved to history with interview context",
        ],
      },
      {
        heading: "How to prepare effectively",
        body: [
          "Warm up on medium SQL, then run full timed interviews at 10–15 questions. Use the review screen to revisit uncompleted problems, and let weak-area practice convert misses into targeted drills.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "sql-advanced",
        label: "SQL Advanced Practice",
      },
      {
        id: "interview-prep",
        label: "Interview Preparation",
      },
    ],
    siblings: [
      {
        slug: "sql-practice",
        label: "SQL practice",
      },
      {
        slug: "pyspark-interview-prep",
        label: "PySpark interview preparation",
      },
      {
        slug: "data-engineering-practice",
        label: "Data Engineering practice",
      },
    ],
  },
  {
    slug: "pyspark-interview-prep",
    navLabel: "PySpark Interview Prep",
    title:
      "PySpark Interview Preparation — Timed Mock Interviews | QueryVanta",
    description:
      "Prepare for PySpark interviews with timed mock interviews on DataFrame transforms, windows and joins, executed on real Spark with reviewable sessions.",
    h1: "PySpark Interview Preparation",
    standfirst:
      "Practice live PySpark coding the way interviews test it.",
    intro: [
      "PySpark interviews usually mean writing DataFrame transforms live: aggregations, joins, windows and cleaning logic. QueryVanta lets you rehearse exactly that on a real Spark engine, timed or untimed, with structured review afterwards.",
      "The interview pool draws on medium and hard PySpark across transforms, windows, joins and data-quality problems.",
    ],
    matcher: {
      questionTypes: ["PySpark"],
      difficulties: ["Medium", "Hard"],
    },
    execution: "pyspark",
    sections: [
      {
        heading: "How PySpark mock interviews work",
        body: [
          "Choose a PySpark interview preset, set the question count and timer, then solve each transform by producing a `result` DataFrame. The countdown persists across refresh, auto-finishes at zero, and the summary breaks down what you completed.",
        ],
        bullets: [
          "Real Spark 4.2.0 execution for every interview answer",
          "Structured `result` validation instead of vague grading",
          "Session-scoped completion that never inflates global progress",
          "Review links back into each question with your code intact",
        ],
      },
      {
        heading: "How to prepare effectively",
        body: [
          "Drill the PySpark Advanced path first so the API is fluent, then run timed interviews. Re-attempt every uncompleted question the same week — Spark idioms stick through repetition.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "pyspark-advanced",
        label: "PySpark Advanced Practice",
      },
      {
        id: "interview-prep",
        label: "Interview Preparation",
      },
    ],
    siblings: [
      {
        slug: "pyspark-practice",
        label: "PySpark practice",
      },
      {
        slug: "sql-interview-prep",
        label: "SQL interview preparation",
      },
      {
        slug: "big-data-practice",
        label: "Big Data practice",
      },
    ],
  },
  {
    slug: "data-analyst-sql",
    navLabel: "SQL for Data Analysts",
    title:
      "SQL for Data Analysts — Practice Filtering, Aggregation & Windows | QueryVanta",
    description:
      "Free SQL practice for data analysts: filtering, aggregation, date logic and window functions with browser execution, hints and interview preparation.",
    h1: "SQL for Data Analysts",
    standfirst:
      "The analyst SQL toolkit — filtering, aggregating and windowing real datasets.",
    intro: [
      "Analyst work lives in SELECT statements: filtering event tables, aggregating revenue, handling nulls and dates, and ranking with window functions. This page collects the QueryVanta SQL questions most relevant to data analyst roles and interviews.",
      "Every problem runs in the browser on PostgreSQL with hints and solutions, so you can practice the full loop from question to validated answer.",
    ],
    matcher: {
      questionTypes: ["SQL"],
      categories: [
        "Filtering",
        "Aggregation",
        "Conditional Aggregation",
        "Window Functions",
        "Ranking",
        "Top-N",
        "NULL Handling",
        "Date Filtering",
        "Date Operations",
        "Conditional Logic",
      ],
    },
    execution: "sql",
    sections: [
      {
        heading: "Which SQL skills matter for analysts?",
        body: [
          "Analyst screens emphasize reading comprehension of schemas, correct GROUP BY logic, conditional aggregation, date truncation and filtering, and basic ranking. Harder loops add window frames and top-N per group.",
        ],
        bullets: [
          "Filtering and conditional logic for cohort definitions",
          "Aggregation and conditional aggregation for metrics",
          "Window functions and ranking for ordered analysis",
          "Date operations and null handling for messy event data",
        ],
      },
      {
        heading: "How to use this page",
        body: [
          "Work the sample questions below, then open the SQL Foundations path to track completion across the full analyst-relevant set. Finish with a timed SQL interview to simulate screen pressure.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "sql-foundations",
        label: "SQL Foundations",
      },
      {
        id: "sql-advanced",
        label: "SQL Advanced Practice",
      },
    ],
    siblings: [
      {
        slug: "sql-practice",
        label: "SQL practice",
      },
      {
        slug: "sql-interview-prep",
        label: "SQL interview preparation",
      },
      {
        slug: "data-engineering-practice",
        label: "Data Engineering practice",
      },
    ],
  },
  {
    slug: "big-data-practice",
    navLabel: "Big Data Practice",
    title:
      "Big Data Practice — PySpark & Spark SQL Exercises | QueryVanta",
    description:
      "Practice Big Data skills online: PySpark DataFrame exercises on real Spark plus Spark SQL-style analytics with windows, aggregations and CTEs.",
    h1: "Big Data Practice",
    standfirst:
      "Distributed-data fundamentals: PySpark transforms plus Spark SQL-style analytics.",
    intro: [
      "Big data interviews test two things: comfort with distributed transforms (PySpark DataFrames) and fluency in Spark SQL-style analytics (windows, aggregations, CTEs). This page brings both together — PySpark exercises executed on real Spark, alongside the SQL analytics patterns Spark SQL uses.",
      "Practice group-bys, windowed rankings, joins and cleaning logic the way they appear in large-scale pipelines.",
    ],
    matcher: {
      categories: [
        "Aggregation",
        "Window Functions",
        "Joins",
        "CTEs",
        "Subqueries",
        "Ranking",
        "Data Cleaning",
        "Data Quality",
        "Data Engineering",
        "Conditional Aggregation",
      ],
    },
    execution: "mixed",
    sections: [
      {
        heading: "What Big Data practice covers here",
        body: [
          "The set below mixes PySpark DataFrame problems with SQL analytics problems that mirror Spark SQL: partitioned windows, grouped aggregations, CTE-structured queries and data-quality checks.",
        ],
        bullets: [
          "PySpark: distributed group-bys, windows, joins and cleaning",
          "Spark SQL-style: window functions, CTEs and conditional aggregation",
          "Pipeline realism: quality checks and deduplication patterns",
        ],
      },
      {
        heading: "How to use this page",
        body: [
          "Alternate between a PySpark transform and its SQL-window counterpart to build transferable intuition, then validate with a timed mixed interview.",
        ],
      },
    ],
    learnPaths: [
      {
        id: "data-engineering-core",
        label: "Data Engineering Core",
      },
      {
        id: "pyspark-foundations",
        label: "PySpark Foundations",
      },
    ],
    siblings: [
      {
        slug: "pyspark-practice",
        label: "PySpark practice",
      },
      {
        slug: "data-engineering-practice",
        label: "Data Engineering practice",
      },
      {
        slug: "pyspark-interview-prep",
        label: "PySpark interview preparation",
      },
    ],
  },
];

export function getLandingPage(
  slug: string | undefined,
): LandingPageDef | null {
  if (!slug) {
    return null;
  }

  return (
    LANDING_PAGES.find((page) => page.slug === slug) ??
    null
  );
}
