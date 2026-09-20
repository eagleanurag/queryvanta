export type Difficulty = "Easy" | "Medium" | "Hard";

export type QuestionType =
  | "SQL"
  | "PySpark"
  | "Data Modeling"
  | "Data Engineering"
  | "Architecture";

export type Question = {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  questionType: QuestionType;
  category: string;
  languages: string[];
  tags: string[];
  companies: string[];
  solved: boolean;
};

export const questions: Question[] = [
  {
    id: "high-engagement-video-filtering",
    title: "High-Engagement Video Filtering",
    description:
      "Filter recent videos with more than 1 million views and sort them by duration.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Filtering",
    languages: ["PostgreSQL", "PySpark"],
    tags: ["WHERE", "FILTER", "ORDER BY"],
    companies: ["Netflix"],
    solved: false,
  },

  {
    id: "customer-order-analysis",
    title: "Customer Order Analysis",
    description:
      "Calculate total orders and revenue for each customer and return the highest-value customers.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Aggregation",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["GROUP BY", "SUM", "COUNT"],
    companies: ["Amazon"],
    solved: false,
  },

  {
    id: "employee-department-ranking",
    title: "Employee Department Ranking",
    description:
      "Rank employees within each department based on their salary using a window function.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Window Functions",
    languages: ["PostgreSQL", "PySpark"],
    tags: ["WINDOW FUNCTION", "RANK", "PARTITION BY"],
    companies: ["Microsoft"],
    solved: false,
  },

  {
    id: "duplicate-customer-records",
    title: "Duplicate Customer Records",
    description:
      "Identify duplicate customer records based on email address and return the latest record.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Data Quality",
    languages: ["PostgreSQL", "Python"],
    tags: ["CTE", "ROW_NUMBER", "DEDUPLICATION"],
    companies: ["Google"],
    solved: false,
  },

  {
    id: "daily-sales-pipeline",
    title: "Daily Sales Pipeline",
    description:
      "Build a daily sales aggregation pipeline using PySpark and calculate rolling revenue metrics.",
    difficulty: "Hard",
    questionType: "PySpark",
    category: "Data Engineering",
    languages: ["PySpark", "Spark SQL"],
    tags: ["WINDOW", "AGGREGATION", "PIPELINE"],
    companies: ["Meta"],
    solved: false,
  },
];