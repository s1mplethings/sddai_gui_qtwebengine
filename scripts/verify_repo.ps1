Param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $Root "build"

Write-Host "[verify] repo root: $Root"

if (Get-Command cmake -ErrorAction SilentlyContinue) {
  Write-Host "[verify] cmake configure..."
  cmake -S $Root -B $BuildDir -DCMAKE_BUILD_TYPE=$Configuration
  Write-Host "[verify] cmake build..."
  cmake --build $BuildDir --config $Configuration

  $CTestFile = Join-Path $BuildDir "CTestTestfile.cmake"
  if ((Test-Path $CTestFile) -and (Get-Command ctest -ErrorAction SilentlyContinue)) {
    Write-Host "[verify] ctest..."
    ctest --test-dir $BuildDir --output-on-failure
  } else {
    Write-Host "[verify] no tests detected (skipping ctest)"
  }
} else {
  Write-Host "[verify] cmake not found; skipping C++ build"
}

$WebPkg = Join-Path $Root "web\package.json"
if (Test-Path $WebPkg) {
  Write-Host "[verify] web/package.json detected"
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $Root "web")
    if (Test-Path "package-lock.json") { npm ci } else { npm install }
    $hasBuild = node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"
    if ($LASTEXITCODE -eq 0) { npm run build } else { Write-Host "[verify] no npm build script (skipping)" }
    Pop-Location
  } else {
    Write-Host "[verify] npm not found; skipping web build"
  }
} else {
  Write-Host "[verify] no web frontend detected (web/package.json missing)"
}

Write-Host "[verify] OK"
