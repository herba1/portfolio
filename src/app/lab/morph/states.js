// Where everything sits in each state. One coordinate system for all three:
// x is measured from the surface's centre line, y from its top edge, so the
// surface can grow out from its centre while every child keeps its own
// address. Shared elements (art, waveform, the clock, next) have a rect in
// every state and glide between them; where a state has no use for one it
// still gets a rect, parked out of the way, with o = 0. Parking spots are
// chosen so nothing crosses the art in flight.
//
// Two elements carry the open, on the same spring as the edge: the cover,
// which grows from the pill's thumbnail out of its top-left corner into the
// sleeve, and the clock, whose small "1:23" rises into the type column beside
// it and grows into the column's headline figures. Its size is a
// channel of its own (s, in px), set as a real font size every frame, so the
// figures stay sharp at every step instead of being a scaled bitmap.

export const STATES = ["idle", "expanded", "toast"];

const ART_IDLE = 24;

// ---- the open panel's grid --------------------------------------------------
// A record sleeve and its type, and nothing else: no buttons, no bar. The
// figures are the control (drag them to seek, tap the sleeve to pause), and
// progress is one hairline on the figures' baseline.
//
// The cover is the second shared element: the pill's thumbnail grows out of
// its own top-left corner into a square that stands from the figures' top to
// the artist's baseline. Everything else, clock, rule, title, artist, hangs
// flush left off one line, COL, immediately to its right. Two columns:
// image square / type, and the type column is exactly as wide as the
// figures: they own the measure, ink to ink, and the rule runs under them
// end to end. Every vertical address is on the 4px grid.
const PAD = 24;
const GAP = 28; // sleeve to type

// Clock sizes. Open, the figures are the column's headline: Geist's tabular
// lining figures are 0.71em, so 143px figures stand 101.5px, their top on the
// sleeve's top edge and their round overshoot just clear of the rule at 128.
export const CLOCK_PILL = 13;
export const CLOCK = 143;

// Geist's tabular figures with line-height 1, measured from rendered pixels
// at the clock's weight: flat figure top and baseline as a fraction of the
// size from the top of the line box, and the figure centre.
export const FIG_TOP = 0.144;
export const FIG_BASE = 0.854;
const clockTop = (s, top) => top - FIG_TOP * s;
const clockMid = (s) => ((FIG_TOP + FIG_BASE) / 2) * s;

// "1:23" from the 1's ink to the 3's ink, measured from rendered pixels at
// the clock's weight: 1.9938em of outline, less the three gaps of tracking
// the law sets between the four figures at this size. The figures are
// tabular, so every time the clock can show is this wide; only the last
// figure's own right bearing moves its ink by a pixel or so.
const FIG_INK = 1.9938;
const figureWidth = (s) => FIG_INK * s + 3 * -0.043 * (s - 12);
export const COL_W = Math.round(figureWidth(CLOCK)); // 268: the figures, and the rule under them

export const ART = 160; // the sleeve: figure top to artist baseline
export const PANEL = { W: PAD + ART + GAP + COL_W + PAD, H: PAD + ART + PAD };
export const COL = -PANEL.W / 2 + PAD + ART + GAP; // the text column's left edge

// The figures' baseline lands at PAD + 101.5 = 125.5. The rule is laid on it,
// just clear of the round figures' overshoot so it lands on the grid at 128.
// The title's 24px line sits 16px under the rule (its baseline 19px down)
// and the artist straight beneath. The time left stands under the rule's far
// end, set flush right on the title's baseline in the 13px body step (whose
// baseline is 12px down its 16px line), so the column's second line reads as
// one line: what is playing, and how long it has left.
export const CLOCK_BASE = PAD + (FIG_BASE - FIG_TOP) * CLOCK;
const TITLE_BASE = 19;
const REMAIN_BASE = 12;
export const ROW = {
  rule: 128,
  title: 144,
  remain: 144 + TITLE_BASE - REMAIN_BASE,
  artist: 168,
};
// the title gives way to the time left: its measure stops short of it
export const REMAIN_W = 48;

// The idle pill's geometry, which the open panel borrows to park the
// waveform where it already is: it doesn't travel, it folds flat in place.
const PILL_W = 196;
const PILL_H = 40;
const WAVE_IDLE = { x: PILL_W / 2 - 14 - 22, y: (PILL_H - 16) / 2 };
// Next only has a place in the toast; elsewhere it rests, unseen, at the
// pill's right end, so it comes into the toast from where the toast grows.
const NEXT_PARK = { x: PILL_W / 2 - 14 - 32, y: (PILL_H - 32) / 2, s: 32 };

export function layout(state, { hover = false, press = false } = {}) {
  if (state === "expanded") {
    const { W, H } = PANEL;
    return {
      W,
      H,
      R: 32,
      art: { x: -W / 2 + PAD, y: PAD, s: ART, r: 8, o: 1 },
      // the waveform has no place in the open panel: it folds flat where it was
      wave: { x: WAVE_IDLE.x, y: WAVE_IDLE.y, o: 0 },
      elapsed: { x: COL, y: clockTop(CLOCK, PAD), s: CLOCK, o: 1 },
      // no chrome open: next waits where the toast will want it
      next: { ...NEXT_PARK, o: 0 },
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
  const W = PILL_W + (hover ? 8 : 0) - (press ? 8 : 0);
  const H = PILL_H + (hover ? 4 : 0) - (press ? 4 : 0);
  const L = -W / 2 + (H - ART_IDLE) / 2;
  return {
    W,
    H,
    R: H / 2,
    art: { x: L, y: (H - ART_IDLE) / 2, s: ART_IDLE, r: 7, o: 1 },
    wave: { x: W / 2 - 14 - 22, y: (H - 16) / 2, o: 1 },
    elapsed: { x: L + 32, y: H / 2 - clockMid(CLOCK_PILL), s: CLOCK_PILL, o: 1 },
    next: { ...NEXT_PARK, o: 0 },
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
