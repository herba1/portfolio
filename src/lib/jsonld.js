// schema.org structured data, built from src/app/constants.js.
//
// Every node carries a stable `@id` so pages can point at the site-wide
// Person / WebSite / Organization nodes (emitted once, in the root layout)
// instead of restating them. Search engines and AI assistants then see one
// entity — Herbart Hernandez, design engineer at CrowdVolt — referenced from
// every page rather than a slightly different copy on each.

import {
  author,
  authorShort,
  description as siteDescription,
  email,
  employer,
  jobTitle,
  knowsAbout,
  location,
  profiles,
  siteUrl,
  title as siteName,
} from "@/app/constants"
import { absoluteUrl } from "./seo"

export const ID = {
  website: `${siteUrl}/#website`,
  person: `${siteUrl}/#person`,
  employer: `${siteUrl}/#crowdvolt`,
  blog: `${siteUrl}/blog#blog`,
}

export const SITE_IMAGE = `${siteUrl}/opengraph-image.png`

export function personNode() {
  return {
    "@type": "Person",
    "@id": ID.person,
    name: author,
    alternateName: authorShort,
    givenName: "Herbart",
    familyName: "Hernandez",
    url: siteUrl,
    mainEntityOfPage: `${siteUrl}/bio`,
    jobTitle,
    description: siteDescription,
    email: `mailto:${email}`,
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
    alternateName: `${author} — portfolio`,
    description: siteDescription,
    inLanguage: "en-US",
    author: { "@id": ID.person },
    publisher: { "@id": ID.person },
    copyrightHolder: { "@id": ID.person },
  }
}

// The three nodes every page shares. Emitted from the root layout.
export function siteGraph() {
  return graph(websiteNode(), personNode(), employerNode())
}

// A page node. `type` is WebPage or one of its subtypes (ProfilePage,
// CollectionPage, AboutPage…); `extra` is spread last for anything specific.
export function webPageNode({
  path,
  name,
  description,
  type = "WebPage",
  image,
  datePublished,
  dateModified,
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
    ...(image
      ? { primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(image) } }
      : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...extra,
  }
}

// Home › Section › Page trail. `items` is [{ name, path }] in order.
export function breadcrumbNode(items) {
  return {
    "@type": "BreadcrumbList",
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
