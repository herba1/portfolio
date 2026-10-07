# Brief: Stir (/lab/stir)

## slug
stir
## title
Stir
## lens
kinetic-type
## oneLiner
A wall of Herb's tracklist where bold is a fluid: drag through it and weight swirls through the letters like ink in water.
## wowMoment
You whip a tight loop through the wall and the bold vortex keeps spinning after your hand has left. The song titles inside it swell and thin as it curls, then it dies back to quiet type.
## mechanic
The wall is a grid of Geist Mono cells. Measured from the font file, Geist Mono's advance is 600 units at every weight, so changing weight never reflows anything. Each cell's weight is a dye value in a Stam stable-fluids simulation on the same grid, about 160×36 cells on desktop and 48×36 on a phone. Pointer motion injects velocity as a Gaussian splat of radius 3 cells, with force = pointer velocity × 0.9, and adds dye at +0.35 per splat (twice that while pressed). Each step advects velocity semi-Lagrangian, makes it divergence-free with 14 Jacobi pressure iterations, and advects and diffuses the dye (ν 0.0006) while it relaxes back to rest with e^(−dt/2.4s). Vorticity confinement (ε 0.18) keeps the curls alive, so wakes roll up into vortices. Weight = 430 + 470·smoothstep(0, 1, dye): at rest the text is weight 430 in full ink, and the wakes go up to 900.
## firstFrame
A full-bleed wall of the tracklist in Geist Mono, '01 Ask Me Why  The Beatles  2:27 · 02 …', in calm weight-430 ink on light paper. On load a scripted gust enters from the left at mid-height and splits into two counter-rotating bold vortices. They drift right and dissolve over 2.4s, and the text is quiet again.
## interactions
With a fine pointer, moving gives a gentle stir, and press-and-drag gives a strong stir plus dye. A click drops a radial impulse ring. A flick off the edge leaves a wake that keeps going. Two fingers on touch give two stirrers. Arrow keys push a current in from that side, and R calms the wall over 600ms. It has no other controls.
## choreography
Derive full choreography yourself: every entrance, hover, press, drag, release, value change and exit with durations and easing tokens.
## states
Loading, empty, error, reduced-motion, mobile, hidden-tab — design each.
## content
Herb's recent tracks from getRecentTracks(): numbered titles, artists and running times repeated to fill the wall. The Please Please Me tracklist is the fallback.
## tech
WebGL2: one full-screen pass. A glyph atlas holds every character in use at 17 weight masters (100 to 900 in steps of 50), drawn once with Canvas2D at cell size × DPR. Per pixel: cell = floor(frag / cellSize), the character index comes from an R8 text texture, and weight comes from the dye texture (R16F) sampled bilinearly. The shader mixes the two neighbouring weight masters, so weight is continuous, and anti-aliasing holds because the masters are rasterised at device resolution. The fluid runs on the CPU over preallocated Float32Arrays, and dye is uploaded each frame with texSubImage2D. There is one ink colour and no accent.
## perfPlan
The fluid costs about 0.6ms of JS per frame at around 6k cells (advection plus 14 Jacobi iterations). Each frame uploads about 12KB and renders one fragment pass with three texture fetches. The simulation sleeps when total |v| and dye are below ε, so the frameloop runs on demand. DPR is capped at 2 (1.5 embedded) with resolutionGovernor. IntersectionObserver and visibilitychange pause it, and the atlas is rebuilt only on resize or DPR change. Every GL object is deleted and loseContext is called on unmount.
## controls
Decide: a small hand-rolled panel with presets only if it serves the one mechanic.
## referenceSkills
creative-shader, r3f-shaders, gesture-ui, web-animation-design as fits
## risks
If the dye is too strong it reads as an abstract smoke demo, so dye is capped to keep every title legible and the wall always looks like a tracklist. The atlas needs ctx.font with weights between hundreds (CSS Fonts 4 numeric weights); fall back to 9 masters if that fails. A coarse simulation can show grid-aligned gusts, which bilinear dye and vorticity confinement hide.
## inspiration
Jos Stam, 'Stable Fluids' (SIGGRAPH 1999); Pavel Dobryakov's WebGL Fluid Simulation (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation); paper marbling; Geist Mono's fixed advance at every weight, which is what makes reflow-free weight motion possible.
## whyHerb
It turns his no-faded-text rule into the medium: emphasis is only ever weight, and here weight is literally the ink that moves. It uses real data and physical motion with consequences. It is a flat, monospaced Swiss wall with nothing decorative at rest. Weight reacts to the pointer through fluid physics, not a proximity hover.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)