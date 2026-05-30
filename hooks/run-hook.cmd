@echo off
REM Windows entry point for comet hooks
REM Usage: run-hook.cmd <hook-name>

setlocal enabledelayedexpansion

set HOOK_NAME=%1
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:\=/%

REM Auto-discover hook scripts; add new hooks by creating a matching .sh file
if exist "%SCRIPT_DIR%%HOOK_NAME%" (
    bash "%SCRIPT_DIR%%HOOK_NAME%"
) else (
    echo Unknown hook: %HOOK_NAME%
    exit /b 1
)

endlocal
