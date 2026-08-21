param(
  [string]$Server = 'ubuntu@13.124.223.213',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\LightsailDefaultKey-ap-northeast-2.pem"
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
if ($releaseId -notmatch '^\d{8}T\d{6}Z$') { throw 'Invalid release ID.' }
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key not found: $KeyPath" }

$archiveName = "used-market-global-$releaseId.tgz"
$localArchive = Join-Path $env:TEMP $archiveName
$remoteArchive = "/tmp/$archiveName"
$remoteStage = "/tmp/used-market-global-$releaseId"

try {
  & tar.exe -czf $localArchive `
    --exclude='merge/result' `
    --exclude='*/node_modules' `
    --exclude='*/dist' `
    --exclude='*/.wrangler' `
    -C $appRoot `
    package.json package-lock.json tsconfig.json MCP collector market merge reporter scheduler web-backend aws-runner
  if ($LASTEXITCODE -ne 0) { throw 'Global release archive creation failed.' }

  & scp -i $KeyPath -o BatchMode=yes -o StrictHostKeyChecking=accept-new $localArchive "${Server}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Global release archive upload failed.' }

  $remoteCommand = "install -d -m 700 '$remoteStage' && tar -xzf '$remoteArchive' -C '$remoteStage' && sudo RELEASE_ID='$releaseId' bash '$remoteStage/aws-runner/update-release.sh' '$remoteStage' && rm -f -- '$remoteArchive'"
  & ssh -i $KeyPath -o BatchMode=yes -o StrictHostKeyChecking=accept-new $Server $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "Global runner release failed with exit code $LASTEXITCODE." }
  Write-Host "AWS global release deployed: $releaseId" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $localArchive -Force -ErrorAction SilentlyContinue
}
