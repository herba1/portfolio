# Brief: Scorch (/lab/scorch)

## slug
scorch
## title
Scorch
## lens
shader-material
## oneLiner
Hold your finger on an album cover until it catches: a glowing char line creeps outward, racing along the dark ink like a fuse, and burns through to the next cover underneath.
## wowMoment
Light the darkest part of the cover, the black lettering or a dark background, and the burn races along the ink like a lit fuse. It traces the artwork's shapes and leaves the light areas standing as paper islands before they catch too.
## mechanic
A heat-and-fuel burn-front sim on a 384² grid where the cover's own ink is the fuel. Dark and saturated areas ignite at lower heat and burn faster, light paper resists, and paper-fibre noise frays the front. Your drag is wind that pushes the heat, so you can fan a front forward or blow it out. The char is rendered through an eased multi-stop paper-burn ramp, and the hole shows the next cover.

Fields, in an RGBA16F ping-pong: R is burn b (0 → 1), G is heat.

Each step:
- Heat diffuses through a 5-tap Laplacian ×0.2.
- Heat is advected by the wind (a semi-Lagrangian shift by wind·dt).
- Burning cells add 0.9·db of heat. Heat loses 0.55/s to the air.
- A texel ignites when heat > 0.30 - 0.17·fuel + 0.10·(fibre - 0.5).
- Once ignited, b += (0.5 + 1.1·fuel)·dt.
- fuel = 0.7·(1 - luminance) + 0.3·saturation, read from the cover.

Wind: drag velocity eases in at 1-e^(-dt·10) and decays with τ 0.8s. Against a strong headwind the heat falls below threshold and the front goes out, leaving a smoke-stain halo where b stops between 0.1 and 0.3.

Ramp, smoothstepped between every stop:
- b 0 → 0.18: paper to toast #d9b98a, a soft scorch halo.
- → 0.42: umber #6b4528.
- → 0.7: char #1c1714, with a fine crackle from fbm thresholded at 120× scale.
- Ember rim where heat > 0.5 and b is in [0.62, 0.9]: #ff6a1a → #ffc46b at ×1.4, with ±8% flicker from a 12Hz temporal hash.
- b > 0.92: a hole to the next cover, with a 1px char lip and sparse ash specks from a hash.
## firstFrame
Before fade-in, 1.5s of burning from two scripted ignition points near the lower left is pre-simulated.

The first frame shows ragged, glowing ember edges and a toast-brown halo spreading into the art, with the next cover's colours showing through both holes and the fronts still creeping live.

Beneath, in tokens: '<title> — <artist>', 'Underneath: <next title>', and '23% burnt' as a SlotNumber.
## interactions
Ignite: press and hold still for 320ms (6px slop). A ring brightens under the finger first, so you know it is catching. Then a hot spot grows from radius 0 to 0.025 over 240ms with easeOutBack. Multi-touch lights several fires.

Wind: drag to fan a front forward, or drag against it to blow it out.

Keys and buttons:
- Escape or Douse kills all heat: the fronts freeze, the embers fade over 600ms and the stain halo stays.
- → skips to the next sheet.

Turnover: every 20 frames a 1×1 mip of b is read. At 92% or more, the scraps burn away, the next cover becomes the sheet, and the one after it waits underneath.

Panel presets:
- Paper (default).
- Board: slower, thicker char, wide scorch.
- Newsprint: fast, pale char, wild fibre.
- Fuse: fuel is the ink only and bare paper will not burn, so fire runs only along the type and dark shapes.

Sliders: burn rate, heat spread, fibre, wind strength, ember intensity.
## choreography
Derive full choreography yourself: every entrance, hover, press, drag, release, value change and exit with durations and easing tokens.
## states
Loading, empty, error, reduced-motion, mobile, hidden-tab — design each.
## content
getRecentTracks covers in listening order, each burning through to the next. The fallback is the trading cards. Captions come from the track data.
## tech
R3F with manual render targets kept in refs: 3 sim substeps per frame, then a display pass with a 4-tap supersample and paper grain.

The ember glow comes from sampling the heat at mip bias 3 ×0.16, like Ink's halo, instead of a bloom post-pass. The ember is tinted against the light ground.

Cover textures are decoded first and uploaded one per frame.
## perfPlan
- 384² × 3 substeps costs about 0.5ms. Phones use 256².
- The loop runs only while some heat is above threshold, checked by a 1×1 mip readback every 20 frames, or while the wind is still decaying. Otherwise demand.
- DPR caps at 2 on the page and 1.5 embedded, under the governor.
- useNearViewport, IntersectionObserver and visibilitychange gate the loop, and everything is disposed on unmount.
## controls
Decide: a small hand-rolled panel with presets only if it serves the one mechanic.
## referenceSkills
creative-shader, r3f-shaders, gesture-ui, web-animation-design as fits
## risks
- Fire can turn cheesy. Keep only the creeping front: no flame sprites, no smoke particles, restrained flicker.
- Burning albums could read as a statement. The fuse-along-the-ink behaviour keeps it about the art.
- Tune fuel so light covers still burn; the Fuse preset is the extreme.
## inspiration
Cai Guo-Qiang's gunpowder drawings, where the ignition traces the drawing; Shadertoy 'burning paper' dissolve shaders; lit-fuse propagation.
## whyHerb
Serves:
- Paper physics as material, in the Ink and Halftone family.
- A multi-stop eased colour ramp.
- Behaviour driven by the content: the artwork itself is the fuel.
- A number that rolls.
- One mechanic with a real, irreversible consequence.

Avoids flames and particle cheese, fake 3D curling paper and a dark ground: the plate sits on the light page and the char is local.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)