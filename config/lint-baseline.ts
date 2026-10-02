/**
 * Baseline-aware lint gate.
 *
 * `eslint .` cannot be the roadmap gate for this repository because it
 * fails on findings that pre-date the roadmap. Section L of
 * docs/qa/phase-4-abuse-audit.md explicitly says the pre-existing
 * lint errors are "tracked separately" and must not be fixed while
 * doing abuse/cost work. Deleting the gate would be dishonest;
 * failing every task on unrelated findings makes the controller
 * useless. So the gate becomes DELTA-BASED:
 *
 *   BASELINE diagnostic = allowed pre-existing finding
 *   NEW      diagnostic = failure
 *
 * Identity is a signature of file + rule + normalised message.
 * Line and column are recorded as metadata but are deliberately NOT
 * part of identity, so a finding that shifts because code was added
 * above it is still the same finding. Counts are compared as a
 * multiset because one file can legitimately contain the same rule
 * and message twice.
 *
 * This module is the pure logic. scripts/lint-baseline.mjs is the CLI
 * wrapper, so the tests can import the decision logic directly without
 * running ESLint.
 *
 * Written in erasable TypeScript only (enforced by the
 * erasableSyntaxOnly compiler option), matching the other config/
 * modules that are shared with the Node scripts.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";

export const BASELINE_FORMAT = "queryvanta-lint-baseline";
export const BASELINE_VERSION = 1;

export type LintSeverity = "warning" | "error";

export type LintDiagnostic = {
  file: string;
  rule: string | null;
  severity: LintSeverity;
  message: string;
  line: number | null;
  column: number | null;
};

/**
 * A diagnostic that only appears in the baseline file. It carries no
 * position on purpose: position is not identity.
 */
export type BaselineEntry = {
  file: string;
  rule: string | null;
  severity: LintSeverity;
  message: string;
};

export type LintBaseline = {
  format: string;
  version: number;
  description?: string;
  diagnostics: BaselineEntry[];
};

export type CountedSignature = {
  signature: string;
  count: number;
  severity: LintSeverity;
  file: string;
  rule: string | null;
  message: string;
};

export type DeltaEntry = CountedSignature & {
  baselineCount?: number;
  currentCount?: number;
};

export type Delta = {
  added: DeltaEntry[];
  resolved: DeltaEntry[];
};

export type LintComparison = {
  added: DeltaEntry[];
  resolved: DeltaEntry[];
  baselineCount: number;
  currentCount: number;
  newCount: number;
  resolvedCount: number;
  status: "PASS" | "FAIL";
};

const SEVERITY_NAME: Record<number, LintSeverity> = {
  1: "warning",
  2: "error",
};

/**
 * Strip everything that is not part of the diagnostic itself.
 *
 * Some rules (the react-hooks ones) embed the absolute file path, the
 * line number and a rendered code frame INSIDE the message. That is
 * the single reason a naive file+rule+message signature would report
 * every existing finding as "new" the moment the repository moved, or
 * the moment someone added a line above it.
 */
export function normalizeMessage(raw: string | undefined | null): string {
  if (typeof raw !== "string") {
    return "";
  }

  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  // The code frame always begins with a line that looks like an
  // absolute path with a line:column suffix. Everything from there on
  // is position, not identity.
  const frameStart = lines.findIndex((line) =>
    /^(?:[A-Za-z]:[\\/]|\/)[^\n]*:\d+:\d+\s*$/.test(line.trim()),
  );

  const withoutFrame =
    frameStart === -1 ? lines : lines.slice(0, frameStart);

  return withoutFrame
    .join("\n")
    // Collapse every whitespace run so reflowing never changes identity.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Repository-relative, forward-slashed file path.
 *
 * Absolute paths must never reach the baseline file: it would pin the
 * baseline to one machine and break on every other checkout.
 */
export function normalizeFilePath(
  repoRoot: string,
  filePath: string,
): string {
  const absolute = isAbsolute(filePath)
    ? filePath
    : resolve(repoRoot, filePath);

  return relative(repoRoot, absolute).split(sep).join("/");
}

/**
 * The stable identity of one diagnostic.
 *
 * `line` and `column` are intentionally absent.
 */
export function diagnosticSignature(
  diagnostic: Pick<LintDiagnostic, "file" | "rule" | "message">,
): string {
  return [
    diagnostic.file,
    diagnostic.rule ?? "(fatal)",
    normalizeMessage(diagnostic.message),
  ].join("|");
}

/**
 * Convert ESLint's JSON output into normalized diagnostics.
 *
 * A file-level parse error has a null ruleId and must still be
 * reported: that is a real, new failure, not something a baseline can
 * excuse.
 */
export function toDiagnostics(
  eslintJson: unknown,
  repoRoot: string,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const files = Array.isArray(eslintJson)
    ? (eslintJson as Array<{
        filePath?: string;
        messages?: Array<{
          ruleId?: string | null;
          severity?: number;
          message?: string;
          line?: number;
          column?: number;
        }>;
      }>)
    : [];

  for (const file of files) {
    if (typeof file.filePath !== "string") {
      continue;
    }

    const filePath = normalizeFilePath(repoRoot, file.filePath);

    for (const message of file.messages ?? []) {
      diagnostics.push({
        file: filePath,
        rule: message.ruleId ?? null,
        severity: SEVERITY_NAME[message.severity ?? 2] ?? "error",
        message: normalizeMessage(message.message),
        line: message.line ?? null,
        column: message.column ?? null,
      });
    }
  }

  return diagnostics;
}

/**
 * Count signatures so duplicate findings are not collapsed.
 */
/**
 * Anything with the three identity fields can be counted: a live
 * diagnostic and a baseline entry are the same thing as far as
 * identity is concerned.
 */
export type Identifiable = {
  file: string;
  rule: string | null;
  message: string;
  severity: LintSeverity;
};

export function countBySignature(
  diagnostics: ReadonlyArray<Identifiable>,
): Map<string, CountedSignature> {
  const counts = new Map<string, CountedSignature>();

  for (const diagnostic of diagnostics) {
    const signature = diagnosticSignature(diagnostic);
    const existing = counts.get(signature);

    counts.set(signature, {
      signature,
      count: existing ? existing.count + 1 : 1,
      severity: diagnostic.severity,
      file: diagnostic.file,
      rule: diagnostic.rule,
      message: diagnostic.message,
    });
  }

  return counts;
}

export function compareDiagnostics(
  current: ReadonlyArray<LintDiagnostic>,
  baseline: ReadonlyArray<BaselineEntry>,
): Delta {
  const currentCounts = countBySignature(current);
  const baselineCounts = countBySignature(baseline);

  const added: DeltaEntry[] = [];
  const resolved: DeltaEntry[] = [];

  for (const entry of currentCounts.values()) {
    const was = baselineCounts.get(entry.signature);

    if (!was) {
      added.push({ ...entry, baselineCount: 0 });
      continue;
    }

    if (entry.count > was.count) {
      added.push({
        ...entry,
        count: entry.count - was.count,
        baselineCount: was.count,
      });
    }
  }

  for (const entry of baselineCounts.values()) {
    const now = currentCounts.get(entry.signature);

    if (!now) {
      resolved.push({ ...entry, currentCount: 0 });
      continue;
    }

    if (now.count < entry.count) {
      resolved.push({
        ...entry,
        count: entry.count - now.count,
        currentCount: now.count,
      });
    }
  }

  return { added, resolved };
}

/**
 * Is a new warning a failure?
 *
 * The repository policy is derived from `eslint .`, which fails only
 * on errors. It is configurable so the gate can be tightened later
 * without editing this module.
 */
export function warningsAreFailures(
  config: {
    qualityGates?: {
      lintBaseline?: { failOnWarnings?: boolean };
    };
  },
): boolean {
  const policy = config.qualityGates?.lintBaseline;

  if (typeof policy?.failOnWarnings === "boolean") {
    return policy.failOnWarnings;
  }

  return false;
}

export function baselinePathFor(repoRoot: string): string {
  return resolve(repoRoot, ".automation", "lint-baseline.json");
}

export function buildBaseline(
  diagnostics: ReadonlyArray<LintDiagnostic>,
): LintBaseline {
  return {
    format: BASELINE_FORMAT,
    version: BASELINE_VERSION,
    description:
      "Pre-existing lint diagnostics allowed by the roadmap gate. " +
      "Regenerate deliberately with: node scripts/lint-baseline.mjs --update",
    diagnostics: diagnostics.map((diagnostic) => ({
      file: diagnostic.file,
      rule: diagnostic.rule,
      severity: diagnostic.severity,
      message: diagnostic.message,
    })),
  };
}

export function writeBaseline(
  repoRoot: string,
  baseline: LintBaseline,
): string {
  const target = baselinePathFor(repoRoot);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  return target;
}

export function loadBaseline(repoRoot: string): LintBaseline | null {
  const target = baselinePathFor(repoRoot);

  if (!existsSync(target)) {
    return null;
  }

  return JSON.parse(readFileSync(target, "utf8")) as LintBaseline;
}

export function readAutomationConfig(repoRoot: string): unknown {
  const configPath = resolve(repoRoot, ".automation", "config.json");

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

export type EslintRun = {
  json: unknown;
  exitCode: number;
  stderr: string;
};

/**
 * Output budget for the ESLint child process.
 *
 * ESLint's `--format json` report is printed in full on stdout, and this
 * repository's report is large enough to exceed Node's default
 * `spawnSync` buffer, which surfaces as `spawnSync ... ENOBUFS` and makes
 * the gate fail for the wrong reason. 64 MB is generous for a report that
 * is a few hundred KB today and still bounded.
 */
const ESLINT_MAX_BUFFER = 64 * 1024 * 1024;

export function runEslint(repoRoot: string): EslintRun {
  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "node_modules", "eslint", "bin", "eslint.js"),
      ".",
      "--format",
      "json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      maxBuffer: ESLINT_MAX_BUFFER,
    },
  );

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout ?? "";
  let parsed: unknown = null;

  if (stdout.trim()) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
  }

  // ESLint's JSON report goes to stdout; stderr may carry benign
  // warnings that are captured for the report and never treated as
  // the result. An unparseable report means ESLint itself failed.
  if (parsed === null) {
    throw new Error(
      `eslint produced no parsable JSON report (exit ${result.status}).\n${
        result.stderr ?? ""
      }`.trim(),
    );
  }

  return {
    json: parsed,
    exitCode: result.status ?? 0,
    stderr: result.stderr ?? "",
  };
}

export function summarizeDelta(delta: Delta): {
  newCount: number;
  resolvedCount: number;
} {
  return {
    newCount: delta.added.reduce((total, entry) => total + entry.count, 0),
    resolvedCount: delta.resolved.reduce(
      (total, entry) => total + entry.count,
      0,
    ),
  };
}

/**
 * Decide PASS or FAIL for a comparison.
 *
 * `eslintExitCode` is honoured only when it indicates a tool failure
 * (2). Exit code 1 simply means "there are lint problems", which the
 * delta comparison has already judged.
 */
export function decideStatus(
  delta: Delta,
  eslintExitCode: number,
  failOnWarnings: boolean,
): "PASS" | "FAIL" {
  const failing = delta.added.filter((entry) =>
    entry.severity === "warning" ? failOnWarnings : true,
  );

  if (failing.length > 0) {
    return "FAIL";
  }

  if (eslintExitCode === 2) {
    return "FAIL";
  }

  return "PASS";
}

export function formatFinding(entry: DeltaEntry): string {
  const rule = entry.rule ?? "(fatal)";
  const suffix = entry.count === 1 ? "" : ` (x${entry.count})`;

  return `  ${entry.file}: ${rule} — ${entry.message}${suffix}`;
}