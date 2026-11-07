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
// progress is one hairline, a grid step under the figures' baseline.
//
// The cover is the second shared element: the pill's thumbnail grows out of
// its own top-left corner into a square that stands from the figures' top to
// the artist's baseline. Everything else, clock, rule, title, artist, hangs
// flush left off one line, the column's left edge, immediately to its right. Two columns:
// image square / type, and the type column is exactly as wide as the
// figures: they own the measure, ink to ink, and the rule runs under them
// end to end. The measure follows the figures, so the column is a function
// of the clock's lead figure (see figureWidth), and the panel's width with
// it. Every vertical address is on the 4px grid.
const PAD = 24;
const GAP = 28; // sleeve to type

// Geist's lining figures with line-height 1, measured from rendered pixels
// at the clock's weight: flat figure top and baseline as a fraction of the
// size from the top of the line box, and the figure centre.
export const FIG_TOP = 0.144;
export const FIG_BASE = 0.854;

// Clock sizes. Open, the figures are the column's headline, sized so they
// stand exactly 100px, top on the sleeve's top edge and baseline on the
// grid at 124: the figures' baseline is a real grid line, so the rule can be
// measured off it rather than off the clip or the round overshoot.
export const CLOCK_PILL = 13;
export const CLOCK = 100 / (FIG_BASE - FIG_TOP); // 140.8px
const clockTop = (s, top) => top - FIG_TOP * s;
const clockMid = (s) => ((FIG_TOP + FIG_BASE) / 2) * s;

// The figures' metrics, in em at the clock's weight, measured from rendered
// pixels (Geist 490, line-height 1, at 400px). The rolling wheels are tabular
// (0.611em each), so a figure that turns never shifts its neighbours. The
// lead wheel is the exception for one figure: Geist's tabular 1 grows a slab
// foot to fill its tabular slot, so the lead wheel draws its 1 as the
// proportional, footless figure, a stem and a flag.
export const TAB_ADV = 0.611;
// each lead digit's ink left edge, by which the clock hangs flush on the column
export const LEAD_LSB = [0.038, 0.04, 0.05, 0.042, 0.03, 0.046, 0.048, 0.05, 0.032, 0.048];

// The colon is spaced optically, ink to ink, not by advance. A gap is read
// at the colon's own height, across its two dots, so every figure gets an
// optical edge on each side measured over those rows only: the mean of its
// ink edge across them, with any hollow counted no deeper than one stem
// (0.1em; the 1's stem is 0.107em). That is why the 2 needs it: its bowl
// leaves a deep hollow beside the upper dot, so by bounding box a colon
// spaced evenly between 1 and 2 still reads as "1:" then a hole then "23".
// The colon's dots are a flat-sided box, 0.0875em to 0.215em in its slot.
export const COLON_L = 0.0875;
export const COLON_R = 0.215;
// optical left and right edges of each tabular figure, in its slot
export const OPT_L = [0.0822, 0.1585, 0.0965, 0.1195, 0.13, 0.0872, 0.0887, 0.15, 0.0915, 0.0773];
export const OPT_R = [0.5286, 0.4515, 0.5436, 0.5135, 0.495, 0.4912, 0.4898, 0.4605, 0.5182, 0.5222];
// the lead wheel's: its 1 is the footless one, a flat stem facing the colon
export const LEAD_OPT_R = OPT_R.map((r, d) => (d === 1 ? 0.295 : r));
// The one gap, used on both sides of the colon: the optical gap the face
// itself sets between a tabular 2 and 3 over the same rows (0.187em), plus
// the law's tracking for the size, so it is the gap of "23" in "1:23".
export const GAP_EM = TAB_ADV - OPT_R[2] + OPT_L[3];
export const trackPx = (s) => -0.043 * (s - 12);
const REF = 2; // the seconds-tens figure the colon's span is drawn for

// The colon's span: from the figure before it (its optical right edge, `r`)
// to the slot of the seconds-tens wheel, in em from the start of that figure's
// slot. It holds two gaps and the colon, drawn for a 2 after it, so the
// seconds wheels keep a fixed address while they roll; the colon then
// centres itself in whatever that span leaves (see paint), so its two gaps
// are always equal, and exactly the gap of "23" whenever a 2 follows it.
export const colonSpan = (r, size) => r + 2 * (GAP_EM + trackPx(size) / size) + (COLON_R - COLON_L) - OPT_L[REF];

// The figures from the lead's ink to the last figure's ink: the lead's ink,
// the colon's span, then a tabular seconds-tens slot and the last figure out
// to its ink (the 3 of "1:23"; any other last figure moves the ink by a pixel
// or so).
const figureWidth = (s, lead) => (colonSpan(LEAD_OPT_R[lead], s) - LEAD_LSB[lead] + TAB_ADV + 0.57) * s + trackPx(s);
// The column for a lead figure: "1:23" is 243px, "2:23" 277px.
const colW = (lead) => Math.round(figureWidth(CLOCK, lead));

export const ART = 160; // the sleeve: figure top to artist baseline
const panelW = (lead) => PAD + ART + GAP + colW(lead) + PAD;
// the widest the panel gets, which is what the stage fits
export const PANEL = { W: Math.max(...LEAD_LSB.map((_, d) => panelW(d))), H: PAD + ART + PAD };

// The clock's lead figure for a time in seconds: tens of minutes from ten
// minutes up, otherwise minutes.
export const leadOf = (sec) => (sec >= 600 ? Math.floor(sec / 600) : Math.floor(sec / 60)) % 10;

// The figures' baseline lands on the grid at PAD + 100 = 124. The rule is its
// own line, not an underline: two grid steps under that baseline, at 132, so
// the round figures' overshoot (2.4px) is well clear of it and no figure
// stands on it. The figures roll out of their slot above it, not through it.
// The title's 24px line sits 12px under the rule (its baseline 19px down)
// and the artist straight beneath. The time left stands under the rule's far
// end, set flush right on the title's baseline in the 13px body step (whose
// baseline is 12px down its 16px line), so the column's second line reads as
// one line: what is playing, and how long it has left.
export const CLOCK_BASE = PAD + (FIG_BASE - FIG_TOP) * CLOCK;
const TITLE_BASE = 19;
const REMAIN_BASE = 12;
export const ROW = {
  rule: Math.round(CLOCK_BASE) + 8,
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

export function layout(state, { hover = false, press = false, lead = 1 } = {}) {
  // the type column for this lead figure, carried by every state so it only
  // ever moves when the lead figure turns
  const col = { x: -panelW(lead) / 2 + PAD + ART + GAP, w: colW(lead) };
  if (state === "expanded") {
    const W = panelW(lead);
    const { H } = PANEL;
    return {
      W,
      H,
      col,
      R: 32,
      art: { x: -W / 2 + PAD, y: PAD, s: ART, r: 8, o: 1 },
      // the waveform has no place in the open panel: it folds flat where it was
      wave: { x: WAVE_IDLE.x, y: WAVE_IDLE.y, o: 0 },
      elapsed: { x: col.x, y: clockTop(CLOCK, PAD), s: CLOCK, o: 1 },
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
      col,
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
    col,
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
    cl: l.col.x,
    cw: l.col.w,
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
