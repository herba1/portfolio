---
name: view-transitions
description: How page transitions and persistent (shared) elements work on herb.art — the kit in src/app/ui/transitions, built on React 19.3 <ViewTransition> + Next 16.4 transitionTypes. Load before adding a route-to-route morph, a page enter/exit, a back link, or anything that touches view-transition CSS.
---

# View transitions on herb.art

Everything lives in `src/app/ui/transitions/`. Use the kit; do not hand-roll `<ViewTransition>`, `document.startViewTransition`, or `view-transition-name` in route code.

| Piece | What it does |
|---|---|
| `PageTransition` | Mounted once in `src/app/layout.js`. Wraps every page in `<ViewTransition key={pathname}>` so a route change is an **exit** of the old page and an **enter** of the new one. `default="none"` means nothing else (Suspense reveals, `router.refresh()`, server actions, HMR) ever replays the page animation. |
| `Shared` | A persistent element across routes. Same `name` on both pages → the browser flies one into the other. Only named while both ends exist, so it never detaches from the page on other navigations. |
| `TransitionLink` | `next/link` with a `back` prop. `back` sends the `nav-back` type so the page slides the other way. |
| `NAV_BACK` / `NAV_FORWARD` / `OPEN_DETAIL` | Transition types: direction, and index → detail morphs. |
| `flyAlongArc` | Rewrites a shared element's flight into a curve. Used by `Shared`'s `arc` prop. |
| `transitions.css` | Every view-transition rule on the site: page enter/exit, morph presets, the static navbar and footer clock, reduced motion. |

## Recipes

Persistent element between two routes:

```jsx
import Shared from '@/app/ui/transitions/Shared'

<Shared name={`cover-${id}`}>
  <img src={src} alt="" />
</Shared>
```

Render the same `<Shared name>` on the other route. Names must be unique on a page and valid CSS idents.

Props:
- `morph="solid"` (default): no cross-fade. Use it when both ends show the same pixels (same image, same dot).
- `morph="fade"`: cross-fade. Use it when the two ends look different (thumb → hero with a caption).
- `morph="handoff"`: the old end holds solid for 60% of the flight, then fades out over the live new end. Use it when the destination animates itself in. The blog title uses it, landing and then dissolving into the post's glitch-in.
- `on={OPEN_DETAIL}`: only morph on navigations carrying that transition type (a string or an array). Put the same type on the link (`transitionTypes={[OPEN_DETAIL]}`). Use it when the return trip lands inside an entrance animation that would spoil the morph; the blog index's list entrance is one.
- Wrap text in an `inline-block` span before sharing it. A block element's box is the full column width, and two different widths scale the text mid-flight.
- `arc={0.15}`: curved flight. Positive bulges up, negative bulges down. The number is the bulge as a fraction of the distance travelled; 0.1–0.3 reads as natural.
- `className="morph-nav"`: for anything inside the navbar. It paints the flight above the navbar group. The nav is plain ink during transitions, so a `bg-current` element reads correctly.

Back link:

```jsx
<TransitionLink back href="/blog">Back to writing</TransitionLink>
router.push('/tierlist', { transitionTypes: [NAV_BACK] })
```

Plain `next/link` and `router.push` already animate forward. You only need the kit for `back`.

To check a transition frame by frame, pause every `document.getAnimations({ subtree: true })` whose `effect.pseudoElement` starts with `::view-transition`, once the transition's `ready` resolves. Then seek `currentTime` and screenshot. The page must be visible: a hidden tab or pane skips view transitions entirely.

## Rules learned the hard way

- **Never give a whole page a fixed name.** A named element morphs its geometry. Navigating from a scrolled page made the old page's box start thousands of pixels up, and the group swept it down the screen. Keyed enter/exit has no geometry to morph. That is why `PageTransition` keys by pathname.
- **No transform or opacity entrance on an ancestor of a `Shared` target.**
  - If an ancestor is mid-translate when the new page is measured, the morph lands on the wrong spot and then jumps.
  - If an ancestor is still fading when the overlay lifts, the element that just flew in dims back up.
  - Animate the siblings instead (see `.tl-rise` in `globals.css`).
- **Don't let a named element blend during a transition.** In the frame where Chrome captures the old state, a named element is painted isolated, so `mix-blend-mode` has nothing to act on. The white `exclusion` nav flashed white for one frame on every navigation. `transitions.css` switches the nav and footer clock to plain ink while `:active-view-transition` matches. Any new blended chrome needs the same treatment.
- **Hover state is captured.** The old snapshot is taken mid-click, so a hover colour flies with the element. Pin the rest colour under `:root:active-view-transition` (see `.blog-title-morph`).
- **Static chrome hides its old image.** Old and new snapshots of a transparent element would otherwise stack, and the text reads heavier for the length of the transition.
- **Don't import `motion/react-animate-view`.** On mount it injects `animation-timing-function: linear !important` on every `::view-transition-*`, which flattens every eased transition on the site. For spring or arc motion, write an `onShare` / `onEnter` callback that retimes `instance.group.animate(...)`, the way `arc.js` does.
- **Browser back/forward never animates, by design.** React commits a popstate synchronously inside the event so that scroll restoration lands on the restored page, and that path skips view transitions. It also keeps the transition from stacking on top of the iOS/Android swipe-back animation. Don't try to force it; only in-page back links (`TransitionLink back`) slide down.
- **Stacking:**
  - Groups that exist only in the new state stack last, so an incoming page paints over everything before it.
  - `transitions.css` therefore pins the navbar and footer clock to `--z-index-max`, morphs to `z-index: 1`, and nav morphs above the navbar.
  - Anything else that must stay on top needs its own z-index.
- **The root snapshot stays visible** (`opacity: 1 !important`). React hides it when the root is unaffected, which leaves nothing under the blended nav and clock while neither page is opaque.
- Keep the whole transition under about 460ms. Pointer events pass through during it (`::view-transition { pointer-events: none }`).
- `transitions.css` has a reduced-motion block that zeroes every duration. Don't add per-route ones.

## Motion (framer) alongside

- Inside a page, use `motion/react` `layoutId` for same-page shared layout. `transition={{ layout: { path: arc() } }}` curves those flights. Create `arc()` once at module scope.
- Across routes, always use `Shared`. Motion's projection does not survive a route swap.
