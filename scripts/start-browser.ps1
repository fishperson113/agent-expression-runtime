param([int]$Port=5173,[switch]$CopyToken)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
$gatewayProcess=$null
try {
    $gatewayExe=Join-Path $repoRoot 'src-tauri\target\debug\agent-expression-runtime.exe'
    npm run build
    if($LASTEXITCODE -ne 0){throw 'Frontend build failed'}
    cargo build --locked --manifest-path src-tauri/Cargo.toml
    if($LASTEXITCODE -ne 0){throw 'Gateway build failed'}
    $env:AER_PAIRING_TOKEN=[guid]::NewGuid().ToString('N')
    $env:AER_ALLOWED_ORIGINS="http://127.0.0.1:$Port"
    $infoDir=Join-Path $repoRoot '.runtime'
    New-Item -ItemType Directory -Path $infoDir -Force | Out-Null
    $infoFile=Join-Path $infoDir 'gateway-info.json'
    $gatewayProcess=Start-Process -FilePath $gatewayExe -ArgumentList '--browser-gateway' -WindowStyle Hidden -PassThru -RedirectStandardOutput $infoFile
    for($attempt=0;$attempt -lt 100;$attempt++){
        if($gatewayProcess.HasExited){throw 'Gateway exited during startup'}
        if((Test-Path -LiteralPath $infoFile) -and (Get-Item -LiteralPath $infoFile).Length -gt 0){break}
        Start-Sleep -Milliseconds 50
    }
    $info=Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
    $env:AER_BASE_URL=$info.baseUrl
    Write-Host "Browser: http://127.0.0.1:$Port"
    Write-Host "Gateway URL: $env:AER_BASE_URL"
    if($CopyToken){Set-Clipboard -Value $env:AER_PAIRING_TOKEN;Write-Host 'Pairing token copied to clipboard; paste into the browser password field.'}
    else {Write-Host 'The pairing token is in this process environment; use -CopyToken to copy it without printing it.'}
    Write-Host 'Keep this pane running. Open another pane for the agent host. Ctrl+C stops this launcher.'
    npm run dev -- --port $Port --strictPort
}finally{
    if($gatewayProcess -and !$gatewayProcess.HasExited){Stop-Process -Id $gatewayProcess.Id}
    Pop-Location
}
