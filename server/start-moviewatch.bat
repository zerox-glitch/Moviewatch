@echo off
title Moviewatch media server
cd /d "%~dp0"

rem ---- 1) Prefer the "py" launcher: it always points at a real Python 3 ----
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 moviewatch.py
  goto done
)

rem ---- 2) Fall back to "python", but reject the Microsoft Store placeholder ----
where python >nul 2>nul
if %errorlevel%==0 (
  python --version >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  The "python" found on this PC is the Microsoft Store placeholder,
    echo  not a real Python.
    echo.
    echo  Fix: install Python from https://www.python.org/downloads/
    echo  and tick "Add python.exe to PATH" on the first installer screen.
    echo.
    pause
    goto done
  )
  python moviewatch.py
  goto done
)

rem ---- 3) No Python at all ----
echo.
echo  Python was not found on this PC.
echo.
echo  1. Install it from https://www.python.org/downloads/
echo  2. IMPORTANT: on the first installer screen, tick
echo     "Add python.exe to PATH"
echo  3. Run this file again.
echo.
pause

:done
echo.
pause
