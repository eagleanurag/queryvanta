<#
.SYNOPSIS
    Autonomous roadmap controller for QueryVanta.

.DESCRIPTION
    Executes the approved roadmap in .automation/roadmap.json one task at a
    time by invoking a standalone OpenCode agent per task, verifying the result,
    persisting state, and moving on. It is designed to survive terminal closure,
    an OpenCode process failure, a Windows reboot, and an unexpected restart: all
    durable progress lives in .automation/state.json, which is replaced
    atomically.

    Safety posture, all enforced in code rather than by convention:

      * single instance, via an exclusive lock file;
      * a missing agent status marker is treated as FAILURE, never success;
      * a non-zero verification exit code is never treated as success;
      * no commit and no push unless the roadmap task explicitly permits it;
      * no destructive git, ever;
      * production deployment and remote D1 operations are refused, and are
        treated as a BLOCKED run if they appear in agent output;
      * retries are bounded. The controller never loops forever.

.PARAMETER TaskId
    Run only this task id, then stop. Optional.

.PARAMETER DryRun
    Report what would be done and exit without invoking OpenCode.

.PARAMETER MaxTasks
    Stop after this many tasks in this invocation. Default 0 means no limit
    within this run, still bounded by retries per task.

.PARAMETER Status
    Print controller state and exit.

.PARAMETER ResetLock
    Remove a stale lock file after confirming no live process owns it.

.EXAMPLE
    .\scripts\automation\autonomous-runner.ps1 -DryRun

.EXAMPLE
    .\scripts\automation\autonomous-runner.ps1 -TaskId 4.2A
#>

[CmdletBinding()]
param(
    [string]$TaskId = '',
    [switch]$DryRun,
    [int]$MaxTasks = 0,
    [switch]$Status,
    [switch]$ResetLock
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths
$config = Get-Config

# ---------------------------------------------------------------------------
# Agent contract
# ---------------------------------------------------------------------------

function New-AgentPrompt {
    param($Task, $State, $Attempt)

    $taskFile = Get-TaskFilePath -Task $Task
    if (-not (Test-Path $taskFile)) {
        throw "Task file not found for $($Task.Id): $taskFile"
    }

    $verificationText = ''
    foreach ($v in $Task.Verification) {
        $verificationText += "  - $($v.name): $($v.command)`n"
    }

    $autoCommit = if ($Task.AutoCommit) { 'true' } else { 'false' }
    $autoPush = if ($Task.AutoPush) { 'true' } else { 'false' }

    return @"
AUTONOMOUS ROADMAP TASK
=======================

You are implementing exactly one approved roadmap task in the QueryVanta
repository. This is an autonomous run: nobody is watching the transcript, so
every decision must be justified from the repository itself.

TASK
----
Task id    : $($Task.Id)
Title      : $($Task.Title)
Phase      : $($Task.PhaseId) - $($Task.PhaseTitle)
Task file  : $taskFile
Attempt    : $Attempt of $($config.execution.maxAttemptsPerTask)

AUTHORITATIVE INPUTS, IN THIS ORDER
------------------------------------
1. The task file above. It defines objective, scope, non-goals, requirements,
   tests, gates, completion criteria and stop conditions.
2. $("$($paths.RepoRoot)\$($config.paths.approvedAudit)")
   Audit sections relevant to this task: $($Task.AuditSections -join '; ')
3. The actual repository code. When the task file and the code disagree, trust
   the code and say so in your summary.

MANDATORY FIRST STEP
--------------------
Inspect the current repository state before changing anything:
  git status --short
  git log --oneline -3
Then read the task file in full.

RULES - THESE ARE NOT OPTIONAL
------------------------------
1. Stay strictly inside the scope of the task file. Do not widen it.
2. Do not modify unrelated features, files, refactors, or behaviour.
3. Do not deploy anything. Never run `wrangler deploy` or any remote D1
   command, in any form, for any reason.
4. Do not modify or rotate secrets, the GitHub OAuth app, Cloudflare
   configuration, or the D1 schema, unless the task file explicitly says so.
5. Do not run `git reset --hard`, `git clean -fd`, or any equivalent
   destructive cleanup, under any circumstances.
6. Do not commit and do not push. This task's policy is
   AUTO_COMMIT: $autoCommit and AUTO_PUSH: $autoPush. Leave the working tree
   for review.
7. Run the required tests and quality gates listed below. Do not claim a test
   passed unless you actually ran it and observed it pass.
8. If the task file's scope or the audit contradicts itself, or the change
   turns out to be larger than the task anticipates, stop and report BLOCKED
   rather than improvising.

REQUIRED QUALITY GATES FOR THIS TASK
------------------------------------
$verificationText

COMPLETION CRITERIA
-------------------
Satisfy every item under "Completion criteria" in the task file. If any cannot
be satisfied, report BLOCKED with the reason. Do not report PASS on partial
work.

OUTPUT CONTRACT
---------------
Your final message MUST end with exactly these two lines, on their own lines,
with no other text after them except a concise summary:

AUTONOMOUS_TASK_STATUS: PASS
or
AUTONOMOUS_TASK_STATUS: FAIL
or
AUTONOMOUS_TASK_STATUS: BLOCKED

AUTONOMOUS_TASK_ID: $($Task.Id)

Then a concise summary: what you changed, which files, which gates you ran and
their real results, and anything you deliberately left undone.
"@
}

function New-ResumePrompt {
    <#
        Brief used when the previous durable OpenCode session CAN be continued.

        The session carries the agent's own prior context, so this prompt does
        not pretend to restate it. It re-asserts the contract, points at the
        durable evidence, and states plainly that the run was interrupted and the
        existing partial changes must be adopted rather than restarted.
    #>
    param($Task, $State, [Parameter(Mandatory = $true)][string]$Attempt)

    $paths = Get-AutomationPaths
    $config = Get-Config
    $taskFile = Get-TaskFilePath -Task $Task

    $durable = Get-StateProperty -State $State -Name 'durableOpenCodeSessionId' -Default (Get-StateProperty -State $State -Name 'lastOpenCodeSessionId')
    $previousLog = Get-StateProperty -State $State -Name 'lastLogFile'
    $checkpoint = Get-StateProperty -State $State -Name 'taskCheckpoint'
    $logExists = if ($previousLog -and (Test-Path $previousLog)) { 'yes' } else { 'no' }
    $tree = @(Get-WorkingTreeSummary)
    $treeText = if ($tree.Count -eq 0) { '(clean)' } else { ($tree -join [Environment]::NewLine) }

    return @"
AUTONOMOUS RESUMED RUN (same OpenCode session)
===============================================

You are being re-entered into your OWN previous session for roadmap task
$($Task.Id). A controller process was interrupted, most likely because the
terminal was closed or the machine lost power. You are not starting over.

WHAT IS KNOWN
-------------
Task id         : $($Task.Id)
Title           : $($Task.Title)
Task file       : $taskFile
Attempt         : $Attempt
Approved input  : $($paths.RepoRoot)\$($config.paths.approvedAudit)
Audit sections  : $($Task.AuditSections -join '; ')
Last checkpoint : $(if ($checkpoint) { $checkpoint } else { '(none recorded)' })
Previous log    : $(if ($previousLog) { $previousLog } else { '(none)' }) (exists: $logExists)
Branch          : $(Get-CurrentBranch)
HEAD            : $(Get-CurrentHead)

Working tree as it stands now:
$treeText

WHAT TO DO
----------
1. You already have the context of your earlier work in this session. Re-read
   the task file to confirm the remaining scope.
2. The working tree above may contain PARTIAL work you already did, or work
   from an earlier attempt. Inspect it before changing anything.
3. Adopt correct existing work. Do NOT delete it and start over. Do NOT run
   git reset --hard, git clean, or any destructive cleanup.
4. Finish whatever remains, then run the required tests and quality gates.
5. Do not deploy anything, do not run remote Cloudflare or database commands,
   and do not touch secrets, the OAuth app, or the D1 schema.
6. Do not commit and do not push.

OUTPUT CONTRACT
---------------
Your final message MUST end with exactly:

AUTONOMOUS_TASK_STATUS: PASS
or
AUTONOMOUS_TASK_STATUS: FAIL
or
AUTONOMOUS_TASK_STATUS: BLOCKED

AUTONOMOUS_TASK_ID: $($Task.Id)

Then a concise summary of what was already done, what you changed, and the real
gate results.
"@
}

# ---------------------------------------------------------------------------
# Safety pre-flight
# ---------------------------------------------------------------------------

function Assert-SafetyPreflight {
    param($Task)

    $branch = Get-CurrentBranch
    $expected = $config.repository.expectedBranch

    if ($branch -ne $expected) {
        throw "Branch guard: expected '$expected' but the repository is on '$branch'. Refusing to continue."
    }

    Write-AutomationLog "pre-flight: branch=$branch head=$(Get-CurrentHead)"

    # The task id must exist in the roadmap. An id not in the roadmap is a
    # configuration or injection error and is refused outright.
    if ($null -eq (Get-RoadmapTask -Id $Task.Id)) {
        throw "Task guard: task id '$($Task.Id)' is not present in roadmap.json."
    }

    $taskFile = Get-TaskFilePath -Task $Task
    if (-not (Test-Path $taskFile)) {
        throw "Task guard: task file missing: $taskFile"
    }

    $taskText = [System.IO.File]::ReadAllText($taskFile)

    if ($config.safety.scanTaskFile) {
        $hits = @(Test-ForbiddenOperations -Text $taskText -Config $config)
        if ($hits.Count -gt 0) {
            throw "Safety guard: task file '$($Task.File)' references forbidden operations: $($hits -join ', ')"
        }
    }

    # NOTE: the generated prompt is deliberately NOT scanned. The agent
    # contract must name the forbidden commands in order to forbid them, so
    # scanning the prompt would always trip on its own instructions. The task
    # file scan above is the meaningful pre-flight check; agent *output* is
    # scanned separately in Assert-SafetyPostflight, where narration about a
    # command is filtered out.

    return [pscustomobject]@{
        Branch = $branch
        Head   = (Get-CurrentHead)
        Tree   = @(Get-WorkingTreeSummary)
    }
}

function Assert-SafetyPostflight {
    param($Task, $Run)

    $expected = $config.repository.expectedBranch
    $branch = Get-CurrentBranch

    if ($branch -ne $expected) {
        throw "Branch guard after task: expected '$expected' but the repository is on '$branch'."
    }

    if ($config.safety.scanAgentOutput) {
        # The agent may legitimately QUOTE a forbidden command while explaining
        # why it did not run it, so matches on the agent's own narration lines
        # that are clearly negations are excluded. Anything else is a halt.
        $hits = @(Test-ForbiddenOperations -Text $Run.Text -Config $config)
        $real = @()
        foreach ($hit in $hits) {
            $clean = $hit -replace '^destructive:\s*', ''
            $isNegated = $false
            foreach ($line in ($Run.Text -split "`r?`n")) {
                if ($line -like "*$clean*" -and $line -match '(?i)\b(never|not run|did not|do not|avoid|forbidden|refused|without)\b') {
                    $isNegated = $true
                    break
                }
            }
            if (-not $isNegated) { $real += $hit }
        }

        if ($real.Count -gt 0) {
            throw "Safety guard: agent output references forbidden operations: $($real -join ', ')"
        }
    }
}

# ---------------------------------------------------------------------------
# Failure capture
# ---------------------------------------------------------------------------

function Save-FailureArtifacts {
    param($Task, $Run, $Verification)

    if (-not (Test-Path $paths.Failures)) { New-Item -ItemType Directory -Path $paths.Failures -Force | Out-Null }
    $tag = Get-TimestampTag
    $dir = Join-Path $paths.Failures ("{0}-{1}" -f $Task.Id, $tag)
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    if ($Run -and (Test-Path $Run.LogPath)) {
        Copy-Item -Path $Run.LogPath -Destination (Join-Path $dir 'opencode.log') -Force -ErrorAction SilentlyContinue
    }
    if ($Run -and (Test-Path $Run.TranscriptPath)) {
        Copy-Item -Path $Run.TranscriptPath -Destination (Join-Path $dir 'transcript.txt') -Force -ErrorAction SilentlyContinue
    }
    if ($Verification -and $Verification.ReportPath -and (Test-Path $Verification.ReportPath)) {
        Copy-Item -Path $Verification.ReportPath -Destination (Join-Path $dir 'verification.log') -Force -ErrorAction SilentlyContinue
    }

    $summary = [pscustomobject]@{
        taskId     = $Task.Id
        attempt    = $Run.Attempt
        at         = (Get-IsoTimestamp)
        agentStatus = $Run.Status
        markerFound = $Run.MarkerFound
        exitCode   = $Run.ExitCode
        sessionId  = $Run.SessionId
        verificationPassed = $(if ($Verification) { $Verification.Passed } else { $false })
        verification = $(if ($Verification) { $Verification.Results } else { @() })
        branch     = (Get-CurrentBranch)
        head       = (Get-CurrentHead)
        workingTree = @(Get-WorkingTreeSummary)
    }

    Write-JsonFileAtomic -Path (Join-Path $dir 'summary.json') -Value $summary -Depth 12

    return $dir
}

function Get-FailureDigest {
    param($Task, $Run, $Verification)

    $parts = New-Object System.Collections.ArrayList

    [void]$parts.Add("TASK: $($Task.Id) - $($Task.Title)")
    [void]$parts.Add("AGENT STATUS: $($Run.Status) (marker found: $($Run.MarkerFound))")
    [void]$parts.Add("OPENCODE EXIT CODE: $($Run.ExitCode)")
    [void]$parts.Add("AGENT TRANSCRIPT:`n$($Run.Text)")

    if ($Verification) {
        [void]$parts.Add("VERIFICATION REPORT: $($Verification.ReportPath)")
        foreach ($r in $Verification.Results) {
            [void]$parts.Add("  $($r.Name): exit=$($r.ExitCode) command=$($r.Command)")
        }
    }

    return ($parts -join [Environment]::NewLine)
}

# ---------------------------------------------------------------------------
# Main control loop
# ---------------------------------------------------------------------------

function Invoke-Task {
    param($Task, $State, $Interrupted = $null)

    $maxAttempts = [int]$config.execution.maxAttemptsPerTask
    $recoveryUses = 0
    $lastRun = $null
    $lastVerification = $null

    # An interrupted run keeps its own attempt number instead of restarting the
    # attempt budget, so a task that keeps getting killed by a reboot cannot
    # spin forever.
    $startAttempt = 1
    if ($null -ne $Interrupted -and $Interrupted.IsInterrupted) {
        $startAttempt = [Math]::Max(1, [int]$Interrupted.Attempt)
        Write-AutomationLog "resuming interrupted task $($Task.Id) at attempt $startAttempt (reason: $($Interrupted.Reason))"
    }

    for ($attempt = $startAttempt; $attempt -le $maxAttempts; $attempt++) {

        $State.currentTaskId = $Task.Id
        $State.currentAttempt = $attempt
        $State.status = 'running'
        $State.lastStartedAt = (Get-IsoTimestamp)
        Add-AutomationProperty -Object $State -Name 'lastLogFile' -Value $null
        Set-StateProperty -Object $State -Name 'interruptionReason' -Value $null
        Save-Checkpoint -State $State -Name 'selected' | Out-Null

        Write-AutomationLog "=== task $($Task.Id) attempt $attempt/$maxAttempts ==="

        # --- pre-flight -----------------------------------------------------
        try {
            $pre = Assert-SafetyPreflight -Task $Task
            Write-AutomationLog "pre-flight OK: head=$($pre.Head) treeEntries=$($pre.Tree.Count)"
            Save-Checkpoint -State $State -Name 'preflight_complete' | Out-Null
        }
        catch {
            $State.status = 'blocked'
            $State.lastError = $_.Exception.Message
            $State.lastFinishedAt = (Get-IsoTimestamp)
            Save-State -State $State
            Write-AutomationLog "pre-flight blocked: $($_.Exception.Message)" 'ERROR'
            return [pscustomobject]@{ Status = 'BLOCKED'; Verification = $null; Run = $null }
        }

        # --- decide how to start the agent ----------------------------------
        # session-resume  -> continue the durable OpenCode session
        # recovery-prompt -> fresh session, explicit interrupted-run brief
        # fresh           -> ordinary new session
        $resumePlan = Get-ResumePlan -Interrupted $Interrupted
        $resumeSessionId = ''
        $prompt = $null

        if ($resumePlan -eq 'session-resume') {
            $resumeSessionId = [string]$Interrupted.SessionId
            $prompt = New-ResumePrompt -Task $Task -State $State -Attempt $attempt
            Write-AutomationLog "resume mode: session-resume ($resumeSessionId)"
        }
        elseif ($resumePlan -eq 'recovery-prompt') {
            $prompt = New-RecoveryPrompt -Task $Task -Interrupted $Interrupted -Attempt $attempt
            Write-AutomationLog 'resume mode: recovery-prompt (fresh session, explicit interrupted-run brief)'
        }
        else {
            $prompt = New-AgentPrompt -Task $Task -State $State -Attempt $attempt
            Write-AutomationLog 'resume mode: fresh'
        }

        Set-StateProperty -Object $State -Name 'resumeMode' -Value $resumePlan
        Save-State -State $State

        # --- invoke ---------------------------------------------------------
        $promptFile = Join-Path $paths.Logs ("prompt-{0}-{1}.txt" -f $Task.Id, (Get-TimestampTag))

        $State.status = 'running'
        Save-Checkpoint -State $State -Name 'opencode_started' | Out-Null

        $run = $null
        try {
            $run = & (Join-Path $PSScriptRoot 'invoke-opencode.ps1') `
                -TaskId $Task.Id `
                -Prompt $prompt `
                -PromptFile $promptFile `
                -Label 'task' `
                -ResumeSessionId $resumeSessionId
        }
        catch {
            # A launcher failure (OpenCode missing, prompt rejected) is a
            # failure of this attempt, not a controller crash. The fallback
            # object carries no Attempt property; Set-RunAttempt adds it once.
            Write-AutomationLog "opencode invocation threw: $($_.Exception.Message)" 'ERROR'
            $run = New-InvokerFailureResult -TaskId $Task.Id -Label 'task' -ErrorMessage $_.Exception.Message
        }

        # Exactly one Attempt property, whichever path produced the result.
        $run = Set-RunAttempt -Run $run -Attempt $attempt

        $State.lastExitCode = $run.ExitCode
        $State.lastOpenCodeSessionId = $run.SessionId

        # The durable session id is written as soon as it is known, so a power
        # loss between here and the end of the attempt still leaves a session
        # that the next boot can try to continue.
        if ($run.SessionId) {
            Set-StateProperty -Object $State -Name 'durableOpenCodeSessionId' -Value $run.SessionId
        }
        Add-AutomationProperty -Object $State -Name 'lastLogFile' -Value $run.LogPath
        Save-Checkpoint -State $State -Name 'opencode_finished' | Out-Null

        # --- session-resume fallback ----------------------------------------
        # If we asked to continue a session and it did not attach, do not treat
        # that as a task failure. Retry this same attempt with a FRESH session
        # and an explicit recovery brief. The task is never skipped.
        $resumeFailed = [bool](Get-StateProperty -State $run -Name 'ResumeFailed' -Default $false)
        if ($resumeFailed) {
            Write-AutomationLog 'session continuation did not attach; retrying this attempt with a fresh session and a recovery brief' 'WARN'
            $interruptedFallback = [pscustomobject]@{
                IsInterrupted  = $true
                Reason         = 'session-resume-failed'
                TaskId         = $Task.Id
                Attempt        = $attempt
                SessionId      = $null
                LogFile        = $run.LogPath
                Checkpoint     = 'opencode_finished'
                GenuineBlocked = $false
            }
            Set-StateProperty -Object $State -Name 'interruptedAt' -Value (Get-IsoTimestamp)
            Set-StateProperty -Object $State -Name 'interruptionReason' -Value 'session-resume-failed'
            Set-StateProperty -Object $State -Name 'durableOpenCodeSessionId' -Value $null
            $Interrupted = $interruptedFallback
            Save-State -State $State

            $fallbackPrompt = New-RecoveryPrompt -Task $Task -Interrupted $interruptedFallback -Attempt $attempt
            $fallbackFile = Join-Path $paths.Logs ("prompt-{0}-{1}-recovery.txt" -f $Task.Id, (Get-TimestampTag))
            Set-StateProperty -Object $State -Name 'resumeMode' -Value 'recovery-prompt'
            Save-State -State $State

            try {
                $run = & (Join-Path $PSScriptRoot 'invoke-opencode.ps1') `
                    -TaskId $Task.Id `
                    -Prompt $fallbackPrompt `
                    -PromptFile $fallbackFile `
                    -Label 'task' `
                    -ResumeSessionId ''
            }
            catch {
                Write-AutomationLog "fallback invocation threw: $($_.Exception.Message)" 'ERROR'
                $run = New-InvokerFailureResult -TaskId $Task.Id -Label 'task' -ErrorMessage $_.Exception.Message
            }
            $run = Set-RunAttempt -Run $run -Attempt $attempt
            $State.lastExitCode = $run.ExitCode
            $State.lastOpenCodeSessionId = $run.SessionId
            if ($run.SessionId) {
                Set-StateProperty -Object $State -Name 'durableOpenCodeSessionId' -Value $run.SessionId
            }
            Add-AutomationProperty -Object $State -Name 'lastLogFile' -Value $run.LogPath
            Save-Checkpoint -State $State -Name 'opencode_finished' | Out-Null
        }

        Save-Checkpoint -State $State -Name 'result_parsed' | Out-Null

        # --- post-flight: forbidden operations in agent output ---------------
        $halted = $null
        try {
            Assert-SafetyPostflight -Task $Task -Run $run
        }
        catch {
            $halted = $_.Exception.Message
        }

        if ($halted) {
            Write-AutomationLog "post-flight guard tripped: $halted" 'ERROR'
            $lastRun = $run
            Save-FailureArtifacts -Task $Task -Run $run -Verification $null | Out-Null
            $State.status = 'blocked'
            $State.lastError = $halted
            $State.lastFinishedAt = (Get-IsoTimestamp)
            Save-State -State $State
            return [pscustomobject]@{ Status = 'BLOCKED'; Verification = $null; Run = $run }
        }

        # --- verification ----------------------------------------------------
        $verification = $null
        if ($run.Status -eq 'PASS') {
            $State.status = 'verifying'
            Save-Checkpoint -State $State -Name 'verification_started' | Out-Null
            $verification = & (Join-Path $PSScriptRoot 'verify-task.ps1') -TaskId $Task.Id
            if ($verification.Passed) {
                Save-Checkpoint -State $State -Name 'verification_passed' | Out-Null
            }
        }
        else {
            Write-AutomationLog 'agent did not report PASS; skipping verification and treating as a failed attempt' 'WARN'
        }
        $lastVerification = $verification

        $effective = $run.Status
        if ($effective -eq 'PASS' -and $verification -and -not $verification.Passed) {
            # The agent claimed success but the gates disagree. Gates win.
            $effective = 'FAIL'
            Write-AutomationLog 'agent reported PASS but verification failed; effective status is FAIL' 'ERROR'
        }

        Add-AutomationProperty -Object $State -Name 'lastVerification' -Value $(
            if ($verification) {
                $verification.Results | ForEach-Object {
                    [pscustomobject]@{ name = $_.Name; command = $_.Command; exitCode = $_.ExitCode; skipped = $_.Skipped; timestamp = $_.Timestamp }
                }
            } else { @() }
        )
        $State.lastResult = $effective
        Save-State -State $State

        if ($effective -eq 'PASS') {
            Write-AutomationLog "task $($Task.Id) PASSED on attempt $attempt" 'INFO'
            $lastRun = $run
            return [pscustomobject]@{ Status = 'PASS'; Verification = $verification; Run = $run }
        }

        if ($effective -eq 'BLOCKED') {
            Write-AutomationLog "task $($Task.Id) reported BLOCKED; controller stops" 'ERROR'
            $lastRun = $run
            Save-FailureArtifacts -Task $Task -Run $run -Verification $verification | Out-Null
            return [pscustomobject]@{ Status = 'BLOCKED'; Verification = $verification; Run = $run }
        }

        # --- bounded recovery ------------------------------------------------
        $lastRun = $run
        $failureDir = Save-FailureArtifacts -Task $Task -Run $run -Verification $verification
        Write-AutomationLog "failure artifacts saved to $failureDir" 'WARN'

        if ($recoveryUses -lt [int]$config.execution.recoveryInvocationsPerFailure) {
            $recoveryUses++
            $State.retryCount = [int]$State.retryCount + 1
            $State.status = 'recovering'
            $State.lastError = "attempt $attempt failed"
            Save-State -State $State

            $digest = Get-FailureDigest -Task $Task -Run $run -Verification $verification
            $recovery = $null
            try {
                $recovery = & (Join-Path $PSScriptRoot 'recover-task.ps1') `
                    -TaskId $Task.Id `
                    -FailureText $digest `
                    -Attempt $attempt
            }
            catch {
                Write-AutomationLog "recovery invocation threw: $($_.Exception.Message)" 'ERROR'
                $recovery = $null
            }

            if ($null -ne $recovery) {
                Write-AutomationLog "recovery reported $($recovery.Status) (exit $($recovery.ExitCode))"
                $State.lastOpenCodeSessionId = $recovery.SessionId
                Save-State -State $State

                if ($recovery.Status -eq 'BLOCKED') {
                    Save-FailureArtifacts -Task $Task -Run $recovery -Verification $null | Out-Null
                    return [pscustomobject]@{ Status = 'BLOCKED'; Verification = $null; Run = $recovery }
                }
            }
            else {
                Write-AutomationLog 'recovery produced no result; retrying the task' 'WARN'
            }

            # Loop to the next attempt, which re-runs the task and re-verifies.
            continue
        }

        Write-AutomationLog "task $($Task.Id) failed and recovery budget is exhausted" 'ERROR'
        return [pscustomobject]@{ Status = 'FAIL'; Verification = $verification; Run = $run }
    }

    return [pscustomobject]@{ Status = 'FAIL'; Verification = $lastVerification; Run = $lastRun }
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

$exitCode = 0

# -Status is read-only and does not take the lock.
if ($Status) {
    $s = Read-State
    $lock = Get-LockState
    Write-Host ''
    Write-Host '=== QueryVanta autonomous controller status ==='
    Write-Host "  repository      : $($paths.RepoRoot)"
    Write-Host "  branch          : $(Get-CurrentBranch)   HEAD: $(Get-CurrentHead)"
    Write-Host "  status          : $($s.status)"
    Write-Host "  currentTaskId   : $($s.currentTaskId)  (attempt $($s.currentAttempt))"
    Write-Host "  completed       : $(@($s.completedTaskIds).Count) / $((Get-RoadmapTasks).Count)"
    if (@($s.completedTaskIds).Count -gt 0) { Write-Host "                    $($s.completedTaskIds -join ', ')" }
    Write-Host "  failed          : $(if (@($s.failedTaskIds).Count -gt 0) { $s.failedTaskIds -join ', ' } else { '(none)' })"
    Write-Host "  retryCount      : $($s.retryCount)"
    Write-Host "  lastResult      : $($s.lastResult)"
    Write-Host "  lastExitCode    : $($s.lastExitCode)"
    Write-Host "  lastSessionId   : $($s.lastOpenCodeSessionId)"
    Write-Host "  lastError       : $($s.lastError)"
    Write-Host '  -- power-loss resilience --'
    Write-Host "  controllerRunId : $(Get-StateProperty -State $s -Name 'controllerRunId')"
    Write-Host "  lastCheckpoint  : $(Get-StateProperty -State $s -Name 'taskCheckpoint') at $(Get-StateProperty -State $s -Name 'taskCheckpointAt')"
    Write-Host "  resumeMode      : $(Get-StateProperty -State $s -Name 'resumeMode')"
    Write-Host "  durableSession  : $(Get-StateProperty -State $s -Name 'durableOpenCodeSessionId')"
    Write-Host "  recoveryCount   : $(Get-StateProperty -State $s -Name 'recoveryCount' -Default 0)"
    Write-Host "  interruptedAt   : $(Get-StateProperty -State $s -Name 'interruptedAt')"
    Write-Host "  interruptionWhy : $(Get-StateProperty -State $s -Name 'interruptionReason')"
    $intrStatus = Get-InterruptedRun -State $s -MaxAgeHours $config.lock.maxAgeHours
    if ($null -ne $intrStatus) {
        Write-Host "  interruption    : detected=$($intrStatus.IsInterrupted) reason=$($intrStatus.Reason) plan=$(Get-ResumePlan -Interrupted $intrStatus) genuineBlocked=$($intrStatus.GenuineBlocked)"
    }
    else {
        Write-Host '  interruption    : none detected'
    }
    Write-Host "  lock            : $(if ($null -eq $lock) { 'absent' } else { "pid=$($lock.pid) machine=$($lock.machine) at=$($lock.acquiredAt) stale=$(Test-LockStale -Lock $lock -MaxAgeHours $config.lock.maxAgeHours)" })"
    $next = Select-NextTask -State $s
    Write-Host "  next task       : $(if ($next) { $next.Id } else { '(roadmap complete)' })"
    exit 0
}

# -ResetLock reclaims a stale lock without running anything.
if ($ResetLock) {
    $lock = Get-LockState
    if ($null -eq $lock) {
        Write-Host 'No lock file present.'
        exit 0
    }
    if (Test-LockStale -Lock $lock -MaxAgeHours $config.lock.maxAgeHours) {
        Remove-Item -Path $paths.Lock -Force
        Write-Host "Removed stale lock (pid=$($lock.pid), machine=$($lock.machine))."
        exit 0
    }
    Write-Host "Lock is NOT stale: pid=$($lock.pid) is still running. Refusing to remove it."
    exit 1
}

Write-Host ''
Write-Host 'QueryVanta autonomous roadmap controller'
Write-Host "  repository : $($paths.RepoRoot)"
Write-Host "  branch     : $(Get-CurrentBranch)   HEAD: $(Get-CurrentHead)"
Write-Host ''

# --- single instance --------------------------------------------------------
$maxAge = [int]$config.lock.maxAgeHours
$existing = Get-LockState
if ($null -ne $existing) {
    if (Test-LockStale -Lock $existing -MaxAgeHours $maxAge) {
        Write-Host "Found a stale lock (pid=$($existing.pid), machine=$($existing.machine)); reclaiming."
    }
    else {
        Write-Host "Another runner already holds the lock (pid=$($existing.pid), machine=$($existing.machine), since $($existing.acquiredAt))."
        Write-Host 'Refusing to start a second instance.'
        exit 1
    }
}

if (-not (Enter-RunnerLock -MaxAgeHours $maxAge)) {
    Write-Host 'Failed to acquire the runner lock. Another instance is probably running.'
    exit 1
}

try {
    $State = Read-State

    # Record the baseline once, so an unexpected HEAD change is detectable.
    if (-not $State.baselineHead) {
        $State.baselineHead = (Get-CurrentHead)
        Add-AutomationProperty -Object $State -Name 'branch' -Value (Get-CurrentBranch)
        Save-State -State $State
    }

    # A fresh run id makes each controller invocation identifiable in logs and
    # state, so an interrupted run can be attributed after the fact.
    $runId = '{0}-{1}' -f (Get-TimestampTag), $PID
    Set-StateProperty -Object $State -Name 'controllerRunId' -Value $runId
    Save-State -State $State
    Write-AutomationLog "controller run id = $runId"

    $all = @(Get-RoadmapTasks)
    Write-Host "Roadmap: $($all.Count) tasks; completed: $(@($State.completedTaskIds).Count)"
    Write-Host ''

    # Rule A: a fully completed roadmap must exit immediately and must never be
    # restarted, so a scheduled task left in place becomes a no-op.
    if ((@(Get-StateProperty -State $State -Name 'completedTaskIds' -Default @())).Count -ge $all.Count -and -not $TaskId) {
        Write-Host 'Roadmap is already complete. Nothing to do; exiting cleanly.'
        $State.status = 'complete'
        $State.currentTaskId = $null
        Set-StateProperty -Object $State -Name 'lastError' -Value $null
        $State.lastFinishedAt = (Get-IsoTimestamp)
        Save-Checkpoint -State $State -Name 'controller_stopped' | Out-Null
        break
    }

    # Detect a run that was cut short by a closed terminal, a reboot or a
    # power loss. The interrupted task is resumed; it is never skipped.
    $Interrupted = Get-InterruptedRun -State $State -MaxAgeHours $maxAge
    if ($null -ne $Interrupted) {
        if ($Interrupted.GenuineBlocked) {
            Write-Host ''
            Write-Host "Task '$($Interrupted.TaskId)' holds a genuine AUTONOMOUS_TASK_STATUS: BLOCKED result."
            Write-Host 'A genuine BLOCKED is never retried automatically. Resolve it by hand, then re-run.'
            Write-AutomationLog "genuine BLOCKED preserved for $($Interrupted.TaskId); not retrying" 'WARN'
        }
        else {
            Write-Host ''
            Write-Host "Detected an INTERRUPTED run of task '$($Interrupted.TaskId)' (reason: $($Interrupted.Reason))."
            Write-Host "  attempt        : $($Interrupted.Attempt)"
            Write-Host "  last checkpoint: $(if ($Interrupted.Checkpoint) { $Interrupted.Checkpoint } else { '(none)' })"
            Write-Host "  durable session: $(if ($Interrupted.SessionId) { $Interrupted.SessionId } else { '(none)' })"
            Write-Host "  resume plan    : $(Get-ResumePlan -Interrupted $Interrupted)"
            Write-Host "  working tree   : $(@(Get-WorkingTreeSummary).Count) entr(ies) preserved; nothing will be reset"
            Write-AutomationLog "interrupted run detected for $($Interrupted.TaskId); resume plan = $(Get-ResumePlan -Interrupted $Interrupted)"

            Set-StateProperty -Object $State -Name 'interruptedAt' -Value (Get-IsoTimestamp)
            Set-StateProperty -Object $State -Name 'interruptionReason' -Value $Interrupted.Reason
            $recoveryCount = [int](Get-StateProperty -State $State -Name 'recoveryCount' -Default 0) + 1
            Set-StateProperty -Object $State -Name 'recoveryCount' -Value $recoveryCount
            Set-StateProperty -Object $State -Name 'lastError' -Value $null
            Set-StateProperty -Object $State -Name 'lastResult' -Value $null
            $State.status = 'interrupted'
            Save-State -State $State
        }
    }

    $processed = 0

    while ($true) {

        if ($MaxTasks -gt 0 -and $processed -ge $MaxTasks) {
            Write-Host "Reached the per-invocation task limit ($MaxTasks). Stopping cleanly."
            break
        }

        $task = $null
        if ($TaskId) {
            $task = Get-RoadmapTask -Id $TaskId
            if ($null -eq $task) {
                Write-Host "Task '$TaskId' is not in roadmap.json. Nothing to do."
                $State.status = 'blocked'
                $State.lastError = "unknown task id '$TaskId'"
                Save-State -State $State
                $exitCode = 1
                break
            }
            if (@($State.completedTaskIds) -contains $task.Id) {
                Write-Host "Task '$TaskId' is already completed. Nothing to do."
                break
            }
        }
        else {
            # An interrupted task keeps its place at the head of the queue. It is
            # never skipped just because the previous process disappeared.
            if ($null -ne $Interrupted -and $Interrupted.IsInterrupted -and $Interrupted.TaskId -and -not $TaskId) {
                $task = Get-RoadmapTask -Id $Interrupted.TaskId
                if ($null -ne $task) {
                    Write-Host "Resuming the interrupted task $($task.Id); not skipping ahead."
                }
            }

            if ($null -eq $task) {
                $task = Select-NextTask -State $State
            }

            if ($null -eq $task) {
                Write-Host 'Roadmap complete. Nothing left to do.'
                $State.status = 'complete'
                $State.currentTaskId = $null
                Set-StateProperty -Object $State -Name 'lastError' -Value $null
                $State.lastFinishedAt = (Get-IsoTimestamp)
                Save-Checkpoint -State $State -Name 'controller_stopped' | Out-Null
                break
            }
        }

        Write-Host "Selected task: $($task.Id) - $($task.Title)"

        if ($DryRun) {
            Write-Host ''
            Write-Host 'DRY RUN. Nothing will be executed. Planned actions:'
            Write-Host "  prompt file   : $(Get-TaskFilePath -Task $task)"
            Write-Host "  opencode cmd  : $($config.opencode.command) run --standalone --format $($config.opencode.format) --auto"
            Write-Host "  verification  :"
            foreach ($v in $task.Verification) { Write-Host "      $($v.name): $($v.command)" }
            Write-Host "  autoCommit    : $($task.AutoCommit)"
            Write-Host "  autoPush      : $($task.AutoPush)"
            Write-Host ''
            break
        }

        $result = Invoke-Task -Task $task -State $State -Interrupted $Interrupted
        $processed++

        # The interruption has been handled by this attempt, so the next
        # iteration selects purely from the roadmap.
        $Interrupted = $null

        if ($result.Status -eq 'PASS') {
            $completed = @()
            if ($State.completedTaskIds) { $completed = @($State.completedTaskIds) }
            if ($completed -notcontains $task.Id) { $completed += $task.Id }
            $State.completedTaskIds = $completed

            $failed = @()
            if ($State.failedTaskIds) { $failed = @($State.failedTaskIds) }
            if ($failed -contains $task.Id) {
                $failed = @($failed | Where-Object { $_ -ne $task.Id })
            }
            $State.failedTaskIds = $failed

            $State.status = 'idle'
            $State.currentTaskId = $null
            $State.currentAttempt = 0
            $State.lastError = $null
            Set-StateProperty -Object $State -Name 'interruptionReason' -Value $null
            Set-StateProperty -Object $State -Name 'resumeMode' -Value $null
            $State.lastFinishedAt = (Get-IsoTimestamp)

            # Only a real PASS plus passing gates reaches this checkpoint.
            Save-Checkpoint -State $State -Name 'task_completed' | Out-Null

            Write-Host ''
            Write-Host "TASK $($task.Id) COMPLETE."
            Write-Host ''

            # Single-task mode is a one-shot request.
            if ($TaskId) { break }
            continue
        }

        # Not a pass.
        $failed = @()
        if ($State.failedTaskIds) { $failed = @($State.failedTaskIds) }
        if ($failed -notcontains $task.Id) { $failed += $task.Id }
        $State.failedTaskIds = $failed

        $State.lastFinishedAt = (Get-IsoTimestamp)

        if ($result.Status -eq 'BLOCKED') {
            $State.status = 'blocked'
            $State.lastError = "task $($task.Id) blocked; controller stopped"
            # lastResult records the genuine agent verdict, which is what
            # distinguishes a real BLOCKED from an interruption artifact on the
            # next start.
            $State.lastResult = 'BLOCKED'
            Save-Checkpoint -State $State -Name 'controller_stopped' | Out-Null
            Write-Host ''
            Write-Host "TASK $($task.Id) BLOCKED. The controller is stopping and will not continue."
            Write-Host 'Inspect .automation/state.json, .automation/failures and .automation/logs, then fix the blocker by hand.'
            $exitCode = 2
            break
        }

        $State.status = 'failed'
        $State.lastError = "task $($task.Id) failed after its attempt budget"
        $State.lastResult = 'FAIL'
        Save-Checkpoint -State $State -Name 'controller_stopped' | Out-Null
        Write-Host ''
        Write-Host "TASK $($task.Id) FAILED after its bounded attempt budget. The controller is stopping."
        Write-Host "This task is now in failedTaskIds and will be skipped until it is resolved by hand."
        $exitCode = 3
        break
    }
}
catch {
    Write-AutomationLog "controller error: $($_.Exception.Message)" 'ERROR'
    Write-Host "Controller error: $($_.Exception.Message)"
    $exitCode = 4
    try {
        $s = Read-State
        $s.status = 'error'
        $s.lastError = $_.Exception.Message
        $s.lastFinishedAt = (Get-IsoTimestamp)
        Save-Checkpoint -State $s -Name 'controller_stopped' | Out-Null
    }
    catch {
        Write-Host "Could not persist error state: $($_.Exception.Message)"
    }
}
finally {
    Exit-RunnerLock
    Write-Host ''
    Write-Host 'Runner lock released.'
}

exit $exitCode
