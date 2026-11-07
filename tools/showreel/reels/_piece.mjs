// Shared defaults for the experiments-page reels: one 4:5 feed clip per piece.
// Wordless (the piece's own heading, blurb and hints are hidden), the hand on
// screen from frame one, the piece settled when the clip opens, and a loop that
// lands the camera and pointer exactly on frame one while the page dips out
// to its ground and comes back up on frame one (most pieces can't put
// themselves back pixel for pixel, and a crossfade between states reads false).
export const HOME = [0.74, 0.86];

export const WORDLESS = [
  "h1",
  '[class*="hint"]', '[class*="lede"]', '[class*="caption"]',
  '[class*="-head"]:not([class*="t-head"])', '[class*="__head"]',
  '[class*="sound"]', "nextjs-portal",
].join(", ") + " { visibility: hidden !important; }";

export function piece({ hide = [], css = "", beats, home = HOME, ...rest }) {
  const hidden = hide.length ? `${hide.join(", ")} { visibility: hidden !important; }` : "";
  return {
    formats: ["feed"],
    intro: { hold: 1400, zoom: 1, fade: 0, trim: 1300 },
    outro: { hold: 700 },
    loop: { fade: 1000 },
    tempo: 0.8,
    travel: 0.8,
    cursor: { from: home, visible: true },
    ...rest,
    css: [WORDLESS, hidden, css].join("\n"),
    beats: [...beats, { move: home, duration: 700, pause: 300 }],
  };
}
