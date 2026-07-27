param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment is missing. Run scripts\setup.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
    throw "Frontend dependencies are missing. Run scripts\setup.ps1 first."
}

Write-Host "Starting LitWeave v0.0.1"
Write-Host "Open: http://127.0.0.1:5173"
$Backend = Start-Process -FilePath $Python -ArgumentList @("-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
$Frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden

try {
    Start-Sleep -Seconds 2
    if (-not $NoBrowser) {
        try { Start-Process "http://127.0.0.1:5173" } catch { Write-Warning "Could not open the browser. Use the URL shown above." }
    }
    Write-Host "Press Ctrl+C to stop."
    while (-not $Backend.HasExited -and -not $Frontend.HasExited) { Start-Sleep -Seconds 1 }
    if ($Backend.HasExited) { throw "Backend stopped with exit code $($Backend.ExitCode)." }
    if ($Frontend.HasExited) { throw "Frontend stopped with exit code $($Frontend.ExitCode)." }
}
finally {
    if (-not $Backend.HasExited) { Stop-Process -Id $Backend.Id }
    if (-not $Frontend.HasExited) { Stop-Process -Id $Frontend.Id }
}
