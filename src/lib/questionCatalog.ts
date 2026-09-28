import type { Question } from "../data/questions.ts";

/**
 * Catalog composition rules.
 *
 * Deliberately free of any API or storage dependency so the merge
 * can be reasoned about and tested in isolation.
 *
 * The catalog has three layers:
 *
 *   1. BUILT-IN  bundled, immutable, bundled with the app
 *   2. SERVER    D1 rows, the authoritative shared state
 *   3. LOCAL     a localStorage mirror of published+enabled server
 *                rows, used by the browser-only (GitHub Pages)
 *                deployment and as migration/export input
 *
 * The admin list must be able to see DRAFTS, which the public
 * mirror never contains. An earlier implementation derived the
 * admin list from the mirror, so a question stored in D1 and
 * returned by `GET /api/admin/questions` was invisible in the
 * admin UI. The server catalog is therefore the admin source
 * whenever a session exists.
 */

/**
 * An administrative catalog entry.
 *
 * Extends the learner-facing `Question` with the server-managed
 * lifecycle and provenance fields the admin UI needs. All extra
 * fields are optional so the same type describes both a server row
 * and a local record.
 */
export type ServerCatalogEntry = Question & {
  published?: boolean;
  source?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | null;
  updatedBy?: string | null;
};

/**
 * Merge the built-in catalog with the administrative catalog.
 *
 * Rules:
 *   - BUILT-IN questions always win an ID collision, so the
 *     immutable bundled catalog can never be shadowed.
 *   - With a server session the SERVER catalog is used, drafts
 *     included. The local mirror is NOT merged in, because it is a
 *     subset of the server rows and combining them would duplicate
 *     every published question.
 *   - Without a server session (or before the first load completes)
 *     the local mirror is used.
 *
 * Deduplication is by the stable question `id`.
 */
export function mergeAdminCatalog(options: {
  builtIn: Question[];
  serverEntries: ServerCatalogEntry[] | null;
  localEntries: Question[];
  serverBacked: boolean;
}): Question[] {
  const useServer =
    options.serverBacked &&
    options.serverEntries !== null;

  const adminEntries: Question[] =
    useServer && options.serverEntries !== null
      ? options.serverEntries
      : options.localEntries;

  const seenIds = new Set(
    options.builtIn.map((question) => question.id),
  );

  const merged: Question[] = [...options.builtIn];

  for (const question of adminEntries) {
    if (seenIds.has(question.id)) {
      continue;
    }

    seenIds.add(question.id);
    merged.push(question);
  }

  return merged;
}
