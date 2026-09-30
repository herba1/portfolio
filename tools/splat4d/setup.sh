#!/usr/bin/env bash
set -euo pipefail

MOVIES="${MOVIES:-$HOME/dev/MoVieS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v ffmpeg >/dev/null || brew install ffmpeg
command -v uv >/dev/null || brew install uv

if [ ! -d "$MOVIES/.git" ]; then
  git clone https://github.com/chenguolin/MoVieS "$MOVIES"
  git -C "$MOVIES" checkout 77262fa
fi
[ -d "$MOVIES/extensions/vggt/.git" ] || git -C "$MOVIES/extensions" clone https://github.com/facebookresearch/vggt.git

[ -d "$MOVIES/.venv" ] || uv venv --python 3.11 "$MOVIES/.venv"
VIRTUAL_ENV="$MOVIES/.venv" uv pip install -r "$HERE/requirements.txt"

"$MOVIES/.venv/bin/hf" download chenguolin/MoVieS movies_ckpt.safetensors DAVIS/tennis.npz --local-dir "$MOVIES/resources"
"$MOVIES/.venv/bin/python" -c "import torch; print('torch', torch.__version__, 'mps', torch.backends.mps.is_available())"
