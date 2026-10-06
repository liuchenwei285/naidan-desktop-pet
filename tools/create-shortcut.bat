@echo off
setlocal
rem 双击本文件即可在桌面创建“奶蛋”快捷方式
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1" %*
if errorlevel 1 (
  echo.
  echo 创建失败。请先用 npm run dist:win 打包,或把 exe 路径作为参数传入。
)
echo.
pause
