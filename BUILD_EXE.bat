@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo AUTO SOCIAL MINH DIEN - BUILD .EXE
echo ========================================
call npm install
if errorlevel 1 goto :fail
call npm run build
if errorlevel 1 goto :fail
echo.
echo XONG. Kiem tra file cai dat trong thu muc dist\
pause
exit /b 0
:fail
echo BUILD THAT BAI.
pause
exit /b 1
