#!/usr/bin/env bash
set -euo pipefail

MOVIES="${MOVIES:-$HOME/dev/MoVieS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:?usage: tools/splat4d/render.sh <name> [frames]}"
FRAMES="${2:-0}"

cd "$HERE/../.."
if [ -f "$MOVIES/out/$NAME/flipbook_images.npy" ]; then
  exec "$MOVIES/.venv/bin/python" -W ignore "$HERE/check.py" "public/splats/4d/$NAME" --frames "$FRAMES" --images "$MOVIES/out/$NAME/flipbook_images.npy"
fi
exec "$MOVIES/.venv/bin/python" -W ignore "$HERE/check.py" "public/splats/4d/$NAME" --frames "$FRAMES" --cache "$MOVIES/out/$NAME/model_outputs.npz"
