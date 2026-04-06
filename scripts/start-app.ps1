param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 3017
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildIdPath = Join-Path $repoRoot ".next\\BUILD_ID"

if (-not (Test-Path $buildIdPath)) {
    throw "No production build was found. Run 'npm run build' before starting the app on login."
}

Set-Location $repoRoot

$npm = Get-Command "npm.cmd" -ErrorAction Stop
$arguments = @("run", "start", "--", "--hostname", $BindHost, "--port", "$Port")

& $npm.Source @arguments
