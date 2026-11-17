#!/bin/sh
# Final viewfinder encodes from bake.py's near-lossless master.
#   sh tools/depth/bakes/shutter/encode.sh <plate-master.mp4> <public/lab/shutter> [crf_vp9] [crf_x264]
# VP9 (webm) for Chrome/Firefox/Safari 17+, H.264 (mp4) as the fallback, at the
# master's 1280x720 (bake.json "video" must match). The viewfinder carries the
# live sky and the first second of an exposure; the still plate carries the
# tower's detail. Short GOP so a seek (the ?open still) lands fast; no audio.
set -e
M=$1
O=$2
V=${3:-38}
X=${4:-26}
ffmpeg -v error -y -i "$M" -an -c:v libvpx-vp9 -crf "$V" -b:v 0 -row-mt 1 -tile-columns 2 -g 24 -deadline good -cpu-used 2 -pix_fmt yuv420p "$O/plate.webm"
ffmpeg -v error -y -i "$M" -an -c:v libx264 -preset slow -crf "$X" -g 24 -pix_fmt yuv420p -profile:v high -movflags +faststart "$O/plate.mp4"
ls -la "$O"
