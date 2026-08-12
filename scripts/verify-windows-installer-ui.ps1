$ErrorActionPreference = 'Stop'
$project = Join-Path $env:TEMP 'livedot-gui-e2e-20260812'
New-Item -ItemType Directory -Force -Path $project | Out-Null
$productRoot = Join-Path $env:LOCALAPPDATA 'LiveDotMap'
$recent = Join-Path $productRoot 'recent-project.txt'
$hadRecent = Test-Path -LiteralPath $recent
$oldRecent = if ($hadRecent) { [IO.File]::ReadAllText($recent) } else { '' }
New-Item -ItemType Directory -Force -Path $productRoot | Out-Null
[IO.File]::WriteAllText($recent, $project + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$exe = (Resolve-Path 'dist/windows-installer/LiveDotMapSetup.exe').Path
$proc = Start-Process -FilePath $exe -PassThru
try {
  $window = $null
  for ($i = 0; $i -lt 30 -and -not $window; $i++) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) { $window = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle) }
  }
  if (-not $window) { throw '安装器窗口未出现' }
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
  $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $names = @($buttons | ForEach-Object { $_.Current.Name })
  foreach ($requiredButton in @('修复 / 更新', '卸载（保留地图）')) {
    if ($names -notcontains $requiredButton) { throw ('未找到安装后维护按钮: ' + $requiredButton + ' / ' + ($names -join '|')) }
  }
  $target = $null
  foreach ($button in $buttons) { if ($button.Current.Name -eq '安装并开始使用') { $target = $button; break } }
  if (-not $target) { throw ('未找到安装按钮: ' + ($names -join '|')) }
  $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $deadline = (Get-Date).AddSeconds(35)
  $bridge = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $bridge = Get-Process -Name 'livedot-bridge-win-x64' -ErrorAction SilentlyContinue
    if ($bridge) { break }
  }
  $mapPath = Join-Path $project '.live-dot-map/map.json'
  $configured = Test-Path -LiteralPath $mapPath
  if (-not $configured -or -not $bridge) { throw "图形化安装链路未闭环: projectConfigured=$configured bridgeStarted=$([bool]$bridge)" }
  [pscustomobject]@{ window = $true; button = $true; bridgeStarted = $true; projectConfigured = $true; project = $project; buttons = ($names -join '|') } | ConvertTo-Json -Compress
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name 'livedot-bridge-win-x64' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($hadRecent) { [IO.File]::WriteAllText($recent, $oldRecent, (New-Object Text.UTF8Encoding($false))) }
  else { [IO.File]::Delete($recent) }
}
