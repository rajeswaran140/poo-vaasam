@echo off
echo ========================================
echo   Starting Poo Vaasam Dev Server
echo   Tamil Content Platform
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Cleaning build cache...
echo Attempting to delete .next folder...

REM Try to delete .next folder
rd /s /q .next 2>nul
if exist .next (
    echo WARNING: Could not delete .next folder completely
    echo Some files may be locked by another process
    echo.
    echo Please try:
    echo   1. Close all Node.js processes in Task Manager
    echo   2. Run this script again
    echo   3. Or restart your computer
    echo.
    pause
    exit /b 1
)

echo Successfully cleaned .next folder
echo.

echo [2/3] Starting dev server...
echo This may take 30-60 seconds...
echo.

npm run dev

echo.
echo ========================================
echo   Server stopped
echo ========================================
pause
