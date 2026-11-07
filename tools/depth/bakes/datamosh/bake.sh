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
# shot A: six seconds out of the window (15.35-21.35 s), cropped to the
# lower half of the 4K frame (1920x1080 from 960,1080), 1280x720: a low
# tree line under the sky, then a stand of oaks running in from the right
# in the last two seconds, so that at the cut the leaves (and the sky
# showing through them) fill the picture from above shot B's vanishing
# point down to the fence. That lower band is where a still's stroke
# starves the decoder and where shot B's radial vectors run longest, so
# what they drag out of the vanishing point at the cut is dense foliage,
# not flat blue.
ffmpeg -v error -ss 15.35 -i "$RAW" -t 6 -vf "crop=1920:1080:960:1080,scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -crf 10 -preset fast -pix_fmt yuv420p -an -y "$WORK/A.mp4"
# shot B: the last three seconds of track from the last car (14.9-17.9 s,
# source frames 447-536), cropped to 16:9 past the window pillar and run
# backwards, so the line comes at the camera out of the vanishing point: a
# forward ride, every vector radial. The last stretch, not the first: out in
# the open past the pines the shutter freezes the ballast, the verge, the
# snow and the bare birches (about twice the edge energy of seconds 3-6,
# which are a grey motion-blurred rush), so the stepped strips tear against
# a pin-sharp photo instead of mush, and the frame-to-frame motion is the
# same. Cut with trim, not -ss/-t: with the reverse filter behind them some
# ffmpeg builds hand back the last three seconds instead
ffmpeg -v error -i "$RAW2" -vf "trim=start_frame=447:end_frame=537,setpts=PTS-STARTPTS,crop=1639:922:280:0,scale=1280:720:flags=lanczos,fps=30,reverse" -c:v libx264 -crf 8 -preset fast -pix_fmt yuv420p -an -y "$WORK/B.mp4"
# the hard cut, A to B, at frame 180 (6 s), where the I-frames fall anyway
ffmpeg -v error -i "$WORK/A.mp4" -i "$WORK/B.mp4" -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -c:v libx264 -crf 8 -preset fast -pix_fmt yuv420p -an -y "$WORK/AB.mp4"
# VP9 at 5 Mb/s, no alt-ref (output order = input order, for WebCodecs);
# libvpx puts its own keyframe on the cut. 1.5 Mb/s smoothed the intact
# picture into grey mush at DPR 2, and the intact picture is half the
# effect: the strips only read as torn against a sharp photo

ffmpeg -v error -i "$WORK/AB.mp4" -an -c:v libvpx-vp9 -b:v 5000k -maxrate 8000k -pass 1 -passlogfile "$WORK/p" -cpu-used 4 -row-mt 1 -g 9999 -pix_fmt yuv420p -f webm -y /dev/null
ffmpeg -v error -i "$WORK/AB.mp4" -an -c:v libvpx-vp9 -b:v 5000k -maxrate 8000k -pass 2 -passlogfile "$WORK/p" -cpu-used 2 -row-mt 1 -g 9999 -auto-alt-ref 0 -lag-in-frames 0 -pix_fmt yuv420p -y "$OUT/clip.webm"
# motion vectors from the decoded shipped frames; +-56 px both ways, since
# shot B moves into depth
python3 -I "$HERE/mv.py" "$OUT/clip.webm" "$OUT/clip.mv" 56 56
rm -f "$OUT/clip.mv.npy"
