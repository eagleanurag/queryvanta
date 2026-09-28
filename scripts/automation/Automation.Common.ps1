<#
.SYNOPSIS
    Shared helpers for the QueryVanta autonomous controller.

.DESCRIPTION
    Dot-sourced by every script in scripts/automation. Provides path
    resolution, atomic JSON persistence, roadmap lookup, the single-instance
    lock, and OpenCode output parsing.

    Targets Windows PowerShell 5.1 (Desktop edition). No pwsh-only syntax is
    used: no null-coalescing operator, no ternary, no -AsHashtable.
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:AutomationRoot = $null
$script:RepoRoot = $null
$script:Config = $null

function Get-RepoRoot {
    # Repository root is the parent of scripts/automation, resolved from this
    # file's own location rather than the current directory, so the controller
    # works when started from a Scheduled Task with no working directory.
    if ($script:RepoRoot) { return $script:RepoRoot }
    $here = Split-Path -Parent $PSCommandPath
    $candidate = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) '.'
    $script:RepoRoot = (Resolve-Path $candidate).Path
    return $script:RepoRoot
}

function Get-AutomationPaths {
    $root = Get-RepoRoot
    return [pscustomobject]@{
        RepoRoot        = $root
        AutomationRoot  = Join-Path $root '.automation'
        Config          = Join-Path $root '.automation\config.json'
        Roadmap         = Join-Path $root '.automation\roadmap.json'
        State           = Join-Path $root '.automation\state.json'
        Tasks           = Join-Path $root '.automation\tasks'
        Logs            = Join-Path $root '.automation\logs'
        Failures        = Join-Path $root '.automation\failures'
        Lock            = Join-Path $root '.automation\.runner.lock'
        Scripts         = Join-Path $root 'scripts\automation'
    }
}

function Get-Config {
    if ($script:Config) { return $script:Config }
    $paths = Get-AutomationPaths
    if (-not (Test-Path $paths.Config)) {
        throw "Controller config not found: $($paths.Config)"
    }
    $script:Config = Read-JsonFile $paths.Config
    return $script:Config
}

# ---------------------------------------------------------------------------
# JSON persistence
# ---------------------------------------------------------------------------

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { throw "JSON file not found: $Path" }
    $raw = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { throw "JSON file is empty: $Path" }
    return ($raw | ConvertFrom-Json)
}

function ConvertTo-CompactJson {
    param([Parameter(Mandatory = $true)]$Value, [int]$Depth = 12)
    return ($Value | ConvertTo-Json -Depth $Depth -Compress)
}

function Write-JsonFileAtomic {
    <#
        Writes to a sibling temporary file and only then replaces the target.

        The previous state file is never removed or truncated first: if the
        process dies mid-write, the old file is still intact and readable. This
        matters because the controller must survive a hard kill or a reboot and
        resume from the last known-good state.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 12
    )

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $tmp = "$Path.tmp"
    $json = ConvertTo-CompactJson -Value $Value -Depth $Depth

    # Write and flush the temporary file completely before it can be promoted.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $bytes = $utf8.GetBytes($json)
        $fs.Write($bytes, 0, $bytes.Length)
        $fs.Flush($true)
    }
    finally {
        $fs.Close()
    }

    if (-not (Test-Path $Path)) {
        # First write: no previous state exists to lose.
        Move-Item -Path $tmp -Destination $Path -Force
    }
    else {
        # File.Replace is atomic on NTFS. It needs a real backup path: the
        # .NET Framework overload rejects a null destination-backup argument,
        # and Windows PowerShell 5.1 runs on .NET Framework, not .NET Core.
        # The backup is written to the same directory so the rename stays on
        # one volume, then removed.
        $backup = "$Path.bak"
        [System.IO.File]::Replace($tmp, $Path, $backup, $true)
        Remove-Item -Path $backup -Force -ErrorAction SilentlyContinue
    }
}

function New-AutomationState {
    param([string]$Project = 'queryvanta', [string]$Branch = 'main')
    return [pscustomobject]@{
        schemaVersion        = 1
        project              = $Project
        currentTaskId        = $null
        currentAttempt       = 0
        status               = 'idle'
        lastStartedAt        = $null
        lastFinishedAt       = $null
        lastExitCode         = $null
        lastOpenCodeSessionId = $null
        lastResult           = $null
        completedTaskIds     = @()
        failedTaskIds        = @()
        retryCount           = 0
        lastError            = $null
        lastLogFile          = $null
        lastVerification     = $null
        branch               = $Branch
        baselineHead         = $null
        updatedAt            = $null

        # --- power-loss resilience (schemaVersion 2, additive) ---------------
        # These are all optional. A state file written by schemaVersion 1 is
        # read as-is and every field below defaults to null, so an old state
        # file never becomes unreadable.
        controllerRunId      = $null
        taskCheckpoint       = $null
        taskCheckpointAt     = $null
        resumeMode           = $null
        interruptedAt        = $null
        interruptionReason   = $null
        durableOpenCodeSessionId = $null
        recoveryCount        = 0
    }
}

function Get-StateProperty {
    <#
        Read a state field that may be absent from an older state file.
        Returns $Default rather than throwing under StrictMode, which is what
        keeps a schemaVersion 1 file readable by a schemaVersion 2 controller.
    #>
    param($State, [Parameter(Mandatory = $true)][string]$Name, $Default = $null)

    if ($null -eq $State) { return $Default }
    if (-not ($State.PSObject.Properties.Name -contains $Name)) { return $Default }
    if ($null -eq $State.$Name) { return $Default }
    return $State.$Name
}

function Set-StateProperty {
    <#
        Assign a state field, adding it when the loaded state predates it.
        Returns the state so calls can be chained.

        The parameter is -Object, matching Add-AutomationProperty, so the two
        helpers read identically at every call site.
    #>
    param($Object, [Parameter(Mandatory = $true)][string]$Name, $Value)

    Add-AutomationProperty -Object $Object -Name $Name -Value $Value
    return $Object
}

function Read-State {
    $paths = Get-AutomationPaths
    if (-not (Test-Path $paths.State)) { return (New-AutomationState) }
    try {
        return (Read-JsonFile $paths.State)
    }
    catch {
        # A corrupt state file must not silently restart the roadmap. Rename it
        # so it can be inspected, and rebuild a fresh state.
        $backup = "$($paths.State).corrupt-$(Get-TimestampTag)"
        Move-Item -Path $paths.State -Destination $backup -Force
        Write-AutomationLog "state.json was unreadable; moved to $backup and rebuilt." 'WARN'
        return (New-AutomationState)
    }
}

function Save-State {
    param([Parameter(Mandatory = $true)]$State)
    $State.updatedAt = (Get-IsoTimestamp)
    Add-AutomationProperty -Object $State -Name 'updatedAt' -Value (Get-IsoTimestamp)
    Write-JsonFileAtomic -Path (Get-AutomationPaths).State -Value $State -Depth 12
}

# PowerShell 5.1 cannot add a property to a PSCustomObject in place.
function Add-AutomationProperty {
    param($Object, [string]$Name, $Value)
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function New-RecoveryPrompt {
    <#
        The explicit brief handed to a FRESH OpenCode session when the previous
        durable session cannot be continued.

        This does not pretend an interrupted provider call can be replayed at an
        exact hidden instruction. It states plainly what is known, points the
        agent at the durable evidence on disk, and requires it to inspect the
        existing partial changes before touching anything. The interrupted work
        is preserved and adopted, never discarded and redone.
    #>
    param(
        [Parameter(Mandatory = $true)]$Task,
        [Parameter(Mandatory = $true)]$Interrupted,
        [Parameter(Mandatory = $true)][string]$Attempt
    )

    $paths = Get-AutomationPaths
    $config = Get-Config
    $taskFile = Get-TaskFilePath -Task $Task
    $head = Get-CurrentHead
    $branch = Get-CurrentBranch
    $tree = @(Get-WorkingTreeSummary)

    $treeText = if ($tree.Count -eq 0) { '(clean)' } else { ($tree -join [Environment]::NewLine) }

    $checkpoint = $Interrupted.Checkpoint
    $checkpointText = if ($checkpoint) { "$checkpoint" } else { '(none recorded)' }
    $logFile = $Interrupted.LogFile
    $logText = if ($logFile) { $logFile } else { '(no log recorded)' }
    $logExists = if ($logFile -and (Test-Path $logFile)) { 'yes' } else { 'no' }
    $sessionId = $Interrupted.SessionId
    $sessionText = if ($sessionId) { $sessionId } else { '(none)' }

    # Git writes line-ending advisories to stderr. Under
    # $ErrorActionPreference = 'Stop' a native command writing to stderr can
    # become a terminating error, so the stream is discarded and a failure to
    # produce a diff is not allowed to break the brief.
    $diffSummary = '(diff unavailable)'
    try {
        $raw = & git --no-pager diff --stat 2>$null | Out-String
        if (-not [string]::IsNullOrWhiteSpace($raw)) { $diffSummary = $raw.Trim() }
    }
    catch {
        $diffSummary = '(diff unavailable)'
    }
    $untracked = @()
    foreach ($line in ($tree -split "`r?`n")) {
        if ($line -like '??*') { $untracked += "  $line" }
    }
    $untrackedText = if ($untracked.Count -eq 0) { '(none)' } else { ($untracked -join [Environment]::NewLine) }

    return @"
AUTONOMOUS INTERRUPTED-RUN RECOVERY
===================================

A previous controller run was INTERRUPTED while working on this task, most
likely because the terminal was closed or the machine lost power. This is not a
failed attempt and not a fresh start: partial work may already exist and MUST be
adopted rather than redone.

WHAT IS KNOWN
-------------
Task id            : $($Task.Id)
Title              : $($Task.Title)
Task file          : $taskFile
Attempt            : $Attempt
Approved input     : $($paths.RepoRoot)\$($config.paths.approvedAudit)
Audit sections     : $($Task.AuditSections -join '; ')
Last checkpoint    : $checkpointText
Previous session   : $sessionText (could not be continued; you are a NEW session)
Previous log file  : $logText
Previous log exists: $logExists

REPOSITORY STATE RIGHT NOW
--------------------------
Branch        : $branch
HEAD          : $head
Working tree  :
$treeText

Untracked files:
$untrackedText

Diff stat of tracked modifications:
$diffSummary

WHAT YOU MUST DO
----------------
1. Inspect the repository state above BEFORE changing anything. Read the
   previous log file if it exists: it shows exactly how far the interrupted run
   got, including which gates it had already run.
2. Read the task file in full. It is the authority on scope.
3. Read the relevant audit sections.
4. Determine what, if anything, the interrupted run already implemented
   correctly. Adopt that work. Do NOT delete it and start over.
5. If the partial work is wrong, repair it in place rather than reverting the
   files wholesale.
6. Finish the remaining scope from the task file.
7. Never run destructive git: no reset --hard, no clean, no checkout of
   unrelated paths. The existing changes belong to this task.
8. Do not deploy anything, do not run any remote Cloudflare or database
   command, and do not touch secrets, the OAuth app, or the D1 schema.
9. Do not commit and do not push.
10. Run the required tests and quality gates from the task file and report the
    real results.

OUTPUT CONTRACT
---------------
Your final message MUST end with exactly:

AUTONOMOUS_TASK_STATUS: PASS
or
AUTONOMOUS_TASK_STATUS: FAIL
or
AUTONOMOUS_TASK_STATUS: BLOCKED

AUTONOMOUS_TASK_ID: $($Task.Id)

Then a concise summary: what the interrupted run had already done, what you
adopted, what you changed, which files, and the real gate results.
"@
}

# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

function Get-IsoTimestamp {
    return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Get-TimestampTag {
    return (Get-Date).ToString('yyyyMMdd-HHmmss')
}

# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------

function Get-RoadmapTasks {
    <#
        Flattens phases/tasks into a single ordered list, preserving phase
        order. Each entry gains PhaseId and Position for traceability.
    #>
    $paths = Get-AutomationPaths
    $roadmap = Read-JsonFile $paths.Roadmap
    $out = New-Object System.Collections.ArrayList
    $position = 0

    foreach ($phase in $roadmap.phases) {
        foreach ($task in $phase.tasks) {
            $position++
            $verification = @()
            if ($task.PSObject.Properties.Name -contains 'verification' -and $task.verification) {
                $verification = @($task.verification)
            }
            $auditSections = @()
            if ($task.PSObject.Properties.Name -contains 'auditSections' -and $task.auditSections) {
                $auditSections = @($task.auditSections)
            }
            $dependsOn = @()
            if ($task.PSObject.Properties.Name -contains 'dependsOn' -and $task.dependsOn) {
                $dependsOn = @($task.dependsOn)
            }

            [void]$out.Add([pscustomobject]@{
                    Id            = $task.id
                    Title         = $task.title
                    File          = $task.file
                    PhaseId       = $phase.id
                    PhaseTitle    = $phase.title
                    Position      = $position
                    AutoCommit    = [bool]$task.autoCommit
                    AutoPush      = [bool]$task.autoPush
                    DependsOn     = $dependsOn
                    AuditSections = $auditSections
                    Verification  = $verification
                })
        }
    }

    return $out
}

function Get-RoadmapTask {
    param([Parameter(Mandatory = $true)][string]$Id)
    $all = Get-RoadmapTasks
    foreach ($task in $all) {
        if ($task.Id -eq $Id) { return $task }
    }
    return $null
}

function Get-TaskFilePath {
    param([Parameter(Mandatory = $true)]$Task)
    return (Join-Path (Get-AutomationPaths).Tasks $Task.File)
}

function Select-NextTask {
    <#
        Chooses the first roadmap task whose dependencies are all in
        completedTaskIds. Returns $null when the roadmap is finished.

        A task that is in failedTaskIds is skipped rather than retried here;
        retrying is the runner's job and is bounded by maxAttemptsPerTask.
    #>
    param([Parameter(Mandatory = $true)]$State)

    $completed = @()
    if ($State.completedTaskIds) { $completed = @($State.completedTaskIds) }

    foreach ($task in (Get-RoadmapTasks)) {
        if ($completed -contains $task.Id) { continue }

        $ready = $true
        foreach ($dep in $task.DependsOn) {
            if ($completed -notcontains $dep) { $ready = $false; break }
        }

        if ($ready) { return $task }
    }

    return $null
}

# ---------------------------------------------------------------------------
# Single-instance lock
# ---------------------------------------------------------------------------

function Test-ProcessAlive {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        return ($null -ne $p)
    }
    catch {
        return $false
    }
}

function Get-LockState {
    $paths = Get-AutomationPaths
    if (-not (Test-Path $paths.Lock)) { return $null }
    try {
        return (Read-JsonFile $paths.Lock)
    }
    catch {
        # An unreadable lock is treated as present-but-stale so it can be
        # reclaimed rather than blocking the controller forever.
        return [pscustomobject]@{
            pid        = -1
            machine    = 'unknown'
            acquiredAt = $null
            unreadable = $true
        }
    }
}

function Test-LockStale {
    <#
        A lock is stale when we can prove no live process owns it.

        On this machine: the recorded PID is not running, or the lock is
        malformed. Across machines we cannot check the PID, so we fall back to
        an age threshold. PID reuse is a theoretical risk; it is reduced by
        also recording the acquiring process start time and requiring a match.
    #>
    param($Lock, [int]$MaxAgeHours = 12)

    if ($null -eq $Lock) { return $true }
    if ($Lock.PSObject.Properties.Name -contains 'unreadable' -and $Lock.unreadable) { return $true }

    $machine = [System.Environment]::MachineName
    $sameMachine = ($Lock.machine -eq $machine)

    $ageHours = 999999
    if ($Lock.PSObject.Properties.Name -contains 'acquiredAt' -and $Lock.acquiredAt) {
        try {
            $acquired = [datetime]::Parse($Lock.acquiredAt).ToUniversalTime()
            $ageHours = ((Get-Date).ToUniversalTime() - $acquired).TotalHours
        }
        catch {
            $ageHours = 999999
        }
    }

    if ($sameMachine) {
        $pidValue = -1
        if ($Lock.PSObject.Properties.Name -contains 'pid') { $pidValue = [int]$Lock.pid }
        if (Test-ProcessAlive -ProcessId $pidValue) {
            return $false
        }
        # Owner is gone on this machine. The lock is stale regardless of age.
        return $true
    }

    return ($ageHours -gt $MaxAgeHours)
}

function Enter-RunnerLock {
    <#
        Creates the lock file exclusively. Returns $true on success.

        Exclusive creation is what makes this safe against a race: two runners
        starting at the same instant both attempt NewItem, and only one wins.
    #>
    param([int]$MaxAgeHours = 12)

    $paths = Get-AutomationPaths
    $dir = Split-Path -Parent $paths.Lock
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $payload = [pscustomobject]@{
        pid        = $PID
        machine    = [System.Environment]::MachineName
        user       = [System.Environment]::UserName
        acquiredAt = (Get-IsoTimestamp)
        sessionId  = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    }

    $json = ConvertTo-CompactJson -Value $payload -Depth 6

    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            $fs = [System.IO.File]::Open(
                $paths.Lock,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None)
            try {
                $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
                $fs.Write($bytes, 0, $bytes.Length)
                $fs.Flush($true)
            }
            finally {
                $fs.Close()
            }
            return $true
        }
        catch [System.IO.IOException] {
            $existing = Get-LockState
            if ($attempt -eq 1 -and (Test-LockStale -Lock $existing -MaxAgeHours $MaxAgeHours)) {
                Write-AutomationLog "Reclaiming stale lock (pid=$($existing.pid), machine=$($existing.machine))." 'WARN'
                Remove-Item -Path $paths.Lock -Force -ErrorAction SilentlyContinue
                continue
            }
            return $false
        }
    }

    return $false
}

function Exit-RunnerLock {
    $paths = Get-AutomationPaths
    $lock = Get-LockState
    if ($null -ne $lock -and $lock.PSObject.Properties.Name -contains 'pid' -and [int]$lock.pid -eq $PID) {
        Remove-Item -Path $paths.Lock -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

function Write-AutomationLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Level = 'INFO'
    )
    $paths = Get-AutomationPaths
    if (-not (Test-Path $paths.Logs)) { New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null }
    $file = Join-Path $paths.Logs ("runner-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
    $line = "{0} [{1}] {2}{3}" -f (Get-IsoTimestamp), $Level, $Message, [Environment]::NewLine
    Add-Content -Path $file -Value $line -Encoding UTF8
    Write-Host $line.TrimEnd()
}

# ---------------------------------------------------------------------------
# OpenCode output parsing
# ---------------------------------------------------------------------------

function Get-TextFromNode {
    <#
        Recursively collects human-readable text from an arbitrary parsed JSON
        node.

        The OpenCode JSONL event schema is treated as unknown on purpose. An
        earlier version only descended into a fixed list of container property
        names, which silently returned nothing for the real shape
        (`{ "part": { "text": "..." } }`, singular). This version walks every
        property and collects string values whose KEY is text-bearing, so an
        unrecognised nesting still yields output instead of an empty transcript.
    #>
    param($Node, [int]$Depth = 0)

    if ($null -eq $Node -or $Depth -gt 12) { return @() }
    $found = New-Object System.Collections.ArrayList

    if ($Node -is [string]) { return @($Node) }

    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($key in $Node.Keys) {
            $value = $Node[$key]
            if ($key -match '^(text|content|message|result|output|delta|reasoning|summary)$' -and $value -is [string]) {
                [void]$found.Add($value)
            }
            elseif (Test-IsTraversable -Value $value) {
                foreach ($t in (Get-TextFromNode -Node $value -Depth ($Depth + 1))) { [void]$found.Add($t) }
            }
        }
        return $found
    }

    if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [string])) {
        foreach ($item in $Node) {
            foreach ($t in (Get-TextFromNode -Node $item -Depth ($Depth + 1))) { [void]$found.Add($t) }
        }
        return $found
    }

    foreach ($prop in $Node.PSObject.Properties) {
        $value = $prop.Value
        if ($null -eq $value) { continue }

        if ($prop.Name -match '^(text|content|message|result|output|delta|reasoning|summary)$' -and $value -is [string]) {
            [void]$found.Add($value)
        }
        elseif (Test-IsTraversable -Value $value) {
            # Descend into every non-primitive, whatever it is called.
            foreach ($t in (Get-TextFromNode -Node $value -Depth ($Depth + 1))) { [void]$found.Add($t) }
        }
    }

    return $found
}

function Test-IsTraversable {
    <#
        True when a value is worth descending into.

        A PowerShell string is a .NET REFERENCE type, not a ValueType, so
        `-not ($v -is [ValueType])` does NOT exclude strings. Relying on that
        made the walker collect every string in the event, including ids and
        type tags, which bloated transcripts and flooded the recovery prompt
        with noise. Strings must be excluded explicitly.
    #>
    param($Value)

    if ($null -eq $Value) { return $false }
    if ($Value -is [string]) { return $false }
    if ($Value -is [ValueType]) { return $false }

    return $true
}

function Get-SessionIdFromNode {
    param($Node, [int]$Depth = 0)
    if ($null -eq $Node -or $Depth -gt 8) { return $null }

    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($key in $Node.Keys) {
            if ($key -match '^(sessionID|sessionId|session_id)$' -and $Node[$key] -is [string]) {
                return $Node[$key]
            }
        }
        foreach ($key in $Node.Keys) {
            $found = Get-SessionIdFromNode -Node $Node[$key] -Depth ($Depth + 1)
            if ($found) { return $found }
        }
        return $null
    }

    foreach ($prop in $Node.PSObject.Properties) {
        if ($prop.Name -match '^(sessionID|sessionId|session_id)$' -and $prop.Value -is [string]) {
            return $prop.Value
        }
    }

    foreach ($prop in $Node.PSObject.Properties) {
        if ($prop.Value -is [string] -or $prop.Value -is [ValueType]) { continue }
        $found = Get-SessionIdFromNode -Node $prop.Value -Depth ($Depth + 1)
        if ($found) { return $found }
    }

    return $null
}

function ConvertFrom-OpenCodeJsonl {
    <#
        Parses a captured OpenCode --format json stream.

        The stream is newline-delimited JSON. A line that is not valid JSON is
        counted and skipped rather than aborting the parse: agent output can
        interleave non-JSON diagnostics, and losing the whole transcript because
        of one stray line would be worse than recording the anomaly.
    #>
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = [pscustomobject]@{
        SessionId   = $null
        Text        = ''
        LineCount   = 0
        ParsedLines = 0
        BadLines    = 0
        Ok          = $false
    }

    if (-not (Test-Path $Path)) { return $result }

    $lines = [System.IO.File]::ReadAllLines($Path)
    $result.LineCount = $lines.Count

    $texts = New-Object System.Collections.ArrayList

    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $trimmed = $line.Trim()

        if (-not $trimmed.StartsWith('{') -and -not $trimmed.StartsWith('[')) {
            $result.BadLines++
            continue
        }

        try {
            $node = $trimmed | ConvertFrom-Json
            $result.ParsedLines++
            if (-not $result.SessionId) {
                $sid = Get-SessionIdFromNode -Node $node
                if ($sid) { $result.SessionId = $sid }
            }
            foreach ($t in (Get-TextFromNode -Node $node)) {
                if (-not [string]::IsNullOrWhiteSpace($t)) { [void]$texts.Add($t) }
            }
        }
        catch {
            $result.BadLines++
        }
    }

    $result.Text = ($texts -join [Environment]::NewLine)
    $result.Ok = ($result.ParsedLines -gt 0)
    return $result
}

function Get-TextFromRawOutput {
    <#
        Last-resort text extraction. If JSONL parsing yields nothing usable, the
        raw transcript still contains the agent's final message and therefore the
        status markers. Losing the marker must not be confused with losing the
        output.
    #>
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return '' }
    return ([System.IO.File]::ReadAllText($Path))
}

# ---------------------------------------------------------------------------
# Agent contract markers
# ---------------------------------------------------------------------------

function Get-TaskStatusMarker {
    <#
        Extracts the mandatory agent contract markers.

        A missing marker is reported as $null and the caller MUST treat that as
        failure. Silently assuming success from a transcript that does not say so
        is the single most dangerous behaviour in this controller.
    #>
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $status = $null
    $taskId = $null

    if ($Text) {
        $m = [regex]::Match($Text, '(?im)^\s*AUTONOMOUS_TASK_STATUS\s*:\s*(PASS|FAIL|BLOCKED)\s*$')
        if ($m.Success) { $status = $m.Groups[1].Value.ToUpper() }

        $m2 = [regex]::Match($Text, '(?im)^\s*AUTONOMOUS_TASK_ID\s*:\s*(\S+)\s*$')
        if ($m2.Success) { $taskId = $m2.Groups[1].Value.Trim() }
    }

    return [pscustomobject]@{
        Status     = $status
        TaskId     = $taskId
        MarkerFound = [bool]$status
    }
}

# ---------------------------------------------------------------------------
# Checkpoints and power-loss interruption detection
# ---------------------------------------------------------------------------

# Controller stages. Checkpoints are INFORMATIONAL progress markers: they record
# how far the controller got so an operator can see where a run died. They are
# never evidence that a task succeeded, and no code path treats a checkpoint as
# a result. Only the agent's own AUTONOMOUS_TASK_STATUS plus the verification
# gates can complete a task.
$script:CheckpointNames = @(
    'selected',
    'preflight_complete',
    'opencode_started',
    'opencode_finished',
    'result_parsed',
    'verification_started',
    'verification_passed',
    'task_completed',
    'controller_stopped'
)

function Get-CheckpointNames {
    return @($script:CheckpointNames)
}

function Save-Checkpoint {
    <#
        Persist a controller stage marker before and after major transitions.
        The write is atomic, so a power loss during a checkpoint can never leave
        a half-written state file.
    #>
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($script:CheckpointNames -notcontains $Name) {
        throw "Unknown checkpoint '$Name'. Valid: $($script:CheckpointNames -join ', ')"
    }

    $State.taskCheckpoint = $Name
    $State.taskCheckpointAt = (Get-IsoTimestamp)
    Save-State -State $State
    Write-AutomationLog "checkpoint: $Name"
    return $Name
}

# Statuses that mean "a controller was in the middle of something" when the
# process is no longer running.
$script:InFlightStatuses = @('running', 'recovering', 'verifying', 'selected', 'preflight_complete', 'opencode_started', 'result_parsed', 'verification_started')

function Test-ControllerActive {
    <#
        Is a controller process alive right now? The lock file is the single
        source of truth, because the runner holds it for its whole lifetime.
    #>
    param([int]$MaxAgeHours = 12)

    $lock = Get-LockState
    if ($null -eq $lock) { return $false }
    return -not (Test-LockStale -Lock $lock -MaxAgeHours $MaxAgeHours)
}

function Get-InterruptedRun {
    <#
        Classify the persisted state after a restart.

        Returns $null when nothing was interrupted, otherwise an object
        describing what was in flight and whether the interruption is genuine.

        Decision rules, implemented literally:

          A) roadmap complete            -> handled by the caller, returns null
          B) status in flight, no process -> interrupted run, recover it
          C) status blocked, but lastResult is null AND lastVerification is
             null AND an OpenCode session id exists -> interruption artifact
             (the window was closed before any real result was produced)
          D) status blocked WITH lastResult = 'BLOCKED' -> genuine agent
             BLOCKED, must stay blocked
          E) nothing in flight           -> null
    #>
    param($State, [int]$MaxAgeHours = 12)

    $status = [string](Get-StateProperty -State $State -Name 'status' -Default 'idle')
    $completed = @(Get-StateProperty -State $State -Name 'completedTaskIds' -Default @())
    $taskId = Get-StateProperty -State $State -Name 'currentTaskId'
    $lastResult = Get-StateProperty -State $State -Name 'lastResult'
    $lastVerification = Get-StateProperty -State $State -Name 'lastVerification' -Default @()
    $sessionId = Get-StateProperty -State $State -Name 'durableOpenCodeSessionId' -Default (Get-StateProperty -State $State -Name 'lastOpenCodeSessionId')
    $logFile = Get-StateProperty -State $State -Name 'lastLogFile'
    $attempt = [int](Get-StateProperty -State $State -Name 'currentAttempt' -Default 0)
    $checkpoint = Get-StateProperty -State $State -Name 'taskCheckpoint'

    if ($taskId -and $completed -contains $taskId) {
        # The task finished; the status just was not cleaned up. Not an
        # interruption, and definitely not something to re-run.
        return $null
    }

    $controllerActive = Test-ControllerActive -MaxAgeHours $MaxAgeHours

    # Rule B: an in-flight status with no live controller is an interruption.
    if ($script:InFlightStatuses -contains $status) {
        if ($controllerActive) {
            return [pscustomobject]@{
                IsInterrupted      = $false
                Reason             = 'controller-still-running'
                TaskId             = $taskId
                Attempt            = $attempt
                SessionId          = $sessionId
                LogFile            = $logFile
                Checkpoint         = $checkpoint
                GenuineBlocked     = $false
            }
        }

        return [pscustomobject]@{
            IsInterrupted  = $true
            Reason         = 'status-in-flight-without-controller'
            TaskId         = $taskId
            Attempt        = $attempt
            SessionId      = $sessionId
            LogFile        = $logFile
            Checkpoint     = $checkpoint
            GenuineBlocked = $false
        }
    }

    # Rule C vs D: a blocked status is only an interruption artifact when no
    # real result was ever produced.
    if ($status -eq 'blocked') {
        $hasRealResult = ($null -ne $lastResult) -and ("$lastResult" -ne '')
        $hasVerification = @(Get-StateProperty -State $State -Name 'lastVerification' -Default @()).Count -gt 0

        if (-not $hasRealResult -and -not $hasVerification) {
            return [pscustomobject]@{
                IsInterrupted  = $true
                Reason         = 'blocked-without-result-interruption-artifact'
                TaskId         = $taskId
                Attempt        = $attempt
                SessionId      = $sessionId
                LogFile        = $logFile
                Checkpoint     = $checkpoint
                GenuineBlocked = $false
            }
        }

        # Rule D: a real BLOCKED result stays blocked. Never silently retried.
        return [pscustomobject]@{
            IsInterrupted  = $false
            Reason         = 'genuine-blocked'
            TaskId         = $taskId
            Attempt        = $attempt
            SessionId      = $sessionId
            LogFile        = $logFile
            Checkpoint     = $checkpoint
            GenuineBlocked = $true
        }
    }

    return $null
}

function Get-ResumePlan {
    <#
        Decide how the next attempt should start.

        'session-resume'  -> the previous durable OpenCode session exists and
                             v2.0.11 can continue it with --session
        'recovery-prompt' -> no reusable session, so a FRESH session is started
                             with an explicit recovery prompt
        'fresh'           -> nothing to recover, a normal new session

        This is the strongest safe behaviour available. It does not claim to
        resume a hidden model instruction; it resumes the durable OpenCode
        session, and otherwise hands the agent an explicit recovery brief.
    #>
    param($Interrupted)

    if ($null -eq $Interrupted) { return 'fresh' }
    if ($Interrupted.IsInterrupted -eq $false) { return 'none' }

    $sid = $Interrupted.SessionId
    if ($sid -and ("$sid".Trim() -ne '')) { return 'session-resume' }

    return 'recovery-prompt'
}

# ---------------------------------------------------------------------------
# Run result handling
# ---------------------------------------------------------------------------

function New-InvokerFailureResult {
    <#
        The result object used when the OpenCode launcher throws before any
        process could be started.

        It deliberately does NOT carry an Attempt property. The runner attaches
        Attempt exactly once on the common path; setting it here as well made
        Add-Member throw "a member with that name already exists", which
        replaced the real launcher error with a confusing duplicate-property
        error.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$TaskId,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$ErrorMessage
    )

    return [pscustomobject]@{
        TaskId          = $TaskId
        Label           = $Label
        SessionId       = $null
        Status          = 'FAIL'
        MarkerTaskId    = $null
        MarkerFound     = $false
        ExitCode        = 1
        DurationSeconds = 0
        LogPath         = $null
        TranscriptPath  = $null
        LaunchMode      = $null
        ResolvedCommand = $null
        LaunchDescription = $null
        Parsed          = $false
        ParsedLines     = 0
        BadLines        = 0
        Text            = "launcher error: $ErrorMessage"
    }
}

function Set-RunAttempt {
    <#
        Attach the attempt number to a run result, idempotently.

        Assigns when the property already exists and adds it when it does not,
        so the result ends up with exactly one Attempt property whether it came
        from the invoker or from New-InvokerFailureResult. Returns the object so
        it can be used inline.
    #>
    param($Run, [Parameter(Mandatory = $true)][int]$Attempt)

    if ($null -eq $Run) { return $Run }

    if ($Run.PSObject.Properties.Name -contains 'Attempt') {
        $Run.Attempt = $Attempt
    }
    else {
        $Run | Add-Member -NotePropertyName 'Attempt' -NotePropertyValue $Attempt
    }

    return $Run
}

# ---------------------------------------------------------------------------
# OpenCode command resolution and launch path
# ---------------------------------------------------------------------------

function Resolve-OpenCodeCommand {
    <#
        Resolves the configured OpenCode command to something this machine can
        actually execute, and reports HOW it must be launched.

        Root cause this exists to fix: on this Windows machine
        `Get-Command opencode` resolves to `opencode.ps1`, a PowerShell shim
        installed by the Node version manager. Passing that straight to
        `Start-Process -FilePath` fails with:

            This command cannot be run due to the error: %1 is not a valid
            Win32 application.

        because Start-Process launches a Win32 executable, and a .ps1 shim is
        not one. The same directory also contains `opencode.cmd` and an
        extensionless POSIX shim, so resolution order genuinely varies by host.

        LaunchMode contract:
          'powershell-script' -> run via powershell.exe -File <ResolvedPath>
          'native'            -> run <ResolvedPath> directly
    #>
    param([string]$Command = 'opencode')

    $info = $null
    foreach ($name in @($Command, "$Command.cmd", "$Command.exe", "$Command.bat")) {
        $info = Get-Command $name -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $info) { break }
    }

    if ($null -eq $info) {
        throw "OpenCode command '$Command' was not found on PATH. Install the OpenCode CLI or set opencode.command in .automation/config.json."
    }

    $resolved = $info.Source
    $extension = [System.IO.Path]::GetExtension($resolved)
    $isScript = ($info.CommandType -eq 'ExternalScript') -or
        ($extension -ieq '.ps1')

    $launchMode = 'native'
    if ($isScript) { $launchMode = 'powershell-script' }

    return [pscustomobject]@{
        Command     = $Command
        ResolvedPath = $resolved
        CommandType = $info.CommandType.ToString()
        IsScript    = $isScript
        LaunchMode  = $launchMode
    }
}

function Get-OpenCodeLaunchPrefix {
    <#
        The FilePath plus the leading arguments needed to start the generated
        launcher.

        Always powershell.exe with the documented flags. The launcher is
        always the thing executed, never the OpenCode shim directly, for two
        reasons:

          * Start-Process launches a Win32 executable, so a .ps1 shim must
            never be passed as FilePath (the original "%1 is not a valid
            Win32 application" failure);
          * the multi-line prompt is embedded in the launcher as base64, so
            it never passes through command-line quoting at all.

        LaunchMode stays on the resolution for diagnostics, and the launcher
        invokes the resolved target with the call operator, which handles both
        a .ps1 shim and a native executable. So a later change from the shim to
        a real binary keeps working with no change here.
    #>
    param($Resolution)

    $psExe = (Get-Command 'powershell.exe' -ErrorAction SilentlyContinue).Source
    if (-not $psExe) {
        $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }

    return [pscustomobject]@{
        FilePath     = $psExe
        LeadingArgs  = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass')
        Description  = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File <launcher>  (-> $($Resolution.ResolvedPath))"
    }
}

function Get-OpenCodeArgs {
    <#
        The OpenCode argument array, in order, with the prompt last.

        Returned as an array so it can be passed as a single splatted argument
        to the call operator rather than being concatenated into a command
        line, which is what made multiline prompts unsafe before.
    #>
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$TaskId,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$ResumeSessionId = ''
    )

    # NOTE: the local list must NOT be called $args. $args is a PowerShell
    # automatic variable, and reusing it here made the function return the
    # whole list as one space-joined string instead of an argument array.
    $ocArgsList = New-Object System.Collections.ArrayList
    [void]$ocArgsList.Add('run')
    [void]$ocArgsList.Add('--standalone')
    [void]$ocArgsList.Add('--format')
    [void]$ocArgsList.Add($Config.opencode.format)

    if ($Config.opencode.auto) { [void]$ocArgsList.Add('--auto') }
    if ($Config.opencode.agent) { [void]$ocArgsList.Add('--agent'); [void]$ocArgsList.Add($Config.opencode.agent) }
    if ($Config.opencode.model) { [void]$ocArgsList.Add('--model'); [void]$ocArgsList.Add($Config.opencode.model) }

    # Session continuation. Verified against OpenCode v2.0.11 on this machine:
    # a brand new process with `--standalone --session <ID>` continued the
    # same local session and exited 0, while a nonexistent id exited 1 with a
    # machine-readable "Session not found" error event. So the flag is real
    # and its failure mode is detectable, which is what makes the fallback
    # below safe.
    if ($ResumeSessionId -and ($ResumeSessionId.Trim() -ne '')) {
        [void]$ocArgsList.Add('--session')
        [void]$ocArgsList.Add($ResumeSessionId.Trim())
    }

    [void]$ocArgsList.Add('--title')
    [void]$ocArgsList.Add("autonomous-$TaskId-$Label")

    [void]$ocArgsList.Add($Prompt)

    return @($ocArgsList.ToArray())
}

function Test-SessionResumeFailed {
    <#
        Detect that a `--session <id>` continuation did not actually attach to
        the requested session.

        Observed v2.0.11 behaviour for a nonexistent session:

            exit 1
            {"type":"error",...,"error":{"type":"unknown",
             "message":"Session not found"}}

        A successful continuation exits 0 and every emitted event carries the
        requested sessionID. So: a non-zero exit, an explicit "Session not
        found", or a mismatched session id all mean "fall back to a fresh
        session with a recovery prompt".
    #>
    param(
        $Run,
        [Parameter(Mandatory = $true)][string]$ExpectedSessionId
    )

    if ($null -eq $Run) { return $true }
    if ($ExpectedSessionId -and ($ExpectedSessionId.Trim() -eq '')) { return $false }

    $exitCode = Get-StateProperty -State $Run -Name 'ExitCode' -Default 0
    if ($null -ne $exitCode -and [int]$exitCode -ne 0) { return $true }

    $text = [string](Get-StateProperty -State $Run -Name 'Text' -Default '')
    if ($text -match '(?i)session not found') { return $true }
    if ($text -match '(?i)session[^\r\n]{0,40}(not found|does not exist|unknown session)') { return $true }

    $seen = [string](Get-StateProperty -State $Run -Name 'SessionId' -Default '')
    if ($seen -and ($seen -ne $ExpectedSessionId)) { return $true }

    return $false
}

# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & git @Arguments 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = ($output | Out-String).Trim()
    }
}

function Get-CurrentBranch {
    $r = Invoke-Git -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($r.ExitCode -ne 0) { return $null }
    return $r.Output.Trim()
}

function Get-CurrentHead {
    $r = Invoke-Git -Arguments @('rev-parse', '--short', 'HEAD')
    if ($r.ExitCode -ne 0) { return $null }
    return $r.Output.Trim()
}

function Get-WorkingTreeSummary {
    $r = Invoke-Git -Arguments @('status', '--porcelain')
    if ($r.ExitCode -ne 0) { return @() }
    $entries = @()
    foreach ($line in ($r.Output -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { $entries += $line }
    }
    return $entries
}

# ---------------------------------------------------------------------------
# Safety scanning
# ---------------------------------------------------------------------------

function Test-ForbiddenOperations {
    <#
        Scans text for operations the controller refuses to be associated with.

        Two distinct call sites, two distinct meanings:
          - against a task file  -> refuse to start the task
          - against agent output -> the run already happened; halt as BLOCKED
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)]$Config
    )

    $hits = New-Object System.Collections.ArrayList
    if (-not $Text) { return @() }

    foreach ($pattern in $Config.safety.forbiddenOperations) {
        if ($Text -match [regex]::Escape($pattern)) {
            [void]$hits.Add($pattern)
        }
    }

    foreach ($pattern in $Config.gitPolicy.destructivePatterns) {
        if ($Text -match [regex]::Escape($pattern)) {
            [void]$hits.Add("destructive: $pattern")
        }
    }

    return @($hits)
}
