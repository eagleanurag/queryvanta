# Task FINAL - Final release and security audit

- **Roadmap id:** ` $id `
- **Phase:** Final release and security audit
- **AUTO_COMMIT:** false
- **AUTO_PUSH:** false
- **Depends on:** ` 5.5 `
- **Approved input:** `docs/qa/phase-4-abuse-audit.md` (for Phase 4 tasks)
- **Audit sections to read:** Whole repository

> This task file is intentionally a pointer, not a specification. The approved
> audit and the repository code are the authority. Do not invent requirements
> beyond them. If the audit and this file appear to disagree, trust the audit and
> report the discrepancy.

---

## Objective

See the title and the audit sections above. State the goal in one sentence in
your own words before making any change.

## Scope

Final pre-release verification of the entire repository.

## Scope
1. Full security review: authentication, authorization, CSRF, origin, sessions,
   PKCE, secret handling, injection, information disclosure.
2. Full free-tier review: every cost vector, with current numbers.
3. Full quality-gate run, with observed output for each.
4. Repository hygiene: untracked artifacts, ignored files, secrets, generated
   files, stray build output.
5. Documentation accuracy: verify the documented commands actually work as
   written. A documented command that does not work is a finding.
6. A written release recommendation under `docs/`.

## Non-goals
Do not implement fixes. Do not deploy, commit, or push. Do not change the
GitHub OAuth app, rotate secrets, or change the D1 schema. If a defect is found,
report it with evidence and severity; fix only a security defect, and say so
explicitly.

## Implementation requirements
Verify by running, not by reading. Any claim of a passing gate must be backed by
output you actually observed in this task. Distinguish confirmed from inferred.
Report the working tree state and current HEAD exactly.

## Required tests
Only if the review finds a gap.

## Required quality gates
```
npx tsc -b --force
npm run test:server
npm run build:pages
npm run verify:build pages
npm run build:worker
npm run verify:worker
npm run lint
git diff --check
```

Run the browser suites if the environment allows, following `README.md`, and
report honestly if you cannot. End with the pages build so the tracked SEO
snapshots stay on the GitHub Pages origin.

## Completion criteria
A complete written release audit exists with a clear PASS or BLOCKED verdict,
every gate has a recorded real result, and no unverified claim is made.

## Stop conditions
Stop and report BLOCKED if any gate fails, if a security defect is found, or if
the repository contains an unaccounted-for secret or generated artifact.

## Explicit non-goals

Anything not listed in the scope above. In particular: do not modify unrelated
features, do not change application behaviour for tidiness, do not widen scope
because something nearby looks improvable. Report adjacent problems instead.

## Relevant existing audit findings

Whole repository

## Implementation requirements

- Inspect the current repository state before changing anything.
- Base the change on the actual code, not on assumptions about it.
- Preserve every existing security property unless this task explicitly says to
  change one, and prove you preserved it with a test.
- Do not deploy anything and do not run any remote Cloudflare or database
  command.
- Do not modify or rotate secrets, the GitHub OAuth app, or the D1 schema.
- Do not run destructive git cleanup of any kind.
- Do not commit and do not push. Leave the working tree for review.
- Report honestly: a gate that you did not run must be reported as not run.

## Required tests

Cover the behaviour this task changes, plus a regression test proving the
security properties it must not weaken. Extend the existing test files rather
than creating a parallel harness.

## Required quality gates

`
npx tsc -b --force
npm run test:server
npm run lint
git diff --check
`

Report the real output of each gate. Never claim a gate passed without having run
it.

## Completion criteria

- Every scope item is done.
- Required tests exist and pass, observed.
- Every quality gate passes, observed.
- No file outside this task's scope was modified.
- A concise summary states what changed, which files, and anything deliberately
  left undone.

## Stop conditions

Stop and report BLOCKED rather than improvising if:

- The task turns out to contradict the approved audit.
- The change turns out to require a production deployment to validate.
- The change turns out to require a schema or secret change.
- A required gate cannot be run in this environment.
- The task would require weakening an existing security property.
- Scope appears to be materially larger than the task file describes.
