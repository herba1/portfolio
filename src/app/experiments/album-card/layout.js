import { pageMetadata } from "@/lib/seo"

// A component sandbox, not a finished piece: reachable, but kept out of
// search indexes. (page.js is a client component and can't export metadata.)
export const metadata = pageMetadata({
  title: "Album card",
  description: "A sandbox for the album card component.",
  path: "/experiments/album-card",
  noindex: true,
})

export default function AlbumCardLayout({ children }) {
  return children
}
