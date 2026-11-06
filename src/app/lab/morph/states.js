// Where everything sits in each state. One coordinate system for all three:
// x is measured from the surface's centre line, y from its top edge, so the
// surface can grow out from its centre while every child keeps its own
// address. Shared elements (art, waveform, the clock, next) have a rect in
// every state and glide between them; where a state has no use for one it
// still gets a rect, parked out of the way, with o = 0. Parking spots are
// chosen so nothing crosses the art in flight.
//
// The clock is the element that carries the open: the pill's small "1:23"
// travels up into the panel's text column and grows, on the same spring as
// the edge, into numerals as tall as the cover beside them. Its size is a
// channel of its own (s, in px), set as a real font size every frame, so the
// figures stay sharp at every step instead of being a scaled bitmap.

export const STATES = ["idle", "expanded", "toast"];

const ART_IDLE = 24;

// ---- the open panel's grid --------------------------------------------------
// A hanging column: the cover sits in the margin and everything else, clock,
// title, artist, scrubber and transport, hangs flush left off one line, COL.
// Every vertical address is on the 4px grid.
const PAD = 20;
const ART = 56;
export const PANEL = { W: 368, H: 228 };
export const COL = -PANEL.W / 2 + PAD + ART + 16; // the text column's left edge
export const COL_W = PANEL.W / 2 - PAD - COL; // ... and its measure

// Clock sizes. Open, the figures stand as tall as the cover: Geist's lining
// figures are 0.73em, so 76px figures are 56px, top on the cover's top edge
// and baseline on its bottom.
export const CLOCK_PILL = 13;
export const CLOCK = 76;

// Geist's metrics with line-height 1: figure top and figure centre, as a
// fraction of the size, measured from the top of the line box.
export const FIG_TOP = 0.1225;
export const FIG_BASE = 0.8525;
const clockTop = (s, top) => top - FIG_TOP * s;
const clockMid = (s) => 0.4875 * s;

export const ROW = {
  title: 92,
  artist: 112,
  scrub: 144,
  transport: 168,
};

// Transport buttons are 40px boxes with the glyph centred; the glyphs' left
// ink sits 11px in, so the row is pulled left by that to hang on COL.
const GLYPH_INSET = 11;
export const TRANSPORT = {
  prev: COL - GLYPH_INSET,
  play: COL - GLYPH_INSET + 52,
  next: COL - GLYPH_INSET + 104,
};

export function layout(state, { hover = false, press = false } = {}) {
  if (state === "expanded") {
    const { W, H } = PANEL;
    return {
      W,
      H,
      R: 44,
      art: { x: -W / 2 + PAD, y: PAD, s: ART, r: 14, o: 1 },
      // the waveform has no place in the open panel: it goes out where it was
      wave: { x: W / 2 - PAD - 22, y: 28, o: 0 },
      elapsed: { x: COL, y: clockTop(CLOCK, PAD), s: CLOCK, o: 1 },
      next: { x: TRANSPORT.next, y: ROW.transport, s: 40, o: 1 },
      p: { idle: 0, expanded: 1, toast: 0 },
    };
  }
  if (state === "toast") {
    const W = 304;
    const H = 56;
    const L = -W / 2 + 10;
    return {
      W,
      H,
      R: 28,
      art: { x: L, y: 10, s: 36, r: 10, o: 1 },
      wave: { x: W / 2 - 12 - 32 - 30, y: 20, o: 0 },
      elapsed: { x: L + 48, y: H / 2 - clockMid(CLOCK_PILL), s: CLOCK_PILL, o: 0 },
      next: { x: W / 2 - 12 - 32, y: 12, s: 32, o: 1 },
      p: { idle: 0, expanded: 0, toast: 1 },
    };
  }
  // idle: the pill breathes up a touch under the pointer and gives under a press
  const W = 196 + (hover ? 8 : 0) - (press ? 8 : 0);
  const H = 40 + (hover ? 4 : 0) - (press ? 4 : 0);
  const L = -W / 2 + (H - ART_IDLE) / 2;
  return {
    W,
    H,
    R: H / 2,
    art: { x: L, y: (H - ART_IDLE) / 2, s: ART_IDLE, r: 7, o: 1 },
    wave: { x: W / 2 - 14 - 22, y: (H - 16) / 2, o: 1 },
    elapsed: { x: L + 32, y: H / 2 - clockMid(CLOCK_PILL), s: CLOCK_PILL, o: 1 },
    next: { x: TRANSPORT.next, y: ROW.transport, s: 40, o: 0 },
    p: { idle: 1, expanded: 0, toast: 0 },
  };
}

// Flatten to the scalar channels the springs run on.
export function flat(l) {
  return {
    W: l.W,
    H: l.H,
    R: l.R,
    ax: l.art.x,
    ay: l.art.y,
    as: l.art.s,
    ar: l.art.r,
    wx: l.wave.x,
    wy: l.wave.y,
    wo: l.wave.o,
    ex: l.elapsed.x,
    ey: l.elapsed.y,
    es: l.elapsed.s,
    eo: l.elapsed.o,
    nx: l.next.x,
    ny: l.next.y,
    ns: l.next.s,
    no: l.next.o,
    pi: l.p.idle,
    pe: l.p.expanded,
    pt: l.p.toast,
  };
}

// Size and position channels share one spring: a hair under critical so the
// surface lands with the faintest settle, never a bounce. Presence (the
// crossfades) runs critically damped and a little quicker, so content has
// cleared before the edge reaches it.
export const BODY = { k: 230, zeta: 0.74 };
export const FADE = { k: 480, zeta: 1 };
export const isFade = (key) => key === "wo" || key === "eo" || key === "no" || key[0] === "p";
