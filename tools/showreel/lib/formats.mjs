// Output formats. Each one is its own capture: the page is laid out at the
// format's viewport, so a vertical cut is the piece's real narrow layout, not
// a crop of the wide one. The device scale factor gives the camera headroom:
// a 2x zoom on a dpr-2 capture still lands one source pixel per output pixel.
export const FORMATS = {
  // X, YouTube, LinkedIn feeds. 16:9.
  landscape: { out: [1920, 1080], viewport: { width: 1280, height: 720 }, dpr: 2, cursor: "arrow" },
  // Instagram feed, X in-feed square. 1:1.
  square: { out: [1080, 1080], viewport: { width: 800, height: 800 }, dpr: 2, cursor: "arrow" },
  // Reels, TikTok, Shorts, Stories. 9:16. Narrow layout, touch-dot cursor.
  vertical: { out: [1080, 1920], viewport: { width: 432, height: 768 }, dpr: 3, cursor: "touch" },
};

export function formatFor(name, overrides = {}) {
  const f = FORMATS[name];
  if (!f) throw new Error(`Unknown format "${name}". Use one of: ${Object.keys(FORMATS).join(", ")}`);
  return { name, ...f, ...overrides };
}
