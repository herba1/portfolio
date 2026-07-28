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
  // tileSize/gap are the look at REF_VW (a 1440-wide MacBook). The real,
  // on-screen values are derived from the viewport by responsiveLayout() below,
  // so these read as "the reference composition" rather than literal pixels.
  tileSize: 210, // px @1440, edge length of a (square) cover
  gap: 170, // px @1440, space between covers — big + dreamy
  cornerRadius: 0.12, // rounded-corner radius (fraction of tile size)
  brickOffset: 0.5, // odd rows shifted by this × cell (0 = grid, 0.5 = brick)

  // ── Motion / input ───────────────────────────────────────────────────
  dragEase: 1.0, // drag → pan multiplier (1 = 1:1 with the finger)
  momentumDamping: 0.92, // per-frame@60 retention of a THROWN pan (drag release)
  // NOT a speed limit. Nothing clamps how fast the grid may travel any more —
  // capping the pan is what made a hard fling feel like it hit a wall and then
  // kept coasting after your fingers stopped (the clipped travel was still
  // banked, so it drained late). This is the speed at which the follow springs
  // are TIGHTENED instead: a tile trails by ζ·response/π × speed, and response
  // is scaled by 1/(1 + speed/springTrackSpeed), so the trail approaches a fixed
  // ~200px (half a cell) however fast you scroll and never reaches the full cell
  // that reads as the grid coming apart. The pan itself stays 1:1 with you.
  springTrackSpeed: 3600, // px/s — where the follow springs start tightening
  stopThreshold: 4, // px/s below which a throw snaps to rest

  // ── Wheel / trackpad ─────────────────────────────────────────────────
  // A wheel delta is PAN DISTANCE, spent whole on the frame it arrives — it
  // moves the TARGET, and the rendered pan chases that target with one
  // exponential (scrollSmooth). No bank, no per-frame spend cap, no separate
  // glide: every px you scroll lands, in order, and the smoothing is the only
  // thing between the gesture and the grid. A trackpad's own momentum phase
  // therefore plays back exactly as the OS sent it, and a notched mouse wheel
  // gets its glide for free from the same smoothing.
  wheelStrength: 0.8, // px of pan per px of wheel delta (1 = 1:1 with the gesture)
  scrollSmooth: 0.09, // s time-constant the pan chases the scroll target over

  // ── Resistance ────────────────────────────────────────────────────────
  // Weight WITHOUT a cap. Gain falls off as you scroll harder — the pan rate
  // becomes rate^(1 - scrollResist) past the knee — so a gentle scroll is served
  // at full strength, a hard fling gets diminishing returns, and NOTHING ever
  // stops getting faster. That last part is the whole point: a cap makes the
  // grid feel like it hit a wall (and, worse, made the clipped travel arrive
  // late), whereas a falling gain just feels heavy, the way a real object does.
  //   scrollResist 0   = no resistance, perfectly linear
  //   scrollResist 0.35 = a hard fling lands at roughly half the speed it asked for
  //   scrollResist 1   = above the knee the speed barely rises at all (a soft cap)
  scrollKnee: 900, // px/s of requested pan below which there's NO resistance
  scrollResist: 0.35, // 0–1, how fast gain falls off above the knee

  // ── Organic follow (the lag — a per-tile position spring that OVERSHOOTS)
  // Centre tiles track tight; edge tiles trail loose + elastic → soft-sheet
  // feel. followDamping < 1 is what gives the overshoot/bounce.
  // Trail length is ζ·response/π × speed — at the old 0.45/0.7 the edge tiles
  // sat ~200px behind the pan at 2000px/s, which reads as the grid being made
  // of something dense rather than as softness. Roughly halved: still trailing,
  // still overshooting (damping < 1), just no longer dragging.
  followResponseCenter: 0.1, // settle time for tiles near centre (snappier)
  followResponseEdge: 0.22, // settle time for tiles at the edges (looser lag)
  followDamping: 0.82, // <1 = overshoot/bounce, organic; 1 = no overshoot
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
  // Distance from centre drives BOTH opacity and size on the same curve, so a
  // tile receding to the edge reads as moving away rather than just dimming.
  depthFade: 0.4, // far tiles fade toward the background by up to this
  depthScale: 0.28, // …and shrink by up to this (0 = fade only, no scale)
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

  // ── Click push (neighbours recoil from the opened player) ────────────
  // Opening a cover shoves the grid out of the way of the PLAYER CARD. The
  // field is an ELLIPSE stretched to the card's aspect — landscape on desktop,
  // portrait on mobile — but every tile flies straight out along its own ray
  // from the centre. A box field pushes on axis-locked normals, so whole rows
  // slide in lockstep and it reads mechanical; radial directions never repeat,
  // which is what makes the shove feel like a shockwave instead of a drawer.
  // Render-only — it never touches the lattice or the follow springs, so nothing
  // recycles or drifts out of place. Underdamped + distance-scaled response, so
  // the shove travels outward as a ripple, not as one rigid block.
  //
  // The field's SHAPE was elliptical but its FORCE was uniform, which is what
  // made the vertical shove feel violent on desktop: a landscape card leaves
  // only a sliver of headroom above and below, so a full-strength push there
  // ejects tiles off-screen while the same push sideways has room to breathe.
  // pushAnisotropy scales each axis by the field's own proportions, so a wide
  // card shoves mostly sideways — the direction stays radial either way.
  pushStrength: 260, // px of displacement along the field's LONG axis
  pushAnisotropy: 1, // 0 = equal force all round, 1 = scaled by the card's aspect
  pushFalloff: 1.3, // how far past the field edge it reaches, × cell
  pushInflate: 0.5, // grow the field past the card, × tile size
  pushScale: 0.1, // how much shoved tiles shrink (0 = size unchanged)
  pushResponse: 0.46, // spring settle time for the tiles nearest the card
  pushSpread: 0.7, // extra response the farthest tiles get (the ripple lag)
  pushDamping: 0.6, // <1 = overshoot on the way out and back

  // ── Background ────────────────────────────────────────────────────────
  bgTint: 0.3, // how strongly the warm backdrop adopts the focused hue

  // ── Accessibility ─────────────────────────────────────────────────────
  reducedMotion: false, // auto-detected on mount; flattens lag + cascade
};

// ---------------------------------------------------------------------------
// Viewport-derived layout
//
// The grid used to be laid out in hard pixels, so zooming the browser out just
// revealed MORE tiles at the same size instead of scaling the composition. Tile
// size is now proportional to viewport WIDTH against a 1440 reference — zoom out
// and every tile grows with the window, so the same arrangement is always on
// screen.
//
// Two departures from pure proportionality, both for phones:
//   • a floor on tile size, because vw × 210/1440 collapses to ~57px at 390 —
//     unreadable art and an untappable target. Tiles stay near desktop size.
//   • the gap is a RATIO of the tile, ramping down slightly toward narrow
//     viewports. Only slightly: the airiness IS the grid's character, and
//     tightening the ratio hard turns a dreamy field into a dense mosaic. What
//     actually fixed mobile was the smaller tile — a 380px cell on a 390px phone
//     is one cover per screen; the same cell shrinks to ~290 once the tile does.
// ---------------------------------------------------------------------------
export const REF_VW = 1440; // the MacBook width the reference values are tuned at
const NARROW_VW = 420; // at/below this, the mobile end of the ramp applies fully
const TILE_MIN_RATIO = 0.8; // tile floor, × the reference tile (210 → ~168px)
const TILE_MAX_VH = 0.5; // never let a tile exceed half the viewport height
const GAP_RATIO_NARROW = 0.72; // gap ÷ tile on phones (desktop's is ~0.81)
// Depth shrink is a wide-screen effect. It reads as recession only when there
// are enough tiles across for the size difference to look like distance; with
// ~1.3 covers on a phone, the edge tile just looks like a smaller, mismatched
// tile next to the centre one. Near-zero on phones, full strength at REF_VW.
// (Only the SIZE half of the depth falloff ramps — the opacity fade still reads
// correctly at any width, and it's what keeps the edges soft.)
const DEPTH_SCALE_NARROW = 0.04;

// The trailing lag is a pointer-device luxury. With a mouse the cursor is a
// proxy — the grid is allowed to answer late and the trail reads as a soft
// sheet. Under a finger the content is directly beneath your skin, so the same
// trail reads as the screen failing to keep up, and the per-tile spread reads
// as the image tearing away from the one next to it. So the whole follow system
// tightens at the narrow/touch end: settles roughly twice as fast, far less
// spread between centre and edge (that's the stagger), and almost no overshoot.
// Still not rigid — just close enough to the finger to feel attached to it.
const FOLLOW_CENTER_NARROW = 0.09;
const FOLLOW_EDGE_NARROW = 0.16; // vs 0.45 — the gap to centre IS the stagger
const FOLLOW_DAMPING_NARROW = 0.92; // ~no bounce (desktop 0.7 overshoots)
const FOLLOW_JITTER_NARROW = 0.03;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

// A tablet is wide but still a finger. Width alone would hand it the full
// desktop trail, so touch pins the follow ramp to its narrow end outright.
const isCoarsePointer = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// `ref` is the reference composition — DEFAULTS, or Leva's live copy of it.
// Returns the px values the grid actually runs at, at this viewport.
export function responsiveLayout(vw, vh, ref = DEFAULTS, coarse = isCoarsePointer()) {
  const refTile = ref.tileSize;
  const refRatio = ref.gap / refTile;

  const tileSize = Math.min(
    Math.max(refTile * TILE_MIN_RATIO, (vw / REF_VW) * refTile),
    vh * TILE_MAX_VH,
  );

  // 0 at NARROW_VW → 1 at REF_VW and beyond: how much of the reference's
  // wide-screen character (airy gaps, depth recession) this viewport earns.
  const t = clamp01((vw - NARROW_VW) / (REF_VW - NARROW_VW));
  const gapRatio = GAP_RATIO_NARROW + (refRatio - GAP_RATIO_NARROW) * t;

  // px offsets that live in the same space as the tiles have to ride the same
  // scale, or the entrance rise and the click shove read as huge on a phone.
  const k = tileSize / refTile;
  // Touch gets the narrow end of the follow ramp at any width — see above.
  const f = coarse ? 0 : t;
  return {
    tileSize,
    gap: tileSize * gapRatio,
    popRise: ref.popRise * k,
    pushStrength: ref.pushStrength * k,
    depthScale: DEPTH_SCALE_NARROW + (ref.depthScale - DEPTH_SCALE_NARROW) * t,
    followResponseCenter: FOLLOW_CENTER_NARROW + (ref.followResponseCenter - FOLLOW_CENTER_NARROW) * f,
    followResponseEdge: FOLLOW_EDGE_NARROW + (ref.followResponseEdge - FOLLOW_EDGE_NARROW) * f,
    followDamping: FOLLOW_DAMPING_NARROW + (ref.followDamping - FOLLOW_DAMPING_NARROW) * f,
    followJitter: FOLLOW_JITTER_NARROW + (ref.followJitter - FOLLOW_JITTER_NARROW) * f,
  };
}
