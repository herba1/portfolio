#!/usr/bin/env bash
set -euo pipefail

MOVIES="${MOVIES:-$HOME/dev/MoVieS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:?usage: tools/splat4d/render.sh <name> [frames]}"
FRAMES="${2:-0}"

cd "$HERE/../.."
exec "$MOVIES/.venv/bin/python" -W ignore "$HERE/check.py" "public/splats/4d/$NAME" --frames "$FRAMES" --cache "$MOVIES/out/$NAME/model_outputs.npz"
