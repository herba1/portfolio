// Guards /robots.txt against the two classic regressions: something under
// /_next/ (or a share card, feed, or llms.txt) getting blocked, and a named
// crawler group that forgets the shared disallow list and re-opens /api/ to
// that bot. Parses the real handler output with RFC 9309 semantics.

import robotsParser from "robots-parser"
import {
  BLOCKED_BOTS,
  SEARCH_AND_ANSWER_BOTS,
  TRAINING_BOTS,
  robotsTxt,
} from "../src/app/robots.txt/route.js"

const SITE = "https://herb.art"
const txt = robotsTxt()
const robots = robotsParser(`${SITE}/robots.txt`, txt)

const mustAllow = [
  "/",
  "/bio",
  "/blog",
  "/start",
  "/experiments",
  "/ink",
  "/tierlist",
  "/tierlist/nyc-food",
  "/covers",
  "/llms.txt",
  "/feed.xml",
  "/feed.json",
  "/sitemap.xml",
  "/og?title=x",
  "/opengraph-image.png",
  "/icon-512.png",
  "/_next/static/chunks/main.js",
  "/_next/image?url=%2Fa.png&w=640&q=75",
]
const mustBlock = [
  "/api/spotify/login",
  "/~studio",
  "/~studio/work",
  "/taste",
  "/lab",
  "/tierlist/nyc-food/edit",
  "/test",
]
const allowedBots = [
  ...SEARCH_AND_ANSWER_BOTS,
  ...TRAINING_BOTS,
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "SomeUnknownBot/1.0",
]

let bad = 0
const fail = (msg) => {
  console.error(`robots: ${msg}`)
  bad++
}

for (const ua of allowedBots) {
  for (const p of mustAllow) if (!robots.isAllowed(`${SITE}${p}`, ua)) fail(`${ua} blocked from ${p}`)
  for (const p of mustBlock) if (robots.isAllowed(`${SITE}${p}`, ua)) fail(`${ua} allowed into ${p}`)
}
for (const ua of BLOCKED_BOTS) if (robots.isAllowed(`${SITE}/`, ua)) fail(`${ua} not blocked`)
if (!txt.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("missing Sitemap line")
if (!/^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m.test(txt)) fail("missing Content-Signal line")
if (/^Disallow: \/_next/m.test(txt)) fail("/_next/ must never be disallowed")
if (/^Crawl-delay/m.test(txt)) fail("no Crawl-delay: it only slows indexing")

if (bad) process.exit(1)
console.log(`robots.txt ok — ${allowedBots.length} crawlers × ${mustAllow.length + mustBlock.length} paths`)
