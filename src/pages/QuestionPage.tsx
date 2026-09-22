import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  History,
  Loader2,
  Play,
  RotateCcw,
  Table2,
  XCircle,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import type { PGlite } from "@electric-sql/pglite";

import { questions } from "../data/questions";
import type { Question } from "../data/questions";
import type { TableDefinition } from "../data/questions";
import type { AdminFormDraft } from "./AdminPage";
import { getAdminQuestions } from "../lib/adminQuestions";
import {
  clearAttempts,
  getAttempts,
  recordAttempt,
} from "../lib/attempts";
import type { QuestionAttempt } from "../lib/attempts";
import { createQuestionDatabase } from "../lib/pglite";
import {
  buildPysparkSnippet,
  PysparkClient,
} from "../lib/pysparkClient";
import {
  isQuestionSolved,
  markQuestionSolved,
} from "../lib/progress";
import { validateResult } from "../lib/validation";

type ExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "error";

function SchemaTable({
  table,
  onPreviewRows,
}: {
  table: TableDefinition;
  onPreviewRows: (
    tableName: string,
  ) => Promise<Record<string, unknown>[]>;
}) {
  const [isExpanded, setIsExpanded] =
    useState(true);

  const [isPreviewVisible, setIsPreviewVisible] =
    useState(false);

  const [previewRows, setPreviewRows] = useState<
    Record<string, unknown>[] | null
  >(null);

  const [isPreviewLoading, setIsPreviewLoading] =
    useState(false);

  const [previewError, setPreviewError] =
    useState("");

  const previewColumns =
    previewRows && previewRows.length > 0
      ? Object.keys(previewRows[0])
      : [];

  const handlePreviewToggle = async () => {
    if (isPreviewLoading) {
      return;
    }

    if (isPreviewVisible) {
      setIsPreviewVisible(false);
      return;
    }

    if (previewRows !== null && !previewError) {
      setIsPreviewVisible(true);
      return;
    }

    setIsPreviewLoading(true);
    setPreviewError("");

    try {
      const rows = await onPreviewRows(table.name);

      setPreviewRows(rows);
      setIsPreviewVisible(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : String(err);

      setPreviewError(message);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  return (
    <div>
      <div className="flex w-full items-center gap-2 py-3">
        <button
          type="button"
          onClick={() =>
            setIsExpanded((previous) => !previous)
          }
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isExpanded ? (
            <ChevronDown
              size={15}
              className="shrink-0 text-gray-400"
            />
          ) : (
            <ChevronRight
              size={15}
              className="shrink-0 text-gray-400"
            />
          )}

          <Table2
            size={15}
            className="shrink-0 text-gray-500"
          />

          <span className="truncate font-mono text-sm font-medium text-gray-800">
            {table.name}
          </span>

          <span className="ml-auto shrink-0 text-xs text-gray-400">
            {table.columns.length}{" "}
            {table.columns.length === 1
              ? "column"
              : "columns"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => void handlePreviewToggle()}
          disabled={isPreviewLoading}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPreviewLoading ? (
            <Loader2
              size={13}
              className="animate-spin"
            />
          ) : isPreviewVisible ? (
            <EyeOff size={13} />
          ) : (
            <Eye size={13} />
          )}

          {isPreviewLoading
            ? "Loading..."
            : isPreviewVisible
              ? "Hide preview"
              : "Preview data"}
        </button>
      </div>

      {isExpanded && (
        <div className="pb-3 pl-7">
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {table.columns.map((column) => (
              <div
                key={column.name}
                className="flex items-center justify-between gap-4 bg-gray-50/60 px-4 py-2"
              >
                <span className="font-mono text-xs text-gray-700">
                  {column.name}
                </span>

                <span className="font-mono text-xs text-gray-400">
                  {column.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(isPreviewVisible ||
        isPreviewLoading ||
        previewError) && (
        <div className="pb-3 pl-7">
          {isPreviewLoading && previewRows === null && !previewError ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-center">
              <p className="text-xs text-gray-400">
                Loading...
              </p>
            </div>
          ) : previewError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs text-red-600">
                Preview failed: {previewError}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
                <span className="text-xs font-medium text-gray-600">
                  Preview
                </span>

                <span className="text-xs text-gray-400">
                  {(previewRows ?? []).length}{" "}
                  {(previewRows ?? []).length === 1
                    ? "row"
                    : "rows"}
                </span>
              </div>

              {(previewRows ?? []).length > 0 ? (
                <div className="overflow-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="border-b border-gray-200 bg-gray-50">
                      <tr>
                        {previewColumns.map(
                          (column) => (
                            <th
                              key={column}
                              className="whitespace-nowrap px-4 py-2 font-semibold text-gray-600"
                            >
                              {column}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100">
                      {(previewRows ?? []).map(
                        (row, rowIndex) => (
                          <tr
                            key={rowIndex}
                            className="hover:bg-gray-50"
                          >
                            {previewColumns.map(
                              (column) => (
                                <td
                                  key={column}
                                  className="whitespace-nowrap px-4 py-2 font-mono text-gray-600"
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
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-3 text-xs text-gray-400">
                  No rows found.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionPage() {
  const { questionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const locationState = location.state as {
    previewQuestion?: Question;
    formDraft?: AdminFormDraft;
  } | null;

  const previewQuestion =
    locationState?.previewQuestion ?? null;

  const isPreviewRoute =
    location.pathname === "/admin/preview";

  const isPreview =
    isPreviewRoute && previewQuestion !== null;

  const allQuestions = useMemo(
    () => [...questions, ...getAdminQuestions()],
    [questionId],
  );

  const question =
    isPreviewRoute && previewQuestion !== null
      ? previewQuestion
      : allQuestions.find(
          (item) => item.id === questionId,
        );

  const currentQuestionIndex = allQuestions.findIndex(
    (item) => item.id === questionId,
  );

  const previousQuestion =
    currentQuestionIndex > 0
      ? allQuestions[currentQuestionIndex - 1]
      : null;

  const nextQuestion =
    currentQuestionIndex >= 0 &&
    currentQuestionIndex < allQuestions.length - 1
      ? allQuestions[currentQuestionIndex + 1]
      : null;

  const database = question?.database;

  const isPySpark =
    question?.questionType === "PySpark";

  type PysparkStatus =
    | "idle"
    | "booting"
    | "running"
    | "success"
    | "error";

  const [pysparkStatus, setPysparkStatus] =
    useState<PysparkStatus>("idle");
  const [pysparkDetail, setPysparkDetail] =
    useState("");
  const [pysparkOutput, setPysparkOutput] =
    useState("");
  const [pysparkError, setPysparkError] =
    useState("");

  const pysparkClientRef =
    useRef<PysparkClient | null>(null);

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

  const [isSolved, setIsSolved] = useState(
    question && !isPreview
      ? isQuestionSolved(question.id)
      : false,
  );

  const [attempts, setAttempts] = useState<QuestionAttempt[]>(
    () =>
      question && !isPreview
        ? getAttempts(question.id)
        : [],
  );

  const databaseRef =
    useRef<PGlite | null>(null);

  const [isCopied, setIsCopied] = useState(false);

  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      pysparkClientRef.current?.dispose();
      pysparkClientRef.current = null;
    };
  }, []);

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
    setIsCopied(false);

    pysparkClientRef.current?.dispose();
    pysparkClientRef.current = null;
    setPysparkStatus("idle");
    setPysparkDetail("");
    setPysparkOutput("");
    setPysparkError("");

    setAttempts(
      question && !isPreview
        ? getAttempts(question.id)
        : [],
    );

    setIsSolved(
      question && !isPreview
        ? isQuestionSolved(question.id)
        : false,
    );
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
    if (executionStatus === "running") {
      return;
    }

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

      let attemptCorrect = false;

      if (
        currentQuestion.validation?.type ===
        "result"
      ) {
        const validation = validateResult(
          result.rows,
          currentQuestion.validation.expectedResult,
          currentQuestion.validation.orderMatters ??
            false,
        );

        setIsCorrect(validation.correct);
        setValidationMessage(
          validation.message,
        );

        attemptCorrect = validation.correct;

        if (validation.correct && !isPreview) {
          markQuestionSolved(
            currentQuestion.id,
          );

          setIsSolved(true);
        }
      }

      if (!isPreview) {
        setAttempts(
          recordAttempt(currentQuestion.id, {
            executedSuccessfully: true,
            isCorrect: attemptCorrect,
            rowCount: result.rows.length,
            executionTimeMs: elapsed,
          }),
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

      if (currentQuestion && !isPreview) {
        setAttempts(
          recordAttempt(currentQuestion.id, {
            executedSuccessfully: false,
            isCorrect: false,
            rowCount: 0,
            executionTimeMs: elapsed,
          }),
        );
      }
    }
  };

  const resetQuery = () => {
    setSql(question?.starterCode ?? "");

    setRows([]);
    setError("");
    setExecutionStatus("idle");
    setExecutionTime(null);
    setValidationMessage("");
    setIsCorrect(null);

    setPysparkStatus("idle");
    setPysparkDetail("");
    setPysparkOutput("");
    setPysparkError("");
  };

  const runPySpark = async () => {
    if (
      pysparkStatus === "booting" ||
      pysparkStatus === "running"
    ) {
      return;
    }

    if (!sql.trim()) {
      setPysparkStatus("error");
      setPysparkDetail("");
      setPysparkOutput("");
      setPysparkError(
        "Write some PySpark code first.",
      );
      return;
    }

    setPysparkOutput("");
    setPysparkError("");

    let client = pysparkClientRef.current;

    try {
      if (!client) {
        client = new PysparkClient(
          (_stage, message) => {
            setPysparkStatus("booting");
            setPysparkDetail(message);
          },
        );
        pysparkClientRef.current = client;

        setPysparkStatus("booting");
        setPysparkDetail("Starting Web Worker ...");

        await client.boot();
      }

      if (pysparkClientRef.current !== client) {
        return;
      }

      setPysparkStatus("running");
      setPysparkDetail(
        "Executing on real Spark 4.2.0 ...",
      );

      const stdout = await client.run(
        buildPysparkSnippet(sql),
      );

      if (pysparkClientRef.current !== client) {
        return;
      }

      setPysparkOutput(
        stdout.trim() === ""
          ? "(no output)"
          : stdout,
      );
      setPysparkStatus("success");
      setPysparkDetail("");
    } catch (e) {
      if (pysparkClientRef.current !== client) {
        return;
      }

      setPysparkStatus("error");
      setPysparkDetail("");
      setPysparkOutput("");
      setPysparkError(
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql);

      setIsCopied(true);

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false);
      }, 1800);
    } catch {
      setIsCopied(false);
    }
  };

  const previewTableRows = async (
    tableName: string,
  ): Promise<Record<string, unknown>[]> => {
    const db = databaseRef.current;

    if (!db) {
      throw new Error("Database is not ready yet.");
    }

    const quotedTableName = `"${tableName.replaceAll('"', '""')}"`;

    const result =
      await db.query<Record<string, unknown>>(
        `SELECT * FROM ${quotedTableName} LIMIT 5`,
      );

    return result.rows;
  };

  const handleClearHistory = () => {
    if (!question) {
      return;
    }

    clearAttempts(question.id);
    setAttempts([]);
  };

  if (isPreviewRoute && previewQuestion === null) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] p-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Preview is unavailable
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            Preview is unavailable. Return to the
            builder.
          </p>

          <Link
            to="/admin"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Builder
          </Link>
        </div>
      </div>
    );
  }

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
          {isPreview ? (
            <>
              <Link
                to="/admin"
                state={
                  locationState?.formDraft
                    ? {
                        formDraft:
                          locationState.formDraft,
                      }
                    : undefined
                }
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
              >
                <ArrowLeft size={17} />
                Back to Builder
              </Link>

              <div className="mx-4 h-5 w-px bg-gray-200" />

              <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                Admin Preview
              </span>
            </>
          ) : (
            <>
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

              {isSolved && (
                <>
                  <div className="mx-4 h-5 w-px bg-gray-200" />

                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
                    <CheckCircle2 size={13} />
                    Solved
                  </span>
                </>
              )}
            </>
          )}
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

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-gray-900">
                {question.title}
              </h1>

              {isSolved && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 size={13} />
                  Solved
                </span>
              )}
            </div>

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

          {database && database.tables.length > 0 && (
            <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
                <Table2
                  size={16}
                  className="text-gray-500"
                />

                <h2 className="font-semibold text-gray-900">
                  Schema Explorer
                </h2>

                <span className="text-xs text-gray-400">
                  {database.tables.length}{" "}
                  {database.tables.length === 1
                    ? "table"
                    : "tables"}
                </span>
              </div>

              <div className="divide-y divide-gray-100 px-5">
                {database.tables.map((table) => (
                  <SchemaTable
                    key={`${question.id}-${table.name}`}
                    table={table}
                    onPreviewRows={previewTableRows}
                  />
                ))}
              </div>
            </section>
          )}

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
                  <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                    {isPySpark
                      ? "PySpark Editor"
                      : "SQL Editor"}
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-medium text-gray-600">
                      {isPySpark ? "PySpark" : "SQL"}
                    </span>
                  </h2>

                  <p className="mt-1 text-xs text-gray-400">
                    {isPySpark
                      ? "Real Spark 4.2.0 execution in your browser."
                      : "PostgreSQL runs directly in your browser."}
                  </p>
                </div>

                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  {isPySpark
                    ? "Spark Connect"
                    : "PostgreSQL"}
                </span>
              </div>

              <div className="p-5">
                <textarea
                  value={sql}
                  onChange={(event) =>
                    setSql(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey ||
                        event.metaKey)
                    ) {
                      event.preventDefault();

                      if (isPySpark) {
                        void runPySpark();
                        return;
                      }

                      if (
                        !isDatabaseReady ||
                        executionStatus ===
                          "running"
                      ) {
                        return;
                      }

                      void runQuery();
                    }
                  }}
                  spellCheck={false}
                  className="min-h-[360px] w-full resize-y rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-sm leading-6 text-gray-100 outline-none focus:border-gray-400"
                />

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={
                      isPySpark
                        ? runPySpark
                        : runQuery
                    }
                    disabled={
                      isPySpark
                        ? pysparkStatus ===
                            "booting" ||
                          pysparkStatus === "running"
                        : !isDatabaseReady ||
                          executionStatus === "running"
                    }
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-white transition ${
                      (isPySpark
                        ? pysparkStatus === "running" ||
                          pysparkStatus === "booting"
                        : executionStatus ===
                          "running")
                        ? "cursor-wait bg-gray-600"
                        : "bg-gray-900 hover:bg-gray-800"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {(isPySpark
                      ? pysparkStatus === "running" ||
                        pysparkStatus === "booting"
                      : executionStatus ===
                        "running") ? (
                      <Loader2
                        size={14}
                        className="animate-spin"
                      />
                    ) : (
                      <Play size={14} />
                    )}

                    {isPySpark
                      ? pysparkStatus === "booting"
                        ? "Starting Python..."
                        : pysparkStatus === "running"
                          ? "Running..."
                          : "Run PySpark"
                      : executionStatus === "running"
                        ? "Running..."
                        : "Run Query"}
                  </button>

                  <button
                    type="button"
                    onClick={resetQuery}
                    disabled={
                      executionStatus === "running"
                    }
                    className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-xs text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    Reset Code
                  </button>

                  <button
                    type="button"
                    onClick={() => void copySql()}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    {isCopied ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    {isCopied
                      ? "Copied"
                      : isPySpark
                        ? "Copy Code"
                        : "Copy SQL"}
                  </button>

                  <span className="ml-auto text-xs text-gray-400">
                    Ctrl/Cmd + Enter to run
                  </span>
                </div>

                {isPySpark ? (
                  <>
                    {(pysparkStatus === "booting" ||
                      pysparkStatus === "running") && (
                      <div className="mt-4 flex min-h-[120px] items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
                        <Loader2
                          size={14}
                          className="animate-spin text-gray-400"
                        />

                        <p className="text-xs text-gray-500">
                          {pysparkDetail ||
                            "Starting PySpark ..."}
                        </p>
                      </div>
                    )}

                    {pysparkStatus === "success" && (
                      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2">
                          <CheckCircle2
                            size={16}
                            className="text-emerald-600"
                          />

                          <span className="text-xs font-semibold text-emerald-700">
                            Spark execution succeeded
                          </span>
                        </div>

                        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-emerald-700">
                          {pysparkOutput}
                        </pre>
                      </div>
                    )}

                    {pysparkStatus === "error" && (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                        <div className="flex items-center gap-2">
                          <XCircle
                            size={16}
                            className="text-red-600"
                          />

                          <span className="text-xs font-semibold text-red-700">
                            PySpark run failed
                          </span>
                        </div>

                        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-red-600">
                          {pysparkError}
                        </pre>
                      </div>
                    )}

                    {pysparkStatus === "idle" && (
                      <div className="mt-4 flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
                        <p className="text-xs text-gray-400">
                          Run your PySpark code to see
                          the Spark result.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
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

                    {executionStatus === "success" ? (
                      <span className="text-xs text-gray-400">
                        {rows.length}{" "}
                        {rows.length === 1
                          ? "row"
                          : "rows"}
                      </span>
                    ) : (
                      rows.length > 0 && (
                        <span className="text-xs text-gray-400">
                          {rows.length} rows
                        </span>
                      )
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
                      <div className="mt-3 flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
                        <p className="text-xs text-gray-400">
                          {executionStatus === "running"
                            ? "Executing query..."
                            : executionStatus ===
                                "success"
                              ? "Query executed successfully. 0 rows returned."
                              : "Run your query to see results."}
                        </p>
                      </div>
                    )
                  )}
                </div>
                  </>
                )}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
              <History
                size={16}
                className="text-gray-500"
              />

              <h2 className="font-semibold text-gray-900">
                Attempt History
              </h2>

              <span className="text-xs text-gray-400">
                {attempts.length}{" "}
                {attempts.length === 1
                  ? "attempt"
                  : "attempts"}
              </span>

              {attempts.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Clear history
                </button>
              )}
            </div>

            <div className="p-5">
              {attempts.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No attempts yet. Run your query to
                  start your history.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {[...attempts]
                    .reverse()
                    .map((attempt, index) => {
                      const status = !attempt.executedSuccessfully
                        ? "error"
                        : attempt.isCorrect
                          ? "correct"
                          : "incorrect";

                      return (
                        <li
                          key={`${attempt.timestamp}-${index}`}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                        >
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                              status === "correct"
                                ? "text-emerald-600"
                                : status === "error"
                                  ? "text-red-600"
                                  : "text-amber-600"
                            }`}
                          >
                            {status === "correct" ? (
                              <CheckCircle2 size={13} />
                            ) : (
                              <XCircle size={13} />
                            )}

                            {status === "correct"
                              ? "Correct"
                              : status === "error"
                                ? "Error"
                                : "Incorrect"}
                          </span>

                          <span className="text-xs text-gray-500">
                            {attempt.rowCount}{" "}
                            {attempt.rowCount === 1
                              ? "row"
                              : "rows"}
                          </span>

                          {attempt.executionTimeMs !==
                            null && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock3 size={12} />
                              {attempt.executionTimeMs.toFixed(
                                2,
                              )}{" "}
                              ms
                            </span>
                          )}

                          <span className="ml-auto text-xs text-gray-400">
                            {new Date(
                              attempt.timestamp,
                            ).toLocaleString()}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </section>

          {!isPreview && (
            <nav className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => {
                if (previousQuestion) {
                  navigate(
                    `/question/${previousQuestion.id}`,
                  );
                }
              }}
              disabled={!previousQuestion}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft size={16} />
              Previous Question
            </button>

            <span className="text-xs text-gray-500">
              {currentQuestionIndex >= 0
                ? `Question ${currentQuestionIndex + 1} of ${allQuestions.length}`
                : `Question 0 of ${allQuestions.length}`}
            </span>

            <button
              type="button"
              onClick={() => {
                if (nextQuestion) {
                  navigate(
                    `/question/${nextQuestion.id}`,
                  );
                }
              }}
              disabled={!nextQuestion}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              Next Question
              <ChevronRight size={16} />
            </button>
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}

export default QuestionPage;