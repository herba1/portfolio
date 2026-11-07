#!/bin/sh
# Bake the five scenes one at a time: labels then planes. Usage: sh run.sh <workdir> [slug...]
# Photos and Depth Anything V2 maps from /tmp/claude-0/imgs2/picks (manifest.json).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WK=${1:-/tmp/spatial-photos-work}
shift || true
P=/tmp/claude-0/imgs2/picks
OUT=$HERE/../../../../public/lab/spatial-photos
SLUGS=${*:-"kyoto-crossing-lowangle signal-cumulonimbus ine-catenary-clouds smokestack-cumulus crossing-summer"}
for s in $SLUGS; do
  python3 -I "$HERE/labels.py" "$s" "$P/$s.jpg" "$P/$s-depth.png" "$WK/$s"
  SKYFILL=${SKYFILL:-soft} python3 -I "$HERE/bake.py" "$WK/$s" "$OUT/$s"
done
