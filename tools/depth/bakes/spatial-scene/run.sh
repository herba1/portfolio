#!/bin/sh
# Re-bake the spatial-scene layers into public/lab/spatial-scene.
# Usage: sh run.sh [workdir]
#
# Inputs:
#   photo   public/blog/images/image-mnund2ra.png (herb's Times Square photo)
#   depth   tools/depth/depth.py on that photo (16-bit, white = near);
#           $DEPTH, default /tmp/claude-0/depth/city-depth.png
#   mattes  *-matte.png here, SAM 2.1 masks (white = object), each made with
#             python3 -I tools/depth/segment.py prompt <photo> <name>-matte.png --work 2400 <points>
#           herb        --point 0.45,0.545 --point 0.41,0.66 --point 0.41,0.86 --point 0.37,0.74
#                       --point 0.383,0.567 --point 0.345,0.765   (hood, bag strap)
#                       --neg 0.3,0.6 --neg 0.56,0.7 --neg 0.52,0.58 --neg 0.33,0.52
#           taxi        --point 0.217,0.61 --point 0.283,0.66 --point 0.35,0.56
#                       --point 0.487,0.584   (its tail beside herb's face)
#                       --neg 0.42,0.65 --neg 0.45,0.55 --neg 0.53,0.565 --neg 0.05,0.58 --neg 0.2,0.72
#           pedestrian  --point 0.725,0.5453 --point 0.7125,0.578 --point 0.729,0.634
#                       --point 0.7354,0.5875 --point 0.752,0.578 --point 0.7417,0.584
#                       --neg 0.769,0.594 --neg 0.6917,0.656 --neg 0.69,0.553
#           pedicab     --point 0.88,0.6 --point 0.87,0.73 --point 0.82,0.8 --point 0.95,0.85
#                       --neg 0.72,0.6 --neg 0.7,0.8 --neg 0.9,0.35
# LaMa (lama-carve) must be in $LAB_MODELS; see tools/depth/README.md.
# The three LaMa plates are cached in <workdir>/plates; delete them to re-inpaint
# (about 15 minutes on 2 threads).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$HERE/../../../..
WK=${1:-/tmp/spatial-scene-work}
mkdir -p "$WK/plates"
PLATES=$WK/plates python3 -I "$ROOT/src/app/lab/spatial-scene/bake.py" \
  "$ROOT/public/blog/images/image-mnund2ra.png" \
  "${DEPTH:-/tmp/claude-0/depth/city-depth.png}" \
  "$ROOT/public/lab/spatial-scene" \
  "$HERE"
