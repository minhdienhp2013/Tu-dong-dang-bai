@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo AUTO SOCIAL MINH DIEN - CAI DAT VA CHAY
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua co Node.js.
  echo Hay cai Node.js 24 LTS x64 roi chay lai.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
echo Node.js hien tai:
node -v

if not "%NODE_MAJOR%"=="24" (
  echo.
  echo [LOI] Du an nay duoc build/test voi Node.js 24.
  echo May dang dung Node.js %NODE_MAJOR%.x.
  echo Hay cai/chuyen sang Node.js 24 roi chay lai.
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
  echo Neu truoc do da cai bang Node 22/23/24 cu, hay dong Node/Electron,
  echo xoa thu muc node_modules va file package-lock.json roi chay lai.
  pause
  exit /b 1
)

echo Dang mo ung dung...
call npm run dev
pause
