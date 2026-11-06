// Vanish: the rendered pixels of a submitted line become particles.
//
// On submit the text is re-rendered off screen with the input's exact font,
// tracking and position at (at least) DPR 2, and every inked device pixel
// becomes one particle sitting exactly where it was. A front sweeps left to
// right; behind it each pixel lets go and is carried up and right on a slow
// curl of air. Unreleased pixels are drawn at home, so the first frame is the
// input's own text, pixel for pixel.
//
// Released specks never fade. Each is one device pixel of full-strength ink,
// snapped to the device grid, and the cloud thins by losing specks rather
// than by going grey: ink lifting off paper, not static.
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
// Returns velocity in px/s. Wavelengths and amplitudes are sized for display
// type: eddies about a word wide, so the curl reads at the distance the
// specks travel.
function curl(x, y, t, out) {
  const k1 = 0.045;
  const k2 = 0.055;
  const k3 = 0.012;
  const A = 84 / k1;
  const B = 40 / k3;
  const a = x * k1 + t * 1.3;
  const b = y * k2 - t * 0.9;
  const c = (x * 0.7 + y) * k3 + t * 0.5;
  const cc = Math.cos(c) * k3 * B;
  const dpdx = A * Math.cos(a) * Math.cos(b) * k1 + cc * 0.7;
  const dpdy = -A * Math.sin(a) * Math.sin(b) * k2 + cc;
  out[0] = dpdy;
  out[1] = -dpdx;
  return out;
}

function parseColor(css) {
  const m = css.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0] | 0, +m[1] | 0, +m[2] | 0];
}

export function createVanish({ root, input, canvas }, { onSettle, onEmpty } = {}) {
  const ctx = canvas.getContext("2d");
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  let dpr = 2;
  let width = 0;
  let height = 0;
  let cw = 0;
  let ch = 0;
  let image = null;
  let pixels = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let frozen = false;
  let seedCounter = 1;
  const bursts = [];
  const flow = [0, 0];
  // Only the region the particles covered last frame is cleared and
  // re-uploaded, so a full-viewport overlay costs no more than the cloud.
  let dirty = null;
  const box = [0, 0, 0, 0];

  // Where the input's baseline falls, measured the way Blink lays out a
  // single-line field: the line centred on whole-pixel font metrics, the
  // half-leading rounded up.
  function lineMetrics(cs, text = "Hxg") {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = sctx.measureText(text);
    const ascent = Math.round(m.fontBoundingBoxAscent);
    const descent = Math.round(m.fontBoundingBoxDescent);
    const lineHeight = parseFloat(cs.lineHeight);
    const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    return { lineHeight, padT, baseline: padT + Math.ceil((lineHeight - (ascent + descent)) / 2) + ascent };
  }

  function resize() {
    const r = root.getBoundingClientRect();
    width = r.width;
    height = r.height;
    dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    cw = Math.max(1, Math.round(width * dpr));
    ch = Math.max(1, Math.round(height * dpr));
    canvas.width = cw;
    canvas.height = ch;
    image = ctx.createImageData(cw, ch);
    pixels = new Uint32Array(image.data.buffer);
    dirty = null;
    // Stand the baseline rule exactly under the letters.
    const { baseline } = lineMetrics(getComputedStyle(input));
    root.style.setProperty("--vanish-baseline", `${baseline}px`);
    draw();
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
    const { lineHeight, padT, baseline: base } = lineMetrics(cs, text);
    const left = r.left - R.left + padL;
    const top = r.top - R.top + padT;
    const contentW = r.width - padL - padR;

    const S = dpr;
    // Device-aligned origin for the off-screen raster, so each sampled pixel
    // lands on a device pixel of the overlay.
    const ox = Math.floor((left - 8) * S) / S;
    const oy = Math.floor((top - 8) * S) / S;
    const w = Math.ceil((contentW + 16) * S);
    const h = Math.ceil((lineHeight + 16) * S);
    scratch.width = w;
    scratch.height = h;

    sctx.setTransform(S, 0, 0, S, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in sctx) sctx.letterSpacing = cs.letterSpacing;
    if ("fontKerning" in sctx) sctx.fontKerning = "normal";
    sctx.textBaseline = "alphabetic";
    sctx.fillStyle = "#000";
    const baseline = top - padT + base;

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
    return { xs, ys, as, minX, maxX, top, baseline, lineHeight, S, color: cs.color };
  }

  function makeBurst(text, scrollLeft) {
    const cap = capture(text, scrollLeft);
    const n = cap.xs.length;
    if (!n) return null;
    const rand = mulberry32(0x9e3779b1 ^ (seedCounter++ * 2654435761));
    const span = Math.max(1, cap.maxX - cap.minX);
    // The sweep takes longer for a longer line, within a narrow band.
    const sweep = clamp(0.3 + span * 0.0008, 0.36, 0.7);
    const x = new Float32Array(cap.xs);
    const y = new Float32Array(cap.ys);
    const a0 = new Float32Array(cap.as);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const release = new Float32Array(n);
    const life = new Float32Array(n);
    const keep = new Float32Array(n);
    const wind = new Float32Array(n * 2);
    // The glyphs' optical middle: halfway between baseline and x-height-ish.
    const mid = cap.baseline - cap.lineHeight * 0.32;
    let end = 0;
    for (let p = 0; p < n; p++) {
      const u = (x[p] - cap.minX) / span;
      // A clean front with a soft, slow wave along the glyph height, so the
      // edge between letter and dust stays legible as it travels.
      const wobble = Math.sin((y[p] - mid) * 0.16 + u * 7) * 0.014;
      release[p] = sweep * (0.55 * easeOutQuad(u) + 0.45 * u) + wobble + rand() * 0.022;
      if (release[p] < 0) release[p] = rand() * 0.012;
      life[p] = 1.05 + rand() * 0.5;
      // Thin by sparsity: each speck lives at full ink until its own moment,
      // drawn so the surviving share follows (1 - u)^1.15. Antialiased edge
      // pixels are dithered: kept with a chance equal to their coverage.
      keep[p] = rand() < a0[p] ? 1 - Math.pow(rand(), 1 / 1.15) : 0;
      // Each pixel leaves up and to the right, the top of a glyph a little
      // more upward than its foot, so the cloud fans open as it rises.
      const lift = (mid - y[p]) / cap.lineHeight;
      const speed = 150 + rand() * 150;
      const ang = -0.62 - lift * 0.55 + (rand() - 0.5) * 0.6;
      vx[p] = Math.cos(ang) * speed;
      vy[p] = Math.sin(ang) * speed;
      wind[p * 2] = 150 + rand() * 44;
      wind[p * 2 + 1] = -(112 + rand() * 44);
      end = Math.max(end, release[p] + life[p] * keep[p]);
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
      keep,
      wind,
      age: 0,
      end,
      rgb: parseColor(cap.color),
      reduced: reduce.matches,
      settled: false,
    };
  }

  function stepBurst(b, dt) {
    b.age += dt;
    if (b.reduced) return;
    const t = b.age;
    const { n, x, y, vx, vy, release, life, keep, wind } = b;
    const k = 2.1 * dt;
    for (let p = 0; p < n; p++) {
      const age = t - release[p];
      if (age <= 0 || age > life[p] * keep[p]) continue;
      curl(x[p], y[p], t, flow);
      const fx = wind[p * 2] + flow[0];
      const fy = wind[p * 2 + 1] + flow[1];
      vx[p] += (fx - vx[p]) * k;
      vy[p] += (fy - vy[p]) * k;
      // Ease in over the first few frames, so a pixel peels off its letter
      // rather than being shot out of it.
      const peel = age < 0.07 ? (age / 0.07) * (age / 0.07) : 1;
      x[p] += vx[p] * dt * peel;
      y[p] += vy[p] * dt * peel;
    }
  }

  // Write one device pixel at `alpha` (0-255), keeping the stronger of what
  // is already there. Pixels off the canvas are dropped.
  function plot(px, py, alpha, rgb) {
    const i = Math.round(px * dpr);
    const j = Math.round(py * dpr);
    if (i < 0 || j < 0 || i >= cw || j >= ch) return;
    const o = j * cw + i;
    const prev = pixels[o] >>> 24;
    if (prev >= alpha) return;
    pixels[o] = ((alpha << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0]) >>> 0;
    if (i < box[0]) box[0] = i;
    if (j < box[1]) box[1] = j;
    if (i > box[2]) box[2] = i;
    if (j > box[3]) box[3] = j;
  }

  function drawBurst(b) {
    const t = b.age;
    const { n, x, y, a0, release, life, keep, rgb } = b;
    if (b.reduced) {
      // Reduced motion: the line thins out where it sits, speck by speck.
      const f = easeOutQuad(clamp(t / 0.32, 0, 1));
      for (let p = 0; p < n; p++) {
        if (keep[p] <= f && f > 0) continue;
        plot(x[p], y[p], (a0[p] * 255) | 0, rgb);
      }
      return;
    }
    for (let p = 0; p < n; p++) {
      const age = t - release[p];
      if (age <= 0) {
        plot(x[p], y[p], (a0[p] * 255) | 0, rgb);
        continue;
      }
      if (age >= life[p] * keep[p]) continue;
      plot(x[p], y[p], 255, rgb);
    }
  }

  function draw() {
    if (!pixels) return;
    // Clear what was drawn last frame.
    if (dirty) {
      for (let j = dirty[1]; j <= dirty[3]; j++) pixels.fill(0, j * cw + dirty[0], j * cw + dirty[2] + 1);
    }
    box[0] = Infinity;
    box[1] = Infinity;
    box[2] = -Infinity;
    box[3] = -Infinity;
    for (const b of bursts) drawBurst(b);
    const drawn = box[0] <= box[2] ? [box[0], box[1], box[2], box[3]] : null;
    // Upload the union of last frame's region and this one's.
    let up = dirty;
    if (drawn) {
      up = up
        ? [Math.min(up[0], drawn[0]), Math.min(up[1], drawn[1]), Math.max(up[2], drawn[2]), Math.max(up[3], drawn[3])]
        : drawn;
    }
    if (up) ctx.putImageData(image, 0, 0, up[0], up[1], up[2] - up[0] + 1, up[3] - up[1] + 1);
    dirty = drawn;
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
      root.style.removeProperty("--vanish-baseline");
    },
  };
}
