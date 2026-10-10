export const LINKS = [
  { name: "Top Songs", link: "/covers", primary: true },
  { name: "Experiments", link: "/experiments", primary: true },
  { name: "Github", link: "https://github.com/herba1" },
  { name: "X", link: "https://x.com/herb_dev" },
  { name: "LinkedIn", link: "https://linkedin.com/in/herbart-hernandez" },
  { name: "Email", link: "mailto:hi@herb.art" },
];

// Internal routes that have no place in the production navbar but should be
// reachable while building locally. Surfaced only in dev / on localhost via
// useIsDev — see DevPalette.
export const DEV_LINKS = [
  // Pulled from the public navbar for now; the pages still resolve by URL.
  // Move them back into LINKS to relist them.
  { name: "Writing", link: "/blog", primary: true, dev: true },
  { name: "Tier List", link: "/tierlist", primary: true, dev: true },
  { name: "Bio", link: "/bio", primary: true, dev: true },
  { name: "Work", link: "/work", primary: true, dev: true },
  { name: "Studio", link: "/~studio", primary: true, dev: true },
  { name: "Work Studio", link: "/~studio/work", primary: true, dev: true },
  { name: "Intro", link: "/intro", primary: true, dev: true },
  { name: "Isolate", link: "/isolate", primary: true, dev: true },
  { name: "Arcs", link: "/arcs", primary: true, dev: true },
  { name: "Album Card", link: "/experiments/album-card", primary: true, dev: true },
  { name: "Ask Me Why", link: "/ask-me-why", primary: true, dev: true },
  { name: "Ink", link: "/ink", primary: true, dev: true },
  { name: "Halftone", link: "/halftone", primary: true, dev: true },
  { name: "Refract", link: "/refract", primary: true, dev: true },
  { name: "Blobs playground", link: "/blobs/playground", primary: true, dev: true },
  { name: "Cover ring", link: "/cover-ring", primary: true, dev: true },
  { name: "ASCII cover", link: "/ascii-cover", primary: true, dev: true },
  { name: "Wet ink", link: "/wet-ink", primary: true, dev: true },
  { name: "One line", link: "/one-line", primary: true, dev: true },
  { name: "Counter", link: "/counter", primary: true, dev: true },
  { name: "Taffy", link: "/taffy", primary: true, dev: true },
  { name: "Scorch", link: "/scorch", primary: true, dev: true },
  { name: "Stir", link: "/stir", primary: true, dev: true },
  { name: "Most played options", link: "/covers/rank-lab", primary: true, dev: true },
  { name: "Taste", link: "/taste", primary: true, dev: true },
  { name: "Taste Profile", link: "/taste/profile", primary: true, dev: true },
  { name: "Lab", link: "/lab", primary: true, dev: true },
];
