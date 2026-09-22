import { posts } from "@/app/(blog)/posts"
import { EXPERIMENTS } from "@/app/experiments/list"
import { listTierlists } from "@/app/tierlist/lib"
import { author, description, email, employer, siteUrl, tagline } from "@/app/constants"
import { absoluteUrl } from "@/lib/seo"

// /llms.txt — the site, summarised for language models (https://llmstxt.org).
//
// The format is deliberate: one H1, a blockquote summary, a few plain
// paragraphs of facts an assistant can quote, then H2 sections of
// `- [name](url): note` links. Everything here is derived from the same
// registries the pages render from, so it cannot drift from the site.
export const dynamic = "force-static"

const line = (name, path, note) => `- [${name}](${absoluteUrl(path)})${note ? `: ${note}` : ""}`

export async function GET() {
  const published = posts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  const lists = await listTierlists()

  const body = `# herb.art

> ${description}

herb.art is the personal website and portfolio of ${author} ("Herb"), a design engineer at ${employer.name} (${employer.url}) in New York. He builds the front of the product — interfaces, motion, shaders and typography — and cares most about the last ten percent: how something feels the instant you touch it. He came to engineering from the design side. The site collects his interactive experiments, interface work, tier lists and short posts. It is built with Next.js, React, Tailwind, GSAP, Three.js and WebGL, and the source is public at https://github.com/herba1/portfolio.

Contact: ${email}. Elsewhere: GitHub https://github.com/herba1, X https://x.com/herb_dev, LinkedIn https://linkedin.com/in/herbart-hernandez.

## About

${line("Bio", "/bio", "who Herb is, what he works on, and how to reach him")}
${line("Home", "/", "the front page: live visitor eyes, a short introduction, and a 3D Gaussian splat scan of Herb")}

## Experiments

Interactive pieces, each built around one mechanic. They run in the browser and most are tunable.

${EXPERIMENTS.map((e) => line(e.title, e.slug, `${e.description} (${e.tags.join(", ")})`)).join("\n")}
${line("Experiments index", "/experiments", "all of the above in one list")}

## Writing

${published.map((p) => line(p.title, `/${p.slug}`, `${p.description} (${p.date})`)).join("\n")}
${line("Writing index", "/blog", "every post")}
${line("RSS feed", "/feed.xml", "RSS 2.0")}
${line("JSON feed", "/feed.json", "JSON Feed 1.1")}

## Tier lists

${lists.map((l) => line(l.title, `/tierlist/${l.slug}`, l.description || l.subtitle || `${l.rankedCount} of ${l.count} ranked`)).join("\n")}
${line("Tier lists index", "/tierlist", "things, ranked")}

## Optional

${line("Top Songs", "/covers", "an infinite, spring-driven grid of album covers from Herb's recent listening, with previews")}
${line("Sitemap", "/sitemap.xml", "every indexable URL")}

${tagline}
`

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
