[CmdletBinding()]
param(
  [string]$ServerHost = "101.133.149.182",
  [string]$ServerUser = "admin",
  [int]$LocalPort = 18788,
  [int]$RemotePort = 8788,
  [string]$IdentityFile = (Join-Path $HOME ".ssh\event-signal-monitor_ed25519"),
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$dashboardUrl = "http://127.0.0.1:$LocalPort/"
$statusUrl = "http://127.0.0.1:$LocalPort/api/status"
$runtimeDir = Join-Path $env:LOCALAPPDATA "EventSignalMonitor"
$logPath = Join-Path $runtimeDir "dashboard-tunnel.log"
$statePath = Join-Path $runtimeDir "dashboard-tunnel.json"
$mutexName = "Local\EventSignalMonitorDashboardTunnel"
$knownHostsFile = Join-Path $HOME ".ssh\known_hosts"
$forwardSpec = "127.0.0.1:{0}:127.0.0.1:{1}" -f $LocalPort, $RemotePort

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Write-TunnelLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Test-Dashboard {
  try {
    $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2
    return $null -ne $status.runtimeDir
  } catch {
    return $false
  }
}

function Open-Dashboard {
  if (-not $NoBrowser) {
    Start-Process $dashboardUrl
  }
}

$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }

  if (-not $ownsMutex) {
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      if (Test-Dashboard) {
        Open-Dashboard
        return
      }
      Start-Sleep -Seconds 1
    }
    throw "The tunnel watchdog is already running, but local port $LocalPort is not reachable yet. Retry shortly."
  }

  if (Test-Dashboard) {
    Open-Dashboard
    return
  }

  if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "The dedicated SSH identity file was not found: $IdentityFile"
  }
  if (-not (Test-Path -LiteralPath $knownHostsFile -PathType Leaf)) {
    throw "The SSH known_hosts file was not found: $knownHostsFile"
  }

  $sshPath = (Get-Command ssh.exe -ErrorAction Stop).Source
  $browserOpened = $false
  Write-TunnelLog "watchdog started; target=$ServerHost localPort=$LocalPort remotePort=$RemotePort"

  while ($true) {
    $sshArgs = @(
      "-N",
      "-T",
      "-L", $forwardSpec,
      "-i", $IdentityFile,
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "UserKnownHostsFile=$knownHostsFile",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ConnectTimeout=10",
      "-o", "ConnectionAttempts=1",
      "-o", "ServerAliveInterval=10",
      "-o", "ServerAliveCountMax=3",
      "-o", "TCPKeepAlive=yes",
      "-o", "LogLevel=ERROR",
      "$ServerUser@$ServerHost"
    )

    Write-TunnelLog "starting SSH tunnel"
    $sshProcess = Start-Process -FilePath $sshPath -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
    @{
      watcherPid = $PID
      sshPid = $sshProcess.Id
      serverHost = $ServerHost
      localPort = $LocalPort
      remotePort = $RemotePort
      startedAt = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

    for ($attempt = 0; $attempt -lt 30 -and -not $sshProcess.HasExited; $attempt += 1) {
      if (Test-Dashboard) {
        Write-TunnelLog "dashboard reachable at $dashboardUrl"
        if (-not $browserOpened) {
          Open-Dashboard
          $browserOpened = $true
        }
        break
      }
      Start-Sleep -Seconds 1
    }

    $sshProcess.WaitForExit()
    Write-TunnelLog "SSH tunnel stopped with exit code $($sshProcess.ExitCode); retrying after VPN/network change"
    Start-Sleep -Seconds 5
  }
} catch {
  Write-TunnelLog "fatal: $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
  if ([System.Windows.MessageBox]) {
    [System.Windows.MessageBox]::Show($_.Exception.Message, "Event Signal Monitor Server") | Out-Null
  }
  throw
} finally {
  if ($ownsMutex) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}
