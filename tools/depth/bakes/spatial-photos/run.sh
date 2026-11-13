#!/bin/sh
# Bake the five scenes one at a time: labels, planes, then the set's one sky
# grade. Usage: sh run.sh <workdir> [slug...]
# Photos and Depth Anything V2 maps from $PICKS (default
# /tmp/claude-0/imgs2/picks, manifest.json): <slug>.jpg is the Unsplash file
# at w=6000, <slug>-depth.png is tools/depth/depth_hr.py on it (--levels 2
# for signal-cumulonimbus, the default 2,4 for the other four).
# KEEP_SKY=1 re-bakes only the object planes (their mattes, edges and wire
# planes) and leaves the graded sky plane already in public/ as it is.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WK=${1:-/tmp/spatial-photos-work}
shift || true
P=${PICKS:-/tmp/claude-0/imgs2/picks}
OUT=$HERE/../../../../public/lab/spatial-photos
SLUGS=${*:-"kyoto-crossing-lowangle signal-cumulonimbus ine-catenary-clouds smokestack-cumulus crossing-summer"}
for s in $SLUGS; do
  python3 -I "$HERE/labels.py" "$s" "$P/$s.jpg" "$P/$s-depth.png" "$WK/$s"
  if [ -n "$KEEP_SKY" ]; then
    # planes to a scratch dir, graded into public/ round the sky kept there
    SKYFILL=${SKYFILL:-soft} python3 -I "$HERE/bake.py" "$WK/$s" "$WK/$s/planes"
    KEEP_SKY=1 python3 -I "$HERE/grade.py" "$OUT/$s" "$s" "$WK/$s/planes"
  else
    SKYFILL=${SKYFILL:-soft} python3 -I "$HERE/bake.py" "$WK/$s" "$OUT/$s"
    python3 -I "$HERE/grade.py" "$OUT/$s" "$s"
  fi
done
