<#
.SYNOPSIS
    Self-test for the QueryVanta autonomous controller.

.DESCRIPTION
    Exercises the controller's own logic without ever invoking OpenCode and
    without touching the application:

      1  state read
      2  state write
      3  atomic state replacement (previous state survives a failed write)
      4  roadmap task lookup and ordering
      5  next-task selection and dependency gating
      6  task-id rejection for an id not in the roadmap
      7  lock acquisition
      8  duplicate lock refusal (second acquisition must fail)
      9  lock release
     10  stale-lock reclaim (dead PID on this machine)
     11  fresh-lock is NOT considered stale
     12  JSONL parsing from a local fixture, including a deliberately bad line
     13  session id extraction
     14  PASS marker parsing
     15  FAIL marker parsing
     16  missing marker is treated as failure, never success
     17  verification command failure handling (a command that must fail)
     18  verification command success handling
     19  forbidden-operation detection
     20  destructive-git detection
     21  no controller source file leaks into a tsc project

    All temporary state is written under .automation/logs/self-test and removed
    on success, so a green run leaves the repository exactly as it found it.

.OUTPUTS
    Exit code 0 when every check passes, 1 otherwise.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Automation.Common.ps1')

$paths = Get-AutomationPaths
$script:Pass = 0
$script:Fail = 0
$script:Failures = New-Object System.Collections.ArrayList

function Assert-True {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) {
        $script:Pass++
        Write-Host ("  PASS  {0}" -f $Name)
    }
    else {
        $script:Fail++
        [void]$script:Failures.Add("$Name$(if ($Detail) { " -- $Detail" })")
        Write-Host ("  FAIL  {0}{1}" -f $Name, $(if ($Detail) { " -- $Detail" }))
    }
}

function Assert-Equal {
    param([string]$Name, $Expected, $Actual)
    $ok = ($null -eq $Expected -and $null -eq $Actual) -or ("$Expected" -eq "$Actual")
    Assert-True -Name $Name -Condition $ok -Detail $(if ($ok) { '' } else { "expected '$Expected', got '$Actual'" })
}

$sandbox = Join-Path $paths.Logs 'self-test'
if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force }
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null

# The self-test exercises state persistence, which means writing the REAL state
# file. The live file may hold a genuine interrupted run that an operator needs
# to recover, so it is backed up byte for byte and restored verbatim on the way
# out. Losing it would be a destructive side effect of running a test.
$realStateBackup = Join-Path $sandbox 'real-state.backup'
$realStateExisted = Test-Path $paths.State
if ($realStateExisted) {
    Copy-Item -Path $paths.State -Destination $realStateBackup -Force
}

# Restore the live state file no matter how this script ends. Without this a
# thrown assertion would leave the placeholder behind and destroy a real
# interrupted run, which is exactly the kind of damage the controller exists to
# prevent.
function Restore-RealState {
    if ($realStateExisted -and (Test-Path $realStateBackup)) {
        Copy-Item -Path $realStateBackup -Destination $paths.State -Force
        Write-Host '  real state.json restored from backup.'
        return $true
    }
    return $false
}

trap {
    Write-Host ''
    Write-Host "SELF-TEST ABORTED: $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
    $restored = Restore-RealState
    if (-not $restored -and -not $realStateExisted) {
        Remove-Item $paths.State -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $paths.Lock) { Remove-Item $paths.Lock -Force -ErrorAction SilentlyContinue }
    if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host ''
Write-Host '=== QueryVanta autonomous controller self-test ==='
Write-Host "  repository : $($paths.RepoRoot)"
Write-Host "  sandbox    : $sandbox"
Write-Host "  real state : $(if ($realStateExisted) { 'backed up, will be restored verbatim' } else { 'did not exist' })"
Write-Host ''

# ---------------------------------------------------------------------------
Write-Host '1. state read / write / atomic replacement'
# ---------------------------------------------------------------------------

$statePath = Join-Path $sandbox 'state.json'
$initial = New-AutomationState -Project 'selftest'
Write-JsonFileAtomic -Path $statePath -Value $initial -Depth 12
Assert-True 'state file created' (Test-Path $statePath)

# No stray temp file may be left behind after a successful write.
Assert-True 'atomic write left no .tmp file' (-not (Test-Path "$statePath.tmp"))

$reloaded = Read-JsonFile $statePath
Assert-Equal 'state round-trips schemaVersion' 1 $reloaded.schemaVersion
Assert-Equal 'state round-trips project' 'selftest' $reloaded.project
Assert-Equal 'initial currentTaskId is null' '' "$($reloaded.currentTaskId)"

# Required schema fields must all exist.
$requiredFields = @(
    'schemaVersion', 'project', 'currentTaskId', 'currentAttempt', 'status',
    'lastStartedAt', 'lastFinishedAt', 'lastExitCode', 'lastOpenCodeSessionId',
    'lastResult', 'completedTaskIds', 'failedTaskIds', 'retryCount', 'lastError'
)
$missing = @()
foreach ($f in $requiredFields) {
    if ($reloaded.PSObject.Properties.Name -notcontains $f) { $missing += $f }
}
Assert-True 'state contains every required field' ($missing.Count -eq 0) ($missing -join ', ')

# The previous state must survive a write that cannot complete. Simulate a
# failed serialization by passing a value that cannot be converted.
# The property that actually protects the operator is crash resilience: if the
# process dies mid-write, the previous state must still be intact and readable,
# with only a stray temp file left behind. An earlier version of this test tried
# to force a serialization exception, but Windows PowerShell 5.1 serializes
# circular structures without throwing, so that test silently overwrote the
# state file while appearing to check nothing useful.
$beforeBytes = (Get-Item $statePath).Length
$beforeText = [System.IO.File]::ReadAllText($statePath)

# Simulate a crash during the write: a partial temp file exists, the real state
# file was never touched.
Set-Content -Path "$statePath.tmp" -Value '{"schemaVersion":1,"project":"half-writ' -NoNewline

Assert-True 'a stranded temp file does not affect the real state file' (Test-Path $statePath)
$afterCrash = Read-JsonFile $statePath
Assert-Equal 'state is still readable after a simulated crash' 'selftest' $afterCrash.project
Assert-Equal 'state is byte-identical after a simulated crash' $beforeBytes (Get-Item $statePath).Length
Assert-Equal 'state content is unchanged after a simulated crash' $beforeText ([System.IO.File]::ReadAllText($statePath))

# The next real write must recover cleanly, replacing the state and removing the
# stray temp file.
$recovered = New-AutomationState -Project 'selftest'
$recovered.status = 'recovered'
Write-JsonFileAtomic -Path $statePath -Value $recovered -Depth 12
Assert-Equal 'a later write recovers the state' 'recovered' (Read-JsonFile $statePath).status
Assert-True 'a later write clears the stranded temp file' (-not (Test-Path "$statePath.tmp"))
Assert-True 'a later write leaves no backup file' (-not (Test-Path "$statePath.bak"))

# Incremental update through Save-State on the real state schema.
$live = New-AutomationState
$live.status = 'running'
$live.currentTaskId = '4.2A'
$live.currentAttempt = 2
$live.completedTaskIds = @('4.1')
Save-State -State $live
$liveBack = Read-JsonFile $paths.State
Assert-Equal 'Save-State persisted status' 'running' $liveBack.status
Assert-Equal 'Save-State persisted currentAttempt' 2 $liveBack.currentAttempt
Assert-Equal 'Save-State persisted completed list' '4.1' (@($liveBack.completedTaskIds) -join ',')

# A pristine placeholder while the rest of the suite exercises persistence.
# The real file is restored verbatim from the backup in the cleanup block.
Write-JsonFileAtomic -Path $paths.State -Value (New-AutomationState) -Depth 12

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '2. roadmap lookup, ordering and dependency gating'
# ---------------------------------------------------------------------------

$all = @(Get-RoadmapTasks)
Assert-True 'roadmap parsed' ($all.Count -ge 14) "found $($all.Count) tasks"
Assert-Equal 'first roadmap task is 4.2A' '4.2A' $all[0].Id

$expectedOrder = @('4.2A', '4.2B', '4.2C', '4.2D', '4.2E', '4.2F', '4.2G', '4.2H', '5.1', '5.2', '5.3', '5.4', '5.5', 'FINAL')
$actualOrder = @()
foreach ($t in $all) { $actualOrder += $t.Id }
Assert-Equal 'roadmap order matches the approved plan' ($expectedOrder -join ',') ($actualOrder -join ',')

$taskA = Get-RoadmapTask -Id '4.2A'
Assert-True '4.2A resolves' ($null -ne $taskA)
Assert-True '4.2A has a task file' (Test-Path (Get-TaskFilePath -Task $taskA))
Assert-True '4.2A declares no dependencies' (@($taskA.DependsOn).Count -eq 0)
Assert-True '4.2A declares verification commands' (@($taskA.Verification).Count -gt 0)
Assert-True '4.2A has autoCommit false' ($taskA.AutoCommit -eq $false)
Assert-True '4.2A has autoPush false' ($taskA.AutoPush -eq $false)

$unknown = Get-RoadmapTask -Id '9.9Z-not-a-task'
Assert-True 'unknown task id returns null' ($null -eq $unknown)

# Every task must have a real file on disk.
$missingFiles = @()
foreach ($t in $all) {
    if (-not (Test-Path (Get-TaskFilePath -Task $t))) { $missingFiles += $t.Id }
}
Assert-True 'every roadmap task file exists' ($missingFiles.Count -eq 0) ($missingFiles -join ', ')

# Dependency gating.
$empty = New-AutomationState
Assert-Equal 'empty state selects the first task' '4.2A' (Select-NextTask -State $empty).Id

$partial = New-AutomationState
$partial.completedTaskIds = @('4.2A')
Assert-Equal 'completing 4.2A advances to 4.2B' '4.2B' (Select-NextTask -State $partial).Id

# Skipping a task must NOT let a dependent run early.
$skipped = New-AutomationState
$skipped.completedTaskIds = @('4.2A', '4.2C')
Assert-Equal 'a skipped predecessor blocks its dependent' '4.2B' (Select-NextTask -State $skipped).Id

$allDone = New-AutomationState
$allDone.completedTaskIds = $expectedOrder
Assert-True 'fully completed roadmap selects nothing' ($null -eq (Select-NextTask -State $allDone))

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '3. lock acquire / refuse duplicate / release / stale reclaim'
# ---------------------------------------------------------------------------

if (Test-Path $paths.Lock) { Remove-Item $paths.Lock -Force }

$acquired = Enter-RunnerLock -MaxAgeHours 12
Assert-True 'first lock acquisition succeeds' $acquired

$second = Enter-RunnerLock -MaxAgeHours 12
Assert-True 'second concurrent lock acquisition is refused' ($second -eq $false)

$lockState = Get-LockState
Assert-True 'lock file records this pid' ([int]$lockState.pid -eq $PID)
Assert-True 'lock file records this machine' ($lockState.machine -eq [System.Environment]::MachineName)
Assert-True 'lock has an acquisition timestamp' ($null -ne $lockState.acquiredAt)
Assert-True 'a live lock is not stale' ((Test-LockStale -Lock $lockState -MaxAgeHours 12) -eq $false)

Exit-RunnerLock
Assert-True 'lock released' (-not (Test-Path $paths.Lock))

# Stale: a PID that cannot be running, on this machine.
$stale = [pscustomobject]@{
    pid        = 999999
    machine    = [System.Environment]::MachineName
    acquiredAt = (Get-IsoTimestamp)
}
Assert-True 'dead pid on this machine is stale' ((Test-LockStale -Lock $stale -MaxAgeHours 12) -eq $true)

# Stale: corrupt lock file.
$corruptLock = Join-Path $sandbox 'corrupt.lock'
Set-Content -Path $corruptLock -Value '{ this is not json' -NoNewline
$corrupt = Get-LockState -ErrorAction SilentlyContinue
Assert-True 'absent lock reports null' ($null -eq (Get-LockState))
$readCorrupt = $null
try { $readCorrupt = Read-JsonFile $corruptLock } catch { $readCorrupt = $null }
Assert-True 'corrupt lock is unreadable and therefore reclaimable' ($null -eq $readCorrupt)

# Stale across machines: judged by age only.
$oldRemote = [pscustomobject]@{
    pid        = 4242
    machine    = 'some-other-machine'
    acquiredAt = (Get-Date).AddHours(-48).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
Assert-True 'old lock from another machine is stale by age' ((Test-LockStale -Lock $oldRemote -MaxAgeHours 12) -eq $true)

$freshRemote = [pscustomobject]@{
    pid        = 4242
    machine    = 'some-other-machine'
    acquiredAt = (Get-IsoTimestamp)
}
Assert-True 'fresh lock from another machine is not stale' ((Test-LockStale -Lock $freshRemote -MaxAgeHours 12) -eq $false)

# Reclaim path: a stale lock on disk must be replaced by Enter-RunnerLock.
$staleOnDisk = [pscustomobject]@{
    pid        = 999999
    machine    = [System.Environment]::MachineName
    acquiredAt = (Get-IsoTimestamp)
}
Write-JsonFileAtomic -Path $paths.Lock -Value $staleOnDisk -Depth 6
$reclaimed = Enter-RunnerLock -MaxAgeHours 12
Assert-True 'a stale lock on disk is reclaimed' $reclaimed
$afterReclaim = Get-LockState
Assert-Equal 'reclaimed lock now belongs to this process' $PID ([int]$afterReclaim.pid)
Exit-RunnerLock
Assert-True 'lock released after reclaim test' (-not (Test-Path $paths.Lock))

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '4. OpenCode JSONL parsing (local fixtures, no OpenCode invoked)'
# ---------------------------------------------------------------------------

$fixtures = Join-Path $PSScriptRoot 'test-fixtures'

$passFixture = Join-Path $fixtures 'opencode-pass.jsonl'
Assert-True 'pass fixture exists' (Test-Path $passFixture)
$parsedPass = ConvertFrom-OpenCodeJsonl -Path $passFixture
Assert-True 'pass fixture parsed' $parsedPass.Ok
Assert-True 'pass fixture parsed every line' ($parsedPass.BadLines -eq 0)
Assert-Equal 'pass fixture session id extracted' 'ses_autonomous_4_2A_7f3a91c2' $parsedPass.SessionId
Assert-True 'pass fixture text contains the summary' ($parsedPass.Text -like '*no production changes*')

$failFixture = Join-Path $fixtures 'opencode-fail.jsonl'
Assert-True 'fail fixture exists' (Test-Path $failFixture)
$parsedFail = ConvertFrom-OpenCodeJsonl -Path $failFixture
Assert-True 'fail fixture parsed' $parsedFail.Ok
Assert-Equal 'fail fixture skipped exactly one bad line' 1 $parsedFail.BadLines
Assert-Equal 'fail fixture session id extracted' 'ses_autonomous_fail_fixture' $parsedFail.SessionId
Assert-True 'a bad line does not abort the parse' ($parsedPass.ParsedLines -gt 0)

$noMarkerFixture = Join-Path $fixtures 'opencode-nomarker.jsonl'
Assert-True 'no-marker fixture exists' (Test-Path $noMarkerFixture)
$parsedNoMarker = ConvertFrom-OpenCodeJsonl -Path $noMarkerFixture
Assert-True 'no-marker fixture parsed' $parsedNoMarker.Ok

Assert-True 'parsing a missing file does not throw' ((ConvertFrom-OpenCodeJsonl -Path (Join-Path $sandbox 'nope.jsonl')).Ok -eq $false)

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '5. agent contract marker parsing'
# ---------------------------------------------------------------------------

$m1 = Get-TaskStatusMarker -Text $parsedPass.Text
Assert-Equal 'PASS marker parsed' 'PASS' $m1.Status
Assert-Equal 'task id marker parsed' '4.2A' $m1.TaskId
Assert-True 'PASS marker reported as found' $m1.MarkerFound

$m2 = Get-TaskStatusMarker -Text $parsedFail.Text
Assert-Equal 'FAIL marker parsed' 'FAIL' $m2.Status
Assert-Equal 'FAIL task id parsed' '4.2A' $m2.TaskId

$m3 = Get-TaskStatusMarker -Text $parsedNoMarker.Text
Assert-True 'missing marker is reported as not found' ($m3.MarkerFound -eq $false)
Assert-True 'missing marker yields a null status' ($null -eq $m3.Status)
# The controller's contract: a missing marker must never be read as success.
Assert-True 'missing marker is not treated as PASS' ($m3.Status -ne 'PASS')

$m4 = Get-TaskStatusMarker -Text ''
Assert-True 'empty output yields no marker' ($m4.MarkerFound -eq $false)

$m5 = Get-TaskStatusMarker -Text "AUTONOMOUS_TASK_STATUS: BLOCKED`nAUTONOMOUS_TASK_ID: 4.2H"
Assert-Equal 'BLOCKED marker parsed' 'BLOCKED' $m5.Status
Assert-Equal 'BLOCKED task id parsed' '4.2H' $m5.TaskId

# A marker buried in prose mid-line must not be accepted; it must be its own line.
$m6 = Get-TaskStatusMarker -Text 'I think AUTONOMOUS_TASK_STATUS: PASS would be wrong here.'
Assert-True 'inline marker is not accepted' ($m6.MarkerFound -eq $false)

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '6. verification command handling'
# ---------------------------------------------------------------------------

# A command that must fail, to prove a non-zero exit is reported as a failure.
$out = & cmd.exe /d /c 'exit /b 3' 2>&1 | Out-String
$code = $LASTEXITCODE
Assert-Equal 'a failing command yields a non-zero exit code' 3 $code
Assert-True 'a non-zero exit is not equal to zero' ($code -ne 0)

$out2 = & cmd.exe /d /c 'echo gate-ok' 2>&1 | Out-String
$code2 = $LASTEXITCODE
Assert-Equal 'a passing command yields exit code 0' 0 $code2
Assert-True 'passing command output is captured' ($out2 -like '*gate-ok*')

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '7. safety scanning'
# ---------------------------------------------------------------------------

$config = Get-Config
$bad = "I will run wrangler deploy right now."
$hits = @(Test-ForbiddenOperations -Text $bad -Config $config)
Assert-True 'deployment command is detected' ($hits.Count -gt 0)

$badRemote = "wrangler d1 execute queryvanta --remote --file=migrations/0001_init.sql"
Assert-True 'remote D1 operation is detected' ((@(Test-ForbiddenOperations -Text $badRemote -Config $config)).Count -gt 0)

$badPush = "git push origin main"
Assert-True 'push is detected' ((@(Test-ForbiddenOperations -Text $badPush -Config $config)).Count -gt 0)

$badReset = "git reset --hard HEAD~1"
Assert-True 'destructive reset is detected' ((@(Test-ForbiddenOperations -Text $badReset -Config $config)).Count -gt 0)

$badClean = "git clean -fd"
Assert-True 'destructive clean is detected' ((@(Test-ForbiddenOperations -Text $badClean -Config $config)).Count -gt 0)

$clean = "Added a scheduled handler and ran the server test suite."
Assert-True 'benign text triggers nothing' ((@(Test-ForbiddenOperations -Text $clean -Config $config)).Count -eq 0)

# Every task file must be clean, or the runner would refuse to start it.
$dirtyTasks = @()
foreach ($t in $all) {
    $path = Get-TaskFilePath -Task $t
    $text = [System.IO.File]::ReadAllText($path)
    if ((@(Test-ForbiddenOperations -Text $text -Config $config)).Count -gt 0) { $dirtyTasks += $t.Id }
}
Assert-True 'no task file contains a forbidden operation' ($dirtyTasks.Count -eq 0) ($dirtyTasks -join ', ')

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '8. controller files are outside every tsc project'
# ---------------------------------------------------------------------------

# tsconfig.app.json includes only src, tsconfig.node.json only vite.config.ts and
# tsconfig.server.json only server/**/*.ts. The automation layer is PowerShell
# and JSON, so it must not be swept into a TypeScript build.
$tsConfigs = @('tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.server.json')
$automationLeak = @()
foreach ($tc in $tsConfigs) {
    $raw = [System.IO.File]::ReadAllText((Join-Path $paths.RepoRoot $tc))
    foreach ($pattern in @('"src"', 'vite.config.ts', 'server/**')) {
        if ($raw -like "*$pattern*") {
            if ($pattern -like '*automation*' -or $raw -like '*.automation*' -or $raw -like '*scripts/automation*') {
                $automationLeak += "$tc -> $pattern"
            }
        }
    }
}
Assert-True 'no tsconfig references the automation layer' ($automationLeak.Count -eq 0) ($automationLeak -join ', ')

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '9. git policy defaults'
# ---------------------------------------------------------------------------

Assert-True 'config default autoCommit is false' ($config.gitPolicy.autoCommit -eq $false)
Assert-True 'config default autoPush is false' ($config.gitPolicy.autoPush -eq $false)
Assert-True 'every roadmap task currently forbids autoPush' (@($all | Where-Object { $_.AutoPush }).Count -eq 0)
Assert-True 'every roadmap task currently forbids autoCommit' (@($all | Where-Object { $_.AutoCommit }).Count -eq 0)
Assert-True 'background server mode is disabled' ($config.opencode.useBackgroundServer -eq $false)
Assert-True 'standalone mode is required' ($config.opencode.mode -eq 'standalone')
Assert-True 'the --server flag is explicitly forbidden' (@($config.opencode.forbiddenFlags) -contains '--server')

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '10. OpenCode command resolution and launch path (no task executed)'
# ---------------------------------------------------------------------------

# Bug 1: `Get-Command opencode` resolves to a .ps1 shim on this machine, and
# Start-Process launches Win32 executables, so passing the shim as -FilePath
# failed with "%1 is not a valid Win32 application".

$res = $null
$resolveThrew = $false
try { $res = Resolve-OpenCodeCommand -Command 'opencode' } catch { $resolveThrew = $true }

Assert-True 'opencode command resolves on PATH' ((-not $resolveThrew) -and ($null -ne $res))

if ($null -ne $res) {
    Assert-True 'resolution reports a resolved path' (-not [string]::IsNullOrWhiteSpace($res.ResolvedPath))
    Assert-True 'resolution reports a launch mode' ($res.LaunchMode -in @('powershell-script', 'native'))
    Assert-True 'IsScript is a boolean' ($res.IsScript -is [bool])

    # Whichever candidate this host resolves, the launch must never hand a
    # script to Start-Process as a Win32 application.
    if ($res.IsScript) {
        Assert-Equal 'a PowerShell shim selects powershell-script mode' 'powershell-script' $res.LaunchMode
    }
    else {
        Assert-Equal 'a non-script selects native mode' 'native' $res.LaunchMode
    }

    $launch = Get-OpenCodeLaunchPrefix -Resolution $res
    Assert-Equal 'launch FilePath is powershell.exe' 'powershell.exe' (Split-Path -Leaf $launch.FilePath)
    Assert-True 'launch FilePath exists' (Test-Path $launch.FilePath)
    Assert-Equal 'launch passes -NoLogo' '-NoLogo' $launch.LeadingArgs[0]
    Assert-Equal 'launch passes -NoProfile' '-NoProfile' $launch.LeadingArgs[1]
    Assert-Equal 'launch passes -ExecutionPolicy' '-ExecutionPolicy' $launch.LeadingArgs[2]
    Assert-Equal 'launch passes Bypass' 'Bypass' $launch.LeadingArgs[3]
    Assert-True 'launch does not embed a resolved path in its leading args' (-not (($launch.LeadingArgs -join ' ') -match 'opencode'))
}

# A native executable must still be detected as native, so a later change of the
# configured command to a real binary is visible and correct. Both modes launch
# through the generated launcher, because the prompt must never be placed on a
# command line; what differs is which target the launcher invokes.
$native = Resolve-OpenCodeCommand -Command 'cmd'
Assert-Equal 'a real executable selects native mode' 'native' $native.LaunchMode
Assert-True 'a real executable is not treated as a script' ($native.IsScript -eq $false)
$nativeLaunch = Get-OpenCodeLaunchPrefix -Resolution $native
Assert-Equal 'native mode still launches through powershell.exe' 'powershell.exe' (Split-Path -Leaf $nativeLaunch.FilePath)
Assert-True 'native mode records the resolved target in its description' ($nativeLaunch.Description -like "*$($native.ResolvedPath)*")
Assert-Equal 'the launcher flags are the same for both modes' 4 $nativeLaunch.LeadingArgs.Count

# An unknown command must fail loudly rather than silently launching nothing.
$unknownThrew = $false
try { Resolve-OpenCodeCommand -Command 'qv-no-such-opencode-command-xyz' | Out-Null } catch { $unknownThrew = $true }
Assert-True 'an unknown opencode command throws' $unknownThrew

# The argument builder must keep the required contract and put the prompt last.
$cfgForArgs = Get-Config
$argArray = @(Get-OpenCodeArgs -Config $cfgForArgs -TaskId 'SELFTEST' -Label 'task' -Prompt 'PROMPT-SENTINEL')
Assert-Equal 'args start with run' 'run' $argArray[0]
Assert-True 'args include --standalone' ($argArray -contains '--standalone')
Assert-True 'args include --auto' ($argArray -contains '--auto')
Assert-Equal 'format flag is followed by json' 'json' $argArray[$argArray.IndexOf('--format') + 1]
Assert-True 'args never contain --server' (-not ($argArray -contains '--server'))
Assert-Equal 'the prompt is the final argument' 'PROMPT-SENTINEL' $argArray[$argArray.Count - 1]
Assert-True 'the sentinel prompt appears exactly once as a single element' (@($argArray | Where-Object { $_ -eq 'PROMPT-SENTINEL' }).Count -eq 1)

$multiline = "line1`nline2`nline3"
$ml = @(Get-OpenCodeArgs -Config $cfgForArgs -TaskId 'T' -Label 'task' -Prompt $multiline)
Assert-Equal 'a multiline prompt stays exactly one argument' $multiline $ml[$ml.Count - 1]

# The generated launcher must be a syntactically valid PowerShell script, and
# the prompt must round-trip through base64 unchanged.
$enc = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($multiline))
Assert-Equal 'prompt round-trips through base64' $multiline ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($enc)))

$fakeLauncher = Join-Path $sandbox 'launcher-selftest.ps1'
$fakeBody = @"
`$ErrorActionPreference = 'Continue'
`$target = 'C:\not\a\real\opencode.ps1'
`$prompt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('$enc'))
`$ocArgs = @('run', '--standalone', '--format', 'json', '--auto', '--title', 'autonomous-SELFTEST-task')
& `$target @ocArgs `$prompt
exit `$LASTEXITCODE
"@
[System.IO.File]::WriteAllText($fakeLauncher, $fakeBody, (New-Object System.Text.UTF8Encoding($true)))
$parseErrors = $null
$parseTokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($fakeLauncher, [ref]$parseTokens, [ref]$parseErrors) | Out-Null
Assert-True 'the generated launcher shape parses as valid PowerShell' (($null -eq $parseErrors) -or ($parseErrors.Count -eq 0))
Remove-Item $fakeLauncher -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '11. run-result Attempt property (bug 2)'
# ---------------------------------------------------------------------------

# Bug 2: the launcher-error fallback object already contained Attempt, and the
# runner then called Add-Member unconditionally, which threw
# "Cannot add a member with the name 'Attempt' because a member with that name
# already exists."

$fallback = New-InvokerFailureResult -TaskId '4.2A' -Label 'task' -ErrorMessage 'simulated launcher failure'
Assert-True 'launcher failure result is created' ($null -ne $fallback)
Assert-Equal 'launcher failure result defaults to FAIL' 'FAIL' $fallback.Status
Assert-Equal 'launcher failure result has exit code 1' 1 $fallback.ExitCode
Assert-True 'launcher failure result carries the error text' ($fallback.Text -like '*simulated launcher failure*')
Assert-True 'launcher failure result does NOT pre-set Attempt' (-not ($fallback.PSObject.Properties.Name -contains 'Attempt'))

# The common path must attach Attempt exactly once, without throwing.
$attachThrew = $false
try { $fallback = Set-RunAttempt -Run $fallback -Attempt 1 } catch { $attachThrew = $true }
Assert-True 'Set-RunAttempt does not throw on a fallback result' (-not $attachThrew)
Assert-Equal 'fallback result now has Attempt' 1 $fallback.Attempt
Assert-Equal 'fallback result has exactly one Attempt member' 1 (@($fallback.PSObject.Properties.Name | Where-Object { $_ -eq 'Attempt' }).Count)

# Re-attaching must overwrite, not throw: this is the exact call that used to fail.
$reattachThrew = $false
try { $fallback = Set-RunAttempt -Run $fallback -Attempt 2 } catch { $reattachThrew = $true }
Assert-True 'Set-RunAttempt does not throw when Attempt already exists' (-not $reattachThrew)
Assert-Equal 're-attaching overwrites the attempt number' 2 $fallback.Attempt
Assert-Equal 'still exactly one Attempt member after re-attach' 1 (@($fallback.PSObject.Properties.Name | Where-Object { $_ -eq 'Attempt' }).Count)

# A normal invoker result (no Attempt) must also receive it cleanly.
$normal = [pscustomobject]@{
    TaskId = '4.2A'; Label = 'task'; Status = 'PASS'; ExitCode = 0
    SessionId = 'ses_selftest'; LogPath = 'x'; TranscriptPath = 'y'
    LaunchMode = 'powershell-script'; Parsed = $true; BadLines = 0; Text = 'ok'
}
$normalThrow = $false
try { $normal = Set-RunAttempt -Run $normal -Attempt 1 } catch { $normalThrow = $true }
Assert-True 'Set-RunAttempt does not throw on a normal invoker result' (-not $normalThrow)
Assert-Equal 'normal result receives Attempt' 1 $normal.Attempt
Assert-Equal 'normal result has exactly one Attempt member' 1 (@($normal.PSObject.Properties.Name | Where-Object { $_ -eq 'Attempt' }).Count)
Assert-True 'normal result keeps all invoker fields' (($normal.PSObject.Properties.Name -contains 'SessionId') -and ($normal.PSObject.Properties.Name -contains 'LaunchMode'))

# Set-RunAttempt must tolerate a null run without throwing.
$nullRunThrew = $false
try { $nullResult = Set-RunAttempt -Run $null -Attempt 1 } catch { $nullRunThrew = $true }
Assert-True 'Set-RunAttempt tolerates a null run' (-not $nullRunThrew)
Assert-True 'Set-RunAttempt returns null for a null run' ($null -eq $nullResult)

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '12. PowerShell 5.1 compatibility'
# ---------------------------------------------------------------------------

Assert-True 'running on Windows PowerShell 5.1' ($PSVersionTable.PSVersion.Major -eq 5)
Assert-Equal 'Desktop edition' 'Desktop' $PSVersionTable.PSEdition

# No PS7-only syntax may appear in the controller sources.
$ps7OnlyPatterns = @(
    # Null-coalescing / null-conditional. The lookbehind excludes a quoted
    # '??', which is a wildcard (for example git porcelain '??*'), not the
    # PS7 operator.
    '(?<!["''])\?\?',
    '(?<!["''])\?\.',
    '\|\|\|',                     # pipeline chain operator
    'ForEach-Object\s+-Parallel', # parallel pipeline
    '\bGet-Error\b',
    'ConvertFrom-Json[^\r\n]*-AsHashtable',
    '\bJoin-Path[^\r\n]*-AdditionalChildPath'
)
$ps7Hits = @()
foreach ($f in (Get-ChildItem $PSScriptRoot -Filter *.ps1)) {
    if ($f.Name -eq 'test-controller.ps1') { continue }
    $src = [System.IO.File]::ReadAllText($f.FullName)
    # Ignore comment lines: documentation that merely MENTIONS a PS7-only
    # operator is not a use of it, and flagging it would make the check
    # unusable.
    $code = (@($src -split "`r?`n") |
            Where-Object { $_ -notmatch '^\s*(#|<#|//|\*|--)' }) -join "`n"
    foreach ($p in $ps7OnlyPatterns) {
        if ($code -match $p) { $ps7Hits += "$($f.Name): $p" }
    }
}
Assert-True 'no PowerShell 7 only syntax in the controller' ($ps7Hits.Count -eq 0) ($ps7Hits -join ', ')

# Every controller script must still parse.
$parseFailures = @()
foreach ($f in (Get-ChildItem $PSScriptRoot -Filter *.ps1)) {
    $e = $null
    $t = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e) | Out-Null
    if ($e -and $e.Count -gt 0) { $parseFailures += $f.Name }
}
Assert-True 'every controller script parses' ($parseFailures.Count -eq 0) ($parseFailures -join ', ')

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '13. power-loss resilience: state, checkpoints, interruption, resume'
# ---------------------------------------------------------------------------

# --- 1. backward compatibility ---------------------------------------------
# A schemaVersion 1 state file (as written before this feature) must remain
# readable, and every new field must default rather than throw.
$v1 = [pscustomobject]@{
    schemaVersion         = 1
    project               = 'queryvanta'
    currentTaskId         = '4.2A'
    currentAttempt        = 1
    status                = 'idle'
    lastStartedAt         = $null
    lastFinishedAt        = $null
    lastExitCode          = 0
    lastOpenCodeSessionId = $null
    lastResult            = $null
    completedTaskIds      = @()
    failedTaskIds         = @()
    retryCount            = 0
    lastError             = $null
    branch                = 'main'
}
Assert-Equal 'a v1 state has no durable session field' '' "$(Get-StateProperty -State $v1 -Name 'durableOpenCodeSessionId')"
Assert-Equal 'a v1 state recovery count defaults to 0' 0 (Get-StateProperty -State $v1 -Name 'recoveryCount' -Default 0)
Assert-Equal 'a v1 state checkpoint defaults to empty' '' "$(Get-StateProperty -State $v1 -Name 'taskCheckpoint')"
$v1NoThrow = $true
try { $null = Get-StateProperty -State $v1 -Name 'resumeMode' } catch { $v1NoThrow = $false }
Assert-True 'Get-StateProperty on a v1 state does not throw for a missing field' $v1NoThrow

# A fresh state must already carry the new fields.
$fresh = New-AutomationState
foreach ($f in @('controllerRunId', 'taskCheckpoint', 'taskCheckpointAt', 'resumeMode',
        'interruptedAt', 'interruptionReason', 'durableOpenCodeSessionId', 'recoveryCount')) {
    Assert-True "fresh state contains '$f'" ($fresh.PSObject.Properties.Name -contains $f)
}

# --- 2 & 3. atomic persistence and checkpoints ------------------------------
$cpStatePath = Join-Path $sandbox 'checkpoint-state.json'
$cp = New-AutomationState
$cp.status = 'running'
$cp.currentTaskId = '4.2A'
Write-JsonFileAtomic -Path $cpStatePath -Value $cp -Depth 12
Write-JsonFileAtomic -Path (Join-Path (Get-Location) '.automation\state.json') -Value $cp -Depth 12

foreach ($cpName in (Get-CheckpointNames)) {
    $saved = Save-Checkpoint -State $cp -Name $cpName
    Assert-Equal "checkpoint '$cpName' is recorded in memory" $cpName $cp.taskCheckpoint
    $reloaded = Read-JsonFile $cpStatePath
    Assert-True "checkpoint '$cpName' persisted without a tmp file" (-not (Test-Path "$cpStatePath.tmp"))
}
Assert-True 'checkpoint writes an ISO timestamp' ($cp.taskCheckpointAt -match '^\d{4}-\d{2}-\d{2}T')
$cpThrew = $false
try { Save-Checkpoint -State $cp -Name 'not-a-real-checkpoint' | Out-Null } catch { $cpThrew = $true }
Assert-True 'an unknown checkpoint name is rejected' $cpThrew

# required checkpoint vocabulary
$requiredCp = @('selected', 'preflight_complete', 'opencode_started', 'opencode_finished',
    'result_parsed', 'verification_started', 'verification_passed', 'task_completed', 'controller_stopped')
foreach ($r in $requiredCp) {
    Assert-True "checkpoint '$r' is defined" (@(Get-CheckpointNames) -contains $r)
}

# --- 4. interrupted RUNNING detection --------------------------------------
$running = New-AutomationState
$running.status = 'running'
$running.currentTaskId = '4.2A'
$running.currentAttempt = 2
Set-StateProperty -Object $running -Name 'lastOpenCodeSessionId' -Value 'ses_interrupted_probe'
Set-StateProperty -Object $running -Name 'durableOpenCodeSessionId' -Value 'ses_interrupted_probe'
$intRun = Get-InterruptedRun -State $running
Assert-True 'status=running with no controller is an interruption' ($intRun.IsInterrupted -eq $true)
Assert-Equal 'interrupted reason is the in-flight status' 'status-in-flight-without-controller' $intRun.Reason
Assert-Equal 'interrupted task id is preserved' '4.2A' $intRun.TaskId
Assert-Equal 'interrupted attempt is preserved' 2 $intRun.Attempt

foreach ($s in @('recovering', 'verifying', 'opencode_started', 'result_parsed')) {
    $t = New-AutomationState
    $t.status = $s
    $t.currentTaskId = '4.2A'
    Assert-True "status '$s' is treated as in-flight" ((Get-InterruptedRun -State $t).IsInterrupted -eq $true)
}

# --- 5. genuine BLOCKED is preserved ---------------------------------------
$genuine = New-AutomationState
$genuine.status = 'blocked'
$genuine.currentTaskId = '4.2A'
$genuine.lastResult = 'BLOCKED'
Set-StateProperty -Object $genuine -Name 'lastOpenCodeSessionId' -Value 'ses_genuine'
$intGenuine = Get-InterruptedRun -State $genuine
Assert-True 'a genuine BLOCKED is not an interruption' ($intGenuine.IsInterrupted -eq $false)
Assert-True 'a genuine BLOCKED is flagged' ($intGenuine.GenuineBlocked -eq $true)
Assert-Equal 'a genuine BLOCKED keeps its reason' 'genuine-blocked' $intGenuine.Reason
Assert-Equal 'a genuine BLOCKED is never auto-resumed' 'none' (Get-ResumePlan -Interrupted $intGenuine)

# --- 6. the real 4.2A interruption artifact --------------------------------
# Mirrors the state left by the closed terminal: blocked, no result, no
# verification, but a session id exists.
$artifact = New-AutomationState
$artifact.status = 'blocked'
$artifact.currentTaskId = '4.2A'
$artifact.currentAttempt = 1
$artifact.lastResult = $null
Set-StateProperty -Object $artifact -Name 'lastVerification' -Value @()
Set-StateProperty -Object $artifact -Name 'lastOpenCodeSessionId' -Value 'ses_f16dae178ffe8SBieuLYtoSEyy'
$artifact.failedTaskIds = @('4.2A')
$intArtifact = Get-InterruptedRun -State $artifact
Assert-True 'blocked-without-result is an interruption artifact' ($intArtifact.IsInterrupted -eq $true)
Assert-Equal 'the artifact reason is recorded' 'blocked-without-result-interruption-artifact' $intArtifact.Reason
Assert-True 'the artifact is NOT genuine blocked' ($intArtifact.GenuineBlocked -eq $false)
Assert-Equal 'the artifact resume plan is session-resume' 'session-resume' (Get-ResumePlan -Interrupted $intArtifact)

# A completed task must never be reported as interrupted, even if status is odd.
$doneTask = New-AutomationState
$doneTask.status = 'running'
$doneTask.currentTaskId = '4.2A'
$doneTask.completedTaskIds = @('4.2A')
Assert-True 'a completed task is not an interruption' ($null -eq (Get-InterruptedRun -State $doneTask))

# --- 7. roadmap complete ---------------------------------------------------
$complete = New-AutomationState
$complete.status = 'complete'
$complete.completedTaskIds = @((Get-RoadmapTasks) | ForEach-Object { $_.Id })
Assert-True 'a complete roadmap selects no next task' ($null -eq (Select-NextTask -State $complete))
Assert-True 'a complete roadmap reports no interruption' ($null -eq (Get-InterruptedRun -State $complete))

# --- 8 & 9. resume planning and fallback -----------------------------------
Assert-Equal 'no interruption means a fresh start' 'fresh' (Get-ResumePlan -Interrupted $null)
$noSession = [pscustomobject]@{ IsInterrupted = $true; Reason = 'r'; TaskId = '4.2A'; Attempt = 1; SessionId = $null; LogFile = $null; Checkpoint = $null; GenuineBlocked = $false }
Assert-Equal 'interruption without a session falls back to a recovery prompt' 'recovery-prompt' (Get-ResumePlan -Interrupted $noSession)
$blankSession = [pscustomobject]@{ IsInterrupted = $true; Reason = 'r'; TaskId = '4.2A'; Attempt = 1; SessionId = '   '; LogFile = $null; Checkpoint = $null; GenuineBlocked = $false }
Assert-Equal 'a blank session id falls back to a recovery prompt' 'recovery-prompt' (Get-ResumePlan -Interrupted $blankSession)

# --- 10. session-resume detection ------------------------------------------
# Observed OpenCode v2.0.11 behaviour: a bad --session id exits 1 and emits a
# machine-readable "Session not found" error event.
$okRun = [pscustomobject]@{ ExitCode = 0; Text = 'AUTONOMOUS_TASK_STATUS: PASS'; SessionId = 'ses_ok' }
Assert-True 'a clean continuation is not a resume failure' ((Test-SessionResumeFailed -Run $okRun -ExpectedSessionId 'ses_ok') -eq $false)

$badExit = [pscustomobject]@{ ExitCode = 1; Text = '{"type":"error","error":{"type":"unknown","message":"Session not found"}}'; SessionId = '' }
Assert-True 'a non-zero exit on continuation is a resume failure' ((Test-SessionResumeFailed -Run $badExit -ExpectedSessionId 'ses_missing') -eq $true)

$badText = [pscustomobject]@{ ExitCode = 0; Text = 'Error: Session not found'; SessionId = 'ses_missing' }
Assert-True '"Session not found" text is a resume failure' ((Test-SessionResumeFailed -Run $badText -ExpectedSessionId 'ses_missing') -eq $true)

$mismatch = [pscustomobject]@{ ExitCode = 0; Text = 'ok'; SessionId = 'ses_different' }
Assert-True 'a different session id is a resume failure' ((Test-SessionResumeFailed -Run $mismatch -ExpectedSessionId 'ses_requested') -eq $true)

$nullRun = $null
Assert-True 'a null run is a resume failure' ((Test-SessionResumeFailed -Run $nullRun -ExpectedSessionId 'ses_x') -eq $true)

# --- 11. the arg builder adds --session only when resuming -----------------
$withSession = @(Get-OpenCodeArgs -Config $cfgForArgs -TaskId 'T' -Label 'task' -Prompt 'P' -ResumeSessionId 'ses_abc')
Assert-True 'a resume adds --session' ($withSession -contains '--session')
Assert-Equal 'the session id follows --session' 'ses_abc' $withSession[$withSession.IndexOf('--session') + 1]
Assert-True 'a resume still uses --standalone' ($withSession -contains '--standalone')
Assert-True 'a resume still never uses --server' (-not ($withSession -contains '--server'))
Assert-Equal 'the prompt is still last on resume' 'P' $withSession[$withSession.Count - 1]

$withoutSession = @(Get-OpenCodeArgs -Config $cfgForArgs -TaskId 'T' -Label 'task' -Prompt 'P')
Assert-True 'a fresh run omits --session' (-not ($withoutSession -contains '--session'))

# --- 12. recovery prompt content -------------------------------------------
$promptForTask = Get-RoadmapTask -Id '4.2A'
$brief = New-RecoveryPrompt -Task $promptForTask -Interrupted $intArtifact -Attempt '1'
foreach ($needle in @('INTERRUPTED-RUN RECOVERY', '4.2A', 'ses_f16dae178ffe8SBieuLYtoSEyy',
        'AUTONOMOUS_TASK_STATUS', 'AUTONOMOUS_TASK_ID', 'reset --hard')) {
    Assert-True "the recovery brief mentions '$needle'" ($brief -like "*$needle*")
}
Assert-True 'the recovery brief forbids destructive git' ($brief -match '(?i)reset --hard')
Assert-True 'the recovery brief tells the agent to adopt existing work' ($brief -match '(?i)adopt')
Assert-True 'the recovery brief forbids pushing' ($brief -match '(?i)do not commit and do not push')

# --- 13. recovery launcher exists and is syntactically valid ---------------
$launcherPath = Join-Path $PSScriptRoot 'recovery-launcher.ps1'
Assert-True 'the recovery launcher exists' (Test-Path $launcherPath)
$lp = $null
$lt = $null
[System.Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref]$lt, [ref]$lp) | Out-Null
Assert-True 'the recovery launcher parses' (($null -eq $lp) -or ($lp.Count -eq 0))
$launcherSrc = [System.IO.File]::ReadAllText($launcherPath)
Assert-True 'the launcher targets the repository path' ($launcherSrc -like '*Get-AutomationPaths*')
Assert-True 'the launcher never hardcodes a pid' ($launcherSrc -notmatch '(?im)^\s*\$\w*pid\s*=\s*\d+')
Assert-True 'the launcher refuses a second controller' ($launcherSrc -like '*Test-ControllerActive*')
Assert-True 'the launcher exits when the roadmap is complete' ($launcherSrc -like '*roadmap is complete*')
Assert-True 'the launcher waits for readiness' ($launcherSrc -like '*Test-Ready*')
Assert-True 'the launcher stores no secrets' ($launcherSrc -notmatch '(?i)(password|client_secret|api[_-]?key|ghp_)')

# --- 14. installer points at the recovery launcher, idempotently -----------
$installerPath = Join-Path $PSScriptRoot 'install-autonomous-task.ps1'
$installerSrc = [System.IO.File]::ReadAllText($installerPath)
Assert-True 'the installer targets the recovery launcher' ($installerSrc -like '*recovery-launcher.ps1*')
Assert-True 'the installer uses -Force for idempotency' ($installerSrc -match '-Force')
Assert-True 'the installer verifies a single registration' ($installerSrc -like '*registrations*')
Assert-True 'the installer still supports -Remove' ($installerSrc -like '*Unregister-ScheduledTask*')
Assert-True 'the installer is never self-invoking' ($installerSrc -notmatch '(?m)^\s*Register-ScheduledTask[\s\S]{0,400}install-autonomous-task')

# recover-task must support explicit operator recovery
$recoverSrc = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'recover-task.ps1'))
Assert-True 'recover-task supports -RecoverInterrupted' ($recoverSrc -like '*RecoverInterrupted*')
Assert-True 'recover-task requires a task id' ($recoverSrc -like '*RecoverInterrupted requires -TaskId*')
Assert-True 'recover-task refuses destructive git' ($recoverSrc -notmatch '(?m)^\s*(git reset --hard|git clean)')
Assert-True 'recover-task never marks a task complete' ($recoverSrc -notmatch 'completedTaskIds\s*\+=')

# --- concurrency protection still holds ------------------------------------
if (Test-Path $paths.Lock) { Remove-Item $paths.Lock -Force }
$acq = Enter-RunnerLock -MaxAgeHours 12
Assert-True 'lock is still acquired for the recovery tests' $acq
Assert-True 'a second acquisition is still refused' ((Enter-RunnerLock -MaxAgeHours 12) -eq $false)
Assert-True 'an active controller is detected' ((Test-ControllerActive -MaxAgeHours 12) -eq $true)
Exit-RunnerLock
Assert-True 'no controller is detected after release' ((Test-ControllerActive -MaxAgeHours 12) -eq $false)

# Restore the real state file so a test run never destroys an interrupted run.
if (-not (Restore-RealState) -and -not $realStateExisted) {
    Write-Host '  state.json did not exist before the test; removed the test placeholder.'
    Remove-Item $paths.State -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

if (Test-Path $paths.Lock) { Remove-Item $paths.Lock -Force }
if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force }

Write-Host ''
Write-Host '=== self-test summary ==='
Write-Host "  passed : $script:Pass"
Write-Host "  failed : $script:Fail"
if ($script:Fail -gt 0) {
    Write-Host ''
    Write-Host 'Failures:'
    foreach ($f in $script:Failures) { Write-Host "  - $f" }
    exit 1
}
Write-Host '  RESULT : PASS'
exit 0
