import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  questions,
  type Question,
} from "../../src/data/questions.ts";

import { parseQuestionInput } from "../questionSchema.ts";

/**
 * Built-in SQL starter-code contract.
 *
 * THE BUG THIS PINS
 * -----------------
 * Every one of the 24 built-in SQL questions shipped with
 * `starterCode === solutionCode`. The SQL editor initialises from
 * `starterCode`, so opening a question showed the complete, correct
 * answer immediately and the learner never had to write anything.
 * `solutionCode` was only ever meant to be revealed by the separate
 * "Show Solution" control.
 *
 * THE CONTRACT
 * ------------
 * A built-in SQL `starterCode` must be a NEUTRAL exploration query that
 * runs immediately and reveals nothing:
 *
 *   - it exists, and is not the solution
 *   - it does not merely CONTAIN the solution
 *   - it selects from exactly one table, and that table is a real table
 *     in that question's own database
 *   - it carries no WHERE / JOIN / GROUP BY / HAVING / window function /
 *     aggregate / CASE / CTE, so it cannot be a partial answer
 *   - it contains no numeric literal other than the LIMIT
 *
 * Whitespace is normalised throughout: the assertion is about SQL
 * content, not about indentation.
 *
 * SCOPE
 * -----
 * This applies to the BUILT-IN catalog only. Admin-managed questions
 * legitimately keep independent `starterCode` / `solutionCode` fields,
 * and `parseQuestionInput` must keep accepting a question whose two
 * differ. That is asserted below so tightening this rule can never
 * quietly break the admin editor.
 */

/** Collapse whitespace and case so the assertion is about content. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

const sqlQuestions = questions.filter(
  (q) => q.questionType === "SQL",
);

/** Answer-shaped SQL that must never appear in a starter. */
const FORBIDDEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["WHERE", /\bwhere\b/i],
  ["JOIN", /\bjoin\b/i],
  ["GROUP BY", /\bgroup\s+by\b/i],
  ["HAVING", /\bhaving\b/i],
  ["window function", /\bover\s*\(/i],
  ["RANK/ROW_NUMBER", /\b(rank|row_number|dense_rank)\s*\(/i],
  ["LAG/LEAD", /\b(lag|lead|first_value)\s*\(/i],
  ["aggregate", /\b(sum|count|avg|min|max|total)\s*\(/i],
  ["COALESCE/NULLIF", /\b(coalesce|nullif)\s*\(/i],
  ["CASE", /\bcase\b/i],
  ["EXTRACT/AGE", /\b(extract|age)\s*\(/i],
  ["subquery predicate", /\bnot\s+exists\b|\bin\s*\(\s*select/i],
  ["CTE", /\bwith\b/i],
  ["table alias", /\bas\b/i],
  ["UNION", /\bunion\b/i],
];

/** Only the LIMIT count is allowed as a numeric literal. */
function numericLiterals(sql: string): string[] {
  return sql.match(/\b\d[\d_]*\b/g) ?? [];
}

function fromTable(sql: string): string | null {
  const match = sql.match(/\bfrom\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match?.[1] ?? null;
}

describe("built-in SQL starter code", () => {
  it("the catalog still contains the expected SQL questions", () => {
    assert.equal(
      sqlQuestions.length,
      24,
      "the built-in SQL catalog size changed; re-check every starter by hand",
    );
  });

  describe("each built-in SQL question", () => {
    for (const question of sqlQuestions) {
      const id = question.id;
      const starter = question.starterCode ?? "";
      const solution = question.solutionCode ?? "";

      it(`${id}: has both a starter and a solution`, () => {
        assert.ok(
          starter.trim().length > 0,
          `${id}: starterCode is missing or empty`,
        );
        assert.ok(
          solution.trim().length > 0,
          `${id}: solutionCode is missing or empty`,
        );
      });

      it(`${id}: starter is not the solution`, () => {
        assert.notEqual(
          normalize(starter),
          normalize(solution),
          `${id}: starterCode is identical to solutionCode, so the ` +
            `editor reveals the answer on open`,
        );
      });

      it(`${id}: starter does not contain the solution`, () => {
        assert.ok(
          !normalize(starter).includes(normalize(solution)),
          `${id}: starterCode embeds the whole solution`,
        );
      });

      it(`${id}: starter is an exploratory SELECT with a LIMIT`, () => {
        assert.match(
          starter,
          /\bselect\b/i,
          `${id}: starter must run a SELECT so it is executable`,
        );
        assert.match(
          starter,
          /\blimit\b/i,
          `${id}: starter must bound its rows with LIMIT`,
        );
      });

      it(`${id}: starter reads exactly one real table`, () => {
        const table = fromTable(starter);

        assert.ok(
          table !== null,
          `${id}: could not read a table name out of the starter`,
        );

        const available = (question.database?.tables ?? []).map(
          (t) => t.name,
        );

        assert.ok(
          available.includes(table as string),
          `${id}: starter reads "${table}", which is not a table in ` +
            `this question's database (${available.join(", ")})`,
        );

        // No second table, so a starter can never become a JOIN sketch.
        for (const other of available) {
          if (other === table) continue;

          assert.ok(
            !new RegExp(`\\b${other}\\b`, "i").test(starter),
            `${id}: starter also mentions "${other}"; a starter must ` +
              `inspect one table only`,
          );
        }

        assert.equal(
          (starter.match(/\bfrom\b/gi) ?? []).length,
          1,
          `${id}: starter must contain exactly one FROM clause`,
        );
      });

      it(`${id}: starter leaks no answer logic`, () => {
        for (const [label, pattern] of FORBIDDEN_PATTERNS) {
          assert.ok(
            !pattern.test(starter),
            `${id}: starter contains ${label}, which reveals or ` +
              `partially answers the question`,
          );
        }
      });

      it(`${id}: starter carries no threshold literals`, () => {
        for (const literal of numericLiterals(starter)) {
          assert.equal(
            literal,
            "5",
            `${id}: starter contains the literal ${literal}; only the ` +
              `LIMIT may be numeric`,
          );
        }
      });
    }
  });

  it("every starter names the table a learner should inspect first", () => {
    for (const question of sqlQuestions) {
      const table = fromTable(question.starterCode ?? "");

      assert.ok(
        table !== null,
        `${question.id}: starter has no readable FROM clause`,
      );
      assert.match(
        question.starterCode ?? "",
        new RegExp(`\\b${table}\\b`, "i"),
        `${question.id}: starter must reference "${table}" by name`,
      );
    }
  });

  it("PySpark starters are untouched by this rule", () => {
    const pyspark = questions.filter(
      (q) => q.questionType === "PySpark",
    );

    assert.ok(pyspark.length > 0, "expected PySpark questions to exist");

    for (const question of pyspark) {
      assert.ok(
        !normalize(question.starterCode ?? "").includes(
          "inspect the data first",
        ),
        `${question.id}: PySpark starter code must not be rewritten`,
      );
    }
  });
});

describe("admin-managed questions are unaffected", () => {
  /** Minimal input the parser accepts, with room to vary the two fields. */
  function adminInput(
    overrides: Partial<Question> = {},
  ): Record<string, unknown> {
    return {
      id: "admin-owned-question",
      title: "Admin Owned Question",
      description: "Created from the admin editor.",
      difficulty: "Easy",
      questionType: "SQL",
      category: "Filtering",
      languages: ["PostgreSQL"],
      tags: ["WHERE"],
      companies: [],
      starterCode: "SELECT *\nFROM widgets\nLIMIT 5;",
      solutionCode:
        "SELECT name\nFROM widgets\nWHERE active = true\nORDER BY name;",
      ...overrides,
    };
  }

  it("accepts a question whose starter differs from its solution", () => {
    const parsed = parseQuestionInput(adminInput());

    assert.equal(parsed.starterCode, "SELECT *\nFROM widgets\nLIMIT 5;");
    assert.equal(
      parsed.solutionCode,
      "SELECT name\nFROM widgets\nWHERE active = true\nORDER BY name;",
    );
    assert.notEqual(
      normalize(parsed.starterCode ?? ""),
      normalize(parsed.solutionCode ?? ""),
    );
  });

  it("still allows a question with no starter at all", () => {
    const parsed = parseQuestionInput(
      adminInput({ starterCode: undefined }),
    );

    assert.equal(
      parsed.starterCode ?? null,
      null,
      "admin questions must not be forced to carry a starter",
    );
  });
});