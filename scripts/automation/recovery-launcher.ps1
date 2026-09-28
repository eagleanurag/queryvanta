<#
.SYNOPSIS
    Windows recovery launcher for the QueryVanta autonomous controller.

.DESCRIPTION
    This is the process Task Scheduler starts after a logon or a reboot. Its
    only job is to get the controller running again in a sane environment after
    an unplanned stop: a closed terminal, a killed process, a Windows restart,
    or a power loss.

    Responsibilities, in order:

      1. wait for Windows, the network and the Node toolchain to be usable;
      2. refuse to run if another controller already holds the lock;
      3. read .automation/state.json and report what it finds;
      4. exit immediately if the roadmap is already complete, so a task left
         installed can never restart a finished project;
      5. otherwise hand control to autonomous-runner.ps1, which performs the
         real interrupted-run detection and resume.

    It stores no secrets and needs no GitHub or Cloudflare credentials: it only
    starts a local process that reads local state.

    Everything it decides is written to .automation/logs/recovery-launcher.log
    so an unattended recovery is auditable after the fact.

.PARAMETER MaxWaitSeconds
    How long to wait for readiness before giving up. Default 300.

.PARAMETER NoWait
    Skip the readiness wait. Useful for testing and for a manual re-run.

.PARAMETER DryRun
    Report what would happen and exit without starting the controller.
#>

[CmdletBinding()]
param(
    [int]$MaxWaitSeconds = 300,
    [switch]$NoWait,
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths
$logFile = Join-Path $paths.Logs 'recovery-launcher.log'

function Write-RecoveryLog {
    param([string]$Message, [string]$Level = 'INFO')
    if (-not (Test-Path $paths.Logs)) {
        New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null
    }
    $line = '{0} [{1}] {2}{3}' -f (Get-IsoTimestamp), $Level, $Message, [Environment]::NewLine
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Exit-Recovery {
    param([int]$Code, [string]$Reason)
    Write-RecoveryLog "exiting with code $Code ($Reason)"
    exit $Code
}

Write-RecoveryLog '=============================================================='
Write-RecoveryLog "recovery launcher starting (pid=$PID, user=$env:USERNAME, interactive=$([Environment]::UserInteractive))"

# ---------------------------------------------------------------------------
# 0. The repository must be the one this launcher belongs to
# ---------------------------------------------------------------------------

if (-not (Test-Path $paths.RepoRoot)) {
    Exit-Recovery 2 "repository not found at $($paths.RepoRoot)"
}
if (-not (Test-Path $paths.State)) {
    Exit-Recovery 2 "state file not found at $($paths.State); nothing to recover"
}
Write-RecoveryLog "repository: $($paths.RepoRoot)"

# ---------------------------------------------------------------------------
# 1. Readiness wait
#
# After a reboot the machine can be logon-ready long before the network stack
# and the Node toolchain are usable. Starting the controller too early produces
# a confusing launcher failure instead of a clean recovery, so wait first.
# ---------------------------------------------------------------------------

function Test-Ready {
    $nodeOk = $null -ne (Get-Command 'node' -ErrorAction SilentlyContinue)
    $ocOk = $null -ne (Get-Command 'opencode' -ErrorAction SilentlyContinue)
    # A brief settle period also lets the filesystem finish mounting and any
    # previous instance finish unwinding.
    $probePath = Join-Path $paths.Logs '.recovery-probe'
    $writeOk = $false
    try {
        [System.IO.File]::WriteAllText($probePath, 'probe')
        $writeOk = (Test-Path $probePath)
        Remove-Item $probePath -Force -ErrorAction SilentlyContinue
    }
    catch { $writeOk = $false }
    return ($nodeOk -and $ocOk -and $writeOk)
}

if ($NoWait) {
    Write-RecoveryLog 'readiness wait skipped (NoWait)'
}
else {
    $deadline = (Get-Date).AddSeconds([Math]::Max(0, $MaxWaitSeconds))
    $ready = $false
    $elapsed = 0
    while ((Get-Date) -lt $deadline) {
        if (Test-Ready) { $ready = $true; break }
        Start-Sleep -Seconds 5
        $elapsed += 5
        if ($elapsed % 30 -eq 0) {
            Write-RecoveryLog "still waiting for readiness (${elapsed}s of ${MaxWaitSeconds}s)"
        }
    }
    if (-not $ready) {
        Write-RecoveryLog "readiness not reached within ${MaxWaitSeconds}s" 'ERROR'
        Exit-Recovery 3 'environment not ready'
    }
    Write-RecoveryLog "environment ready after ${elapsed}s"
}

# ---------------------------------------------------------------------------
# 2. Never start a second controller
#
# The runner holds the lock for its whole lifetime, so a live lock means one is
# already working. Starting another would race on state.json.
# ---------------------------------------------------------------------------

$config = Get-Config
$maxAge = [int]$config.lock.maxAgeHours

if (Test-ControllerActive -MaxAgeHours $maxAge) {
    $lock = Get-LockState
    Write-RecoveryLog "another controller is already running (pid=$($lock.pid), since $($lock.acquiredAt)); nothing to do" 'WARN'
    Exit-Recovery 0 'controller already active'
}
Write-RecoveryLog 'no active controller; proceeding'

# ---------------------------------------------------------------------------
# 3. Read state and decide
# ---------------------------------------------------------------------------

$state = Read-State
$all = @(Get-RoadmapTasks)
$completed = @(Get-StateProperty -State $state -Name 'completedTaskIds' -Default @())
$status = Get-StateProperty -State $state -Name 'status' -Default 'idle'

Write-RecoveryLog "state: status=$status completed=$($completed.Count)/$($all.Count) task=$(Get-StateProperty -State $state -Name 'currentTaskId')"

# Rule A: a finished project must never be restarted.
if ($completed.Count -ge $all.Count -and $all.Count -gt 0) {
    Write-RecoveryLog "roadmap is complete ($($completed.Count)/$($all.Count)); nothing to do" 'INFO'
    Exit-Recovery 0 'roadmap complete'
}

# Report what recovery will do, for the audit trail.
$interrupted = Get-InterruptedRun -State $state -MaxAgeHours $maxAge
if ($null -ne $interrupted) {
    if ($interrupted.GenuineBlocked) {
        Write-RecoveryLog "task $($interrupted.TaskId) holds a GENUINE BLOCKED result; it will not be retried automatically" 'WARN'
        Exit-Recovery 0 'genuine blocked; operator action required'
    }
    Write-RecoveryLog "interrupted run of $($interrupted.TaskId) detected: $($interrupted.Reason)"
    Write-RecoveryLog "  attempt        : $($interrupted.Attempt)"
    Write-RecoveryLog "  last checkpoint: $(if ($interrupted.Checkpoint) { $interrupted.Checkpoint } else { '(none)' })"
    Write-RecoveryLog "  durable session: $(if ($interrupted.SessionId) { $interrupted.SessionId } else { '(none)' })"
    Write-RecoveryLog "  resume plan    : $(Get-ResumePlan -Interrupted $interrupted)"
    Write-RecoveryLog "  working tree   : $(@(Get-WorkingTreeSummary).Count) entries preserved; no reset or clean will be performed"
}
else {
    Write-RecoveryLog 'no interrupted run detected; this is a normal start'
}

if ($DryRun) {
    Write-RecoveryLog 'DryRun: not starting the controller'
    Write-Host ''
    Write-Host 'Recovery launcher dry run complete. No controller was started.'
    exit 0
}

# ---------------------------------------------------------------------------
# 4. Hand over to the controller
# ---------------------------------------------------------------------------

$runner = Join-Path $PSScriptRoot 'autonomous-runner.ps1'
Write-RecoveryLog "starting controller: $runner"

try {
    # Run in this process so the lock is taken and released by the controller
    # itself, and so the exit code is the controller's own.
    & $runner
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
}
catch {
    Write-RecoveryLog "controller threw: $($_.Exception.Message)" 'ERROR'
    $code = 4
}

Write-RecoveryLog "controller finished with exit code $code"
exit $code
