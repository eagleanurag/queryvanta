/**
 * Type declarations for `scripts/migrate.mjs`.
 *
 * The script is plain JavaScript so it can be invoked directly with `node`
 * by the npm scripts. This declaration exists so the TypeScript test
 * harness can import `applyMigrations` without `allowJs` pulling the whole
 * script (and its `process.argv` side effects) into the type-check.
 */

export declare function migrationFiles(): string[];

export declare function applyMigrations(options: {
  /** Apply to the local Miniflare database rather than the remote one. */
  local?: boolean;
  /** Persistence directory, for the local database. */
  persistTo?: string;
  /** D1 binding name. Defaults to "queryvanta". */
  database?: string;
}): string[];
