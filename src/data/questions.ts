export type Difficulty = "Easy" | "Medium" | "Hard";

export type QuestionType =
  | "SQL"
  | "PySpark"
  | "Data Modeling"
  | "Data Engineering"
  | "Architecture";

export type ColumnType =
  | "INTEGER"
  | "BIGINT"
  | "DECIMAL"
  | "TEXT"
  | "BOOLEAN"
  | "DATE"
  | "TIMESTAMP";

export type TableColumn = {
  name: string;
  type: ColumnType;
  nullable?: boolean;
};

export type TableDefinition = {
  name: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
};

export type QuestionDatabase = {
  engine: "PostgreSQL";
  tables: TableDefinition[];
};

export type ValidationType = "result";

export type QuestionValidation = {
  type: ValidationType;
  expectedResult: Record<string, unknown>[];
};

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

  database?: QuestionDatabase;

  starterCode?: string;

  validation?: QuestionValidation;
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

    starterCode: `SELECT
    *
FROM videos
WHERE views > 1000000
ORDER BY duration_seconds;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "videos",

          columns: [
            {
              name: "video_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "title",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "views",
              type: "BIGINT",
              nullable: false,
            },
            {
              name: "duration_seconds",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "published_date",
              type: "DATE",
              nullable: false,
            },
          ],

          rows: [
            {
              video_id: 1,
              title: "Data Engineering with Spark",
              views: 2500000,
              duration_seconds: 840,
              published_date: "2026-01-15",
            },
            {
              video_id: 2,
              title: "SQL Window Functions",
              views: 850000,
              duration_seconds: 620,
              published_date: "2026-02-03",
            },
            {
              video_id: 3,
              title: "Building Lakehouse Pipelines",
              views: 4200000,
              duration_seconds: 1260,
              published_date: "2026-02-18",
            },
            {
              video_id: 4,
              title: "PostgreSQL Performance Tips",
              views: 1800000,
              duration_seconds: 540,
              published_date: "2026-03-02",
            },
            {
              video_id: 5,
              title: "Python for Data Engineers",
              views: 640000,
              duration_seconds: 720,
              published_date: "2026-03-10",
            },
            {
              video_id: 6,
              title: "Advanced ETL Architecture",
              views: 3100000,
              duration_seconds: 960,
              published_date: "2026-03-22",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",

      expectedResult: [
        {
          video_id: 4,
          title: "PostgreSQL Performance Tips",
          views: 1800000,
          duration_seconds: 540,
          published_date: "2026-03-02",
        },
        {
          video_id: 1,
          title: "Data Engineering with Spark",
          views: 2500000,
          duration_seconds: 840,
          published_date: "2026-01-15",
        },
        {
          video_id: 6,
          title: "Advanced ETL Architecture",
          views: 3100000,
          duration_seconds: 960,
          published_date: "2026-03-22",
        },
        {
          video_id: 3,
          title: "Building Lakehouse Pipelines",
          views: 4200000,
          duration_seconds: 1260,
          published_date: "2026-02-18",
        },
      ],
    },
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

    starterCode: `SELECT
    customer_id,
    COUNT(*) AS total_orders,
    SUM(order_amount) AS total_revenue
FROM orders
GROUP BY customer_id
ORDER BY total_revenue DESC;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "orders",

          columns: [
            {
              name: "order_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "customer_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "order_amount",
              type: "DECIMAL",
              nullable: false,
            },
            {
              name: "order_date",
              type: "DATE",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 101,
              customer_id: 1,
              order_amount: 2500.0,
              order_date: "2026-01-05",
            },
            {
              order_id: 102,
              customer_id: 2,
              order_amount: 1800.0,
              order_date: "2026-01-08",
            },
            {
              order_id: 103,
              customer_id: 1,
              order_amount: 3200.0,
              order_date: "2026-01-15",
            },
            {
              order_id: 104,
              customer_id: 3,
              order_amount: 950.0,
              order_date: "2026-01-20",
            },
            {
              order_id: 105,
              customer_id: 2,
              order_amount: 4200.0,
              order_date: "2026-02-01",
            },
            {
              order_id: 106,
              customer_id: 1,
              order_amount: 1500.0,
              order_date: "2026-02-12",
            },
          ],
        },
      ],
    },
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

    starterCode: `SELECT
    employee_id,
    employee_name,
    department,
    salary,
    RANK() OVER (
        PARTITION BY department
        ORDER BY salary DESC
    ) AS salary_rank
FROM employees;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "employees",

          columns: [
            {
              name: "employee_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "employee_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "department",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "salary",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              department: "Engineering",
              salary: 125000,
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              department: "Engineering",
              salary: 142000,
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              department: "Engineering",
              salary: 118000,
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              department: "Finance",
              salary: 110000,
            },
            {
              employee_id: 5,
              employee_name: "Vikram",
              department: "Finance",
              salary: 132000,
            },
            {
              employee_id: 6,
              employee_name: "Ishita",
              department: "Finance",
              salary: 125000,
            },
          ],
        },
      ],
    },
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

    starterCode: `WITH ranked_customers AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY email
            ORDER BY updated_at DESC
        ) AS row_num
    FROM customers
)
SELECT *
FROM ranked_customers
WHERE row_num = 1;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "customers",

          columns: [
            {
              name: "customer_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "email",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "updated_at",
              type: "TIMESTAMP",
              nullable: false,
            },
          ],

          rows: [
            {
              customer_id: 1,
              name: "Rahul Sharma",
              email: "rahul@example.com",
              updated_at: "2026-01-05 10:30:00",
            },
            {
              customer_id: 2,
              name: "Rahul S Sharma",
              email: "rahul@example.com",
              updated_at: "2026-02-10 14:20:00",
            },
            {
              customer_id: 3,
              name: "Priya Singh",
              email: "priya@example.com",
              updated_at: "2026-01-18 09:15:00",
            },
            {
              customer_id: 4,
              name: "Amit Verma",
              email: "amit@example.com",
              updated_at: "2026-02-01 11:45:00",
            },
            {
              customer_id: 5,
              name: "Priya S",
              email: "priya@example.com",
              updated_at: "2026-03-02 16:10:00",
            },
          ],
        },
      ],
    },
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

    starterCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

daily_sales = (
    sales
    .groupBy("sale_date")
    .agg(
        F.sum("amount").alias("daily_revenue")
    )
)

window_spec = (
    Window
    .orderBy("sale_date")
    .rowsBetween(-6, 0)
)

result = daily_sales.withColumn(
    "rolling_7_day_revenue",
    F.sum("daily_revenue").over(window_spec)
)`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "sales",

          columns: [
            {
              name: "sale_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "sale_date",
              type: "DATE",
              nullable: false,
            },
            {
              name: "amount",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              sale_id: 1,
              sale_date: "2026-03-01",
              amount: 1200.0,
            },
            {
              sale_id: 2,
              sale_date: "2026-03-01",
              amount: 850.0,
            },
            {
              sale_id: 3,
              sale_date: "2026-03-02",
              amount: 1450.0,
            },
            {
              sale_id: 4,
              sale_date: "2026-03-03",
              amount: 980.0,
            },
            {
              sale_id: 5,
              sale_date: "2026-03-04",
              amount: 1750.0,
            },
            {
              sale_id: 6,
              sale_date: "2026-03-05",
              amount: 2100.0,
            },
          ],
        },
      ],
    },
  },
];