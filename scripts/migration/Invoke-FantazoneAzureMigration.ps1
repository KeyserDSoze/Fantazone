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
    [string]$WorkDir,
    [switch]$RefreshCache,
    [switch]$ReuseCache,
    [switch]$NoCache,
    [switch]$ResetWork,
    [switch]$Apply,
    [switch]$Overwrite,
    [switch]$PreserveExisting,
    [switch]$RepairImportedCalendars
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Overwrite -and $PreserveExisting) {
    throw "-Overwrite and -PreserveExisting are mutually exclusive."
}
if ($RepairImportedCalendars -and -not $PreserveExisting) {
    throw "-RepairImportedCalendars requires -PreserveExisting."
}
$cacheModeCount = [int]($RefreshCache.IsPresent) + [int]($ReuseCache.IsPresent) + [int]($NoCache.IsPresent)
if ($cacheModeCount -gt 1) {
    throw "-RefreshCache, -ReuseCache and -NoCache are mutually exclusive."
}

function Read-SecretPlainText([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-NodeMigration([string[]]$Arguments) {
    # Windows PowerShell 5.1 promotes stderr from native processes to ErrorRecord objects.
    # With the wrapper-wide ErrorActionPreference=Stop, a harmless console.warn from Node would
    # otherwise terminate the script before LASTEXITCODE can be inspected. Treat the native
    # process exit code as the source of truth and merge stderr into the live console stream.
    $previousErrorActionPreference = $ErrorActionPreference
    $nodeExitCode = 1
    try {
        $ErrorActionPreference = "Continue"
        & node @Arguments 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.Exception.Message
            }
            else {
                Write-Host $_
            }
        }
        $nodeExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return $nodeExitCode
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
    if ($WorkDir) { $arguments += @("--work-dir", $WorkDir) }
    if ($RefreshCache) { $arguments += "--refresh-cache" }
    if ($ReuseCache) { $arguments += "--reuse-cache" }
    if ($NoCache) { $arguments += "--no-cache" }
    if ($ResetWork) { $arguments += "--reset-work" }
    if ($Apply) { $arguments += "--apply" }
    if ($Overwrite) { $arguments += "--overwrite" }
    if ($PreserveExisting) { $arguments += "--preserve-existing" }
    if ($RepairImportedCalendars) { $arguments += "--repair-imported-calendars" }

    $repairScript = Join-Path $PSScriptRoot "repair-historical-calendar-cache.mjs"
    $repairArguments = @($repairScript)
    if ($CachePath) { $repairArguments += @("--cache", $CachePath) }

    # On normal reruns, repair a previously detected unrecoverable RealCalendar before staging.
    # A RefreshCache run intentionally scans Azure first, so its fallback is attempted after the
    # first failed pass against the newly written cache below.
    if ($RepairImportedCalendars -and -not $NoCache -and -not $RefreshCache) {
        $repairExitCode = Invoke-NodeMigration $repairArguments
        if ($repairExitCode -ne 0) { throw "Historical calendar repair preflight failed with exit code $repairExitCode." }
    }

    $nodeExitCode = Invoke-NodeMigration $arguments

    # A first migration (or RefreshCache) may discover the bad historical blob only during this run.
    # The scanner has already saved that diagnostic record in the cache. Repair it there and retry
    # exactly once; for RefreshCache the retry uses the repaired cache instead of overwriting it again.
    if ($nodeExitCode -ne 0 -and $RepairImportedCalendars -and -not $NoCache) {
        Write-Host "[Repair] Migration stopped on an unresolved calendar; attempting verified historical fallback and one retry..."
        $repairExitCode = Invoke-NodeMigration $repairArguments
        if ($repairExitCode -eq 0) {
            $retryArguments = @($arguments | Where-Object { $_ -ne "--refresh-cache" -and $_ -ne "--reuse-cache" })
            $retryArguments += "--reuse-cache"
            $nodeExitCode = Invoke-NodeMigration $retryArguments
        }
    }

    if ($nodeExitCode -ne 0) { throw "Migration process failed with exit code $nodeExitCode." }
}
finally {
    $env:FANTAZONE_AZURE_CONNECTION_STRING = $oldAzure
    $env:FANTAZONE_GROUP_PAT = $oldGroupPat
    $env:FANTAZONE_PLATFORM_PAT = $oldPlatformPat
}
