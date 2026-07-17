@echo off
rem ---------------------------------------------------------------
rem  Gongmu AI Pack - join split parts into one zip
rem
rem  NOTE: This file is intentionally ASCII-only.
rem  cmd.exe reads a .bat with the console code page, which differs
rem  per PC (949 / 65001 / ...). Korean text here gets parsed as
rem  commands and the script breaks. Korean guidance lives in
rem  README / INSTALL_GUIDE_KO.md instead.
rem ---------------------------------------------------------------
chcp 65001 > nul
setlocal enabledelayedexpansion
title Gongmu AI Pack - Join Files
cd /d "%~dp0"

set "OUT=Gongmu_AI_Pack.zip"
set "EXPECT=9A2759AB5BD87FE45766842E369623A56B24758B03465D1F1296E0631CB13434"

echo.
echo ============================================================
echo   Gongmu AI Pack - Join split files
echo   (4개 조각 합치기)
echo ============================================================
echo.
echo   Joins the 4 downloaded parts back into one zip file.
echo   Uses built-in Windows commands only - no extra software.
echo.

rem ---- 1) check all 4 parts exist -----------------------------
set MISSING=0
for %%i in (000 001 002 003) do (
  if not exist "%OUT%.%%i" (
    echo   [MISSING] %OUT%.%%i
    set MISSING=1
  ) else (
    echo   [  OK   ] %OUT%.%%i
  )
)

if !MISSING!==1 (
  echo.
  echo   ------------------------------------------------------------
  echo    Some parts are not in this folder.
  echo    Put all 4 parts here, then run this file again.
  echo   ------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

rem ---- 2) remove previous output ------------------------------
if exist "%OUT%" (
  echo.
  echo   Removing previous %OUT% ...
  del /f /q "%OUT%"
)

rem ---- 3) join (built-in copy /b) -----------------------------
echo.
echo   Joining... this takes 2-5 minutes. Do not close this window.
copy /b "%OUT%.000" + "%OUT%.001" + "%OUT%.002" + "%OUT%.003" "%OUT%" > nul
if errorlevel 1 (
  echo.
  rem 괄호는 if 블록을 조기에 닫아 파싱을 깨뜨린다 - 블록 안에서는 쓰지 말 것
  echo   [FAILED] Join error. Check free disk space - about 13 GB needed.
  echo.
  pause
  exit /b 1
)
echo   Joined: %OUT%

rem ---- 4) verify integrity (SHA-256) --------------------------
echo.
echo   Verifying file integrity... this takes 1-3 minutes.
set "ACTUAL="
for /f "skip=1 tokens=* delims=" %%h in ('certutil -hashfile "%OUT%" SHA256') do (
  if not defined ACTUAL set "ACTUAL=%%h"
)
set "ACTUAL=%ACTUAL: =%"

echo.
if /i "%ACTUAL%"=="%EXPECT%" (
  echo   ============================================================
  echo     VERIFIED OK - the file is complete.
  echo   ============================================================
  echo.
  echo    Next steps:
  echo     1. Unzip %OUT%
  echo     2. Double-click START_INSTALL_GUI.bat in the unzipped folder
  echo.
  echo    You can delete the 4 part files now.
) else (
  echo   ============================================================
  echo     VERIFY FAILED - the file is not complete.
  echo   ============================================================
  echo.
  echo    One of the parts was probably downloaded incompletely.
  echo    Compare the 4 file sizes with the release page,
  echo    download the bad one again, then run this file again.
  echo.
  echo    Expected: %EXPECT%
  echo    Actual  : %ACTUAL%
)
echo.
pause
