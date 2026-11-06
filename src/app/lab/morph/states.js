// Where everything sits in each state. One coordinate system for all three:
// x is measured from the surface's centre line, y from its top edge, so the
// surface can grow out from its centre while every child keeps its own
// address. Shared elements (art, waveform, the pill's clock, next) have a
// rect in every state and glide between them; where a state has no use for
// one it still gets a rect, parked where its replacement appears, with o = 0
// (the pill's clock drifts into the title's place as the title arrives).
// Parking spots are chosen so nothing crosses the art in flight.

export const STATES = ["idle", "expanded", "toast"];

const ART_IDLE = 24;

export function layout(state, { hover = false, press = false } = {}) {
  if (state === "expanded") {
    const W = 368;
    const H = 192;
    const L = -W / 2 + 20;
    return {
      W,
      H,
      R: 44,
      art: { x: L, y: 20, s: 56, r: 14, o: 1 },
      wave: { x: W / 2 - 20 - 22, y: 28, o: 1 },
      elapsed: { x: -96, y: 28, o: 0 },
      next: { x: 64 - 20, y: 132, s: 40, o: 1 },
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
      elapsed: { x: L + 48, y: 20, o: 0 },
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
    elapsed: { x: L + 32, y: (H - 16) / 2, o: 1 },
    next: { x: 64 - 20, y: 132, s: 40, o: 0 },
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
