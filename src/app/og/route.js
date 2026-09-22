import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { title as siteName } from "@/app/constants"
import { FaceSvg } from "@/lib/face"

// Generated share card: /og?title=…&description=…
//
// Every route that has no hand-picked image gets one of these from
// lib/seo.js, so a shared link always shows what was shared instead of the
// site-wide default. Layout: the pixel wordmark and the face up top, the
// page's title and description along the bottom, all on the page surface.

export const runtime = "nodejs"

const W = 1200
const H = 630
// White, not the page surface: the wordmark is cropped out of the hand-made
// card, which is white, and the two have to sit on the same ground.
const SURFACE = "#ffffff"
const INK = "#1a1a1a" // --neutral-950
const SECONDARY = "#64748b" // --neutral-500

// src/app/opengraph-image.png is the hand-made site card: the wordmark
// centred in a 1200×630 field. This is the box its ink occupies, so it can
// be cropped out and reused as a lockup here.
const WORDMARK = { x: 60, y: 200, w: 1080, h: 230 }

let wordmarkPromise
function loadWordmark() {
  wordmarkPromise ??= readFile(join(process.cwd(), "src/app/opengraph-image.png"))
    .then((buf) => `data:image/png;base64,${buf.toString("base64")}`)
    .catch(() => null)
  return wordmarkPromise
}

function Wordmark({ src, height }) {
  const s = height / WORDMARK.h
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        overflow: "hidden",
        width: Math.round(WORDMARK.w * s),
        height,
      }}
    >
      {/* Satori (the renderer behind ImageResponse) draws plain <img>;
          next/image has no meaning inside a generated PNG. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={Math.round(W * s)}
        height={Math.round(H * s)}
        style={{ position: "absolute", left: -Math.round(WORDMARK.x * s), top: -Math.round(WORDMARK.y * s) }}
      />
    </div>
  )
}

const clean = (s, max) =>
  (s || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const title = clean(searchParams.get("title"), 90) || siteName
  const description = clean(searchParams.get("description"), 180)
  const wordmark = await loadWordmark()

  // Long titles step down rather than wrap into a third line.
  const titleSize = title.length <= 18 ? 96 : title.length <= 36 ? 72 : 56

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: SURFACE,
          color: INK,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {wordmark ? (
            <Wordmark src={wordmark} height={44} />
          ) : (
            <div style={{ fontSize: 40, letterSpacing: "-0.02em" }}>{siteName}</div>
          )}
          <FaceSvg size={104} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: titleSize,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              maxWidth: 1040,
            }}
          >
            {title}
          </div>
          {description ? (
            <div
              style={{
                marginTop: 24,
                fontSize: 30,
                lineHeight: 1.3,
                letterSpacing: "-0.015em",
                color: SECONDARY,
                maxWidth: 960,
              }}
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  )
}
