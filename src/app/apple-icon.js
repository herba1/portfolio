import { ImageResponse } from "next/og"
import { FaceTile } from "@/lib/face"

// iOS home-screen icon: the same face as the tab, on the page surface. Apple
// rounds the corners itself, so the tile is a plain opaque square.
//
// This emits <link rel="apple-touch-icon">, which is a different rel from the
// live favicon's <link rel="icon">, so the two never compete in the tab strip
// (see ui/AnimatedFavicon.jsx for why the favicon must stay unchallenged).

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(<FaceTile size={180} inset={0.74} />, size)
}
