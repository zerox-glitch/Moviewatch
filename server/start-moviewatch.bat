@echo off
title Moviewatch media server
cd /d "%~dp0"

rem Tries the Python launcher first, then plain python.
where py >nul 2>nul
if %errorlevel%==0 (
  py moviewatch.py
  goto done
)

where python >nul 2>nul
if %errorlevel%==0 (
  python moviewatch.py
  goto done
)

echo.
echo  Python was not found on this PC.
echo.
echo  1. Install it from https://www.python.org/downloads/
echo  2. IMPORTANT: on the first installer screen, tick
echo     "Add python.exe to PATH"
echo  3. Run this file again.
echo.
:done
echo.
pause
