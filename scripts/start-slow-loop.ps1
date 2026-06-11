param(
  [int]$IntervalSeconds = 300,
  [int]$InitialDelaySeconds = 30
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime\event-signal-monitor"
$LogPath = Join-Path $Runtime "slow-loop.log"
$PidPath = Join-Path $Runtime "slow-loop.pid"

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
Set-Location $Root
Set-Content -LiteralPath $PidPath -Value $PID -Encoding UTF8

function Write-LoopLog {
  param([string]$Message)
  Add-Content -LiteralPath $LogPath -Value $Message -Encoding UTF8
}

Write-LoopLog "[$(Get-Date -Format o)] slow loop started pid=$PID intervalSeconds=$IntervalSeconds initialDelaySeconds=$InitialDelaySeconds"

if ($InitialDelaySeconds -gt 0) {
  Start-Sleep -Seconds $InitialDelaySeconds
}

while ($true) {
  $RunStartedAt = Get-Date
  Write-LoopLog "[$(Get-Date -Format o)] signal:slow run started"
  try {
    npm run signal:slow 2>&1 | ForEach-Object { Write-LoopLog ([string]$_) }
  } catch {
    Write-LoopLog "[$(Get-Date -Format o)] signal:slow failed: $($_.Exception.Message)"
  }
  $ElapsedSeconds = [Math]::Ceiling(((Get-Date) - $RunStartedAt).TotalSeconds)
  $SleepSeconds = [Math]::Max(1, $IntervalSeconds - $ElapsedSeconds)
  Write-LoopLog "[$(Get-Date -Format o)] runElapsedSeconds=$ElapsedSeconds sleeping $SleepSeconds seconds"
  Start-Sleep -Seconds $SleepSeconds
}
