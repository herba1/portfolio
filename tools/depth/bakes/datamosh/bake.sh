#!/bin/sh
# Datamosh bake. Two Pixabay clips (Pixabay Content License), each
# downloaded into its own empty directory; WORK is scratch.
#   RAW=/path/120479.mp4   (ChristianBodhi: out of a train window, summer)
#   RAW2=/path/142723.mp4  (railway tracks from the back of a train, winter)
#   RAW=... RAW2=... WORK=/path/work sh bake.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../../../../public/lab/datamosh"
mkdir -p "$WORK" "$OUT"
# shot A: six seconds out of the window (17.5-23.5 s), 1280x720
ffmpeg -v error -ss 17.5 -i "$RAW" -t 6 -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -crf 10 -preset fast -pix_fmt yuv420p -an -y "$WORK/A.mp4"
# shot B: three seconds of track from the last car (3-6 s), cropped to
# 16:9 past the window pillar and run backwards, so the line comes at the
# camera out of the vanishing point: a forward ride, every vector radial
ffmpeg -v error -ss 3 -i "$RAW2" -t 3 -vf "crop=1639:922:280:0,scale=1280:720:flags=lanczos,fps=30,reverse" -c:v libx264 -crf 10 -preset fast -pix_fmt yuv420p -an -y "$WORK/B.mp4"
# the hard cut, A to B, at frame 180 (6 s), where the I-frames fall anyway
ffmpeg -v error -i "$WORK/A.mp4" -i "$WORK/B.mp4" -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -c:v libx264 -crf 8 -preset fast -pix_fmt yuv420p -an -y "$WORK/AB.mp4"
# VP9, no alt-ref (output order = input order, for WebCodecs); libvpx puts
# its own keyframe on the cut
ffmpeg -v error -i "$WORK/AB.mp4" -an -c:v libvpx-vp9 -b:v 1500k -maxrate 3000k -pass 1 -passlogfile "$WORK/p" -cpu-used 4 -row-mt 1 -g 9999 -pix_fmt yuv420p -f webm -y /dev/null
ffmpeg -v error -i "$WORK/AB.mp4" -an -c:v libvpx-vp9 -b:v 1500k -maxrate 3000k -pass 2 -passlogfile "$WORK/p" -cpu-used 2 -row-mt 1 -g 9999 -auto-alt-ref 0 -lag-in-frames 0 -pix_fmt yuv420p -y "$OUT/clip.webm"
# motion vectors from the decoded shipped frames; +-56 px both ways, since
# shot B moves into depth
python3 -I "$HERE/mv.py" "$OUT/clip.webm" "$OUT/clip.mv" 56 56
rm -f "$OUT/clip.mv.npy"
