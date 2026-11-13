# komorebi cumulus

The cloud layer (`public/lab/komorebi/clouds.webp`) comes from Poly Haven's
CC0 `kloofendal_48d_partly_cloudy_puresky` (8K), reprojected into the
komorebi crop: the same stereographic view (yaw 36, pitch 64 up, 140 degrees,
2560 master, crop 1680x2100 at 521,94), rotated so the HDRI's sun
(lon 34.26, lat 47.89) lands exactly on the drawn sun, then rolled 15 degrees
about the sun axis to place the clouds. A roll about the sun axis keeps every
cloud's lighting true to the drawn sun.

    python3 -I rep.py 15      # reproject (src8k.npy = the HDRI as float32 npy)
    python3 -I sep.py 15      # clear-sky field + raw cover (blue-excess unmixing)
    python3 -I clouds.py 15 '{"out":".../clouds.webp","sunClear":28,"expo":-0.3,"knee":0.9,"ceil":1.5,"ceilSun":2.5,"sunR":100}'

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
