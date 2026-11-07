#!/bin/sh
# SAM 2.1 masks for the objects whose material can't be told by colour and geometry.
# Coordinates are pixels of the 1536x2040 working photo.
W=${1:-/tmp/claude-0/yuu}
S="python3 -I tools/depth/segment.py prompt $W/photo.png"
C="--cache $W/seg/photo.sam.npz --threads 3"
mkdir -p $W/seg
$S $W/seg/p-father.png --point 1060,1900 --point 1050,2000 --neg 1220,1960 $C
$S $W/seg/p-kid.png --point 1220,1960 --point 1225,1880 --neg 1060,1900 $C
$S $W/seg/p-far.png --point 930,1790 --point 885,1745 --point 970,1790 --point 905,1720 $C
$S $W/seg/p-left.png --point 600,1770 --point 690,1765 --point 712,1770 $C
$S $W/seg/m-truck.png --point 760,1700 --point 760,1740 $C
$S $W/seg/m-van.png --point 715,1735 --point 690,1720 $C
$S $W/seg/m-bike.png --point 1330,1960 --point 1300,1920 $C
$S $W/seg/s-times.png --point 110,1830 --point 105,1880 $C
$S $W/seg/s-pylon.png --point 125,1900 --point 128,1860 $C
$S $W/seg/s-p.png --point 1200,1560 --point 1250,1600 $C
$S $W/seg/s-man.png --point 1205,1652 --point 1180,1650 $C
