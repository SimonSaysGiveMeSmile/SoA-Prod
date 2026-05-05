
# Check for NVM
if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
    Write-Host "NVM not found. please install it manually first: https://github.com/coreybutler/nvm-windows/releases" -ForegroundColor Red
    exit 1
}

# Install & Use Node 16
Write-Host "Installing/Using Node 16.20.0..." -ForegroundColor Cyan
nvm install 16.20.0
nvm use 16.20.0

# Install Build Tools
Write-Host "Installing Windows Build Tools (needs Admin)..." -ForegroundColor Cyan
npm install --global --production windows-build-tools --vs2015

# Clean old deps
Write-Host "Cleaning old dependencies..." -ForegroundColor Cyan
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path src/node_modules) { Remove-Item -Recurse -Force src/node_modules }

# Install new deps
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
cd src
npm install
cd ..

# Rebuild Native
Write-Host "Rebuilding native modules..." -ForegroundColor Cyan
.\node_modules\.bin\electron-rebuild -f -w node-pty

Write-Host "Setup Complete! Run 'npm start' to launch." -ForegroundColor Green
