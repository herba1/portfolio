import { ImageResponse } from "next/og"
import { FaceTile } from "@/lib/face"

// Web app manifest icon (512px, purpose "any"). Prerendered at build.
export const dynamic = "force-static"

export function GET() {
  return new ImageResponse(<FaceTile size={512} />, { width: 512, height: 512 })
}
