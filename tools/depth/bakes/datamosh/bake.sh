#!/bin/sh
# Datamosh bake. RAW is the Pixabay clip 120479 (ChristianBodhi, Pixabay
# Content License), downloaded into its own empty directory; WORK is scratch.
#   RAW=/path/120479.mp4 WORK=/path/work sh bake.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../../../../public/lab/datamosh"
mkdir -p "$WORK" "$OUT"
# 1280x720 intermediate, then the shipped segment: seconds 17.5-26.5, VP9,
# one keyframe, no alt-ref (output order = input order, for WebCodecs)
ffmpeg -v error -i "$RAW" -vf "scale=1280:720:flags=lanczos" -c:v libx264 -crf 10 -preset fast -pix_fmt yuv420p -an -y "$WORK/A720.mp4"
ffmpeg -v error -ss 17.5 -i "$WORK/A720.mp4" -t 9 -an -c:v libvpx-vp9 -b:v 1500k -maxrate 3000k -pass 1 -passlogfile "$WORK/pA" -cpu-used 4 -row-mt 1 -g 9999 -pix_fmt yuv420p -f webm -y /dev/null
ffmpeg -v error -ss 17.5 -i "$WORK/A720.mp4" -t 9 -an -c:v libvpx-vp9 -b:v 1500k -maxrate 3000k -pass 2 -passlogfile "$WORK/pA" -cpu-used 2 -row-mt 1 -g 9999 -auto-alt-ref 0 -lag-in-frames 0 -pix_fmt yuv420p -y "$OUT/clip.webm"
# motion vectors from the decoded shipped frames
python3 -I "$HERE/mv.py" "$OUT/clip.webm" "$OUT/clip.mv" 56
rm -f "$OUT/clip.mv.npy"
