@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: run_odia_agents.bat — Launcher for Utkal.ai Odia Data Agents Supervisor
:: Works seamlessly with Windows Task Scheduler, Command Prompt, and PowerShell
:: ============================================================================

:: Change directory to the root of this project
cd /d "%~dp0"

:: Invoke the PowerShell supervisor with ExecutionPolicy Bypass
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_odia_agents.ps1" %*
set SCRIPT_EXIT_CODE=%ERRORLEVEL%

:: Exit with the exact status code returned by PowerShell
exit /b %SCRIPT_EXIT_CODE%
