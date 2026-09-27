@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Auto Social Minh Dien

set "LOG=%TEMP%\auto-social-launch.log"
echo [%date% %time%] Launch Auto Social > "%LOG%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [LOI] May chua co Node.js 24.
  echo Hay cai Node.js 24 x64 roi bam lai file nay.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%A"
if not "%NODE_MAJOR%"=="24" (
  echo.
  echo [LOI] Can Node.js 24. Node hien tai:
  node -v
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Lan dau chay: dang cai thu vien...
  call npm.cmd install >> "%LOG%" 2>&1
  if errorlevel 1 goto :install_fail

  if not exist "node_modules\electron\dist\electron.exe" (
    echo Dang kich hoat bo cai Electron...
    call npm.cmd install-scripts approve electron electron-winstaller >> "%LOG%" 2>&1
    call npm.cmd rebuild electron >> "%LOG%" 2>&1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [LOI] Electron chua duoc cai day du.
  echo Xem log: %LOG%
  pause
  exit /b 1
)

echo Dang chuan bi ung dung...
call npm.cmd run build:ts >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo [LOI] Khong build duoc ung dung.
  echo Xem log: %LOG%
  pause
  exit /b 1
)

if not exist "dist\main.js" (
  echo.
  echo [LOI] Thieu dist\main.js sau khi build.
  echo Xem log: %LOG%
  pause
  exit /b 1
)

echo Dang mo Auto Social...
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" . --show
if errorlevel 1 (
  echo.
  echo [LOI] Khong mo duoc Auto Social.
  echo Xem log: %LOG%
  pause
  exit /b 1
)

rem Cho tien trinh Electron khoi dong roi dong cua so BAT.
timeout /t 2 /nobreak >nul
exit /b 0

:install_fail
echo.
echo [LOI] Cai thu vien that bai.
echo Xem log: %LOG%
pause
exit /b 1
