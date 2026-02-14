[CmdletBinding()]
param(
  [switch]$SkipEsbuild,
  [switch]$SkipDepsInstall,
  [switch]$SkipHash,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BuildDir = Join-Path $RepoRoot 'build'
$PackageJsonPath = Join-Path $RepoRoot 'package.json'

if (-not (Test-Path $PackageJsonPath)) {
  throw "package.json not found: $PackageJsonPath"
}

$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$Version = [string]$PackageJson.version
if ([string]::IsNullOrWhiteSpace($Version)) {
  throw 'Cannot read version from package.json'
}

$InstallerPath = Join-Path $RepoRoot ("out\Ferdium-win-AutoSetup-{0}-x64.exe" -f $Version)

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $RepoRoot
  )

  $argText = if ($Arguments.Length -gt 0) { $Arguments -join ' ' } else { '' }
  Write-Host ">> [$WorkingDirectory] $FilePath $argText"
  if ($DryRun) {
    return
  }

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed (exit code $LASTEXITCODE): $FilePath $argText"
    }
  } finally {
    Pop-Location
  }
}

Write-Host '=== Ferdium Windows x64 Installer Build ==='
Write-Host "RepoRoot: $RepoRoot"
Write-Host "Version : $Version"

if (-not $SkipEsbuild) {
  Invoke-External -FilePath 'node' -Arguments @('esbuild.mjs') -WorkingDirectory $RepoRoot
} else {
  Write-Host '>> Skip esbuild'
}

if (-not $SkipDepsInstall) {
  if (-not (Test-Path $BuildDir)) {
    throw "Build directory not found: $BuildDir"
  }

  $LockSrc = Join-Path $RepoRoot 'pnpm-lock.yaml'
  $LockDst = Join-Path $BuildDir 'pnpm-lock.yaml'
  Copy-Item $LockSrc $LockDst -Force

  # Install production dependencies inside ./build to avoid runtime missing modules.
  Invoke-External -FilePath 'pnpm' -Arguments @(
    'install',
    '--prod',
    '--frozen-lockfile',
    '--ignore-workspace',
    '--ignore-scripts'
  ) -WorkingDirectory $BuildDir
} else {
  Write-Host '>> Skip dependency install in build directory'
}

# Keep this flag set to false in this environment to avoid npm install step in electron-builder.
# signAndEditExecutable is disabled to avoid winCodeSign symlink extraction issues on restricted Windows setups.
Invoke-External -FilePath 'pnpm' -Arguments @(
  'exec',
  'electron-builder',
  '--win',
  'nsis',
  '--x64',
  '--config.npmRebuild=false',
  '--config.win.signAndEditExecutable=false'
) -WorkingDirectory $RepoRoot

if (-not (Test-Path $InstallerPath)) {
  throw "Installer not found after build: $InstallerPath"
}

Write-Host ''
Write-Host 'Build finished.'
Write-Host "Installer: $InstallerPath"

if (-not $SkipHash) {
  $hash = Get-FileHash $InstallerPath -Algorithm SHA256
  Write-Host "SHA256 : $($hash.Hash)"
}

Write-Host ''
Write-Host 'Optional verification:'
Write-Host 'pnpm dlx @electron/asar list out/win-unpacked/resources/app.asar | Select-String jsonfile'
