$ErrorActionPreference = 'Stop'

$testBase = if ([string]::IsNullOrWhiteSpace($env:LIVEDOT_WINDOWS_TEST_ROOT)) { 'D:\LiveDotMap-Test' } else { $env:LIVEDOT_WINDOWS_TEST_ROOT }
$testRoot = Join-Path $testBase ('installer-ui-' + [Guid]::NewGuid().ToString('N'))
$project = Join-Path $testRoot 'project'
$productRoot = Join-Path $testRoot 'chosen-install-location'
$installedRoot = Join-Path $productRoot 'livedotmap/current'
$mapPath = Join-Path $project '.live-dot-map/map.json'
$proc = $null
$denyApplied = $false
$oldWorkspaceRoot = $env:LIVEDOT_SETUP_WORKSPACE_ROOT
$oldProductRoot = $env:LIVEDOT_SETUP_PRODUCT_ROOT
$oldSkipProduct = $env:LIVEDOT_SETUP_SKIP_PRODUCT
$oldSkipShortcut = $env:LIVEDOT_SETUP_SKIP_SHORTCUT
$oldShortcutRoot = $env:LIVEDOT_SETUP_SHORTCUT_ROOT
$oldLastProject = $env:LIVEDOT_SETUP_LAST_PROJECT_FILE
$oldRecentFile = $env:LIVEDOT_RECENT_PROJECTS_FILE

New-Item -ItemType Directory -Force -Path $project, $productRoot | Out-Null
if (Test-Path -LiteralPath (Join-Path $project '.live-dot-map')) { throw '隔离项目并非全新目录' }
if (Test-Path -LiteralPath $installedRoot) { throw '隔离安装目录并非全新目录' }

# Simulate the historical X\current layout with an incompatible payload. The
# installer may only migrate a recognisable product directory, then repair it
# into X\livedotmap\current; arbitrary folders named current are not claimed.
$oldCurrent = Join-Path $productRoot 'current'
New-Item -ItemType Directory -Force -Path (Join-Path $oldCurrent 'payload') | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $oldCurrent 'LiveDotMapSetup.exe') | Out-Null

# ProductRoot is an existing supported isolation hook. It represents the
# user-selected installation directory for this UI run.
$env:LIVEDOT_SETUP_PRODUCT_ROOT = $productRoot
$env:LIVEDOT_SETUP_SKIP_PRODUCT = '1'
$env:LIVEDOT_SETUP_SKIP_SHORTCUT = '0'
$env:LIVEDOT_SETUP_SHORTCUT_ROOT = Join-Path $testRoot 'shortcuts'
New-Item -ItemType Directory -Force -Path (Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'Desktop'), (Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'StartMenu') | Out-Null
$legacyCmd = Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'Desktop/活点地图本地桥.cmd'
$legacyLnk = Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'Desktop/活点地图本地桥.lnk'
$legacyTarget = Join-Path $productRoot 'livedotmap/current/livedot-bridge-win-x64.exe'
$legacyContent = '@echo off' + [Environment]::NewLine + '"' + $legacyTarget + '"' + [Environment]::NewLine
Set-Content -LiteralPath $legacyCmd -Value $legacyContent -Encoding UTF8
$shell = New-Object -ComObject WScript.Shell
$legacyLink = $shell.CreateShortcut($legacyLnk)
$legacyLink.TargetPath = $legacyTarget
$legacyLink.Save()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$installerOutput = if ([string]::IsNullOrWhiteSpace($env:LIVEDOT_WINDOWS_INSTALLER_OUTPUT)) { 'dist/windows-installer' } else { $env:LIVEDOT_WINDOWS_INSTALLER_OUTPUT }
$exe = (Resolve-Path (Join-Path $installerOutput 'LiveDotMapSetup.exe')).Path

function Get-Window($process) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.MainWindowHandle -ne 0) { return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle) }
  }
  throw '安装器窗口未出现'
}

function Get-Buttons($window) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
  return @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
}

function Invoke-Button($window, [string]$name) {
  foreach ($button in (Get-Buttons $window)) {
    if ($button.Current.Name -eq $name) {
      $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      return
    }
  }
  throw "未找到按钮: $name"
}

function Get-StatusText($window) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
  return @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) | ForEach-Object {
    try { $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { $_.Current.Name }
  }) -join "`n"
}

try {
  $proc = Start-Process -FilePath $exe -PassThru
  $window = Get-Window $proc
  $buttons = Get-Buttons $window
  $names = @($buttons | ForEach-Object { $_.Current.Name })
  foreach ($requiredButton in @('更改位置', '安装并打开画布')) {
    if ($names -notcontains $requiredButton) { throw ('未找到安装器按钮: ' + $requiredButton + ' / ' + ($names -join '|')) }
  }
  foreach ($forbiddenButton in @('选择项目文件夹', '安装并开始使用', '修复 / 更新', '卸载（保留地图）', '打开安装位置')) {
    if ($names -contains $forbiddenButton) { throw "安装首屏仍暴露维护功能: $forbiddenButton" }
  }

  Invoke-Button $window '安装并打开画布'
  $desktopShortcut = Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'Desktop/活点地图.lnk'
  $startShortcut = Join-Path $env:LIVEDOT_SETUP_SHORTCUT_ROOT 'StartMenu/活点地图.lnk'
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and (-not (Test-Path -LiteralPath (Join-Path $installedRoot 'payload/app.html')) -or -not (Test-Path -LiteralPath $desktopShortcut) -or -not (Test-Path -LiteralPath $startShortcut))) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path -LiteralPath (Join-Path $installedRoot 'payload/app.html'))) { throw '安装未在限定时间内完成' }
  if (Test-Path -LiteralPath $oldCurrent) { throw '旧版 current 没有迁移到 livedotmap 目录' }
  if (Test-Path -LiteralPath $mapPath) { throw '安装器不应在项目目录创建地图' }
  if (-not (Test-Path -LiteralPath $desktopShortcut) -or -not (Test-Path -LiteralPath $startShortcut)) {
    $shortcutListing = if (Test-Path -LiteralPath $env:LIVEDOT_SETUP_SHORTCUT_ROOT) { (Get-ChildItem -LiteralPath $env:LIVEDOT_SETUP_SHORTCUT_ROOT -Recurse -Force | Select-Object -ExpandProperty FullName) -join '|' } else { '(root missing)' }
    $editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $statusText = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition) | ForEach-Object {
      try { $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { $_.Current.Name }
    }) -join '|'
    throw "安装器没有创建规范的活点地图快捷方式: desktop=$desktopShortcut start=$startShortcut listing=$shortcutListing status=$statusText"
  }
  if ((Test-Path -LiteralPath $legacyCmd) -or (Test-Path -LiteralPath $legacyLnk)) { throw '安装器没有移除指向产品目录的旧版本地桥入口' }

  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500

  # Damage the installed copy. A second run must repair it automatically and
  # preserve the old copy instead of asking the user to delete current.
  Remove-Item -LiteralPath (Join-Path $installedRoot 'payload/app.html') -Force
  $proc = Start-Process -FilePath $exe -PassThru
  $window = Get-Window $proc
  Invoke-Button $window '安装并打开画布'
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath (Join-Path $installedRoot 'payload/app.html'))) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path -LiteralPath (Join-Path $installedRoot 'payload/app.html'))) { throw '损坏安装没有自动修复' }
  $previous = @(Get-ChildItem -LiteralPath (Join-Path $productRoot 'livedotmap') -Directory -Filter '.previous-*' -ErrorAction SilentlyContinue)
  if ($previous.Count -lt 1) { throw '自动修复没有保留旧版本备份' }
  if (Test-Path -LiteralPath $mapPath) { throw '自动修复不应接触项目目录' }

  # A completed install must open the product directly when the launcher runs
  # from the install directory (desktop/Start-Menu shortcut simulation): no
  # installer page, no maintenance buttons. The launcher is windowless: it
  # opens the canvas, remembers the workspace, and exits by itself (A1/A2).
  # Running the installer package again from dist/ must instead show the
  # installer UI again (the package installs, the shortcut opens).
  $env:LIVEDOT_SETUP_WORKSPACE_ROOT = Join-Path $testRoot 'workspace'
  $env:LIVEDOT_SETUP_LAST_PROJECT_FILE = Join-Path $testRoot 'last-project.txt'
  $env:LIVEDOT_RECENT_PROJECTS_FILE = Join-Path $testRoot 'recent-projects.json'
  # 无窗口入口不随安装器退出，先清理可能仍在运行的旧桥，避免误匹配。
  Get-CimInstance Win32_Process -Filter "Name = 'livedot-bridge-win-x64.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($env:LIVEDOT_SETUP_WORKSPACE_ROOT, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # 3a. 从安装包目录运行（重新运行安装包）→ 必须回到安装 UI（修复/更新页），不是直达。
  $proc = Start-Process -FilePath $exe -PassThru
  $window = Get-Window $proc
  $repairNames = @(Get-Buttons $window | ForEach-Object { $_.Current.Name })
  foreach ($forbiddenProduct in @('打开其他项目', '工作区')) {
    if ($repairNames -contains $forbiddenProduct) { throw "重新运行安装包却直达了产品: $forbiddenProduct" }
  }
  foreach ($requiredButton in @('安装并打开画布', '更改位置')) {
    if ($repairNames -notcontains $requiredButton) { throw ('重新运行安装包没有回到安装/修复页: ' + ($repairNames -join '|')) }
  }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  # 3b. 从安装目录运行（快捷方式语义）→ 无窗口直达产品。
  $installedExe = Join-Path $installedRoot 'LiveDotMapSetup.exe'
  if (-not (Test-Path -LiteralPath $installedExe)) { throw "安装目录缺少产品入口: $installedExe" }
  $proc = Start-Process -FilePath $installedExe -PassThru
  $scenarioBridge = $null
  $maxHandle = 0
  for ($i = 0; $i -lt 40 -and -not $scenarioBridge; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not $proc.HasExited) {
      $proc.Refresh()
      if ($proc.MainWindowHandle -ne 0) { $maxHandle = $proc.MainWindowHandle }
    }
    $scenarioBridge = Get-CimInstance Win32_Process -Filter "Name = 'livedot-bridge-win-x64.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($env:LIVEDOT_SETUP_WORKSPACE_ROOT, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.IndexOf(' serve ', [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      Select-Object -First 1
  }
  if ($maxHandle -ne 0) { throw '快捷方式运行出现了启动器窗口（应无窗口静默启动）' }
  if (-not $scenarioBridge) { throw '快捷方式运行没有直接打开默认工作区画布' }
  $deadline = (Get-Date).AddSeconds(15)
  while (-not $proc.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (-not $proc.HasExited) { throw '快捷方式运行未在静默打开后自行退出' }
  if (-not (Test-Path -LiteralPath $env:LIVEDOT_SETUP_LAST_PROJECT_FILE)) { throw '快捷方式运行没有写入上次工作区记忆' }
  $savedWorkspace = (Get-Content -LiteralPath $env:LIVEDOT_SETUP_LAST_PROJECT_FILE -Raw).Trim()
  if ($savedWorkspace -ne $env:LIVEDOT_SETUP_WORKSPACE_ROOT) { throw "上次工作区记忆内容不符: $savedWorkspace" }
  Stop-Process -Id $scenarioBridge.ProcessId -Force -ErrorAction SilentlyContinue
  $env:LIVEDOT_SETUP_WORKSPACE_ROOT = $oldWorkspaceRoot
  $env:LIVEDOT_SETUP_LAST_PROJECT_FILE = $oldLastProject

  # Simulate the exact permission failure class separately. The installer may
  # not delete or replace the protected tree; it must explain the safe next
  # step and leave current intact. The deny ACE is removed before cleanup.
  Remove-Item -LiteralPath (Join-Path $installedRoot 'payload/app.html') -Force
  $protectedNote = Join-Path $installedRoot 'protected-user-note.txt'
  Set-Content -LiteralPath $protectedNote -Value 'must-remain-in-current' -Encoding UTF8
  # Denying read/execute on the isolated product tree reliably makes both a
  # directory probe and a rename fail for this user. ACL editing itself still
  # succeeds because the test user owns the directory, so cleanup is safe.
  & icacls.exe $installedRoot /deny "$env:USERNAME`:(RX)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '无法为隔离 current 设置拒绝删除 ACL' }
  $denyApplied = $true
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  $proc = Start-Process -FilePath $exe -PassThru
  $window = Get-Window $proc
  Invoke-Button $window '安装并打开画布'
  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline -and (Get-StatusText $window) -notmatch '没有删除任何现有文件或项目数据') { Start-Sleep -Milliseconds 250 }
  $statusText = Get-StatusText $window
  if ($statusText -notmatch '没有删除任何现有文件或项目数据' -or $statusText -notmatch '选择其他软件安装位置') { throw "拒绝访问没有显示可理解的无损处理说明: $statusText" }
  if (-not (Test-Path -LiteralPath $protectedNote)) { throw '拒绝访问后 current 中的用户文件被删除' }
  & icacls.exe $installedRoot /remove:d $env:USERNAME | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '无法恢复隔离 current 的 ACL' }
  $denyApplied = $false

  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcut in @($desktopShortcut, $startShortcut)) {
    $link = $shell.CreateShortcut($shortcut)
    if ($link.TargetPath -notlike '*LiveDotMapSetup.exe') { throw "快捷方式目标不是产品入口: $($link.TargetPath)" }
    if ($link.Arguments -ne '--open') { throw "快捷方式没有使用产品打开参数: $($link.Arguments)" }
  }

  [pscustomobject]@{
    window = $true
    selectedInstallLocation = $productRoot
    productDirectory = (Join-Path $productRoot 'livedotmap')
    noProjectSelection = $true
    projectUntouched = $true
    freshInstall = $true
    corruptInstallAutoRepaired = $true
    previousBackup = $true
    productShortcuts = $true
    legacyShortcutsRemoved = $true
    legacyCurrentMigratedAndRepaired = $true
    secondRunOpensProductDirectly = $true
    secondRunWindowless = $true
    lastProjectRemembered = $true
    noMaintenanceButtonsInInstaller = $true
    deniedCurrentPreservedWithGuidance = $true
    current = $installedRoot
  } | ConvertTo-Json -Compress
}
finally {
  if ($denyApplied -and (Test-Path -LiteralPath $installedRoot)) { & icacls.exe $installedRoot /remove:d $env:USERNAME | Out-Null }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  # 清理本次验证从 dist 安装包启动的残留安装器/启动器进程（防止占用构建输出目录）。
  Get-CimInstance Win32_Process -Filter "Name = 'LiveDotMapSetup.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*dist*windows-installer*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:LIVEDOT_SETUP_PRODUCT_ROOT = $oldProductRoot
  $env:LIVEDOT_SETUP_SKIP_PRODUCT = $oldSkipProduct
  $env:LIVEDOT_SETUP_SKIP_SHORTCUT = $oldSkipShortcut
  $env:LIVEDOT_SETUP_SHORTCUT_ROOT = $oldShortcutRoot
  $env:LIVEDOT_SETUP_WORKSPACE_ROOT = $oldWorkspaceRoot
  $env:LIVEDOT_SETUP_LAST_PROJECT_FILE = $oldLastProject
  $env:LIVEDOT_RECENT_PROJECTS_FILE = $oldRecentFile
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolvedBase = [IO.Path]::GetFullPath($testBase).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($resolvedTestRoot.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
