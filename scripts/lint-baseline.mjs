/**
 * Baseline-aware ESLint gate (CLI).
 *
 * `eslint .` cannot be the roadmap gate for this repository because it
 * fails on findings that pre-date the roadmap. Section L of
 * docs/qa/phase-4-abuse-audit.md says those are tracked separately and
 * must not be fixed during abuse/cost work. Ignoring lint would be
 * dishonest; failing every task on unrelated findings makes the
 * controller useless. So the gate is DELTA-BASED:
 *
 *   BASELINE diagnostic = allowed pre-existing finding
 *   NEW      diagnostic = failure
 *
 * Diagnostic identity is file + rule + normalised message. Line and
 * column are metadata only, so a finding that moves because code was
 * added above it is still the same finding.
 *
 * The verdict is computed from ESLint's JSON report, never from
 * rendered text, so a benign stderr warning cannot become a false
 * failure.
 *
 * Usage:
 *   node scripts/lint-baseline.mjs            compare against the baseline
 *   node scripts/lint-baseline.mjs --update   regenerate the baseline
 *   node scripts/lint-baseline.mjs --json     machine-readable result
 */

import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BASELINE_FORMAT,
  buildBaseline,
  compareDiagnostics,
  decideStatus,
  formatFinding,
  loadBaseline,
  readAutomationConfig,
  runEslint,
  summarizeDelta,
  toDiagnostics,
  warningsAreFailures,
  writeBaseline,
} from "../config/lint-baseline.ts";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

function report(comparison, { json }) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: comparison.status,
          baseline: comparison.baselineCount,
          current: comparison.currentCount,
          newCount: comparison.newCount,
          resolvedCount: comparison.resolvedCount,
          added: comparison.added,
          resolved: comparison.resolved,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write("lint:\n");
  process.stdout.write(
    `  baseline diagnostics: ${comparison.baselineCount}\n`,
  );
  process.stdout.write(
    `  current diagnostics:  ${comparison.currentCount}\n`,
  );
  process.stdout.write(`  new diagnostics:      ${comparison.newCount}\n`);

  if (comparison.resolvedCount > 0) {
    process.stdout.write(
      `  resolved diagnostics: ${comparison.resolvedCount}\n`,
    );
    for (const entry of comparison.resolved) {
      process.stdout.write(`${formatFinding(entry)}\n`);
    }
  }

  if (comparison.added.length > 0) {
    process.stdout.write("  new diagnostics detail:\n");
    for (const entry of comparison.added) {
      process.stdout.write(`${formatFinding(entry)}\n`);
    }
  }

  process.stdout.write(`  status: ${comparison.status}\n`);
}

function main(argv) {
  const update = argv.includes("--update");
  const json = argv.includes("--json");

  const run = runEslint(ROOT);
  const diagnostics = toDiagnostics(run.json, ROOT);

  if (update) {
    const target = writeBaseline(ROOT, buildBaseline(diagnostics));

    process.stdout.write(
      `lint baseline written: ${diagnostics.length} diagnostic(s) -> ${relative(ROOT, target)}\n`,
    );
    return 0;
  }

  const baseline = loadBaseline(ROOT);

  if (baseline === null) {
    process.stderr.write(
      "lint baseline is missing. Run: node scripts/lint-baseline.mjs --update\n",
    );
    return 2;
  }

  if (baseline.format !== BASELINE_FORMAT) {
    process.stderr.write(
      `lint baseline has unexpected format '${baseline.format}'.\n`,
    );
    return 2;
  }

  const delta = compareDiagnostics(diagnostics, baseline.diagnostics ?? []);
  const { newCount, resolvedCount } = summarizeDelta(delta);
  const failOnWarnings = warningsAreFailures(readAutomationConfig(ROOT));
  const status = decideStatus(delta, run.exitCode, failOnWarnings);

  // A new warning is always reported. Under the default policy it is
  // not fatal, but it is never silent.
  for (const entry of delta.added) {
    if (entry.severity === "warning" && !failOnWarnings) {
      process.stderr.write(
        `warning: new lint warning allowed by policy: ${entry.file}: ${entry.rule}\n`,
      );
    }
  }

  report(
    {
      status,
      baselineCount: (baseline.diagnostics ?? []).length,
      currentCount: diagnostics.length,
      newCount,
      resolvedCount,
      added: delta.added,
      resolved: delta.resolved,
    },
    { json },
  );

  return status === "PASS" ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}