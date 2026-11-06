// Vanish: the rendered pixels of a submitted line become particles.
//
// On submit the text is re-rendered off screen with the input's exact font,
// tracking and position at (at least) DPR 2, and every inked device pixel
// becomes one particle sitting exactly where it was. A front sweeps left to
// right; behind it each pixel lets go, drifts up and right on a gentle curl
// field, shrinks and thins out. Unreleased pixels are drawn at home, so the
// first frame is the input's own text, pixel for pixel.
//
// Everything is a fixed-step simulation from a seeded random source, so a
// `?t=` still is exactly reproducible.

const STEP = 1 / 120;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// A divergence-free field: the curl of a smooth, slowly moving potential.
// Returns velocity in px/s per unit strength.
function curl(x, y, t, out) {
  // psi = A sin(a) cos(b) + B sin(c): a fine eddy layer riding on a broad,
  // slow swell. Amplitudes are in px/s.
  const k1 = 0.12;
  const k2 = 0.15;
  const k3 = 0.03;
  const A = 26 / k1;
  const B = 14 / k3;
  const a = x * k1 + t * 1.1;
  const b = y * k2 - t * 0.8;
  const c = (x * 0.7 + y) * k3 + t * 0.4;
  const cc = Math.cos(c) * k3 * B;
  const dpdx = A * Math.cos(a) * Math.cos(b) * k1 + cc * 0.7;
  const dpdy = -A * Math.sin(a) * Math.sin(b) * k2 + cc;
  out[0] = dpdy;
  out[1] = -dpdx;
  return out;
}

export function createVanish({ root, input, canvas }, { onSettle, onEmpty } = {}) {
  const ctx = canvas.getContext("2d");
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  let dpr = 2;
  let width = 0;
  let height = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let frozen = false;
  let seedCounter = 1;
  const bursts = [];
  const flow = [0, 0];
  // Only the region the particles covered last frame is cleared, so a
  // full-viewport overlay costs no more than the cloud itself.
  let dirty = null;
  const box = [0, 0, 0, 0];

  function resize() {
    const r = root.getBoundingClientRect();
    width = r.width;
    height = r.height;
    dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw(true);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // Render `text` exactly as the input shows it, and turn its pixels into
  // particles. Coordinates are relative to `root`, in CSS px.
  function capture(text, scrollLeft) {
    const cs = getComputedStyle(input);
    const R = root.getBoundingClientRect();
    const r = input.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
    const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const lineHeight = parseFloat(cs.lineHeight);
    const left = r.left - R.left + padL;
    const top = r.top - R.top + padT;
    const contentW = r.width - padL - padR;

    const S = dpr;
    // Device-aligned origin for the off-screen raster, so each sampled pixel
    // lands on a device pixel of the overlay.
    const ox = Math.floor((left - 4) * S) / S;
    const oy = Math.floor((top - 4) * S) / S;
    const w = Math.ceil((contentW + 8) * S);
    const h = Math.ceil((lineHeight + 8) * S);
    scratch.width = w;
    scratch.height = h;

    sctx.setTransform(S, 0, 0, S, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in sctx) sctx.letterSpacing = cs.letterSpacing;
    if ("fontKerning" in sctx) sctx.fontKerning = "normal";
    sctx.textBaseline = "alphabetic";
    sctx.fillStyle = "#000";
    const m = sctx.measureText(text);
    // Blink centres an input's line on whole-pixel metrics, rounding the
    // half-leading up; match it or the copy sits half a pixel high.
    const ascent = Math.round(m.fontBoundingBoxAscent);
    const descent = Math.round(m.fontBoundingBoxDescent);
    const baseline = top + Math.ceil((lineHeight - (ascent + descent)) / 2) + ascent;

    // The input clips its text to the content box; so does the raster.
    sctx.save();
    sctx.beginPath();
    sctx.rect(left - ox, 0, contentW, h / S);
    sctx.clip();
    sctx.fillText(text, left - scrollLeft - ox, baseline - oy);
    sctx.restore();

    const data = sctx.getImageData(0, 0, w, h).data;
    const xs = [];
    const ys = [];
    const as = [];
    let minX = Infinity;
    let maxX = -Infinity;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = data[(j * w + i) * 4 + 3];
        if (a < 6) continue;
        const x = ox + i / S;
        xs.push(x);
        ys.push(oy + j / S);
        as.push(a / 255);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return { xs, ys, as, minX, maxX, top, lineHeight, S, color: cs.color };
  }

  function makeBurst(text, scrollLeft) {
    const cap = capture(text, scrollLeft);
    const n = cap.xs.length;
    if (!n) return null;
    const rand = mulberry32(0x9e3779b1 ^ (seedCounter++ * 2654435761));
    const span = Math.max(1, cap.maxX - cap.minX);
    // The sweep takes longer for a longer line, within a narrow band.
    const sweep = clamp(0.26 + span * 0.0011, 0.32, 0.62);
    const x = new Float32Array(cap.xs);
    const y = new Float32Array(cap.ys);
    const a0 = new Float32Array(cap.as);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const release = new Float32Array(n);
    const life = new Float32Array(n);
    const wind = new Float32Array(n * 2);
    const mid = cap.top + cap.lineHeight / 2;
    let end = 0;
    for (let p = 0; p < n; p++) {
      const u = (x[p] - cap.minX) / span;
      // Feather the front: a smooth wobble along the glyph height, plus grain.
      const wobble = Math.sin((y[p] - mid) * 0.42 + u * 9) * 0.018;
      release[p] = sweep * (0.65 * easeOutQuad(u) + 0.35 * u) + wobble + rand() * 0.04;
      if (release[p] < 0) release[p] = rand() * 0.02;
      life[p] = 0.7 + rand() * 0.32;
      // Each pixel leaves up and to the right, the top of a glyph a little
      // more upward than its foot, so the cloud fans open as it rises.
      const lift = (mid - y[p]) / cap.lineHeight;
      const speed = 48 + rand() * 92;
      const ang = -0.7 - lift * 0.5 + (rand() - 0.5) * 0.9;
      vx[p] = Math.cos(ang) * speed;
      vy[p] = Math.sin(ang) * speed;
      wind[p * 2] = 34 + rand() * 32;
      wind[p * 2 + 1] = -(22 + rand() * 30);
      end = Math.max(end, release[p] + life[p]);
    }
    return {
      n,
      x,
      y,
      a0,
      vx,
      vy,
      release,
      life,
      wind,
      age: 0,
      end,
      color: cap.color,
      S: cap.S,
      reduced: reduce.matches,
      settled: false,
    };
  }

  function stepBurst(b, dt) {
    b.age += dt;
    if (b.reduced) return;
    const t = b.age;
    const { n, x, y, vx, vy, release, life, wind } = b;
    const k = 2.4 * dt;
    for (let p = 0; p < n; p++) {
      const age = t - release[p];
      if (age <= 0 || age > life[p]) continue;
      curl(x[p], y[p], t, flow);
      const fx = wind[p * 2] + flow[0];
      const fy = wind[p * 2 + 1] + flow[1];
      vx[p] += (fx - vx[p]) * k;
      vy[p] += (fy - vy[p]) * k;
      // Ease in over the first few frames, so a pixel peels off its letter
      // rather than being shot out of it.
      const peel = age < 0.09 ? (age / 0.09) * (age / 0.09) : 1;
      x[p] += vx[p] * dt * peel;
      y[p] += vy[p] * dt * peel;
    }
  }

  function drawBurst(b) {
    ctx.fillStyle = b.color;
    const t = b.age;
    if (b.reduced) {
      // Reduced motion: the line simply fades where it sits.
      const f = 1 - easeOutQuad(clamp(t / 0.32, 0, 1));
      const unit = 1 / b.S;
      for (let p = 0; p < b.n; p++) {
        ctx.globalAlpha = b.a0[p] * f;
        ctx.fillRect(b.x[p], b.y[p], unit, unit);
        grow(b.x[p], b.y[p]);
      }
      return;
    }
    const { n, x, y, a0, release, life } = b;
    const unit = 1 / b.S;
    for (let p = 0; p < n; p++) {
      const age = t - release[p];
      if (age <= 0) {
        ctx.globalAlpha = a0[p];
        ctx.fillRect(x[p], y[p], unit, unit);
        grow(x[p], y[p]);
        continue;
      }
      const u = age / life[p];
      if (u >= 1) continue;
      // Thin out: holds its ink for a beat, then lets it go.
      const fade = Math.pow(1 - u, 1.6);
      // Shrink from a full device pixel to nothing.
      const s = unit * (1 - 0.55 * u);
      ctx.globalAlpha = a0[p] * fade;
      ctx.fillRect(x[p] - (s - unit) / 2, y[p] - (s - unit) / 2, s, s);
      grow(x[p], y[p]);
    }
  }

  function draw(full = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (full || !dirty) ctx.clearRect(0, 0, canvas.width, canvas.height);
    else ctx.clearRect(dirty[0], dirty[1], dirty[2], dirty[3]);
    dirty = null;
    if (!bursts.length) return;
    box[0] = Infinity;
    box[1] = Infinity;
    box[2] = -Infinity;
    box[3] = -Infinity;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of bursts) drawBurst(b);
    ctx.globalAlpha = 1;
    if (box[0] <= box[2]) {
      const x0 = Math.max(0, Math.floor((box[0] - 4) * dpr));
      const y0 = Math.max(0, Math.floor((box[1] - 4) * dpr));
      dirty = [x0, y0, Math.ceil((box[2] + 6) * dpr) - x0, Math.ceil((box[3] + 6) * dpr) - y0];
    }
  }

  function grow(x, y) {
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }

  function burstEnd(b) {
    return b.reduced ? 0.32 : b.end;
  }

  function tick(now) {
    raf = 0;
    if (frozen) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      for (const b of bursts) stepBurst(b, STEP);
      acc -= STEP;
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const endAt = burstEnd(b);
      // Bring the caret and placeholder back as the last specks leave.
      if (!b.settled && b.age >= endAt - 0.3) {
        b.settled = true;
        if (bursts.every((o) => o === b || o.settled)) onSettle?.();
      }
      if (b.age >= endAt) bursts.splice(i, 1);
    }
    draw();
    if (bursts.length) raf = requestAnimationFrame(tick);
  }

  function vanish(text, scrollLeft = 0) {
    // A held still gives way to the real thing on the first submit.
    if (frozen) {
      frozen = false;
      bursts.length = 0;
    }
    const b = makeBurst(text, scrollLeft);
    if (!b) {
      onEmpty?.();
      return false;
    }
    bursts.push(b);
    if (!raf && !frozen) {
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(tick);
    }
    draw();
    return true;
  }

  // Hold a burst at fraction `f` of its timeline, simulated from zero.
  function freeze(text, f) {
    frozen = true;
    cancelAnimationFrame(raf);
    raf = 0;
    bursts.length = 0;
    const b = makeBurst(text, 0);
    if (!b) return;
    bursts.push(b);
    const target = clamp(f, 0, 1) * burstEnd(b);
    while (b.age + STEP <= target) stepBurst(b, STEP);
    draw();
  }

  return {
    vanish,
    freeze,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
