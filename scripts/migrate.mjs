/**
 * Apply every D1 migration in `migrations/`, in filename order.
 *
 * WHY THIS EXISTS
 * ---------------
 * The repository's original scripts hard-coded a single file
 * (`--file=migrations/0001_init.sql`). Adding a second migration without
 * changing that would produce a database that is silently missing the new
 * schema: the local and remote migrate commands would both succeed while
 * creating nothing, and the failure would only surface later as a runtime
 * error in whatever feature needed the new table.
 *
 * This script removes that failure mode by discovering the migrations
 * instead of naming them. Adding `0003_*.sql` later requires no edit here.
 *
 * Usage:
 *   node scripts/migrate.mjs                    # local, default database
 *   node scripts/migrate.mjs --remote           # remote deployment
 *   node scripts/migrate.mjs --local --persist-to <dir>
 *
 * Every statement in every migration is written to be idempotent
 * (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so running
 * the whole set more than once is safe. That is what makes "apply all
 * files, every time" a correct strategy rather than a risky one.
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "migrations");

/** Wrangler is invoked through its entry script with the current Node
 * binary. Going through `npx` is unreliable on Windows because `npx` is a
 * shell script, not an executable. */
const WRANGLER_BIN = join(
  repoRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

/**
 * Migration files in the order they must be applied.
 *
 * Sorted by filename, and only `NNNN_*.sql` files, so a scratch `.sql` file
 * dropped in the directory is not silently executed against a production
 * database.
 */
export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter(
      (name) => /^\d{4}_[\w.-]+\.sql$/.test(name),
    )
    .sort();
}

function runWrangler(args) {
  const result = spawnSync(
    process.execPath,
    [WRANGLER_BIN, ...args],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(
      `wrangler ${args.join(" ")} exited with ${result.status}`,
    );
  }
}

/**
 * Apply all migrations. Returns the filenames applied, in order.
 *
 * Stops at the first failure rather than continuing: a partially applied
 * schema is far harder to reason about than a clean failure, and the
 * caller sees which file broke.
 */
export function applyMigrations({ local, persistTo, database }) {
  const files = migrationFiles();

  if (files.length === 0) {
    throw new Error(
      `No migrations found in ${migrationsDir}. Refusing to continue.`,
    );
  }

  const shared = [
    "d1",
    "execute",
    database,
    // `--remote` and `--local` are mutually exclusive in wrangler; the
    // remote flag is the default, so it is only added explicitly for local.
    ...(local ? ["--local"] : ["--remote"]),
    ...(persistTo
      ? ["--persist-to", persistTo]
      : []),
  ];

  for (const file of files) {
    // A relative path is used because wrangler resolves `--file` against
    // the process cwd, which is the repo root here but is not guaranteed
    // to be the repo root for a caller that spawns this differently.
    const relative = `migrations/${file}`;

    console.log(`applying ${relative}`);

    runWrangler([
      ...shared,
      `--file=${relative}`,
      "--yes",
    ]);
  }

  return files;
}

/* Only run when invoked directly, so importing this from the test harness
 * does not trigger a migration. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const persistIndex = argv.indexOf("--persist-to");
  const databaseIndex = argv.indexOf("--database");

  try {
    const applied = applyMigrations({
      local: argv.includes("--local"),
      persistTo:
        persistIndex === -1
          ? undefined
          : argv[persistIndex + 1],
      database:
        databaseIndex === -1
          ? "queryvanta"
          : argv[databaseIndex + 1],
    });

    console.log(
      `applied ${applied.length} migration(s): ${applied.join(", ")}`,
    );
  } catch (error) {
    console.error(
      "migration failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  }
}
