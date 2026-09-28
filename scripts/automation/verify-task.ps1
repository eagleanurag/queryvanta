<#
.SYNOPSIS
    Runs the verification commands configured for a roadmap task.

.DESCRIPTION
    Reads the verification list from .automation/roadmap.json for the given task
    and runs each command in the repository root, capturing the command, exit
    code, output and timestamp for every one.

    A non-zero exit code is never interpreted as success. If any command fails,
    the task result is FAIL and the combined report is written to
    .automation/logs so the failure can be diagnosed.

.PARAMETER TaskId
    Roadmap task id whose verification block should run.

.PARAMETER SkipCommands
    Optional names to skip. Used only for targeted re-runs.

.OUTPUTS
    PSCustomObject with Passed, Results (array) and ReportPath.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TaskId,
    [string[]]$SkipCommands = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths
$config = Get-Config

$task = Get-RoadmapTask -Id $TaskId
if ($null -eq $task) {
    throw "Unknown task id '$TaskId'. It is not present in roadmap.json."
}

$verification = @($task.Verification)
if ($verification.Count -eq 0) {
    Write-AutomationLog "task $TaskId declares no verification commands; treating as PASS" 'WARN'
    return [pscustomobject]@{ Passed = $true; Results = @(); ReportPath = $null }
}

$results = New-Object System.Collections.ArrayList
$allPassed = $true

Push-Location $paths.RepoRoot
try {
    foreach ($entry in $verification) {
        $name = $entry.name
        $command = $entry.command

        if ($SkipCommands -contains $name) {
            Write-AutomationLog "verification '$name' skipped by request" 'WARN'
            [void]$results.Add([pscustomobject]@{
                    Name      = $name
                    Command   = $command
                    ExitCode  = 0
                    Skipped   = $true
                    Output    = 'skipped'
                    Timestamp = (Get-IsoTimestamp)
                    DurationSeconds = 0
                })
            continue
        }

        Write-AutomationLog "verification '$name' starting: $command"
        $startedAt = Get-Date

        # Run through cmd so the configured strings behave identically however
        # the operator wrote them, and capture the merged stream.
        $output = & cmd.exe /d /c $command 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        $duration = [int]((Get-Date) - $startedAt).TotalSeconds

        [void]$results.Add([pscustomobject]@{
                Name            = $name
                Command         = $command
                ExitCode        = $exitCode
                Skipped         = $false
                Output          = $output
                Timestamp       = (Get-IsoTimestamp)
                DurationSeconds = $duration
            })

        if ($exitCode -eq 0) {
            Write-AutomationLog "verification '$name' passed in ${duration}s"
        }
        else {
            # Never treat a non-zero exit as success.
            Write-AutomationLog "verification '$name' FAILED with exit code $exitCode" 'ERROR'
            $allPassed = $false
        }
    }
}
finally {
    Pop-Location
}

# Persist a full report so a failure can be diagnosed after the fact.
if (-not (Test-Path $paths.Logs)) { New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null }
$reportPath = Join-Path $paths.Logs ("verify-{0}-{1}.log" -f $TaskId, (Get-TimestampTag))

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("Verification report for task $TaskId")
[void]$sb.AppendLine("Generated: $(Get-IsoTimestamp)")
[void]$sb.AppendLine("Repository: $($paths.RepoRoot)")
[void]$sb.AppendLine("HEAD: $(Get-CurrentHead)  branch: $(Get-CurrentBranch)")
[void]$sb.AppendLine("Overall: $(if ($allPassed) { 'PASS' } else { 'FAIL' })")
[void]$sb.AppendLine('')

foreach ($r in $results) {
    [void]$sb.AppendLine(('=' * 70))
    [void]$sb.AppendLine("name    : $($r.Name)")
    [void]$sb.AppendLine("command : $($r.Command)")
    [void]$sb.AppendLine("exit    : $($r.ExitCode)")
    [void]$sb.AppendLine("skipped : $($r.Skipped)")
    [void]$sb.AppendLine("at      : $($r.Timestamp)")
    [void]$sb.AppendLine(('-' * 70))
    [void]$sb.AppendLine($r.Output)
    [void]$sb.AppendLine('')
}

[System.IO.File]::WriteAllText($reportPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-AutomationLog "verification report written to $reportPath"

return [pscustomobject]@{
    Passed     = $allPassed
    Results    = @($results)
    ReportPath = $reportPath
}
