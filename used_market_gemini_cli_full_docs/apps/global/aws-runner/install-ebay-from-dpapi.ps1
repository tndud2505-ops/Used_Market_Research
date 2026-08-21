param(
  [string]$Server = 'ubuntu@13.124.223.213',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\LightsailDefaultKey-ap-northeast-2.pem",
  [string]$HandoffPath = "$env:LOCALAPPDATA\USED_WEB\ebay-production-credentials.clixml"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
  throw "SSH key not found: $KeyPath"
}
if (-not (Test-Path -LiteralPath $HandoffPath -PathType Leaf)) {
  throw 'Encrypted eBay credential handoff was not found.'
}

$handoff = Import-Clixml -LiteralPath $HandoffPath
$idPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($handoff.ClientId)
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($handoff.ClientSecret)

try {
  $clientId = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($idPointer)
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ($clientId -notmatch '^[-A-Za-z0-9._~+/]+$' -or $clientSecret -notmatch '^[-A-Za-z0-9._~+/]+$') {
    throw 'Encrypted eBay credentials contain unsupported characters.'
  }

  $id64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clientId))
  $secret64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clientSecret))
  $payload = "$id64`n$secret64`n"
  $payload | & ssh -i $KeyPath -o BatchMode=yes -o StrictHostKeyChecking=accept-new $Server 'sudo bash /opt/used-market-global-runner/current/aws-runner/install-ebay-credentials.sh'
  if ($LASTEXITCODE -ne 0) {
    throw "Remote eBay credential setup failed with exit code $LASTEXITCODE."
  }
  Write-Host 'eBay Production credentials installed and live search verified.' -ForegroundColor Green
} finally {
  if ($idPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($idPointer)
  }
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $clientId = $null
  $clientSecret = $null
  $id64 = $null
  $secret64 = $null
  $payload = $null
  Remove-Item -LiteralPath $HandoffPath -Force -ErrorAction SilentlyContinue
}
