// The experiments registry. The index, the sitemap, llms.txt, each piece's
// <head> and its structured data all read from here (see experiments/seo.js).
//
// Fields: slug, title (the short name shown in lists and headings), seoTitle
// (the phrase a search matches — carried by <title> and the share cards),
// description, tags, date (first published, YYYY-MM-DD) and updated (last
// meaningful change to the piece itself, not to its plumbing). Bump `updated`
// by hand when a piece changes; a date that only moves when the work moves
// is the one search engines keep trusting.
export const EXPERIMENTS = [
  {
    slug: "/scorch",
    title: "Scorch",
    seoTitle: "Scorch — burn through a photo print in WebGL",
    description:
      "A real photographic print hanging from its top edge — press to burn and drag to draw the flame, and the dark parts of the photo catch first and run like a fuse. Cut a piece free and it curls and falls away on its own while the rest keeps burning, until the next print shows through underneath.",
    tags: ["WebGL", "Shaders", "Simulation"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/stir",
    title: "Stir",
    seoTitle: "Stir — a fluid simulation that swirls bold type through a tracklist",
    description:
      "My recent tracklist as a wall of monospaced type that drifts like woven cloth, where bold behaves like ink in water — stir it and weight swirls through the letters, tinted by each song's cover, and rides away with them. Swipe along a row and it throws ahead with its neighbours following like threads on a loom, then the cloth settles back into its weave.",
    tags: ["Type", "Simulation", "WebGL", "Music"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/taffy",
    title: "Taffy",
    seoTitle: "Taffy — stretchy kinetic typography you pull apart in WebGL",
    description:
      "A song title set huge in ink that pulls like sugar — grab any letter and it stretches out of the word on strands that neck to a hair and snap, then settles home. Drop it on another letter and the two stay joined by a sagging bridge of ink until you pull it apart or tap the paper for the next title.",
    tags: ["Type", "WebGL", "Physics"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/counter",
    title: "Counter",
    seoTitle: "Counter — an infinite zoom through song titles",
    description:
      "Song titles set huge, each with the next record waiting inside the hole of its o — scroll, swipe or tap and you fall through the letter into the next song. The cover floods the screen, breaks into blocks and dissolves into that album's paper as the next title lands.",
    tags: ["Type", "Canvas", "Music"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/one-line",
    title: "One line",
    seoTitle: "One line — an animated tab bar drawn by a single thread",
    description:
      "A music app's tab bar drawn by one red thread that pulls out of the old icon, runs along the bar and sews itself into the next, tugging each icon as it lands. Hold and drag and the needle stays under your finger, unpicking the old icon as you leave and threading whichever tab you let go on.",
    tags: ["Canvas", "Interface"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/wet-ink",
    title: "Wet ink",
    seoTitle: "Wet ink — a calligraphy ink simulation in WebGL",
    description:
      "A wet-ink brush on fibred paper that keeps drawing by itself — each piece pools where the brush rests, feathers along the fibres and dries dark at its edges before a wash of water rinses it off. Take the brush whenever you like: drag slowly and the ink pools, flick and it thins to a hairline.",
    tags: ["WebGL", "Simulation"],
    date: "2026-10-09",
    updated: "2026-10-09",
  },
  {
    slug: "/cover-ring",
    title: "Cover ring",
    seoTitle: "Cover ring — album covers on a draggable 3D wheel",
    description:
      "Real album covers as thick boards on a spinning wheel — drag to turn it, tilt it with the pointer, and the backs open into mesh gradients drawn from each cover's colours.",
    tags: ["CSS 3D", "Music"],
    date: "2026-10-05",
    updated: "2026-10-05",
  },
  {
    slug: "/ascii-cover",
    title: "ASCII cover",
    seoTitle: "ASCII cover — album art redrawn in characters",
    description:
      "An album cover redrawn as text, one symbol per cell. Click and a ring of the next cover ripples out from your pointer.",
    tags: ["Canvas", "Music"],
    date: "2026-10-05",
    updated: "2026-10-05",
  },
  {
    slug: "/blobs",
    title: "Flower wall",
    seoTitle: "Flower wall — a field of soft flowers in WebGL",
    description:
      "A wall of soft, shaded flowers tiled across the screen in a shader — honeycomb, meadow, rain and pixel frames you tap through.",
    tags: ["WebGL", "Shaders"],
    date: "2026-10-05",
    updated: "2026-10-05",
  },
  {
    slug: "/ink",
    title: "Ink",
    seoTitle: "Ink — a relief-print shader in WebGL",
    description:
      "A photograph pressed into a relief print — one inked stroke per scanline, fraying and breaking into dashes as the tone lifts. Drop in your own image and set the plate.",
    tags: ["WebGL", "Shaders"],
    date: "2026-08-30",
    updated: "2026-08-30",
  },
  {
    slug: "/refract",
    title: "Refract",
    seoTitle: "Refract — a lens-lattice refraction shader",
    description:
      "A colour gradient bent through a lattice of lenses on a bulging plate — each cell magnifies what sits behind it, and red, green and blue bend by different amounts.",
    tags: ["WebGL", "Shaders"],
    date: "2026-08-30",
    updated: "2026-08-30",
  },
  {
    slug: "/halftone",
    title: "Halftone",
    seoTitle: "Halftone — a three-ink misregistered halftone in WebGL",
    description:
      "Three misregistered inks screened onto a plate that bulges and tilts away from you — a photograph reduced to a woven field of dots.",
    tags: ["WebGL", "Shaders"],
    date: "2026-08-30",
    updated: "2026-08-30",
  },
  {
    slug: "/backdrop",
    title: "Backdrop",
    seoTitle: "Backdrop — Apple Music's now-playing backdrop, rebuilt",
    description:
      "A rebuild of Apple Music's dynamic now-playing backdrop — four rotating copies of the artwork, twisted, blurred and pushed through a saturation lift.",
    tags: ["WebGL", "Audio"],
    date: "2026-08-10",
    updated: "2026-08-10",
  },
  {
    slug: "/song-search",
    title: "Song Search",
    seoTitle: "Song Search — an Apple Music search dock",
    description:
      "A search dock that resolves songs, covers and previews from Apple's catalogue — shown on both a light and a dark ground.",
    tags: ["Interface"],
    date: "2026-08-10",
    updated: "2026-08-30",
  },
  {
    slug: "/deck",
    title: "Deck",
    seoTitle: "Deck — fifty album covers on a fanning stack",
    description: "Fifty album covers on a stack you can run through, and fan out.",
    tags: ["CSS", "Motion"],
    date: "2026-07-29",
    updated: "2026-08-10",
  },
  {
    slug: "/flyout",
    title: "Flyout",
    seoTitle: "Flyout — a graded-card collection interaction",
    description: "A collection of graded cards, and the interaction for filling it.",
    tags: ["Motion"],
    date: "2026-08-01",
    updated: "2026-08-02",
  },
  {
    slug: "/tuner",
    title: "Tuner",
    seoTitle: "Tuner — a browser instrument tuner with live pitch detection",
    description:
      "A configurable instrument tuner — live pitch detection on a glowing glass display.",
    tags: ["Audio", "DSP"],
    date: "2026-06-21",
    updated: "2026-08-10",
  },
];
