import { createLoomGL } from "./loomGL";
import { INK, INK_ON_ACCENT, TONES, WEAVES, warpTone, weftTone } from "./loomLyrics";
import { ATLAS_W, ROW_H, buildTapeAtlas, readyTapeFonts } from "./loomTape";

const SUB = 1 / 360;
const SEG = 8;
const EXT = 0.625;
const K_ANCHOR = 26;
const K_NEIGHBOUR = 900;
const C_ANCHOR = 8.8;
const C_RELATIVE = 44;
const K_HAND = 3000;
const C_HAND = 90;
const K_WAVE = 240;
const K_LIFT_HOME = 16;
const C_LIFT = 2.4;
const SCROLL_SPEED = 16;
const GLOW = [1.0, 0.62, 0.3];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function speedOf(r) {
  const wobble = 0.78 + ((r * 0.6180339) % 1) * 0.44;
  return (r % 2 === 0 ? 1 : -1) * wobble;
}

export function createLoomEngine({ root, stage, canvas, backlight, insets, embedded, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1 };
  const grid = { rows: 0, cols: 0, s: 40, ox: 0, oy: 0 };
  let px, py, rx, ry, vx, vy, lift, liftV, gradX, gradY, ax, ay, ah;
  let weights = null;
  let p0x = null;
  let p0y = null;
  let stat = null;
  let dyn = null;
  let threads = [];
  let gl = null;
  let fonts = null;
  let atlasKey = "";
  let visible = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let scroll = 0;
  let scrollVel = 0;
  let hovered = false;
  let ready = false;
  let weaveFrom = 0;
  let weaveTo = 0;
  let weaveMix = 1;
  let rippleBoost = 0;

  const ptr = { x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, fresh: true };
  const hand = { active: false, id: -1, gx: 0, gy: 0, release: false, type: "mouse" };

  function allocate(n) {
    px = new Float32Array(n);
    py = new Float32Array(n);
    rx = new Float32Array(n);
    ry = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    lift = new Float32Array(n);
    liftV = new Float32Array(n);
    gradX = new Float32Array(n);
    gradY = new Float32Array(n);
    ax = new Float32Array(n);
    ay = new Float32Array(n);
    ah = new Float32Array(n);
    weights = new Float32Array(n);
    p0x = new Float32Array(n);
    p0y = new Float32Array(n);
  }

  function layout() {
    const pad = insets(view.width, view.height);
    const availW = Math.max(120, view.width - pad.left - pad.right);
    const availH = Math.max(160, view.height - pad.top - pad.bottom);
    const s = clamp(Math.min(availW, availH) / 11.5, 22, 44);
    let cols = clamp(Math.floor(availW / s - 0.5), 6, 18);
    let rows = clamp(Math.floor(availH / s - 0.5), 6, 22);
    rows = Math.min(rows, Math.round(cols * 1.6));
    cols = Math.min(cols, Math.round(rows * 1.25));
    const clothW = (cols - 1) * s;
    const clothH = (rows - 1) * s;
    const cx = pad.left + availW / 2;
    const cy = pad.top + availH / 2;
    return { rows, cols, s, ox: Math.round(cx - clothW / 2), oy: Math.round(cy - clothH / 2) };
  }

  function buildGrid(next) {
    const changed = next.rows !== grid.rows || next.cols !== grid.cols;
    Object.assign(grid, next);
    const { rows, cols, s, ox, oy } = grid;
    if (changed) allocate(rows * cols);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        rx[i] = ox + c * s;
        ry[i] = oy + r * s;
        if (changed) {
          px[i] = rx[i];
          py[i] = ry[i];
        } else {
          px[i] = rx[i] + (px[i] - rx[i]);
          py[i] = ry[i] + (py[i] - ry[i]);
        }
      }
    }
    if (changed) buildThreads();
    placeBacklight();
  }

  function placeBacklight() {
    if (!backlight) return;
    const { rows, cols, s, ox, oy } = grid;
    const pad = -s * 0.2;
    backlight.style.left = `${ox - pad}px`;
    backlight.style.top = `${oy - pad}px`;
    backlight.style.width = `${(cols - 1) * s + pad * 2}px`;
    backlight.style.height = `${(rows - 1) * s + pad * 2}px`;
  }

  function buildThreads() {
    const { rows, cols } = grid;
    threads = [];
    let vert = 0;
    for (let r = 0; r < rows; r += 1) {
      const n = Math.round((cols - 1 + EXT * 2) * SEG) + 1;
      threads.push({ axis: 0, idx: r, n, start: vert, row: r, tone: weftTone(r), speed: speedOf(r) });
      vert += n * 2;
    }
    for (let c = 0; c < cols; c += 1) {
      const n = Math.round((rows - 1 + EXT * 2) * SEG) + 1;
      threads.push({ axis: 1, idx: c, n, start: vert, row: rows + c, tone: warpTone(c), speed: 0 });
      vert += n * 2;
    }
    stat = new Float32Array(vert * 8);
    dyn = new Float32Array(vert * 8);
    for (const t of threads) {
      for (let j = 0; j < t.n; j += 1) {
        const u = -EXT + j / SEG;
        for (let side = 0; side < 2; side += 1) {
          const o = (t.start + j * 2 + side) * 8;
          stat[o] = side === 0 ? -1 : 1;
          stat[o + 1] = u;
          stat[o + 2] = t.axis;
          stat[o + 3] = t.idx;
          stat[o + 4] = t.row;
          stat[o + 5] = 1;
          stat[o + 6] = t.tone;
          stat[o + 7] = t.speed;
        }
      }
    }
    atlasKey = "";
  }

  function ensureAtlas() {
    const key = `${grid.rows}x${grid.cols}`;
    if (!gl || !fonts || key === atlasKey) return;
    const { canvas: atlas, tiles, count } = buildTapeAtlas(fonts, grid.rows, grid.cols);
    gl.uploadAtlas(atlas, count);
    for (const t of threads) {
      const tile = tiles[t.row];
      for (let j = 0; j < t.n * 2; j += 1) stat[(t.start + j) * 8 + 5] = tile;
    }
    const index = buildIndex();
    gl.setGeometry(stat, index, dyn.length);
    atlasKey = key;
  }

  function buildIndex() {
    let quads = 0;
    for (const t of threads) quads += t.n - 1;
    const index = new Uint32Array(quads * 6);
    let k = 0;
    for (const t of threads) {
      for (let j = 0; j < t.n - 1; j += 1) {
        const a = t.start + j * 2;
        index[k++] = a;
        index[k++] = a + 1;
        index[k++] = a + 2;
        index[k++] = a + 1;
        index[k++] = a + 3;
        index[k++] = a + 2;
      }
    }
    return index;
  }

  function nodeAt(t, k, out) {
    const { cols, rows } = grid;
    const n = t.axis === 0 ? cols : rows;
    const id = (m) => (t.axis === 0 ? t.idx * cols + m : m * cols + t.idx);
    if (k >= 0 && k < n) {
      const i = id(k);
      out[0] = px[i];
      out[1] = py[i];
      return;
    }
    const a = k < 0 ? id(0) : id(n - 1);
    const b = k < 0 ? id(1) : id(n - 2);
    const steps = k < 0 ? -k : k - n + 1;
    out[0] = px[a] + (px[a] - px[b]) * steps;
    out[1] = py[a] + (py[a] - py[b]) * steps;
  }

  const P0 = [0, 0];
  const P1 = [0, 0];
  const P2 = [0, 0];
  const P3 = [0, 0];

  function computeGradients() {
    const { rows, cols, s } = grid;
    const scale = 0.5 / s;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const l = c > 0 ? lift[i - 1] : lift[i];
        const rr = c < cols - 1 ? lift[i + 1] : lift[i];
        const u = r > 0 ? lift[i - cols] : lift[i];
        const d = r < rows - 1 ? lift[i + cols] : lift[i];
        const hx = (c > 0 && c < cols - 1 ? 0.5 : 1) * (rr - l);
        const hy = (r > 0 && r < rows - 1 ? 0.5 : 1) * (d - u);
        gradX[i] = hx * s * 0.5 * scale;
        gradY[i] = hy * s * 0.5 * scale;
      }
    }
  }

  function writeDyn() {
    const { rows, cols } = grid;
    computeGradients();
    for (const t of threads) {
      const n = t.axis === 0 ? cols : rows;
      const id = (m) => {
        const mm = clamp(m, 0, n - 1);
        return t.axis === 0 ? t.idx * cols + mm : mm * cols + t.idx;
      };
      for (let j = 0; j < t.n; j += 1) {
        const u = -EXT + j / SEG;
        let k = Math.floor(u);
        let f = u - k;
        if (j === t.n - 1 && f < 1e-6 && k > -1) {
          k -= 1;
          f = 1;
        }
        nodeAt(t, k - 1, P0);
        nodeAt(t, k, P1);
        nodeAt(t, k + 1, P2);
        nodeAt(t, k + 2, P3);
        const f2 = f * f;
        const f3 = f2 * f;
        const cx = 0.5 * (2 * P1[0] + (-P0[0] + P2[0]) * f + (2 * P0[0] - 5 * P1[0] + 4 * P2[0] - P3[0]) * f2 + (-P0[0] + 3 * P1[0] - 3 * P2[0] + P3[0]) * f3);
        const cy = 0.5 * (2 * P1[1] + (-P0[1] + P2[1]) * f + (2 * P0[1] - 5 * P1[1] + 4 * P2[1] - P3[1]) * f2 + (-P0[1] + 3 * P1[1] - 3 * P2[1] + P3[1]) * f3);
        const dx = 0.5 * ((-P0[0] + P2[0]) + 2 * (2 * P0[0] - 5 * P1[0] + 4 * P2[0] - P3[0]) * f + 3 * (-P0[0] + 3 * P1[0] - 3 * P2[0] + P3[0]) * f2);
        const dy = 0.5 * ((-P0[1] + P2[1]) + 2 * (2 * P0[1] - 5 * P1[1] + 4 * P2[1] - P3[1]) * f + 3 * (-P0[1] + 3 * P1[1] - 3 * P2[1] + P3[1]) * f2);
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const ia = id(k);
        const ib = id(k + 1);
        const sm = f * f * (3 - 2 * f);
        const h = lift[ia] + (lift[ib] - lift[ia]) * sm;
        const gx = gradX[ia] + (gradX[ib] - gradX[ia]) * sm;
        const gy = gradY[ia] + (gradY[ib] - gradY[ia]) * sm;
        for (let side = 0; side < 2; side += 1) {
          const o = (t.start + j * 2 + side) * 8;
          dyn[o] = cx;
          dyn[o + 1] = cy;
          dyn[o + 2] = nx;
          dyn[o + 3] = ny;
          dyn[o + 4] = len;
          dyn[o + 5] = h;
          dyn[o + 6] = gx;
          dyn[o + 7] = gy;
        }
      }
    }
  }

  function soften(dx, dy) {
    const limit = grid.s * 2.2;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return [0, 0];
    const k = (limit * Math.tanh(d / limit)) / d;
    return [dx * k, dy * k];
  }

  function step(h) {
    const { rows, cols, s } = grid;
    const n = rows * cols;
    const boost = rippleBoost;
    const cRel = C_RELATIVE * (1 - 0.75 * boost);
    const cAbs = C_ANCHOR * (1 - 0.45 * boost);
    let hdx = 0;
    let hdy = 0;
    let pull = 0;
    if (hand.active) {
      [hdx, hdy] = soften(ptr.x - hand.gx, ptr.y - hand.gy);
      pull = Math.min(1, Math.hypot(hdx, hdy) / (s * 1.6));
    }
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const dX = px[i] - rx[i];
        const dY = py[i] - ry[i];
        let lx = 0;
        let ly = 0;
        let lvx = 0;
        let lvy = 0;
        let lh = 0;
        let count = 0;
        const add = (j) => {
          lx += px[j] - rx[j];
          ly += py[j] - ry[j];
          lvx += vx[j];
          lvy += vy[j];
          lh += lift[j];
          count += 1;
        };
        if (c > 0) add(i - 1);
        if (c < cols - 1) add(i + 1);
        if (r > 0) add(i - cols);
        if (r < rows - 1) add(i + cols);
        lx -= dX * count;
        ly -= dY * count;
        lvx -= vx[i] * count;
        lvy -= vy[i] * count;
        lh -= lift[i] * count;
        const edge = Math.min(r, c, rows - 1 - r, cols - 1 - c);
        const pin = edge === 0 ? 7 : edge === 1 ? 2.6 : 1;
        const kA = K_ANCHOR * pin;
        const cA = cAbs * Math.sqrt(pin);
        let fx = -kA * dX + K_NEIGHBOUR * lx - cA * vx[i] + cRel * lvx;
        let fy = -kA * dY + K_NEIGHBOUR * ly - cA * vy[i] + cRel * lvy;
        let fh = K_WAVE * lh - K_LIFT_HOME * lift[i] - C_LIFT * (1 + (1 - boost) * 1.6) * liftV[i];
        const w = hand.active ? weights[i] : 0;
        if (w > 0) {
          fx += K_HAND * w * (p0x[i] + hdx - px[i]) - C_HAND * w * vx[i];
          fy += K_HAND * w * (p0y[i] + hdy - py[i]) - C_HAND * w * vy[i];
          fh += 90 * w * (0.9 * pull - lift[i]) - 8 * w * liftV[i];
        }
        ax[i] = fx;
        ay[i] = fy;
        ah[i] = fh;
      }
    }
    for (let i = 0; i < n; i += 1) {
      vx[i] += ax[i] * h;
      vy[i] += ay[i] * h;
      px[i] += vx[i] * h;
      py[i] += vy[i] * h;
      liftV[i] += ah[i] * h;
      lift[i] += liftV[i] * h;
    }
  }

  function settled() {
    const n = grid.rows * grid.cols;
    let maxV = 0;
    let maxD = 0;
    let maxH = 0;
    for (let i = 0; i < n; i += 1) {
      maxV = Math.max(maxV, Math.abs(vx[i]), Math.abs(vy[i]), Math.abs(liftV[i]) * grid.s);
      maxD = Math.max(maxD, Math.abs(px[i] - rx[i]), Math.abs(py[i] - ry[i]), Math.abs(lift[i]) * grid.s);
    }
    return maxV < 0.6 && maxD < 0.08;
  }

  function snapRest() {
    const n = grid.rows * grid.cols;
    for (let i = 0; i < n; i += 1) {
      px[i] = rx[i];
      py[i] = ry[i];
      vx[i] = vy[i] = lift[i] = liftV[i] = 0;
    }
  }

  function weaveTriple() {
    const e = weaveMix < 1 ? 1 - Math.pow(1 - weaveMix, 3) : 1;
    return [weaveFrom, weaveTo, e];
  }

  function render() {
    if (!gl || !atlasKey) return;
    writeDyn();
    gl.updateDyn(dyn);
    const tones = new Float32Array(18);
    TONES.forEach((t, i) => tones.set(t, i * 3));
    gl.draw({
      width: view.width,
      height: view.height,
      half: grid.s * 0.41,
      rows: grid.rows,
      cols: grid.cols,
      weave: weaveTriple(),
      ext: EXT,
      spacing: grid.s,
      atlasW: ATLAS_W,
      rowH: ROW_H,
      scroll,
      tones,
      ink: INK,
      inkAccent: INK_ON_ACCENT,
      glow: GLOW,
      zAmp: grid.s * 0.24,
    });
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !gl || !visible || document.hidden) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;

    if (ptr.fresh) {
      ptr.prevX = ptr.x;
      ptr.prevY = ptr.y;
      ptr.fresh = false;
    }
    const rawVx = (ptr.x - ptr.prevX) / Math.max(dt, 1e-3);
    const rawVy = (ptr.y - ptr.prevY) / Math.max(dt, 1e-3);
    const blend = 1 - Math.exp(-dt / 0.045);
    ptr.vx += (rawVx - ptr.vx) * blend;
    ptr.vy += (rawVy - ptr.vy) * blend;
    ptr.prevX = ptr.x;
    ptr.prevY = ptr.y;

    if (hand.release) {
      hand.release = false;
      finishGrab();
    }

    const targetScroll = (hovered || hand.active) && !reduced ? SCROLL_SPEED : 0;
    scrollVel += (targetScroll - scrollVel) * (1 - Math.exp(-dt / 0.45));
    if (targetScroll === 0 && scrollVel < 0.05) scrollVel = 0;
    scroll += scrollVel * dt;

    if (weaveMix < 1) weaveMix = Math.min(1, weaveMix + dt / 0.6);
    if (rippleBoost > 0) rippleBoost = Math.max(0, rippleBoost - dt / 1.4);

    acc += dt;
    while (acc >= SUB) {
      step(SUB);
      acc -= SUB;
    }

    const calm = !hand.active && settled();
    if (calm) snapRest();
    render();

    const busy = !calm || hand.active || scrollVel > 0 || weaveMix < 1 || hovered;
    if (busy) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !gl || !visible || document.hidden) return;
    last = 0;
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = stage.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onCloth(x, y) {
    const { ox, oy, s, rows, cols } = grid;
    const m = s * 0.9;
    return x > ox - m && x < ox + (cols - 1) * s + m && y > oy - m && y < oy + (rows - 1) * s + m;
  }

  function startGrab(x, y) {
    const { s } = grid;
    const n = grid.rows * grid.cols;
    const sigma = s * 0.85;
    const inv = 1 / (2 * sigma * sigma);
    for (let i = 0; i < n; i += 1) {
      const d2 = (px[i] - x) ** 2 + (py[i] - y) ** 2;
      const w = Math.exp(-d2 * inv);
      weights[i] = w > 0.015 ? w : 0;
      p0x[i] = px[i];
      p0y[i] = py[i];
    }
    hand.active = true;
    hand.gx = x;
    hand.gy = y;
    root.setAttribute("data-grabbing", "");
  }

  function finishGrab() {
    if (!hand.active) return;
    hand.active = false;
    root.removeAttribute("data-grabbing");
    const speed = Math.hypot(ptr.vx, ptr.vy);
    const flick = speed > grid.s * 18;
    if (!flick) return;
    const cap = grid.s * 60;
    const k = Math.min(1, cap / speed) * 0.55;
    const n = grid.rows * grid.cols;
    const kick = Math.min(1.6, speed / (grid.s * 40)) * (reduced ? 4 : 13);
    for (let i = 0; i < n; i += 1) {
      const w = weights[i];
      if (!w) continue;
      vx[i] += ptr.vx * k * w;
      vy[i] += ptr.vy * k * w;
      liftV[i] += kick * w;
    }
    rippleBoost = reduced ? 0.3 : 1;
  }

  function onDown(e) {
    if (!ready || (e.button !== undefined && e.button !== 0)) return;
    const [x, y] = local(e);
    if (!onCloth(x, y)) return;
    if (hand.active) return;
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    stage.focus({ preventScroll: true });
    hand.id = e.pointerId;
    hand.type = e.pointerType;
    ptr.x = x;
    ptr.y = y;
    ptr.fresh = true;
    ptr.vx = 0;
    ptr.vy = 0;
    hand.release = false;
    startGrab(x, y);
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (hand.active && e.pointerId === hand.id) {
      ptr.x = x;
      ptr.y = y;
      return;
    }
    if (hand.active) return;
    ptr.x = x;
    ptr.y = y;
    const over = e.pointerType === "mouse" && onCloth(x, y);
    if (over !== hovered) {
      hovered = over;
      root.toggleAttribute("data-hover", over);
      if (over) wake();
    }
  }

  function onUp(e) {
    if (!hand.active || e.pointerId !== hand.id) return;
    const [x, y] = local(e);
    ptr.x = x;
    ptr.y = y;
    hand.release = true;
    if (e.pointerType !== "mouse") hovered = false;
    wake();
  }

  function onCancel(e) {
    if (!hand.active || hand.release || e.pointerId !== hand.id) return;
    ptr.vx = 0;
    ptr.vy = 0;
    hand.release = true;
    wake();
  }

  function onLeave(e) {
    if (e.pointerType !== "mouse") return;
    if (hovered) {
      hovered = false;
      root.removeAttribute("data-hover");
      wake();
    }
  }

  function impulse(cx, cy, dirX, dirY, strength, liftKick) {
    const { s } = grid;
    const sigma = s * 1.3;
    const inv = 1 / (2 * sigma * sigma);
    const n = grid.rows * grid.cols;
    for (let i = 0; i < n; i += 1) {
      const w = Math.exp(-((px[i] - cx) ** 2 + (py[i] - cy) ** 2) * inv);
      if (w < 0.01) continue;
      vx[i] += dirX * strength * w;
      vy[i] += dirY * strength * w;
      liftV[i] += liftKick * w;
    }
    rippleBoost = reduced ? 0.3 : 1;
    wake();
  }

  function centre() {
    const { ox, oy, s, rows, cols } = grid;
    return [ox + ((cols - 1) * s) / 2, oy + ((rows - 1) * s) / 2];
  }

  function onKey(e) {
    if (!ready) return;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const [cx, cy] = centre();
    if (dirs[e.key]) {
      e.preventDefault();
      const [dx, dy] = dirs[e.key];
      impulse(cx, cy, dx, dy, grid.s * 26, reduced ? 2 : 6);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      impulse(cx, cy, 0, 0, 0, reduced ? 5 : 16);
    }
  }

  function setWeave(id) {
    const idx = Math.max(0, WEAVES.findIndex((w) => w.id === id));
    if (idx === weaveTo && weaveMix >= 1) return;
    weaveFrom = weaveMix >= 0.5 ? weaveTo : weaveFrom;
    weaveTo = idx;
    weaveMix = reduced ? 1 : 0;
    if (!reduced && ready) {
      const { rows, cols } = grid;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < Math.min(2, cols); c += 1) liftV[r * cols + c] += c === 0 ? 7 : 4;
      }
      rippleBoost = 1;
    }
    if (reduced) render();
    wake();
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (gl) gl.resize(Math.round(view.width * view.dpr), Math.round(view.height * view.dpr));
    buildGrid(layout());
    if (gl && fonts) ensureAtlas();
    if (hand.active) {
      hand.active = false;
      root.removeAttribute("data-grabbing");
    }
    if (ready) {
      render();
      wake();
    }
  }

  async function init() {
    try {
      gl = createLoomGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      onFail?.();
      return;
    }
    resize();
    fonts = await readyTapeFonts(root);
    if (destroyed) return;
    ensureAtlas();
    ready = true;
    render();
    onReady?.();
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "0px" },
  );
  io.observe(root);
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  const onVisibility = () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!document.hidden) wake();
  };
  const onLost = (e) => {
    e.preventDefault();
    onFail?.();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onCancel);
  stage.addEventListener("lostpointercapture", onCancel);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);

  init();

  return {
    setWeave,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onCancel);
      stage.removeEventListener("lostpointercapture", onCancel);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}

