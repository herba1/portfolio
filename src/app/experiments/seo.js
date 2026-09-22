import { EXPERIMENTS } from "./list"
import { absoluteUrl, pageMetadata } from "@/lib/seo"
import { ID, JsonLd, breadcrumbNode, graph, webPageNode } from "@/lib/jsonld"

// Metadata and structured data for one experiment page, from the same entry
// the /experiments index renders — one title and one description per piece,
// wherever it is shown.

export function experimentBySlug(slug) {
  const found = EXPERIMENTS.find((e) => e.slug === slug)
  if (!found) throw new Error(`No experiment registered for ${slug} in experiments/list.js`)
  return found
}

export function experimentMetadata(slug, overrides = {}) {
  const e = experimentBySlug(slug)
  return pageMetadata({ title: e.title, description: e.description, path: e.slug, ...overrides })
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
  const data = graph(
    webPageNode({
      path: e.slug,
      name: e.title,
      description: e.description,
      extra: {
        keywords: e.tags.join(", "),
        mainEntity: {
          "@type": "WebApplication",
          "@id": `${url}#app`,
          name: e.title,
          description: e.description,
          url,
          applicationCategory: "DesignApplication",
          operatingSystem: "Web",
          browserRequirements: "Requires a modern browser; the WebGL pieces need WebGL 2.",
          isAccessibleForFree: true,
          keywords: e.tags.join(", "),
          author: { "@id": ID.person },
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
