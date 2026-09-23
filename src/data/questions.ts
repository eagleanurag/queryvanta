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
  orderMatters?: boolean;
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

  hint?: string;

  solutionCode?: string;

  explanation?: string;

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

    hint: "Filter rows with WHERE on views, then order by duration.",
    solutionCode: `SELECT
    *
FROM videos
WHERE views > 1000000
ORDER BY duration_seconds;`,
    explanation:
      "WHERE narrows the rows before anything else happens, so only videos above the view threshold reach the sort. ORDER BY duration_seconds then arranges those survivors from shortest to longest.",

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
      orderMatters: true,

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

    hint: "Group by customer, count rows and sum amounts, then order by the total.",
    solutionCode: `SELECT
    customer_id,
    COUNT(*) AS total_orders,
    SUM(order_amount) AS total_revenue
FROM orders
GROUP BY customer_id
ORDER BY total_revenue DESC;`,
    explanation:
      "GROUP BY partitions orders into one group per customer, and COUNT plus SUM collapse each partition into a single summary row. Aliasing the aggregates gives them names that ORDER BY can then reference directly.",

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

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          customer_id: 1,
          total_orders: 3,
          total_revenue: 7200,
        },
        {
          customer_id: 2,
          total_orders: 2,
          total_revenue: 6000,
        },
        {
          customer_id: 3,
          total_orders: 1,
          total_revenue: 950,
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

    hint: "Rank inside each department with a window partitioned by department.",
    solutionCode: `SELECT
    employee_id,
    employee_name,
    department,
    salary,
    RANK() OVER (
        PARTITION BY department
        ORDER BY salary DESC
    ) AS salary_rank
FROM employees
ORDER BY department, salary_rank;`,
    explanation:
      "A window function computes a value per row without collapsing rows. PARTITION BY restarts the ranking for every department, ORDER BY salary DESC puts the highest earner first, and the outer ORDER BY only arranges the display.",

    starterCode: `SELECT
    employee_id,
    employee_name,
    department,
    salary,
    RANK() OVER (
        PARTITION BY department
        ORDER BY salary DESC
    ) AS salary_rank
FROM employees
ORDER BY department, salary_rank;`,

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

    validation: {
      type: "result",

      expectedResult: [
        {
          employee_id: 2,
          employee_name: "Meera",
          department: "Engineering",
          salary: 142000,
          salary_rank: 1,
        },
        {
          employee_id: 1,
          employee_name: "Aarav",
          department: "Engineering",
          salary: 125000,
          salary_rank: 2,
        },
        {
          employee_id: 3,
          employee_name: "Rohan",
          department: "Engineering",
          salary: 118000,
          salary_rank: 3,
        },
        {
          employee_id: 5,
          employee_name: "Vikram",
          department: "Finance",
          salary: 132000,
          salary_rank: 1,
        },
        {
          employee_id: 6,
          employee_name: "Ishita",
          department: "Finance",
          salary: 125000,
          salary_rank: 2,
        },
        {
          employee_id: 4,
          employee_name: "Ananya",
          department: "Finance",
          salary: 110000,
          salary_rank: 3,
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

    hint: "Number rows per email by recency in a CTE, then keep number 1.",
    solutionCode: `WITH ranked_customers AS (
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
WHERE row_num = 1
ORDER BY email;`,
    explanation:
      "Window functions cannot appear in WHERE, so a CTE first materializes the row numbers and the outer query filters on them. Partitioning by email with the newest record ordered first makes row_num = 1 exactly the latest record per address.",

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
WHERE row_num = 1
ORDER BY email;`,

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

    validation: {
      type: "result",

      expectedResult: [
        {
          customer_id: 4,
          name: "Amit Verma",
          email: "amit@example.com",
          updated_at: "2026-02-01 11:45:00",
          row_num: 1,
        },
        {
          customer_id: 5,
          name: "Priya S",
          email: "priya@example.com",
          updated_at: "2026-03-02 16:10:00",
          row_num: 1,
        },
        {
          customer_id: 2,
          name: "Rahul S Sharma",
          email: "rahul@example.com",
          updated_at: "2026-02-10 14:20:00",
          row_num: 1,
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

  {
    id: "orders-with-customer-names",
    title: "Orders With Customer Names",
    description:
      "Join orders with customers to list each order with the customer name, sorted by order ID.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Joins",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["JOIN", "INNER JOIN", "ORDER BY"],
    companies: ["Amazon", "Shopify"],
    solved: false,

    hint: "Join on the shared customer_id key, then sort by order.",
    solutionCode: `SELECT
    orders.order_id,
    customers.customer_name,
    orders.amount
FROM orders
JOIN customers
    ON customers.customer_id = orders.customer_id
ORDER BY orders.order_id;`,
    explanation:
      "An inner join matches rows from both tables on the shared key, so each order gains its customer name. Qualifying column names with table names keeps the query unambiguous when both tables share a column.",

    starterCode: `SELECT
    orders.order_id,
    customers.customer_name,
    orders.amount
FROM orders
JOIN customers
    ON customers.customer_id = orders.customer_id
ORDER BY orders.order_id;`,

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
              name: "customer_name",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              customer_id: 1,
              customer_name: "Aarav Sharma",
            },
            {
              customer_id: 2,
              customer_name: "Meera Iyer",
            },
            {
              customer_id: 3,
              customer_name: "Rohan Gupta",
            },
          ],
        },
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
              name: "amount",
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
              amount: 250.0,
              order_date: "2026-01-05",
            },
            {
              order_id: 102,
              customer_id: 2,
              amount: 120.5,
              order_date: "2026-01-07",
            },
            {
              order_id: 103,
              customer_id: 1,
              amount: 75.25,
              order_date: "2026-01-12",
            },
            {
              order_id: 104,
              customer_id: 3,
              amount: 300.0,
              order_date: "2026-01-15",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          order_id: 101,
          customer_name: "Aarav Sharma",
          amount: 250,
        },
        {
          order_id: 102,
          customer_name: "Meera Iyer",
          amount: 120.5,
        },
        {
          order_id: 103,
          customer_name: "Aarav Sharma",
          amount: 75.25,
        },
        {
          order_id: 104,
          customer_name: "Rohan Gupta",
          amount: 300,
        },
      ],
    },
  },

  {
    id: "high-average-price-categories",
    title: "High Average Price Categories",
    description:
      "Find product categories whose average price is greater than 100.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Aggregation",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["GROUP BY", "AVG", "HAVING"],
    companies: ["Amazon"],
    solved: false,

    hint: "Aggregate per category, then filter groups with HAVING.",
    solutionCode: `SELECT
    category,
    ROUND(AVG(price), 2) AS avg_price
FROM products
GROUP BY category
HAVING AVG(price) > 100;`,
    explanation:
      "GROUP BY builds one row per category, but aggregate conditions cannot go in WHERE because it runs before grouping. HAVING filters after aggregation, keeping only categories whose average clears the bar.",

    starterCode: `SELECT
    category,
    ROUND(AVG(price), 2) AS avg_price
FROM products
GROUP BY category
HAVING AVG(price) > 100;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "products",

          columns: [
            {
              name: "product_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "category",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "price",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              product_id: 1,
              product_name: "Basic Mouse",
              category: "Accessories",
              price: 25.0,
            },
            {
              product_id: 2,
              product_name: "Ergo Keyboard",
              category: "Accessories",
              price: 120.0,
            },
            {
              product_id: 3,
              product_name: "Office Chair",
              category: "Furniture",
              price: 350.0,
            },
            {
              product_id: 4,
              product_name: "Desk Lamp",
              category: "Furniture",
              price: 80.0,
            },
            {
              product_id: 5,
              product_name: "Standing Desk",
              category: "Furniture",
              price: 600.0,
            },
            {
              product_id: 6,
              product_name: "USB Hub",
              category: "Accessories",
              price: 45.0,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          category: "Furniture",
          avg_price: 343.33,
        },
      ],
    },
  },

  {
    id: "salary-band-labels",
    title: "Salary Band Labels",
    description:
      "Label each staff member as High, Medium, or Entry based on salary bands.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Conditional Logic",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["CASE", "ORDER BY"],
    companies: ["Microsoft"],
    solved: false,

    hint: "Map salary ranges to labels with CASE, highest band first.",
    solutionCode: `SELECT
    employee_id,
    employee_name,
    CASE
        WHEN salary >= 100000 THEN 'High'
        WHEN salary >= 60000 THEN 'Medium'
        ELSE 'Entry'
    END AS salary_band
FROM staff
ORDER BY employee_id;`,
    explanation:
      "CASE evaluates its branches in order and takes the first match, so listing bands from highest to lowest guarantees each salary lands in exactly one band. ELSE acts as the safety net for everything the earlier conditions skipped.",

    starterCode: `SELECT
    employee_id,
    employee_name,
    CASE
        WHEN salary >= 100000 THEN 'High'
        WHEN salary >= 60000 THEN 'Medium'
        ELSE 'Entry'
    END AS salary_band
FROM staff
ORDER BY employee_id;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "staff",

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
              name: "salary",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              salary: 45000,
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              salary: 75000,
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              salary: 120000,
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              salary: 60000,
            },
            {
              employee_id: 5,
              employee_name: "Vikram",
              salary: 95000,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          employee_id: 1,
          employee_name: "Aarav",
          salary_band: "Entry",
        },
        {
          employee_id: 2,
          employee_name: "Meera",
          salary_band: "Medium",
        },
        {
          employee_id: 3,
          employee_name: "Rohan",
          salary_band: "High",
        },
        {
          employee_id: 4,
          employee_name: "Ananya",
          salary_band: "Medium",
        },
        {
          employee_id: 5,
          employee_name: "Vikram",
          salary_band: "Medium",
        },
      ],
    },
  },

  {
    id: "final-price-after-discount",
    title: "Final Price After Discount",
    description:
      "Compute each product's final price, treating a missing discount as zero.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "NULL Handling",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["COALESCE", "NULL", "ORDER BY"],
    companies: ["Shopify"],
    solved: false,

    hint: "Treat a missing discount as zero before subtracting.",
    solutionCode: `SELECT
    product_name,
    price - COALESCE(discount, 0) AS final_price
FROM products
ORDER BY product_id;`,
    explanation:
      "Arithmetic with NULL yields NULL, so a missing discount would blank the whole price. COALESCE substitutes zero only where the value is absent, leaving real discounts untouched.",

    starterCode: `SELECT
    product_name,
    price - COALESCE(discount, 0) AS final_price
FROM products
ORDER BY product_id;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "products",

          columns: [
            {
              name: "product_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "price",
              type: "DECIMAL",
              nullable: false,
            },
            {
              name: "discount",
              type: "DECIMAL",
            },
          ],

          rows: [
            {
              product_id: 1,
              product_name: "Laptop",
              price: 1000.0,
              discount: 100.0,
            },
            {
              product_id: 2,
              product_name: "Mouse",
              price: 25.0,
              discount: null,
            },
            {
              product_id: 3,
              product_name: "Keyboard",
              price: 75.0,
              discount: 10.0,
            },
            {
              product_id: 4,
              product_name: "Monitor",
              price: 300.0,
              discount: null,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          product_name: "Laptop",
          final_price: 900,
        },
        {
          product_name: "Mouse",
          final_price: 25,
        },
        {
          product_name: "Keyboard",
          final_price: 65,
        },
        {
          product_name: "Monitor",
          final_price: 300,
        },
      ],
    },
  },

  {
    id: "recent-user-signups",
    title: "Recent User Signups",
    description:
      "List users who signed up on or after February 1st 2026, earliest first.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Date Filtering",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["WHERE", "DATE", "ORDER BY"],
    companies: ["Spotify", "Airbnb"],
    solved: false,

    hint: "Compare the date column against a fixed DATE literal.",
    solutionCode: `SELECT
    user_id,
    username,
    signup_date
FROM users
WHERE signup_date >= DATE '2026-02-01'
ORDER BY signup_date;`,
    explanation:
      "Date literals compare chronologically just like numbers, so a single range predicate selects everything from the cutoff onward. Ordering by the same date column returns the earliest signups first.",

    starterCode: `SELECT
    user_id,
    username,
    signup_date
FROM users
WHERE signup_date >= DATE '2026-02-01'
ORDER BY signup_date;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "users",

          columns: [
            {
              name: "user_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "username",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "signup_date",
              type: "DATE",
              nullable: false,
            },
          ],

          rows: [
            {
              user_id: 1,
              username: "aarav",
              signup_date: "2026-01-10",
            },
            {
              user_id: 2,
              username: "meera",
              signup_date: "2026-02-05",
            },
            {
              user_id: 3,
              username: "rohan",
              signup_date: "2026-01-25",
            },
            {
              user_id: 4,
              username: "ananya",
              signup_date: "2026-03-01",
            },
            {
              user_id: 5,
              username: "vikram",
              signup_date: "2026-02-20",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          user_id: 2,
          username: "meera",
          signup_date: "2026-02-05",
        },
        {
          user_id: 5,
          username: "vikram",
          signup_date: "2026-02-20",
        },
        {
          user_id: 4,
          username: "ananya",
          signup_date: "2026-03-01",
        },
      ],
    },
  },

  {
    id: "top-products-by-quantity",
    title: "Top Products by Quantity",
    description:
      "Return the top 3 products by total quantity sold.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Top-N",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["GROUP BY", "SUM", "ORDER BY", "LIMIT"],
    companies: ["Amazon", "Stripe"],
    solved: false,

    hint: "Aggregate, sort descending with a name tiebreaker, take 3.",
    solutionCode: `SELECT
    product_name,
    SUM(quantity) AS total_quantity
FROM sales
GROUP BY product_name
ORDER BY total_quantity DESC, product_name ASC
LIMIT 3;`,
    explanation:
      "LIMIT applies after ORDER BY, so sorting first decides exactly which rows survive. The secondary name sort makes the cutoff deterministic when quantities tie, which a bare top-N would leave to chance.",

    starterCode: `SELECT
    product_name,
    SUM(quantity) AS total_quantity
FROM sales
GROUP BY product_name
ORDER BY total_quantity DESC, product_name ASC
LIMIT 3;`,

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
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "quantity",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              sale_id: 1,
              product_name: "Laptop",
              quantity: 5,
            },
            {
              sale_id: 2,
              product_name: "Mouse",
              quantity: 20,
            },
            {
              sale_id: 3,
              product_name: "Keyboard",
              quantity: 12,
            },
            {
              sale_id: 4,
              product_name: "Monitor",
              quantity: 8,
            },
            {
              sale_id: 5,
              product_name: "Webcam",
              quantity: 20,
            },
            {
              sale_id: 6,
              product_name: "Headset",
              quantity: 3,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          product_name: "Mouse",
          total_quantity: 20,
        },
        {
          product_name: "Webcam",
          total_quantity: 20,
        },
        {
          product_name: "Keyboard",
          total_quantity: 12,
        },
      ],
    },
  },

  {
    id: "duplicate-email-addresses",
    title: "Duplicate Email Addresses",
    description:
      "Find email addresses used by more than one subscriber, with their signup counts.",
    difficulty: "Easy",
    questionType: "SQL",
    category: "Duplicates",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["GROUP BY", "COUNT", "HAVING"],
    companies: ["Google"],
    solved: false,

    hint: "Group by email and keep groups with a count above 1.",
    solutionCode: `SELECT
    email,
    COUNT(*) AS signup_count
FROM subscribers
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY email;`,
    explanation:
      "Duplicate detection is aggregation in disguise: grouping by email collapses repeats, and the per-group count reveals how many times each address appears. HAVING then keeps only the addresses seen more than once.",

    starterCode: `SELECT
    email,
    COUNT(*) AS signup_count
FROM subscribers
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY email;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "subscribers",

          columns: [
            {
              name: "subscriber_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "email",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              subscriber_id: 1,
              email: "a@example.com",
            },
            {
              subscriber_id: 2,
              email: "b@example.com",
            },
            {
              subscriber_id: 3,
              email: "a@example.com",
            },
            {
              subscriber_id: 4,
              email: "c@example.com",
            },
            {
              subscriber_id: 5,
              email: "b@example.com",
            },
            {
              subscriber_id: 6,
              email: "b@example.com",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          email: "a@example.com",
          signup_count: 2,
        },
        {
          email: "b@example.com",
          signup_count: 3,
        },
      ],
    },
  },

  {
    id: "customers-without-orders",
    title: "Customers Without Orders",
    description:
      "List customers who have never placed an order using a LEFT JOIN.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Joins",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["LEFT JOIN", "NULL", "ORDER BY"],
    companies: ["Shopify", "Stripe"],
    solved: false,

    hint: "LEFT JOIN keeps all customers; unmatched rows have NULL on the right.",
    solutionCode: `SELECT
    customers.customer_id,
    customers.customer_name
FROM customers
LEFT JOIN orders
    ON orders.customer_id = customers.customer_id
WHERE orders.order_id IS NULL
ORDER BY customers.customer_id;`,
    explanation:
      "A LEFT JOIN preserves every left-side row, filling the right side with NULLs where nothing matched. Checking IS NULL on an order column therefore isolates exactly the customers with no orders — an anti-join without a subquery.",

    starterCode: `SELECT
    customers.customer_id,
    customers.customer_name
FROM customers
LEFT JOIN orders
    ON orders.customer_id = customers.customer_id
WHERE orders.order_id IS NULL
ORDER BY customers.customer_id;`,

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
              name: "customer_name",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              customer_id: 1,
              customer_name: "Aarav Sharma",
            },
            {
              customer_id: 2,
              customer_name: "Meera Iyer",
            },
            {
              customer_id: 3,
              customer_name: "Rohan Gupta",
            },
            {
              customer_id: 4,
              customer_name: "Ananya Rao",
            },
          ],
        },
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
              name: "amount",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 101,
              customer_id: 1,
              amount: 250.0,
            },
            {
              order_id: 102,
              customer_id: 3,
              amount: 99.99,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          customer_id: 2,
          customer_name: "Meera Iyer",
        },
        {
          customer_id: 4,
          customer_name: "Ananya Rao",
        },
      ],
    },
  },

  {
    id: "employee-manager-hierarchy",
    title: "Employee Manager Hierarchy",
    description:
      "Show each employee alongside their manager's name using a self join.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Self Join",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["SELF JOIN", "ORDER BY"],
    companies: ["Microsoft", "Google"],
    solved: false,

    hint: "Join the table to itself with two aliases.",
    solutionCode: `SELECT
    employees.employee_name AS employee,
    managers.employee_name AS manager
FROM employees
JOIN employees AS managers
    ON managers.employee_id = employees.manager_id
ORDER BY employee;`,
    explanation:
      "A self-join treats one table as two different roles — here each employee row meets the row of their manager. Aliases are mandatory so the query can tell the two copies apart in both the join condition and the output.",

    starterCode: `SELECT
    employees.employee_name AS employee,
    managers.employee_name AS manager
FROM employees
JOIN employees AS managers
    ON managers.employee_id = employees.manager_id
ORDER BY employee;`,

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
              name: "manager_id",
              type: "INTEGER",
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              manager_id: null,
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              manager_id: 1,
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              manager_id: 1,
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              manager_id: 2,
            },
            {
              employee_id: 5,
              employee_name: "Vikram",
              manager_id: 2,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          employee: "Ananya",
          manager: "Meera",
        },
        {
          employee: "Meera",
          manager: "Aarav",
        },
        {
          employee: "Rohan",
          manager: "Aarav",
        },
        {
          employee: "Vikram",
          manager: "Meera",
        },
      ],
    },
  },

  {
    id: "above-average-priced-products",
    title: "Above Average Priced Products",
    description:
      "Find products priced above the overall average product price.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Subqueries",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["SUBQUERY", "AVG", "ORDER BY"],
    companies: ["Amazon"],
    solved: false,

    hint: "Compare each price against a scalar subquery average.",
    solutionCode: `SELECT
    product_name,
    price
FROM products
WHERE price > (SELECT AVG(price) FROM products)
ORDER BY price;`,
    explanation:
      "An uncorrelated scalar subquery runs once and returns a single value that every row is measured against. Because it has no link to the outer row, the database computes the average a single time rather than per product.",

    starterCode: `SELECT
    product_name,
    price
FROM products
WHERE price > (SELECT AVG(price) FROM products)
ORDER BY price;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "products",

          columns: [
            {
              name: "product_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "price",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              product_id: 1,
              product_name: "Pen",
              price: 10,
            },
            {
              product_id: 2,
              product_name: "Notebook",
              price: 25,
            },
            {
              product_id: 3,
              product_name: "Backpack",
              price: 80,
            },
            {
              product_id: 4,
              product_name: "Chair",
              price: 150,
            },
            {
              product_id: 5,
              product_name: "Desk",
              price: 300,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          product_name: "Chair",
          price: 150,
        },
        {
          product_name: "Desk",
          price: 300,
        },
      ],
    },
  },

  {
    id: "high-revenue-months",
    title: "High Revenue Months",
    description:
      "Use a CTE to compute monthly revenue and keep months above 600.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "CTEs",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["CTE", "SUM", "TO_CHAR"],
    companies: ["Uber", "Stripe"],
    solved: false,

    hint: "Bucket rows into months in a CTE, then filter the totals.",
    solutionCode: `WITH monthly_revenue AS (
    SELECT
        TO_CHAR(order_date, 'YYYY-MM') AS month,
        SUM(amount) AS revenue
    FROM orders
    GROUP BY 1
)
SELECT month, revenue
FROM monthly_revenue
WHERE revenue > 600
ORDER BY month;`,
    explanation:
      "A CTE names the monthly rollup so the outer query reads like plain filtering. TO_CHAR turns each date into a sortable month label, GROUP BY 1 reuses the first select item, and the outer WHERE keeps only the strong months.",

    starterCode: `WITH monthly_revenue AS (
    SELECT
        TO_CHAR(order_date, 'YYYY-MM') AS month,
        SUM(amount) AS revenue
    FROM orders
    GROUP BY 1
)
SELECT month, revenue
FROM monthly_revenue
WHERE revenue > 600
ORDER BY month;`,

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
              name: "order_date",
              type: "DATE",
              nullable: false,
            },
            {
              name: "amount",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              order_date: "2026-01-05",
              amount: 200,
            },
            {
              order_id: 2,
              order_date: "2026-01-18",
              amount: 350,
            },
            {
              order_id: 3,
              order_date: "2026-02-02",
              amount: 400,
            },
            {
              order_id: 4,
              order_date: "2026-02-20",
              amount: 150,
            },
            {
              order_id: 5,
              order_date: "2026-03-10",
              amount: 900,
            },
            {
              order_id: 6,
              order_date: "2026-03-22",
              amount: 250,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          month: "2026-03",
          revenue: 1150,
        },
      ],
    },
  },

  {
    id: "revenue-by-channel",
    title: "Revenue by Channel",
    description:
      "Pivot order revenue into online and store columns per region with conditional aggregation.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Conditional Aggregation",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["CASE", "SUM", "GROUP BY"],
    companies: ["Meta", "Amazon"],
    solved: false,

    hint: "Sum conditionally per channel with CASE inside SUM.",
    solutionCode: `SELECT
    region,
    SUM(CASE WHEN channel = 'Online' THEN amount ELSE 0 END) AS online_revenue,
    SUM(CASE WHEN channel = 'Store' THEN amount ELSE 0 END) AS store_revenue
FROM orders
GROUP BY region
ORDER BY region;`,
    explanation:
      "Conditional aggregation pivots rows into columns without any join: each CASE contributes its amount only to its own channel's sum and zero elsewhere. One grouped pass therefore yields both channel totals side by side.",

    starterCode: `SELECT
    region,
    SUM(CASE WHEN channel = 'Online' THEN amount ELSE 0 END) AS online_revenue,
    SUM(CASE WHEN channel = 'Store' THEN amount ELSE 0 END) AS store_revenue
FROM orders
GROUP BY region
ORDER BY region;`,

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
              name: "region",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "channel",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "amount",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              region: "East",
              channel: "Online",
              amount: 100,
            },
            {
              order_id: 2,
              region: "East",
              channel: "Store",
              amount: 200,
            },
            {
              order_id: 3,
              region: "West",
              channel: "Online",
              amount: 150,
            },
            {
              order_id: 4,
              region: "West",
              channel: "Store",
              amount: 50,
            },
            {
              order_id: 5,
              region: "East",
              channel: "Online",
              amount: 300,
            },
            {
              order_id: 6,
              region: "North",
              channel: "Store",
              amount: 400,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          region: "East",
          online_revenue: 400,
          store_revenue: 200,
        },
        {
          region: "North",
          online_revenue: 0,
          store_revenue: 400,
        },
        {
          region: "West",
          online_revenue: 150,
          store_revenue: 50,
        },
      ],
    },
  },

  {
    id: "large-high-paid-departments",
    title: "Large High-Paid Departments",
    description:
      "Find departments with at least 3 employees and an average salary above 95000.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Aggregation",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["GROUP BY", "COUNT", "AVG", "HAVING"],
    companies: ["Google", "Microsoft"],
    solved: false,

    hint: "Filter groups on both size and average.",
    solutionCode: `SELECT
    department,
    COUNT(*) AS headcount,
    ROUND(AVG(salary), 2) AS avg_salary
FROM employees
GROUP BY department
HAVING COUNT(*) >= 3 AND AVG(salary) > 95000
ORDER BY department;`,
    explanation:
      "HAVING can combine several aggregate predicates with AND, so a department must clear both the headcount bar and the pay bar at once. ROUND keeps the average readable without changing which groups qualify.",

    starterCode: `SELECT
    department,
    COUNT(*) AS headcount,
    ROUND(AVG(salary), 2) AS avg_salary
FROM employees
GROUP BY department
HAVING COUNT(*) >= 3 AND AVG(salary) > 95000
ORDER BY department;`,

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
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              department: "Engineering",
              salary: 90000,
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              department: "Engineering",
              salary: 110000,
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              department: "Engineering",
              salary: 95000,
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              department: "Sales",
              salary: 50000,
            },
            {
              employee_id: 5,
              employee_name: "Vikram",
              department: "Sales",
              salary: 55000,
            },
            {
              employee_id: 6,
              employee_name: "Ishita",
              department: "Finance",
              salary: 120000,
            },
            {
              employee_id: 7,
              employee_name: "Kabir",
              department: "Finance",
              salary: 115000,
            },
            {
              employee_id: 8,
              employee_name: "Divya",
              department: "Finance",
              salary: 125000,
            },
            {
              employee_id: 9,
              employee_name: "Arjun",
              department: "Finance",
              salary: 110000,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          department: "Engineering",
          headcount: 3,
          avg_salary: 98333.33,
        },
        {
          department: "Finance",
          headcount: 4,
          avg_salary: 117500,
        },
      ],
    },
  },

  {
    id: "running-order-totals",
    title: "Running Order Totals",
    description:
      "Compute a running total of order amounts ordered by date.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Window Functions",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["SUM", "OVER", "ORDER BY"],
    companies: ["Stripe", "Uber"],
    solved: false,

    hint: "Sum over a window ordered by date with the default frame.",
    solutionCode: `SELECT
    order_id,
    order_date,
    SUM(amount) OVER (
        ORDER BY order_date, order_id
    ) AS running_total
FROM orders
ORDER BY order_date, order_id;`,
    explanation:
      "An ordered window turns SUM into a running total: the default frame spans from the first row to the current one, so each row accumulates everything before it. Including the id in the ordering keeps same-day rows in a stable sequence.",

    starterCode: `SELECT
    order_id,
    order_date,
    SUM(amount) OVER (
        ORDER BY order_date, order_id
    ) AS running_total
FROM orders
ORDER BY order_date, order_id;`,

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
              name: "order_date",
              type: "DATE",
              nullable: false,
            },
            {
              name: "amount",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              order_date: "2026-01-05",
              amount: 100,
            },
            {
              order_id: 2,
              order_date: "2026-01-05",
              amount: 200,
            },
            {
              order_id: 3,
              order_date: "2026-01-12",
              amount: 150,
            },
            {
              order_id: 4,
              order_date: "2026-01-20",
              amount: 300,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          order_id: 1,
          order_date: "2026-01-05",
          running_total: 100,
        },
        {
          order_id: 2,
          order_date: "2026-01-05",
          running_total: 300,
        },
        {
          order_id: 3,
          order_date: "2026-01-12",
          running_total: 450,
        },
        {
          order_id: 4,
          order_date: "2026-01-20",
          running_total: 750,
        },
      ],
    },
  },

  {
    id: "employee-tenure-buckets",
    title: "Employee Tenure Buckets",
    description:
      "Compute each employee's tenure in years as of June 2026 and label veterans.",
    difficulty: "Medium",
    questionType: "SQL",
    category: "Date Operations",
    languages: ["PostgreSQL"],
    tags: ["AGE", "EXTRACT", "CASE"],
    companies: ["Meta", "Airbnb"],
    solved: false,

    hint: "Derive whole years with AGE plus EXTRACT, then label with CASE.",
    solutionCode: `SELECT
    employee_name,
    EXTRACT(
        YEAR FROM AGE(DATE '2026-06-01', hire_date)
    ) AS tenure_years,
    CASE
        WHEN EXTRACT(
            YEAR FROM AGE(DATE '2026-06-01', hire_date)
        ) >= 5 THEN 'Veteran'
        ELSE 'Regular'
    END AS tenure_band
FROM employees
ORDER BY employee_id;`,
    explanation:
      "AGE measures the interval between a fixed reference date and each hire date, and EXTRACT YEAR truncates it to whole years. Reusing the same expression inside CASE turns that number into a readable tenure band without extra subqueries.",

    starterCode: `SELECT
    employee_name,
    EXTRACT(
        YEAR FROM AGE(DATE '2026-06-01', hire_date)
    ) AS tenure_years,
    CASE
        WHEN EXTRACT(
            YEAR FROM AGE(DATE '2026-06-01', hire_date)
        ) >= 5 THEN 'Veteran'
        ELSE 'Regular'
    END AS tenure_band
FROM employees
ORDER BY employee_id;`,

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
              name: "hire_date",
              type: "DATE",
              nullable: false,
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              hire_date: "2020-03-15",
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              hire_date: "2023-08-01",
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              hire_date: "2025-01-10",
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              hire_date: "2018-11-30",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          employee_name: "Aarav",
          tenure_years: 6,
          tenure_band: "Veteran",
        },
        {
          employee_name: "Meera",
          tenure_years: 2,
          tenure_band: "Regular",
        },
        {
          employee_name: "Rohan",
          tenure_years: 1,
          tenure_band: "Regular",
        },
        {
          employee_name: "Ananya",
          tenure_years: 7,
          tenure_band: "Veteran",
        },
      ],
    },
  },

  {
    id: "top-two-products-per-category",
    title: "Top Two Products Per Category",
    description:
      "Rank products within each category by revenue and keep the top two.",
    difficulty: "Hard",
    questionType: "SQL",
    category: "Ranking",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["ROW_NUMBER", "PARTITION BY", "CTE"],
    companies: ["Amazon", "Meta"],
    solved: false,

    hint: "Rank within categories in a CTE, filter rank in the outer query.",
    solutionCode: `WITH ranked_products AS (
    SELECT
        product_name,
        category,
        revenue,
        ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY revenue DESC
        ) AS category_rank
    FROM sales
)
SELECT product_name, category, revenue, category_rank
FROM ranked_products
WHERE category_rank <= 2
ORDER BY category, category_rank;`,
    explanation:
      "Window functions cannot appear in WHERE, so a CTE first materializes the per-category rank and the outer query filters on it like an ordinary column. Partitioning restarts numbering per category while the descending order puts each category winner first.",

    starterCode: `WITH ranked_products AS (
    SELECT
        product_name,
        category,
        revenue,
        ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY revenue DESC
        ) AS category_rank
    FROM sales
)
SELECT product_name, category, revenue, category_rank
FROM ranked_products
WHERE category_rank <= 2
ORDER BY category, category_rank;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "sales",

          columns: [
            {
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "category",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "revenue",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              product_name: "Laptop",
              category: "Electronics",
              revenue: 5000,
            },
            {
              product_name: "Phone",
              category: "Electronics",
              revenue: 7000,
            },
            {
              product_name: "Tablet",
              category: "Electronics",
              revenue: 3000,
            },
            {
              product_name: "Chair",
              category: "Furniture",
              revenue: 2000,
            },
            {
              product_name: "Desk",
              category: "Furniture",
              revenue: 4500,
            },
            {
              product_name: "Lamp",
              category: "Furniture",
              revenue: 800,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          product_name: "Phone",
          category: "Electronics",
          revenue: 7000,
          category_rank: 1,
        },
        {
          product_name: "Laptop",
          category: "Electronics",
          revenue: 5000,
          category_rank: 2,
        },
        {
          product_name: "Desk",
          category: "Furniture",
          revenue: 4500,
          category_rank: 1,
        },
        {
          product_name: "Chair",
          category: "Furniture",
          revenue: 2000,
          category_rank: 2,
        },
      ],
    },
  },

  {
    id: "monthly-revenue-growth",
    title: "Monthly Revenue Growth",
    description:
      "Compute month-over-month revenue growth percentages using LAG.",
    difficulty: "Hard",
    questionType: "SQL",
    category: "Window Functions",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["LAG", "CTE", "ROUND"],
    companies: ["Stripe", "Uber"],
    solved: false,

    hint: "Carry last month's revenue forward with LAG, then compute the percent change.",
    solutionCode: `WITH monthly AS (
    SELECT
        TO_CHAR(order_date, 'YYYY-MM') AS month,
        SUM(amount) AS revenue
    FROM orders
    GROUP BY 1
)
SELECT
    month,
    revenue,
    ROUND(
        (revenue - LAG(revenue) OVER (ORDER BY month)) * 100.0
            / LAG(revenue) OVER (ORDER BY month),
        1
    ) AS growth_pct
FROM monthly
ORDER BY month;`,
    explanation:
      "LAG reads the previous ordered row, which turns a month-over-month comparison into plain row arithmetic. The first month has no predecessor so its growth stays NULL, and multiplying by 100.0 keeps the division in decimal rather than integer math.",

    starterCode: `WITH monthly AS (
    SELECT
        TO_CHAR(order_date, 'YYYY-MM') AS month,
        SUM(amount) AS revenue
    FROM orders
    GROUP BY 1
)
SELECT
    month,
    revenue,
    ROUND(
        (revenue - LAG(revenue) OVER (ORDER BY month)) * 100.0
            / LAG(revenue) OVER (ORDER BY month),
        1
    ) AS growth_pct
FROM monthly
ORDER BY month;`,

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
              name: "order_date",
              type: "DATE",
              nullable: false,
            },
            {
              name: "amount",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              order_date: "2026-01-08",
              amount: 400,
            },
            {
              order_id: 2,
              order_date: "2026-01-21",
              amount: 600,
            },
            {
              order_id: 3,
              order_date: "2026-02-04",
              amount: 700,
            },
            {
              order_id: 4,
              order_date: "2026-02-19",
              amount: 800,
            },
            {
              order_id: 5,
              order_date: "2026-03-05",
              amount: 900,
            },
            {
              order_id: 6,
              order_date: "2026-03-25",
              amount: 900,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          month: "2026-01",
          revenue: 1000,
          growth_pct: null,
        },
        {
          month: "2026-02",
          revenue: 1500,
          growth_pct: 50,
        },
        {
          month: "2026-03",
          revenue: 1800,
          growth_pct: 20,
        },
      ],
    },
  },

  {
    id: "products-never-ordered",
    title: "Products Never Ordered",
    description:
      "Find products that have never appeared in any order using NOT EXISTS.",
    difficulty: "Hard",
    questionType: "SQL",
    category: "Subqueries",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["NOT EXISTS", "ORDER BY"],
    companies: ["Shopify", "Amazon"],
    solved: false,

    hint: "Keep products with no matching order row via NOT EXISTS.",
    solutionCode: `SELECT
    product_id,
    product_name
FROM products AS p
WHERE NOT EXISTS (
    SELECT 1
    FROM order_items AS oi
    WHERE oi.product_id = p.product_id
)
ORDER BY product_id;`,
    explanation:
      "A correlated NOT EXISTS checks each product against the orders table one by one and keeps only those with no match. Unlike NOT IN, it stays correct when the other side contains NULLs, making it the safe anti-join pattern.",

    starterCode: `SELECT
    product_id,
    product_name
FROM products AS p
WHERE NOT EXISTS (
    SELECT 1
    FROM order_items AS oi
    WHERE oi.product_id = p.product_id
)
ORDER BY product_id;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "products",

          columns: [
            {
              name: "product_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "product_name",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              product_id: 1,
              product_name: "Laptop",
            },
            {
              product_id: 2,
              product_name: "Mouse",
            },
            {
              product_id: 3,
              product_name: "Keyboard",
            },
            {
              product_id: 4,
              product_name: "Monitor",
            },
          ],
        },
        {
          name: "order_items",

          columns: [
            {
              name: "order_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "product_id",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              product_id: 1,
            },
            {
              order_id: 2,
              product_id: 2,
            },
            {
              order_id: 3,
              product_id: 1,
            },
            {
              order_id: 4,
              product_id: 2,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          product_id: 3,
          product_name: "Keyboard",
        },
        {
          product_id: 4,
          product_name: "Monitor",
        },
      ],
    },
  },

  {
    id: "signup-conversion-by-month",
    title: "Signup Conversion by Month",
    description:
      "Measure the share of signed-up users who placed an order each month.",
    difficulty: "Hard",
    questionType: "SQL",
    category: "CTEs",
    languages: ["PostgreSQL", "SQL Server"],
    tags: ["CTE", "LEFT JOIN", "COUNT", "ROUND"],
    companies: ["Airbnb", "Spotify"],
    solved: false,

    hint: "Deduplicate buyers in a CTE, left-join to signups, then compute the rate.",
    solutionCode: `WITH user_orders AS (
    SELECT DISTINCT user_id
    FROM orders
)
SELECT
    TO_CHAR(users.signup_date, 'YYYY-MM') AS month,
    COUNT(*) AS signups,
    COUNT(user_orders.user_id) AS buyers,
    ROUND(
        COUNT(user_orders.user_id) * 100.0 / COUNT(*),
        1
    ) AS conversion_pct
FROM users
LEFT JOIN user_orders
    ON user_orders.user_id = users.user_id
GROUP BY 1
ORDER BY 1;`,
    explanation:
      "Deduplicating buyers first prevents repeat orders from inflating the count. The LEFT JOIN preserves signups with no orders, and COUNT on the joined column skips those NULLs while COUNT(*) counts everyone — the ratio of the two is the conversion rate.",

    starterCode: `WITH user_orders AS (
    SELECT DISTINCT user_id
    FROM orders
)
SELECT
    TO_CHAR(users.signup_date, 'YYYY-MM') AS month,
    COUNT(*) AS signups,
    COUNT(user_orders.user_id) AS buyers,
    ROUND(
        COUNT(user_orders.user_id) * 100.0 / COUNT(*),
        1
    ) AS conversion_pct
FROM users
LEFT JOIN user_orders
    ON user_orders.user_id = users.user_id
GROUP BY 1
ORDER BY 1;`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "users",

          columns: [
            {
              name: "user_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "signup_date",
              type: "DATE",
              nullable: false,
            },
          ],

          rows: [
            {
              user_id: 1,
              signup_date: "2026-01-05",
            },
            {
              user_id: 2,
              signup_date: "2026-01-12",
            },
            {
              user_id: 3,
              signup_date: "2026-01-20",
            },
            {
              user_id: 4,
              signup_date: "2026-01-28",
            },
            {
              user_id: 5,
              signup_date: "2026-02-03",
            },
            {
              user_id: 6,
              signup_date: "2026-02-15",
            },
          ],
        },
        {
          name: "orders",

          columns: [
            {
              name: "order_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "user_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "amount",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 101,
              user_id: 1,
              amount: 250,
            },
            {
              order_id: 102,
              user_id: 3,
              amount: 100,
            },
            {
              order_id: 103,
              user_id: 5,
              amount: 75,
            },
            {
              order_id: 104,
              user_id: 6,
              amount: 200,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          month: "2026-01",
          signups: 4,
          buyers: 2,
          conversion_pct: 50,
        },
        {
          month: "2026-02",
          signups: 2,
          buyers: 2,
          conversion_pct: 100,
        },
      ],
    },
  },

  {
    id: "above-department-average-earners",
    title: "Above Department Average Earners",
    description:
      "Find employees earning more than their own department's average salary.",
    difficulty: "Hard",
    questionType: "SQL",
    category: "Subqueries",
    languages: ["PostgreSQL", "MySQL"],
    tags: ["CORRELATED SUBQUERY", "AVG", "ORDER BY"],
    companies: ["Google", "Meta"],
    solved: false,

    hint: "Compare each salary to its own department's average via a correlated subquery.",
    solutionCode: `SELECT
    employee_name,
    department,
    salary
FROM employees AS e
WHERE salary > (
    SELECT AVG(salary)
    FROM employees
    WHERE department = e.department
)
ORDER BY salary DESC;`,
    explanation:
      "A correlated subquery re-runs once per outer row, using that row's department to compute a local average instead of one global number. Each employee is therefore measured against their own department's pay level, not the company's.",

    starterCode: `SELECT
    employee_name,
    department,
    salary
FROM employees AS e
WHERE salary > (
    SELECT AVG(salary)
    FROM employees
    WHERE department = e.department
)
ORDER BY salary DESC;`,

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
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              employee_id: 1,
              employee_name: "Aarav",
              department: "Engineering",
              salary: 80000,
            },
            {
              employee_id: 2,
              employee_name: "Meera",
              department: "Engineering",
              salary: 100000,
            },
            {
              employee_id: 3,
              employee_name: "Rohan",
              department: "Engineering",
              salary: 120000,
            },
            {
              employee_id: 4,
              employee_name: "Ananya",
              department: "Sales",
              salary: 50000,
            },
            {
              employee_id: 5,
              employee_name: "Vikram",
              department: "Sales",
              salary: 70000,
            },
            {
              employee_id: 6,
              employee_name: "Ishita",
              department: "Support",
              salary: 90000,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: true,

      expectedResult: [
        {
          employee_name: "Rohan",
          department: "Engineering",
          salary: 120000,
        },
        {
          employee_name: "Vikram",
          department: "Sales",
          salary: 70000,
        },
      ],
    },
  },

  {
    id: "pyspark-customer-revenue-totals",
    title: "Customer Revenue Totals",
    description:
      "Compute total revenue per customer with PySpark and assign the answer to `result`.",
    difficulty: "Easy",
    questionType: "PySpark",
    category: "Aggregation",
    languages: ["PySpark"],
    tags: ["GROUPBY", "AGGREGATION"],
    companies: ["Meta"],
    solved: false,

    hint: "Group the orders by customer_id, then combine each group with a sum on amount.",
    solutionCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (1, 1, 250.0),
        (2, 2, 100.0),
        (3, 1, 75.0),
        (4, 3, 300.0),
        (5, 2, 150.0),
    ],
    ["order_id", "customer_id", "amount"],
)

result = (
    orders.groupBy("customer_id").agg(F.sum("amount").alias("total_revenue"))
)`,
    explanation:
      "Grouping collapses many rows into one row per key. Here groupBy customer_id partitions the orders, and the sum aggregation folds each partition into a single total, so every customer appears exactly once with their combined revenue.",

    starterCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (1, 1, 250.0),
        (2, 2, 100.0),
        (3, 1, 75.0),
        (4, 3, 300.0),
        (5, 2, 150.0),
    ],
    ["order_id", "customer_id", "amount"],
)

# TODO: compute total revenue per customer.
# Assign the final DataFrame to \`result\` with columns
# customer_id and total_revenue.
result = orders`,

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
              name: "amount",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 1,
              customer_id: 1,
              amount: 250.0,
            },
            {
              order_id: 2,
              customer_id: 2,
              amount: 100.0,
            },
            {
              order_id: 3,
              customer_id: 1,
              amount: 75.0,
            },
            {
              order_id: 4,
              customer_id: 3,
              amount: 300.0,
            },
            {
              order_id: 5,
              customer_id: 2,
              amount: 150.0,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          customer_id: 1,
          total_revenue: 325.0,
        },
        {
          customer_id: 2,
          total_revenue: 250.0,
        },
        {
          customer_id: 3,
          total_revenue: 300.0,
        },
      ],
    },
  },

  {
    id: "pyspark-premium-customer-orders",
    title: "Premium Customer Orders",
    description:
      "Join customers with orders in PySpark and keep customers spending over 250. Assign the answer to `result`.",
    difficulty: "Medium",
    questionType: "PySpark",
    category: "Joins",
    languages: ["PySpark"],
    tags: ["JOIN", "GROUPBY", "FILTER"],
    companies: ["Meta"],
    solved: false,

    hint: "Join on the shared key first, then aggregate spend per customer name and keep only the big spenders.",
    solutionCode: `from pyspark.sql import functions as F

customers = spark.createDataFrame(
    [
        (1, "Aarav"),
        (2, "Meera"),
        (3, "Rohan"),
    ],
    ["customer_id", "customer_name"],
)

orders = spark.createDataFrame(
    [
        (101, 1, 120.0),
        (102, 2, 300.0),
        (103, 1, 200.0),
        (104, 3, 50.0),
        (105, 2, 100.0),
    ],
    ["order_id", "customer_id", "amount"],
)

joined = orders.join(customers, "customer_id")

totals = joined.groupBy("customer_name").agg(
    F.sum("amount").alias("total_spent")
)

result = totals.filter("total_spent > 250")`,
    explanation:
      "Joining on customer_id attaches each order to its customer. Aggregating after the join summarizes at the customer level, and filtering on the aggregated column keeps only high spenders. Joining on a column name directly also avoids carrying two copies of the key.",

    starterCode: `from pyspark.sql import functions as F

customers = spark.createDataFrame(
    [
        (1, "Aarav"),
        (2, "Meera"),
        (3, "Rohan"),
    ],
    ["customer_id", "customer_name"],
)

orders = spark.createDataFrame(
    [
        (101, 1, 120.0),
        (102, 2, 300.0),
        (103, 1, 200.0),
        (104, 3, 50.0),
        (105, 2, 100.0),
    ],
    ["order_id", "customer_id", "amount"],
)

# TODO: join the tables, compute total spend per customer,
# and keep customers spending over 250.
# Assign the final DataFrame to \`result\` with columns
# customer_name and total_spent.
result = customers`,

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
              name: "customer_name",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              customer_id: 1,
              customer_name: "Aarav",
            },
            {
              customer_id: 2,
              customer_name: "Meera",
            },
            {
              customer_id: 3,
              customer_name: "Rohan",
            },
          ],
        },
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
              name: "amount",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 101,
              customer_id: 1,
              amount: 120.0,
            },
            {
              order_id: 102,
              customer_id: 2,
              amount: 300.0,
            },
            {
              order_id: 103,
              customer_id: 1,
              amount: 200.0,
            },
            {
              order_id: 104,
              customer_id: 3,
              amount: 50.0,
            },
            {
              order_id: 105,
              customer_id: 2,
              amount: 100.0,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          customer_name: "Aarav",
          total_spent: 320.0,
        },
        {
          customer_name: "Meera",
          total_spent: 400.0,
        },
      ],
    },
  },

  {
    id: "pyspark-top-products-by-category",
    title: "Top Products by Category",
    description:
      "Rank products within each category by revenue with a window function and keep the top 2. Assign the answer to `result`.",
    difficulty: "Hard",
    questionType: "PySpark",
    category: "Window Functions",
    languages: ["PySpark"],
    tags: ["WINDOW", "ROW_NUMBER"],
    companies: ["Meta"],
    solved: false,

    hint: "Number the rows inside each category by revenue, then keep the rows numbered 1 or 2.",
    solutionCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

sales = spark.createDataFrame(
    [
        ("Laptop", "Electronics", 5000),
        ("Phone", "Electronics", 7000),
        ("Tablet", "Electronics", 3000),
        ("Desk", "Furniture", 4500),
        ("Chair", "Furniture", 2000),
        ("Lamp", "Furniture", 800),
    ],
    ["product", "category", "revenue"],
)

ranked = sales.withColumn(
    "rank",
    F.row_number().over(
        Window.partitionBy("category").orderBy(F.desc("revenue"))
    ),
)

result = ranked.filter("rank <= 2")`,
    explanation:
      "A window partitions rows without collapsing them, so every product keeps its own row while gaining a rank computed only against its category peers. Ordering the window by revenue descending puts the best seller first, and row_number hands out unbroken positions that a simple filter can then trim.",

    starterCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

sales = spark.createDataFrame(
    [
        ("Laptop", "Electronics", 5000),
        ("Phone", "Electronics", 7000),
        ("Tablet", "Electronics", 3000),
        ("Desk", "Furniture", 4500),
        ("Chair", "Furniture", 2000),
        ("Lamp", "Furniture", 800),
    ],
    ["product", "category", "revenue"],
)

# TODO: rank products within each category by revenue
# (highest first) and keep rank 2 or better.
# Assign the final DataFrame to \`result\` with columns
# product, category, revenue and rank.
result = sales`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "sales",

          columns: [
            {
              name: "product",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "category",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "revenue",
              type: "INTEGER",
              nullable: false,
            },
          ],

          rows: [
            {
              product: "Laptop",
              category: "Electronics",
              revenue: 5000,
            },
            {
              product: "Phone",
              category: "Electronics",
              revenue: 7000,
            },
            {
              product: "Tablet",
              category: "Electronics",
              revenue: 3000,
            },
            {
              product: "Desk",
              category: "Furniture",
              revenue: 4500,
            },
            {
              product: "Chair",
              category: "Furniture",
              revenue: 2000,
            },
            {
              product: "Lamp",
              category: "Furniture",
              revenue: 800,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          product: "Phone",
          category: "Electronics",
          revenue: 7000,
          rank: 1,
        },
        {
          product: "Laptop",
          category: "Electronics",
          revenue: 5000,
          rank: 2,
        },
        {
          product: "Desk",
          category: "Furniture",
          revenue: 4500,
          rank: 1,
        },
        {
          product: "Chair",
          category: "Furniture",
          revenue: 2000,
          rank: 2,
        },
      ],
    },
  },

  {
    id: "pyspark-deduplicate-customer-emails",
    title: "Deduplicate Customer Emails",
    description:
      "Remove duplicate customers keeping, for each email, the record with the smallest customer_id. Assign the answer to `result`.",
    difficulty: "Easy",
    questionType: "PySpark",
    category: "Data Cleaning",
    languages: ["PySpark"],
    tags: ["DEDUPLICATION", "ROW_NUMBER"],
    companies: ["Meta"],
    solved: false,

    hint: "Give every email group its own numbering ordered by customer_id, then keep number 1.",
    solutionCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

customers = spark.createDataFrame(
    [
        (1, "Aarav", "aarav@example.com"),
        (2, "Meera", "meera@example.com"),
        (3, "Aarav Sharma", "aarav@example.com"),
        (4, "Rohan", "rohan@example.com"),
        (5, "Meera Iyer", "meera@example.com"),
    ],
    ["customer_id", "customer_name", "email"],
)

ranked = customers.withColumn(
    "rn",
    F.row_number().over(
        Window.partitionBy("email").orderBy("customer_id")
    ),
)

result = ranked.filter("rn = 1").drop("rn")`,
    explanation:
      "Deterministic deduplication needs an explicit tiebreaker, not just first-seen order. Partitioning by email and ordering by customer_id turns each duplicate set into a ranked list where position 1 is always the smallest id, so the same rows survive on every run. Dropping the helper column leaves the original shape intact.",

    starterCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

customers = spark.createDataFrame(
    [
        (1, "Aarav", "aarav@example.com"),
        (2, "Meera", "meera@example.com"),
        (3, "Aarav Sharma", "aarav@example.com"),
        (4, "Rohan", "rohan@example.com"),
        (5, "Meera Iyer", "meera@example.com"),
    ],
    ["customer_id", "customer_name", "email"],
)

# TODO: for each email keep only the record with the smallest
# customer_id. Hint: use row_number over a Window partitioned
# by email and ordered by customer_id ascending, then keep
# rows where the row number equals 1.
# Assign the final DataFrame to \`result\`.
result = customers`,

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
              name: "customer_name",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "email",
              type: "TEXT",
              nullable: false,
            },
          ],

          rows: [
            {
              customer_id: 1,
              customer_name: "Aarav",
              email: "aarav@example.com",
            },
            {
              customer_id: 2,
              customer_name: "Meera",
              email: "meera@example.com",
            },
            {
              customer_id: 3,
              customer_name: "Aarav Sharma",
              email: "aarav@example.com",
            },
            {
              customer_id: 4,
              customer_name: "Rohan",
              email: "rohan@example.com",
            },
            {
              customer_id: 5,
              customer_name: "Meera Iyer",
              email: "meera@example.com",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          customer_id: 1,
          customer_name: "Aarav",
          email: "aarav@example.com",
        },
        {
          customer_id: 2,
          customer_name: "Meera",
          email: "meera@example.com",
        },
        {
          customer_id: 4,
          customer_name: "Rohan",
          email: "rohan@example.com",
        },
      ],
    },
  },

  {
    id: "pyspark-fill-missing-cities",
    title: "Fill Missing Cities",
    description:
      "Replace missing user cities with 'Unknown' using PySpark. Assign the answer to `result`.",
    difficulty: "Easy",
    questionType: "PySpark",
    category: "Data Cleaning",
    languages: ["PySpark"],
    tags: ["NULL", "FILLNA"],
    companies: ["Meta"],
    solved: false,

    hint: "Replace nulls in one column with a default value.",
    solutionCode: `users = spark.createDataFrame(
    [
        (1, "Aarav", "Mumbai"),
        (2, "Meera", None),
        (3, "Rohan", "Delhi"),
        (4, "Ananya", None),
    ],
    ["user_id", "username", "city"],
)

result = users.fillna({"city": "Unknown"})`,
    explanation:
      "Null means unknown, and most downstream logic treats it as contagious — one null can blank an entire result. Filling a column with an explicit default keeps the rows while making the missing data visible and safe to group, join, or display.",

    starterCode: `from pyspark.sql import functions as F

users = spark.createDataFrame(
    [
        (1, "Aarav", "Mumbai"),
        (2, "Meera", None),
        (3, "Rohan", "Delhi"),
        (4, "Ananya", None),
    ],
    ["user_id", "username", "city"],
)

# TODO: fill missing cities with 'Unknown'.
# Assign the final DataFrame to \`result\`.
result = users`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "users",

          columns: [
            {
              name: "user_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "username",
              type: "TEXT",
              nullable: false,
            },
            {
              name: "city",
              type: "TEXT",
            },
          ],

          rows: [
            {
              user_id: 1,
              username: "Aarav",
              city: "Mumbai",
            },
            {
              user_id: 2,
              username: "Meera",
              city: null,
            },
            {
              user_id: 3,
              username: "Rohan",
              city: "Delhi",
            },
            {
              user_id: 4,
              username: "Ananya",
              city: null,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          user_id: 1,
          username: "Aarav",
          city: "Mumbai",
        },
        {
          user_id: 2,
          username: "Meera",
          city: "Unknown",
        },
        {
          user_id: 3,
          username: "Rohan",
          city: "Delhi",
        },
        {
          user_id: 4,
          username: "Ananya",
          city: "Unknown",
        },
      ],
    },
  },

  {
    id: "pyspark-monthly-order-revenue",
    title: "Monthly Order Revenue",
    description:
      "Aggregate order revenue by calendar month with PySpark. Assign the answer to `result`.",
    difficulty: "Medium",
    questionType: "PySpark",
    category: "Aggregation",
    languages: ["PySpark"],
    tags: ["DATE", "MONTH", "GROUPBY"],
    companies: ["Meta"],
    solved: false,

    hint: "Derive the month from each date, then aggregate revenue per month.",
    solutionCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (101, "2026-01-05", 200.0),
        (102, "2026-01-18", 350.0),
        (103, "2026-02-02", 400.0),
        (104, "2026-02-20", 150.0),
        (105, "2026-03-10", 900.0),
        (106, "2026-03-22", 250.0),
    ],
    ["order_id", "order_date", "amount"],
)

result = (
    orders.withColumn("month", F.month(F.to_date("order_date")))
    .groupBy("month")
    .agg(F.sum("amount").alias("revenue"))
)`,
    explanation:
      "Raw dates are too fine-grained to summarize, so the pattern is derive-then-group: first compute a coarser month value from each date, then aggregate per month. Parsing the text into a real date first keeps month extraction correct regardless of string formatting.",

    starterCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (101, "2026-01-05", 200.0),
        (102, "2026-01-18", 350.0),
        (103, "2026-02-02", 400.0),
        (104, "2026-02-20", 150.0),
        (105, "2026-03-10", 900.0),
        (106, "2026-03-22", 250.0),
    ],
    ["order_id", "order_date", "amount"],
)

# TODO: compute total revenue per calendar month.
# Assign the final DataFrame to \`result\` with columns
# month and revenue.
result = orders`,

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
              name: "order_date",
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
              order_id: 101,
              order_date: "2026-01-05",
              amount: 200.0,
            },
            {
              order_id: 102,
              order_date: "2026-01-18",
              amount: 350.0,
            },
            {
              order_id: 103,
              order_date: "2026-02-02",
              amount: 400.0,
            },
            {
              order_id: 104,
              order_date: "2026-02-20",
              amount: 150.0,
            },
            {
              order_id: 105,
              order_date: "2026-03-10",
              amount: 900.0,
            },
            {
              order_id: 106,
              order_date: "2026-03-22",
              amount: 250.0,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          month: 1,
          revenue: 550.0,
        },
        {
          month: 2,
          revenue: 550.0,
        },
        {
          month: 3,
          revenue: 1150.0,
        },
      ],
    },
  },

  {
    id: "pyspark-running-daily-revenue",
    title: "Running Daily Revenue",
    description:
      "Compute the running total of revenue ordered by sale date with a PySpark window. Assign the answer to `result`.",
    difficulty: "Medium",
    questionType: "PySpark",
    category: "Window Functions",
    languages: ["PySpark"],
    tags: ["WINDOW", "CUMULATIVE-SUM"],
    companies: ["Meta"],
    solved: false,

    hint: "Define a window ordered by date that grows row by row, then sum over it.",
    solutionCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

sales = spark.createDataFrame(
    [
        (1, "2026-03-01", 1200.0),
        (2, "2026-03-01", 850.0),
        (3, "2026-03-02", 1450.0),
        (4, "2026-03-03", 980.0),
        (5, "2026-03-04", 1750.0),
    ],
    ["sale_id", "sale_date", "amount"],
)

running = Window.orderBy("sale_date", "sale_id").rowsBetween(
    Window.unboundedPreceding, Window.currentRow
)

result = sales.withColumn("running_total", F.sum("amount").over(running))`,
    explanation:
      "A running total is a window whose frame starts at the first row and ends at the current row, so each row sums everything up to itself. Ordering by date plus the id tiebreaker makes the sequence deterministic even when several sales share a date.",

    starterCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

sales = spark.createDataFrame(
    [
        (1, "2026-03-01", 1200.0),
        (2, "2026-03-01", 850.0),
        (3, "2026-03-02", 1450.0),
        (4, "2026-03-03", 980.0),
        (5, "2026-03-04", 1750.0),
    ],
    ["sale_id", "sale_date", "amount"],
)

# TODO: add a running total of amount ordered by
# sale_date and sale_id.
# Assign the final DataFrame to \`result\` with columns
# sale_id, sale_date, amount and running_total.
result = sales`,

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
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          sale_id: 1,
          sale_date: "2026-03-01",
          amount: 1200.0,
          running_total: 1200.0,
        },
        {
          sale_id: 2,
          sale_date: "2026-03-01",
          amount: 850.0,
          running_total: 2050.0,
        },
        {
          sale_id: 3,
          sale_date: "2026-03-02",
          amount: 1450.0,
          running_total: 3500.0,
        },
        {
          sale_id: 4,
          sale_date: "2026-03-03",
          amount: 980.0,
          running_total: 4480.0,
        },
        {
          sale_id: 5,
          sale_date: "2026-03-04",
          amount: 1750.0,
          running_total: 6230.0,
        },
      ],
    },
  },

  {
    id: "pyspark-department-salary-ranks",
    title: "Department Salary Ranks",
    description:
      "Rank employees within each department by salary with dense_rank, keeping tied salaries equal. Assign the answer to `result`.",
    difficulty: "Medium",
    questionType: "PySpark",
    category: "Window Functions",
    languages: ["PySpark"],
    tags: ["DENSE_RANK", "PARTITION"],
    companies: ["Meta"],
    solved: false,

    hint: "Rank inside each department with a function that shares ranks on ties.",
    solutionCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

employees = spark.createDataFrame(
    [
        (1, "Aarav", "Engineering", 125000),
        (2, "Meera", "Engineering", 142000),
        (3, "Rohan", "Engineering", 142000),
        (4, "Ananya", "Finance", 110000),
        (5, "Vikram", "Finance", 132000),
        (6, "Ishita", "Finance", 110000),
    ],
    ["employee_id", "employee_name", "department", "salary"],
)

ranked = employees.withColumn(
    "salary_rank",
    F.dense_rank().over(
        Window.partitionBy("department").orderBy(F.desc("salary"))
    ),
)

result = ranked.select(
    "employee_name", "department", "salary", "salary_rank"
)`,
    explanation:
      "Ranking functions differ only in how they treat ties: row_number always invents distinct positions, while dense_rank hands tied salaries the same rank without leaving gaps. Partitioning restarts the ranking per department, and selecting the final columns keeps the answer shape exact.",

    starterCode: `from pyspark.sql import functions as F
from pyspark.sql.window import Window

employees = spark.createDataFrame(
    [
        (1, "Aarav", "Engineering", 125000),
        (2, "Meera", "Engineering", 142000),
        (3, "Rohan", "Engineering", 142000),
        (4, "Ananya", "Finance", 110000),
        (5, "Vikram", "Finance", 132000),
        (6, "Ishita", "Finance", 110000),
    ],
    ["employee_id", "employee_name", "department", "salary"],
)

# TODO: rank employees within each department by salary
# descending so tied salaries share a rank.
# Assign the final DataFrame to \`result\` with columns
# employee_name, department, salary and salary_rank.
result = employees`,

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
              type: "INTEGER",
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
              salary: 142000,
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
              salary: 110000,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          employee_name: "Meera",
          department: "Engineering",
          salary: 142000,
          salary_rank: 1,
        },
        {
          employee_name: "Rohan",
          department: "Engineering",
          salary: 142000,
          salary_rank: 1,
        },
        {
          employee_name: "Aarav",
          department: "Engineering",
          salary: 125000,
          salary_rank: 2,
        },
        {
          employee_name: "Vikram",
          department: "Finance",
          salary: 132000,
          salary_rank: 1,
        },
        {
          employee_name: "Ananya",
          department: "Finance",
          salary: 110000,
          salary_rank: 2,
        },
        {
          employee_name: "Ishita",
          department: "Finance",
          salary: 110000,
          salary_rank: 2,
        },
      ],
    },
  },

  {
    id: "pyspark-order-value-segments",
    title: "Order Value Segments",
    description:
      "Classify each order as Premium, Standard, or Basic from its amount with PySpark. Assign the answer to `result`.",
    difficulty: "Hard",
    questionType: "PySpark",
    category: "Conditional Logic",
    languages: ["PySpark"],
    tags: ["WHEN", "OTHERWISE"],
    companies: ["Meta"],
    solved: false,

    hint: "Map each amount to a label with ordered conditions, highest band first.",
    solutionCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (101, 250.0),
        (102, 1800.0),
        (103, 3200.0),
        (104, 950.0),
        (105, 4200.0),
        (106, 1500.0),
    ],
    ["order_id", "amount"],
)

result = orders.withColumn(
    "segment",
    F.when(F.col("amount") >= 3000, "Premium")
    .when(F.col("amount") >= 1000, "Standard")
    .otherwise("Basic"),
)`,
    explanation:
      "Conditional columns evaluate their branches in order and take the first match, so listing bands from highest to lowest guarantees each amount lands in exactly one segment. Otherwise acts as the safety net for everything the earlier conditions skipped.",

    starterCode: `from pyspark.sql import functions as F

orders = spark.createDataFrame(
    [
        (101, 250.0),
        (102, 1800.0),
        (103, 3200.0),
        (104, 950.0),
        (105, 4200.0),
        (106, 1500.0),
    ],
    ["order_id", "amount"],
)

# TODO: classify each order by amount: 3000 and above is
# Premium, 1000 and above is Standard, otherwise Basic.
# Assign the final DataFrame to \`result\` with columns
# order_id, amount and segment.
result = orders`,

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
              name: "amount",
              type: "DECIMAL",
              nullable: false,
            },
          ],

          rows: [
            {
              order_id: 101,
              amount: 250.0,
            },
            {
              order_id: 102,
              amount: 1800.0,
            },
            {
              order_id: 103,
              amount: 3200.0,
            },
            {
              order_id: 104,
              amount: 950.0,
            },
            {
              order_id: 105,
              amount: 4200.0,
            },
            {
              order_id: 106,
              amount: 1500.0,
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          order_id: 101,
          amount: 250.0,
          segment: "Basic",
        },
        {
          order_id: 102,
          amount: 1800.0,
          segment: "Standard",
        },
        {
          order_id: 103,
          amount: 3200.0,
          segment: "Premium",
        },
        {
          order_id: 104,
          amount: 950.0,
          segment: "Basic",
        },
        {
          order_id: 105,
          amount: 4200.0,
          segment: "Premium",
        },
        {
          order_id: 106,
          amount: 1500.0,
          segment: "Standard",
        },
      ],
    },
  },

  {
    id: "pyspark-valid-transaction-filter",
    title: "Valid Transaction Filter",
    description:
      "Keep only complete transactions with a positive amount using PySpark. Assign the answer to `result`.",
    difficulty: "Hard",
    questionType: "PySpark",
    category: "Data Quality",
    languages: ["PySpark"],
    tags: ["FILTER", "ISNOTNULL"],
    companies: ["Meta"],
    solved: false,

    hint: "Keep rows only when the amount exists, is positive, and the status is complete.",
    solutionCode: `from pyspark.sql import functions as F

transactions = spark.createDataFrame(
    [
        (1, 250.0, "complete"),
        (2, None, "complete"),
        (3, -50.0, "complete"),
        (4, 300.0, None),
        (5, 0.0, "pending"),
        (6, 120.0, "complete"),
    ],
    ["transaction_id", "amount", "status"],
)

result = transactions.filter(
    F.col("amount").isNotNull()
    & (F.col("amount") > 0)
    & (F.col("status") == "complete")
)`,
    explanation:
      "Data-quality filters combine independent checks with AND so a row must pass every rule: present, positive, and complete. Note that null comparisons never match, which is why the null check must come first — without it, bad rows would silently slip through or vanish for the wrong reason.",

    starterCode: `from pyspark.sql import functions as F

transactions = spark.createDataFrame(
    [
        (1, 250.0, "complete"),
        (2, None, "complete"),
        (3, -50.0, "complete"),
        (4, 300.0, None),
        (5, 0.0, "pending"),
        (6, 120.0, "complete"),
    ],
    ["transaction_id", "amount", "status"],
)

# TODO: keep rows where amount is present and positive
# and status is complete.
# Assign the final DataFrame to \`result\`.
result = transactions`,

    database: {
      engine: "PostgreSQL",

      tables: [
        {
          name: "transactions",

          columns: [
            {
              name: "transaction_id",
              type: "INTEGER",
              nullable: false,
            },
            {
              name: "amount",
              type: "DECIMAL",
            },
            {
              name: "status",
              type: "TEXT",
            },
          ],

          rows: [
            {
              transaction_id: 1,
              amount: 250.0,
              status: "complete",
            },
            {
              transaction_id: 2,
              amount: null,
              status: "complete",
            },
            {
              transaction_id: 3,
              amount: -50.0,
              status: "complete",
            },
            {
              transaction_id: 4,
              amount: 300.0,
              status: null,
            },
            {
              transaction_id: 5,
              amount: 0.0,
              status: "pending",
            },
            {
              transaction_id: 6,
              amount: 120.0,
              status: "complete",
            },
          ],
        },
      ],
    },

    validation: {
      type: "result",
      orderMatters: false,

      expectedResult: [
        {
          transaction_id: 1,
          amount: 250.0,
          status: "complete",
        },
        {
          transaction_id: 6,
          amount: 120.0,
          status: "complete",
        },
      ],
    },
  },
];