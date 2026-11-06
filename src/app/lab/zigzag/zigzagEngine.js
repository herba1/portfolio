import { createStage, clamp, mix } from "../_kit/stage";

// After Experimental Jetset's responsive W for the Whitney (2013): one rule,
// a zigzag that always touches all four sides of its frame.
//
// The mark is solved, not scaled. Four parallel-sided bands share one
// slope s (dx per dy) and one perpendicular weight w. Each band is H = w·√(1+s²)
// wide measured horizontally. Walking the outer edges from the top-left
// corner, the far end lands at x0 + 4sD − 2H, so for the right end to sit on
// the right edge:   4sD − 2·w·√(1+s²) = W
// which squares to a quadratic in s. Every outline vertex is then a line
// intersection: the two top ends are cut flush with the top edge, and the
// three mitre tips land exactly on the bottom, top and bottom edges.

const REST_RATIO = 1.5; // width / height at rest
const STIFF = 210;
const ZETA = 0.82;
const HIT = 18; // px reach for an edge or corner

// Solve the slope for a frame W wide and D tall with stroke weight w.
function solveSlope(W, D, w) {
  const a = 16 * D * D - 4 * w * w;
  const b = -8 * D * W;
  const c = W * W - 4 * w * w;
  const disc = Math.max(0, b * b - 4 * a * c);
  return (-b + Math.sqrt(disc)) / (2 * a);
}

// The narrowest frame of height D the W can fill without its inner crotches
// rising through the top edge: 2wD / √(D² − w²).
const minWidth = (D, w) => (2 * w * D) / Math.sqrt(Math.max(1e-6, D * D - w * w));

// Outline of the W as 10 points, clockwise from the top-left corner.
function outline(l, t, r, b, w) {
  const W = r - l;
  const D = b - t;
  const s = solveSlope(W, D, w);
  const H = w * Math.sqrt(1 + s * s);
  // Each band edge as x = k + m·(y − t), m = ±s.
  const L = [
    [l, s], // 0: seg1 left
    [l + H, s], // 1: seg1 right
    [l + 2 * s * D - H, -s], // 2: seg2 left (x at y=t)
    [l + 2 * s * D, -s], // 3: seg2 right
    [l + 2 * s * D - 2 * H, s], // 4: seg3 left
    [l + 2 * s * D - H, s], // 5: seg3 right
    [l + 4 * s * D - 3 * H, -s], // 6: seg4 left
    [l + 4 * s * D - 2 * H, -s], // 7: seg4 right
  ];
  const meet = (i, j) => {
    const [ka, ma] = L[i];
    const [kb, mb] = L[j];
    const dy = (kb - ka) / (ma - mb);
    return [ka + ma * dy, t + dy];
  };
  return [
    [l, t],
    [l + H, t],
    meet(1, 2), // inner crotch, first V
    meet(2, 5), // outer tip, on the top edge
    meet(5, 6), // inner crotch, second V
    [r - H, t],
    [r, t],
    meet(7, 4), // outer tip, on the bottom edge
    meet(4, 3), // inner apex
    meet(3, 0), // outer tip, on the bottom edge
  ];
}

// Past a limit the edge keeps following, but with resistance.
const rubber = (v, lo, hi, c = 48) => {
  if (v < lo) return lo - c * (1 - 1 / ((lo - v) / c + 1));
  if (v > hi) return hi + c * (1 - 1 / ((v - hi) / c + 1));
  return v;
};

const CURSORS = { "-1,-1": "nwse-resize", "1,1": "nwse-resize", "1,-1": "nesw-resize", "-1,1": "nesw-resize", "1,0": "ew-resize", "-1,0": "ew-resize", "0,1": "ns-resize", "0,-1": "ns-resize" };

export function createZigzag(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;

  let BW = 1;
  let BH = 1;
  let rest = { l: 0, t: 0, r: 1, b: 1 };
  let weight = 10;
  // Live frame and its edge velocities, keyed l t r b.
  const f = { l: 0, t: 0, r: 1, b: 1 };
  const v = { l: 0, t: 0, r: 0, b: 0 };
  let started = false;
  let drag = null; // { sx, sy, ox, oy }
  let hover = null; // { sx, sy }
  let handleA = 0; // handle visibility, eased
  let lastTouch = -1e9;
  let demo = null;

  stage.onResize((w, h) => {
    BW = w;
    BH = h;
    const W = Math.min(w * 0.44, h * 0.5 * REST_RATIO, 720);
    const H = W / REST_RATIO;
    const cx = w / 2;
    const cy = h / 2;
    const next = { l: Math.round(cx - W / 2), t: Math.round(cy - H / 2), r: Math.round(cx + W / 2), b: Math.round(cy + H / 2) };
    const dx = next.l - rest.l;
    const dy = next.t - rest.t;
    rest = next;
    weight = Math.max(6, Math.round(H * 0.092));
    if (!started) {
      Object.assign(f, rest);
      started = true;
    } else if (!drag) {
      f.l += dx; f.r += dx; f.t += dy; f.b += dy;
    }
  });

  const pick = (x, y) => {
    const near = (a, b) => Math.abs(a - b) < HIT;
    const inX = x > f.l - HIT && x < f.r + HIT;
    const inY = y > f.t - HIT && y < f.b + HIT;
    let sx = 0;
    let sy = 0;
    if (inY) sx = near(x, f.l) ? -1 : near(x, f.r) ? 1 : 0;
    if (inX) sy = near(y, f.t) ? -1 : near(y, f.b) ? 1 : 0;
    if (sx || sy) return { sx, sy };
    // Anywhere else: grab the side or corner the pointer is facing.
    const cx = (f.l + f.r) / 2;
    const cy = (f.t + f.b) / 2;
    const u = (x - cx) / ((f.r - f.l) / 2);
    const q = (y - cy) / ((f.b - f.t) / 2);
    sx = Math.abs(u) > 0.45 ? Math.sign(u) : 0;
    sy = Math.abs(q) > 0.45 ? Math.sign(q) : 0;
    if (!sx && !sy) {
      if (Math.abs(u) > Math.abs(q)) sx = Math.sign(u) || 1;
      else sy = Math.sign(q) || 1;
    }
    return { sx, sy };
  };

  // Place the dragged edges at (x, y), within soft limits.
  const place = (x, y, sx, sy) => {
    const pad = 16;
    if (sy) {
      const minH = weight * 2.6;
      if (sy < 0) f.t = rubber(y, pad, f.b - minH);
      else f.b = rubber(y, f.t + minH, BH - pad);
    }
    if (sx) {
      const minW = minWidth(Math.max(f.b - f.t, weight * 1.2), weight) * 1.08;
      if (sx < 0) f.l = rubber(x, pad, f.r - minW);
      else f.r = rubber(x, f.l + minW, BW - pad);
    }
  };

  const grab = (p) => {
    const g = drag || pick(p.x, p.y);
    const ex = g.sx < 0 ? f.l : f.r;
    const ey = g.sy < 0 ? f.t : f.b;
    drag = { sx: g.sx, sy: g.sy, ox: ex - p.x, oy: ey - p.y };
    for (const k in v) v[k] = 0;
  };

  stage.on("down", (p) => {
    if (still != null) return;
    demo = null;
    lastTouch = performance.now();
    drag = null;
    grab(p);
    canvas.style.cursor = CURSORS[`${drag.sx},${drag.sy}`];
  });
  stage.on("move", (p) => {
    if (drag) {
      lastTouch = performance.now();
      place(p.x + drag.ox, p.y + drag.oy, drag.sx, drag.sy);
      return;
    }
    hover = pick(p.x, p.y);
    canvas.style.cursor = CURSORS[`${hover.sx},${hover.sy}`] || "default";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // Hand the throw to the spring.
    const vx = clamp(p.vx, -4000, 4000);
    const vy = clamp(p.vy, -4000, 4000);
    if (drag.sx < 0) v.l = vx;
    if (drag.sx > 0) v.r = vx;
    if (drag.sy < 0) v.t = vy;
    if (drag.sy > 0) v.b = vy;
    drag = null;
    lastTouch = performance.now();
  });

  // A frame dragged by its bottom-right corner, for stills and the idle hint.
  const pose = (k) => {
    const W = rest.r - rest.l;
    const H = rest.b - rest.t;
    const x = rest.r - W * 0.46 * k;
    const y = rest.b + H * 0.36 * k;
    return [x, y];
  };

  const spring = (dt) => {
    const c = 2 * ZETA * Math.sqrt(STIFF);
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const k in v) {
        const a = -STIFF * (f[k] - rest[k]) - c * v[k];
        v[k] += a * h;
        f[k] += v[k] * h;
      }
    }
  };

  const draw = () => {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, BW, BH);

    const l = f.l;
    const t = f.t;
    const r = f.r;
    const b = f.b;

    // The frame: a hairline just outside the mark, so the tips land on it.
    const px = 1 / dpr;
    ctx.strokeStyle = "#c8c8c4";
    ctx.lineWidth = px;
    ctx.strokeRect(l - px / 2, t - px / 2, r - l + px, b - t + px);

    // The W.
    const pts = outline(l, t, r, b, weight);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();

    // Handles: four small squares on the corners, the active edge inked.
    if (handleA > 0.01) {
      const act = drag || hover;
      ctx.globalAlpha = handleA;
      if (act && (!act.sx || !act.sy)) {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (act.sx) {
          const x = act.sx < 0 ? l - 0.5 : r + 0.5;
          ctx.moveTo(x, t); ctx.lineTo(x, b);
        } else {
          const y = act.sy < 0 ? t - 0.5 : b + 0.5;
          ctx.moveTo(l, y); ctx.lineTo(r, y);
        }
        ctx.stroke();
      }
      const S = 7;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = sx < 0 ? l : r;
        const y = sy < 0 ? t : b;
        const on = act && act.sx === sx && act.sy === sy;
        ctx.fillStyle = on ? "#000" : "#fff";
        ctx.fillRect(x - S / 2, y - S / 2, S, S);
        ctx.strokeStyle = on ? "#000" : "#8a8a86";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - S / 2 + 0.5, y - S / 2 + 0.5, S - 1, S - 1);
      }
      ctx.globalAlpha = 1;
    }
  };

  const ease = (x) => 1 - Math.pow(1 - x, 3);

  stage.onFrame((dt, now) => {
    if (still != null) {
      Object.assign(f, rest);
      const [x, y] = pose(ease(still));
      place(x, y, 1, 1);
      drag = still > 0 ? { sx: 1, sy: 1 } : null;
      handleA = still > 0 ? 1 : 0;
      draw();
      return;
    }
    const ms = performance.now();
    // Idle hint: once soon after load, then now and then, the frame is
    // pulled by its corner and let go, the way a hand would.
    if (!drag && !demo && ms - lastTouch > (lastTouch < 0 ? 1400 : 9000) && Math.abs(v.r) < 1) {
      demo = { t0: ms, dur: 1300 };
    }
    if (demo && !drag) {
      const k = (ms - demo.t0) / demo.dur;
      if (k >= 1) {
        demo = null;
        lastTouch = ms;
      } else {
        // Rise to the pose with ease-in-out, hold a beat, then release.
        const e = k < 0.75 ? 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, k / 0.6)) : 1;
        Object.assign(f, rest);
        const [x, y] = pose(e * 0.8);
        place(x, y, 1, 1);
        for (const key in v) v[key] = 0;
        if (k >= 0.75) {
          demo = null;
          lastTouch = ms;
        }
      }
    }
    if (!drag && !demo) spring(dt);
    const showHandles = drag || (hover && stage.pointer.inside) || demo;
    handleA = mix(handleA, showHandles ? 1 : 0, 1 - Math.exp(-dt * (showHandles ? 18 : 6)));
    draw();
  });

  return { destroy: () => stage.destroy() };
}
