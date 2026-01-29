#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT}/build"

echo "[verify] repo root: ${ROOT}"

if command -v cmake >/dev/null 2>&1; then
  echo "[verify] cmake configure..."
  cmake -S "${ROOT}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
  echo "[verify] cmake build..."
  cmake --build "${BUILD_DIR}" --config Release
  if [ -f "${BUILD_DIR}/CTestTestfile.cmake" ] && command -v ctest >/dev/null 2>&1; then
    echo "[verify] ctest..."
    ctest --test-dir "${BUILD_DIR}" --output-on-failure
  else
    echo "[verify] no tests detected (skipping ctest)"
  fi
else
  echo "[verify] cmake not found; skipping C++ build"
fi

if [ -f "${ROOT}/web/package.json" ]; then
  echo "[verify] web/package.json detected"
  if command -v npm >/dev/null 2>&1; then
    pushd "${ROOT}/web" >/dev/null
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
    # Build if script exists
    if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then
      npm run build
    else
      echo "[verify] no npm build script (skipping)"
    fi
    popd >/dev/null
  else
    echo "[verify] npm not found; skipping web build"
  fi
else
  echo "[verify] no web frontend detected (web/package.json missing)"
fi

echo "[verify] OK"
