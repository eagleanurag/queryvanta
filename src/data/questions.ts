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
];