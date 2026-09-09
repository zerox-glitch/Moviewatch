@echo off
title Moviewatch media server
cd /d "%~dp0"
echo ==============================================================
echo   MOVIEWATCH - starting. This window IS the server.
echo   Keep it open during the movie. Errors will stay visible.
echo ==============================================================

rem --- 1) The "py" launcher always points at a real Python 3 if present ---
where py >nul 2>nul
if not errorlevel 1 (py -3 moviewatch.py & goto done)

rem --- 2) Fall back to "python", but reject the Microsoft Store placeholder ---
where python >nul 2>nul
if errorlevel 1 goto nopython

python --version >nul 2>nul
if errorlevel 1 goto storepython

python moviewatch.py
goto done

:nopython
echo.
echo   Python was not found on this PC.
echo.
echo   1. Install it from:  https://www.python.org/downloads/
echo   2. IMPORTANT: on the very first installer screen, TICK
echo      "Add python.exe to PATH"
echo   3. Then run this file again.
echo.
pause
goto done

:storepython
echo.
echo   The "python" on this PC is the Microsoft Store PLACEHOLDER,
echo   not a real Python installation.
echo.
echo   Fix (2 minutes):
echo     a) Windows Settings, search "App execution aliases",
echo        turn OFF both "python" aliases
echo     b) Install real Python from https://www.python.org/downloads/
echo        (tick "Add python.exe to PATH")
echo     c) Run this file again.
echo.
pause
goto done

:done
echo.
echo   (server stopped - you can close this window)
pause
