@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo AUTO SOCIAL MINH DIEN - CAI DAT VA CHAY
echo ========================================
where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua co Node.js. Hay cai Node.js LTS truoc.
  pause
  exit /b 1
)
where chrome >nul 2>nul
if errorlevel 1 (
  echo [NHAC] Neu Chrome da cai nhung lenh chrome khong nam trong PATH thi van co the chay qua Playwright channel.
)
echo Dang cai thu vien...
call npm install
if errorlevel 1 (
  echo [LOI] npm install that bai.
  pause
  exit /b 1
)
echo Dang mo ung dung...
call npm run dev
pause
