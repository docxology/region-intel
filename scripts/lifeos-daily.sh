#!/usr/bin/env bash
# The shared runner owns producer subprocesses, cancellation and aggregate failures.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REGION_ROOT="${REGION_ROOT:-$SCRIPT_DIR/..}"
exec bun "$SCRIPT_DIR/../src/regional_cli.ts" lifeos:daily "$@"
