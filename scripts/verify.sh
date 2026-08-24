#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
domestic="$repo_root/used_market_gemini_cli_full_docs/apps/domestic"

echo '[verify] Domestic deterministic suite'
npm --prefix "$domestic" test
echo '[verify] Deterministic suite passed.'
