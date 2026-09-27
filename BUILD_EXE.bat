@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo AUTO SOCIAL MINH DIEN - BUILD .EXE
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua co Node.js 24.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
if not "%NODE_MAJOR%"=="24" (
  echo [LOI] Can Node.js 24 de build ban nay.
  echo Node hien tai:
  node -v
  pause
  exit /b 1
)

call npm install
if errorlevel 1 goto :fail
call npm test
if errorlevel 1 goto :fail
call npm run build
if errorlevel 1 goto :fail

echo.
echo XONG. Kiem tra file cai dat trong thu muc release\
pause
exit /b 0

:fail
echo BUILD THAT BAI.
pause
exit /b 1
