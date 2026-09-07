[CmdletBinding()]
param(
    [string]$ConnectionString = $env:FANTAZONE_AZURE_CONNECTION_STRING,
    [Parameter(Mandatory = $true)][string]$GroupRepository,
    [string]$GroupPat = $env:FANTAZONE_GROUP_PAT,
    [string]$PlatformRepository = "KeyserDSoze/Fantazone",
    [string]$PlatformPat = $env:FANTAZONE_PLATFORM_PAT,
    [string]$Branch = "main",
    [string]$GroupId,
    [string]$ReportPath,
    [string]$CachePath,
    [switch]$RefreshCache,
    [switch]$NoCache,
    [switch]$Apply,
    [switch]$Overwrite,
    [switch]$PreserveExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Overwrite -and $PreserveExisting) {
    throw "-Overwrite and -PreserveExisting are mutually exclusive."
}
if ($RefreshCache -and $NoCache) {
    throw "-RefreshCache and -NoCache are mutually exclusive."
}

function Read-SecretPlainText([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if ([string]::IsNullOrWhiteSpace($ConnectionString)) { $ConnectionString = Read-SecretPlainText "Azure Storage connection string" }
if ([string]::IsNullOrWhiteSpace($GroupPat)) { $GroupPat = Read-SecretPlainText "GitHub PAT for $GroupRepository" }
if ([string]::IsNullOrWhiteSpace($PlatformPat)) { $PlatformPat = Read-SecretPlainText "GitHub PAT for $PlatformRepository" }

$oldAzure = $env:FANTAZONE_AZURE_CONNECTION_STRING
$oldGroupPat = $env:FANTAZONE_GROUP_PAT
$oldPlatformPat = $env:FANTAZONE_PLATFORM_PAT

try {
    $env:FANTAZONE_AZURE_CONNECTION_STRING = $ConnectionString
    $env:FANTAZONE_GROUP_PAT = $GroupPat
    $env:FANTAZONE_PLATFORM_PAT = $PlatformPat

    $script = Join-Path $PSScriptRoot "migrate-azure-to-github.mjs"
    $arguments = @($script, "--group-repository", $GroupRepository, "--platform-repository", $PlatformRepository, "--branch", $Branch)
    if ($GroupId) { $arguments += @("--group-id", $GroupId) }
    if ($ReportPath) { $arguments += @("--report", $ReportPath) }
    if ($CachePath) { $arguments += @("--cache", $CachePath) }
    if ($RefreshCache) { $arguments += "--refresh-cache" }
    if ($NoCache) { $arguments += "--no-cache" }
    if ($Apply) { $arguments += "--apply" }
    if ($Overwrite) { $arguments += "--overwrite" }
    if ($PreserveExisting) { $arguments += "--preserve-existing" }

    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Migration process failed with exit code $LASTEXITCODE." }
}
finally {
    $env:FANTAZONE_AZURE_CONNECTION_STRING = $oldAzure
    $env:FANTAZONE_GROUP_PAT = $oldGroupPat
    $env:FANTAZONE_PLATFORM_PAT = $oldPlatformPat
}
