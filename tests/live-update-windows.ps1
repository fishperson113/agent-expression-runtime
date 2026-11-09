$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$OriginalLocation = Get-Location
$FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('fisch update qa ' + [guid]::NewGuid().ToString('N'))

function Invoke-FixtureGit {
    param([string]$At, [string[]]$GitArgs)
    $result = & git -C $At @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture Git operation failed.' }
    return $result
}

function Get-UpdateCommands {
    $document = Get-Content -LiteralPath (Join-Path $RepoRoot 'docs/live-windows-qa.md') -Raw
    $region = [regex]::Matches($document, '(?s)<!-- live-update-commands:start -->(.*?)<!-- live-update-commands:end -->')
    if ($region.Count -ne 1) { throw 'Expected exactly one marked update procedure.' }
    $fences = [regex]::Matches($region[0].Groups[1].Value, '(?s)```powershell\s*\r?\n(.*?)```')
    if ($fences.Count -ne 1) { throw 'Expected exactly one PowerShell update fence.' }
    $commands = $fences[0].Groups[1].Value
    $assignment = '$FischCheckout = ''C:\src\agent-expression-runtime'''
    if ([regex]::Matches($commands, [regex]::Escape($assignment)).Count -ne 1) {
        throw 'Expected literal checkout assignment exactly once.'
    }
    return @{ Commands = $commands; Assignment = $assignment }
}

function New-Checkout {
    param([string]$Name)
    $path = Join-Path $FixtureRoot $Name
    $null = Invoke-FixtureGit $FixtureRoot @('clone', '--quiet', $Origin, $path)
    return $path
}

function Commit-Fixture {
    param([string]$At, [string]$Name)
    $null = Invoke-FixtureGit $At @('add', '--all')
    $null = Invoke-FixtureGit $At @('-c', 'user.name=Fisch QA', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', $Name)
}

function Snapshot-Checkout {
    param([string]$At)
    $head = Invoke-FixtureGit $At @('rev-parse', 'HEAD')
    $files = @('private.txt', 'untracked-private.txt') | ForEach-Object {
        $path = Join-Path $At $_
        if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { 'absent' }
    }
    return (@($head) + @($files)) -join '|'
}

function Assert-Update {
    param([string]$Label, [string]$Checkout, [bool]$ShouldPass, [string]$Target = $Checkout)
    $before = Snapshot-Checkout $Checkout
    $escaped = $Target.Replace("'", "''")
    $commands = $Procedure.Commands.Replace($Procedure.Assignment, ('$FischCheckout = ''' + $escaped + ''''))
    $passed = $false
    try {
        Set-Location -LiteralPath $Checkout
        & ([scriptblock]::Create($commands)) *> $null
        $passed = $true
    } catch { $passed = $false }
    finally { Set-Location -LiteralPath $FixtureRoot }
    if ($passed -ne $ShouldPass) { throw "Update procedure result mismatch: $Label" }
    if (!$ShouldPass -and (Snapshot-Checkout $Checkout) -ne $before) {
        throw "Rejected update changed HEAD or private fixture bytes: $Label"
    }
    Write-Output "PASS update procedure: $Label"
}

try {
    $Procedure = Get-UpdateCommands
    $null = New-Item -ItemType Directory -Path $FixtureRoot
    $Origin = Join-Path $FixtureRoot 'bare origin.git'
    $Seed = Join-Path $FixtureRoot 'seed checkout'
    $null = Invoke-FixtureGit $FixtureRoot @('init', '--quiet', '--bare', '--initial-branch=main', $Origin)
    $null = Invoke-FixtureGit $FixtureRoot @('clone', '--quiet', $Origin, $Seed)
    Set-Content -LiteralPath (Join-Path $Seed 'private.txt') -Value 'synthetic private fixture only'
    Commit-Fixture $Seed 'initial fixture'
    $null = Invoke-FixtureGit $Seed @('push', '--quiet', '-u', 'origin', 'main')
    $clean = New-Checkout 'clean ff checkout'
    Set-Content -LiteralPath (Join-Path $Seed 'remote.txt') -Value 'remote advance'
    Commit-Fixture $Seed 'remote advance'
    $null = Invoke-FixtureGit $Seed @('push', '--quiet')
    Assert-Update 'clean fast-forward' $clean $true
    $expected = Invoke-FixtureGit $Seed @('rev-parse', 'HEAD')
    if ((Invoke-FixtureGit $clean @('rev-parse', 'HEAD')) -ne $expected) { throw 'Clean checkout did not fast-forward.' }

    $tracked = New-Checkout 'tracked edit'
    Set-Content -LiteralPath (Join-Path $tracked 'private.txt') -Value 'synthetic edited bytes'
    Assert-Update 'tracked edit' $tracked $false
    $untracked = New-Checkout 'untracked edit'
    Set-Content -LiteralPath (Join-Path $untracked 'untracked-private.txt') -Value 'synthetic untracked bytes'
    Assert-Update 'untracked edit' $untracked $false
    $detached = New-Checkout 'detached checkout'
    $null = Invoke-FixtureGit $detached @('checkout', '--quiet', '--detach')
    Assert-Update 'detached HEAD' $detached $false
    $feature = New-Checkout 'feature checkout'
    $null = Invoke-FixtureGit $feature @('checkout', '--quiet', '-b', 'feature')
    Assert-Update 'feature branch' $feature $false
    $absent = New-Checkout 'absent upstream'
    $null = Invoke-FixtureGit $absent @('branch', '--unset-upstream')
    Assert-Update 'absent upstream' $absent $false
    $wrong = New-Checkout 'wrong upstream'
    $null = Invoke-FixtureGit $wrong @('branch', 'other')
    $null = Invoke-FixtureGit $wrong @('branch', '--set-upstream-to=other', 'main')
    Assert-Update 'wrong upstream' $wrong $false

    $diverged = New-Checkout 'diverged checkout'
    Set-Content -LiteralPath (Join-Path $diverged 'local.txt') -Value 'local commit'
    Commit-Fixture $diverged 'local divergence'
    Add-Content -LiteralPath (Join-Path $Seed 'remote.txt') -Value 'second remote advance'
    Commit-Fixture $Seed 'second remote advance'
    $null = Invoke-FixtureGit $Seed @('push', '--quiet')
    Assert-Update 'diverged main' $diverged $false
    $guard = New-Checkout 'path guard checkout'
    Assert-Update 'nonexistent checkout' $guard $false (Join-Path $FixtureRoot 'missing checkout')
    $nested = Join-Path $guard 'nested folder'
    $null = New-Item -ItemType Directory -Path $nested
    Assert-Update 'nested checkout path' $guard $false $nested
    $broken = New-Checkout 'status failure'
    [IO.File]::WriteAllBytes((Join-Path $broken '.git/index'), [byte[]](1, 2, 3))
    Assert-Update 'git status failure' $broken $false
} finally {
    Set-Location -LiteralPath $OriginalLocation.Path
    if (Test-Path -LiteralPath $FixtureRoot) { Remove-Item -LiteralPath $FixtureRoot -Recurse -Force }
}
