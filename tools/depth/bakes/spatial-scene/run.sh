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
# The sky canvas extent in bake.py (CANVAS) covers the engine's widest view:
# yaw +-6 deg about the pole, pitch -8..+16 deg about the anchor, the lens at
# s = 1/2 (stereographic) at full pitch-up, the print showing 1/1.2 of the
# photo. Sweeping those reaches x -0.46..0.46, y -0.59..1.00 photo heights on
# the image plane. If the engine's ranges change, re-check that before baking.
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
