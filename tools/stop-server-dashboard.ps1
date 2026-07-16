$ErrorActionPreference = "SilentlyContinue"
$runtimeDir = Join-Path $env:LOCALAPPDATA "EventSignalMonitor"
$statePath = Join-Path $runtimeDir "dashboard-tunnel.json"

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
  exit 0
}

$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
foreach ($processId in @($state.sshPid, $state.watcherPid)) {
  if ([int]$processId -gt 0 -and [int]$processId -ne $PID) {
    Stop-Process -Id ([int]$processId) -Force
  }
}
Remove-Item -LiteralPath $statePath -Force
