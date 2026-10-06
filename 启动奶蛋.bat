@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  奶蛋 —— 开发模式启动(双击即可)
rem  打包之后请改用 dist\奶蛋-Portable-1.0.0.exe
rem ============================================================
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [x] 还没安装依赖,请先在本目录执行:  npm install
  echo.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
