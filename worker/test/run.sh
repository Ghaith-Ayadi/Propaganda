#!/bin/sh
# The worker against a real Postgres. PGURL defaults to a local server with
# the password "postgres"; the test makes and drops its own two databases.
set -eu
cd "$(dirname "$0")/.."
npm run build
node test/limits.mjs
node test/shared.mjs
node test/agents.mjs
node test/pitch-write.mjs
node test/e2e.mjs
