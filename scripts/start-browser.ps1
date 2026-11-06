param([switch]$Agent)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Start-Agent {
    $adapter = (Join-Path $repoRoot 'integrations/mcp-server.mjs').Replace('\', '/')
    $agentArgs = @(
        '--no-daemon', '--no-alt-screen', '-C', $repoRoot,
        '-c', 'mcp_servers.aer.command="node"',
        '-c', ('mcp_servers.aer.args=' + (ConvertTo-Json -Compress -InputObject @($adapter))),
        '-c', 'mcp_servers.aer.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN"]',
        '-c', 'mcp_servers.aer.required=true',
        'Read aer://instructions/v1 from the aer MCP server. Use express for short particle expressions alongside normal replies. Start with a brief sphere expression and tell me the engine is connected. Keep credentials out of messages.'
    )
    & codex @agentArgs
    exit $LASTEXITCODE
}

if ($Agent) { Start-Agent }
Push-Location $repoRoot
try {
    foreach ($tool in @('node', 'npm', 'cargo', 'codex')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Missing $tool. Install Node 22.12+, Rust with Microsoft C++ Build Tools, and Codex CLI before running npm start."
        }
    }
    if (!(Test-Path 'node_modules/vite/package.json') -or !(Test-Path 'node_modules/@playwright/test/package.json')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    cargo build --locked --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Gateway build failed.' }
    node scripts/start-session.mjs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
