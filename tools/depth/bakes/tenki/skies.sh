#!/bin/sh
# Tenki, step 4 for all five skies, from Poly Haven (CC0). One 8K HDRI at a time on
# disk: download, bake, delete. The clear sky is smooth, so 2K is enough for it.
#   sh skies.sh OUTDIR DLDIR
set -e
O=$1; D=$2; H=$(dirname "$0")
mkdir -p "$O" "$D"
get() { # id res
  u=$(curl -sS "https://api.polyhaven.com/files/$1" | python3 -I -c "import json,sys;print(json.load(sys.stdin)['hdri']['$2']['hdr']['url'])")
  curl -sS -o "$D/$1_$2.hdr" "$u"
}
bake() { # name id res yaw [pitch zoom]
  [ -f "$D/$2_$3.hdr" ] || get "$2" "$3"
  python3 -I "$H/light.py" "$O" "$1" "$D/$2_$3.hdr" "$4" 1440 ${5:-0} ${6:-1}
  rm -f "$D/$2_$3.hdr"
}
bake clear    rustig_koppie_puresky                2k 130
bake cirrus   kloppenheim_03_puresky               8k 180
bake mackerel aristea_wreck_puresky                8k 240
bake cumulus  kloofendal_48d_partly_cloudy_puresky 8k 140
# the building cumulus: aimed (yaw 266, 19 deg lower, 1.7x) so its one big
# cumulus stands behind the pole's crown, as in herb-ref 3
bake tower    sunflowers_puresky                   8k 266 -19 1.7
