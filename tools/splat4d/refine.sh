#!/usr/bin/env bash
set -euo pipefail

METALSPLAT="${METALSPLAT:-$HOME/dev/metalsplat}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -x "$METALSPLAT/.venv/bin/python" ]; then
  echo "metalsplat is not set up at $METALSPLAT: git clone https://github.com/tchauffi/metalsplat there and run uv sync." >&2
  exit 1
fi

unset MallocStackLogging MallocStackLoggingNoCompact
cd "$HERE/../.."
exec "$METALSPLAT/.venv/bin/python" -u -W ignore "$HERE/refine.py" "$@"
