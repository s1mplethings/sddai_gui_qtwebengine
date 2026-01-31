Param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $Root "build"
$ExeRelPath = Join-Path "Release" "sddai_gui_qtwebengine.exe"
$ExePath = Join-Path $BuildDir $ExeRelPath
$FlatExePath = Join-Path $BuildDir "sddai_gui_qtwebengine.exe"

Write-Host "[verify] repo root: $Root"

if (Get-Command cmake -ErrorAction SilentlyContinue) {
  Write-Host "[verify] cmake configure..."
  cmake -S $Root -B $BuildDir -DCMAKE_BUILD_TYPE=$Configuration
  Write-Host "[verify] cmake build..."
  cmake --build $BuildDir --config $Configuration

  # Deploy Qt runtime beside the exe so it is runnable from build folder
  $qtBinCandidates = @()
  if ($env:QT_ROOT) { $qtBinCandidates += (Join-Path $env:QT_ROOT "bin") }
  if ($env:CMAKE_PREFIX_PATH) {
    $qtBinCandidates += ($env:CMAKE_PREFIX_PATH -split ";" | ForEach-Object { Join-Path $_ "bin" })
  }
  # common fallback for local setup
  $qtBinCandidates += "D:\Qt\6.6.1\msvc2019_64\bin"
  $windeploy = $qtBinCandidates | Where-Object { Test-Path (Join-Path $_ "windeployqt.exe") } | Select-Object -First 1
  if ($windeploy) {
    $windeployExe = Join-Path $windeploy "windeployqt.exe"
    Write-Host "[verify] windeployqt: $windeployExe"
    if (Test-Path $ExePath) {
      & $windeployExe --no-quick-import --no-translations --no-system-d3d-compiler --release $ExePath
    } else {
      Write-Host "[verify] exe not found for deploy: $ExePath"
    }
    # Flatten Release output into build/ for easier discovery
    if (Test-Path (Join-Path $BuildDir "Release")) {
      Write-Host "[verify] flatten build/Release -> build/"
      robocopy (Join-Path $BuildDir "Release") $BuildDir /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
      if (Test-Path $FlatExePath) {
        Write-Host "[verify] exe in build/: $FlatExePath"
      }
    }
  } else {
    Write-Host "[verify] windeployqt not found (set QT_ROOT or CMAKE_PREFIX_PATH)"
  }

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
