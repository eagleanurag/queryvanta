# QueryVanta Autonomous Project Builder

A local Windows automation layer that executes the approved QueryVanta roadmap
through OpenCode without a human copying prompts back and forth.

This layer is **independent of any ChatGPT browser conversation**. It does not
read, control, simulate, or depend on a ChatGPT session. It follows the
approved local roadmap in `.automation/roadmap.json` and the task contracts in
`.automation/tasks/`. Its only inputs are this repository, the approved abuse
audit at `docs/qa/phase-4-abuse-audit.md`, and OpenCode.

---

## 1. Why this exists

The previous workflow required a person to be present at every hand-off:

```
ChatGPT prompt -> copy into OpenCode -> OpenCode works -> export result
   -> copy result -> paste into ChatGPT -> decide next task -> repeat
```

That loop is fragile: it loses context on a terminal close, has no record of
what actually ran, cannot resume after a reboot, and cannot tell the difference
between a task that passed and a task that merely produced a cheerful summary.

This controller replaces the human in the loop with durable state and hard
gates.

---

## 2. Architecture

```
.automation/
  config.json                     controller policy; no secrets
  roadmap.json                    the approved task list, in order, with deps
  state.json                      durable progress; atomically replaced
  tasks/<id>-<slug>.md            one contract per task
  logs/                           timestamped runner + agent + verify logs
  failures/<task>-<ts>/           per-failure evidence: transcript, gates, summary
  .runner.lock                    single-instance lock
  .gitignore                      logs and failures are never committed

scripts/automation/
  Automation.Common.ps1           paths, atomic JSON, roadmap, lock, parsing
  autonomous-runner.ps1           the controller loop
  invoke-opencode.ps1             one standalone OpenCode process per task
  verify-task.ps1                 runs the task's configured gates
  recover-task.ps1                one bounded diagnosis-and-fix invocation
  recovery-launcher.ps1           readiness wait + recovery decision + hand-off
  install-autonomous-task.ps1     Scheduled Task helper (never auto-installed)
  test-controller.ps1             controller self-test; never invokes OpenCode
  test-fixtures/*.jsonl           offline agent-output fixtures
```

Control flow for one task:

```
read state -> select next task -> pre-flight safety -> build agent prompt
   -> opencode run --standalone --format json --auto
   -> capture stdout+stderr to a timestamped log
   -> parse JSONL for session id and text
   -> parse the AUTONOMOUS_TASK_STATUS marker
   -> post-flight safety scan of agent output
   -> run the task's verification gates
   -> record result, persist state, choose the next task
```

### Why `--standalone`

Each task gets its own private OpenCode process:

```
opencode run --standalone --format json --auto
```

The `--server` flag is **explicitly refused**, in `config.json`
(`opencode.forbiddenFlags`) and again in code in `invoke-opencode.ps1`, because
the running background service does not expose a compatible V2 health response.
A fresh process per task also means one task's context can never leak into the
next one's.

---

## 3. The agent contract

Every prompt tells the agent to inspect the repository first, read its task
file and the relevant audit sections, stay inside scope, avoid unrelated
changes, never deploy, never touch remote D1, never rotate secrets, never run
destructive git, run the required tests and gates, and never push unless the
task explicitly permits it.

The response must end with:

```
AUTONOMOUS_TASK_STATUS: PASS
AUTONOMOUS_TASK_STATUS: FAIL
AUTONOMOUS_TASK_STATUS: BLOCKED

AUTONOMOUS_TASK_ID: <id>
```

**A missing marker is a failure.** The controller never infers success from a
transcript that does not state it. An agent that exits 0 but omits the marker is
recorded as `FAIL`.

---

## 4. State and resume

`.automation/state.json` holds `schemaVersion`, `project`, `currentTaskId`,
`currentAttempt`, `status`, `lastStartedAt`, `lastFinishedAt`, `lastExitCode`,
`lastOpenCodeSessionId`, `lastResult`, `completedTaskIds`, `failedTaskIds`,
`retryCount` and `lastError`.

Every write goes to `state.json.tmp`, is flushed to disk, and only then replaces
`state.json` via `File.Replace`. The previous state is never truncated or
removed first, so a hard kill or a power loss leaves a readable, correct state
file plus at most a stray temp file. The next write cleans that up.

Resume is therefore automatic: restart the runner and it reads the state file,
sees which task ids are complete, and continues. Nothing restarts the roadmap.

If the state file is ever unreadable it is renamed to `state.json.corrupt-<ts>`
and rebuilt empty, rather than being silently discarded.

---

## 5. Task selection

`Select-NextTask` walks `roadmap.json` in order and returns the first task whose
`dependsOn` entries are all in `completedTaskIds`. Consequences:

- Completing `4.2A` advances to `4.2B`.
- Skipping a task blocks its dependents rather than running them out of order.
- A fully completed roadmap selects nothing and the controller exits cleanly.

A task in `failedTaskIds` is not silently retried; retries are bounded and owned
by the task loop.

Run a single task with `-TaskId`.

---

## 6. Verification

Each roadmap task declares its own `verification` commands. `verify-task.ps1`
runs them in the repository root and records, for every one: the command, the
exit code, the output, the timestamp and the duration. A combined report is
written to `.automation/logs/verify-<task>-<ts>.log`.

**A non-zero exit code is never treated as success.** If the agent reports
`PASS` but a gate fails, the effective status becomes `FAIL` and the gates win.

---

## 7. Failure and recovery

`maxAttemptsPerTask` defaults to `2`, with `recoveryInvocationsPerFailure`
defaulting to `1`. On a failed attempt:

1. the complete agent log, transcript, verification report and a `summary.json`
   are saved under `.automation/failures/<task>-<ts>/`;
2. state is persisted with the failure recorded;
3. one recovery invocation runs, given the original task, the failure output and
   the current git state, instructed to diagnose and fix **only** that failure;
4. the task is re-run and re-verified from the top.

If the attempt budget is exhausted the task is marked failed, persisted, and the
controller **stops**. It never loops forever.

If the agent reports `BLOCKED`, or a safety guard trips, or the branch changed
unexpectedly, the controller stops immediately and does not continue to the next
task.

There is no autonomous destructive rollback. The controller never runs
`git reset --hard`, `git clean -fd`, or any equivalent.

---

## 8. Power-loss and reboot recovery

The controller is built to survive the roadmap being interrupted by something
outside the agent: a closed terminal, a killed process, a Windows restart, or a
power cut.

### What happens after a restart

```
Windows boots / user logs on
  -> Task Scheduler starts recovery-launcher.ps1
     -> waits for Windows, network and the Node toolchain to be ready
     -> refuses to start if a controller already holds the lock
     -> reads .automation/state.json and logs what it finds
     -> exits immediately if the roadmap is already complete
     -> otherwise starts autonomous-runner.ps1
        -> classifies the persisted state (see below)
        -> resumes the interrupted task, never skipping it
        -> verification, then the next task
```

### Durable state

`state.json` carries, in addition to the original fields:

| Field | Meaning |
|---|---|
| `controllerRunId` | identifies one controller invocation |
| `taskCheckpoint` | last controller stage reached |
| `taskCheckpointAt` | when that stage was recorded |
| `resumeMode` | `fresh`, `session-resume` or `recovery-prompt` |
| `interruptedAt` | when an interruption was detected |
| `interruptionReason` | why it was classified as interrupted |
| `durableOpenCodeSessionId` | OpenCode session to try to continue |
| `recoveryCount` | how many times recovery has run |

Every write is atomic, so state is never partially written. A `schemaVersion` 1
state file remains readable: the new fields simply read as empty, so an old file
never becomes unreadable.

### Checkpoints

`selected`, `preflight_complete`, `opencode_started`, `opencode_finished`,
`result_parsed`, `verification_started`, `verification_passed`,
`task_completed`, `controller_stopped`.

Checkpoints are **informational only**. They show how far a run got. No code
path treats a checkpoint as a result: only the agent's own
`AUTONOMOUS_TASK_STATUS` plus passing verification gates can complete a task.

### How an interrupted run is detected

| Persisted state | Classification | Action |
|---|---|---|
| roadmap complete | done | exit immediately, never restart |
| status in flight (`running`, `verifying`, ...) and no live controller | interrupted | resume the task |
| `blocked`, `lastResult` null, no verification, session id present | **interruption artifact** | resume the task |
| `blocked` **with** a real `lastResult` | **genuine BLOCKED** | stay blocked, never auto-retry |
| nothing in flight | normal | next roadmap task |

A genuine `AUTONOMOUS_TASK_STATUS: BLOCKED` is never cleared automatically. Only
an interruption artifact is.

The working tree is never reset, cleaned, or reverted. Partial work from an
interrupted run is adopted, not discarded.

### Session-resume semantics

This is stated precisely because the honest version is narrower than it sounds.

The controller does **not** claim it can resume an interrupted provider call at
an exact hidden model instruction. What it does is the strongest safe thing
available, verified against the installed **OpenCode v2.0.11**:

1. Try to continue the previous durable OpenCode session with
   `opencode run --standalone --session <ID>`.
2. If that session still exists locally, the agent is re-entered into its own
   prior context and resumes from where it was.
3. If the session cannot be continued, fall back to a **fresh** session with an
   explicit recovery brief containing the task id, task file, attempt, repository
   state, the previous log path, and an instruction to adopt the existing partial
   work rather than start over.

The probe that established this: a brand new process with
`--standalone --session <ID>` continued the same local session and exited 0; the
same command with an unknown id exited 1 and emitted a machine-readable
`Session not found` error event, which is how the fallback is triggered.

The task is never skipped because a process disappeared, and an interrupted task
is never marked PASS.

### Installing the startup task

Never installed automatically. Explicitly:

```powershell
.\scripts\automation\install-autonomous-task.ps1 -Install
```

Idempotent: it uses `Register-ScheduledTask -Force`, so running it repeatedly
updates the single registration rather than adding another, and it verifies that
exactly one registration exists afterwards.

The task runs at logon as the current user, limited privileges, no elevation,
`MultipleInstances = IgnoreNew`, hidden window, and points at **this** repository
and at `recovery-launcher.ps1`.

```powershell
.\scripts\automation\install-autonomous-task.ps1 -Status   # inspect
.\scripts\automation\install-autonomous-task.ps1 -Remove    # uninstall
```

The launcher needs no GitHub or Cloudflare credentials: it only starts a local
process that reads local state.

### Inspecting status

```powershell
.\scripts\automation\autonomous-runner.ps1 -Status
```

Shows the current task, attempt, checkpoint, resume mode, durable session,
recovery count, interruption classification and resume plan, plus lock state.

### Recovering the current task after an accidental terminal close

```powershell
.\scripts\automation\recover-task.ps1 -TaskId 4.2A -RecoverInterrupted
```

This verifies the task exists in the roadmap, refuses if a controller is
running, preserves the working tree, clears only the interrupted-run markers
(status, `failedTaskIds`, `lastResult`), keeps the task id, attempt, durable
session id and log path, records an audit entry under `.automation/logs/recovery/`,
and never marks the task complete. Then start the controller normally.

### Stopping the worker intentionally

```powershell
Stop-ScheduledTask -TaskName 'QueryVanta-Autonomous-Runner'
.\scripts\automation\autonomous-runner.ps1 -ResetLock    # only if a run was killed
```

To stop the roadmap from advancing further, remove the scheduled task with
`-Remove`. The controller can still be run manually at any time.

### Completion prevents future restarts

When the last task completes, state becomes `status = "complete"` with every task
in `completedTaskIds`. Every later startup, scheduled or manual, exits
immediately with "roadmap is complete" and performs no work. A finished project
is never restarted.

## 9. Git policy

`AUTO_COMMIT` and `AUTO_PUSH` are per-task fields in `roadmap.json`, and both
are `false` for all 14 current tasks. The controller does not commit or push.
`gitPolicy.autoCommit` and `gitPolicy.autoPush` in `config.json` are the
defaults a task inherits. The runner refuses to push for any task that does not
explicitly permit it, and existing commits are never altered.

---

## 10. Single instance and lock

`.automation/.runner.lock` is created with exclusive file creation, so two
runners starting at the same instant cannot both win. It records the pid,
machine, user, acquisition time and session id.

A second runner that finds a live lock exits with a clear message rather than
touching the repository.

Stale locks are recovered safely. A lock is stale when the recorded pid is not
running on this machine, when the file is unreadable, or when it was created on
another machine and is older than `lock.maxAgeHours` (12). A live lock is never
removed by `-ResetLock`.

---

## 11. Running it

Safe, non-executing commands:

```powershell
# What is the controller doing right now?
.\scripts\automation\autonomous-runner.ps1 -Status

# What would it do next, without doing anything?
.\scripts\automation\autonomous-runner.ps1 -DryRun

# Prove the controller itself works, offline, without invoking OpenCode
.\scripts\automation\test-controller.ps1

# Clear a stale lock after a hard kill
.\scripts\automation\autonomous-runner.ps1 -ResetLock
```

Actually running the roadmap:

```powershell
# Run the whole roadmap from persisted state
.\scripts\automation\autonomous-runner.ps1

# Run one task, then stop
.\scripts\automation\autonomous-runner.ps1 -TaskId 4.2A

# Run at most two tasks in this invocation
.\scripts\automation\autonomous-runner.ps1 -MaxTasks 2
```

---

## 12. Startup at logon

The Scheduled Task helper is **not installed automatically**. It must be
invoked explicitly:

```powershell
.\scripts\automation\install-autonomous-task.ps1            # shows usage only
.\scripts\automation\install-autonomous-task.ps1 -Install   # creates it
.\scripts\automation\install-autonomous-task.ps1 -Status    # inspect
.\scripts\automation\install-autonomous-task.ps1 -Remove    # uninstall
```

The registered task runs `powershell.exe -NoProfile -NonInteractive` against
the runner, with the repository path passed explicitly, triggered at logon of
the current user, limited to one instance, and allowed to run for up to 12 hours.
It does not require VS Code, a console, or an interactive shell.

---

## 13. Stopping safely

```powershell
# Stop the scheduled task if it is running
Stop-ScheduledTask -TaskName 'QueryVanta-Autonomous-Runner'

# If a run was killed hard, clear the lock it left behind
.\scripts\automation\autonomous-runner.ps1 -ResetLock
```

`Exit-RunnerLock` runs in a `finally` block, so a normal exit, a caught error
and `Ctrl+C` all release the lock. Only a hard kill leaves one, and that is what
`-ResetLock` and the stale-lock reclaim are for.

---

## 14. Logs and evidence

| Location | Contents |
|----------|----------|
| `.automation/logs/runner-<date>.log` | controller decisions, one line per event |
| `.automation/logs/opencode-<task>-<label>-<ts>.log` | complete raw agent stdout+stderr |
| `.automation/logs/transcript-<task>-<label>-<ts>.txt` | extracted agent text |
| `.automation/logs/prompt-<task>-<ts>.txt` | the exact prompt sent |
| `.automation/logs/verify-<task>-<ts>.log` | every gate, exit code and output |
| `.automation/failures/<task>-<ts>/` | full evidence bundle for a failure |

Logs and failures are gitignored. They can contain transcripts and repository
state, which are evidence for debugging rather than source.

---

## 15. What is blocked by default

Refused before a task starts, if found in its task file:

- any deployment or publish command
- any remote D1 execution
- any secret create, rotate or delete
- any push
- any destructive git: `reset --hard`, `clean -fd`, `clean -fdx`, `checkout -- .`, force push

Detected in agent **output**, the run is halted and recorded as `BLOCKED`, with
narration that explicitly quotes a forbidden command in order to say it was not
run being filtered out so that honest explanation is not punished.

Also structurally prevented:

- two runners modifying the repository at once
- a task id that is not in `roadmap.json`
- a task file that has gone missing
- a branch that differs from `config.repository.expectedBranch`
- a non-zero verification exit code being read as success
- a missing agent status marker being read as success