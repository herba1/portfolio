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

## From batch three (54 pieces, scored 1–5, October 2026)

- Scored 5: Type Bust, Film Leader, Dandelion ("beautiful computer art"), Mirrorball at full speed. Scored 4: Cover Flow, Pull Vinyl, Erase, Split Flap. One striking image-making effect still beats any app chrome.
- Scored 1 and cut: nearly every generic music-app component (search, calendar, queue, volume dial, EQ, like burst, save ring, tab bar, toasts, share sheet, lock screen, player sheet, crossfade, wave scrub, Wrapped). A plain app component re-skinned with album art is "lame", "boring", "wack". UI pieces must carry a real visual idea.
- Not everything is the Beatles. Using one band on every piece read as lazy; mix subjects, and a piece need not be about music at all. Visually pleasing, cool or fun is enough.
- Reach for deeper sources: award-level sites (Awwwards, FWA, Codrops) and top component work, and rebuild their actual techniques from source rather than paraphrasing a screenshot.
- Transitions must stay coherent: things move out of the way rather than fading, a drag becomes the type rather than two effects side by side, morphs that break on enter or exit sink a piece.
- Don't over-decorate a liked effect: one sticker, not a pile; the paper and the type, not the typewriter's keyboard; the cassette and a pencil, not a desk.
- Realism, slow and eased, when the subject is a physical material (Crumple: "should have kept it realistic, and slow, with ease"). The stepped Spider-Verse frame rate was a miss. Batch four refined this: realistic paper should crumple in discrete stages (each press is one more crush), not as one smooth continuous squeeze.
- Let the UI show a quality instead of labelling it: re-theme from a cover without printing the swatches.

## From batch four (50 pieces, scored 1–5, October 2026)

- Scored 5: Type Bust, Dandelion, Sticker Peel. Scored 4: Film Leader, Mirrorball, Pull Vinyl, Erase, Hold Menu, Ink Drag, Iris, Raking Light, Crumple. Pieces that survived two rounds of notes keep climbing; polishing a liked piece pays better than inventing a new one.
- Every brand-new piece except Linocut, Steam, Ribbon and Ghost Type scored 1 or 2: oil paint, caustics, rack focus, reeded glass, golden hour, lanyard, folded note, lumen print, murmuration, smear, screen glow, x-ray, wet type, slime type. Simulating a physical process or a photographic effect is not enough by itself; "Golden Hour" drew "Jesus this is bad", Lanyard "overdone and design is horrendous", Booster "too ugly".
- Plotter's stipple mode was the one good part ("just stipple is the best"): when a piece has several modes, the best one alone usually beats the menu.
- Music-object pieces that had become desk props (cassette, groove zoetrope, album open, type fly, shredder, booster pack) were cut. Keep a music object only when the object itself is gorgeous (a "sick" CD, a mirrorball).
- Notes on the keepers ask for: fewer glitches, smoother transitions, real springs instead of bad eases, less chrome and fewer shadows (just the sheet and the stamper), no overlapping elements, and letting people bring their own image or place their own type.
- Depth reads well: nested menus should stack as layers that recede as you go deeper.

## From batch five (27 polished keepers, scored 1–5, October 2026)

- Scored 5: Dandelion ("pretty"), Sticker Peel ("pretty asf"), Loupe ("clean"). Scored 4: Steam, Pull Vinyl, Erase, Hold Menu, Raking Light, Film Leader, Type Bust, Mirrorball, Light Table. "Pretty" and "clean" are the words that win.
- Cut at 1–2: Plotter even as a proper stipple print, Crate even in real perspective, Ribbon, Linocut, Cover Palette ("meh"), and Ghost Type ("I don't understand it"). If the mechanic needs explaining, it has failed; a heavy rework of a weak piece rarely saves it.
- Crumple reversed again: he now wants it "literally like 8 fps", a stepped, stop-motion frame rate. Treat stepped frame rates as a deliberate style he likes on physical-material pieces, not a bug.
- Motion should be bold where the piece is about a transition ("doesn't feel crazy enough"), and seamless where one thing turns into another ("not smooth into the text").
- Realism is judged hard: the compact disc "looks cheap, not realistic". A realistic object needs real reference-level materials, or it reads as cheap.
- Depth should carry through the whole scene: when menus layer deeper, the album art should recede too. Flaps and boards need real perspective.
- Sound design is welcome when it is genuinely good (Typewriter).
- Layout must be stable: any shift while browsing ("layout shifty") costs a point.

## From batch six (21 keepers, scored 4–5, October 2026)

- Thirteen 5s, nothing below 4: the polish loop works when each round answers his notes literally. Every reworked piece from batch five rose (Amorph, Crumple, Cover Flow, Split Flap and Hold Menu went 3 or 4 to 5).
- Nothing may pop in. Every surface that appears (a card, a list, a stage after load) arrives with motion; hard edges where content meets a loader are softened with an edge fade.
- Pauses read as broken: a loading hold before the stage appears is as bad as a layout shift. Lerp into the final state instead of waiting and revealing.
- Shared elements must match exactly when they return home: corner radius, size and position, or the close reads as a shift.
- Stepped frame rate is liked, but the whole action must still be quick (about a second per crumple step).
- Realism means real, not idealised: "no disc is this polished irl". Match the imperfect look of real objects in good photos, not a perfect render.
- Shader pieces can go harder: stronger distortion, bloom.
- Use real names on the objects (the sticker should say Abbey Road).

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
