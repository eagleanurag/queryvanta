<#
.SYNOPSIS
    Installs (or removes) the Windows Scheduled Task that starts the autonomous
    runner at logon.

.DESCRIPTION
    This script is a HELPER. It does not install anything when it is merely
    present in the repository, and it must be invoked explicitly.

        .\scripts\automation\install-autonomous-task.ps1 -Install
        .\scripts\automation\install-autonomous-task.ps1 -Remove
        .\scripts\automation\install-autonomous-task.ps1 -Status

    The task is configured to:

      * start when the user logs on, so it runs with no terminal open and does
        not depend on VS Code, a console, or an interactive session;
      * use the repository path explicitly, not a relative or inherited working
        directory;
      * write its own transcript to .automation/logs;
      * run only one instance (the runner's lock file is the second line of
        defence, this setting is the first).

    It is deliberately configured to start at logon rather than at startup,
    because a background logon session is guaranteed to exist and avoids the
    "running whether the user is logged on or not" credential prompt.

    The task is registered for the current user only and does not require
    elevation.

.PARAMETER Install
    Create or update the scheduled task.

.PARAMETER Remove
    Delete the scheduled task if it exists.

.PARAMETER Status
    Report whether the task exists and its current configuration.

.PARAMETER RunNow
    Start the task immediately after install.
#>

[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Remove,
    [switch]$Status,
    [switch]$RunNow
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths

$taskName = 'QueryVanta-Autonomous-Runner'
$runnerPath = Join-Path $paths.Scripts 'autonomous-runner.ps1'
$launcherPath = Join-Path $paths.Scripts 'recovery-launcher.ps1'
$logDir = $paths.Logs

if (-not (Test-Path $runnerPath)) {
    throw "Runner script not found: $runnerPath"
}
if (-not (Test-Path $launcherPath)) {
    throw "Recovery launcher not found: $launcherPath"
}

if (-not ($Install -or $Remove -or $Status)) {
    Write-Host 'No action requested.'
    Write-Host ''
    Write-Host 'This helper is never installed automatically. Choose one explicitly:'
    Write-Host '  -Install    create or update the scheduled task'
    Write-Host '  -Remove     delete the scheduled task'
    Write-Host '  -Status     show the current scheduled task state'
    Write-Host '  -RunNow     (with -Install) start the task immediately'
    Write-Host ''
    Write-Host 'Example:'
    Write-Host '  .\scripts\automation\install-autonomous-task.ps1 -Install'
    exit 0
}

# --- status -----------------------------------------------------------------

if ($Status) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Host "Scheduled task '$taskName' is NOT installed."
        exit 0
    }

    Write-Host "Scheduled task '$taskName' IS installed."
    Write-Host "  State    : $($task.State)"
    Write-Host "  Author   : $($task.Author)"
    foreach ($t in $task.Triggers) {
        Write-Host "  Trigger  : $($t.CimClass.CimClassName) enabled=$($t.Enabled)"
        if ($t.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') {
            Write-Host "    user   : $($t.UserId)"
        }
    }
    foreach ($a in $task.Actions) {
        Write-Host "  Action   : $($a.Execute)"
        Write-Host "    args   : $($a.Arguments)"
        Write-Host "    wd     : $($a.WorkingDirectory)"
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    if ($info) {
        Write-Host "  LastRun  : $($info.LastRunTime)"
        Write-Host "  LastResult: $($info.LastTaskResult)"
        Write-Host "  NextRun  : $($info.NextRunTime)"
    }
    exit 0
}

# --- remove -----------------------------------------------------------------

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        Write-Host "Scheduled task '$taskName' is not installed; nothing to remove."
        exit 0
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'."
    exit 0
}

# --- install ----------------------------------------------------------------

Write-Host 'Installing the QueryVanta autonomous runner scheduled task.'
Write-Host ''
Write-Host "  task name : $taskName"
Write-Host "  launcher  : $launcherPath"
Write-Host "  runner    : $runnerPath"
Write-Host "  repository: $($paths.RepoRoot)"
Write-Host "  logs      : $logDir"
Write-Host ''

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $psExe) { $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# The scheduled task writes its own transcript under .automation/logs.
$taskLog = Join-Path $logDir ('scheduled-{0:yyyy-MM-dd}.log' -f (Get-Date))

# -NoProfile keeps a user's profile from injecting modules or aliases that could
# change controller behaviour. -NonInteractive avoids any prompt. -WindowStyle
# Hidden keeps a console from flashing on every logon.
#
# The target is the RECOVERY LAUNCHER, not the runner directly: the launcher
# waits for Windows and the toolchain to be ready, refuses to start a second
# controller, exits immediately when the roadmap is already complete, and logs
# its recovery decision. The runner does the real resume work.
$arguments = @(
    '-NoLogo'
    '-NoProfile'
    '-NonInteractive'
    '-WindowStyle', 'Hidden'
    '-ExecutionPolicy', 'Bypass'
    '-File', ('"{0}"' -f $launcherPath)
) -join ' '

$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument $arguments `
    -WorkingDirectory $paths.RepoRoot

# At logon for this user. A logon trigger guarantees a real session exists,
# which is what PySpark-style long work and Playwright browser runs need.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

# Never start a second copy. The runner lock file is the authoritative guard,
# but this stops the duplicate at the scheduler level too.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

Write-Host "  user      : $currentUser"
Write-Host "  shell     : $psExe"
Write-Host "  args      : $arguments"
Write-Host "  log       : $taskLog"
Write-Host ''

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    Write-Host 'An existing registration was found; updating it in place (idempotent).'
}

# Register-ScheduledTask -Force replaces an existing registration rather than
# adding a second one, so this installer is safe to run repeatedly. Only one
# task named $taskName can exist, so running it again never creates a duplicate.
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Recovers the QueryVanta autonomous roadmap controller after a reboot, power loss, or closed terminal. Resumes an interrupted task from durable state. Never deploys to production.' `
    -Force | Out-Null

# Verify exactly one registration exists, so a duplicate is detected loudly
# rather than silently tolerated.
$after = @(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
Write-Host "Installed scheduled task '$taskName' (registrations: $($after.Count))."
if ($after.Count -ne 1) {
    throw "Expected exactly one registration of '$taskName' but found $($after.Count). Refusing to continue."
}

$transcriptNote = @"

Scheduled task installed.

  Start automatically : at logon of $currentUser
  Command             : $psExe $arguments
  Working directory   : $($paths.RepoRoot)
  Entrypoint          : recovery-launcher.ps1 (waits for readiness, then runs the controller)
  Launcher log        : $(Join-Path $logDir 'recovery-launcher.log')
  Runner log          : $logDir

Re-running this installer is safe: it updates the single registration in place
and never creates a duplicate.

To check what the controller would do, without doing it:
  powershell -NoProfile -ExecutionPolicy Bypass -File "$runnerPath" -Status
  powershell -NoProfile -ExecutionPolicy Bypass -File "$launcherPath" -NoWait -DryRun

To recover the current task after an accidental terminal close:
  powershell -NoProfile -ExecutionPolicy Bypass -File "$runnerPath\..\recover-task.ps1" -TaskId <id> -RecoverInterrupted

To start the scheduled task now:
  Start-ScheduledTask -TaskName '$taskName'

To stop safely:
  Stop-ScheduledTask -TaskName '$taskName'
  (then remove the lock if a run was killed: -File "$runnerPath" -ResetLock)

To uninstall:
  .\scripts\automation\install-autonomous-task.ps1 -Remove
"@

Write-Host $transcriptNote

if ($RunNow) {
    Write-Host 'Starting the task now (RunNow).'
    Start-ScheduledTask -TaskName $taskName
}
