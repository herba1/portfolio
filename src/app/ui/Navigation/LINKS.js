export const LINKS = [
  { name: "Top Songs", link: "/covers", primary: true },
  { name: "Writing", link: "/blog", primary: true },
  { name: "Tier List", link: "/tierlist", primary: true },
  { name: "Tuner", link: "/tuner", primary: true },
  { name: "PSA", link: "/psa", primary: true },
  { name: "Deck", link: "/deck", primary: true },
  { name: "Github", link: "https://github.com/herba1" },
  { name: "X", link: "https://x.com/herb_dev" },
  { name: "LinkedIn", link: "https://linkedin.com/in/herbart-hernandez" },
  { name: "Email", link: "mailto:hi@herb.art" },
];

// Internal routes that have no place in the production navbar but should be
// reachable while building locally. Surfaced only in dev / on localhost via
// useIsDev — see NavLinks + NavMenu.
export const DEV_LINKS = [
  { name: "Work", link: "/work", primary: true, dev: true },
  { name: "Studio", link: "/~studio", primary: true, dev: true },
  { name: "Work Studio", link: "/~studio/work", primary: true, dev: true },
  { name: "Experiments", link: "/experiments", primary: true, dev: true },
  { name: "Intro", link: "/intro", primary: true, dev: true },
  { name: "Isolate", link: "/isolate", primary: true, dev: true },
  { name: "Arcs", link: "/arcs", primary: true, dev: true },
];
