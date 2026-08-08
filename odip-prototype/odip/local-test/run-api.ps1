<#
.SYNOPSIS
    Runs the ODIP .NET backend (Odip.Api) locally with all required environment
    variables set, without modifying anything inside backend/.

.NOTES
    Prerequisites this script assumes are already met:
      - .NET SDK installed under $env:USERPROFILE\.dotnet
      - Postgres reachable at localhost:5432 with database "odip",
        user postgres / password postgres (matches the connection string below;
        edit here if your local Postgres differs)
      - local-test\fake-firebase-sa.json exists (see fake-firebase-sa.json /
        auth-notes.md in this same folder)
      - Odip.Api has already been built (this script passes --no-build).
        Run `dotnet build` from the backend dir first if you haven't.

    JWT_SECRET below is a local-only value. It intentionally differs from the
    rejected dev-only default ("Odip-Dev-Only-Secret-Min32Characters!!") that
    Program.cs explicitly refuses to start with. Use the SAME secret when
    calling mint-jwt.js so signatures validate.
#>

$ErrorActionPreference = 'Stop'

# ── Paths ────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Resolve-Path (Join-Path $ScriptDir '..\backend')
$DotnetRoot = Join-Path $env:USERPROFILE '.dotnet'
$FirebaseSaPath = Join-Path $ScriptDir 'fake-firebase-sa.json'

if (-not (Test-Path $FirebaseSaPath)) {
    throw "fake-firebase-sa.json not found at $FirebaseSaPath. Generate it before running this script."
}

# ── .NET SDK on PATH for this process only ─────────────────────────
$env:DOTNET_ROOT = $DotnetRoot
# Always prepend: a -notlike guard here falsely matched "$DotnetRoot\tools" already on
# PATH, leaving the SDK-less system dotnet (C:\Program Files\dotnet) resolving first.
$env:PATH = "$DotnetRoot;$env:PATH"

# ── App configuration (process-scoped env vars) ─────────────────────
$env:ConnectionStrings__DefaultConnection = 'Host=localhost;Port=5432;Database=odip;Username=postgres;Password=postgres'
$env:JWT_SECRET                    = 'OdipLocalTestSecret-0123456789abcdef0123456789'
$env:FIREBASE_SERVICE_ACCOUNT_JSON = $FirebaseSaPath
$env:ASPNETCORE_ENVIRONMENT        = 'Development'
$env:ASPNETCORE_URLS               = 'http://localhost:5100'
$env:ALLOWED_ORIGINS               = 'http://localhost:5173'

Write-Host "Backend dir      : $BackendDir"
Write-Host "DOTNET_ROOT       : $DotnetRoot"
Write-Host "Firebase SA file  : $FirebaseSaPath"
Write-Host "ASPNETCORE_URLS   : $env:ASPNETCORE_URLS"
Write-Host "JWT_SECRET length : $($env:JWT_SECRET.Length) chars"
Write-Host ""
Write-Host "Starting Odip.Api ..."

Push-Location $BackendDir
try {
    # --no-launch-profile: launchSettings.json's applicationUrl (localhost:5062) otherwise
    # overrides the ASPNETCORE_URLS env var set above, causing the app to bind to the wrong
    # port (and collide with mock-api/server.js, which also defaults to 5062).
    & dotnet run --project Odip.Api --no-build --no-launch-profile
}
finally {
    Pop-Location
}
