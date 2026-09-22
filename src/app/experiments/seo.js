import { EXPERIMENTS } from "./list"
import { absoluteUrl, pageMetadata } from "@/lib/seo"
import { ID, JsonLd, breadcrumbNode, graph, personRef, webPageNode } from "@/lib/jsonld"

// Metadata and structured data for one experiment page, from the same entry
// the /experiments index renders — one title and one description per piece,
// wherever it is shown. `seoTitle` (a phrase a search matches: "Ink — a
// relief-print shader in WebGL") is what the <title> and the cards carry;
// `title` stays the short name the index, breadcrumb and heading show.

export function experimentBySlug(slug) {
  const found = EXPERIMENTS.find((e) => e.slug === slug)
  if (!found) throw new Error(`No experiment registered for ${slug} in experiments/list.js`)
  return found
}

export function experimentMetadata(slug, overrides = {}) {
  const e = experimentBySlug(slug)
  return pageMetadata({
    title: e.seoTitle || e.title,
    description: e.description,
    path: e.slug,
    ...overrides,
  })
}

// For pieces whose interface draws no heading of its own: the page's name
// and what it is, for screen readers and crawlers, matching the <title> and
// description exactly. Visually hidden, never a substitute for real copy —
// the pieces that do render a heading (Ink, Refract, Halftone) don't use it.
export function ExperimentHeading({ slug }) {
  const e = experimentBySlug(slug)
  return (
    <>
      <h1 className="sr-only">{e.title}</h1>
      <p className="sr-only">{e.description}</p>
    </>
  )
}

export function ExperimentJsonLd({ slug }) {
  const e = experimentBySlug(slug)
  const url = absoluteUrl(e.slug)
  // CreativeWork, not WebApplication: the software-application types carry a
  // rich result that demands prices and ratings, and a piece without them
  // just reports missing fields forever.
  const data = graph(
    webPageNode({
      path: e.slug,
      name: e.seoTitle || e.title,
      description: e.description,
      ...(e.date ? { datePublished: e.date } : {}),
      ...(e.updated || e.date ? { dateModified: e.updated || e.date } : {}),
      breadcrumb: true,
      extra: {
        keywords: e.tags.join(", "),
        mainEntity: {
          "@type": "CreativeWork",
          "@id": `${url}#work`,
          name: e.title,
          description: e.description,
          url,
          genre: "Interactive web experiment",
          keywords: e.tags.join(", "),
          isAccessibleForFree: true,
          ...(e.date ? { dateCreated: e.date } : {}),
          ...(e.updated || e.date ? { dateModified: e.updated || e.date } : {}),
          author: personRef(),
          creator: { "@id": ID.person },
          inLanguage: "en-US",
        },
      },
    }),
    breadcrumbNode([
      { name: "herb.art", path: "/" },
      { name: "Experiments", path: "/experiments" },
      { name: e.title, path: e.slug },
    ]),
  )
  return <JsonLd data={data} />
}
