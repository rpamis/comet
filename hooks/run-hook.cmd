@echo off
REM Windows entry point for comet hooks
REM Usage: run-hook.cmd <hook-name>

setlocal enabledelayedexpansion

set HOOK_NAME=%1
set SCRIPT_DIR=%~dp0

if "%HOOK_NAME%"=="session-start" (
    bash "%SCRIPT_DIR%session-start"
) else (
    echo Unknown hook: %HOOK_NAME%
    exit /b 1
)

endlocal
