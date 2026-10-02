/**
 * Lint-baseline gate tests.
 *
 * The roadmap gate cannot be plain `eslint .`: this repository carries
 * 5 pre-existing errors and 2 warnings in src/ that section L of the
 * Phase 4 abuse audit explicitly says must NOT be fixed as part of
 * abuse/cost work. Failing every task on them is as dishonest as
 * ignoring lint entirely.
 *
 * These tests lock in the DELTA policy:
 *
 *   identical baseline              => PASS
 *   baseline plus a new issue       => FAIL
 *   baseline issue moved a line     => still baseline
 *   baseline issue changed rule     => FAIL
 *   baseline issue removed          => PASS
 *   warning honours configured policy
 *
 * They use synthetic ESLint output, so they are deterministic and do
 * not depend on the current contents of src/.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBaseline,
  compareDiagnostics,
  countBySignature,
  decideStatus,
  diagnosticSignature,
  normalizeFilePath,
  normalizeMessage,
  summarizeDelta,
  toDiagnostics,
  warningsAreFailures,
} from "../../config/lint-baseline.ts";

const REPO_ROOT = "C:\\repo";

type RawMessage = {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
};

function message({
  line = 1,
  column = 1,
  rule,
  text,
  frame = true,
}: {
  line?: number;
  column?: number;
  rule: string;
  text: string;
  frame?: boolean;
}): RawMessage {
  return {
    ruleId: rule,
    severity: 2,
    message: frame
      ? `Error: ${text}\n\nSome explanation paragraph.\n\n${REPO_ROOT}\\src\\App.tsx:${line}:${column}\n  ${line} |\n> ${line} | x`
      : `Error: ${text}`,
    line,
    column,
  };
}

type EslintJsonFile = {
  filePath: string;
  messages: RawMessage[];
  errorCount: number;
  warningCount: number;
};

function jsonOf(messages: RawMessage[]): EslintJsonFile[] {
  return [
    {
      filePath: `${REPO_ROOT}\\src\\App.tsx`,
      messages,
      errorCount: messages.filter((m: RawMessage) => m.severity === 2)
        .length,
      warningCount: messages.filter((m: RawMessage) => m.severity === 1)
        .length,
    },
  ];
}

const baselineFinding = message({
  line: 226,
  column: 5,
  rule: "react-hooks/set-state-in-effect",
  text: "Calling setState synchronously within an effect can trigger cascading renders",
});

describe("lint baseline identity", () => {
  it("strips the code frame, path and line numbers from a message", () => {
    const normalized = normalizeMessage(baselineFinding.message);

    assert.equal(
      normalized,
      "Error: Calling setState synchronously within an effect can trigger cascading renders Some explanation paragraph.",
    );
    assert.ok(!normalized.includes("App.tsx"));
    assert.ok(!normalized.includes("226"));
  });

  it("collapses whitespace so reflowed text is the same diagnostic", () => {
    assert.equal(
      normalizeMessage("a\n\n  b   c\t d"),
      normalizeMessage("a b c d"),
    );
  });

  it("leaves a plain message alone apart from whitespace", () => {
    assert.equal(
      normalizeMessage("Fast refresh only works when a file only exports components."),
      "Fast refresh only works when a file only exports components.",
    );
  });

  it("produces repository-relative forward-slash file paths", () => {
    assert.equal(
      normalizeFilePath(REPO_ROOT, `${REPO_ROOT}\\src\\pages\\QuestionPage.tsx`),
      "src/pages/QuestionPage.tsx",
    );
  });

  it("never puts an absolute path in the signature", () => {
    const signature = diagnosticSignature(
      toDiagnostics(jsonOf([baselineFinding]), REPO_ROOT)[0],
    );

    assert.ok(!signature.includes("C:"));
    assert.ok(signature.startsWith("src/App.tsx|"));
  });

  it("keeps duplicates as a count rather than collapsing them", () => {
    const second = message({
      line: 317,
      column: 7,
      rule: "react-hooks/set-state-in-effect",
      text: "Calling setState synchronously within an effect can trigger cascading renders",
    });

    const diagnostics = toDiagnostics(jsonOf([baselineFinding, second]), REPO_ROOT);
    const counts = countBySignature(diagnostics);

    assert.equal(counts.size, 1);
    assert.equal([...counts.values()][0].count, 2);
  });
});

describe("lint baseline delta policy", () => {
  const baseline = toDiagnostics(jsonOf([baselineFinding]), REPO_ROOT);

  it("PASSES when current is identical to baseline", () => {
    const { added, resolved } = compareDiagnostics(baseline, baseline);

    assert.equal(added.length, 0);
    assert.equal(resolved.length, 0);
  });

  it("FAILS on a baseline plus a new issue", () => {
    const extra = message({
      line: 999,
      column: 3,
      rule: "react-hooks/purity",
      text: "Cannot call impure function during render",
    });

    const current = toDiagnostics(
      jsonOf([baselineFinding, extra]),
      REPO_ROOT,
    );

    const { added } = compareDiagnostics(current, baseline);

    assert.equal(added.length, 1);
    assert.equal(added[0].rule, "react-hooks/purity");
    assert.equal(added[0].count, 1);
    assert.equal(added[0].baselineCount, 0);
  });

  it("still treats a baseline finding that moved line as baseline", () => {
    const moved = message({
      line: 240,
      column: 9,
      rule: "react-hooks/set-state-in-effect",
      text: "Calling setState synchronously within an effect can trigger cascading renders",
    });

    const current = toDiagnostics(jsonOf([moved]), REPO_ROOT);
    const { added, resolved } = compareDiagnostics(current, baseline);

    assert.equal(added.length, 0);
    assert.equal(resolved.length, 0);
  });

  it("FAILS when a baseline finding changes rule", () => {
    const reclassified = message({
      line: 226,
      column: 5,
      rule: "react-hooks/exhaustive-deps",
      text: "Calling setState synchronously within an effect can trigger cascading renders",
    });

    const current = toDiagnostics(jsonOf([reclassified]), REPO_ROOT);
    const { added, resolved } = compareDiagnostics(current, baseline);

    assert.equal(added.length, 1);
    assert.equal(added[0].rule, "react-hooks/exhaustive-deps");
    assert.equal(resolved.length, 1);
  });

  it("FAILS when a baseline finding changes message", () => {
    const reworded = message({
      line: 226,
      column: 5,
      rule: "react-hooks/set-state-in-effect",
      text: "Calling setState synchronously within an effect can cause a loop",
    });

    const current = toDiagnostics(jsonOf([reworded]), REPO_ROOT);
    const { added } = compareDiagnostics(current, baseline);

    assert.equal(added.length, 1);
  });

  it("PASSES when a baseline finding is removed", () => {
    const { added, resolved } = compareDiagnostics([], baseline);

    assert.equal(added.length, 0);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].count, 1);
  });

  it("detects a genuinely new duplicate of an existing signature", () => {
    const current = toDiagnostics(
      jsonOf([
        baselineFinding,
        message({
          line: 400,
          column: 7,
          rule: "react-hooks/set-state-in-effect",
          text: "Calling setState synchronously within an effect can trigger cascading renders",
        }),
      ]),
      REPO_ROOT,
    );

    const { added } = compareDiagnostics(current, baseline);

    assert.equal(added.length, 1);
    assert.equal(added[0].count, 1);
    assert.equal(added[0].baselineCount, 1);
  });

  it("treats an unparseable file as a new fatal diagnostic", () => {
    const current = toDiagnostics(
      [
        {
          filePath: `${REPO_ROOT}\\src\\broken.tsx`,
          messages: [{ ruleId: null, severity: 2, message: "Parsing error: unexpected token" }],
        },
      ],
      REPO_ROOT,
    );

    const { added } = compareDiagnostics(current, []);

    assert.equal(added.length, 1);
    assert.equal(added[0].rule, null);
    assert.ok(diagnosticSignature(added[0]).includes("(fatal)"));
  });
});

describe("lint baseline warning policy", () => {
  const warning = {
    ruleId: "react-hooks/exhaustive-deps",
    severity: 1,
    message: "React Hook useMemo has unnecessary dependencies: 'navListVersion'",
    line: 428,
    column: 5,
  };

  it("classifies severity 1 as a warning", () => {
    const [diagnostic] = toDiagnostics(
      [
        {
          filePath: `${REPO_ROOT}\\src\\pages\\QuestionPage.tsx`,
          messages: [warning],
        },
      ],
      REPO_ROOT,
    );

    assert.equal(diagnostic.severity, "warning");
  });

  it("does not fail new warnings under the default policy", () => {
    assert.equal(warningsAreFailures({}), false);
  });

  it("fails new warnings when configured to", () => {
    assert.equal(
      warningsAreFailures({
        qualityGates: { lintBaseline: { failOnWarnings: true } },
      }),
      true,
    );
  });

  it("explicit false overrides a missing policy", () => {
    assert.equal(
      warningsAreFailures({
        qualityGates: { lintBaseline: { failOnWarnings: false } },
      }),
      false,
    );
  });

  it("still reports a new warning as an added diagnostic either way", () => {
    const current = toDiagnostics(
      [
        {
          filePath: `${REPO_ROOT}\\src\\pages\\QuestionPage.tsx`,
          messages: [warning],
        },
      ],
      REPO_ROOT,
    );

    const { added } = compareDiagnostics(current, []);

    assert.equal(added.length, 1);
    assert.equal(added[0].severity, "warning");
  });

  it("does not fail on a new warning under the default policy", () => {
    const current = toDiagnostics(
      [
        {
          filePath: `${REPO_ROOT}\\src\\pages\\QuestionPage.tsx`,
          messages: [warning],
        },
      ],
      REPO_ROOT,
    );

    const delta = compareDiagnostics(current, []);

    assert.equal(decideStatus(delta, 1, false), "PASS");
  });

  it("fails on a new warning when configured to", () => {
    const current = toDiagnostics(
      [
        {
          filePath: `${REPO_ROOT}\\src\\pages\\QuestionPage.tsx`,
          messages: [warning],
        },
      ],
      REPO_ROOT,
    );

    const delta = compareDiagnostics(current, []);

    assert.equal(decideStatus(delta, 1, true), "FAIL");
  });
});

describe("lint baseline verdict", () => {
  const baseline = toDiagnostics(jsonOf([baselineFinding]), REPO_ROOT);

  it("PASSES an identical baseline even though eslint exited 1", () => {
    const delta = compareDiagnostics(baseline, baseline);

    assert.equal(decideStatus(delta, 1, false), "PASS");
  });

  it("FAILS when eslint itself failed (exit 2) even with no new finding", () => {
    const delta = compareDiagnostics(baseline, baseline);

    assert.equal(decideStatus(delta, 2, false), "FAIL");
  });

  it("FAILS when a new error is present regardless of eslint exit code", () => {
    const extra = message({
      line: 42,
      column: 1,
      rule: "no-debugger",
      text: "Unexpected console statement.",
    });

    const delta = compareDiagnostics(
      toDiagnostics(jsonOf([baselineFinding, extra]), REPO_ROOT),
      baseline,
    );

    assert.equal(decideStatus(delta, 1, false), "FAIL");
    assert.equal(summarizeDelta(delta).newCount, 1);
  });

  it("counts resolved diagnostics without failing", () => {
    const delta = compareDiagnostics([], baseline);

    assert.equal(decideStatus(delta, 1, false), "PASS");
    assert.equal(summarizeDelta(delta).resolvedCount, 1);
  });
});

describe("lint baseline file", () => {
  it("round-trips diagnostics without absolute paths", () => {
    const baseline = buildBaseline(
      toDiagnostics(jsonOf([baselineFinding]), REPO_ROOT),
    );

    assert.equal(baseline.format, "queryvanta-lint-baseline");
    assert.equal(baseline.diagnostics.length, 1);
    assert.equal(baseline.diagnostics[0].file, "src/App.tsx");
    assert.ok(!JSON.stringify(baseline).includes("C:\\"));
    assert.ok(!("line" in baseline.diagnostics[0]));
  });
});