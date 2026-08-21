$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Apps = @(
    (Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\domestic'),
    (Join-Path $RepoRoot 'used_market_gemini_cli_full_docs\apps\global')
)

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

foreach ($App in $Apps) {
    Write-Host "[setup] Installing $App"
    npm --prefix $App ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed for $App" }

    $Example = Join-Path $App '.env.example'
    $Environment = Join-Path $App '.env'
    if (-not (Test-Path -LiteralPath $Environment)) {
        Copy-Item -LiteralPath $Example -Destination $Environment
        Write-Host "[setup] Created local $Environment from the safe example."
    }
}

$GlobalApp = $Apps[1]
$PlaywrightCli = Join-Path $GlobalApp 'node_modules\@playwright\cli\playwright-cli.js'
Write-Host '[setup] Installing the Chromium browser used by the global UI harness'
node $PlaywrightCli install-browser chromium
if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium installation failed.' }

Write-Host '[setup] Complete. Add private values only to each ignored .env file.'
