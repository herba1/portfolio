# Brief: Taffy (/lab/taffy)

## slug
taffy
## title
Taffy
## lens
kinetic-type
## oneLiner
Grab any letter of a giant song title and pull: it stretches out of the word on strands of ink that thin until they snap, and then it springs home.
## wowMoment
Drag the M sideways out of the word. Two strands of ink stretch from its neighbours and thin to a hair, then snap one after the other. The M springs back into place with a wobble while the whole word shudders.
## mechanic
FIELDS
The title is set in Geist 600, at about 70% of the box width, and turned into signed distance fields once:
- A word field at 1024px wide, RG16F: even glyphs in R, odd glyphs in G, so neighbours can blend.
- An R16F atlas with each glyph alone in a 192px tile.
Both come from an exact Felzenszwalb–Huttenlocher distance transform with inside and outside passes. It runs in a Blob-URL module worker.

SHADER
- The resting word is min(R, G).
- A grabbed glyph is cut out of its channel (max(d, −d_home)) and redrawn from its tile at the dragged offset.
- It stays tied into the word by two strands. Each is a capsule SDF from the nearest edge of a neighbour toward the moving glyph; at the ends of the word, a baseline root stands in for the missing neighbour.
- Strands are joined with a polynomial smooth-min, k = 0.35 × stem width, so every join is a fillet and never a corner.

STRANDS
- Volume is conserved as they stretch: r = r0 × sqrt(L0 / L), with r0 = 0.42 × stem.
- A strand ruptures at its thinnest point when it passes 2.4 cap heights or r falls below 1.2px.
- The halves retract into their bodies over 160ms on --ease-in-quad.
- The second strand snaps on its own condition, typically 40–120ms later.

RETURN
- After the snap the glyph springs home: stiffness 260, damping 13, so two visible wobbles.
- Squash and stretch along its velocity: 1 + 0.0006 × |v| along it, the inverse across it.
- Neighbours take an impulse that falls off with index distance (0.5^k), so the whole word shudders.
- If you release before a snap, the strands reel the glyph back, thickening as they shorten.
## firstFrame
A giant title in crisp black ink on paper with fine grain. The fallback is 'Ask Me Why'; otherwise it is the most recent title of 14 characters or fewer.

On load an invisible hand pulls the y down from 0 to 1.8 cap heights over 900ms on --ease-entrance. Its two strands thin to hairs and snap one after the other, and the y wobbles home. Then the plate goes still.

Below the word: 'Title — Artist' in text-ui and a small '1 / 12' SlotNumber.
## interactions
- Press on any glyph to grab it (hit test against the word field, d < 0).
- Drag to pull. Release to reel it back or let it snap.
- Up to 3 touches pull 3 letters, each with its own atlas slot. Ship single-grab first, then multi-touch.
- Click empty paper or press → for the next title, arriving by molten morph: k ramps to 0.8 cap heights so the word slumps into one blob, the field mixes old to new over 700ms on --ease-in-out, then k drops back and the new word snaps crisp.
- Hover: the glyph under the pointer lifts 2px and its strand roots preview at 15% thickness (r0 × 0.15), teaching you to grab.
- Keyboard: Tab moves focus between letters, shown as a 2px accent outline traced at d = 0. Arrow keys pull the focused letter 24px per press. Enter releases.
- touch-action is none on the plate.
## choreography
- Intro pull: 900ms --ease-entrance, then physical snap and spring.
- Rupture retract: 160ms --ease-in-quad.
- Spring: 260/13, physical.
- Molten morph: 700ms --ease-in-out.
- Index: rolls via SlotNumber.
- Caption: MorphText.
- Canvas reveal: 900ms.
- A haptic vibrate(6) fires on each snap.
## states
- Loading: before the fields exist (about 25ms in the worker per title), show the title as DOM text in text-display, the same visual, then crossfade to the canvas over 200ms. Wait for document.fonts.load.
- Error: if R16F textures fail, use RGBA8-packed distance. If the worker fails, run the transform on the main thread in an idle callback.
- Reduced motion: no squash, the spring is critically damped, strands still form and snap (the mechanic), no intro.
- Mobile: fit the title to 90% width, using 2 lines when needed.
- Hidden or offscreen: demand frameloop, so nothing runs.
## content
Herb's recent song titles from getRecentTracks(), preferring 14 characters or fewer, falling back to the Please Please Me tracklist. Spotify all-caps titles are converted to title case.
## tech
FILES
page.js, TaffyExperience.jsx, TaffyScene.jsx, taffyShader.js, taffySdf.js (worker source string), taffySprings.js, taffy.css.

RENDERING
- R3F <Canvas flat linear frameloop='demand' dpr={[1,2]} gl={{antialias:false, alpha:false}}>.
- Full-screen triangle with a GLSL3 ShaderMaterial; uniforms written through refs.
- Springs run in JS and call invalidate() each frame while anything moves.
- fwidth anti-aliasing on d, a 4-tap rotated-grid supersample, and edge sheen ink × (1 − ink) × 4 tinted 6% toward the accent.
- Chroma grain 0.06 / 0.6.
- The next title's fields are precomputed in requestIdleCallback.
## perfPlan
- 3 texture fetches × 4 taps per pixel.
- Zero frames between gestures.
- DPR cap 2 on the page and 1.5 embedded, plus the governor.
- IntersectionObserver plus visibilitychange.
- Dispose textures and material; terminate the worker.
## controls
PRESETS
Taffy (default), Mozzarella (longer strands, slower snap), Rubber (short snap, stiff spring).

SLIDERS
- Snap length: 1.2–4 cap heights.
- Fillet k.
- Spring stiffness.
- Wobble damping.

No other chrome.
## referenceSkills
lab-build, taste, creative-shader, r3f-shaders, benjy-type, gesture-ui
## risks
- Strand anchors on complex glyphs: find the neighbour's nearest edge by sampling its tile along the pull direction.
- Multi-touch adds atlas-slot bookkeeping.
- The snap must feel physical rather than cartoony; tune rupture timing and damping.
- 1024px fields give crisp edges at this size.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 5)
Upgrade: A uniform-radius capsule cannot show where it will break. Give strands an hourglass profile: the midspan radius necks down faster than the ends (r_mid = r0·(L0/L)^0.8, ends stay fat and filleted), so you watch a neck thin to a hair before the snap. Each snap leaves a small round bead that is reabsorbed into its letter over 160ms.
Pitfalls: - Applying smooth-min to the resting word fuses neighbouring letters into blobs. Use smin only between each strand and its two bodies.
- Even/odd channel separation breaks on tight kerning or overlapping glyphs (Ty, AV).
- A 1024px field upscaled to a DPR-2 canvas rounds the corners. Use 2048, or accept a softer look.
- The glyph hit test needs a CPU copy of the field.
- The next/font family name is hashed.
- Strand anchors on bowls (o, e) and the anchor at the end of the word.
- Multi-touch atlas slots.
- Squash-and-stretch on a text SDF distorts the AA width.
## engineer (wow 8, feasibility 5)
Upgrade: Give each strand a necking profile instead of a uniform capsule. Use a radius r(t) = r_end × (1 − a × sin(πt)), with a growing as the strand stretches, smooth-min'd into both glyphs. The strand visibly thins in the middle (Rayleigh–Plateau), so the eye predicts the snap before it happens. That anticipation is what makes a snap feel physical rather than cartoony. Rupture at the neck, and retract each half into its letter as a round blob that wobbles once.
Pitfalls: - Fonts in the worker: a worker cannot see document fonts, and next/font's hashed Geist is not trivially loadable there. Rasterise the glyph masks on the main thread, after document.fonts.load('600 …'), on a canvas. Post the ImageData to the worker for the Felzenszwalb–Huttenlocher EDT only.
- Strand anchors on letters like M, W and y: nearest-edge sampling along the pull direction can land inside a counter or jump between stems frame to frame. Low-pass the anchor point, and pick it once at grab time.
- Max/min SDF cutting (max(d, −d_home)) is not a true distance outside the cut. The smooth-min fillets then bulge oddly near the hole. Keep k small near the cut.
- R16F linear filtering is core in WebGL2. If an R32F fallback is used, it needs OES_texture_float_linear, which is missing on iOS.
- A 1024px field magnified to a 1280px canvas at DPR 2 is a 2.5× magnification. Edges are fine with SDFs, but sharp corners round off. Accept it or generate at 2048.
- The haptic vibrate does nothing on iOS.
- Title choice: the most recent title of 14 characters or fewer. Many top tracks are long or all caps, so title-case them and fall back to 'Ask Me Why'.