#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
domestic="$repo_root/used_market_gemini_cli_full_docs/apps/domestic"
global="$repo_root/used_market_gemini_cli_full_docs/apps/global"

echo '[verify] Domestic deterministic suite'
npm --prefix "$domestic" test
echo '[verify] Global deterministic suite'
npm --prefix "$global" test
echo '[verify] Global UI suite'
npm --prefix "$global" run test:ui
echo '[verify] All deterministic suites passed.'
