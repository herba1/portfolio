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

LAMA="$MOVIES/resources/lama/big-lama.pt"
LAMA_SHA256="7ba7aa7ac37a4d41fdbbeba3a2af7ead18058552997e3a3cd1a3b2210c9e6b4c"
if [ ! -f "$LAMA" ]; then
  mkdir -p "$(dirname "$LAMA")"
  curl -fL -o "$LAMA" https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt
fi
echo "$LAMA_SHA256  $LAMA" | shasum -a 256 -c -
"$MOVIES/.venv/bin/python" -c "import torch; print('torch', torch.__version__, 'mps', torch.backends.mps.is_available())"
