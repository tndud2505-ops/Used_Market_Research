$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$App = Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\domestic'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22 or newer is required.'
}

$NodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Found $(node --version)."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm 10 or newer is required.'
}
$NpmMajor = [int]((npm --version).Split('.')[0])
if ($NpmMajor -lt 10) {
    throw "npm 10 or newer is required. Found $(npm --version)."
}

Write-Host "[setup] Installing $App"
npm --prefix $App ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed for $App" }

$Example = Join-Path $App '.env.example'
$Environment = Join-Path $App '.env'
if (-not (Test-Path -LiteralPath $Environment)) {
    Copy-Item -LiteralPath $Example -Destination $Environment
    Write-Host "[setup] Created local $Environment from the safe example."
}

Write-Host '[setup] Complete. Add private values only to the ignored .env file.'
