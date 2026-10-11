<#
.SYNOPSIS
    run_odia_agents.ps1 -- 9-Hour Work Session & 18-Hour Cycle Supervisor for Utkal.ai Odia Data Agents.

.DESCRIPTION
    Manages continuous data collection passes during a 9-hour work window.
    Executes the existing Python CLI in safe preview mode (zero-cost, no vector-store modifications).
    Prevents concurrent runs via PID locking, enforces timeouts, terminates child processes cleanly,
    and logs comprehensive structured metrics to logs/odia_agents.log.

.PARAMETER SessionHours
    Duration of the active work window (default: 9.0 hours).

.PARAMETER IntervalMinutes
    Delay between consecutive pipeline passes (default: 15.0 minutes).

.PARAMETER CycleHours
    Total cycle duration from session start to next session start (default: 18.0 hours).

.PARAMETER Continuous
    If specified, supervisor sleeps during the 9-hour idle gap and automatically repeats cycles.
    If omitted, runs a single 9-hour session and exits, letting Windows Task Scheduler handle trigger.

.PARAMETER PythonPath
    Optional explicit path to the Python executable. If omitted, automatically resolves Python.

.PARAMETER PassTimeoutMinutes
    Maximum execution time allowed for a single pipeline pass before terminating child process (default: 30 minutes).

.PARAMETER BufferMinutes
    Minimum time required before session deadline to start a new pass (default: 5.0 minutes).
#>

[CmdletBinding()]
param(
    [double]$SessionHours = 9.0,
    [double]$IntervalMinutes = 15.0,
    [double]$CycleHours = 18.0,
    [switch]$Continuous,
    [string]$PythonPath = "",
    [double]$PassTimeoutMinutes = 30.0,
    [double]$BufferMinutes = 5.0
)

$ErrorActionPreference = "Continue"

# -- Paths & Setup -------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = $ScriptDir
Set-Location -Path $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path -Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

$MainLogPath = Join-Path $LogsDir "odia_agents.log"
$LockFilePath = Join-Path $LogsDir "odia_agents.lock"
$ReportPath = Join-Path $ProjectRoot "data\odia_agent_output\report.json"
$FailedLogPath = Join-Path $ProjectRoot "data\odia_agent_output\failed_or_skipped.jsonl"

# -- Log Helper with Rotation --------------------------------------------------
function Rotate-LogFile([string]$path, [long]$maxSizeBytes = 10485760, [int]$maxBackups = 5) {
    if ((Test-Path -Path $path) -and ((Get-Item -Path $path).Length -gt $maxSizeBytes)) {
        for ($i = $maxBackups - 1; $i -ge 1; $i--) {
            $old = "$path.$i"
            $next = "$path." + ($i + 1)
            if (Test-Path -Path $old) {
                Move-Item -Path $old -Destination $next -Force -ErrorAction SilentlyContinue
            }
        }
        Move-Item -Path $path -Destination "$path.1" -Force -ErrorAction SilentlyContinue
    }
}

function Write-SupervisorLog {
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [hashtable]$Data = $null
    )
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$timestamp] [$Level] $Message"
    if ($Data) {
        $jsonDetails = ($Data | ConvertTo-Json -Compress)
        $logLine += " | Data: $jsonDetails"
    }

    # Console output
    switch ($Level) {
        "ERROR"   { Write-Host $logLine -ForegroundColor Red }
        "WARN"    { Write-Host $logLine -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logLine -ForegroundColor Green }
        default   { Write-Host $logLine -ForegroundColor Cyan }
    }

    # File output with rotation
    Rotate-LogFile -path $MainLogPath
    Add-Content -Path $MainLogPath -Value $logLine -Encoding UTF8 -ErrorAction SilentlyContinue
}

# -- Python Interpreter Resolution ---------------------------------------------
function Resolve-PythonInterpreter([string]$preferredPath) {
    if ($preferredPath -and (Test-Path -Path $preferredPath)) {
        return (Resolve-Path $preferredPath).Path
    }

    # Check active virtualenv / python
    try {
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) {
            return $cmd.Source
        }
    } catch {}

    # Check common standard locations
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python315\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:ProgramFiles\Python315\python.exe",
        "$env:ProgramFiles\Python312\python.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path -Path $c) {
            return $c
        }
    }

    return "python"
}

# -- Single-Instance Locking ---------------------------------------------------
function Acquire-SupervisorLock {
    if (Test-Path -Path $LockFilePath) {
        try {
            $lockContent = Get-Content -Path $LockFilePath -Raw | ConvertFrom-Json
            $existingPid = [int]$lockContent.pid
            $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
            if ($existingProc) {
                Write-SupervisorLog "Another supervisor instance is actively running (PID $existingPid). Exiting to prevent overlap." "WARN"
                return $false
            } else {
                Write-SupervisorLog "Detected stale lock file from previous process (PID $existingPid). Cleaning up and taking lock." "WARN"
                Remove-Item -Path $LockFilePath -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Remove-Item -Path $LockFilePath -Force -ErrorAction SilentlyContinue
        }
    }

    $lockObj = @{
        pid = $PID
        startTime = (Get-Date).ToString("o")
        host = $env:COMPUTERNAME
        user = $env:USERNAME
    }
    $lockObj | ConvertTo-Json | Set-Content -Path $LockFilePath -Encoding UTF8 -Force
    return $true
}

function Release-SupervisorLock {
    if (Test-Path -Path $LockFilePath) {
        try {
            $lockContent = Get-Content -Path $LockFilePath -Raw | ConvertFrom-Json
            if ($lockContent.pid -eq $PID) {
                Remove-Item -Path $LockFilePath -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Remove-Item -Path $LockFilePath -Force -ErrorAction SilentlyContinue
        }
    }
}

# -- Safe Process Termination --------------------------------------------------
function Stop-ProcessTree([int]$parentPid) {
    try {
        Write-SupervisorLog "Terminating process tree for PID $parentPid to avoid orphaned processes..." "WARN"
        Start-Process -FilePath "taskkill.exe" -ArgumentList "/PID $parentPid /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null
    } catch {
        Write-SupervisorLog "Error executing taskkill on PID $parentPid`: $_" "ERROR"
    }
}

# -- Single Pipeline Pass Execution --------------------------------------------
function Invoke-PipelinePass(
    [string]$pyExe,
    [string]$sessionId,
    [int]$passNumber,
    [double]$timeoutMinutes
) {
    $passStart = Get-Date
    Write-SupervisorLog "Starting Pass #$passNumber for Session $sessionId..." "INFO"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $pyExe
    $psi.Arguments = "-m agents.odia_data_agents.cli --preview"
    $psi.WorkingDirectory = $ProjectRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $stdoutBuilder = New-Object System.Text.StringBuilder
    $stderrBuilder = New-Object System.Text.StringBuilder

    $outHandler = {
        if ($EventArgs.Data) { $stdoutBuilder.AppendLine($EventArgs.Data) | Out-Null }
    }
    $errHandler = {
        if ($EventArgs.Data) { $stderrBuilder.AppendLine($EventArgs.Data) | Out-Null }
    }

    $outEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $outHandler
    $errEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $errHandler

    $procStarted = $false
    try {
        $procStarted = $proc.Start()
        $proc.BeginOutputReadLine()
        $proc.BeginErrorReadLine()
    } catch {
        Write-SupervisorLog "Failed to start pipeline process: $_" "ERROR"
        Unregister-Event -SourceIdentifier $outEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $errEvent.Name -ErrorAction SilentlyContinue
        return @{
            Success = $false
            ExitCode = -1
            DurationSec = 0
            Errors = "$_"
        }
    }

    $timeoutMs = [int]($timeoutMinutes * 60 * 1000)
    $exitedCleanly = $proc.WaitForExit($timeoutMs)

    if (-not $exitedCleanly) {
        Write-SupervisorLog "Pass #$passNumber exceeded timeout limit ($timeoutMinutes min). Enforcing termination..." "ERROR"
        Stop-ProcessTree -parentPid $proc.Id
        $proc.WaitForExit(5000)
    }

    Unregister-Event -SourceIdentifier $outEvent.Name -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier $errEvent.Name -ErrorAction SilentlyContinue

    $passEnd = Get-Date
    $durationSec = [math]::Round(($passEnd - $passStart).TotalSeconds, 2)
    $exitCode = if ($exitedCleanly) { $proc.ExitCode } else { -999 }

    # Parse report output if available
    $reportData = $null
    if (Test-Path -Path $ReportPath) {
        try {
            $reportData = Get-Content -Path $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {}
    }

    # Count skipped records
    $skippedCount = 0
    if (Test-Path -Path $FailedLogPath) {
        try {
            $lines = Get-Content -Path $FailedLogPath -ErrorAction SilentlyContinue
            if ($lines) { $skippedCount = $lines.Count }
        } catch {}
    }

    $passSummary = @{
        SessionId         = $sessionId
        PassNumber        = $passNumber
        StartTime         = $passStart.ToString("yyyy-MM-dd HH:mm:ss")
        FinishTime        = $passEnd.ToString("yyyy-MM-dd HH:mm:ss")
        DurationSeconds   = $durationSec
        ExitCode          = $exitCode
        TimedOut          = (-not $exitedCleanly)
        DiscoveredUrls    = $(if ($reportData -and $reportData.summary) { $reportData.summary.urls_discovered } else { 0 })
        AcceptedDocs      = $(if ($reportData -and $reportData.summary) { $reportData.summary.documents_accepted } else { 0 })
        GeneratedChunks   = $(if ($reportData -and $reportData.summary) { $reportData.summary.chunks_generated } else { 0 })
        RejectedRecords   = $skippedCount
        IndexingPerformed = $false
    }

    if ($exitCode -eq 0) {
        Write-SupervisorLog "Pass #$passNumber completed successfully ($durationSec s). Docs: $($passSummary.AcceptedDocs), Chunks: $($passSummary.GeneratedChunks)." "SUCCESS" -Data $passSummary
    } else {
        $errSnippet = ($stderrBuilder.ToString().Trim())
        if ($errSnippet.Length -gt 250) { $errSnippet = $errSnippet.Substring(0, 250) + "..." }
        $passSummary["ErrorSnippet"] = $errSnippet
        Write-SupervisorLog "Pass #$passNumber finished with error code $exitCode ($durationSec s): $errSnippet" "ERROR" -Data $passSummary
    }

    return @{
        Success     = ($exitCode -eq 0)
        ExitCode    = $exitCode
        DurationSec = $durationSec
        Summary     = $passSummary
    }
}

# -- Main 9-Hour Work Session Runner -------------------------------------------
function Execute-WorkSession(
    [string]$pyExe,
    [double]$maxSessionHours,
    [double]$intervalMins,
    [double]$cycleTotalHours
) {
    $sessionStart = Get-Date
    $sessionDeadline = $sessionStart.AddHours($maxSessionHours)
    $nextSessionStart = $sessionStart.AddHours($cycleTotalHours)
    $sessionId = "sess_" + $sessionStart.ToString("yyyyMMdd_HHmmss")

    Write-SupervisorLog "============================================================" "INFO"
    Write-SupervisorLog "STARTING 9-HOUR ODIA DATA COLLECTION SESSION: $sessionId" "INFO"
    Write-SupervisorLog "Session Start:    $($sessionStart.ToString('yyyy-MM-dd HH:mm:ss'))" "INFO"
    Write-SupervisorLog "Session Deadline: $($sessionDeadline.ToString('yyyy-MM-dd HH:mm:ss')) ($maxSessionHours hours work window)" "INFO"
    Write-SupervisorLog "Pass Interval:    $intervalMins minutes" "INFO"
    Write-SupervisorLog "Next Cycle Start: $($nextSessionStart.ToString('yyyy-MM-dd HH:mm:ss')) ($cycleTotalHours hours from session start)" "INFO"
    Write-SupervisorLog "Python Binary:    $pyExe" "INFO"
    Write-SupervisorLog "============================================================" "INFO"

    $passNumber = 1
    $totalAcceptedDocs = 0
    $totalChunks = 0

    while ($true) {
        $now = Get-Date
        $remainingMinutes = ($sessionDeadline - $now).TotalMinutes

        if ($remainingMinutes -le $BufferMinutes) {
            Write-SupervisorLog "Session deadline reached ($([math]::Round($remainingMinutes, 1)) min left <= buffer of $BufferMinutes min). Stopping session cleanly." "INFO"
            break
        }

        Write-SupervisorLog "Session progress: $([math]::Round(($now - $sessionStart).TotalMinutes, 1))m elapsed, $([math]::Round($remainingMinutes, 1))m remaining." "INFO"

        # Run pipeline pass
        $passResult = Invoke-PipelinePass -pyExe $pyExe -sessionId $sessionId -passNumber $passNumber -timeoutMinutes $PassTimeoutMinutes

        if ($passResult.Summary) {
            $totalAcceptedDocs = [math]::Max($totalAcceptedDocs, [int]$passResult.Summary.AcceptedDocs)
            $totalChunks = [math]::Max($totalChunks, [int]$passResult.Summary.GeneratedChunks)
        }

        $passNumber++

        # Check if another pass can fit before deadline
        $checkNow = Get-Date
        $timeLeft = ($sessionDeadline - $checkNow).TotalMinutes
        if ($timeLeft -le ($intervalMins + $BufferMinutes)) {
            Write-SupervisorLog "Insufficient time for another pass and interval before deadline ($([math]::Round($timeLeft, 1)) min remaining). Ending work session." "INFO"
            break
        }

        Write-SupervisorLog "Waiting $intervalMins minutes before next pass..." "INFO"
        Start-Sleep -Seconds ([int]($intervalMins * 60))
    }

    $sessionEnd = Get-Date
    $sessionDurationHours = [math]::Round(($sessionEnd - $sessionStart).TotalHours, 2)

    $sessionReport = @{
        SessionId          = $sessionId
        TotalPasses        = ($passNumber - 1)
        SessionStart       = $sessionStart.ToString("yyyy-MM-dd HH:mm:ss")
        SessionEnd         = $sessionEnd.ToString("yyyy-MM-dd HH:mm:ss")
        DurationHours      = $sessionDurationHours
        TotalAcceptedDocs  = $totalAcceptedDocs
        TotalChunks        = $totalChunks
        NextScheduledStart = $nextSessionStart.ToString("yyyy-MM-dd HH:mm:ss")
    }

    Write-SupervisorLog "============================================================" "SUCCESS"
    Write-SupervisorLog "COMPLETED WORK SESSION: $sessionId" "SUCCESS" -Data $sessionReport
    Write-SupervisorLog "Total Passes Run:  $($passNumber - 1)" "SUCCESS"
    Write-SupervisorLog "Total Documents:   $totalAcceptedDocs" "SUCCESS"
    Write-SupervisorLog "Total Chunks:      $totalChunks" "SUCCESS"
    Write-SupervisorLog "Next Cycle Begins: $($nextSessionStart.ToString('yyyy-MM-dd HH:mm:ss'))" "SUCCESS"
    Write-SupervisorLog "============================================================" "SUCCESS"

    return @{
        SessionId        = $sessionId
        NextSessionStart = $nextSessionStart
    }
}

# -- Entry Point & Lifecycle ---------------------------------------------------
if (-not (Acquire-SupervisorLock)) {
    exit 1
}

try {
    $pythonExecutable = Resolve-PythonInterpreter $PythonPath
    Write-SupervisorLog "Resolved Python interpreter: $pythonExecutable" "INFO"

    # Verify python can import the package
    $verifyCheck = & $pythonExecutable -c "import agents.odia_data_agents; print('OK')" 2>&1
    if ($verifyCheck -notmatch "OK") {
        Write-SupervisorLog "Python environment check failed: $verifyCheck" "ERROR"
        exit 2
    }

    if ($Continuous) {
        Write-SupervisorLog "Supervisor running in CONTINUOUS DAEMON MODE (9h work / 9h sleep cycle)." "INFO"
        while ($true) {
            $sessResult = Execute-WorkSession -pyExe $pythonExecutable -maxSessionHours $SessionHours -intervalMins $IntervalMinutes -cycleTotalHours $CycleHours
            $nextStart = $sessResult.NextSessionStart
            $idleSeconds = [math]::Max(0, [int](($nextStart - (Get-Date)).TotalSeconds))

            Write-SupervisorLog "Idle phase: Sleeping for $([math]::Round($idleSeconds / 3600, 2)) hours until next session at $($nextStart.ToString('yyyy-MM-dd HH:mm:ss'))..." "INFO"
            Start-Sleep -Seconds $idleSeconds
        }
    } else {
        # Single 9-hour work session mode (ideal for Windows Task Scheduler)
        $null = Execute-WorkSession -pyExe $pythonExecutable -maxSessionHours $SessionHours -intervalMins $IntervalMinutes -cycleTotalHours $CycleHours
        exit 0
    }

} catch {
    Write-SupervisorLog "Fatal supervisor exception: $_" "ERROR"
    exit 3
} finally {
    Release-SupervisorLock
}
