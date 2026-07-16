$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime\event-signal-monitor"
$PidPath = Join-Path $Runtime "fast-loop.pid"

function Stop-ProcessTree {
  param([int]$ProcessId)

  $Children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($Child in $Children) {
    Stop-ProcessTree -ProcessId ([int]$Child.ProcessId)
  }

  $Target = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $Target) {
    Stop-Process -Id $ProcessId -Force
  }
}

if (!(Test-Path -LiteralPath $PidPath)) {
  Write-Output "No unified-loop pid file found."
  exit 0
}

$RawPid = Get-Content -LiteralPath $PidPath -Raw
$LoopPid = [int]($RawPid.Trim())
$Process = Get-Process -Id $LoopPid -ErrorAction SilentlyContinue

if ($null -eq $Process) {
  Remove-Item -LiteralPath $PidPath -Force
  Write-Output "No running process found for pid=$LoopPid. Removed stale pid file."
  exit 0
}

Stop-ProcessTree -ProcessId $LoopPid
Remove-Item -LiteralPath $PidPath -Force
Write-Output "Stopped unified high-frequency loop pid=$LoopPid."
