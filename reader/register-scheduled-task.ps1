# Registers the Delta Auto Tekmetric Reader as a Windows Task Scheduler task
# so it survives reboots and restarts itself if it crashes, instead of
# depending on someone remembering to double-click it every morning.
#
# IMPORTANT: this must run as a normal logged-on-user task, NOT as a
# Windows Service and NOT with "run whether user is logged on or not".
# reader.py launches a visible (headless=False) Chromium window on purpose —
# Tekmetric and Steer sessions are tied to that real, visible browser
# profile. Services and non-interactive tasks run in Session 0, which has
# no desktop, so a visible browser cannot open there and the reader would
# fail every single run. Run this script once, logged in as the same
# Windows account that will keep the shop computer signed into Tekmetric.
#
# Usage (from an elevated PowerShell prompt, after install-reader.ps1 has
# already been run at least once so reader.py and its venv exist):
#   powershell -ExecutionPolicy Bypass -File .\register-scheduled-task.ps1

$ErrorActionPreference = "Stop"
$ReaderRoot = Join-Path $env:LOCALAPPDATA "DeltaAutoReader"
$PythonExe = Join-Path $ReaderRoot ".venv\Scripts\python.exe"
$ReaderScript = Join-Path $ReaderRoot "reader.py"
$TaskName = "Delta Auto Tekmetric Reader"

if (-not (Test-Path $PythonExe) -or -not (Test-Path $ReaderScript)) {
    Write-Host "Reader is not installed yet. Run install-reader.ps1 first." -ForegroundColor Yellow
    exit 1
}

$action = New-ScheduledTaskAction -Execute $PythonExe -Argument "`"$ReaderScript`"" -WorkingDirectory $ReaderRoot

# Start automatically when this Windows account logs in, and also start
# once immediately when the task is registered.
$trigger = New-ScheduledTaskTrigger -AtLogOn

# If the process exits unexpectedly (crash, unhandled exception escaping
# the sync loop, Chromium being force-closed) Task Scheduler relaunches it
# on its own rather than waiting for a human to notice the shop computer's
# dashboard has gone stale.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)

# Run only in this user's interactive desktop session (required for the
# visible browser window Tekmetric/Steer sign-in depends on).
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName' in Task Scheduler." -ForegroundColor Green
Write-Host "It will start automatically the next time $env:USERNAME logs into this computer,"
Write-Host "and Task Scheduler will relaunch it automatically if it ever crashes."
Write-Host ""
Write-Host "Starting it now for this session..."
Start-ScheduledTask -TaskName $TaskName
Write-Host "Done. Check reader.log in $ReaderRoot to confirm it's running."
