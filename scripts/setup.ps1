$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath ".venv")) {
    python -m venv .venv
}
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed with exit code $LASTEXITCODE." }
& ".\.venv\Scripts\python.exe" -m pip install -e ".[test]"
if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed with exit code $LASTEXITCODE." }
npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
Write-Host "Setup completed. Run scripts\start-litweave.ps1 to start LitWeave."
