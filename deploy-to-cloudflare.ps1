# Builds and deploys Delta Auto Intelligence to your own Cloudflare account,
# replacing the ChatGPT Sites hosting. Run this from the unzipped project
# folder on a computer with Node.js installed.
#
# What this does NOT need: a Cloudflare API token pasted anywhere. It opens
# a browser window for you to approve access (OAuth), same as logging into
# any other site — nothing sensitive is typed into this terminal.

$ErrorActionPreference = "Stop"
Write-Host "Delta Auto Intelligence -- Cloudflare deploy" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is required first." -ForegroundColor Yellow
    Write-Host "Download the LTS installer from https://nodejs.org (default options are fine), then run this script again."
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Installing dependencies (first run takes a few minutes)..."
npm install

Write-Host ""
Write-Host "A browser window will open so you can sign into Cloudflare and approve access." -ForegroundColor Green
Write-Host "Come back to this window once you've approved it."
npx wrangler login

Write-Host ""
Write-Host "Building..."
# npm run build wraps a Linux/bash-only script (this template was built for
# a Linux CI pipeline). Calling vinext directly skips that wrapper and works
# the same way cross-platform.
npx vinext build

Write-Host ""
Write-Host "Deploying to Cloudflare Workers..."
npx wrangler deploy

Write-Host ""
Write-Host "Setting the reader key (this is what the Windows Tekmetric reader uses to authenticate)..."
$readerKey = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 48)
$readerKey | npx wrangler secret put READER_API_KEY

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "Deployed. Your live dashboard URL is printed above (ends in .workers.dev)." -ForegroundColor Green
Write-Host ""
Write-Host "Save this reader key -- you'll paste it into the Tekmetric reader setup" -ForegroundColor Green
Write-Host "(run install-reader.ps1 --configure, or delete reader-config.json and" -ForegroundColor Green
Write-Host "restart the reader to be prompted again):" -ForegroundColor Green
Write-Host $readerKey -ForegroundColor Yellow
Write-Host ""
Write-Host "For 'Machine access token' during that setup, enter anything -- it's" -ForegroundColor Green
Write-Host "only meaningful on ChatGPT's own hosting, not checked here." -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Read-Host "Press Enter to close"
