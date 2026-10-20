---
name: splat-stage
description: How Gaussian splats move between pages on herb.art — the persistent splat stage in src/app/splats/stage (Spark renderer, anchors, flights). Load before adding a splat to a page, changing the /splats carousel or its articles, swapping splat assets, or touching splat motion.
---

# The splat stage

`/splats` (the carousel) and `/splats/[slug]` (an article per splat) share one WebGL canvas. Everything lives in `src/app/splats/`.

| Piece | What it does |
|---|---|
| `stage/stage.js` | Module singleton: the renderer, the Spark `SparkRenderer`, every `SplatMesh`, the frame loop, and the motion of every actor. Survives route changes. |
| `stage/SplatStage.jsx` | The fixed host element the canvas is re-parented into. Rendered by `layout.js`. Named `splat-stage` for view transitions. |
| `stage/SplatAnchor.jsx` | An empty sized box that says "actor X lives here". The only way page code positions a splat. |
| `stage/motion.js` | Hermite flights, toss and rise entrances, arc bulge. |
| `stage/fit.js` | Percentile bounds so floaters don't shrink the subject. |
| `data.js` | The splats: id, file, orientation fix, fit, hero slot, copy, credit. |

## Why a singleton and not an R3F `<Canvas>`

`PageTransition` keys every page by pathname, so a route change remounts everything under it, layouts included. A `<Canvas>` would be destroyed between the index and an article: the context, every decoded splat, and the motion of the splat you clicked. The stage lives outside React, and each mount just re-parents its canvas. The clicked splat is the same live object on both pages and flies between them, still spinning. Nothing is snapshotted.

Spark (not drei `<Splat>`) because all meshes go through one global depth sort, so splats that overlap mid-flight composite correctly, and it renders `.spz` (about a tenth of `.ply`).

## Recipes

Put a splat on a page (any route under `src/app/splats/`):

```jsx
<SplatAnchor actor="cat" slot="article" interactive className="h-[60svh]" />
```

- Same `actor` on two pages → the splat flies from one anchor to the other on navigation.
- `slot` names the anchor so code can blend: `setWeight("cat", "card", 0.4)`. The actor aims at the weighted average of its anchors. Write weights from a scroll handler, not React state.
- `interactive` adds pointer look and drag-to-spin. A drag swallows the click that follows. Give it `touch-action: pan-y`.
- An actor with no anchor (or all weights 0) falls out of frame and fades.

Add a splat: put the file in `public/splats/carousel/`, add an entry to `data.js`. Check orientation and `fit` on the index, a card and the article. Most captures are y-down and need `rotation: [Math.PI, 0, 0]`. Spark 2.3 cannot read SPZ v4 files ("Invalid gzip header"); use .sog or convert.

## Motion rules

- Every flight is a cubic Hermite curve whose start tangent is the actor's current velocity, and it lands at zero velocity. Grabbing it mid-flight bends the path; nothing restarts, nothing overshoots.
- Anchors that move continuously (scroll, the rail track) are tracked exactly, not sprung, so a splat never swims behind its card. That only holds if the track transform is written inside the `scroll` event (before rAF), the way `SplatsIndex` does it.
- A target that jumps more than `JUMP_PX` in one frame starts a flight. Resizes and off-screen targets snap instead.
- First visit: everything that enters in the first 3 s is tossed in from the nearer side. Later entrances rise from below.
- Reduced motion: no tosses, no spin; flights become snaps and fades.

## Performance

- One canvas, one context, never one per card.
- Spark is about 2.6 MB minified; the stage imports it dynamically on first mount.
- Splats are fill-rate bound. The DPR is capped (1.5 desktop, 1.25 touch) and steps down in quarters when the frame time stays above 21 ms.
- Actors off screen are hidden, which takes them out of the sort.
- Loads are queued two at a time; anchored actors first, `preload(id)` on hover.
- Leaving the splat routes stops the loop at once and frees the GPU after 30 s.
- Budget roughly 1.5 M splats on screen for phones (the seven statues total about 620k). Prefer `.sog` or `.spz`.

## Checking it

`window.__splatStage()` (dev only) returns each actor's status, phase, flight and on-screen box. Headless Chromium needs `--use-angle=swiftshader`; it renders correctly but far below real frame rates, so judge paths and end states there, and timing on a real device.

## Rules learned the hard way

- Anchors register from their ref callback, which runs in the commit. On a route change the old anchors drop and the new ones register in the same commit, so the stage sees one jump, never a frame with no anchor (which would read as an exit).
- The back link uses `scroll={false}` and `armReturn(slug)`; the index centres that card in its layout effect. Next's own scroll-to-top runs after the page's layout effect and would undo it.
- `transitions.css` hides the stage's old snapshot and keeps the live canvas painting during a transition, like the navbar. When one side of the navigation has no stage, it fades with the page.

## Motion (entrances, exits, flights)

- First visit: each splat is lobbed in along a quadratic Bézier arc from low on its side, condensing out of specks (the `reveal` uniform in `applyModifier`), with one unwinding turn and a lean into its travel. Return visits curl up from below.
- Exit: thrown along a gravity parabola toward the nearer edge, spinning, dissolving back into specks.
- Moves between anchors: Hermite flight (bend 0.24), a turn of half to one and a half revolutions, and a slight mid-air swell.
- Every entrance and move lands on the item's `front` yaw (data.js). Most of these captures face away at 0 after the `[π, 0, 0]` flip; set `front` per item when swapping assets.
- `reveal` regenerates the mesh's splats when it changes; it is only written while it changes, so a resting splat costs nothing.
- Page text: `.splat-rise` (splats.css) staggers each block in; `.splat-out` (transitions.css) captures each block with `match-element` so it leaves on its own in the view transition. Never put `.splat-rise` on an ancestor of a `Shared` element.
