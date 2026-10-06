# ============================================================================
#  在桌面创建「奶蛋」快捷方式
#    - 已打包 -> 指向 dist 里的 exe
#    - 未打包 -> 自动回退到「开发模式」:指向 Electron 运行时 + 项目目录
#
#  用法(任选):
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\create-shortcut.ps1
#    powershell ... -File tools\create-shortcut.ps1 -ExePath "D:\apps\naidan.exe"
#    powershell ... -File tools\create-shortcut.ps1 -Dev
#    powershell ... -File tools\create-shortcut.ps1 -Uninstall
# ============================================================================
param(
  [string]$ExePath = "",
  [string]$ShortcutName = "",
  [switch]$Dev,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ---- 1. 应用名(可在 config.js 里改) ----
$AppName = "奶蛋"
$cfg = Join-Path $ProjectRoot "src\renderer\js\config.js"
if (Test-Path $cfg) {
  $txt = Get-Content -Raw -Encoding UTF8 $cfg
  if ($txt -match "name:\s*'([^']+)'") { $AppName = $Matches[1] }
}
if ([string]::IsNullOrWhiteSpace($ShortcutName)) { $ShortcutName = $AppName }

$Desktop = [Environment]::GetFolderPath("Desktop")
$LnkPath = Join-Path $Desktop ($ShortcutName + ".lnk")

# ---- 2. 卸载 ----
if ($Uninstall) {
  if (Test-Path $LnkPath) { Remove-Item -LiteralPath $LnkPath -Force; Write-Host "已删除: $LnkPath" }
  else { Write-Host "桌面上没有这个快捷方式。" }
  exit 0
}

# ---- 3. 找一个可执行文件 ----
$iconPath = Join-Path $ProjectRoot "build\icon.ico"
$target = $null
$argLine = ""
$workDir = $null
$mode = ""

$packaged = $null
if ((-not [string]::IsNullOrWhiteSpace($ExePath)) -and (Test-Path $ExePath)) {
  $packaged = (Resolve-Path $ExePath).Path
} elseif (-not $Dev) {
  $cands = @()
  $cands += Join-Path $ProjectRoot "dist\win-unpacked\$AppName.exe"
  $cands += Join-Path $ProjectRoot "dist\$AppName.exe"
  $distDir = Join-Path $ProjectRoot "dist"
  if (Test-Path $distDir) {
    $cands += (Get-ChildItem -Path $distDir -Filter "*.exe" -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -notmatch "Setup|uninstall" } | Select-Object -ExpandProperty FullName)
  }
  $cands += (Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs") -Recurse -Filter "$AppName.exe" -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty FullName)
  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { $packaged = (Resolve-Path $p).Path; break } }
}

if ($packaged) {
  $target = $packaged
  $workDir = Split-Path -Parent $target
  $mode = "packaged-exe"
} else {
  $elec = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
  if (-not (Test-Path $elec)) {
    Write-Host "找不到可执行文件,也没装 Electron 运行时。" -ForegroundColor Red
    Write-Host "请先在项目目录执行:  npm install" -ForegroundColor Yellow
    exit 1
  }
  $target = $elec
  $argLine = '"' + $ProjectRoot + '"'
  $workDir = $ProjectRoot
  $mode = "dev-electron"
}

# ---- 4. 写快捷方式 ----
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($LnkPath)
$sc.TargetPath = $target
if ($argLine -ne "") { $sc.Arguments = $argLine }
$sc.WorkingDirectory = $workDir
$sc.Description = $AppName + " - desktop pet"
$sc.WindowStyle = 1
$sc.IconLocation = "$iconPath,0"
$sc.Save()

Write-Host ""
Write-Host "[OK] desktop shortcut created" -ForegroundColor Green
Write-Host "  lnk   : $LnkPath"
Write-Host "  mode  : $mode"
Write-Host "  target: $target"
if ($argLine -ne "") { Write-Host "  args  : $argLine" }
Write-Host "  icon  : $iconPath"