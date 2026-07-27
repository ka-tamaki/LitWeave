$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
& ".\.venv\Scripts\python.exe" -m pytest
if ($LASTEXITCODE -ne 0) { throw "Backend tests failed with exit code $LASTEXITCODE." }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed with exit code $LASTEXITCODE." }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw "TypeScript typecheck failed with exit code $LASTEXITCODE." }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
