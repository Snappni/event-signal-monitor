$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
node .\scripts\supervise-event-signal-service.mjs
exit $LASTEXITCODE
