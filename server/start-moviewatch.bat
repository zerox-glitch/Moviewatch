@echo off
title Moviewatch media server
cd /d "%~dp0"
echo ==============================================================
echo   MOVIEWATCH - starting. This window IS the server.
echo   Keep it open during the movie. Errors will stay visible.
echo ==============================================================

rem --- 1) "py" launcher (comes with python.org installs) ---
where py >nul 2>nul
if not errorlevel 1 (py -3 moviewatch.py & goto done)

rem --- 2) plain "python" (python.org or Microsoft Store) ---
where python >nul 2>nul
if not errorlevel 1 (
  python --version >nul 2>nul
  if not errorlevel 1 (python moviewatch.py & goto done)
)

rem --- 3) "python3" alias ---
where python3 >nul 2>nul
if not errorlevel 1 (
  python3 --version >nul 2>nul
  if not errorlevel 1 (python3 moviewatch.py & goto done)
)

rem --- 4) Microsoft Store Python with aliases turned off: scan WindowsApps ---
set "EXE="
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.*") do (
  if exist "%%D\python.exe" set "EXE=%%D\python.exe"
)
if defined EXE (
  echo   Using your Microsoft Store Python:
  echo   %EXE%
  echo.
  "%EXE%" moviewatch.py
  goto done
)

rem --- 5) nothing found ---
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

:done
echo.
echo   (server stopped - you can close this window)
pause
