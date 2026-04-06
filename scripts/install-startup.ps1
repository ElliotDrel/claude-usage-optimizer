param(
    [string]$TaskName = "ClaudeUsageTracker",
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = Split-Path -Parent $scriptRoot
$launcherPath = Join-Path $scriptRoot "start-app.ps1"
$buildIdPath = Join-Path $repoRoot ".next\\BUILD_ID"
$nodeModulesPath = Join-Path $repoRoot "node_modules"

if (-not (Test-Path $nodeModulesPath)) {
    throw "Dependencies are missing. Run 'npm install' before installing the startup task."
}

if (-not (Test-Path $buildIdPath)) {
    throw "No production build was found. Run 'npm run build' before installing the startup task."
}

$userId = if ($env:USERDOMAIN) {
    "$($env:USERDOMAIN)\$($env:USERNAME)"
} else {
    $env:USERNAME
}

$powerShellExe = (Get-Command "powershell.exe" -ErrorAction Stop).Source
$argumentList = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$launcherPath`"",
    "-BindHost", $BindHost,
    "-Port", "$Port"
) -join " "

$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $argumentList
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "Installed startup task '$TaskName'. The app will launch at logon on http://$BindHost`:$Port."
