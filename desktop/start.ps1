# Son of Anton Launcher
# Usage: .\start.ps1 [-Profile] [-Log]

param(
    [switch]$Profile,  # Enable startup profiling
    [switch]$Log       # Enable transcript logging
)

if ($Log) {
    Start-Transcript -Path "npm_launch.log" -Append
}

Write-Host "Killing existing instances..." -ForegroundColor Yellow
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Write-Host "Launching Son of Anton..." -ForegroundColor Cyan

if ($Profile) {
    Write-Host "Profiling enabled - watch for [PERF] output" -ForegroundColor Yellow
    $env:PROFILE_STARTUP = "true"
}
else {
    $env:PROFILE_STARTUP = $null
}

# Launch without rebuild (electron src directly)
.\node_modules\.bin\electron.cmd src 2>&1

if ($Log) {
    Stop-Transcript
}
