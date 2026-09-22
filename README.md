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

next.js 16, react 19, tailwind 4, gsap, lenis, three.js, framer motion, mdx, partykit, posthog

## seo + geo

everything a search engine or an ai assistant reads about the site comes from one place, `src/app/constants.js` — name, role, employer, description, profiles. from there:

- `src/lib/seo.js` — `pageMetadata()` builds a full per-route card (title, description, canonical, open graph, twitter, feed links). every page uses it; posts spell theirs out in the mdx (see `BLOG.md`)
- `src/lib/jsonld.js` — schema.org graph: `WebSite` + `Person` + `Organization` once in the root layout, then `ProfilePage` / `BlogPosting` / `CollectionPage` / `WebApplication` / `BreadcrumbList` nodes per page, all linked by `@id`
- `/og?title=…&description=…` — generated share card for any page without a hand-picked image (`src/app/og/route.js`); the home page keeps `opengraph-image.png`
- `/robots.txt` — hand-written route so it can carry `Content-Signal` lines; every documented ai crawler is allowed on purpose. `npm run lint:robots` checks it never blocks `/_next/`, the feeds or the cards
- `/sitemap.xml` — every indexable route with `lastmod` from git, `/llms.txt` — the site summarised for language models, `/feed.xml` + `/feed.json` — the writing
- icons — the tab favicon is drawn live (`AnimatedFavicon`); the same face, still, is served at `/apple-icon`, `/icon-192.png`, `/icon-512.png` and `/icon-maskable-512.png` from `src/lib/face.js`
- indexnow — `.github/workflows/indexnow.yml` pings bing & co. with the sitemap after each production deploy (`npm run indexnow` by hand)
- optional env: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` and `NEXT_PUBLIC_BING_SITE_VERIFICATION` render the ownership meta tags for search console / bing webmaster tools

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