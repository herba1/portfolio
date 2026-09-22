import { ImageResponse } from "next/og"
import { FaceTile } from "@/lib/face"

// Web app manifest icon (192px, purpose "any"). Prerendered at build.
export const dynamic = "force-static"

export function GET() {
  return new ImageResponse(<FaceTile size={192} />, { width: 192, height: 192 })
}
