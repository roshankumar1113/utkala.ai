<#
.SYNOPSIS
    setup_odia_agents_task.ps1 -- Windows Task Scheduler Manager for Utkal.ai Odia Data Agents.

.DESCRIPTION
    Registers, updates, starts, stops, or inspects the Windows Task Scheduler task
    "Utkal Odia Data Agents".
    Configures an exact 18-hour repetition cycle (9 hours work, 9 hours idle).
    Protects against duplicate registrations and avoids hardcoding passwords or secrets.

.PARAMETER Action
    Action to perform: 'Register', 'Unregister', 'Start', 'Stop', 'Status' (default: 'Register').

.PARAMETER StartTime
    Daily start time for the first session, in 24-hour format HH:mm (default: '06:00').

.PARAMETER TaskName
    Name of the Task Scheduler task (default: 'Utkal Odia Data Agents').
#>

[CmdletBinding()]
param(
    [ValidateSet("Register", "Create", "Unregister", "Remove", "Start", "Stop", "Status")]
    [string]$Action = "Register",

    [string]$StartTime = "06:00",

    [string]$TaskName = "Utkal Odia Data Agents"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = $ScriptDir
$BatPath = Join-Path $ProjectRoot "run_odia_agents.bat"

if (-not (Test-Path -Path $BatPath)) {
    Write-Error "Launcher batch file not found at: $BatPath"
    exit 1
}

# -- 1. Status Check -----------------------------------------------------------
function Get-TaskInfo {
    try {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
            Write-Host "`n============================================================" -ForegroundColor Cyan
            Write-Host "TASK SCHEDULER STATUS: '$TaskName'" -ForegroundColor Cyan
            Write-Host "============================================================" -ForegroundColor Cyan
            Write-Host "  State:             $($task.State)" -ForegroundColor Green
            Write-Host "  Next Run Time:     $($taskInfo.NextRunTime)" -ForegroundColor Yellow
            Write-Host "  Last Run Time:     $($taskInfo.LastRunTime)" -ForegroundColor Gray
            Write-Host "  Last Result:       $($taskInfo.LastTaskResult)" -ForegroundColor Gray
            Write-Host "  Number of Missed:  $($taskInfo.NumberOfMissedRuns)" -ForegroundColor Gray
            Write-Host "============================================================`n" -ForegroundColor Cyan
            return $task
        } else {
            Write-Host "Task '$TaskName' is NOT registered." -ForegroundColor Yellow
            return $null
        }
    } catch {
        Write-Host "Error retrieving status for '$TaskName': $_" -ForegroundColor Red
        return $null
    }
}

# -- 2. Unregister -------------------------------------------------------------
function Remove-TaskRegistration {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Unregistering task '$TaskName'..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' has been removed." -ForegroundColor Green
    } else {
        Write-Host "Task '$TaskName' was not found (nothing to remove)." -ForegroundColor Gray
    }
}

# -- 3. Start / Stop -----------------------------------------------------------
function Start-AgentTask {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Cannot start task '$TaskName': task is not registered. Run with -Action Register first." -ForegroundColor Red
        return
    }
    Write-Host "Triggering manual start of '$TaskName'..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Get-TaskInfo | Out-Null
}

function Stop-AgentTask {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Cannot stop task '$TaskName': task is not registered." -ForegroundColor Red
        return
    }
    Write-Host "Stopping task '$TaskName'..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 1
    Get-TaskInfo | Out-Null
}

# -- 4. Register / Create ------------------------------------------------------
function Register-AgentTask {
    # Parse start time
    $today = Get-Date
    try {
        $parsedTime = [datetime]::ParseExact($StartTime, "HH:mm", $null)
    } catch {
        try {
            $parsedTime = [datetime]::Parse($StartTime)
        } catch {
            Write-Error "Invalid StartTime format '$StartTime'. Use 24-hour 'HH:mm' (e.g., '06:00')."
            exit 1
        }
    }

    $initialStart = Get-Date -Hour $parsedTime.Hour -Minute $parsedTime.Minute -Second 0
    # If the configured time for today has already elapsed, start at the next 18h window or tomorrow
    if ($initialStart -lt $today) {
        # Advance by 18 hours increments until in the future
        while ($initialStart -lt $today) {
            $initialStart = $initialStart.AddHours(18)
        }
    }

    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "REGISTERING UTKAL.AI 18-HOUR SCHEDULED TASK" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Task Name:          $TaskName"
    Write-Host "  Script Launcher:    $BatPath"
    Write-Host "  Initial Start Time: $($initialStart.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Host "  Work Duration:      9 Hours (active supervisor window)"
    Write-Host "  Cycle Repetition:   Every 18 Hours (PT18H)"
    Write-Host "  Idle Gap:           Approximately 9 Hours between sessions"
    Write-Host "  Credentials:        Current User ($env:USERNAME) -- No passwords stored"
    Write-Host "============================================================" -ForegroundColor Cyan

    # Unregister any existing task with the same name to prevent duplicates
    Remove-TaskRegistration

    # Define Action: Launch .bat via cmd.exe
    $cmdArg = '/c "' + $BatPath + '"'
    $actionObj = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdArg -WorkingDirectory $ProjectRoot

    # Define Trigger: 18-hour repetition interval (PT18H) for 10 years
    $triggerParams = @{
        Once               = $true
        At                 = $initialStart
        RepetitionInterval = (New-TimeSpan -Hours 18)
        RepetitionDuration = (New-TimeSpan -Days 3650)
    }
    $triggerObj = New-ScheduledTaskTrigger @triggerParams

    # Define Settings:
    # MultipleInstances = IgnoreNew (prevent parallel instances if one is active)
    # AllowStartIfOnBatteries = True
    # StopIfGoingOnBatteries = False
    # ExecutionTimeLimit = 10 Hours (hard ceiling so hung task is killed before next 18h cycle)
    $settingsParams = @{
        MultipleInstances          = 'IgnoreNew'
        AllowStartIfOnBatteries    = $true
        DontStopIfGoingOnBatteries = $true
        ExecutionTimeLimit         = (New-TimeSpan -Hours 10)
        RestartCount               = 3
        RestartInterval            = (New-TimeSpan -Minutes 15)
    }
    $settingsObj = New-ScheduledTaskSettingsSet @settingsParams

    # Register Task using the current interactive user without prompting for password
    $principalObj = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

    $regParams = @{
        TaskName    = $TaskName
        Action      = $actionObj
        Trigger     = $triggerObj
        Settings    = $settingsObj
        Principal   = $principalObj
        Description = "Utkal.ai automatic Odia data collection pipeline running on an 18-hour cycle (9h work session, 9h idle gap)."
    }
    Register-ScheduledTask @regParams | Out-Null

    Write-Host "[OK] Task '$TaskName' registered successfully!" -ForegroundColor Green
    Get-TaskInfo | Out-Null
}

# -- Execute Request -----------------------------------------------------------
switch ($Action.ToLower()) {
    "register"   { Register-AgentTask }
    "create"     { Register-AgentTask }
    "unregister" { Remove-TaskRegistration }
    "remove"     { Remove-TaskRegistration }
    "start"      { Start-AgentTask }
    "stop"       { Stop-AgentTask }
    "status"     { Get-TaskInfo | Out-Null }
}
