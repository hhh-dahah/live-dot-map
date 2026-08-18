$ErrorActionPreference = 'Stop'
$testBase = if ([string]::IsNullOrWhiteSpace($env:LIVEDOT_WINDOWS_TEST_ROOT)) { 'D:\LiveDotMap-Test' } else { $env:LIVEDOT_WINDOWS_TEST_ROOT }
$testRoot = Join-Path $testBase ('product-entry-' + [Guid]::NewGuid().ToString('N'))
$proc = $null
$bridge = $null
$workspace = Join-Path $testRoot 'workspace'
$targetProject = Join-Path $testRoot 'selected-project'
$lastProjectFile = Join-Path $testRoot 'last-project.txt'
$oldWorkspace = $env:LIVEDOT_SETUP_WORKSPACE_ROOT
$oldTarget = $env:LIVEDOT_SETUP_TEST_OPEN_PROJECT
$oldBrowser = $env:LIVEDOT_SETUP_SKIP_BROWSER
$oldLastProject = $env:LIVEDOT_SETUP_LAST_PROJECT_FILE
$oldRecentFile = $env:LIVEDOT_RECENT_PROJECTS_FILE
New-Item -ItemType Directory -Force -Path $workspace, $targetProject | Out-Null
$env:LIVEDOT_SETUP_WORKSPACE_ROOT = $workspace
$env:LIVEDOT_SETUP_TEST_OPEN_PROJECT = $targetProject
$env:LIVEDOT_SETUP_SKIP_BROWSER = '1'
$env:LIVEDOT_SETUP_LAST_PROJECT_FILE = $lastProjectFile
$env:LIVEDOT_RECENT_PROJECTS_FILE = Join-Path $testRoot 'recent-projects.json'
$installerOutput = if ([string]::IsNullOrWhiteSpace($env:LIVEDOT_WINDOWS_INSTALLER_OUTPUT)) { 'dist/windows-installer' } else { $env:LIVEDOT_WINDOWS_INSTALLER_OUTPUT }
$exe = (Resolve-Path (Join-Path $installerOutput 'LiveDotMapSetup.exe')).Path
try {
  $proc = Start-Process -FilePath $exe -ArgumentList '--open' -PassThru
  # 无窗口启动（A1）：进程不应出现任何主窗口，完成后应自行退出。
  $maxHandle = 0
  $exited = $false
  for ($i = 0; $i -lt 45 -and -not $bridge; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not $proc.HasExited) {
      $proc.Refresh()
      if ($proc.MainWindowHandle -ne 0) { $maxHandle = $proc.MainWindowHandle }
    } else { $exited = $true }
    $bridge = Get-CimInstance Win32_Process -Filter "Name = 'livedot-bridge-win-x64.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($targetProject, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.IndexOf(' serve ', [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      Select-Object -First 1
  }
  if ($maxHandle -ne 0) { throw '产品入口出现了启动器窗口（应无窗口静默启动）' }
  if (-not $bridge) { throw '产品入口没有直接启动默认工作区并切换到本机选择项目的画布会话' }
  # v2 布局：地图文件在 .live-dot-map/maps/<地图id>/ 下，默认地图为 default。
  $mapPath = Join-Path $workspace '.live-dot-map/maps/default/map.json'
  if (-not (Test-Path -LiteralPath $mapPath)) { throw '产品入口没有创建真实默认工作区地图' }
  $targetMapPath = Join-Path $targetProject '.live-dot-map/maps/default/map.json'
  if (-not (Test-Path -LiteralPath $targetMapPath)) { throw '产品入口没有复制默认地图到所选项目' }
  # 静默启动：桥启动后启动器进程应自行退出（ExitThread），无窗口可关。
  $deadline = (Get-Date).AddSeconds(15)
  while (-not $proc.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (-not $proc.HasExited) { throw '产品入口未在静默启动后自行退出' }
  # 上次工作区记忆（A2）：成功打开的项目写入 last-project.txt。
  if (-not (Test-Path -LiteralPath $lastProjectFile)) { throw '产品入口没有写入上次工作区记忆文件' }
  $savedProject = (Get-Content -LiteralPath $lastProjectFile -Raw).Trim()
  if ($savedProject -ne $targetProject) { throw "上次工作区记忆内容不符: $savedProject" }
  $proc = $null
  Start-Sleep -Milliseconds 800
  $surviving = Get-CimInstance Win32_Process -Filter "ProcessId = $($bridge.ProcessId)" -ErrorAction SilentlyContinue
  if (-not $surviving) { throw '产品入口关闭后项目画布会话被意外终止' }
  # A2 恢复：再次启动（模拟快捷方式/更新后重开），应直接恢复上次项目，不再走测试项目钩子。
  Stop-Process -Id $bridge.ProcessId -Force -ErrorAction SilentlyContinue
  $bridge = $null
  $env:LIVEDOT_SETUP_TEST_OPEN_PROJECT = ''
  Start-Sleep -Milliseconds 500
  $proc2 = Start-Process -FilePath $exe -ArgumentList '--open' -PassThru
  try {
    for ($i = 0; $i -lt 45 -and -not $bridge; $i++) {
      Start-Sleep -Milliseconds 500
      $bridge = Get-CimInstance Win32_Process -Filter "Name = 'livedot-bridge-win-x64.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($targetProject, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.IndexOf(' serve ', [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
        Select-Object -First 1
    }
    if (-not $bridge) { throw '二次启动没有恢复上次工作区项目' }
    $deadline = (Get-Date).AddSeconds(15)
    while (-not $proc2.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (-not $proc2.HasExited) { throw '二次启动未在静默打开后自行退出' }
  } finally {
    Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
  }
  [pscustomobject]@{ productLauncher = $true; windowlessLaunch = $true; directDefaultWorkspace = $true; nativeProjectSwitch = $true; bridgeStarted = $true; launcherExitsSilently = $true; lastProjectRemembered = $true; lastProjectRestoredOnNextLaunch = $true; bridgeSurvivesLauncherClose = $true; workspace = $workspace; selectedProject = $targetProject; defaultMapCreated = $true; defaultMapCopied = $true; bridgePid = $bridge.ProcessId } | ConvertTo-Json -Compress
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  if ($bridge) { Stop-Process -Id $bridge.ProcessId -Force -ErrorAction SilentlyContinue }
  # 清理从 dist 安装包启动的残留启动器进程（防止占用构建输出目录）。
  Get-CimInstance Win32_Process -Filter "Name = 'LiveDotMapSetup.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*dist*windows-installer*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:LIVEDOT_SETUP_WORKSPACE_ROOT = $oldWorkspace
  $env:LIVEDOT_SETUP_TEST_OPEN_PROJECT = $oldTarget
  $env:LIVEDOT_SETUP_SKIP_BROWSER = $oldBrowser
  $env:LIVEDOT_SETUP_LAST_PROJECT_FILE = $oldLastProject
  $env:LIVEDOT_RECENT_PROJECTS_FILE = $oldRecentFile
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolvedBase = [IO.Path]::GetFullPath($testBase).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($resolvedTestRoot.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
