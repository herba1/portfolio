# Ideation brief: interaction experiments for herb's portfolio lab

herb is a design engineer. His site has a lab of interactive pieces, and each is one component alone on a page. The existing pieces are listed in existing.md in this folder, and anchors-grid.jpg plus three single screenshots show what the shipped ones look like. Open the images before you start.

## The bar (read this twice)
herb just rejected three pieces as "terrible, ugly, tacky": a cover printed on silk, a cover on a glass pane that shatters, and venetian blinds with covers on the slats. Why they failed:
- **Gimmick concept.** "Album cover printed on material X, do X's verb" is a template, not an idea. It is tacky.
- **Cheap look.** Dark muddy rooms with radial-gradient vignettes, the subject huge in the middle, 2D canvas fakes of 3D, no real light.
- **Nothing to want.** Nobody would choose to look at them twice.

What herb's shipped work has: real photographic subjects and materials, airy light or pure black grounds, a small precise object with lots of negative space, product-photography lighting, restraint, and one gesture whose result is physically right and quietly surprising. Taste references: Rauno Freiberg, Emil Kowalski, Paco Coursey, Family (benji), Apple's HIG motion, Teenage Engineering, Shopify Editions (a plain surface over a deep toy), Bruno Munari, Dieter Rams. Interaction-first: no captions, no text, beautiful motion.

## Hard bans (an idea that hits any of these is dead)
- An album cover printed on, or mapped onto, some material.
- A recreation of a known OS or app pattern (Cover Flow, long-press menus, pull-to-refresh, carousels).
- Anything already in existing.md, or a close cousin of it.
- Text or labels needed to understand it.
- Neon, glitch, cyberpunk, generic particles, generic fluid "stir it" toys, dark vignette rooms, bokeh-for-its-own-sake.
- An idea whose whole value is "it is physics".

## What a good idea has
- **A moment** you can say in one sentence: what the hand does, and what happens that you didn't expect but instantly believe.
- **A reason to exist**: it reveals something true about a material, a mechanism, a perception or an interface, so it teaches or delights, not just simulates.
- **Restraint**: one object, one verb, finished to the edge.
- **Buildable to a photographic standard** in the browser (WebGL2/three.js, CSS, Canvas) by one strong engineer in a day or two.

## Output
Write ideas to the file named in your task: one JSON object per line with keys
`name` (1-3 words), `lens`, `moment` (one sentence: the gesture and the payoff), `why` (why it is surprising or true, one sentence), `look` (what the screen looks like, one sentence), `build` (the technique, one sentence), `risk` (the most likely reason herb would call it tacky, one honest sentence).
Generate many and fast, then kill your own weak ones before writing. Only write ideas you would bet on.
