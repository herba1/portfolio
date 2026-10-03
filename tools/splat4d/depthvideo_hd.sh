#!/usr/bin/env bash
set -euo pipefail

MOVIES="${MOVIES:-$HOME/dev/MoVieS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -x "$MOVIES/.venv/bin/python" ]; then
  echo "MoVieS is not set up at $MOVIES. Run tools/splat4d/setup.sh first." >&2
  exit 1
fi

unset MallocStackLogging MallocStackLoggingNoCompact
export PYTORCH_ENABLE_MPS_FALLBACK=1
cd "$HERE/../.."
exec "$MOVIES/.venv/bin/python" -u -W ignore "$HERE/depthvideo_hd.py" --movies "$MOVIES" "$@"
