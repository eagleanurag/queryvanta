import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Pencil,
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

import {
  clearAdminQuestions,
  deleteAdminQuestion,
  deleteAdminQuestions,
  duplicateAdminQuestion,
  getAdminQuestions,
  importAdminQuestions,
  saveAdminQuestion,
  updateAdminQuestion,
  validateImportedQuestions,
} from "../lib/adminQuestions";

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
  category: string;
  companiesText: string;
  languagesText: string;
  tagsText: string;
  starterSql: string;
  expectedResultText: string;
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
  const [localSort, setLocalSort] =
    useState<LocalSortOrder>("newest");
  const [selectedIds, setSelectedIds] = useState<
    Set<string>
  >(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] =
    useState(false);

  const localQuestionTypes = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(
          adminQuestions.map(
            (question) => question.questionType,
          ),
        ),
      ),
    ],
    [adminQuestions],
  );

  const localCategories = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(
          adminQuestions.map(
            (question) => question.category,
          ),
        ),
      ),
    ],
    [adminQuestions],
  );

  const visibleLocalQuestions = useMemo(() => {
    const normalizedSearch = localSearch
      .trim()
      .toLowerCase();

    const filtered = adminQuestions.filter(
      (question) => {
        const matchesSearch =
          normalizedSearch === "" ||
          question.title
            .toLowerCase()
            .includes(normalizedSearch) ||
          question.description
            .toLowerCase()
            .includes(normalizedSearch);

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

        return (
          matchesSearch &&
          matchesDifficulty &&
          matchesType &&
          matchesCategory
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
    adminQuestions,
    localSearch,
    localDifficulty,
    localQuestionType,
    localCategory,
    localSort,
  ]);

  const hasLocalFilters =
    localSearch.trim() !== "" ||
    localDifficulty !== "All" ||
    localQuestionType !== "All" ||
    localCategory !== "All";

  const clearLocalFilters = () => {
    setLocalSearch("");
    setLocalDifficulty("All");
    setLocalQuestionType("All");
    setLocalCategory("All");
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
    setCategory("");
    setCompaniesText("");
    setLanguagesText("");
    setTagsText("");
    setStarterSql("");
    setExpectedResultText("[]");
    setTables([createEmptyTable()]);
  };

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
      validationErrors.push("Starter SQL is required.");
    }

    if (tables.length === 0) {
      validationErrors.push(
        "At least one table is required.",
      );
    }

    const seenTableNames = new Set<string>();

    tables.forEach((table, tableIndex) => {
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

    tables.forEach((table, tableIndex) => {
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

    return {
      id,
      title: title.trim(),
      description: description.trim(),
      difficulty,
      questionType: "SQL",
      category: category.trim(),
      languages:
        languages.length > 0
          ? languages
          : ["PostgreSQL"],
      tags: parseCsv(tagsText),
      companies: parseCsv(companiesText),
      solved: false,
      database: {
        engine: "PostgreSQL",
        tables: tables.map((table, tableIndex) => ({
          name: table.name.trim(),
          columns: table.columns.map((column) => ({
            name: column.name.trim(),
            type: column.type,
          })),
          rows: tableRows[tableIndex] ?? [],
        })),
      },
      starterCode: starterSql,
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
    category,
    companiesText,
    languagesText,
    tagsText,
    starterSql,
    expectedResultText,
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

    const question = buildQuestion(
      editingQuestionId ?? generateQuestionId(),
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

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setEditingQuestionId(null);
    setErrors([]);
    resetForm();
  };

  const handleDelete = (questionId: string) => {
    setAdminQuestions(deleteAdminQuestion(questionId));
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
        visibleLocalQuestions.map(
          (question) => question.id,
        ),
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

    setAdminQuestions(
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
    const copy = duplicateAdminQuestion(questionId);

    if (!copy) {
      setErrors([
        "Duplicate failed: question not found.",
      ]);
      return;
    }

    setAdminQuestions(getAdminQuestions());
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

    setAdminQuestions(clearAdminQuestions());
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

    setAdminQuestions(summary.questions);
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
            Question Builder
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Create and save SQL practice questions
            locally.
          </p>

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
                  value="SQL"
                  disabled
                  className={`${inputClassName} cursor-not-allowed bg-gray-50`}
                >
                  <option value="SQL">SQL</option>
                </select>
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
          </section>

          {/* SQL fields */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900">
              SQL fields
            </h2>

            <div className="mt-4">
              <label
                htmlFor="admin-starter-sql"
                className={labelClassName}
              >
                Starter SQL
              </label>

              <textarea
                id="admin-starter-sql"
                value={starterSql}
                onChange={(event) =>
                  setStarterSql(event.target.value)
                }
                placeholder="SELECT * FROM customers;"
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
          </section>

          {/* Database schema */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                Database schema
              </h2>

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

          {/* Admin question list */}
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">
                Local questions
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

            {adminQuestions.length > 0 && (
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
                    placeholder="Search local questions by title or description..."
                    aria-label="Search local questions"
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
                    of {adminQuestions.length}
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

            {adminQuestions.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">
                No local questions yet. Created
                questions will appear here.
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
                {visibleLocalQuestions.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(
                        item.id,
                      )}
                      onChange={() =>
                        toggleSelectedId(item.id)
                      }
                      aria-label={`Select ${item.title}`}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-gray-900"
                    />

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.title}
                      </p>

                      <p className="mt-0.5 text-xs text-gray-400">
                        {item.difficulty} ·{" "}
                        {item.questionType} ·{" "}
                        {item.category}
                        {item.companies.length > 0 &&
                          ` · ${item.companies.join(", ")}`}{" "}
                        ·{" "}
                        <span className="font-mono">
                          {item.id}
                        </span>
                      </p>
                    </div>

                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Link
                        to={`/question/${item.id}`}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Open
                      </Link>

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
                          handleDuplicate(item.id)
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                      >
                        <Copy size={13} />
                        Duplicate
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDelete(item.id)
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-red-600"
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default AdminPage;
