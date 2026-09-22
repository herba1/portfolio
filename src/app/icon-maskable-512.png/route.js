import { ImageResponse } from "next/og"
import { FaceTile } from "@/lib/face"

// Web app manifest icon (512px, purpose "maskable"): the face sits inside the
// 80% safe zone so Android's adaptive masks never clip the head.
export const dynamic = "force-static"

export function GET() {
  return new ImageResponse(<FaceTile size={512} inset={0.66} />, { width: 512, height: 512 })
}
