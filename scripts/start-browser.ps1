$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    node scripts/start-session.mjs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
