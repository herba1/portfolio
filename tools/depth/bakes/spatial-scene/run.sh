#!/bin/sh
# Re-bake the spatial-scene layers into public/lab/spatial-scene.
# Usage: sh run.sh [workdir]
#
# Inputs:
#   photo   "Wooden utility pole against a cloudy blue sky", Doszhan M (@dos16)
#           on Unsplash, https://unsplash.com/photos/dpn8hEVRwqo (Unsplash
#           License), the 3000x4000 download;
#           $PHOTO, default /tmp/claude-0/library/photos/woodpole-cloudfield.jpg
#   depth   tools/depth/depth_hr.py --levels 2 on that photo (16-bit, white = near);
#           $DEPTH, default /tmp/claude-0/library/depth/woodpole-cloudfield.png
# LaMa (lama-carve) must be in $LAB_MODELS; see tools/depth/README.md.
# The LaMa plate and the outpainted canvas are cached in <workdir>
# (plate.png, out.png); delete them to re-inpaint (about 10 minutes on 2 threads).
#
# The sky is two maps: the canvas (CANVAS in bake.py: the photo, and LaMa's
# band round its sides and foot, on the photo's image plane) and dome.webp,
# the whole sky to 112 deg from the zenith, which covers every view the engine
# makes (yaw +-6 deg, the look up to a stereographic 116 deg pitched to ~73,
# whose corners reach ~100 deg from the zenith). If the engine ever looks
# lower than that, raise ZMAX in bake.py.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$HERE/../../../..
WK=${1:-/tmp/spatial-scene-work}
mkdir -p "$WK"
python3 -I "$ROOT/src/app/lab/spatial-scene/bake.py" \
  "${PHOTO:-/tmp/claude-0/library/photos/woodpole-cloudfield.jpg}" \
  "${DEPTH:-/tmp/claude-0/library/depth/woodpole-cloudfield.png}" \
  "$ROOT/public/lab/spatial-scene" \
  "$WK"
