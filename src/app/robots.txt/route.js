import { siteUrl } from "../constants.js"

// /robots.txt, written by hand rather than through Next's robots.js so it can
// carry comments and the Content-Signal / Content-Usage lines, none of which
// the generator emits. Prerendered at build. scripts/check-robots.mjs parses
// the output and asserts the invariants below on every `npm run lint`.
//
// Relative imports on purpose: that script runs the handler under plain Node,
// which knows nothing about the `@/` alias.
export const dynamic = "force-static"

// Routes that exist in the build but belong in nobody's index: API handlers,
// the dev-only studio and lab tooling (they 404 in production anyway), the
// tier-list editor, the unpublished test post and the component sandbox.
//
// Never list here: /_next/ (JS, CSS and the image optimizer — Google renders
// pages before indexing them, and blocking the bundle blinds it), /og (share
// cards), /feed.xml, /feed.json, /llms.txt, /opengraph-image.png.
export const DISALLOW = [
  "/api/",
  "/~studio",
  "/taste",
  "/lab",
  "/work",
  "/arcs",
  "/tierlist/*/edit",
  "/test",
  "/experiments/album-card",
]

// Decision, on the record: this site wants to be found, read, quoted and
// cited — by search engines and by AI assistants alike — so every
// vendor-documented crawler is allowed, training crawlers included. Being in
// the corpus is how an assistant comes to know who Herb is. To opt one piece
// out later, add its path to a rule for the training group; don't block the
// tokens. Bing has no training token: it reads the page-level `noarchive` /
// `nocache` directives instead, so those never appear in the site's metadata.
//
// Only tokens with a vendor page. Not listed on purpose: anthropic-ai and
// Claude-Web (retired), cohere-ai (Cohere runs no crawler), GrokBot / xAI,
// DeepSeekBot, Timpibot, omgili (undocumented). Agents that fetch on a user's
// behalf mostly ignore robots.txt and fall under `*` anyway.

// Search indexes, answer engines and user-triggered fetches.
export const SEARCH_AND_ANSWER_BOTS = [
  "Googlebot",
  "Google-Extended", // Gemini grounding and training opt-in
  "Bingbot", // Bing and Copilot
  "OAI-SearchBot", // ChatGPT search index
  "ChatGPT-User", // ChatGPT fetching a page for a user
  "Claude-SearchBot", // Claude search index
  "Claude-User", // Claude fetching a page for a user
  "PerplexityBot",
  "Perplexity-User",
  "Applebot", // Siri, Spotlight, Safari suggestions
  "DuckAssistBot", // DuckDuckGo AI answers
  "Amzn-SearchBot", // Alexa and Rufus (2026 tokens)
  "Amzn-User",
  "MistralAI-User", // Le Chat
  "MistralAI-Index",
  "Meta-WebIndexer", // Meta AI search
  "Meta-ExternalFetcher",
  "facebookexternalhit", // link previews
  "YouBot",
]

// Training corpora.
export const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Amazonbot",
  "CCBot", // Common Crawl, the open corpus many models are trained on
  "MistralAI-Training",
]

// Documented as ignoring robots.txt, trains a model that cites nothing and
// crawls at high volume: no upside. The line is a statement of intent; the
// enforcement, if it is ever needed, is a Vercel firewall rule.
export const BLOCKED_BOTS = ["Bytespider", "TikTokSpider"]

// Content Signals (contentsignals.org): search = index and link to it,
// ai-input = use it to ground and answer, ai-train = learn from it. And the
// IETF AIPREF equivalent, so a crawler reading either gets the same answer.
const SIGNALS = [
  "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
  "Content-Usage: train-ai=y, search=y, ai-use=y",
]

const group = (agents, { allow = "/", disallow = DISALLOW, signals = SIGNALS } = {}) =>
  [
    ...agents.map((a) => `User-agent: ${a}`),
    ...(allow ? [`Allow: ${allow}`] : []),
    ...disallow.map((d) => `Disallow: ${d}`),
    ...signals,
  ].join("\n")

export function robotsTxt() {
  return (
    [
      `# herb.art — the personal site of Herbart Hernandez, design engineer.
# Everything public is fair to crawl, index, quote and cite.
# Summary for assistants: ${siteUrl}/llms.txt`,
      group(["*"]),
      // A crawler that matches a named group reads only that group, so every
      // group repeats the full rule set.
      `# AI assistants and their crawlers: same rules, stated on purpose.
${group([...SEARCH_AND_ANSWER_BOTS, ...TRAINING_BOTS])}`,
      group(BLOCKED_BOTS, { allow: null, disallow: ["/"], signals: [] }),
      `Sitemap: ${siteUrl}/sitemap.xml`,
    ].join("\n\n") + "\n"
  )
}

export function GET() {
  return new Response(robotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
