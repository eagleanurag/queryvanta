import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Pencil,
  Play,
  Plus,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import type {
  ColumnType,
  Difficulty,
  Question,
} from "../data/questions";

import { questions as builtInQuestions } from "../data/questions";

import {
  clearAdminQuestions,
  combineQuestionCatalogs,
  deleteAdminQuestion,
  deleteAdminQuestions,
  duplicateAdminQuestion,
  getAdminQuestions,
  importAdminQuestions,
  isQuestionEnabled,
  saveAdminQuestion,
  setAdminQuestionEnabled,
  updateAdminQuestion,
  validateImportedQuestions,
} from "../lib/adminQuestions";
import { getBookmarkedQuestionIds } from "../lib/bookmarks";
import { createQuestionDatabase } from "../lib/pglite";
import { getPracticeHistory } from "../lib/practiceSession";
import { isQuestionSolved } from "../lib/progress";
import { PysparkClient } from "../lib/pysparkClient";
import { validateResult } from "../lib/validation";

const LOCAL_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title-az", label: "Title A-Z" },
  { value: "title-za", label: "Title Z-A" },
] as const;

type LocalSortOrder =
  (typeof LOCAL_SORT_OPTIONS)[number]["value"];

const COLUMN_TYPES: ColumnType[] = [
  "INTEGER",
  "BIGINT",
  "DECIMAL",
  "TEXT",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
];

const DIFFICULTIES: Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
];

type ColumnDraft = {
  name: string;
  type: ColumnType;
};

type TableDraft = {
  name: string;
  columns: ColumnDraft[];
  sampleRowsText: string;
};

export type AdminFormDraft = {
  title: string;
  description: string;
  difficulty: Difficulty;
  questionType: Question["questionType"];
  category: string;
  companiesText: string;
  languagesText: string;
  tagsText: string;
  starterSql: string;
  expectedResultText: string;
  hint: string;
  solutionCode: string;
  explanation: string;
  enabled: boolean;
  questionId: string;
  tables: TableDraft[];
  editingQuestionId: string | null;
};

function createEmptyTable(): TableDraft {
  return {
    name: "",
    columns: [{ name: "", type: "TEXT" }],
    sampleRowsText: "[]",
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function generateQuestionId(): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2, 8);

  return `admin-${Date.now()}-${randomSuffix}`;
}

function generatePreviewId(): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2, 8);

  return `preview-${Date.now()}-${randomSuffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

const inputClassName =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-gray-400";

const labelClassName =
  "mb-1.5 block text-sm font-medium text-gray-700";

function AdminPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const incomingDraft = (
    location.state as {
      formDraft?: AdminFormDraft;
    } | null
  )?.formDraft;

  const [title, setTitle] = useState(
    incomingDraft?.title ?? "",
  );
  const [description, setDescription] = useState(
    incomingDraft?.description ?? "",
  );
  const [difficulty, setDifficulty] =
    useState<Difficulty>(
      incomingDraft?.difficulty ?? "Easy",
    );
  const [questionType, setQuestionType] = useState<
    "SQL" | "PySpark"
  >(
    incomingDraft?.questionType === "PySpark"
      ? "PySpark"
      : "SQL",
  );
  const [category, setCategory] = useState(
    incomingDraft?.category ?? "",
  );
  const [companiesText, setCompaniesText] = useState(
    incomingDraft?.companiesText ?? "",
  );
  const [languagesText, setLanguagesText] = useState(
    incomingDraft?.languagesText ?? "",
  );
  const [tagsText, setTagsText] = useState(
    incomingDraft?.tagsText ?? "",
  );
  const [starterSql, setStarterSql] = useState(
    incomingDraft?.starterSql ?? "",
  );
  const [expectedResultText, setExpectedResultText] =
    useState(
      incomingDraft?.expectedResultText ?? "[]",
    );
  const [hint, setHint] = useState(
    incomingDraft?.hint ?? "",
  );
  const [solutionCode, setSolutionCode] = useState(
    incomingDraft?.solutionCode ?? "",
  );
  const [explanation, setExplanation] = useState(
    incomingDraft?.explanation ?? "",
  );
  const [enabled, setEnabled] = useState(
    incomingDraft?.enabled ?? true,
  );
  const [questionId, setQuestionId] = useState(
    () =>
      incomingDraft?.questionId ??
      generateQuestionId(),
  );
  const [tables, setTables] = useState<TableDraft[]>(
    incomingDraft?.tables ?? [createEmptyTable()],
  );

  const [errors, setErrors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [createdQuestionId, setCreatedQuestionId] =
    useState("");

  const [adminQuestions, setAdminQuestions] = useState<
    Question[]
  >(() => getAdminQuestions());

  const [confirmClearAll, setConfirmClearAll] =
    useState(false);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const [localSearch, setLocalSearch] = useState("");
  const [localDifficulty, setLocalDifficulty] =
    useState("All");
  const [localQuestionType, setLocalQuestionType] =
    useState("All");
  const [localCategory, setLocalCategory] =
    useState("All");
  const [localCompany, setLocalCompany] =
    useState("All");
  const [localEnabled, setLocalEnabled] = useState<
    "All" | "Enabled" | "Disabled"
  >("All");
  const [localValidation, setLocalValidation] =
    useState<
      "All" | "Has validation" | "No validation"
    >("All");
  const [localSort, setLocalSort] =
    useState<LocalSortOrder>("newest");
  const [selectedIds, setSelectedIds] = useState<
    Set<string>
  >(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] =
    useState(false);

  type ValidationCheck =
    | { status: "idle" }
    | { status: "running"; message: string }
    | {
        status: "ok" | "error";
        message: string;
      };

  const [validationCheck, setValidationCheck] =
    useState<ValidationCheck>({ status: "idle" });

  const [validationRuns, setValidationRuns] =
    useState<
      Record<
        string,
        { ok: boolean; message: string }
      >
    >({});

  const [deleteConfirmId, setDeleteConfirmId] =
    useState<string | null>(null);

  const pysparkClientRef =
    useRef<PysparkClient | null>(null);

  useEffect(() => {
    return () => {
      pysparkClientRef.current?.dispose();
      pysparkClientRef.current = null;
    };
  }, []);

  // Ephemeral validation badges reset whenever the
  // catalog changes so stale results cannot linger.
  const applyAdminQuestions = (
    next: Question[],
  ) => {
    setAdminQuestions(next);
    setValidationRuns({});
    setDeleteConfirmId(null);
  };

  // Effective catalog: built-in questions first
  // in catalog order, then admin questions. Built-in
  // entries win on ID collision.
  const effectiveCatalog = useMemo(
    () =>
      combineQuestionCatalogs(
        builtInQuestions,
        adminQuestions,
      ),
    [adminQuestions],
  );

  const builtInIds = useMemo(
    () =>
      new Set(
        builtInQuestions.map(
          (question) => question.id,
        ),
      ),
    [],
  );

  const catalogStats = useMemo(() => {
    const enabled = effectiveCatalog.filter(
      isQuestionEnabled,
    );

    return {
      total: effectiveCatalog.length,
      enabled: enabled.length,
      sql: effectiveCatalog.filter(
        (question) =>
          question.questionType === "SQL",
      ).length,
      pyspark: effectiveCatalog.filter(
        (question) =>
          question.questionType === "PySpark",
      ).length,
    };
  }, [effectiveCatalog]);

  const localQuestionTypes = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(
          effectiveCatalog.map(
            (question) => question.questionType,
          ),
        ),
      ),
    ],
    [effectiveCatalog],
  );

  const localCategories = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(
          effectiveCatalog
            .map((question) => question.category)
            .filter(
              (category) =>
                category.trim() !== "",
            ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    ],
    [effectiveCatalog],
  );

  const localCompanies = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(
          effectiveCatalog.flatMap(
            (question) => question.companies,
          ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    ],
    [effectiveCatalog],
  );

  const visibleLocalQuestions = useMemo(() => {
    const normalizedSearch = localSearch
      .trim()
      .toLowerCase();

    const filtered = effectiveCatalog.filter(
      (question) => {
        const matchesSearch =
          normalizedSearch === "" ||
          question.title
            .toLowerCase()
            .includes(normalizedSearch) ||
          question.description
            .toLowerCase()
            .includes(normalizedSearch) ||
          question.id
            .toLowerCase()
            .includes(normalizedSearch) ||
          question.category
            .toLowerCase()
            .includes(normalizedSearch) ||
          question.companies.some((company) =>
            company
              .toLowerCase()
              .includes(normalizedSearch),
          ) ||
          question.tags.some((tag) =>
            tag
              .toLowerCase()
              .includes(normalizedSearch),
          );

        const matchesDifficulty =
          localDifficulty === "All" ||
          question.difficulty === localDifficulty;

        const matchesType =
          localQuestionType === "All" ||
          question.questionType ===
            localQuestionType;

        const matchesCategory =
          localCategory === "All" ||
          question.category === localCategory;

        const matchesCompany =
          localCompany === "All" ||
          question.companies.includes(
            localCompany,
          );

        const matchesEnabled =
          localEnabled === "All" ||
          (localEnabled === "Enabled"
            ? isQuestionEnabled(question)
            : !isQuestionEnabled(question));

        const matchesValidation =
          localValidation === "All" ||
          (localValidation === "Has validation"
            ? question.validation !== undefined
            : question.validation === undefined);

        return (
          matchesSearch &&
          matchesDifficulty &&
          matchesType &&
          matchesCategory &&
          matchesCompany &&
          matchesEnabled &&
          matchesValidation
        );
      },
    );

    const sorted = [...filtered];

    if (localSort === "oldest") {
      sorted.reverse();
    } else if (localSort === "title-az") {
      sorted.sort((first, second) =>
        first.title.localeCompare(second.title),
      );
    } else if (localSort === "title-za") {
      sorted.sort((first, second) =>
        second.title.localeCompare(first.title),
      );
    }

    return sorted;
  }, [
    effectiveCatalog,
    localSearch,
    localDifficulty,
    localQuestionType,
    localCategory,
    localCompany,
    localEnabled,
    localValidation,
    localSort,
  ]);

  const hasLocalFilters =
    localSearch.trim() !== "" ||
    localDifficulty !== "All" ||
    localQuestionType !== "All" ||
    localCategory !== "All" ||
    localCompany !== "All" ||
    localEnabled !== "All" ||
    localValidation !== "All";

  const clearLocalFilters = () => {
    setLocalSearch("");
    setLocalDifficulty("All");
    setLocalQuestionType("All");
    setLocalCategory("All");
    setLocalCompany("All");
    setLocalEnabled("All");
    setLocalValidation("All");
  };

  const [editingQuestionId, setEditingQuestionId] =
    useState<string | null>(
      incomingDraft?.editingQuestionId ?? null,
    );

  const isEditing = editingQuestionId !== null;

  const editingQuestionTitle =
    adminQuestions.find(
      (item) => item.id === editingQuestionId,
    )?.title ?? "";

  const updateTable = (
    tableIndex: number,
    update: Partial<TableDraft>,
  ) => {
    setTables((previous) =>
      previous.map((table, index) =>
        index === tableIndex
          ? { ...table, ...update }
          : table,
      ),
    );
  };

  const updateColumn = (
    tableIndex: number,
    columnIndex: number,
    update: Partial<ColumnDraft>,
  ) => {
    setTables((previous) =>
      previous.map((table, index) => {
        if (index !== tableIndex) {
          return table;
        }

        return {
          ...table,
          columns: table.columns.map(
            (column, columnPosition) =>
              columnPosition === columnIndex
                ? { ...column, ...update }
                : column,
          ),
        };
      }),
    );
  };

  const addTable = () => {
    setTables((previous) => [
      ...previous,
      createEmptyTable(),
    ]);
  };

  const removeTable = (tableIndex: number) => {
    setTables((previous) =>
      previous.filter(
        (_, index) => index !== tableIndex,
      ),
    );
  };

  const addColumn = (tableIndex: number) => {
    setTables((previous) =>
      previous.map((table, index) =>
        index === tableIndex
          ? {
              ...table,
              columns: [
                ...table.columns,
                { name: "", type: "TEXT" as ColumnType },
              ],
            }
          : table,
      ),
    );
  };

  const removeColumn = (
    tableIndex: number,
    columnIndex: number,
  ) => {
    setTables((previous) =>
      previous.map((table, index) => {
        if (index !== tableIndex) {
          return table;
        }

        return {
          ...table,
          columns: table.columns.filter(
            (_, columnPosition) =>
              columnPosition !== columnIndex,
          ),
        };
      }),
    );
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDifficulty("Easy");
    setQuestionType("SQL");
    setCategory("");
    setCompaniesText("");
    setLanguagesText("");
    setTagsText("");
    setStarterSql("");
    setExpectedResultText("[]");
    setHint("");
    setSolutionCode("");
    setExplanation("");
    setEnabled(true);
    setQuestionId(generateQuestionId());
    setTables([createEmptyTable()]);
    setValidationCheck({ status: "idle" });
  };

  // Tables left completely empty are treated as
  // absent, so PySpark questions (where tables are
  // optional) don't trip on the default blank row.
  // SQL still requires at least one named table.
  const getEffectiveTables = () =>
    tables.filter(
      (table) =>
        table.name.trim() !== "" ||
        table.columns.some(
          (column) => column.name.trim() !== "",
        ),
    );

  const validateForm = (): {
    validationErrors: string[];
    expectedResult: Record<string, unknown>[];
    tableRows: Record<string, unknown>[][];
  } => {
    const validationErrors: string[] = [];

    if (title.trim() === "") {
      validationErrors.push("Title is required.");
    }

    if (description.trim() === "") {
      validationErrors.push("Description is required.");
    }

    if (category.trim() === "") {
      validationErrors.push("Category is required.");
    }

    if (starterSql.trim() === "") {
      validationErrors.push(
        questionType === "PySpark"
          ? "Starter PySpark code is required."
          : "Starter SQL is required.",
      );
    }

    const effectiveTables = getEffectiveTables();

    if (
      effectiveTables.length === 0 &&
      questionType === "SQL"
    ) {
      validationErrors.push(
        "At least one table is required.",
      );
    }

    const seenTableNames = new Set<string>();

    effectiveTables.forEach((table, tableIndex) => {
      const tableLabel = `Table ${tableIndex + 1}`;
      const tableName = table.name.trim();

      if (tableName === "") {
        validationErrors.push(
          `${tableLabel}: table name is required.`,
        );
      } else {
        const normalized = tableName.toLowerCase();

        if (seenTableNames.has(normalized)) {
          validationErrors.push(
            `${tableLabel}: duplicate table name "${tableName}".`,
          );
        } else {
          seenTableNames.add(normalized);
        }
      }

      if (table.columns.length === 0) {
        validationErrors.push(
          `${tableLabel}: at least one column is required.`,
        );
      }

      const seenColumnNames = new Set<string>();

      table.columns.forEach((column, columnIndex) => {
        const columnName = column.name.trim();

        if (columnName === "") {
          validationErrors.push(
            `${tableLabel}, column ${columnIndex + 1}: column name is required.`,
          );
        } else {
          const normalized =
            columnName.toLowerCase();

          if (seenColumnNames.has(normalized)) {
            validationErrors.push(
              `${tableLabel}: duplicate column name "${columnName}".`,
            );
          } else {
            seenColumnNames.add(normalized);
          }
        }

        if (!COLUMN_TYPES.includes(column.type)) {
          validationErrors.push(
            `${tableLabel}: unsupported column type "${column.type}".`,
          );
        }
      });
    });

    let expectedResult: Record<string, unknown>[] = [];

    try {
      const parsedExpected: unknown = JSON.parse(
        expectedResultText.trim() === ""
          ? "[]"
          : expectedResultText,
      );

      if (!Array.isArray(parsedExpected)) {
        validationErrors.push(
          "Expected Result must be a JSON array.",
        );
      } else if (
        !parsedExpected.every(isRecord)
      ) {
        validationErrors.push(
          "Expected Result rows must be JSON objects.",
        );
      } else {
        expectedResult = parsedExpected;
      }
    } catch {
      validationErrors.push(
        "Expected Result must be valid JSON.",
      );
    }

    const tableRows: Record<string, unknown>[][] = [];

    effectiveTables.forEach((table, tableIndex) => {
      const tableLabel =
        table.name.trim() === ""
          ? `Table ${tableIndex + 1}`
          : `Table "${table.name.trim()}"`;

      try {
        const parsedRows: unknown = JSON.parse(
          table.sampleRowsText.trim() === ""
            ? "[]"
            : table.sampleRowsText,
        );

        if (!Array.isArray(parsedRows)) {
          validationErrors.push(
            `${tableLabel}: sample rows must be a JSON array.`,
          );
          tableRows.push([]);
        } else if (!parsedRows.every(isRecord)) {
          validationErrors.push(
            `${tableLabel}: sample rows must be JSON objects.`,
          );
          tableRows.push([]);
        } else {
          tableRows.push(parsedRows);
        }
      } catch {
        validationErrors.push(
          `${tableLabel}: sample rows must be valid JSON.`,
        );
        tableRows.push([]);
      }
    });

    return {
      validationErrors,
      expectedResult,
      tableRows,
    };
  };

  const buildQuestion = (
    id: string,
    expectedResult: Record<string, unknown>[],
    tableRows: Record<string, unknown>[][],
  ): Question => {
    const languages = parseCsv(languagesText);

    const defaultLanguages =
      questionType === "PySpark"
        ? ["PySpark"]
        : ["PostgreSQL"];

    const effectiveTables = getEffectiveTables();

    return {
      id,
      title: title.trim(),
      description: description.trim(),
      difficulty,
      questionType,
      category: category.trim(),
      languages:
        languages.length > 0
          ? languages
          : defaultLanguages,
      tags: parseCsv(tagsText),
      companies: parseCsv(companiesText),
      solved: false,
      enabled,
      ...(effectiveTables.length === 0
        ? {}
        : {
            database: {
              engine: "PostgreSQL" as const,
              tables: effectiveTables.map(
                (table, tableIndex) => ({
                  name: table.name.trim(),
                  columns: table.columns.map(
                    (column) => ({
                      name: column.name.trim(),
                      type: column.type,
                    }),
                  ),
                  rows: tableRows[tableIndex] ?? [],
                }),
              ),
            },
          }),
      starterCode: starterSql,
      ...(hint.trim() !== ""
        ? { hint: hint.trim() }
        : {}),
      ...(solutionCode !== ""
        ? { solutionCode }
        : {}),
      ...(explanation.trim() !== ""
        ? { explanation: explanation.trim() }
        : {}),
      validation: {
        type: "result",
        orderMatters: false,
        expectedResult,
      },
    };
  };

  const captureDraft = (): AdminFormDraft => ({
    title,
    description,
    difficulty,
    questionType,
    category,
    companiesText,
    languagesText,
    tagsText,
    starterSql,
    expectedResultText,
    hint,
    solutionCode,
    explanation,
    enabled,
    questionId,
    tables,
    editingQuestionId,
  });

  const handleSubmit = () => {
    const {
      validationErrors,
      expectedResult,
      tableRows,
    } = validateForm();

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setSuccessMessage("");
      setCreatedQuestionId("");
      return;
    }

    const trimmedId = questionId.trim();

    if (trimmedId === "") {
      setErrors(["Question ID is required."]);
      setSuccessMessage("");
      setCreatedQuestionId("");
      return;
    }

    if (!isEditing) {
      const builtInIds = new Set(
        builtInQuestions.map(
          (question) => question.id,
        ),
      );
      const adminIds = new Set(
        getAdminQuestions().map(
          (question) => question.id,
        ),
      );

      if (
        builtInIds.has(trimmedId) ||
        adminIds.has(trimmedId)
      ) {
        setErrors([
          `Question ID "${trimmedId}" already exists. Choose a unique ID.`,
        ]);
        setSuccessMessage("");
        setCreatedQuestionId("");
        return;
      }
    }

    const question = buildQuestion(
      isEditing && editingQuestionId !== null
        ? editingQuestionId
        : trimmedId,
      expectedResult,
      tableRows,
    );

    const updated = isEditing
      ? updateAdminQuestion(question)
      : saveAdminQuestion(question);

    setAdminQuestions(updated);
    setErrors([]);
    setSuccessMessage(
      isEditing
        ? `Question "${question.title}" updated successfully.`
        : `Question "${question.title}" created successfully.`,
    );
    setCreatedQuestionId(question.id);
    setEditingQuestionId(null);
    resetForm();
  };

  const handlePreview = () => {
    const {
      validationErrors,
      expectedResult,
      tableRows,
    } = validateForm();

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setSuccessMessage("");
      setCreatedQuestionId("");
      return;
    }

    setErrors([]);

    const previewQuestion = buildQuestion(
      generatePreviewId(),
      expectedResult,
      tableRows,
    );

    navigate("/admin/preview", {
      state: {
        previewQuestion,
        formDraft: captureDraft(),
      },
    });
  };

  const handlePreviewQuestion = (
    question: Question,
  ) => {
    navigate("/admin/preview", {
      state: {
        previewQuestion: question,
        formDraft: captureDraft(),
      },
    });
  };

  const parseValidationBlock = (): {
    expectedResult: Record<string, unknown>[];
    error: string | null;
  } => {
    try {
      const parsed: unknown = JSON.parse(
        expectedResultText.trim() === ""
          ? "[]"
          : expectedResultText,
      );

      if (
        !Array.isArray(parsed) ||
        !parsed.every(isRecord)
      ) {
        return {
          expectedResult: [],
          error:
            "Expected Result must be a JSON array of objects.",
        };
      }

      return {
        expectedResult:
          parsed as Record<string, unknown>[],
        error: null,
      };
    } catch {
      return {
        expectedResult: [],
        error: "Expected Result must be valid JSON.",
      };
    }
  };

  const recordValidationRun = (
    questionId: string,
    ok: boolean,
    message: string,
  ) => {
    setValidationRuns((previous) => ({
      ...previous,
      [questionId]: { ok, message },
    }));
  };

  const resolveRunTargetId = (): string => {
    if (
      isEditing &&
      editingQuestionId !== null
    ) {
      return editingQuestionId;
    }

    const trimmedId = questionId.trim();

    return trimmedId !== "" ? trimmedId : "";
  };

  const handleValidateSql = async () => {
    const codeToRun =
      solutionCode !== "" ? solutionCode : starterSql;
    const codeLabel =
      solutionCode !== "" ? "solution" : "starter";

    if (codeToRun.trim() === "") {
      setValidationCheck({
        status: "error",
        message:
          "Add starter SQL before validating.",
      });
      return;
    }

    const { error: blockError, expectedResult } =
      parseValidationBlock();

    if (blockError !== null) {
      setValidationCheck({
        status: "error",
        message: blockError,
      });
      return;
    }

    if (tables.length === 0) {
      setValidationCheck({
        status: "error",
        message:
          "Add at least one table before validating.",
      });
      return;
    }

    setValidationCheck({
      status: "running",
      message: `Running ${codeLabel} code against the configured tables...`,
    });

    try {
      const effectiveTables = getEffectiveTables();
      const tableRows: Record<string, unknown>[][] =
        [];

      for (const table of effectiveTables) {
        try {
          const parsedRows: unknown = JSON.parse(
            table.sampleRowsText.trim() === ""
              ? "[]"
              : table.sampleRowsText,
          );

          if (
            !Array.isArray(parsedRows) ||
            !parsedRows.every(isRecord)
          ) {
            throw new Error("invalid rows");
          }

          tableRows.push(parsedRows);
        } catch {
          tableRows.push([]);
        }
      }

      const db = await createQuestionDatabase({
        engine: "PostgreSQL",
        tables: effectiveTables.map(
          (table, tableIndex) => ({
            name: table.name.trim(),
            columns: table.columns.map((column) => ({
              name: column.name.trim(),
              type: column.type,
            })),
            rows: tableRows[tableIndex] ?? [],
          }),
        ),
      });

      try {
        const result =
          await db.query<Record<string, unknown>>(
            codeToRun,
          );

        const validation = validateResult(
          result.rows,
          expectedResult,
          false,
        );

        const message = validation.correct
          ? `Validated ${codeLabel} code: ${validation.message} (${result.rows.length} ${result.rows.length === 1 ? "row" : "rows"}).`
          : `Validation failed for ${codeLabel} code: ${validation.message}`;

        setValidationCheck({
          status: validation.correct
            ? "ok"
            : "error",
          message,
        });

        const targetId = resolveRunTargetId();

        if (targetId !== "") {
          recordValidationRun(
            targetId,
            validation.correct,
            message,
          );
        }
      } finally {
        await db.close();
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : String(err);

      setValidationCheck({
        status: "error",
        message: `Execution failed: ${message}`,
      });
    }
  };

  const handleValidatePySpark = async () => {
    const codeToRun =
      solutionCode !== "" ? solutionCode : starterSql;
    const codeLabel =
      solutionCode !== "" ? "solution" : "starter";

    if (codeToRun.trim() === "") {
      setValidationCheck({
        status: "error",
        message:
          "Add starter PySpark code before validating.",
      });
      return;
    }

    const { error: blockError, expectedResult } =
      parseValidationBlock();

    if (blockError !== null) {
      setValidationCheck({
        status: "error",
        message: blockError,
      });
      return;
    }

    setValidationCheck({
      status: "running",
      message: "Starting the Spark worker...",
    });

    try {
      let client = pysparkClientRef.current;

      if (!client) {
        client = new PysparkClient(
          (_stage, message) => {
            setValidationCheck({
              status: "running",
              message,
            });
          },
        );
        pysparkClientRef.current = client;

        await client.boot();
      }

      if (pysparkClientRef.current !== client) {
        return;
      }

      setValidationCheck({
        status: "running",
        message: `Executing ${codeLabel} code on real Spark 4.2.0 ...`,
      });

      const outcome =
        await client.runValidation(codeToRun);

      if (pysparkClientRef.current !== client) {
        return;
      }

      if (!outcome.ok) {
        setValidationCheck({
          status: "error",
          message: `Execution failed: ${outcome.error}`,
        });
        return;
      }

      if (!outcome.hasResult) {
        const message =
          "Your code ran, but no `result` DataFrame was produced. Assign the final answer to `result`.";

        setValidationCheck({
          status: "error",
          message,
        });

        const targetId = resolveRunTargetId();

        if (targetId !== "") {
          recordValidationRun(
            targetId,
            false,
            message,
          );
        }

        return;
      }

      const validation = validateResult(
        outcome.records,
        expectedResult,
        false,
      );

      const message = validation.correct
        ? `Validated ${codeLabel} code: ${validation.message} (${outcome.records.length} ${outcome.records.length === 1 ? "row" : "rows"}).`
        : `Validation failed for ${codeLabel} code: ${validation.message}`;

      setValidationCheck({
        status: validation.correct ? "ok" : "error",
        message,
      });

      const targetId = resolveRunTargetId();

      if (targetId !== "") {
        recordValidationRun(
          targetId,
          validation.correct,
          message,
        );
      }
    } catch (e) {
      setValidationCheck({
        status: "error",
        message:
          e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleEdit = (question: Question) => {
    setTitle(question.title);
    setDescription(question.description);
    setDifficulty(
      DIFFICULTIES.includes(
        question.difficulty as Difficulty,
      )
        ? (question.difficulty as Difficulty)
        : "Easy",
    );
    setQuestionType(
      question.questionType === "PySpark"
        ? "PySpark"
        : "SQL",
    );
    setCategory(question.category);
    setCompaniesText(question.companies.join(", "));
    setLanguagesText(question.languages.join(", "));
    setTagsText(question.tags.join(", "));
    setStarterSql(question.starterCode ?? "");
    setExpectedResultText(
      JSON.stringify(
        question.validation?.expectedResult ?? [],
        null,
        2,
      ),
    );
    setHint(question.hint ?? "");
    setSolutionCode(question.solutionCode ?? "");
    setExplanation(question.explanation ?? "");
    setEnabled(question.enabled !== false);
    setQuestionId(question.id);
    setTables(
      question.database && question.database.tables.length > 0
        ? question.database.tables.map((table) => ({
            name: table.name,
            columns: table.columns.map((column) => ({
              name: column.name,
              type: column.type,
            })),
            sampleRowsText: JSON.stringify(
              table.rows,
              null,
              2,
            ),
          }))
        : [createEmptyTable()],
    );
    setEditingQuestionId(question.id);
    setErrors([]);
    setSuccessMessage("");
    setCreatedQuestionId("");
    setValidationCheck({ status: "idle" });

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setEditingQuestionId(null);
    setErrors([]);
    resetForm();
  };

  const getQuestionReferences = (
    questionId: string,
  ): string[] => {
    const references: string[] = [];

    if (
      getBookmarkedQuestionIds().has(questionId)
    ) {
      references.push("bookmarked");
    }

    if (isQuestionSolved(questionId)) {
      references.push("solved");
    }

    const sessionCount = getPracticeHistory().filter(
      (entry) =>
        entry.questionIds.includes(questionId),
    ).length;

    if (sessionCount > 0) {
      references.push(
        `in ${sessionCount} practice ${
          sessionCount === 1 ? "session" : "sessions"
        }`,
      );
    }

    return references;
  };

  const handleDelete = (questionId: string) => {
    if (deleteConfirmId !== questionId) {
      setDeleteConfirmId(questionId);
      return;
    }

    setDeleteConfirmId(null);
    applyAdminQuestions(
      deleteAdminQuestion(questionId),
    );
    setConfirmClearAll(false);

    setSelectedIds((previous) => {
      if (!previous.has(questionId)) {
        return previous;
      }

      const next = new Set(previous);
      next.delete(questionId);
      return next;
    });

    if (editingQuestionId === questionId) {
      setEditingQuestionId(null);
      setErrors([]);
      resetForm();
    }
  };

  const handleToggleEnabled = (
    questionId: string,
  ) => {
    const target = adminQuestions.find(
      (item) => item.id === questionId,
    );

    if (!target) {
      return;
    }

    applyAdminQuestions(
      setAdminQuestionEnabled(
        questionId,
        !isQuestionEnabled(target),
      ),
    );
  };

  const toggleSelectedId = (questionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);

      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }

      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(
      new Set(
        visibleLocalQuestions
          .filter(
            (question) =>
              !builtInIds.has(question.id),
          )
          .map((question) => question.id),
      ),
    );
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) {
      return;
    }

    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }

    const deletedIds = new Set(selectedIds);
    const deletedCount = deletedIds.size;

    applyAdminQuestions(
      deleteAdminQuestions([...deletedIds]),
    );
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setConfirmClearAll(false);

    if (
      editingQuestionId !== null &&
      deletedIds.has(editingQuestionId)
    ) {
      setEditingQuestionId(null);
      setErrors([]);
      resetForm();
    } else {
      setErrors([]);
    }

    setSuccessMessage(
      `Deleted ${deletedCount} ${
        deletedCount === 1 ? "question" : "questions"
      }.`,
    );
    setCreatedQuestionId("");
  };

  const handleDuplicate = (questionId: string) => {
    const existing = adminQuestions.find(
      (item) => item.id === questionId,
    );

    // Built-in questions are immutable, so
    // duplicating one creates a new editable
    // admin copy instead of touching the catalog.
    const copy =
      existing !== undefined
        ? duplicateAdminQuestion(questionId)
        : (() => {
            const source = builtInQuestions.find(
              (item) => item.id === questionId,
            );

            if (!source) {
              return null;
            }

            const duplicate: Question = JSON.parse(
              JSON.stringify(source),
            );

            duplicate.id = generateQuestionId();
            duplicate.title = `${source.title} (Copy)`;
            duplicate.solved = false;
            duplicate.enabled = true;

            saveAdminQuestion(duplicate);

            return duplicate;
          })();

    if (!copy) {
      setErrors([
        "Duplicate failed: question not found.",
      ]);
      return;
    }

    applyAdminQuestions(getAdminQuestions());
    handleEdit(copy);
    setErrors([]);
    setSuccessMessage(
      `Question "${copy.title}" duplicated successfully.`,
    );
    setCreatedQuestionId(copy.id);
  };

  const handleClearAll = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      return;
    }

    applyAdminQuestions(clearAdminQuestions());
    setConfirmClearAll(false);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setEditingQuestionId(null);
    setErrors([]);
    resetForm();
  };

  const handleExport = () => {
    try {
      const exportText = JSON.stringify(
        getAdminQuestions(),
        null,
        2,
      );

      const blob = new Blob([exportText], {
        type: "application/json",
      });

      const url =
        window.URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        "queryvanta-admin-questions.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setErrors([
        "Export failed: unable to create the export file.",
      ]);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    let parsedFile: unknown;

    try {
      parsedFile = JSON.parse(await file.text());
    } catch {
      setErrors([
        "Import failed: file does not contain valid JSON.",
      ]);
      setSuccessMessage("");
      setCreatedQuestionId("");
      return;
    }

    const validation =
      validateImportedQuestions(parsedFile);

    if (!validation.valid) {
      setErrors([validation.error]);
      setSuccessMessage("");
      setCreatedQuestionId("");
      return;
    }

    const summary = importAdminQuestions(
      validation.questions,
    );

    applyAdminQuestions(summary.questions);
    setErrors([]);
    setSuccessMessage(
      `Imported ${summary.imported} ${
        summary.imported === 1
          ? "question"
          : "questions"
      }. Skipped ${summary.skipped} ${
        summary.skipped === 1
          ? "duplicate ID"
          : "duplicate IDs"
      }.`,
    );
    setCreatedQuestionId("");
  };

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

          <span className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white">
            Admin
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <h1 className="text-2xl font-semibold text-gray-900">
            Question Management
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Create and manage SQL and PySpark
            practice questions locally.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">
                Total Questions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {catalogStats.total}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">
                Enabled Questions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {catalogStats.enabled}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">
                SQL Questions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {catalogStats.sql}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-500">
                PySpark Questions
              </p>

              <p className="mt-1 text-xl font-semibold text-gray-900">
                {catalogStats.pyspark}
              </p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5">
              <div className="flex items-center gap-2">
                <XCircle
                  size={16}
                  className="text-red-600"
                />

                <h2 className="text-sm font-semibold text-red-700">
                  Please fix the following errors
                </h2>
              </div>

              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-600">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {successMessage !== "" && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  size={16}
                  className="text-emerald-600"
                />

                <p className="text-sm font-medium text-emerald-700">
                  {successMessage}
                </p>
              </div>

              {createdQuestionId !== "" && (
                <p className="mt-2 text-xs text-emerald-600">
                  ID:{" "}
                  <span className="font-mono">
                    {createdQuestionId}
                  </span>{" "}
                  ·{" "}
                  <Link
                    to={`/question/${createdQuestionId}`}
                    className="font-medium underline hover:text-emerald-700"
                  >
                    Open question
                  </Link>
                </p>
              )}
            </div>
          )}

          {isEditing && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <Pencil
                size={16}
                className="shrink-0 text-amber-600"
              />

              <p className="text-sm font-medium text-amber-700">
                Editing question
                {editingQuestionTitle !== "" &&
                  `: "${editingQuestionTitle}"`}
              </p>
            </div>
          )}

          {/* Basic information */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900">
              Basic information
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label
                  htmlFor="admin-title"
                  className={labelClassName}
                >
                  Title
                </label>

                <input
                  id="admin-title"
                  type="text"
                  value={title}
                  onChange={(event) =>
                    setTitle(event.target.value)
                  }
                  placeholder="Customer Order Analysis"
                  className={inputClassName}
                />
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="admin-description"
                  className={labelClassName}
                >
                  Description
                </label>

                <textarea
                  id="admin-description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Describe what the learner should do."
                  rows={3}
                  className={`${inputClassName} resize-y`}
                />
              </div>

              <div>
                <label
                  htmlFor="admin-difficulty"
                  className={labelClassName}
                >
                  Difficulty
                </label>

                <select
                  id="admin-difficulty"
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(
                      event.target.value as Difficulty,
                    )
                  }
                  className={`${inputClassName} cursor-pointer`}
                >
                  {DIFFICULTIES.map((option) => (
                    <option
                      key={option}
                      value={option}
                    >
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="admin-question-type"
                  className={labelClassName}
                >
                  Question Type
                </label>

                <select
                  id="admin-question-type"
                  value={questionType}
                  onChange={(event) =>
                    setQuestionType(
                      event.target.value as
                        | "SQL"
                        | "PySpark",
                    )
                  }
                  className={`${inputClassName} cursor-pointer`}
                >
                  <option value="SQL">SQL</option>
                  <option value="PySpark">
                    PySpark
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="admin-question-id"
                  className={labelClassName}
                >
                  Question ID
                </label>

                {isEditing ? (
                  <>
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-600">
                      {questionId}
                    </p>

                    <p className="mt-2 text-xs text-gray-400">
                      IDs can&apos;t be changed
                      after creation so bookmarks,
                      progress and history keep
                      working.
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      id="admin-question-id"
                      type="text"
                      value={questionId}
                      onChange={(event) =>
                        setQuestionId(
                          event.target.value,
                        )
                      }
                      placeholder="my-new-question"
                      spellCheck={false}
                      className={`${inputClassName} font-mono`}
                    />

                    <p className="mt-2 text-xs text-gray-400">
                      Unique across built-in and
                      local questions.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label
                  htmlFor="admin-category"
                  className={labelClassName}
                >
                  Category
                </label>

                <input
                  id="admin-category"
                  type="text"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value)
                  }
                  placeholder="Aggregation"
                  className={inputClassName}
                />
              </div>

              <div>
                <label
                  htmlFor="admin-companies"
                  className={labelClassName}
                >
                  Companies
                </label>

                <input
                  id="admin-companies"
                  type="text"
                  value={companiesText}
                  onChange={(event) =>
                    setCompaniesText(
                      event.target.value,
                    )
                  }
                  placeholder="Amazon, Google, Microsoft"
                  className={inputClassName}
                />
              </div>

              <div>
                <label
                  htmlFor="admin-languages"
                  className={labelClassName}
                >
                  Languages
                </label>

                <input
                  id="admin-languages"
                  type="text"
                  value={languagesText}
                  onChange={(event) =>
                    setLanguagesText(
                      event.target.value,
                    )
                  }
                  placeholder="PostgreSQL"
                  className={inputClassName}
                />
              </div>

              <div>
                <label
                  htmlFor="admin-tags"
                  className={labelClassName}
                >
                  Tags
                </label>

                <input
                  id="admin-tags"
                  type="text"
                  value={tagsText}
                  onChange={(event) =>
                    setTagsText(event.target.value)
                  }
                  placeholder="GROUP BY, SUM, COUNT"
                  className={inputClassName}
                />
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-400">
              Companies, Languages and Tags accept
              comma-separated values, for example:
              Amazon, Google, Microsoft.
            </p>

            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
              <input
                id="admin-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) =>
                  setEnabled(event.target.checked)
                }
                className="h-4 w-4 shrink-0 cursor-pointer accent-gray-900"
              />

              <span>
                <span className="block text-sm font-medium text-gray-700">
                  Enabled in the public catalog
                </span>

                <span className="block text-xs text-gray-400">
                  Disabled questions stay stored
                  and editable but are hidden
                  from discovery and new practice
                  sessions.
                </span>
              </span>
            </label>
          </section>

          {/* SQL fields */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900">
              {questionType === "PySpark"
                ? "PySpark fields"
                : "SQL fields"}
            </h2>

            <div className="mt-4">
              <label
                htmlFor="admin-starter-sql"
                className={labelClassName}
              >
                {questionType === "PySpark"
                  ? "Starter PySpark Code"
                  : "Starter SQL"}
              </label>

              <textarea
                id="admin-starter-sql"
                value={starterSql}
                onChange={(event) =>
                  setStarterSql(event.target.value)
                }
                placeholder={
                  questionType === "PySpark"
                    ? "result = sales.groupBy(...)"
                    : "SELECT * FROM customers;"
                }
                rows={6}
                spellCheck={false}
                className={`${inputClassName} resize-y font-mono`}
              />
            </div>

            <div className="mt-4">
              <label
                htmlFor="admin-expected-result"
                className={labelClassName}
              >
                Expected Result (JSON)
              </label>

              <textarea
                id="admin-expected-result"
                value={expectedResultText}
                onChange={(event) =>
                  setExpectedResultText(
                    event.target.value,
                  )
                }
                placeholder='[{"customer_id": 1, "total_orders": 5}]'
                rows={8}
                spellCheck={false}
                className={`${inputClassName} resize-y font-mono`}
              />

              <p className="mt-2 text-xs text-gray-400">
                Enter a JSON array of expected result
                rows. An empty array is valid.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={
                  questionType === "PySpark"
                    ? handleValidatePySpark
                    : handleValidateSql
                }
                disabled={
                  validationCheck.status ===
                  "running"
                }
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={14} />
                {validationCheck.status ===
                "running"
                  ? "Validating..."
                  : questionType === "PySpark"
                    ? "Validate PySpark"
                    : "Validate SQL"}
              </button>

              <p className="text-xs text-gray-400">
                Runs the solution code when
                provided, otherwise the starter
                code, through the real execution
                path. Nothing is marked solved.
              </p>
            </div>

            {validationCheck.status !== "idle" && (
              <div
                className={`mt-4 rounded-lg border p-4 text-sm ${
                  validationCheck.status === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : validationCheck.status ===
                        "error"
                      ? "border-red-200 bg-red-50 text-red-600"
                      : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
              >
                {validationCheck.status ===
                "running" ? (
                  <p>{validationCheck.message}</p>
                ) : validationCheck.status ===
                  "ok" ? (
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2 size={15} />
                    {validationCheck.message}
                  </p>
                ) : (
                  <p className="flex items-center gap-2 font-medium">
                    <XCircle size={15} />
                    {validationCheck.message}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Learning content */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900">
              Learning content
            </h2>

            <p className="mt-1 text-xs text-gray-500">
              All fields are optional. Hints,
              solutions and explanations appear on
              the question page without marking
              anything solved.
            </p>

            <div className="mt-4">
              <label
                htmlFor="admin-hint"
                className={labelClassName}
              >
                Hint
              </label>

              <textarea
                id="admin-hint"
                value={hint}
                onChange={(event) =>
                  setHint(event.target.value)
                }
                placeholder="A short nudge toward the right approach."
                rows={3}
                className={`${inputClassName} resize-y`}
              />
            </div>

            <div className="mt-4">
              <label
                htmlFor="admin-solution"
                className={labelClassName}
              >
                Solution Code
              </label>

              <textarea
                id="admin-solution"
                value={solutionCode}
                onChange={(event) =>
                  setSolutionCode(
                    event.target.value,
                  )
                }
                placeholder="A complete working solution."
                rows={6}
                spellCheck={false}
                className={`${inputClassName} resize-y font-mono`}
              />
            </div>

            <div className="mt-4">
              <label
                htmlFor="admin-explanation"
                className={labelClassName}
              >
                Explanation
              </label>

              <textarea
                id="admin-explanation"
                value={explanation}
                onChange={(event) =>
                  setExplanation(event.target.value)
                }
                placeholder="Why the solution works."
                rows={3}
                className={`${inputClassName} resize-y`}
              />
            </div>
          </section>

          {/* Database schema */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Database schema
              </h2>

              {questionType === "PySpark" && (
                <p className="mt-1 text-xs text-gray-500">
                  Optional for PySpark: documents
                  the tables the code runs
                  against.
                </p>
              )}

              <button
                type="button"
                onClick={addTable}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                <Plus size={14} />
                Add table
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {tables.map((table, tableIndex) => (
                <div
                  key={tableIndex}
                  className="rounded-lg border border-gray-200 p-4"
                >
                  <div className="flex items-center gap-2">
                    <Table2
                      size={16}
                      className="shrink-0 text-gray-500"
                    />

                    <input
                      type="text"
                      value={table.name}
                      onChange={(event) =>
                        updateTable(tableIndex, {
                          name: event.target.value,
                        })
                      }
                      placeholder="Table name, for example: customers"
                      aria-label={`Table ${tableIndex + 1} name`}
                      className={`${inputClassName} font-mono`}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        removeTable(tableIndex)
                      }
                      aria-label={`Remove table ${tableIndex + 1}`}
                      className="shrink-0 rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {table.columns.map(
                      (column, columnIndex) => (
                        <div
                          key={columnIndex}
                          className="flex flex-col gap-2 sm:flex-row sm:items-center"
                        >
                          <input
                            type="text"
                            value={column.name}
                            onChange={(event) =>
                              updateColumn(
                                tableIndex,
                                columnIndex,
                                {
                                  name: event.target
                                    .value,
                                },
                              )
                            }
                            placeholder="Column name"
                            aria-label={`Table ${tableIndex + 1} column ${columnIndex + 1} name`}
                            className={`${inputClassName} w-auto! min-w-0 flex-1 font-mono`}
                          />

                          <select
                            value={column.type}
                            onChange={(event) =>
                              updateColumn(
                                tableIndex,
                                columnIndex,
                                {
                                  type: event.target
                                    .value as ColumnType,
                                },
                              )
                            }
                            aria-label={`Table ${tableIndex + 1} column ${columnIndex + 1} type`}
                            className={`${inputClassName} w-[140px]! flex-none cursor-pointer font-mono`}
                          >
                            {COLUMN_TYPES.map(
                              (option) => (
                                <option
                                  key={option}
                                  value={option}
                                >
                                  {option}
                                </option>
                              ),
                            )}
                          </select>

                          <button
                            type="button"
                            onClick={() =>
                              removeColumn(
                                tableIndex,
                                columnIndex,
                              )
                            }
                            aria-label={`Remove column ${columnIndex + 1} from table ${tableIndex + 1}`}
                            className="shrink-0 self-end rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 sm:self-auto"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ),
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      addColumn(tableIndex)
                    }
                    className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <Plus size={13} />
                    Add column
                  </button>

                  <div className="mt-3">
                    <label
                      htmlFor={`admin-sample-rows-${tableIndex}`}
                      className={labelClassName}
                    >
                      Sample rows (JSON)
                    </label>

                    <textarea
                      id={`admin-sample-rows-${tableIndex}`}
                      value={table.sampleRowsText}
                      onChange={(event) =>
                        updateTable(tableIndex, {
                          sampleRowsText:
                            event.target.value,
                        })
                      }
                      placeholder='[{"id": 1, "name": "Alice"}]'
                      rows={4}
                      spellCheck={false}
                      className={`${inputClassName} resize-y font-mono`}
                    />
                  </div>
                </div>
              ))}

              {tables.length === 0 && (
                <p className="text-sm text-gray-400">
                  No tables yet. Add at least one table
                  with one column.
                </p>
              )}
            </div>
          </section>

          <button
            type="button"
            onClick={handleSubmit}
            className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800"
          >
            {isEditing ? "Save Changes" : "Create Question"}
          </button>

          <button
            type="button"
            onClick={handlePreview}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Eye size={15} />
            Preview Question
          </button>

          {isEditing && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}

          {/* Question catalog */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">
                Question catalog
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Download size={13} />
                  Export Questions
                </button>

                <button
                  type="button"
                  onClick={handleImportClick}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Upload size={13} />
                  Import Questions
                </button>

                {adminQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    title="Delete all locally managed questions"
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      confirmClearAll
                        ? "border-red-300 bg-red-50 font-medium text-red-600 hover:bg-red-100"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {confirmClearAll
                      ? "Click again to confirm clear all"
                      : "Clear all"}
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Built-in questions are immutable.
              Locally managed questions support
              editing, duplicates, enable/disable
              and deletion. Validation badges
              reflect this session&apos;s runs and
              reset on reload or catalog changes.
            </p>

            {effectiveCatalog.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="relative flex h-10 flex-1 items-center rounded-lg border border-gray-200 bg-gray-50">
                  <Search
                    size={15}
                    className="ml-3 shrink-0 text-gray-400"
                  />

                  <input
                    type="text"
                    value={localSearch}
                    onChange={(event) =>
                      setLocalSearch(
                        event.target.value,
                      )
                    }
                    placeholder="Search questions by title, description, ID, category, company or tag..."
                    aria-label="Search catalog questions"
                    className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-gray-700 outline-none placeholder:text-gray-400"
                  />

                  {localSearch && (
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSearch("")
                      }
                      className="mr-2 rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                      aria-label="Clear local search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={localDifficulty}
                    onChange={(event) =>
                      setLocalDifficulty(
                        event.target.value,
                      )
                    }
                    aria-label="Filter by difficulty"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    <option value="All">
                      All Difficulties
                    </option>
                    <option value="Easy">Easy</option>
                    <option value="Medium">
                      Medium
                    </option>
                    <option value="Hard">Hard</option>
                  </select>

                  <select
                    value={localQuestionType}
                    onChange={(event) =>
                      setLocalQuestionType(
                        event.target.value,
                      )
                    }
                    aria-label="Filter by question type"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    {localQuestionTypes.map(
                      (option) => (
                        <option
                          key={option}
                          value={option}
                        >
                          {option === "All"
                            ? "All Types"
                            : option}
                        </option>
                      ),
                    )}
                  </select>

                  <select
                    value={localCategory}
                    onChange={(event) =>
                      setLocalCategory(
                        event.target.value,
                      )
                    }
                    aria-label="Filter by category"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    {localCategories.map((option) => (
                      <option
                        key={option}
                        value={option}
                      >
                        {option === "All"
                          ? "All Categories"
                          : option}
                      </option>
                    ))}
                  </select>

                  <select
                    value={localCompany}
                    onChange={(event) =>
                      setLocalCompany(
                        event.target.value,
                      )
                    }
                    aria-label="Filter by company"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    {localCompanies.map((option) => (
                      <option
                        key={option}
                        value={option}
                      >
                        {option === "All"
                          ? "All Companies"
                          : option}
                      </option>
                    ))}
                  </select>

                  <select
                    value={localEnabled}
                    onChange={(event) =>
                      setLocalEnabled(
                        event.target.value as
                          | "All"
                          | "Enabled"
                          | "Disabled",
                      )
                    }
                    aria-label="Filter by enabled status"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    <option value="All">
                      Enabled + Disabled
                    </option>
                    <option value="Enabled">
                      Enabled
                    </option>
                    <option value="Disabled">
                      Disabled
                    </option>
                  </select>

                  <select
                    value={localValidation}
                    onChange={(event) =>
                      setLocalValidation(
                        event.target.value as
                          | "All"
                          | "Has validation"
                          | "No validation",
                      )
                    }
                    aria-label="Filter by validation status"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    <option value="All">
                      All Validation States
                    </option>
                    <option value="Has validation">
                      Has validation
                    </option>
                    <option value="No validation">
                      No validation
                    </option>
                  </select>

                  <select
                    value={localSort}
                    onChange={(event) =>
                      setLocalSort(
                        event.target
                          .value as LocalSortOrder,
                      )
                    }
                    aria-label="Sort local questions"
                    className="cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none hover:bg-gray-50"
                  >
                    {LOCAL_SORT_OPTIONS.map(
                      (option) => (
                        <option
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ),
                    )}
                  </select>

                  {hasLocalFilters && (
                    <button
                      type="button"
                      onClick={clearLocalFilters}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                    >
                      <X size={13} />
                      Clear filters
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <span className="text-xs text-gray-500">
                    Showing{" "}
                    {visibleLocalQuestions.length}{" "}
                    of {effectiveCatalog.length}
                    {selectedIds.size > 0 &&
                      ` · ${selectedIds.size} selected`}
                  </span>

                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      disabled={
                        visibleLocalQuestions.length ===
                        0
                      }
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Select all visible
                    </button>

                    <button
                      type="button"
                      onClick={clearSelection}
                      disabled={
                        selectedIds.size === 0
                      }
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear selection
                    </button>

                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      disabled={
                        selectedIds.size === 0
                      }
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                        confirmBulkDelete
                          ? "border-red-300 bg-red-50 font-medium text-red-600 hover:bg-red-100"
                          : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-red-600"
                      }`}
                    >
                      <Trash2 size={13} />
                      {confirmBulkDelete
                        ? `Click again to delete ${selectedIds.size}`
                        : `Delete selected${
                            selectedIds.size > 0
                              ? ` (${selectedIds.size})`
                              : ""
                          }`}
                    </button>
                  </span>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
              aria-label="Import questions from a JSON file"
            />

            {effectiveCatalog.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">
                No questions in the catalog yet.
                Created questions will appear
                here.
              </p>
            ) : visibleLocalQuestions.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-200 px-6 py-8 text-center">
                <p className="text-sm font-medium text-gray-700">
                  No local questions match the current
                  search or filters.
                </p>

                <button
                  type="button"
                  onClick={clearLocalFilters}
                  className="mt-3 rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Clear search &amp; filters
                </button>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-gray-100">
                {visibleLocalQuestions.map((item) => {
                  const isAdminManaged =
                    !builtInIds.has(item.id);
                  const itemEnabled =
                    isQuestionEnabled(item);
                  const run =
                    validationRuns[item.id];
                  const validationLabel =
                    item.validation === undefined
                      ? "Not Applicable"
                      : run !== undefined
                        ? run.ok
                          ? "Validated"
                          : "Validation Failed"
                        : "Not Validated";
                  const deleteArmed =
                    deleteConfirmId === item.id;
                  const references = deleteArmed
                    ? getQuestionReferences(item.id)
                    : [];

                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                    >
                      {isAdminManaged && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(
                            item.id,
                          )}
                          onChange={() =>
                            toggleSelectedId(
                              item.id,
                            )
                          }
                          aria-label={`Select ${item.title}`}
                          className="h-4 w-4 shrink-0 cursor-pointer accent-gray-900"
                        />
                      )}

                      <div className="min-w-0 flex-1 basis-48">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                          <span className="truncate">
                            {item.title}
                          </span>

                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                              isAdminManaged
                                ? "bg-purple-50 text-purple-600"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {isAdminManaged
                              ? "Admin"
                              : "Built-in"}
                          </span>

                          {isAdminManaged && (
                            <span
                              className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                                itemEnabled
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {itemEnabled
                                ? "Enabled"
                                : "Disabled"}
                            </span>
                          )}

                          <span
                            title={
                              run !== undefined
                                ? run.message
                                : item.validation ===
                                    undefined
                                  ? "No validation block configured"
                                  : "Not validated this session"
                            }
                            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                              validationLabel ===
                              "Validated"
                                ? "bg-emerald-50 text-emerald-600"
                                : validationLabel ===
                                    "Validation Failed"
                                  ? "bg-red-50 text-red-600"
                                  : validationLabel ===
                                      "Not Applicable"
                                    ? "bg-gray-100 text-gray-400"
                                    : "bg-amber-50 text-amber-600"
                            }`}
                          >
                            {validationLabel}
                          </span>
                        </p>

                        <p className="mt-0.5 text-xs text-gray-400">
                          {item.difficulty} ·{" "}
                          {item.questionType} ·{" "}
                          {item.category}
                          {item.companies.length >
                            0 &&
                            ` · ${item.companies.join(", ")}`}{" "}
                          ·{" "}
                          <span className="font-mono">
                            {item.id}
                          </span>
                        </p>

                        {deleteArmed && (
                          <p className="mt-1 text-xs text-red-600">
                            Delete this question? It
                            leaves the active
                            catalog
                            {references.length > 0 &&
                              ` (currently ${references.join(", ")})`}
                            . Historical records
                            keep working.
                          </p>
                        )}
                      </div>

                      <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                        <Link
                          to={`/question/${item.id}`}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                        >
                          Open
                        </Link>

                        <button
                          type="button"
                          onClick={() =>
                            handlePreviewQuestion(
                              item,
                            )
                          }
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                        >
                          <Eye size={13} />
                          Preview
                        </button>

                        {isAdminManaged ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                handleEdit(item)
                              }
                              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                            >
                              <Pencil size={13} />
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleToggleEnabled(
                                  item.id,
                                )
                              }
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                            >
                              {itemEnabled
                                ? "Disable"
                                : "Enable"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleDelete(item.id)
                              }
                              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
                                deleteArmed
                                  ? "border-red-300 bg-red-50 font-medium text-red-600 hover:bg-red-100"
                                  : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-red-600"
                              }`}
                            >
                              <Trash2 size={13} />
                              {deleteArmed
                                ? "Confirm delete"
                                : "Delete"}
                            </button>

                            {deleteArmed && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirmId(
                                    null,
                                  )
                                }
                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled
                            title="Built-in questions can't be deleted."
                            className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-300"
                          >
                            <Trash2 size={13} />
                            Delete
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            handleDuplicate(item.id)
                          }
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                        >
                          <Copy size={13} />
                          Duplicate
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default AdminPage;
