// schema.org structured data, built from src/app/constants.js.
//
// Every node carries a stable `@id` so pages can point at the site-wide
// Person / WebSite / Organization nodes (emitted once, in the root layout)
// instead of restating them. Search engines and AI assistants then see one
// entity — Herbart Hernandez, design engineer at CrowdVolt — referenced from
// every page rather than a slightly different copy on each.
//
// Types in use: WebSite, Person, Organization (CrowdVolt only), WebPage and
// its ProfilePage / CollectionPage subtypes, Blog, BlogPosting,
// BreadcrumbList, ItemList, CreativeWork, ImageObject, PostalAddress.
// Not used, on purpose: FAQPage, HowTo, SearchAction (retired), any
// SoftwareApplication subtype (its rich result demands prices and ratings),
// AggregateRating/Review, an Organization for herb.art itself.

import {
  author,
  authorShort,
  description as siteDescription,
  email,
  employer,
  jobTitle,
  knowsAbout,
  location,
  personDescription,
  profiles,
  siteUrl,
  title as siteName,
  xHandle,
} from "@/app/constants"
import { absoluteUrl } from "./urls"

export const ID = {
  website: `${siteUrl}/#website`,
  person: `${siteUrl}/#person`,
  employer: `${siteUrl}/#crowdvolt`,
  blog: `${siteUrl}/blog#blog`,
}

export const SITE_IMAGE = `${siteUrl}/opengraph-image.png`

// An inline reference to the Person: the @id, plus the name and URL that
// Google's Article guidelines want on an author without following the id.
export function personRef() {
  return { "@type": "Person", "@id": ID.person, name: author, url: `${siteUrl}/bio` }
}

export function personNode() {
  return {
    "@type": "Person",
    "@id": ID.person,
    name: author,
    alternateName: [authorShort, xHandle.replace(/^@/, "")],
    givenName: "Herbart",
    familyName: "Hernandez",
    url: siteUrl,
    mainEntityOfPage: `${siteUrl}/bio`,
    jobTitle,
    description: personDescription,
    email,
    worksFor: { "@id": ID.employer },
    address: {
      "@type": "PostalAddress",
      addressLocality: location.locality,
      addressRegion: location.region,
      addressCountry: location.country,
    },
    knowsAbout,
    sameAs: profiles,
  }
}

export function employerNode() {
  return {
    "@type": "Organization",
    "@id": ID.employer,
    name: employer.name,
    url: employer.url,
  }
}

export function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": ID.website,
    url: siteUrl,
    name: siteName,
    // Google's site-name feature reads these as the other names the site
    // goes by, in order of preference.
    alternateName: [author, authorShort],
    description: siteDescription,
    inLanguage: "en-US",
    about: { "@id": ID.person },
    author: { "@id": ID.person },
    publisher: { "@id": ID.person },
    copyrightHolder: { "@id": ID.person },
  }
}

// The three nodes every page shares. Emitted from the root layout.
export function siteGraph() {
  return graph(websiteNode(), personNode(), employerNode())
}

// `image` may be a path/URL string or { url, width, height, caption }.
export function imageObject(image) {
  if (!image) return undefined
  if (typeof image === "string") return { "@type": "ImageObject", url: absoluteUrl(image) }
  return {
    "@type": "ImageObject",
    url: absoluteUrl(image.url),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
    ...(image.caption ? { caption: image.caption } : {}),
  }
}

// A page node. `type` is WebPage or one of its subtypes (ProfilePage,
// CollectionPage…); `extra` is spread last for anything specific. When the
// page also emits a breadcrumb trail (breadcrumbNode with the same final
// path), the two are linked by @id.
export function webPageNode({
  path,
  name,
  description,
  type = "WebPage",
  image,
  datePublished,
  dateCreated,
  dateModified,
  breadcrumb = false,
  extra = {},
}) {
  const url = absoluteUrl(path)
  return {
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name,
    ...(description ? { description } : {}),
    isPartOf: { "@id": ID.website },
    author: { "@id": ID.person },
    inLanguage: "en-US",
    ...(image ? { primaryImageOfPage: imageObject(image) } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateCreated ? { dateCreated } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(breadcrumb ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
    ...extra,
  }
}

// Home › Section › Page trail. `items` is [{ name, path }] in order; the
// node's @id hangs off the last item's URL so its WebPage can point at it.
export function breadcrumbNode(items) {
  const last = items[items.length - 1]
  return {
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(last.path)}#breadcrumb`,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}

// An ordered list of things on an index page. `items` is [{ name, path, description? }].
export function itemListNode(items) {
  return {
    "@type": "ItemList",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absoluteUrl(item.path),
      ...(item.description ? { description: item.description } : {}),
    })),
  }
}

export function graph(...nodes) {
  return { "@context": "https://schema.org", "@graph": nodes.flat().filter(Boolean) }
}

// `<` is escaped so no string in the data can close the script element.
export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  )
}
