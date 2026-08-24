$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Domestic = Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\domestic'

Write-Host '[verify] Domestic deterministic suite'
npm --prefix $Domestic test
if ($LASTEXITCODE -ne 0) { throw 'Domestic tests failed.' }

Write-Host '[verify] Deterministic suite passed.'
