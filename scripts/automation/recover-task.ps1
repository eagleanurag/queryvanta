<#
.SYNOPSIS
    Single bounded recovery invocation for a failed autonomous task.

.DESCRIPTION
    Called once per failure by the runner. It builds a focused diagnosis prompt
    from the original task plus the captured failure output and the current git
    state, then invokes OpenCode exactly once.

    Deliberately narrow: the recovery agent is told to fix ONLY the observed
    failure and to stay inside the original task scope. It is not given licence
    to broaden the task, deploy, or clean up unrelated work.

    This script never loops. Re-running the task verification after recovery is
    the runner's responsibility.

.PARAMETER TaskId
    Roadmap task id.

.PARAMETER FailureText
    The failure output to diagnose: the agent transcript and/or the failing
    verification report.

.PARAMETER Attempt
    Which attempt failed, for the agent's context.

.OUTPUTS
    PSCustomObject with SessionId, Status, ExitCode, LogPath, TranscriptPath.
#>

[CmdletBinding()]
param(
    [string]$TaskId,
    [AllowEmptyString()][string]$FailureText = '',
    [int]$Attempt = 1,
    # Operator-initiated recovery of a run that was interrupted by a closed
    # terminal, a reboot, or a power loss. This is NOT the automatic
    # per-attempt failure recovery below; it is an explicit repair of the
    # persisted state so the next controller start resumes the task.
    [switch]$RecoverInterrupted
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths
$config = Get-Config

# ---------------------------------------------------------------------------
# Explicit operator recovery of an interrupted run
# ---------------------------------------------------------------------------
if ($RecoverInterrupted) {

    if (-not $TaskId) { throw 'RecoverInterrupted requires -TaskId.' }

    # The task must exist in the approved roadmap. An unknown id is refused
    # rather than invented.
    $task = Get-RoadmapTask -Id $TaskId
    if ($null -eq $task) { throw "Unknown task id '$TaskId'. It is not in roadmap.json." }

    if (-not (Test-Path (Get-TaskFilePath -Task $task))) {
        throw "Task file missing for '$TaskId'."
    }

    # Refuse to run while another controller is live: two writers on one state
    # file is exactly the failure this controller exists to prevent.
    if (Test-ControllerActive -MaxAgeHours $config.lock.maxAgeHours) {
        throw 'A controller is already running. Stop it before recovering, so state is not written twice.'
    }

    $state = Read-State
    $completed = @(Get-StateProperty -State $state -Name 'completedTaskIds' -Default @())

    if ($completed -contains $task.Id) {
        throw "Task '$($task.Id)' is already in completedTaskIds. It will not be re-run."
    }

    $current = Get-StateProperty -State $state -Name 'currentTaskId'
    $lastResult = Get-StateProperty -State $state -Name 'lastResult'
    $interrupted = Get-InterruptedRun -State $state -MaxAgeHours $config.lock.maxAgeHours

    # A genuine agent BLOCKED must stay blocked. Only an interruption artifact
    # is cleared.
    if ($null -ne $interrupted -and $interrupted.GenuineBlocked) {
        throw ("Task '$($task.Id)' carries a genuine AUTONOMOUS_TASK_STATUS: BLOCKED result " +
            '(lastResult=' + $lastResult + '). Genuine BLOCKED is never cleared by this script. ' +
            'Resolve it by hand, or amend the roadmap.')
    }

    $durableSession = Get-StateProperty -State $state -Name 'durableOpenCodeSessionId' -Default (Get-StateProperty -State $state -Name 'lastOpenCodeSessionId')
    $previousLog = Get-StateProperty -State $state -Name 'lastLogFile'
    $attemptNumber = [int](Get-StateProperty -State $state -Name 'currentAttempt' -Default 1)

    Write-Host ''
    Write-Host 'QueryVanta interrupted-run recovery'
    Write-Host "  task            : $($task.Id) - $($task.Title)"
    Write-Host "  persisted task  : $current"
    Write-Host "  status          : $(Get-StateProperty -State $state -Name 'status')"
    Write-Host "  lastResult      : $lastResult"
    Write-Host "  attempt         : $attemptNumber"
    Write-Host "  durable session : $durableSession"
    Write-Host "  previous log    : $previousLog"
    Write-Host "  working tree    : $(@(Get-WorkingTreeSummary).Count) entr(ies) - PRESERVED, not reset"
    Write-Host ''

    if ($current -and $current -ne $task.Id) {
        throw "State says the in-flight task is '$current' but -TaskId is '$($task.Id)'. Refusing to change the roadmap position."
    }

    # Clear ONLY the interrupted-run markers. Task id, attempt, durable session
    # id and log path are preserved so the next start resumes them. The task is
    # never marked complete, and the working tree is never touched.
    $recoveryCount = [int](Get-StateProperty -State $state -Name 'recoveryCount' -Default 0) + 1

    $state.status = 'interrupted'
    $state.currentTaskId = $task.Id
    $state.currentAttempt = $attemptNumber
    Set-StateProperty -Object $state -Name 'durableOpenCodeSessionId' -Value $durableSession
    Set-StateProperty -Object $state -Name 'interruptedAt' -Value (Get-IsoTimestamp)
    Set-StateProperty -Object $state -Name 'interruptionReason' -Value 'operator-recovery-after-interrupted-run'
    Set-StateProperty -Object $state -Name 'recoveryCount' -Value $recoveryCount
    Set-StateProperty -Object $state -Name 'resumeMode' -Value $null
    Set-StateProperty -Object $state -Name 'lastError' -Value $null
    Set-StateProperty -Object $state -Name 'lastResult' -Value $null
    Set-StateProperty -Object $state -Name 'controllerRunId' -Value $null

    # An interrupted run is not a real failure, so drop it from failedTaskIds.
    $failed = @(Get-StateProperty -State $state -Name 'failedTaskIds' -Default @())
    $failed = @($failed | Where-Object { $_ -ne $task.Id })
    $state.failedTaskIds = $failed

    Save-Checkpoint -State $state -Name 'selected' | Out-Null
    Save-State -State $state

    # Auditability: the repair is recorded on disk, never silently applied.
    $recordDir = Join-Path $paths.Logs 'recovery'
    if (-not (Test-Path $recordDir)) { New-Item -ItemType Directory -Path $recordDir -Force | Out-Null }
    $record = [pscustomobject]@{
        at              = (Get-IsoTimestamp)
        taskId          = $task.Id
        action          = 'recover-interrupted'
        recoveryCount   = $recoveryCount
        attempt         = $attemptNumber
        durableSession  = $durableSession
        previousLog     = $previousLog
        head            = (Get-CurrentHead)
        branch          = (Get-CurrentBranch)
        workingTree     = @(Get-WorkingTreeSummary)
        markedComplete  = $false
    }
    Write-JsonFileAtomic -Path (Join-Path $recordDir ("recover-{0}-{1}.json" -f $task.Id, (Get-TimestampTag))) -Value $record -Depth 12

    Write-Host 'Recovery recorded. State is now:'
    Write-Host "  status          : $($state.status)"
    Write-Host "  currentTaskId   : $($state.currentTaskId)"
    Write-Host "  currentAttempt  : $($state.currentAttempt)"
    Write-Host "  recoveryCount   : $recoveryCount"
    Write-Host "  durableSession  : $durableSession"
    Write-Host "  completed       : unchanged ($($completed.Count))"
    Write-Host "  failedTaskIds   : $(if ($failed.Count -eq 0) { '(empty)' } else { $failed -join ', ' })"
    Write-Host ''
    Write-Host 'The task is NOT complete. Start the controller to resume it:'
    Write-Host "  .\scripts\automation\autonomous-runner.ps1 -TaskId $($task.Id)"
    Write-Host ''
    exit 0
}

# ---------------------------------------------------------------------------
# Automatic per-attempt failure recovery (unchanged behaviour)
# ---------------------------------------------------------------------------

if (-not $TaskId) { throw 'TaskId is required.' }
if ($null -eq $FailureText) { $FailureText = '' }

$task = Get-RoadmapTask -Id $TaskId

if ($null -eq $task) { throw "Unknown task id '$TaskId'." }

$head = Get-CurrentHead
$branch = Get-CurrentBranch
$tree = @(Get-WorkingTreeSummary)

$treeText = if ($tree.Count -eq 0) { '(clean)' } else { ($tree -join [Environment]::NewLine) }

# The failure text is truncated so a runaway transcript cannot blow past the
# agent's context window and turn a recoverable failure into an unrecoverable
# one. The full text remains on disk in .automation/failures.
$maxChars = 20000
$truncated = $false
if ($null -ne $FailureText -and $FailureText.Length -gt $maxChars) {
    $FailureText = $FailureText.Substring(0, $maxChars) + "`n... [truncated; full output retained on disk]"
    $truncated = $true
}

$taskFilePath = Get-TaskFilePath -Task $task

$prompt = @"
AUTONOMOUS RECOVERY INVOCATION
=============================

A previous attempt at roadmap task $TaskId failed. Diagnose and fix ONLY that failure.

ORIGINAL TASK
-------------
Task id    : $($task.Id)
Title      : $($task.Title)
Phase      : $($task.PhaseId) - $($task.PhaseTitle)
Task file  : $taskFilePath
Approved input: $($paths.RepoRoot)\$($config.paths.approvedAudit)
Audit sections: $($task.AuditSections -join '; ')
Attempt that failed: $Attempt

Read the task file first. It is the authority on scope. This recovery invocation
does NOT widen the scope of the task.

CURRENT GIT STATE
-----------------
Branch        : $branch
HEAD          : $head
Working tree  :
$treeText

FAILURE OUTPUT
--------------
$FailureText

WHAT TO DO
----------
1. Inspect the current repository state before changing anything.
2. Read the task file for $TaskId and the relevant audit sections.
3. Read the failure output above and identify the single root cause.
4. Fix ONLY that root cause, staying strictly inside the task scope.
5. Do not modify unrelated features, files, or behaviour.
6. Do not deploy anything. Do not run any wrangler deploy or remote D1 command.
7. Do not modify or rotate secrets, Cloudflare configuration, or the D1 schema.
8. Do not run git reset --hard, git clean -fd, or any other destructive cleanup.
9. Do not commit or push.
10. Re-run the task's required tests and quality gates and confirm they pass.
11. Report the root cause and the exact fix.

OUTPUT CONTRACT
---------------
Your final message MUST end with exactly these lines:

AUTONOMOUS_TASK_STATUS: PASS
or
AUTONOMOUS_TASK_STATUS: FAIL
or
AUTONOMOUS_TASK_STATUS: BLOCKED

AUTONOMOUS_TASK_ID: $TaskId

Then a concise summary of the root cause and the fix.
"@

Write-AutomationLog "recovery prompt built for task $TaskId (attempt $Attempt, truncated=$truncated)"

$promptFile = Join-Path $paths.Failures ("recovery-prompt-{0}-{1}.txt" -f $TaskId, (Get-TimestampTag))

$result = & (Join-Path $PSScriptRoot 'invoke-opencode.ps1') `
    -TaskId $TaskId `
    -Prompt $prompt `
    -PromptFile $promptFile `
    -Label 'recovery'

return $result
