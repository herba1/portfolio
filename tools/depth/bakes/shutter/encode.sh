#!/bin/sh
# Final viewfinder encodes from bake.py's near-lossless master.
#   sh tools/depth/bakes/shutter/encode.sh <plate-master.mp4> <public/lab/shutter> [crf_vp9] [crf_x264]
# VP9 (webm) for Chrome/Firefox/Safari 17+, H.264 (mp4) as the fallback. Down to
# 960x640 (the master is 1080x720): the viewfinder only carries the live sky and
# the first ~1.5 s of an exposure, the still plate carries the detail, and the
# time-lapse grain makes bits expensive. ~2.5 MB for the 40 s loop. Short GOP
# so a seek (the ?open still) lands fast; no audio. bake.json "video" must
# match the size here.
set -e
M=$1
O=$2
V=${3:-50}
X=${4:-31}
S=scale=960:640:flags=lanczos
ffmpeg -v error -y -i "$M" -an -vf "$S" -c:v libvpx-vp9 -crf "$V" -b:v 0 -row-mt 1 -tile-columns 2 -g 60 -deadline good -cpu-used 3 -pix_fmt yuv420p "$O/plate.webm"
ffmpeg -v error -y -i "$M" -an -vf "$S" -c:v libx264 -preset medium -crf "$X" -g 60 -pix_fmt yuv420p -profile:v high -movflags +faststart "$O/plate.mp4"
ls -la "$O"
