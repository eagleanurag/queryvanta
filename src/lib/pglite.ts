import { PGlite } from "@electric-sql/pglite";

import type {
  ColumnType,
  QuestionDatabase,
  TableDefinition,
} from "../data/questions";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replaceAll("'", "''")}'`;
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function getColumnDefinition(
  name: string,
  type: ColumnType,
  nullable?: boolean,
): string {
  const nullableDefinition = nullable === false
    ? " NOT NULL"
    : "";

  return `${quoteIdentifier(name)} ${type}${nullableDefinition}`;
}

function createTableSql(table: TableDefinition): string {
  const columns = table.columns
    .map((column) =>
      getColumnDefinition(
        column.name,
        column.type,
        column.nullable,
      ),
    )
    .join(",\n");

  return `
    CREATE TABLE ${quoteIdentifier(table.name)} (
      ${columns}
    );
  `;
}

function createInsertSql(table: TableDefinition): string {
  if (table.rows.length === 0) {
    return "";
  }

  const columnNames = table.columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ");

  const values = table.rows
    .map((row) => {
      const rowValues = table.columns
        .map((column) => quoteValue(row[column.name]))
        .join(", ");

      return `(${rowValues})`;
    })
    .join(",\n");

  return `
    INSERT INTO ${quoteIdentifier(table.name)}
      (${columnNames})
    VALUES
      ${values};
  `;
}

function buildDatabaseSql(database: QuestionDatabase): string {
  const statements: string[] = [];

  for (const table of database.tables) {
    statements.push(createTableSql(table));
    statements.push(createInsertSql(table));
  }

  return statements.join("\n");
}

export async function createQuestionDatabase(
  database: QuestionDatabase,
): Promise<PGlite> {
  const db = await PGlite.create("memory://");

  const setupSql = buildDatabaseSql(database);

  if (setupSql.trim()) {
    await db.exec(setupSql);
  }

  return db;
}