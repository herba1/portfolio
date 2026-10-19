---
name: taste
description: Herb's taste for interactive experiments, learned from his votes. Load before designing or building anything for herb.art.
version: 1
---

# Taste

Version 1 is seeded from the site itself, Herb's standing instructions, and the experiments already shipped. Every later version is rewritten from votes, pointed elements, and notes by `npm run lab:learn`.

## Focus

- Interfaces, not abstractions. Herb scrapped a whole batch of abstract visual pieces (a WebGPU space explorer, an article-derived Blender workflow page, a CLI front end) as "terrible, abstract, not cool" and asked for UI.
- A candidate is a real interface component or flow with realistic content: a picker, a palette, a table, a composer, a sheet, a HUD, a player. It has hover, press, focus, drag and keyboard states, and it is presented on a light page like a product surface, not a tech demo.
- Shader and WebGL work is welcome only in service of an interface (an artwork-driven accent, a scrubber's waveform), never as the subject.

## References — Herb's inspiration, as skills

Load these with the Skill tool before designing; they are decoded from work Herb admires and carry his taste in type, motion, and interface density. Pick by what the piece is:

- `polymarket-skill` — dense data and trading UI: tokens, typography, 150ms motion ladder, data-attribute state, numbers that never jump. Load for tables, stats, pickers, anything with live values. Sub-skills: `polymarket-motion`, `polymarket-components`, `polymarket-typography`, `polymarket-tokens`.
- `grokbot-skill` — page-level motion and consistency: one house easing, blur focus-pull entrances, staggered reveals, morphing nav and dropdowns, 4-layer card hovers. Load for menus, tabs, sheets, palettes, hero-like reveals. Sub-skills: `grokbot-motion`, `grokbot-tokens`.
- `agentation-showcase-animations` — scripted "set piece" product demos: fake cursors, self-driving UI, timelines built from async delays. Load when the piece should demonstrate itself or play a scenario.
- `agentation-svg-animation` — icon and SVG motion: stroke drawing, morphs, staggered reveals, blink and pulse feedback. Load for any icon, marker, check, or drawn line.
- `creative-shader` — shaders only in service of an interface (artwork-driven accents, waveforms, material behind a control). Load only when a shader earns its place.

## Loves

- One strong mechanic per piece, finished to the edge: Ink is one inked stroke per scanline, Refract is one lens lattice, Halftone is three inks on a plate.
- Physical print and optics as material: relief ink, misregistered inks, glass refraction, paper grain, halos.
- Tunable pieces with a hand-rolled panel and presets, so the visitor can play (Ink, Refract, Halftone).
- Flat Swiss typographic layouts on a light ground; the Tuner is the reference for how an instrument-like UI should sit on the page.
- Motion with weight and consequence: a stack you run through and fan out (Deck), cards that ride and captions that leave (Flyout).
- Real audio and real data driving visuals (Tuner pitch detection, Backdrop's artwork-driven blur, Song Search resolving the real catalogue).
- Fluid, interruptible motion above everything: every move can be grabbed and retargeted mid-flight and still feels smooth. He praised it even on pieces he removed (Mobile: "how fluid and everything is interruptible feels amazing"; Thread: "love the fluidity and interruptibility").
- Type as a physical material: letters pulled like sugar on ink strands (Taffy, "a banger"), a Geist Mono text wall stirred like fluid (Stir, "I love this text kind of thing"), one pen line threading itself through tab icons (One line, "very very good concept").
- One clean idea that works like a real component (Scorch: "a beautiful idea and component"; One line).
- Material realism when it is the subject and he asks for it: paper fibre, print grain and torn perforations (Tear-off, "go for extra realism and texture"), a tape machine whose reels turn with the tape (Tape).
- Organic camera paths: arcs and a little lag rather than dead-straight point-to-point moves (Counter).

## Hates

- Skeuomorphic chrome: fake glass panels, fake 3D UI objects, fake shadows for depth, parallax heroes. Material realism on the subject itself (paper, ink, tape) is a different thing and welcome when he asks for it.
- Wild, wacky or weird effects, even when the interaction feels good: datamosh glitching (Mosh, "too wacky"), psychedelic marbling of covers (Marble, "a bit too wild for my taste"), quadtree mosaics (Quadtree, "too weird"), iron-filing field lines (Filings, "weird and not that cool"), a darkroom developer tray (Develop, "too tacky"), a harp of type sizes (Strum, "nah").
- Too much energy: overshoot and bounce beyond a small settle (Taffy, "way too bouncy"), waves and sway that go everywhere (Thread, "just too crazy"). Elegance over excitement.
- Uncapped speed: zooms and flings that race through content faster than you can read it (Counter, "cap the speed on zoom").
- Frames that feel unrelated to the site, like a booking form wrapped around a brush (Wet ink).
- Anything that gets stuck: an action that stops responding after the first go (Scorch, "I keep trying to add more but it's just getting stuck"), or audio that glitches (Tape, "why does the audio sound fucked").
- All-caps labels, faded low-opacity text, tiny micro-labels that explain what is already visible.
- Two-stop gradients; anything that reads as a default library demo.
- Dark-mode-by-default moodiness; the site is light.
- Feature sprawl: several half-ideas on one page.
- Abstract visual demos with no interface purpose; ideas lifted from articles or repos that have nothing to interact with.

## From the bolder batch (50 WebGL material pieces, scored 1–5, October 2026)

- Scored 5: Split Flap, Sticker Peel, Ink Drag, Refractor, Erase, Groove, Type Bust. Clean, beautiful, one material effect on music content, often with type. Good sound design is noticed and praised (Split Flap).
- Scored 1: anything that is mostly machinery (Jukebox, Lathe, Letterpress, Splice, Patch Bay), chores (Dust, Sand Table), and niche subjects (Strobe, Louvres, Scoreboard, Receipt). "Too much going on" and "too much 3D" are the usual reasons.
- Use real music. Album art from Herb's top songs (`/api/spotify/recent`, the herb.art Top Songs page) or classic records (Revolver, Abbey Road, Rubber Soul, Pet Sounds) instead of stock photos, DJ photos or placeholder cards. `src/app/lab/_music` exports the local Beatles catalogue (`ALBUMS`, `FEATURED`) and `useTopSongs()`, which loads the live top songs and falls back to it.
- Never name Monovolt, Crowdvolt or any made-up brand on a piece.
- Flat beats 3D when the 3D adds nothing (Pins: "might look cooler flat"). Prefer clean graphic design (pure black or a light page, little glow, no background texture) to scenic rooms.
- Stylised beats simulated when realism looks off: a crumple at a Spider-Verse stepped frame rate, old iOS skeuomorphic icons rather than a 3D shredder.
- Glitches, clipping and overlaps sink a piece; fix them before anything else.
- He wants more UI: music-app elements and common components made beautiful and trendy, a little over the top.

## Type vibes — Herb's reference board (October 2026)

Herb shared Pinterest stills and lyric edits as the visual direction for type and UI pieces. What they share:

- Lyric-video type: plain white sans set over moody, grainy night footage or photos (streetlights, rain, city, a turntable), revealed a word or phrase at a time in sync with the line.
- Justified blocks with wide, uneven word gaps; a few words per line, often lowercase, sitting centred or loose in the frame.
- Lo-fi degradation as the effect: blurred type, JPEG-soft serif, pixelated or bitmap letters that break up line by line ("how are you?" in electric blue decaying to pixels).
- Motion-smeared text: words that streak sideways and settle into a justified block, text that types and drags into place.
- Collage and hand: a cut-out paper label on a sky photo, hand-lettered capitals on a photo, a small yellow caption on cobblestones, an annotation bubble on a selected text run.
- Bold grotesk set huge against small type with tight leading, editorial and confident.
- Mood: quiet, sincere, a little melancholy; the text says something human. Photos are real and imperfect, never stock-glossy.

## Rules

- Pick the one thing the piece is about, name it in the title, and make every control serve it.
- Hierarchy by weight, not size. Body at 460, headings 560–600, never 700 unless it is display type.
- Type from tokens only; vertical rhythm on the 4px grid; tabular numerals for any column of numbers.
- Motion easing is eased-out and quick (150–300ms) for UI, slower and physical for the piece itself; nothing bounces unless the mechanic is a bounce.
- Colour: neutral ground, one accent, ink as the strongest colour on the page. Shader pieces may be rich, but the chrome around them stays quiet.
- Controls collapse below 900px; the piece itself must survive a phone.
- Ship with a preset that looks great at load. The first frame is the vote.

## Exemplars

- `/ink` — the canonical shader piece: params, groups, presets, hand-rolled controls, drop-in image.
- `/refract` — same shape, optical material.
- `/tuner` — the reference for instrument-like UI on the light palette.
- `/deck` — the reference for physical DOM motion.

## Open questions

- How much rich colour does Herb want in shader pieces versus the neutral chrome?
- Does he prefer pieces that accept his own media (image, audio) over fixed subjects?
- Sound as an output: Chop (cover pads) and Strum (type harp) were rejected; Tape, where the sound is the song under your hand, is still in play. Sound seems welcome only when it is the real thing, not a synthesised toy.
