@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo AUTO SOCIAL MINH DIEN - CAI DAT VA CHAY
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua co Node.js.
  echo Hay cai Node.js 22 LTS x64 roi chay lai.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
echo Node.js hien tai:
node -v

if not "%NODE_MAJOR%"=="22" (
  echo.
  echo [LOI] Du an nay duoc build/test voi Node.js 22 LTS.
  echo May dang dung Node.js %NODE_MAJOR%.x nen better-sqlite3 co the phai tu bien dich va loi.
  echo.
  echo Cach sua:
  echo 1. Go Node.js hien tai neu dang la Node 24/23.
  echo 2. Cai Node.js 22 LTS x64.
  echo 3. Mo lai cua so CMD/PowerShell.
  echo 4. Kiem tra: node -v  ^(phai la v22.x.x^)
  echo 5. Chay lai SETUP_AND_RUN.bat
  echo.
  pause
  exit /b 1
)

where chrome >nul 2>nul
if errorlevel 1 (
  echo [NHAC] Neu Chrome da cai nhung lenh chrome khong nam trong PATH thi Playwright van co the mo qua channel Chrome.
)

echo Dang cai thu vien...
call npm install
if errorlevel 1 (
  echo.
  echo [LOI] npm install that bai.
  echo Neu vua doi tu Node 24 ve Node 22, hay dong cac cua so Node/Electron,
  echo xoa thu muc node_modules va file package-lock.json roi chay lai.
  pause
  exit /b 1
)

echo Dang mo ung dung...
call npm run dev
pause
