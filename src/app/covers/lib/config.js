// ---------------------------------------------------------------------------
// Default tunables for the Covers grid.
//
// Every value here is exposed in the Leva panel at runtime. Tweak live, then
// hit "Copy params JSON" and paste the result back to lock in a look.
//
// Units: world space is 1 unit = 1 CSS pixel (matches the book overlay), so
// sizes/offsets below are in pixels and velocities in px/second.
// ---------------------------------------------------------------------------

export const COUNT = 30; // unique covers (laid out 6×5, then tiled infinitely)
export const GRID_COLS = 6;
export const GRID_ROWS = 5;
export const TEX_RESOLUTION = 512;

export const DEFAULTS = {
  // ── Layout ────────────────────────────────────────────────────────────
  tileSize: 210, // px, edge length of a (square) cover
  gap: 170, // px, space between covers — big + dreamy
  cornerRadius: 0.12, // rounded-corner radius (fraction of tile size)
  brickOffset: 0.5, // odd rows shifted by this × cell (0 = grid, 0.5 = brick)

  // ── Motion / input ───────────────────────────────────────────────────
  dragEase: 1.0, // drag → pan multiplier (1 = 1:1 with the finger)
  momentumDamping: 0.92, // per-frame@60 velocity retention after release
  wheelStrength: 2.0, // wheel/trackpad delta → velocity gain
  maxSpeed: 7000, // px/s hard clamp
  stopThreshold: 4, // px/s below which momentum snaps to rest

  // ── Organic follow (the lag — a per-tile position spring that OVERSHOOTS)
  // Centre tiles track tight; edge tiles trail loose + elastic → soft-sheet
  // feel. followDamping < 1 is what gives the overshoot/bounce.
  followResponseCenter: 0.2, // settle time for tiles near centre (snappier)
  followResponseEdge: 0.45, // settle time for tiles at the edges (looser lag)
  followDamping: 0.7, // <1 = overshoot/bounce, organic; 1 = no overshoot
  followJitter: 0.1, // per-tile variance so the trail isn't mechanical

  // ── Squash & stretch (subtle lean in the scroll direction) ───────────
  stretchMax: 0.05,
  stretchRef: 2600, // px/s at which stretch maxes out
  stretchSquash: 0.6, // perpendicular compression
  stretchResponse: 0.32,
  stretchDamping: 0.7,

  // ── Scale springs (soft, slight overshoot) ───────────────────────────
  scaleResponse: 0.42,
  scaleDamping: 0.62,
  centerScale: 0.0, // size bump near centre — OFF by default (was too much)
  centerSigma: 0.5, // gaussian falloff width (× half-viewport)
  hoverScale: 1.03, // barely-there pointer-over bump

  // ── Depth (dreamy, constant — NOT an entry pop) ──────────────────────
  depthFade: 0.4, // far tiles fade toward the background by up to this
  depthStart: 0.5, // normalised distance where the fade begins

  // ── Entrance (one-time reveal — waits for art, then a real spring pop) ──
  // ONE underdamped spring per tile drives scale + rise + opacity together, so
  // the motion overshoots and settles like a physical object (the asymmetric
  // overshoot-then-decay is what reads as "natural" — a monotonic ease can't
  // fake it). Tiles fire on a diagonal wavefront top-left → bottom-right.
  popResponse: 0.4, // spring settle time (smaller = snappier)
  popDamping: 0.55, // <1 = overshoot/bounce (the pop); 1 = no overshoot, linear
  popStagger: 0.03, // s of delay per diagonal step (tighter = crisper wavefront)
  popJitter: 0.5, // per-tile timing scatter (× popStagger) so the line breathes
  popScaleFrom: 0.7, // scale a tile starts at (lower = bigger pop; 1 = no grow)
  popRise: 28, // px the tile rises into place as it springs in
  popReadyTimeout: 8.0, // s safety net to reveal anyway if art never loads

  // ── Background ────────────────────────────────────────────────────────
  bgTint: 0.3, // how strongly the warm backdrop adopts the focused hue

  // ── Accessibility ─────────────────────────────────────────────────────
  reducedMotion: false, // auto-detected on mount; flattens lag + cascade
};
