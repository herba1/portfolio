// Guards /robots.txt against the classic regressions: something under
// /_next/ (or a share card, feed, icon or llms.txt) getting blocked, a
// noindexed page getting robots-blocked (which stops the noindex from ever
// being read), and a named crawler group that forgets the shared disallow
// list and re-opens /api/ to that bot. Parses the real handler output with
// RFC 9309 semantics.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
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
  // noindexed, so the crawler must be able to fetch them and see the tag
  "/test",
  "/intro",
  "/experiments/album-card",
  "/llms.txt",
  "/feed.xml",
  "/feed.json",
  "/sitemap.xml",
  "/og?title=x",
  "/opengraph-image.png",
  "/apple-icon",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/blog/og/start.jpg",
  "/.well-known/security.txt",
  "/_next/static/chunks/main.js",
  "/_next/image?url=%2Fa.png&w=640&q=75",
]
const mustBlock = [
  "/api/spotify/login",
  "/~studio",
  "/~studio/work",
  "/taste",
  "/lab",
  "/work",
  "/arcs",
  "/tierlist/nyc-food/edit",
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
if (!/^Content-Usage: train-ai=y, search=y, ai-use=y$/m.test(txt)) fail("missing Content-Usage line")
if (/^Disallow: \/_next/m.test(txt)) fail("/_next/ must never be disallowed")
if (/^Crawl-delay/m.test(txt)) fail("no Crawl-delay: it only slows indexing")
if (/^Host:/m.test(txt)) fail("no Host line: Yandex-only, ignored by everyone else")

// Bing has no robots.txt training token; it reads these page-level directives
// to drop a site from Copilot answers. They must never ship in the app code
// (comments excluded).
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx|mdx)$/.test(name)) out.push(full)
  }
  return out
}
for (const file of walk("src/app")) {
  const code = strip(readFileSync(file, "utf8"))
  if (/noarchive|nocache|nosnippet|data-nosnippet/.test(code)) fail(`${file} carries a Bing/Copilot opt-out directive`)
}

if (bad) process.exit(1)
console.log(`robots.txt ok — ${allowedBots.length} crawlers × ${mustAllow.length + mustBlock.length} paths`)
