// How each piece plays itself while nobody is using it (TileDemos): the
// gesture an invisible visitor makes, driven through the piece's real
// pointer handlers.
//
//   gesture  "tap" | "hold" | "drag" | "hover" (a pass with no press)
//   from/to  where it starts and ends, as fractions of the tile, or
//   on/by    start on one of the piece's own elements (a selector) and move
//            by a fraction of the tile
//   back     drag there and home again before letting go
//   seek     feel for the piece's object from that point (canvas pieces)
//   then     a second step after this one (with `after` ms between)
//
// Pieces that already animate on their own, take typing, or start music or
// the microphone have no entry. A lab manifest's own `demo` (same shape)
// wins over the entry here.
export const DEMOS = {
  "/lab/moire": { gesture: "drag", from: [0.35, 0.5], to: [0.65, 0.55] },
  "/lab/justify": { gesture: "drag", on: ".justify-handle", by: [-0.14, 0] },
  "/lab/blob-track": { gesture: "hover", from: [0.3, 0.4], to: [0.7, 0.6] },
  "/lab/terminal": { gesture: "tap", from: [0.3, 0.45] },
  "/lab/kern": { gesture: "drag", on: ".kern-glyph", by: [0.04, -0.2] },
  "/lab/select": { gesture: "drag", on: ".select-handle-knob", by: [0.08, 0.1] },
  "/lab/steam": { gesture: "hover", from: [0.2, 0.5], to: [0.8, 0.5] },
  "/lab/hold-menu": { gesture: "hold", on: ".hm-cover", then: { gesture: "tap", on: ".hm-veil", after: 1800 } },
  "/lab/coverflow": { gesture: "drag", from: [0.65, 0.45], to: [0.35, 0.45] },
  "/lab/pull-vinyl": { gesture: "drag", from: [0.5, 0.3], to: [0.5, 0.6] },
  "/lab/ascii-bust": { gesture: "drag", from: [0.35, 0.5], to: [0.65, 0.5] },
  "/lab/film-leader": { gesture: "drag", from: [0.5, 0.6], to: [0.68, 0.82] },
  "/lab/ghost-setlist": { gesture: "drag", from: [0.7, 0.5], to: [0.3, 0.5] },
  "/lab/light-table": { gesture: "drag", seek: true, from: [0.45, 0.55], to: [0.55, 0.45] },
  "/lab/raking-light": { gesture: "hover", from: [0.3, 0.4], to: [0.7, 0.6] },
  "/lab/refractor": { gesture: "tap", from: [0.5, 0.5] },
  "/lab/crumple": { gesture: "tap", from: [0.5, 0.5] },
  "/lab/dandelion": { gesture: "drag", from: [0.3, 0.55], to: [0.75, 0.45] },
  "/lab/iris": { gesture: "drag", back: true, from: [0.62, 0.16], to: [0.3, 0.3] },
  "/lab/loupe": { gesture: "hover", from: [0.3, 0.45], to: [0.65, 0.5] },
  "/lab/mirrorball": { gesture: "drag", from: [0.3, 0.5], to: [0.7, 0.5] },
  "/lab/sticker-peel": { gesture: "drag", seek: true, from: [0.6, 0.3], to: [0.45, 0.5] },
  "/scorch": { gesture: "drag", from: [0.4, 0.45], to: [0.62, 0.6] },
  "/stir": { gesture: "drag", from: [0.25, 0.4], to: [0.75, 0.4] },
  "/taffy": { gesture: "drag", from: [0.4, 0.45], to: [0.58, 0.72] },
  "/counter": { gesture: "tap", from: [0.5, 0.5] },
  "/one-line": { gesture: "tap", from: [0.6, 0.78] },
  "/cover-ring": { gesture: "drag", from: [0.35, 0.55], to: [0.65, 0.55] },
  "/blobs": { gesture: "tap", from: [0.5, 0.5] },
  "/ink": { gesture: "tap", from: [0.5, 0.5] },
  "/refract": { gesture: "tap", from: [0.5, 0.5] },
  "/halftone": { gesture: "tap", from: [0.5, 0.5] },
  "/deck": { gesture: "drag", from: [0.65, 0.55], to: [0.4, 0.55] },
};
