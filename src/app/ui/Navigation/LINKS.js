export const LINKS = [
  { name: "Top Songs", link: "/covers", primary: true },
  { name: "Writing", link: "/blog", primary: true },
  { name: "Tier List", link: "/tierlist", primary: true },
  { name: "Experiments", link: "/experiments", primary: true },
  // The one page that says who this is, in words. Linked from every page so
  // people, search engines and assistants can all find it in one hop.
  { name: "Bio", link: "/bio", primary: true },
  { name: "Github", link: "https://github.com/herba1" },
  { name: "X", link: "https://x.com/herb_dev" },
  { name: "LinkedIn", link: "https://linkedin.com/in/herbart-hernandez" },
  { name: "Email", link: "mailto:hi@herb.art" },
];

// Internal routes that have no place in the production navbar but should be
// reachable while building locally. Surfaced only in dev / on localhost via
// useIsDev — see DevPalette.
export const DEV_LINKS = [
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
  { name: "Taste", link: "/taste", primary: true, dev: true },
  { name: "Taste Profile", link: "/taste/profile", primary: true, dev: true },
  { name: "Lab", link: "/lab", primary: true, dev: true },
];
