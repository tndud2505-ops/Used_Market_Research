$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Domestic = Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\domestic'
$Global = Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\global'

Write-Host '[verify] Domestic deterministic suite'
npm --prefix $Domestic test
if ($LASTEXITCODE -ne 0) { throw 'Domestic tests failed.' }

Write-Host '[verify] Global deterministic suite'
npm --prefix $Global test
if ($LASTEXITCODE -ne 0) { throw 'Global tests failed.' }

Write-Host '[verify] Global UI suite'
npm --prefix $Global run test:ui
if ($LASTEXITCODE -ne 0) { throw 'Global UI tests failed.' }

Write-Host '[verify] All deterministic suites passed.'
