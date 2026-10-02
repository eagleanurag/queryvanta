/**
 * Server-backed admin question synchronisation.
 *
 * The rest of QueryVanta reads the question catalog from a single
 * synchronous source (the bundled catalog plus the
 * `queryvanta-admin-questions` localStorage record). Rather than
 * rewriting every consumer, server-published questions are mirrored
 * into that same key. The rest of the application therefore keeps
 * working unchanged while the D1 database becomes the source of
 * truth for administration.
 *
 * Built-in questions are NEVER written here: the immutable bundled
 * catalog always wins on ID collision, exactly as
 * `combineQuestionCatalogs` already guarantees.
 */

import type { Question } from "../data/questions.ts";

import type { ServerCatalogEntry } from "./questionCatalog.ts";

export type { ServerCatalogEntry } from "./questionCatalog.ts";

import {
  createAdminQuestion,
  deleteServerQuestion,
  duplicateServerQuestion,
  fetchSession,
  importServerQuestions,
  listAdminQuestions,
  setServerQuestionEnabled,
  setServerQuestionPublished,
  updateAdminQuestion,
  type AdminQuestionPayload,
  type ApiResult,
} from "./adminApi.ts";

const STORAGE_KEY = "queryvanta-admin-questions";
const ADMIN_QUESTIONS_EVENT =
  "queryvanta-admin-questions-changed";

export const SERVER_SYNC_EVENT =
  "queryvanta-admin-server-sync";

/**
 * Returns true when an administrator session is active and the API
 * is reachable. Used to decide whether to drive the admin UI from
 * the server or fall back to browser-local storage.
 */
export async function serverBackedSessionActive(): Promise<boolean> {
  const state = await fetchSession();

  return state.status === "authenticated";
}

function readLocal(): Question[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is Question =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Question).id === "string",
    );
  } catch {
    return [];
  }
}

function writeLocal(questions: Question[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(questions),
    );
    window.dispatchEvent(
      new Event(ADMIN_QUESTIONS_EVENT),
    );
  } catch {
    // Storage may be unavailable; the server remains the source of
    // truth and the next successful sync repairs the mirror.
  }
}

/**
 * Convert a server row into the client `Question` shape.
 * `solved` is per-learner browser state and is never persisted
 * server-side, so it is always initialised to false here and then
 * merged with the learner's local progress by the app.
 */
function toClientQuestion(
  row: AdminQuestionPayload,
): Question {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    questionType: row.questionType,
    category: row.category,
    languages: row.languages ?? [],
    tags: row.tags ?? [],
    companies: row.companies ?? [],
    solved: false,
    enabled: row.enabled !== false,
    ...(row.database === undefined
      ? {}
      : { database: row.database }),
    ...(row.starterCode
      ? { starterCode: row.starterCode }
      : {}),
    ...(row.hint ? { hint: row.hint } : {}),
    ...(row.solutionCode
      ? { solutionCode: row.solutionCode }
      : {}),
    ...(row.explanation
      ? { explanation: row.explanation }
      : {}),
    ...(row.validation
      ? { validation: row.validation }
      : {}),
  };
}

/** Preserve the learner's local solved/bookmarked state. */
function mergeLearnerState(
  serverQuestions: Question[],
): Question[] {
  const solved = new Set(
    readLocal()
      .filter((question) => question.solved)
      .map((question) => question.id),
  );

  return serverQuestions.map((question) => ({
    ...question,
    solved: solved.has(question.id),
  }));
}

/**
 * Fetch the FULL administrative catalog from the server.
 *
 * Unlike `syncFromServer`, this does NOT filter to published rows:
 * the admin list must show drafts, because an administrator has to
 * be able to find, edit, publish and delete them. Draft visibility
 * here is a privilege of the authenticated admin API, not of the
 * public catalog.
 */
export async function fetchServerCatalog(): Promise<
  ApiResult<{
    questions: ServerCatalogEntry[];
    count: number;
    /**
     * The untouched server rows this payload was built from.
     *
     * Retained so a caller that also needs the public mirror can derive it
     * WITHOUT issuing a second identical request (audit finding V-07). It is
     * the same data, not a copy from anywhere else.
     */
    rows: AdminQuestionPayload[];
  }>
> {
  const result = await listAdminQuestions();

  if (!result.ok) {
    return result as ApiResult<{
      questions: ServerCatalogEntry[];
      count: number;
      rows: AdminQuestionPayload[];
    }>;
  }

  const questions = result.data.questions.map(
    (row): ServerCatalogEntry => ({
      ...toClientQuestion(row),
      published: row.published === true,
      source: row.source ?? "admin",
      version: row.version ?? 1,
      createdAt: row.createdAt ?? "",
      updatedAt: row.updatedAt ?? "",
      createdBy: row.createdBy ?? null,
      updatedBy: row.updatedBy ?? null,
    }),
  );

  return {
    ok: true,
    data: {
      questions,
      count: questions.length,
      rows: result.data.questions,
    },
  };
}

/**
 * Load the server catalog and refresh the public mirror in one
 * round trip.
 *
 * Two distinct channels, deliberately kept apart:
 *
 *   admin list  <- ALL non-deleted server rows, drafts included
 *   public view <- published + enabled only, mirrored to
 *                  localStorage for the discovery/practice code
 *
 * Previously the admin list was built from the public mirror, which
 * meant a draft could never appear in the admin UI even though the
 * API returned it. The administrator could not find, edit or publish
 * their own draft.
 */
export async function loadAdminCatalog(): Promise<
  ApiResult<{
    questions: ServerCatalogEntry[];
    count: number;
    publicCount: number;
  }>
> {
  const catalog = await fetchServerCatalog();

  if (!catalog.ok) {
    return catalog as ApiResult<{
      questions: ServerCatalogEntry[];
      count: number;
      publicCount: number;
    }>;
  }

  // The raw payload is retained by `fetchServerCatalog` for exactly this
  // reason: the mirror is derived from the same rows the admin list was
  // built from, so the catalog is fetched once and reused, not twice.
  const catalogRows = catalog.data.rows;

  // Refresh the public mirror from the payload ALREADY fetched above.
  //
  // V-07: this used to call `syncFromServer()`, which fetched the identical
  // endpoint again. The admin list and the public mirror are two views of one
  // payload, so the second request was pure duplication: one mutation cost
  // two full-catalog GETs before the caller's own refresh, three in total.
  applyPublicMirror(catalogRows);

  return {
    ok: true,
    data: {
      questions: catalog.data.questions,
      count: catalog.data.count,
      publicCount: publicMirrorCount(catalogRows),
    },
  };
}

/**
 * Replace the mirrored local record with the current server state.
 * Only questions that are enabled AND published are mirrored, so a
 * draft or disabled server question never enters the public
 * catalog in the browser.
 */
export async function syncFromServer(): Promise<
  ApiResult<{ count: number }>
> {
  const result = await listAdminQuestions();

  if (!result.ok) {
    return result as ApiResult<{ count: number }>;
  }

  applyPublicMirror(result.data.questions);

  return {
    ok: true,
    data: { count: publicMirrorCount(result.data.questions) },
  };
}

/**
 * Number of rows in the public mirror for an already-fetched payload.
 */
function publicMirrorCount(
  rows: AdminQuestionPayload[],
): number {
  return rows.filter(
    (row) => row.enabled !== false && row.published === true,
  ).length;
}

/**
 * Write the public mirror from an ALREADY-FETCHED catalog payload.
 *
 * This is the de-duplication that closes audit finding V-07. `loadAdminCatalog`
 * used to fetch the full catalog and then call `syncFromServer`, which
 * fetched the SAME endpoint a second time. Splitting the payload handling out
 * of the fetching lets one response serve both channels: one request instead
 * of two, with identical output.
 *
 * Only published AND enabled rows are mirrored, so a draft or disabled server
 * question never enters the public catalog in the browser.
 */
function applyPublicMirror(rows: AdminQuestionPayload[]): void {
  const publicRows = rows.filter(
    (row) => row.enabled !== false && row.published === true,
  );

  writeLocal(mergeLearnerState(publicRows.map(toClientQuestion)));

  window.dispatchEvent(new Event(SERVER_SYNC_EVENT));
}

export async function serverCreate(
  question: Question,
): Promise<ApiResult<Question>> {
  const result = await createAdminQuestion(
    question as AdminQuestionPayload,
  );

  if (!result.ok) {
    return result as ApiResult<Question>;
  }

  return {
    ok: true,
    data: toClientQuestion(result.data.question),
  };
}

export async function serverUpdate(
  question: Question,
  version?: number,
): Promise<ApiResult<Question>> {
  const result = await updateAdminQuestion({
    ...(question as AdminQuestionPayload),
    ...(version === undefined ? {} : { version }),
  });

  if (!result.ok) {
    return result as ApiResult<Question>;
  }

  return {
    ok: true,
    data: toClientQuestion(result.data.question),
  };
}

export async function serverDelete(
  questionId: string,
): Promise<ApiResult<null>> {
  const result = await deleteServerQuestion(questionId);

  if (!result.ok) {
    return result as ApiResult<null>;
  }

  return { ok: true, data: null };
}

export async function serverToggleEnabled(
  questionId: string,
  enabled: boolean,
): Promise<ApiResult<null>> {
  const result = await setServerQuestionEnabled(
    questionId,
    enabled,
  );

  if (!result.ok) {
    return result as ApiResult<null>;
  }

  return { ok: true, data: null };
}

export async function serverPublish(
  questionId: string,
  published: boolean,
): Promise<ApiResult<null>> {
  const result = await setServerQuestionPublished(
    questionId,
    published,
  );

  if (!result.ok) {
    return result as ApiResult<null>;
  }

  return { ok: true, data: null };
}

export async function serverDuplicate(
  sourceId: string,
  newId: string,
): Promise<ApiResult<Question>> {
  const result = await duplicateServerQuestion(
    sourceId,
    newId,
  );

  if (!result.ok) {
    return result as ApiResult<Question>;
  }

  return {
    ok: true,
    data: toClientQuestion(result.data.question),
  };
}

/**
 * Import browser-local admin questions into D1.
 *
 * Existing ids on the server are SKIPPED, never overwritten, so a
 * newer server-side question is preserved.
 */
export async function serverImport(
  questions: Question[],
): Promise<
  ApiResult<{
    imported: number;
    skipped: number;
    failed: number;
    conflicts: number;
    failures: { id: string; reason: string }[];
  }>
> {
  // V-07: no catalog re-fetch here either. An import returns the precise
  // per-item outcome, and the caller refreshes the catalog from the single
  // response `loadAdminCatalog` already fetches.
  return importServerQuestions(
    questions as AdminQuestionPayload[],
  );
}

/** Count of browser-local admin questions awaiting migration. */
export function localAdminQuestionCount(): number {
  return readLocal().length;
}

export function readLocalAdminQuestions(): Question[] {
  return readLocal();
}

/** Clears the mirrored record (used after sign-out). */
export function clearLocalMirror(): void {
  writeLocal([]);
}