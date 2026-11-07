import { createStage, clamp } from "../_kit/stage";
import { createMusicaSound } from "./musicaSound";

// A wordless concert poster after Müller-Brockmann's Musica Viva sheets.
// The rings' edges step through a just-intoned scale over three octaves, so
// the radii are the intervals. Every ring turns at its own ratio of one
// shared "tuning" angle θ. The arcs start and end on a 15° grid, and every
// ratio here has a denominator dividing 12, so whenever θ is a whole number
// of half turns every arc is back on that grid: those are the consonances,
// and a release springs each ring to the nearest one.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const STEP = Math.PI; // θ between consonances

// The scale degrees, as multiples of the innermost radius.
const S = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
const E = [0, 1, 2].flatMap((o) => S.map((x) => x * 2 ** o)).concat(8);
const R0 = 0.118; // innermost radius, in sheet widths

const INK = "#121212";
const RED = "#e0301e";

// [inner degree, outer degree, start°, length°, colour, speed]
// Degrees index E; speeds are the intervals, signs set the turning sense.
const RINGS = [
  [0, 2, -90, 180, RED, 1],
  [3, 4, -90, 90, INK, -3 / 2],
  [5, 6, -90, 240, INK, 5 / 4],
  [7, 9, -90, 135, INK, -4 / 3],
  [10, 11, -90, 270, INK, 2 / 3],
  [12, 13, -90, 60, INK, 3 / 2],
  [14, 16, -90, 180, RED, -5 / 4],
  [17, 18, -90, 105, INK, 3 / 4],
  [20, 21, -90, 225, INK, -1 / 2],
];

export async function createMusicaViva(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const ctx = stage.ctx;
  const sound = createMusicaSound();

  const query = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  const held = query?.has("t") ? parseFloat(query.get("t")) || 0 : null;

  const rings = RINGS.map(([i0, i1, a0, len, col, k], n) => ({
    ri: i0 < 0 ? 0 : E[i0] * R0,
    ro: E[i1] * R0,
    a0: a0 * DEG,
    len: len * DEG,
    col,
    k,
    a: 0, // current turn
    v: 0,
    target: 0,
    // Inner rings are lighter and land first; the big outer ones arrive last.
    w: 10.5 - n * 0.7,
    moving: false,
    from: 0,
  }));

  let theta = 0; // the tuning angle, unwrapped
  let rest = 0; // the consonance it rests on
  let omega = 0; // angular velocity of the hand, rad/s
  let drag = null;
  let lastTouch = performance.now();
  let auto = false;
  let userTuned = false;
  let sheet = { x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0 };

  stage.onResize((W, H) => {
    // A Swiss F4 sheet, 905 × 1280, centred.
    const ratio = 905 / 1280;
    const pad = embedded ? 0.1 : 0.12;
    let h = H * (1 - pad * 2);
    let w = h * ratio;
    if (w > W * 0.86) {
      w = W * 0.86;
      h = w / ratio;
    }
    w = Math.round(w);
    h = Math.round(h);
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    sheet = { x, y, w, h, cx: x + w * 0.3, cy: y + h * 0.3 };
  });

  const angleAt = (p) => Math.atan2(p.y - sheet.cy, p.x - sheet.cx);

  stage.on("down", (p) => {
    sound.start();
    drag = { last: angleAt(p), t: performance.now() };
    omega = 0;
    auto = false;
    userTuned = true;
    lastTouch = performance.now();
  });
  stage.on("move", (p) => {
    if (!drag) return;
    const a = angleAt(p);
    let d = a - drag.last;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    // Near the centre the angle swings wildly; damp it there.
    const r = Math.hypot(p.x - sheet.cx, p.y - sheet.cy) / sheet.w;
    d *= clamp((r - 0.03) / 0.12, 0, 1);
    const now = performance.now();
    const dt = Math.max(1, now - drag.t) / 1000;
    omega += ((d * 1.5) / dt - omega) * Math.min(1, dt / 0.05);
    drag.last = a;
    drag.t = now;
    // A swing of about a third of a turn is one step to the next consonance.
    theta += d * 1.5;
    lastTouch = now;
  });
  stage.on("up", () => {
    if (!drag) return;
    if (performance.now() - drag.t > 80) omega = 0;
    drag = null;
    // Throw: carry the hand's speed a little way, then the nearest consonance.
    rest = Math.round((theta + clamp(omega, -14, 14) * 0.16) / STEP) * STEP;
    for (const ring of rings) ring.target = rest * ring.k;
    lastTouch = performance.now();
  });

  // Critically damped spring: ease-out, interruptible, never overshoots.
  const spring = (ring, target, w, dt) => {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const acc = -w * w * (ring.a - target) - 2 * w * ring.v;
      ring.v += acc * h;
      ring.a += ring.v * h;
    }
  };

  const draw = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f2f0eb";
    ctx.fillRect(0, 0, W, H);
    const { x, y, w, h, cx, cy } = sheet;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (const ring of rings) {
      const ro = ring.ro * w;
      const ri = ring.ri * w;
      const a0 = ring.a0 + ring.a;
      const a1 = a0 + ring.len;
      ctx.fillStyle = ring.col;
      ctx.beginPath();
      if (ring.len >= TAU - 1e-6) {
        ctx.arc(cx, cy, ro, 0, TAU);
        if (ri > 0) ctx.arc(cx, cy, ri, TAU, 0, true);
      } else {
        ctx.arc(cx, cy, ro, a0, a1);
        if (ri > 0) ctx.arc(cx, cy, ri, a1, a0, true);
        else ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  stage.onFrame((dt) => {
    if (held != null) {
      const th = held * STEP;
      for (const ring of rings) ring.a = th * ring.k;
      draw();
      return;
    }
    const now = performance.now();
    if (!drag && now - lastTouch > (userTuned ? 9000 : 3200)) {
      // Left alone, it retunes itself to the next consonance, slowly.
      rest += STEP;
      for (const ring of rings) ring.target = rest * ring.k;
      lastTouch = now;
      auto = true;
    }
    rings.forEach((ring, n) => {
      if (drag) {
        spring(ring, theta * ring.k, 26, dt);
        ring.moving = true;
        return;
      }
      spring(ring, ring.target, auto ? ring.w * 0.42 : ring.w, dt);
      const off = Math.abs(ring.a - ring.target);
      if (off > 0.03) {
        if (!ring.moving) ring.from = ring.a;
        ring.moving = true;
      } else if (ring.moving && off < 0.004 && Math.abs(ring.v) < 0.06) {
        ring.moving = false;
        ring.a = ring.target;
        ring.v = 0;
        if (!auto && Math.abs(ring.target - ring.from) > 0.2) {
          // Settled: its interval sounds, quieter the further out it sits.
          const pan = clamp(Math.cos(ring.a0 + ring.a + ring.len / 2) * 0.35, -0.35, 0.35);
          sound.ring(Math.abs(ring.k), 1 - n / rings.length, pan);
        }
        ring.from = ring.a;
      }
    });
    if (!drag) theta = rings[0].a / rings[0].k;
    draw();
  });

  return {
    destroy: () => {
      sound.destroy();
      stage.destroy();
    },
  };
}
