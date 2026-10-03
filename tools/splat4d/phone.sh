#!/usr/bin/env bash
set -euo pipefail

MOVIES="${MOVIES:-$HOME/dev/MoVieS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$MOVIES/.venv/bin/python"

if [ $# -lt 2 ]; then
  echo "usage: tools/splat4d/phone.sh <video> <name> [start seconds] [end seconds]" >&2
  exit 1
fi

SOURCE="$1"
NAME="$2"
START="${3:-0}"
END="${4:-}"
CLIPS="$HOME/dev/splat-clips"
NORMAL="$CLIPS/$NAME.mp4"
mkdir -p "$CLIPS"

TRANSFER="$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of csv=p=0 "$SOURCE" | head -1)"
FILTER="fps=30,scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'"
if [ "$TRANSFER" = "arib-std-b67" ] || [ "$TRANSFER" = "smpte2084" ]; then
  FILTER="zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,$FILTER"
fi
RANGE=(-ss "$START")
if [ -n "$END" ]; then
  RANGE+=(-to "$END")
fi

ffmpeg -v error -y "${RANGE[@]}" -i "$SOURCE" -vf "$FILTER,format=yuv420p" \
  -c:v libx264 -preset slow -crf 14 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 160k -movflags +faststart "$NORMAL"

HFOV="$(cd "$HERE" && "$PYTHON" -c "import sys; from hybrid import built_hfov; from inputs import probe; print(round(built_hfov({'hfov': 'auto'}, probe(sys.argv[1])), 2))" "$SOURCE")"
DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$NORMAL")"
SECONDS_COVERED="$("$PYTHON" -c "import math, sys; print(max(1, math.floor(float(sys.argv[1]) - 0.15)))" "$DURATION")"
echo "$NAME: ${DURATION}s, lens ${HFOV} deg, building ${SECONDS_COVERED}s"

"$HERE/depthvideo.sh" --video "$NORMAL" --start 0 --end "$SECONDS_COVERED" --hfov "$HFOV" --out "public/splats/4d/$NAME-depth"
"$HERE/depthvideo_hd.sh" --video "$NORMAL" --start 0 --end "$SECONDS_COVERED" --hfov "$HFOV" \
  --depth-cache "$MOVIES/out/$NAME-depth/depth_outputs.npz" --out "public/splats/4d/$NAME-depth"
"$HERE/longclip.sh" --video "$NORMAL" --start 0 --end "$SECONDS_COVERED" --still --window-seconds 1 --hfov "$HFOV" --subject-voxel 2 \
  --out "public/splats/4d/$NAME-stream"
"$HERE/hybrid.sh" --video "$NORMAL" --start 0 --end "$SECONDS_COVERED" --hfov "$HFOV" \
  --depth-cache "$MOVIES/out/$NAME-depth/depth_outputs.npz" --windows "$MOVIES/out/$NAME-stream" --out "public/splats/4d/$NAME"
echo "open /lab/splat-video?clip=$NAME-depth and /lab/splat-video?clip=$NAME"
