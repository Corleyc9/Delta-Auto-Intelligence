$ErrorActionPreference = "Stop"
$ReaderRoot = Join-Path $env:LOCALAPPDATA "DeltaAutoReader"
$VenvPath = Join-Path $ReaderRoot ".venv"

Write-Host "Delta Auto Tekmetric Reader" -ForegroundColor Red
Write-Host "Installing the read-only reader for this Windows computer..."

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Python is required. Install Python 3.11 or newer from python.org, check 'Add Python to PATH', then run this installer again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

New-Item -ItemType Directory -Force -Path $ReaderRoot | Out-Null
Copy-Item "$PSScriptRoot\reader.py" (Join-Path $ReaderRoot "reader.py") -Force
Copy-Item "$PSScriptRoot\requirements.txt" (Join-Path $ReaderRoot "requirements.txt") -Force

& py -3 -m venv $VenvPath
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $ReaderRoot "requirements.txt")
& $PythonExe -m playwright install chromium

Write-Host ""
Write-Host "Installed. The setup window will now collect the dashboard address and two machine keys." -ForegroundColor Green
& $PythonExe (Join-Path $ReaderRoot "reader.py") --configure
