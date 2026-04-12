# herb.art

my portfolio. a playground for interactions, animations, and weird ideas — built in public, always evolving.

**[herb.art](https://herb.art)**

## what's in here

- **draggable hero text** — each letter responds to pointer drags with spring physics and string constraints. goes into an idle demo if you leave it alone
- **multiplayer eyes** — real-time visitor presence via partykit. you can see other people looking around
- **3d gaussian splat** — an actual 3d scan of me, scroll-triggered with a masked reveal that expands on click
- **pixel trail images** — hover over blog images and they pixelate under your cursor with stepped decay
- **3d parallax images** — blog images that tilt and shine based on mouse position
- **view transitions** — native css view transitions between pages, navbar and footer persist
- **glitchy 404** — character-by-character reveal animation on the not found page
- **live clock** — est time in the footer, always ticking
- **dev-only mdx studio** — hidden editor at `/~studio` for writing blog posts (dev mode only, invisible in prod)

## stack

next.js 15, react 19, tailwind 4, gsap, lenis, three.js, framer motion, mdx, partykit, posthog

## run it

```bash
git clone https://github.com/herba1/portfolio.git
cd portfolio
npm install
npm run dev
```

open [localhost:3000](http://localhost:3000)

## build in public

this is an ongoing project — features get added, experiments get tried, things break and get fixed. the repo is open source so feel free to poke around, steal patterns, or open an issue if something catches your eye.