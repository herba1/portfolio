#!/bin/sh
# SAM 2.1 masks for the things whose material can't be told by colour and
# geometry: the blank billboard panels (painted sheet metal, not concrete
# cladding), the bank's red sign and the poster under the billboard.
# Coordinates are pixels of the 1536x2048 working photo.
W=${1:-/tmp/claude-0/yuu}
S="python3 -I tools/depth/segment.py prompt $W/photo.png"
C="--cache $W/seg/photo.sam.npz --threads 3 --refine none"
mkdir -p $W/seg
$S $W/seg/s-board-top.png --point 860,1300 --point 760,1280 --point 960,1330 --neg 860,1180 $C
$S $W/seg/s-board.png --point 910,1660 --point 860,1560 --point 980,1780 --neg 700,1660 $C
$S $W/seg/s-board-side.png --point 670,1660 --point 680,1580 --neg 910,1660 $C
$S $W/seg/s-bank.png --point 1256,1600 --point 1240,1450 --point 1270,1800 $C
$S $W/seg/s-poster.png --point 940,1970 --point 860,1960 --point 1020,1975 $C
$S $W/seg/s-red.png --point 716,1980 --point 718,1940 --neg 760,1980 $C
