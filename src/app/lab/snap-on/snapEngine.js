import { createStage, clamp, damp } from "../_kit/stage";
import { createSnapSound } from "./snapSound";

// Matthew Carter's Walker shipped as a plain sans plus a drawer of parts:
// square slab serifs, underlines and overbars a designer fits letter by
// letter. Here the letters are drawn as vector shapes so a fitting can be
// filled with them as one path: the word and everything attached to it is a
// single nonzero fill, all wound the same way, so a seated slab is part of
// the stem and never a sticker with a hairline round it.
//
// Units: cap height 1000, y down from the cap line, x from the word's first
// ink. Everything is rectangles and one diagonal, so every edge but the N's
// lands on the device pixel grid.

const CAP = 1000;
const STEM = 150;
const ARM = 136; // horizontals a touch lighter than stems, as a grotesque does
const EXT = 74; // serif overhang each side of a stem
const SLAB = 112; // serif depth
const BEAK_W = 124;
const BEAK = 124; // how far a beak reaches past its arm
const BAR = 120; // underline and overbar thickness
const LAP = 2; // fittings lap into the letters so the fill never meets edge to edge

const INK = "#121211";
const PAPER = "#f2f0eb";

const rect = (x0, y0, x1, y1) => [x0, y0, x1, y1];

// A serif slides in sideways, held clear of the letter, then presses home
// along the stem. A beak drops in along the arm's end, then presses in
// against it. `slide` moves first, `seat` last.
function stem(x0, x1, { head = true, foot = true } = {}) {
  const cx = (x0 + x1) / 2;
  const out = [];
  if (foot) out.push({ kind: "serif", rect: rect(x0 - EXT, CAP - SLAB, x1 + EXT, CAP), anchor: [cx, CAP - 190], seat: [0, 1], track: "under" });
  if (head) out.push({ kind: "serif", rect: rect(x0 - EXT, 0, x1 + EXT, SLAB), anchor: [cx, 190], seat: [0, -1], track: "over" });
  return out;
}
// A beak on the end of an arm at `x` (the arm's outer end), hanging down
// from a top arm or standing up from a bottom one.
function beak(x, dir, arm) {
  const x0 = dir > 0 ? x - BEAK_W : x;
  const x1 = dir > 0 ? x : x + BEAK_W;
  const ax = (x0 + x1) / 2;
  if (arm === "top") return { kind: "beak", rect: rect(x0, 0, x1, ARM + BEAK), anchor: [ax, ARM / 2 + 40], seat: [dir, 0], slide: [0, 1], track: "over" };
  if (arm === "bottom") return { kind: "beak", rect: rect(x0, CAP - ARM - BEAK, x1, CAP), anchor: [ax, CAP - ARM / 2 - 40], seat: [dir, 0], slide: [0, -1], track: "under" };
  // A spur on a middle arm: reaches both ways.
  return { kind: "beak", rect: rect(x0 + (dir > 0 ? 18 : 0), 432 - 76, x1 - (dir > 0 ? 0 : 18), 568 + 76), anchor: [ax, 500], seat: [dir, 0], slide: [0, 1], track: null };
}

// The word, LINTEL: all straight stems and one diagonal, no counters. Each
// glyph is its ink width, side bearings, shapes and the places a fitting can
// go. `edge` is what the glyph puts on the baseline and on the cap line, so
// a bar ends flush with whatever it meets.
const L = () => ({
  w: 470,
  sb: [100, 56],
  shapes: [rect(0, 0, STEM, CAP), rect(0, CAP - ARM, 470, CAP)],
  slots: [...stem(0, STEM), beak(470, 1, "bottom")],
  edge: { under: [0, 470], over: [0, STEM] },
});
const GLYPHS = [
  L(),
  { w: STEM, sb: [100, 100], shapes: [rect(0, 0, STEM, CAP)], slots: stem(0, STEM), edge: { under: [0, STEM], over: [0, STEM] } },
  {
    w: 640,
    sb: [100, 100],
    shapes: [rect(0, 0, 140, CAP), rect(500, 0, 640, CAP), [[0, 0], [184, 0], [640, CAP], [456, CAP]]],
    slots: [...stem(0, 140), ...stem(500, 640)],
    edge: { under: [0, 640], over: [0, 640] },
  },
  {
    w: 560,
    sb: [30, 30],
    shapes: [rect(0, 0, 560, ARM), rect(205, 0, 355, CAP)],
    slots: [...stem(205, 355, { head: false }), beak(0, -1, "top"), beak(560, 1, "top")],
    edge: { under: [205, 355], over: [0, 560] },
  },
  {
    w: 480,
    sb: [100, 40],
    shapes: [rect(0, 0, STEM, CAP), rect(0, 0, 480, ARM), rect(0, 432, 440, 568), rect(0, CAP - ARM, 480, CAP)],
    slots: [...stem(0, STEM), beak(480, 1, "top"), beak(440, 1, "mid"), beak(480, 1, "bottom")],
    edge: { under: [0, 480], over: [0, 480] },
  },
  L(),
];

// Lay the word out once, in word units.
let pen = 0;
const SLOTS = [];
GLYPHS.forEach((g, i) => {
  if (i > 0) pen += GLYPHS[i - 1].sb[1] + g.sb[0];
  g.x = pen;
  pen += g.w;
  g.slots = g.slots.map((s) => {
    const r = [s.rect[0] + g.x, s.rect[1], s.rect[2] + g.x, s.rect[3]];
    const slot = { ...s, glyph: i, rect: r, anchor: [s.anchor[0] + g.x, s.anchor[1]], id: SLOTS.length };
    SLOTS.push(slot);
    return slot;
  });
});
const WORD = pen;

const easeOutQuart = (x) => 1 - (1 - x) ** 4;
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const easeInCubic = (x) => x * x * x;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const unit = (x) => clamp(x, 0, 1);

const SNAP_MS = 340;
const POP_MS = 230;
const SLIDE = 320; // how far off-axis a serif starts
const SEAT = 160; // how far clear of the letter it is held before it presses home

export async function createSnapOn(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const ctx = stage.ctx;
  const sound = createSnapSound();
  const params = new URLSearchParams(location.search);
  const held = params.has("t") ? unit(parseFloat(params.get("t")) || 0) : null;

  let k = 1;
  let ox = 0;
  let oy = 0;
  stage.onResize((w, h) => {
    const narrow = w < 640;
    k = Math.min((w * (narrow ? 0.84 : 0.7)) / WORD, (h * (narrow ? 0.2 : 0.3)) / CAP);
    ox = (w - WORD * k) / 2;
    oy = h / 2 - (CAP * k) / 2;
  });
  const toUnits = (p) => [(p.x - ox) / k, (p.y - oy) / k];
  const panOf = (u) => (u / WORD) * 2 - 1;

  // Fittings: serifs and beaks on slots, and bars on the two tracks.
  const fits = new Map(); // slot id -> { slot, born, side, state, end, clicked, hold }
  const bars = []; // { track, g0, g1, xa, xb, born, state, end, seated, live }
  let now = performance.now();

  function attach(slot, side, at = now, hold = null) {
    if (fits.has(slot.id)) return;
    fits.set(slot.id, { slot, born: at, side, state: "in", clicked: false, hold });
  }
  function popFit(f) {
    if (f.state === "out") return;
    f.state = "out";
    f.end = now;
    sound.pop(panOf(f.slot.anchor[0]));
  }

  // Where a glyph meets a track, widened by any fitting seated on it.
  function edgeOf(g, track) {
    const glyph = GLYPHS[g];
    let [a, b] = glyph.edge[track];
    a += glyph.x;
    b += glyph.x;
    for (const f of fits.values()) {
      if (f.slot.glyph !== g || f.state === "out" || f.slot.track !== track) continue;
      a = Math.min(a, f.slot.rect[0]);
      b = Math.max(b, f.slot.rect[2]);
    }
    return [a, b];
  }
  const barSpan = (bar) => [edgeOf(bar.g0, bar.track)[0], edgeOf(bar.g1, bar.track)[1]];

  function addBar(track, g0, g1, at = now, from = null) {
    const bar = { track, g0, g1, born: at, state: "in", seated: false, live: false };
    const start = from ?? barSpan(bar)[0];
    bar.xa = start;
    bar.xb = start;
    bars.push(bar);
    return bar;
  }
  // A committed bar takes in any bar it overlaps on the same track.
  function merge(bar) {
    for (const other of bars) {
      if (other === bar || other.track !== bar.track || other.state === "out" || other.live) continue;
      if (other.g1 < bar.g0 || other.g0 > bar.g1) continue;
      bar.g0 = Math.min(bar.g0, other.g0);
      bar.g1 = Math.max(bar.g1, other.g1);
      bar.xa = Math.min(bar.xa, other.xa);
      bar.xb = Math.max(bar.xb, other.xb);
      bar.born = Math.min(bar.born, other.born);
      other.state = "gone";
    }
    for (let i = bars.length - 1; i >= 0; i -= 1) if (bars[i].state === "gone") bars.splice(i, 1);
  }

  // Seed: a few fittings fitted in turn on load, so the still already reads.
  // The last one is the one `?t=` holds mid-snap.
  const slotWhere = (g, kind, track, dir = 0) =>
    SLOTS.find((s) => s.glyph === g && s.kind === kind && s.track === track && (!dir || Math.sign(s.seat[0]) === dir));
  const t0 = now + 450;
  attach(slotWhere(1, "serif", "under"), -1, t0);
  attach(slotWhere(1, "serif", "over"), -1, t0 + 170);
  addBar("under", 2, 4, t0 + 420);
  attach(slotWhere(3, "beak", "over", 1), 1, t0 + 820);
  attach(slotWhere(5, "serif", "over"), 1, t0 + 1100, held);

  // Input.
  let gesture = null;
  let lastTap = null;
  stage.on("down", (p) => {
    sound.start();
    const [u, v] = toUnits(p);
    gesture = { x: p.x, y: p.y, u, v, mode: null, bar: null, g: null };
  });
  const glyphNear = (u) => {
    let best = 0;
    let bestD = Infinity;
    GLYPHS.forEach((g, i) => {
      const d = u < g.x ? g.x - u : u > g.x + g.w ? u - g.x - g.w : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  stage.on("move", (p) => {
    const [u, v] = toUnits(p);
    if (!gesture) {
      stage.canvas.style.cursor = cursorAt(u, v);
      return;
    }
    if (!gesture.mode) {
      if (Math.hypot(p.x - gesture.x, p.y - gesture.y) < 6) return;
      const inX = gesture.u > -260 && gesture.u < WORD + 260;
      if (inX && gesture.v > CAP * 0.62) gesture.mode = "under";
      else if (inX && gesture.v < CAP * 0.38) gesture.mode = "over";
      else gesture.mode = "none";
      if (gesture.mode !== "none") {
        gesture.g = glyphNear(gesture.u);
        const edge = edgeOf(gesture.g, gesture.mode);
        gesture.bar = addBar(gesture.mode, gesture.g, gesture.g, now, clamp(gesture.u, edge[0], edge[1]));
        gesture.bar.live = true;
        gesture.dir = 0;
      }
    }
    if (gesture.bar) {
      // The moving end catches at the letter edge nearest the hand, on the
      // side the hand is going.
      const bar = gesture.bar;
      const dir = u >= gesture.u ? 1 : -1;
      let pick = gesture.g;
      let bestD = Infinity;
      GLYPHS.forEach((g, i) => {
        if ((dir > 0 && i < gesture.g) || (dir < 0 && i > gesture.g)) return;
        const e = edgeOf(i, bar.track)[dir > 0 ? 1 : 0];
        const d = Math.abs(e - u);
        if (d < bestD) {
          bestD = d;
          pick = i;
        }
      });
      const g0 = Math.min(gesture.g, pick);
      const g1 = Math.max(gesture.g, pick);
      if (g0 !== bar.g0 || g1 !== bar.g1) sound.notch(panOf(u));
      bar.g0 = g0;
      bar.g1 = g1;
      bar.dir = dir;
    }
  });
  stage.on("up", (p) => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.bar) {
      g.bar.live = false;
      g.bar.released = now;
      merge(g.bar);
      return;
    }
    if (g.mode) return;
    tap(g.u, g.v, p);
  });

  function fitAt(u, v, pad = 50) {
    for (const f of fits.values()) {
      const r = f.slot.rect;
      if (f.state !== "out" && u > r[0] - pad && u < r[2] + pad && v > r[1] - pad && v < r[3] + pad) return f;
    }
    for (const bar of bars) {
      if (bar.state === "out" || bar.live) continue;
      const [y0, y1] = bar.track === "under" ? [CAP, CAP + BAR] : [-BAR, 0];
      if (u > bar.xa - pad && u < bar.xb + pad && v > y0 - pad && v < y1 + pad) return bar;
    }
    return null;
  }
  function slotAtPoint(u, v) {
    if (v < -60 || v > CAP + 60) return null;
    const reach = Math.max(300, 24 / k);
    let best = null;
    let bestD = reach;
    for (const s of SLOTS) {
      const d = Math.hypot(s.anchor[0] - u, (s.anchor[1] - v) * 0.8);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
  function cursorAt(u, v) {
    const s = slotAtPoint(u, v);
    if (s && !fits.has(s.id)) return "pointer";
    if (u > -260 && u < WORD + 260 && (v > CAP * 0.62 + 60 || v < CAP * 0.38 - 60) && (v > CAP + 20 || v < -20)) return "crosshair";
    return "default";
  }

  function tap(u, v, p) {
    const double = lastTap && now - lastTap.t < 360 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24;
    const first = lastTap?.t ?? now;
    lastTap = double ? null : { t: now, x: p.x, y: p.y };
    if (double) {
      const f = fitAt(u, v);
      if (f && f.born < first - 1) {
        if (f.slot) popFit(f);
        else {
          f.state = "out";
          f.end = now;
          sound.pop(panOf((f.xa + f.xb) / 2));
        }
      }
      return;
    }
    const s = slotAtPoint(u, v);
    if (!s || fits.has(s.id)) return;
    const side = s.kind === "serif" ? (u < s.anchor[0] ? -1 : 1) : 1;
    attach(s, side, now);
  }

  // Geometry of a fitting at this moment, in word units.
  function fitRect(f) {
    const { slot } = f;
    let [x0, y0, x1, y1] = slot.rect;
    const seat = slot.seat;
    const slide = slot.slide ? slot.slide : [f.side, 0];
    let slideK = 0;
    let seatK = 0;
    let collapse = 0;
    if (f.state === "out") {
      const q = unit((now - f.end) / POP_MS);
      seatK = easeOutCubic(unit(q / 0.3));
      slideK = easeInCubic(unit((q - 0.15) / 0.85));
      collapse = easeInCubic(unit((q - 0.25) / 0.75));
      if (q >= 1) return null;
    } else {
      const q = f.hold != null ? f.hold : unit((now - f.born) / SNAP_MS);
      if (q <= 0 && f.hold == null) return null;
      slideK = 1 - easeOutQuart(unit(q / 0.6));
      seatK = 1 - easeOutExpo(unit((q - 0.34) / 0.66));
      if (!f.clicked && seatK < 0.05 && f.hold == null) {
        f.clicked = true;
        if (now - f.born < SNAP_MS * 2) sound.seat(panOf(slot.anchor[0]));
      }
    }
    const dx = slide[0] * SLIDE * slideK + seat[0] * SEAT * seatK;
    const dy = slide[1] * SLIDE * slideK + seat[1] * SEAT * seatK;
    // A part knocked off goes thin along the axis it was seated on, toward
    // its outside, as it slides away.
    if (collapse > 0) {
      if (seat[1] > 0) y0 += (y1 - y0) * collapse;
      else if (seat[1] < 0) y1 -= (y1 - y0) * collapse;
      else if (seat[0] > 0) x0 += (x1 - x0) * collapse;
      else x1 -= (x1 - x0) * collapse;
    }
    const lapX = seat[0] ? LAP : 0;
    const lapY = seat[1] ? LAP : 0;
    return [x0 + dx - (seat[0] > 0 ? lapX : 0), y0 + dy - (seat[1] > 0 ? lapY : 0), x1 + dx + (seat[0] < 0 ? lapX : 0), y1 + dy + (seat[1] < 0 ? lapY : 0)];
  }

  function barRect(bar, dt) {
    if (now < bar.born) return null;
    const [a, b] = barSpan(bar);
    // The ends run out to their edges on a quick, overshoot-free approach.
    const lam = bar.live ? 26 : 22;
    bar.xa = damp(bar.xa, a, lam, dt);
    bar.xb = damp(bar.xb, b, lam, dt);
    if (!bar.live && !bar.seated && Math.abs(bar.xa - a) < 6 && Math.abs(bar.xb - b) < 6 && bar.state === "in") {
      bar.seated = true;
      sound.seat(panOf((a + b) / 2), 0.9);
    }
    let grow = easeOutExpo(unit((now - bar.born) / 180));
    if (bar.state === "out") {
      const q = unit((now - bar.end) / 200);
      grow *= 1 - easeInCubic(q);
      if (q >= 1) {
        bar.state = "gone";
        return null;
      }
    }
    const h = BAR * grow;
    if (bar.xb - bar.xa < 1 || h < 0.5) return null;
    return bar.track === "under" ? [bar.xa, CAP - LAP, bar.xb, CAP + h] : [bar.xa, -h, bar.xb, LAP];
  }

  const dpr = () => stage.dpr;
  const px = (u) => Math.round((ox + u * k) * dpr()) / dpr();
  const py = (v) => Math.round((oy + v * k) * dpr()) / dpr();
  const addRect = (r) => {
    const x0 = px(r[0]);
    const y0 = py(r[1]);
    const x1 = px(r[2]);
    const y1 = py(r[3]);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
  };

  stage.onFrame((dt) => {
    now = performance.now();
    const W = stage.width;
    const H = stage.height;
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    // One path for the word and every fitting on it, filled once.
    ctx.beginPath();
    for (const g of GLYPHS) {
      for (const s of g.shapes) {
        if (s.length === 4 && typeof s[0] === "number") addRect([s[0] + g.x, s[1], s[2] + g.x, s[3]]);
        else {
          s.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + g.x), py(y)) : ctx.moveTo(px(x + g.x), py(y))));
          ctx.closePath();
        }
      }
    }
    for (const [id, f] of fits) {
      const r = fitRect(f);
      if (r) addRect(r);
      else if (f.state === "out") fits.delete(id);
    }
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const r = barRect(bars[i], dt);
      if (r) addRect(r);
      if (bars[i].state === "gone") bars.splice(i, 1);
    }
    ctx.fillStyle = INK;
    ctx.fill("nonzero");
  });

  void embedded;
  return {
    destroy() {
      sound.destroy();
      stage.destroy();
    },
  };
}
