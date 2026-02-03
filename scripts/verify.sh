
#!/usr/bin/env bash
set -euo pipefail

echo "[verify] lint (placeholder)"
# e.g. clang-format / clang-tidy / cmake-format

echo "[verify] unit tests (placeholder)"
# e.g. ctest -R unit

echo "[verify] integration tests (placeholder)"
# e.g. ctest -R integration

echo "[verify] contract checks"
python3 scripts/contract_checks.py

echo "[verify] sync doc links (check mode)"
python3 scripts/sync_doc_links.py --check

echo "[verify] done"
