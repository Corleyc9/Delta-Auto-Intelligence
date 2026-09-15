$ErrorActionPreference = "Stop"
$ReaderRoot = Join-Path $env:LOCALAPPDATA "DeltaAutoReader"
$VenvPath = Join-Path $ReaderRoot ".venv"
$SourceRoot = $PSScriptRoot

Write-Host "Delta Auto Tekmetric Reader" -ForegroundColor Cyan
Write-Host "Installing the read-only reader for this Windows computer..."

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Python is required. Install Python 3.11 or newer from python.org, check 'Add Python to PATH', then run this installer again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

New-Item -ItemType Directory -Force -Path $ReaderRoot | Out-Null

$packageFiles = @(
  "reader.py",
  "config.py",
  "numeric.py",
  "version.py",
  "requirements.txt",
  "build-hash.json",
  "VERSION",
  "install-reader.ps1",
  "register-scheduled-task.ps1"
)
foreach ($file in $packageFiles) {
  $source = Join-Path $SourceRoot $file
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $ReaderRoot $file) -Force
  }
}

$parsersSource = Join-Path $SourceRoot "parsers"
if (Test-Path $parsersSource) {
  Copy-Item $parsersSource (Join-Path $ReaderRoot "parsers") -Recurse -Force
}

$revisionFile = Join-Path $ReaderRoot "VERSION"
if (Test-Path $revisionFile) {
  Write-Host ("Packaged revision: " + (Get-Content $revisionFile -Raw).Trim()) -ForegroundColor Cyan
}

& py -3 -m venv $VenvPath
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $ReaderRoot "requirements.txt")
& $PythonExe -m playwright install chromium

Write-Host ""
Write-Host "Installed. The setup window will now collect the dashboard address and two machine keys." -ForegroundColor Green
Write-Host "Sign into Tekmetric, Steer, and NAPA yourself in the visible Chrome window. The reader never stores those passwords."
& $PythonExe (Join-Path $ReaderRoot "reader.py") --configure
