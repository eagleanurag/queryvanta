import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Link,
  useParams,
} from "react-router-dom";

import type { PGlite } from "@electric-sql/pglite";

import { questions } from "../data/questions";
import { createQuestionDatabase } from "../lib/pglite";
import { validateResult } from "../lib/validation";

type ExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "error";

function QuestionPage() {
  const { questionId } = useParams();

  const question = questions.find(
    (item) => item.id === questionId,
  );

  const database = question?.database;

  const [sql, setSql] = useState(
    question?.starterCode ??
      "-- Write your solution here",
  );

  const [rows, setRows] = useState<
    Record<string, unknown>[]
  >([]);

  const [error, setError] = useState("");

  const [executionStatus, setExecutionStatus] =
    useState<ExecutionStatus>("idle");

  const [executionTime, setExecutionTime] =
    useState<number | null>(null);

  const [isDatabaseReady, setIsDatabaseReady] =
    useState(false);

  const [validationMessage, setValidationMessage] =
    useState("");

  const [isCorrect, setIsCorrect] =
    useState<boolean | null>(null);

  const databaseRef =
    useRef<PGlite | null>(null);

  useEffect(() => {
    setSql(
      question?.starterCode ??
        "-- Write your solution here",
    );

    setRows([]);
    setError("");
    setExecutionStatus("idle");
    setExecutionTime(null);
    setValidationMessage("");
    setIsCorrect(null);
  }, [question?.id, question?.starterCode]);

  useEffect(() => {
    let cancelled = false;

    async function initializeDatabase() {
      setIsDatabaseReady(false);
      setRows([]);
      setError("");
      setExecutionStatus("idle");
      setExecutionTime(null);
      setValidationMessage("");
      setIsCorrect(null);

      if (!database) {
        return;
      }

      try {
        const db =
          await createQuestionDatabase(database);

        if (cancelled) {
          await db.close();
          return;
        }

        databaseRef.current = db;

        setIsDatabaseReady(true);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : String(err);

        setError(
          `Failed to initialize the database: ${message}`,
        );

        setExecutionStatus("error");
      }
    }

    void initializeDatabase();

    return () => {
      cancelled = true;

      const db = databaseRef.current;

      databaseRef.current = null;

      if (db) {
        void db.close();
      }
    };
  }, [question?.id, database]);

  const runQuery = async () => {
    const currentQuestion = question;

    if (!currentQuestion) {
      setError("Question not found.");
      setExecutionStatus("error");
      return;
    }

    const db = databaseRef.current;

    if (!db) {
      setError("Database is not ready yet.");
      setExecutionStatus("error");
      return;
    }

    if (!sql.trim()) {
      setError("Please enter a SQL query.");
      setExecutionStatus("error");
      return;
    }

    setExecutionStatus("running");
    setError("");
    setRows([]);
    setExecutionTime(null);
    setValidationMessage("");
    setIsCorrect(null);

    const startTime = performance.now();

    try {
      const result =
        await db.query<Record<string, unknown>>(
          sql,
        );

      const elapsed =
        performance.now() - startTime;

      setRows(result.rows);
      setExecutionTime(elapsed);
      setExecutionStatus("success");

      if (
        currentQuestion.validation?.type ===
        "result"
      ) {
        const validation = validateResult(
          result.rows,
          currentQuestion.validation.expectedResult,
        );

        setIsCorrect(validation.correct);
        setValidationMessage(
          validation.message,
        );
      }
    } catch (err) {
      const elapsed =
        performance.now() - startTime;

      const message =
        err instanceof Error
          ? err.message
          : String(err);

      setError(message);
      setExecutionTime(elapsed);
      setExecutionStatus("error");
      setValidationMessage("");
      setIsCorrect(null);
    }
  };

  const resetQuery = () => {
    setSql(
      question?.starterCode ??
        "-- Write your solution here",
    );

    setRows([]);
    setError("");
    setExecutionStatus("idle");
    setExecutionTime(null);
    setValidationMessage("");
    setIsCorrect(null);
  };

  if (!question) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] p-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Question not found
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            The requested question does not exist.
          </p>

          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Questions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Questions
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Practice
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1400px]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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

            <h1 className="mt-4 text-2xl font-semibold text-gray-900">
              {question.title}
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              {question.description}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
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
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="font-semibold text-gray-900">
                  Problem
                </h2>
              </div>

              <div className="p-5">
                <h3 className="text-sm font-semibold text-gray-900">
                  Task
                </h3>

                <p className="mt-2 text-sm leading-6 text-gray-500">
                  {question.description}
                </p>

                {database && (
                  <div className="mt-7">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Database
                      </h3>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${
                            isDatabaseReady
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-amber-50 text-amber-600"
                          }`}
                        >
                          {isDatabaseReady
                            ? "Ready"
                            : "Loading"}
                        </span>

                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                          {database.engine}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 space-y-4">
                      {database.tables.map((table) => (
                        <div
                          key={table.name}
                          className="overflow-hidden rounded-lg border border-gray-200"
                        >
                          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                            <span className="font-mono text-sm font-medium text-gray-800">
                              {table.name}
                            </span>

                            <span className="text-xs text-gray-400">
                              {table.rows.length} rows
                            </span>
                          </div>

                          <div className="divide-y divide-gray-100">
                            {table.columns.map((column) => (
                              <div
                                key={column.name}
                                className="flex items-center justify-between px-4 py-2.5"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-gray-700">
                                    {column.name}
                                  </span>

                                  {!column.nullable && (
                                    <span className="text-[10px] text-gray-300">
                                      NOT NULL
                                    </span>
                                  )}
                                </div>

                                <span className="font-mono text-xs text-gray-400">
                                  {column.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-gray-900">
                    SQL Editor
                  </h2>

                  <p className="mt-1 text-xs text-gray-400">
                    PostgreSQL runs directly in your browser.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetQuery}
                    disabled={
                      executionStatus === "running"
                    }
                    className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={runQuery}
                    disabled={
                      !isDatabaseReady ||
                      executionStatus === "running"
                    }
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition ${
                      executionStatus === "running"
                        ? "cursor-wait bg-gray-600"
                        : "bg-gray-900 hover:bg-gray-800"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {executionStatus === "running" ? (
                      <Loader2
                        size={14}
                        className="animate-spin"
                      />
                    ) : (
                      <Play size={14} />
                    )}

                    {executionStatus === "running"
                      ? "Running..."
                      : "Run"}
                  </button>
                </div>
              </div>

              <div className="p-5">
                <textarea
                  value={sql}
                  onChange={(event) =>
                    setSql(event.target.value)
                  }
                  spellCheck={false}
                  className="min-h-[360px] w-full resize-y rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-sm leading-6 text-gray-100 outline-none focus:border-gray-400"
                />

                {executionStatus === "success" && (
                  <div
                    className={`mt-4 rounded-lg border px-4 py-3 ${
                      isCorrect
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isCorrect ? (
                          <CheckCircle2
                            size={16}
                            className="text-emerald-600"
                          />
                        ) : (
                          <XCircle
                            size={16}
                            className="text-amber-600"
                          />
                        )}

                        <span
                          className={`text-xs font-semibold ${
                            isCorrect
                              ? "text-emerald-700"
                              : "text-amber-700"
                          }`}
                        >
                          {isCorrect
                            ? "Correct answer!"
                            : "Query executed, but answer is incorrect"}
                        </span>
                      </div>

                      <div
                        className={`flex items-center gap-3 text-xs ${
                          isCorrect
                            ? "text-emerald-600"
                            : "text-amber-600"
                        }`}
                      >
                        <span>
                          {rows.length}{" "}
                          {rows.length === 1
                            ? "row"
                            : "rows"}
                        </span>

                        {executionTime !== null && (
                          <span className="flex items-center gap-1">
                            <Clock3 size={12} />
                            {executionTime.toFixed(2)} ms
                          </span>
                        )}
                      </div>
                    </div>

                    {validationMessage && (
                      <p
                        className={`mt-2 text-xs ${
                          isCorrect
                            ? "text-emerald-600"
                            : "text-amber-600"
                        }`}
                      >
                        {validationMessage}
                      </p>
                    )}
                  </div>
                )}

                {executionStatus === "error" && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2">
                      <XCircle
                        size={16}
                        className="text-red-600"
                      />

                      <span className="text-xs font-semibold text-red-700">
                        Query failed
                      </span>

                      {executionTime !== null && (
                        <span className="ml-auto text-xs text-red-500">
                          {executionTime.toFixed(2)} ms
                        </span>
                      )}
                    </div>

                    <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-red-600">
                      {error}
                    </pre>
                  </div>
                )}

                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Results
                    </h3>

                    {rows.length > 0 && (
                      <span className="text-xs text-gray-400">
                        {rows.length} rows
                      </span>
                    )}
                  </div>

                  {rows.length > 0 ? (
                    <div className="mt-3 overflow-auto rounded-lg border border-gray-200">
                      <table className="min-w-full text-left text-xs">
                        <thead className="border-b border-gray-200 bg-gray-50">
                          <tr>
                            {Object.keys(rows[0]).map(
                              (column) => (
                                <th
                                  key={column}
                                  className="whitespace-nowrap px-4 py-3 font-semibold text-gray-600"
                                >
                                  {column}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-100">
                          {rows.map((row, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className="hover:bg-gray-50"
                            >
                              {Object.keys(rows[0]).map(
                                (column) => (
                                  <td
                                    key={column}
                                    className="whitespace-nowrap px-4 py-3 font-mono text-gray-600"
                                  >
                                    {row[column] === null
                                      ? "NULL"
                                      : String(
                                          row[column],
                                        )}
                                  </td>
                                ),
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    executionStatus !== "error" && (
                      <div className="mt-3 flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50">
                        <p className="text-xs text-gray-400">
                          {executionStatus === "running"
                            ? "Executing query..."
                            : "Run your query to see results."}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

export default QuestionPage;