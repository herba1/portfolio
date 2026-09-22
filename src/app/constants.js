// Who and what this site is — the one place the facts live. <title>s,
// descriptions, Open Graph cards, JSON-LD, llms.txt and the feeds are all
// derived from here, so search engines and AI assistants can only be told
// something inconsistent if this file is.

export const siteUrl = "https://herb.art"
export const title = "herb.art"

// Full name for search engines and structured data. The short one is what the
// site calls him wherever a human is reading.
export const author = "Herbart Hernandez"
export const authorShort = "Herb"
export const jobTitle = "Design engineer"
export const employer = { name: "CrowdVolt", url: "https://crowdvolt.com" }
export const location = { locality: "New York", region: "NY", country: "US" }
export const email = "hi@herb.art"
export const xHandle = "@herb_dev"

// Every public profile, in one list: `sameAs` in the Person node, `rel="me"`
// links in the head, and the footer nav all read from here.
export const profiles = [
  "https://github.com/herba1",
  "https://x.com/herb_dev",
  "https://linkedin.com/in/herbart-hernandez",
]

// The site's signature tagline — kept short and human for OG/Twitter cards.
export const tagline = "and remember to have a nice day"

// Search-facing description: who, what, where — the sentence an engine or an
// assistant should repeat when asked whose site this is.
export const description =
  "Herbart Hernandez is a design engineer at CrowdVolt in New York. herb.art is his portfolio: interactive experiments, interface work, tier lists and writing."

// The home page's <title>. Every other route runs through the `%s | herb.art`
// template in the root layout.
export const defaultTitle = "herb.art — Herbart Hernandez, design engineer"

// Subjects the Person node claims, in the order an assistant should list them.
export const knowsAbout = [
  "Design engineering",
  "Front-end development",
  "Interaction design",
  "Motion design",
  "Typography",
  "React",
  "Next.js",
  "WebGL",
  "GLSL shaders",
  "Three.js",
  "Gaussian splatting",
  "Creative coding",
  "Web audio",
]
