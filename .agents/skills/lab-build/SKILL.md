---
name: lab-build
description: The contract for building one experiment candidate under src/app/lab/<slug>/ for herb.art. Load when generating, evolving, or fixing a lab experiment.
---

# Building a lab experiment

You are building one self-contained experiment page for herb.art. It will be judged by Herb in a dashboard, kept if he likes it, and deleted if he does not. Quality over safety: a bold, finished, single idea beats a cautious kit of parts.

## What a good candidate is

A real interface component or flow, built like it ships in a product: realistic content (names, prices, songs, dates — never lorem), every state (hover, press, focus, disabled, loading, empty), keyboard support, and motion with intent. Put it on a light page with a one-line title above it and nothing else. Read `src/app/song-search` for how a component sits on the page and `src/app/tuner` for instrument-like controls.

## References

Herb's inspiration is packaged as skills on this machine. Before you design, load the one that fits with the Skill tool: `polymarket-skill` for dense data UI and numbers, `grokbot-skill` for page motion and morphing chrome, `agentation-showcase-animations` for self-playing product demos, `agentation-svg-animation` for icon and stroke motion, `creative-shader` only when a shader serves the interface. The taste skill says which is which.

## Where you may write

Only inside `src/app/lab/<slug>/`. A hook refuses writes anywhere else. Never edit `experiments/page.js`, `LINKS.js`, `globals.css`, or any other experiment.

## Files

For UI work: `page.js` → `XExperience.jsx` (page shell, mock data, state) → one or more component files (`XPalette.jsx`, `XRow.jsx`) → `x.css`. Follow `src/app/ink` only when the piece is a shader. Read the reference before you start.

- `page.js` — already scaffolded; metadata plus `<XExperience />`. Keep it.
- `XExperience.jsx` — `"use client"`, owns state, mounts the scene through `@/app/ui/ClientOnly` when it touches `window` or WebGL.
- `XScene.jsx` — the R3F canvas or DOM stage.
- `xParams.js` — defaults, control groups, presets when the piece is tunable.
- `XControls.jsx` — a hand-rolled panel over the groups. Never leva.
- `x.css` — scoped styles, prefixed with the slug.
- `experiment.json` — manifest. Update `title`, `description`, `tags`, `intent` when done.

## Stack

Next.js 16 app router, React 19, Tailwind v4 with the tokens in `src/app/globals.css`, `@react-three/fiber` + `drei` + `three` for WebGL, `gsap` and `motion` for motion. `lucide-react` for icons. Nothing new in package.json.

## Non-negotiable

- No comments in code. None. Names carry the meaning.
- Type comes from tokens: `text-ui`, `text-ui-lg`, `text-body`, `text-heading`, `text-title-sm` and friends. Never a bare `letter-spacing`, never `tracking-*` utilities, never a bare numeric `font-weight`.
- Vertical spacing on the 4px grid. `p-1.5`, `py-2.5`, `mt-0.5` are banned.
- No all-caps UI text. No faded text for de-emphasis; step weight down instead.
- Light palette by default: `bg-surface`, `text-ink`, `border-line`, `text-accent`. Flat, Swiss, typographic. No fake glass, no fake 3D objects, no parallax hero.
- Gradients are multi-stop and eased, never a two-stop fade.
- Every page root sets `font-synthesis: none`, `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`.
- WebGL: guard against `window` on the server, size to the container, stop the frame loop when the tab is hidden, dispose on unmount.
- Mobile works: below 900px the piece still reads and the controls collapse.
- No new dependencies. No network calls to services that need keys. No Playwright.
- React 19 lint is strict and the gate runs it: never call `setState` synchronously inside a `useEffect` body (subscribe or use callbacks instead); never mutate a value returned from `useMemo`/`useRef` during render; no `Date.now()`, `Math.random()` or DOM reads during render — do them in effects or handlers; keep hook dependency arrays complete.
- Every `margin`, `padding`, `gap` that is vertical is a multiple of 4px in CSS too (`gap: 6px` fails).
- Fill `experiment.json` `title` and `description` before you finish; the gate rejects empty ones.

## Work order

Get a first working version on screen fast, run `node scripts/lab-gate.mjs <slug>` immediately, then polish. Do not leave the gate for the end — it is where runs die.

## Finish

Run `node scripts/lab-gate.mjs <slug>` and fix until it prints PASS. Then fill `experiment.json` and reply `DONE <slug>`.
