param(
  [string]$Server = 'ubuntu@13.124.223.213',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\LightsailDefaultKey-ap-northeast-2.pem"
)

$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-EbayProductionCredentials([string]$ClientId, [string]$ClientSecret) {
  $pair = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${ClientId}:${ClientSecret}"))
  $body = 'grant_type=client_credentials&scope=' + [Uri]::EscapeDataString('https://api.ebay.com/oauth/api_scope')
  try {
    $response = Invoke-RestMethod `
      -Method Post `
      -Uri 'https://api.ebay.com/identity/v1/oauth2/token' `
      -Headers @{ Authorization = "Basic $pair"; Accept = 'application/json' } `
      -ContentType 'application/x-www-form-urlencoded' `
      -Body $body
    if ([string]::IsNullOrWhiteSpace([string]$response.access_token)) {
      throw 'eBay OAuth response did not include an access token.'
    }
  } catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    if ($status) {
      throw "eBay Production OAuth rejected these credentials (HTTP $status). Confirm the App ID and Cert ID are from the same Production keyset."
    }
    throw "eBay Production OAuth validation failed: $($_.Exception.Message)"
  } finally {
    $pair = $null
    $body = $null
    $response = $null
  }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
  throw "SSH key not found: $KeyPath"
}

Write-Host 'eBay Production credentials will be sent only to the dedicated global AWS runner.'
$clientIdSecure = Read-Host 'Production App ID (Client ID)' -AsSecureString
$clientSecretSecure = Read-Host 'Production Cert ID (Client Secret)' -AsSecureString
$clientId = ConvertFrom-SecureValue $clientIdSecure
$clientSecret = ConvertFrom-SecureValue $clientSecretSecure

try {
  if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
    throw 'Both Production App ID and Cert ID are required.'
  }
  if ($clientId -notmatch '^[-A-Za-z0-9._~+/]+$' -or $clientSecret -notmatch '^[-A-Za-z0-9._~+/]+$') {
    throw 'A credential contains unsupported characters. Confirm that Production App ID and Cert ID were copied exactly.'
  }

  Write-Host 'Validating the key pair directly with eBay Production OAuth...'
  Test-EbayProductionCredentials -ClientId $clientId -ClientSecret $clientSecret
  Write-Host 'eBay Production OAuth accepted the key pair.' -ForegroundColor Green

  $id64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clientId))
  $secret64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clientSecret))
  $payload = "$id64`n$secret64`n"
  $payload | & ssh -i $KeyPath -o BatchMode=yes -o StrictHostKeyChecking=accept-new $Server 'sudo bash /opt/used-market-global-runner/current/aws-runner/install-ebay-credentials.sh'
  if ($LASTEXITCODE -ne 0) { throw "Remote eBay credential setup failed with exit code $LASTEXITCODE." }
  Write-Host 'eBay Production API setup completed successfully.' -ForegroundColor Green
} finally {
  $clientId = $null
  $clientSecret = $null
  $payload = $null
  $id64 = $null
  $secret64 = $null
  $clientIdSecure.Dispose()
  $clientSecretSecure.Dispose()
}
