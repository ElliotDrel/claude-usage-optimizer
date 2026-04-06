param(
    [string]$TaskName = "ClaudeUsageTracker",
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 3000,
    [int]$StartupWaitSeconds = 20
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$healthUrl = "http://$BindHost`:$Port"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$nextDir = Join-Path $repoRoot ".next"

if (-not $task) {
    throw "No scheduled task named '$TaskName' was found. Run 'npm run startup:install' first."
}

Set-Location $repoRoot

if ($task.State -eq "Running") {
    Write-Host "Stopping startup task..."
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
}

if (Test-Path $nextDir) {
    Write-Host "Removing old production build artifacts..."
    Remove-Item -Recurse -Force $nextDir
}

Write-Host "Building the app..."
& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    throw "Build failed. Startup task was not restarted."
}

Write-Host "Starting startup task..."
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($StartupWaitSeconds)
do {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 5
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            Write-Host "Server restarted successfully at $healthUrl."
            exit 0
        }
    } catch {
    }
} while ((Get-Date) -lt $deadline)

throw "The startup task was started, but the app did not answer at $healthUrl within $StartupWaitSeconds seconds."
