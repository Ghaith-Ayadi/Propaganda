#!/usr/bin/env bash
# Propaganda's own schema check, run by Bedrock's shared pb-check workflow after
# its parse/boot/upgrade levels (PB_BIN is set there): the multi-tenant
# rehearsal (row-for-row snapshot comparison + the 40-check rules suite).
set -euo pipefail
cd "$(dirname "$0")/.."
(cd app && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
WORK="${RUNNER_TEMP:-/tmp}/pb-rehearsal" pb/rehearsal/rehearse.sh
