# komorebi cumulus

The cloud layer (`public/lab/komorebi/clouds.webp`) comes from Poly Haven's
CC0 `kloofendal_48d_partly_cloudy_puresky` (8K), reprojected into the
komorebi crop: the same stereographic view (yaw 36, pitch 64 up, 140 degrees,
2560 master, crop 1680x2100 at 521,94), rotated so the HDRI's sun
(lon 34.26, lat 47.89) lands exactly on the drawn sun, then rolled 15 degrees
about the sun axis to place the clouds. A roll about the sun axis keeps every
cloud's lighting true to the drawn sun.

    python3 -I rep.py 15      # reproject (src8k.npy = the HDRI as float32 npy)
    python3 -I skyfield.py sky.orig.bin .../public/lab/komorebi/sky.bin
    python3 -I softmatte.py 15 '{"out":".../clouds.webp","ref":"clouds.orig.webp","sky":".../sky.bin","q":92}'

`softmatte.py` replaces the old `sep.py` + `clouds.py` pair (kept for the
record). Those cut the cover with a blue-excess threshold, so the cumulus
were hard-edged stickers, and wherever the cut fell below the true cover the
premultiplied light was the pixel minus too much sky: a dark navy band round
every cloud. Their clear-sky field also followed gaps inside the clouds, so
round holes were punched through solid cumulus (the engine papered over
them with a hole/veil fill by the sun, which smeared that cloud grey; the
fill is gone). Now the clear sky is a smooth field fitted only away from any
cloud body; the cover is unmixed against it with each cloud's own local
blue/red (the shade is bluer than the sunlit tops), lifted towards solid as
`1 - (1 - a)^2.2` (never below the measured cover) and feathered outwards
only (sigma 2.6 px, ~8 px from 10 to 90%), and the light under it is
`x - (1 - a) S` for that same cover, so a cloud thins into the sky through
its own pale fringe. Thin edges take the body's colour at their own
luminance. Exposure is matched to the previous layer on solid cloud.

`skyfield.py` rebuilds `sky.bin` (the piazza's sky, 210x262 RGB half float)
as a radial profile round the capture's low sun plus a cubic over the frame,
fitted robustly: the old field's darker patches and pale ghosts of the
piazza's own clouds, and the lens rings round its sun, are gone. The engine
takes only its luminance.

`clouds.webp`: rgb = log2(P + 2^-9) over -9..6, P the cloud light
premultiplied by its cover (relit: sunlit parts to the drawn sun's colour,
shade towards the target skylight); a = cover. The engine composites
`sky * (1 - a) + P` behind the needle mattes.

## overhead pine bark

The unmixing called the pale sunlit wood of the overhead pine's forks part
sky, so the near matte had sky punched through solid bark. `barkmask.py`
marks that bark in the observed master (warm and bright: r/b > 1.5,
r/g > 1.05, luminance > 0.05, inside the near layer), closes it (11 px
ellipse) and fills enclosed holes; `bark.py` sets the near alpha to 1 across
it, takes its colour from what the camera saw (interior pushed out to the
edges), and grades it 1.3 stops down and 60% of the way to a warm grey-brown
chroma (1.36, 0.94, 0.60), so the forks read as wood in the sun rather than
a cream cut-out. Alpha and colour are sampled at the same displaced uv, so
the fill holds under any branch sway.

    python3 -I barkmask.py
    python3 -I bark.py '{"stops":1.3,"mixc":0.6,"tgt":[1.36,0.94,0.6]}'

## mattes and fill, cleaned

`clean.py` runs over the shipped `canopy.webp` and `layers.webp` (copied in as
`canopy.orig.webp`, `layers.orig.webp`). Right of the central cypress
(asset ~960-1060, 1765-1830) the far matte had a sky gap smeared along rows,
foliage slivers across it and a doubled blob at its tip, with sky blue and
black unmixing residue in the fill. The gap is cut back to its body (what
survives a 15 px opening), the rest becomes far foliage, coloured by a block
of far-pine needles from nearby (best match on the ring round the fill, then
levelled to the surround at low frequency). Then, over all three mattes:
lone small sky holes in solid foliage (under 100 px of visible sky, not
touching a real gap) are closed in the layer round them; every matte is
feathered (sigma 1.6 px); the fill under every see-through edge gets the
local needle colour where it was black residue, sky blue or blown, and rim
needles are lifted to within 0.25 stop of their neighbours so a gap has no
ink outline; last, the feathered rim is broken up by the needles' own light.

    python3 -I clean.py '{"out":".../public/lab/komorebi/"}'

## lower band, rebaked from the HDRI

The cypresses and far pines low in the frame (asset rows 1300..2100) stood
round the capture's own low sun (asset ~756, 1848). In the first bake the
lens veil and spikes there were cut out with the foliage, so that band was a
blobby matte over an inpainted grey wash and rendered as a soft dark smear.
`lowband.py` rebakes it from the 16K HDRI at full resolution (2x
supersampled, ~1 HDRI px per asset px): veil and spikes out, a smooth robust
clear-sky fit, sky transmittance from blue against a local foliage floor (the
blown disc and the veil-model ring round it called sky, a dead zone against
the residue), the far matte as what the kept nearer layers leave to cover,
mirrored across an occluder's edge behind it (so a sway uncovers real
needles), and the photograph's own foliage light, the flare-lit needles by
the sun replaced by the solid silhouette colour with their own texture. It
blends into the old assets over 110 rows. The engine presses the band to
black (`SILHOUETTE`, `c / (c + 0.1)`).

    python3 -I lowband.py '{"hdr":"piazza_16k.hdr","out":".../public/lab/komorebi/"}'
