# QA — Autonomous controller power-loss resilience

**Scope:** the controller infrastructure under `.automation/` and
`scripts/automation/`. No QueryVanta application behaviour was changed by this
work.
**Baseline:** `main` at `2cf3d57 Add deterministic build targets`.
**OpenCode under test:** `v2.0.11` on Windows, Windows PowerShell 5.1 Desktop.

---

## A. What was requested

Make the roadmap survive terminal closure, OpenCode process termination, a
Windows restart, and unexpected power loss, resuming from durable state instead
of restarting the roadmap.

## B. Session-resume probe (the assumption that had to be tested first)

The brief asked me to determine whether `opencode run --standalone --session
<ID>` can continue a local session after the original process exited, rather than
assuming it. I built a throwaway probe. I did **not** point it at the real 4.2A
session, so the interrupted task was never touched.

| Step | Command | Result |
|---|---|---|
| 1 | fresh `opencode run --standalone --format json --auto "<probe>"` | exit 0, created session `ses_f165263aaffeuuLWIm6vhkdagS` |
| 2 | **new process**, same session: `... --auto --session ses_f165263aaffeuuLWIm6vhkdagS "<probe2>"` | **exit 0, SAME session id, agent replied `PROBE-ACK-2`** |
| 3 | same, with a nonexistent id | **exit 1**, machine-readable error |

Step 3 output:

```json
{"type":"error","timestamp":1790626922969,"sessionID":"",
 "error":{"type":"unknown","message":"Session not found"}}
```

**Conclusion: session continuation is supported and its failure mode is
detectable.** That is what makes the fallback safe rather than speculative.
`Test-SessionResumeFailed` keys on a non-zero exit, the literal `Session not
found`, and a mismatched session id.

Session data lives in `%USERPROFILE%\.local\share\opencode\opencode.db` (SQLite).
The interrupted 4.2A session `ses_f16dae178ffe8SBieuLYtoSEyy` was confirmed
present in that store, so it is a candidate for continuation.

## C. What was implemented

| Area | Change |
|---|---|
| State model | Added `controllerRunId`, `taskCheckpoint`, `taskCheckpointAt`, `resumeMode`, `interruptedAt`, `interruptionReason`, `durableOpenCodeSessionId`, `recoveryCount`. Read through `Get-StateProperty`, so a `schemaVersion` 1 file stays readable. |
| Checkpoints | `Save-Checkpoint` persists 9 controller stages atomically. Informational only; never a result. |
| Interruption detection | `Get-InterruptedRun` implements the A–E decision rules. |
| Resume planning | `Get-ResumePlan` returns `fresh`, `session-resume` or `recovery-prompt`. |
| Session resume | `invoke-opencode.ps1` gained `-ResumeSessionId`, adding `--session`; detects a failed attachment. |
| Fallback | On a failed attachment the **same attempt** is retried with a fresh session and an explicit interrupted-run brief. The task is never skipped. |
| Durable session | `durableOpenCodeSessionId` is written as soon as the id is known, so a crash later still leaves a resumable id. |
| Recovery launcher | New `scripts/automation/recovery-launcher.ps1`: readiness wait, duplicate refusal, state report, completed-roadmap exit, hand-off to the runner. |
| Installer | `install-autonomous-task.ps1` now targets the launcher, is idempotent, and asserts exactly one registration. |
| Operator recovery | `recover-task.ps1 -TaskId <id> -RecoverInterrupted` repairs an interrupted run without touching the working tree. |
| Status | `-Status` now reports checkpoint, resume mode, durable session, recovery count and the interruption classification. |

## D. Decision rules as implemented

| Persisted state | Classified | Behaviour |
|---|---|---|
| all tasks completed | complete | exit 0, no work, never restarts |
| `running` / `verifying` / `recovering` / `opencode_started` / `result_parsed` / `verification_started`, no live controller | interrupted | resume that task |
| `blocked`, `lastResult` null, no verification, session id present | interruption artifact | resume that task |
| `blocked` with a real `lastResult` | genuine BLOCKED | stays blocked, not retried |
| task already in `completedTaskIds` | not an interruption | never re-run |
| anything else | normal | next roadmap task |

The live state at the time of this work — `4.2A`, `blocked`, `lastResult` null,
`lastVerification` null, session id present — classifies as an **interruption
artifact**, and the runner reports `resume plan = session-resume`.

## E. Tests

`scripts/automation/test-controller.ps1`: **243 passed, 0 failed.** Coverage maps
to the 13 required areas:

| # | Requirement | Where |
|---|---|---|
| 1 | state backward compatibility | v1 object has no new fields; `Get-StateProperty` returns defaults and does not throw |
| 2 | atomic state persistence | temp-then-replace; no `.tmp` left; byte-identical after a simulated crash |
| 3 | checkpoint persistence | all 9 names persist; unknown name rejected; ISO timestamp written |
| 4 | interrupted RUNNING detection | `running` plus 4 other in-flight statuses detected as interrupted |
| 5 | genuine BLOCKED preserved | `lastResult = BLOCKED` → `GenuineBlocked = true`, resume plan `none` |
| 6 | current 4.2A interruption recovery | artifact state → interrupted, not genuine blocked, plan `session-resume` |
| 7 | completed roadmap exits cleanly | `Select-NextTask` null, no interruption reported |
| 8 | duplicate scheduled task prevention | installer uses `-Force` and asserts exactly one registration |
| 9 | recovery launcher argument correctness | asserts it targets this repo, the launcher not the runner, no hardcoded pid or session id, required flags present |
| 10 | session-resume detection | clean continuation false; non-zero exit, `Session not found`, mismatched id, null run all true |
| 11 | fallback when session cannot be resumed | blank/absent session → `recovery-prompt`; brief content asserted |
| 12 | concurrent controller protection | second lock acquisition refused; `Test-ControllerActive` true then false |
| 13 | PowerShell 5.1 compatibility | PSVersion 5, Desktop edition, no PS7-only syntax, every script parses |

Live behavioural checks, outside the unit suite:

```
recovery-launcher.ps1 -NoWait -DryRun
  -> "interrupted run of 4.2A detected: blocked-without-result-interruption-artifact"
  -> "resume plan    : session-resume"
  -> "working tree   : 9 entries preserved; no reset or clean will be performed"

live lock present + launcher
  -> "exiting with code 0 (controller already active)"

completed roadmap + launcher
  -> "exiting with code 0 (roadmap complete)"
```

## F. Quality gates

| Gate | Result |
|---|---|
| `test-controller.ps1` | **243 passed, 0 failed** |
| `npx tsc -b --force` | **PASS** (exit 0) |
| `npm run test:server` | **PASS** — 29 build-target, 15 merge, 16 PKCE, 5 OAuth, 10 secrets, 50 security, 7 housekeeping, 8 worker = **140 passed, 0 failed** |
| `npm run lint` | **7 problems (5 errors, 2 warnings)** — the unchanged pre-existing baseline |
| `git diff --check` | **PASS** (exit 0) |

The 7 housekeeping tests are the interrupted 4.2A run's own new test file, not
work from this change. Lint's 5 errors remain the same `src/` files and lines
recorded at the original baseline.

## G. A self-inflicted bug worth recording

My first version of the resilience self-test wrote a placeholder to the **real**
`.automation/state.json` and restored it with `New-AutomationState` at the end.
That would have destroyed the very interrupted 4.2A run the operator needed to
recover. It did exactly that on one run, and I restored the file from an
independent backup taken beforehand.

The test now:

1. copies the live state to a sandbox backup before doing anything;
2. restores it verbatim in the normal path; and
3. installs a `trap` so that even a thrown assertion restores it, rather than
   aborting and leaving the placeholder behind.

The real state was verified intact after the final green run:
`status=blocked, task=4.2A, attempt=1, session=ses_f16dae178ffe8SBieuLYtoSEyy`.

Two other `return , @(...)` instances and a `Set-StateProperty` parameter-name
mismatch were found and fixed the same way: by the test, not by inspection.

## H. Safety confirmation

No `git reset --hard`, no `git clean`, no commit, no push, no deployment, no
`wrangler deploy`, no remote D1 mutation, no secret or OAuth change. The 9
modified/untracked application files left by the interrupted 4.2A run were
preserved untouched. The scheduled task was **not** installed.

## I. Known limitations

- Session continuation depends on the OpenCode local store surviving. If the
  store is cleared between reboot and recovery, the controller falls back to a
  fresh session with a recovery brief, which is slower but correct.
- `durableOpenCodeSessionId` is only written once an id is known. A power loss in
  the seconds before the first event is written leaves no session to continue,
  and recovery correctly uses the fresh-session brief.
- The readiness wait in the launcher probes `node`, `opencode` and log-directory
  writability. It does not verify network reachability to the model provider, so
  a very early boot with no network will fail in the agent rather than in the
  launcher.
- The launcher uses an at-logon trigger. A machine that never reaches a logon
  will not auto-recover; that is deliberate, since interactive session start is
  what the agent's tooling needs.
