import { createBlips } from "./blobAudio";

const IW = 1200;
const IH = 1600;
const LW = 150;
const LH = 200;
const SW = 600;
const SH = 800;
const ZOOM = 1.085;
const LISP = '(loop (format t "~%"))';
const FIRST_ID = 2183584;
const BOX = "#c9f25c";
const LINE = "rgba(214, 246, 112, 0.86)";
const CURVE = "rgba(255, 255, 255, 0.82)";
const DOT = "#ff3b2f";
const FONT = '"BlobTrack Arimo", Arimo, Arial, sans-serif';

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function readPixels(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

function buildLuma(img) {
  const data = readPixels(img, LW, LH).data;
  const lum = new Float32Array(LW * LH);
  for (let i = 0; i < LW * LH; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = 0.55 * Math.max(r, g, b) + 0.45 * y;
  }
  return lum;
}

function boxBlurColumns(src, dst, w, h, radius) {
  const span = radius * 2 + 1;
  for (let x = 0; x < w; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += src[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c];
      for (let y = 0; y < h; y += 1) {
        dst[(y * w + x) * 3 + c] = sum / span;
        const add = Math.min(h - 1, y + radius + 1);
        const sub = Math.max(0, y - radius);
        sum += src[(add * w + x) * 3 + c] - src[(sub * w + x) * 3 + c];
      }
    }
  }
}

function buildSmear(img) {
  const raw = readPixels(img, SW, SH).data;
  const n = SW * SH;
  const src = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    src[i * 3] = raw[i * 4] / 255;
    src[i * 3 + 1] = raw[i * 4 + 1] / 255;
    src[i * 3 + 2] = raw[i * 4 + 2] / 255;
  }
  const a = new Float32Array(n * 3);
  const b = new Float32Array(n * 3);
  boxBlurColumns(src, a, SW, SH, 22);
  boxBlurColumns(a, b, SW, SH, 22);
  const streak = new Float32Array(n * 3);
  for (let x = 0; x < SW; x += 1) {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let y = 0; y < SH; y += 1) {
      const i = (y * SW + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const m = smoothstep(0.42, 0.95, l);
      r = Math.max(src[i] * m, r * 0.988);
      g = Math.max(src[i + 1] * m, g * 0.988);
      bl = Math.max(src[i + 2] * m, bl * 0.988);
      streak[i] = r;
      streak[i + 1] = g;
      streak[i + 2] = bl;
    }
    r = 0;
    g = 0;
    bl = 0;
    for (let y = SH - 1; y >= 0; y -= 1) {
      const i = (y * SW + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const m = smoothstep(0.5, 0.95, l);
      r = Math.max(src[i] * m, r * 0.975);
      g = Math.max(src[i + 1] * m, g * 0.975);
      bl = Math.max(src[i + 2] * m, bl * 0.975);
      streak[i] = Math.max(streak[i], r);
      streak[i + 1] = Math.max(streak[i + 1], g);
      streak[i + 2] = Math.max(streak[i + 2], bl);
    }
  }
  boxBlurColumns(streak, a, SW, SH, 3);
  const out = new ImageData(SW, SH);
  const tint = [0.86, 0.87, 1.06];
  for (let i = 0; i < n; i += 1) {
    const rgb = [0, 0, 0];
    for (let c = 0; c < 3; c += 1) {
      const base = b[i * 3 + c] * 0.62 + src[i * 3 + c] * 0.38;
      const s = a[i * 3 + c] * 0.72;
      rgb[c] = 1 - (1 - base) * (1 - s);
    }
    const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    for (let c = 0; c < 3; c += 1) {
      let v = l + (rgb[c] - l) * 0.38;
      v = v * tint[c];
      v = 0.05 * tint[c] + v * 0.92;
      v = Math.pow(Math.max(0, v), 0.94);
      out.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    out.data[i * 4 + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = SW;
  c.height = SH;
  c.getContext("2d").putImageData(out, 0, 0);
  return c;
}

function iou(a, b) {
  const x0 = Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const x1 = Math.min(a.x + a.w / 2, b.x + b.w / 2);
  const y0 = Math.max(a.y - a.h / 2, b.y - b.h / 2);
  const y1 = Math.min(a.y + a.h / 2, b.y + b.h / 2);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function createTracker({ frame, canvas, src, onReady }) {
  const g = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    threshold: 0.72,
    count: 22,
    fw: 1,
    fh: 1,
    dpr: 1,
    k: 1,
    view: { dx: 0, dy: 0, r: 0, s: ZOOM },
    hub: { x: 470, y: 1060, tx: 470, ty: 1060, vx: 0, vy: 0, active: false },
    tracks: [],
    nextId: FIRST_ID + 1,
    t0: performance.now(),
    last: 0,
    raf: 0,
    visible: true,
    inView: true,
    ready: false,
    destroyed: false,
    font: 11,
  };
  let photo = null;
  let smear = null;
  let lum = null;
  let audio = null;
  let gw = 64;
  let gh = 86;
  let mask = new Uint8Array(gw * gh);
  let parent = new Int32Array(gw * gh);

  const toFrame = (ix, iy) => {
    const { dx, dy, r, s } = state.view;
    const sk = s * state.k;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    const ux = ix - IW / 2;
    const uy = iy - IH / 2;
    return [state.fw / 2 + dx + sk * (c * ux - sn * uy), state.fh / 2 + dy + sk * (sn * ux + c * uy)];
  };

  const toImage = (fx, fy) => {
    const { dx, dy, r, s } = state.view;
    const sk = s * state.k;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    const px = (fx - state.fw / 2 - dx) / sk;
    const py = (fy - state.fh / 2 - dy) / sk;
    return [IW / 2 + c * px + sn * py, IH / 2 - sn * px + c * py];
  };

  const resize = () => {
    const rect = frame.getBoundingClientRect();
    state.fw = Math.max(1, rect.width);
    state.fh = Math.max(1, rect.height);
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.fw * state.dpr);
    canvas.height = Math.round(state.fh * state.dpr);
    state.k = Math.max(state.fw / IW, state.fh / IH);
    state.font = Math.max(9.5, Math.min(11.5, state.fw * 0.0205));
    gw = 64;
    gh = Math.max(32, Math.round((64 * state.fh) / state.fw));
    mask = new Uint8Array(gw * gh);
    parent = new Int32Array(gw * gh);
    wake();
  };

  const updateView = (t) => {
    const a = reduced ? 0 : 1;
    const w = state.fw;
    state.view.dx = a * w * (0.011 * Math.sin(t * 0.29 + 1.1) + 0.006 * Math.sin(t * 0.71 + 2.3) + 0.0018 * Math.sin(t * 2.3 + 0.4));
    state.view.dy = a * w * (0.012 * Math.sin(t * 0.23 + 0.2) + 0.005 * Math.sin(t * 0.83 + 4.1) + 0.0016 * Math.sin(t * 2.9 + 1.7));
    state.view.r = a * (0.0042 * Math.sin(t * 0.19 + 0.7) + 0.0016 * Math.sin(t * 0.67 + 3.3));
    state.view.s = ZOOM + a * 0.008 * Math.sin(t * 0.13 + 0.5);
  };

  const sampleLum = (ix, iy) => {
    const x = (ix / IW) * LW - 0.5;
    const y = (iy / IH) * LH - 0.5;
    if (x < 0 || y < 0 || x >= LW - 1 || y >= LH - 1) return 0;
    const x0 = x | 0;
    const y0 = y | 0;
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * LW + x0;
    const top = lum[i] + (lum[i + 1] - lum[i]) * fx;
    const bot = lum[i + LW] + (lum[i + LW + 1] - lum[i + LW]) * fx;
    return top + (bot - top) * fy;
  };

  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let j = i;
    while (parent[j] !== r) {
      const next = parent[j];
      parent[j] = r;
      j = next;
    }
    return r;
  };

  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const detect = (t) => {
    const cw = state.fw / gw;
    const ch = state.fh / gh;
    const th = state.threshold;
    for (let j = 0; j < gh; j += 1) {
      for (let i = 0; i < gw; i += 1) {
        const [ix, iy] = toImage((i + 0.5) * cw, (j + 0.5) * ch);
        const wobble = 0.028 * Math.sin(ix * 0.011 + t * 0.53) * Math.sin(iy * 0.009 - t * 0.41) + 0.012 * Math.sin(ix * 0.031 - iy * 0.017 + t * 1.3);
        const idx = j * gw + i;
        mask[idx] = sampleLum(ix, iy) + wobble > th ? 1 : 0;
        parent[idx] = idx;
      }
    }
    for (let j = 0; j < gh; j += 1) {
      for (let i = 0; i < gw; i += 1) {
        const idx = j * gw + i;
        if (!mask[idx]) continue;
        if (i > 0 && mask[idx - 1]) unite(idx, idx - 1);
        if (j > 0) {
          if (mask[idx - gw]) unite(idx, idx - gw);
          if (i > 0 && mask[idx - gw - 1]) unite(idx, idx - gw - 1);
          if (i < gw - 1 && mask[idx - gw + 1]) unite(idx, idx - gw + 1);
        }
      }
    }
    const comps = new Map();
    for (let idx = 0; idx < gw * gh; idx += 1) {
      if (!mask[idx]) continue;
      const root = find(idx);
      const i = idx % gw;
      const j = (idx / gw) | 0;
      let c = comps.get(root);
      if (!c) {
        c = { x0: i, x1: i, y0: j, y1: j, n: 0 };
        comps.set(root, c);
      }
      if (i < c.x0) c.x0 = i;
      if (i > c.x1) c.x1 = i;
      if (j < c.y0) c.y0 = j;
      if (j > c.y1) c.y1 = j;
      c.n += 1;
    }
    const sk = state.view.s * state.k;
    const maxArea = gw * gh * 0.12;
    const dets = [];
    for (const c of comps.values()) {
      if (c.n < 2) continue;
      const bw = c.x1 - c.x0 + 1;
      const bh = c.y1 - c.y0 + 1;
      if (bw * bh > maxArea || bw > gw * 0.45 || bh > gh * 0.45) continue;
      const fx = ((c.x0 + c.x1 + 1) / 2) * cw;
      const fy = ((c.y0 + c.y1 + 1) / 2) * ch;
      const [ix, iy] = toImage(fx, fy);
      dets.push({ x: ix, y: iy, w: ((bw + 0.6) * cw) / sk, h: ((bh + 0.6) * ch) / sk, n: c.n });
    }
    dets.sort((p, q) => q.n - p.n);
    return dets.slice(0, state.count * 2 + 8);
  };

  const track = (dets, now, dt) => {
    const pairs = [];
    for (let d = 0; d < dets.length; d += 1) {
      for (let k = 0; k < state.tracks.length; k += 1) {
        const tr = state.tracks[k];
        const o = iou(dets[d], tr);
        const dist = Math.hypot(dets[d].x - tr.x, dets[d].y - tr.y);
        const near = dist < 0.5 * Math.max(tr.w, tr.h, dets[d].w, dets[d].h);
        if (o > 0.12 || near) pairs.push({ d, k, score: o + (near ? 0.1 : 0) });
      }
    }
    pairs.sort((p, q) => q.score - p.score);
    const usedD = new Uint8Array(dets.length);
    const usedT = new Uint8Array(state.tracks.length);
    for (const p of pairs) {
      if (usedD[p.d] || usedT[p.k]) continue;
      usedD[p.d] = 1;
      usedT[p.k] = 1;
      const det = dets[p.d];
      const tr = state.tracks[p.k];
      tr.det = det;
    }
    for (let k = 0; k < state.tracks.length; k += 1) if (!usedT[k]) state.tracks[k].det = null;
    for (let d = 0; d < dets.length; d += 1) {
      if (usedD[d]) continue;
      const det = dets[d];
      state.tracks.push({ id: 0, x: det.x, y: det.y, w: det.w, h: det.h, det, hits: 0, miss: 0, mode: "pending", born: 0, died: 0, link: 0, curve: 0 });
    }
    const ranked = state.tracks
      .filter((tr) => tr.det)
      .sort((p, q) => q.det.n * (p.mode === "live" ? 1.6 : 1) - p.det.n * (q.mode === "live" ? 1.6 : 1));
    ranked.forEach((tr, i) => {
      if (i >= state.count) tr.det = null;
    });
    const ease = 1 - Math.exp(-dt / 110);
    const fw = state.fw;
    for (const tr of state.tracks) {
      if (tr.det) {
        tr.hits += 1;
        tr.miss = 0;
        tr.x += (tr.det.x - tr.x) * ease;
        tr.y += (tr.det.y - tr.y) * ease;
        tr.w += (tr.det.w - tr.w) * ease;
        tr.h += (tr.det.h - tr.h) * ease;
        if (tr.mode === "pending" && tr.hits >= 4) {
          tr.mode = "live";
          tr.id = state.nextId;
          state.nextId += 1;
          tr.born = now;
          const [px] = toFrame(tr.x, tr.y);
          audio?.acquire(Math.sqrt(tr.w * tr.h) / 240, (px / fw) * 2 - 1);
        } else if (tr.mode === "dying") {
          tr.mode = "live";
          tr.born = now - 400;
        }
      } else {
        tr.miss += 1;
        tr.hits = tr.mode === "pending" ? 0 : tr.hits;
        if (tr.mode === "live" && tr.miss > 9) {
          tr.mode = "dying";
          tr.died = now;
          const [px] = toFrame(tr.x, tr.y);
          audio?.lose((px / fw) * 2 - 1);
        }
      }
    }
    state.tracks = state.tracks.filter((tr) => !(tr.mode === "pending" && tr.miss > 2) && !(tr.mode === "dying" && now - tr.died > 120));
  };

  const updateHub = (dt) => {
    const hub = state.hub;
    const omega = 16;
    const h = Math.min(0.05, dt / 1000);
    const ax = omega * omega * (hub.tx - hub.x) - 2 * omega * hub.vx;
    const ay = omega * omega * (hub.ty - hub.y) - 2 * omega * hub.vy;
    hub.vx += ax * h;
    hub.vy += ay * h;
    const cap = 5200;
    const sp = Math.hypot(hub.vx, hub.vy);
    if (sp > cap) {
      hub.vx *= cap / sp;
      hub.vy *= cap / sp;
    }
    hub.x += hub.vx * h;
    hub.y += hub.vy * h;
  };

  const updateLinks = (dt) => {
    const [hx, hy] = toFrame(state.hub.x, state.hub.y);
    const live = state.tracks.filter((tr) => tr.mode === "live");
    const scored = live
      .map((tr) => {
        const [x, y] = toFrame(tr.x, tr.y);
        return { tr, d: Math.hypot(x - hx, y - hy) };
      })
      .sort((p, q) => p.d - q.d);
    const fan = new Set(scored.slice(0, 7).map((s) => s.tr));
    const far = scored.slice(7);
    const curves = new Set(
      far
        .map((s) => s.tr)
        .filter((tr) => tr.id % 3 === 0)
        .sort((p, q) => p.id - q.id)
        .slice(0, 3),
    );
    const step = dt / 160;
    for (const tr of state.tracks) {
      const wantLink = tr.mode === "live" && fan.has(tr) ? 1 : 0;
      const wantCurve = tr.mode === "live" && curves.has(tr) ? 1 : 0;
      tr.link += Math.max(-step, Math.min(step, wantLink - tr.link));
      tr.curve += Math.max(-step * 0.7, Math.min(step * 0.7, wantCurve - tr.curve));
    }
  };

  const rectOf = (tr) => {
    const sk = state.view.s * state.k;
    const [cx, cy] = toFrame(tr.x, tr.y);
    const w = Math.max(7, tr.w * sk);
    const h = Math.max(7, tr.h * sk);
    return { x: Math.round(cx - w / 2) + 0.5, y: Math.round(cy - h / 2) + 0.5, w: Math.round(w), h: Math.round(h), cx, cy };
  };

  const strokeCorners = (r, len) => {
    g.beginPath();
    g.moveTo(r.x, r.y + len);
    g.lineTo(r.x, r.y);
    g.lineTo(r.x + len, r.y);
    g.moveTo(r.x + r.w - len, r.y);
    g.lineTo(r.x + r.w, r.y);
    g.lineTo(r.x + r.w, r.y + len);
    g.moveTo(r.x + r.w, r.y + r.h - len);
    g.lineTo(r.x + r.w, r.y + r.h);
    g.lineTo(r.x + r.w - len, r.y + r.h);
    g.moveTo(r.x + len, r.y + r.h);
    g.lineTo(r.x, r.y + r.h);
    g.lineTo(r.x, r.y + r.h - len);
    g.stroke();
  };

  const drawPhoto = (img) => {
    const { dx, dy, r, s } = state.view;
    g.save();
    g.translate(state.fw / 2 + dx, state.fh / 2 + dy);
    g.rotate(r);
    g.scale(s * state.k, s * state.k);
    g.drawImage(img, -IW / 2, -IH / 2, IW, IH);
    g.restore();
  };

  const draw = (now) => {
    const dpr = state.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = "#16151c";
    g.fillRect(0, 0, state.fw, state.fh);
    drawPhoto(smear);

    const shown = [];
    for (const tr of state.tracks) {
      if (tr.mode === "pending") continue;
      const age = now - tr.born;
      const dying = tr.mode === "dying" ? now - tr.died : -1;
      const rect = rectOf(tr);
      shown.push({ tr, rect, age, dying });
    }
    const [hx, hy] = toFrame(state.hub.x, state.hub.y);
    const hs = Math.round(Math.max(30, state.fw * 0.072));
    const hubRect = { x: Math.round(hx - hs / 2) + 0.5, y: Math.round(hy - hs / 2) + 0.5, w: hs, h: hs, cx: hx, cy: hy };

    g.save();
    g.beginPath();
    for (const s of shown) if (s.dying < 0 && s.age > 40) g.rect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    g.rect(hubRect.x, hubRect.y, hubRect.w, hubRect.h);
    g.clip();
    drawPhoto(photo);
    g.restore();

    g.lineWidth = 1;
    const curveEnds = [];
    for (const s of shown) {
      if (s.tr.curve <= 0.001) continue;
      const e = s.tr.curve;
      const tx = s.rect.cx;
      const ty = s.rect.y;
      const mx = (hx + tx) / 2;
      const my = (hy + ty) / 2;
      const bend = 0.32 * Math.hypot(tx - hx, ty - hy);
      const nx = -(ty - hy);
      const ny = tx - hx;
      const nl = Math.hypot(nx, ny) || 1;
      const side = s.tr.id % 2 ? 1 : -1;
      const cx = mx + (nx / nl) * bend * side;
      const cy = my + (ny / nl) * bend * side;
      g.strokeStyle = CURVE;
      g.beginPath();
      const steps = 24;
      const end = Math.max(1, Math.round(steps * e));
      g.moveTo(hx, hy);
      for (let i = 1; i <= end; i += 1) {
        const u = i / steps;
        const a = (1 - u) * (1 - u);
        const b = 2 * (1 - u) * u;
        const c = u * u;
        g.lineTo(a * hx + b * cx + c * tx, a * hy + b * cy + c * ty);
      }
      g.stroke();
      if (e > 0.98) curveEnds.push([tx, ty]);
    }
    g.strokeStyle = LINE;
    g.beginPath();
    const ends = [];
    for (const s of shown) {
      if (s.tr.link <= 0.001) continue;
      const e = 1 - Math.pow(1 - s.tr.link, 3);
      const tx = s.rect.x;
      const ty = s.rect.y;
      const ex = hx + (tx - hx) * e;
      const ey = hy + (ty - hy) * e;
      g.moveTo(hx, hy);
      g.lineTo(ex, ey);
      if (e > 0.98) ends.push([tx, ty]);
    }
    g.stroke();

    g.strokeStyle = BOX;
    for (const s of shown) {
      const { rect, age, dying } = s;
      if (dying >= 0) {
        if (dying < 60) g.strokeRect(rect.x, rect.y, rect.w, rect.h);
        else strokeCorners(rect, Math.min(4, rect.w / 3, rect.h / 3));
        continue;
      }
      if (age < 40) strokeCorners(rect, Math.min(4, rect.w / 3, rect.h / 3));
      else g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
    g.strokeRect(hubRect.x, hubRect.y, hubRect.w, hubRect.h);
    g.strokeRect(hubRect.x + 3, hubRect.y + 3, hubRect.w - 6, hubRect.h - 6);

    g.fillStyle = DOT;
    for (const [x, y] of ends.concat(curveEnds)) {
      g.beginPath();
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.arc(hx, hy, 2.4, 0, Math.PI * 2);
    g.fill();

    const fs = state.font;
    g.font = `${fs}px ${FONT}`;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffffff";
    const placed = [];
    const lineH = fs + 4;
    const lispW = g.measureText(LISP).width;
    const fits = (box) => {
      if (box.x1 < -40 || box.x0 > state.fw + 40 || box.y1 < 0 || box.y0 > state.fh) return false;
      for (const p of placed) if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) return false;
      return true;
    };
    const ordered = shown.filter((s) => s.dying < 0 && s.age >= 80).sort((p, q) => p.tr.id - q.tr.id);
    placed.push({ x0: hubRect.x - 4, x1: hubRect.x + hubRect.w + 4, y0: hubRect.y - 4, y1: hubRect.y + hubRect.h + 4 });
    for (const s of shown) placed.push({ x0: s.rect.x, x1: s.rect.x + s.rect.w, y0: s.rect.y, y1: s.rect.y + s.rect.h });
    const hubLabel = `${Math.round(state.hub.x)} ${Math.round(state.hub.y)}`;
    g.fillText("(track pointer)", hubRect.x + hubRect.w + 6, hubRect.y + fs);
    g.fillText(hubLabel, hubRect.x + hubRect.w + 6, hubRect.y + fs + lineH);
    placed.push({ x0: hubRect.x + hubRect.w, x1: hubRect.x + hubRect.w + 8 + g.measureText("(track pointer)").width, y0: hubRect.y, y1: hubRect.y + lineH * 2 });
    for (const s of ordered) {
      const id = `${s.tr.id}.0`;
      const idW = g.measureText(id).width;
      const y = s.rect.y + s.rect.h + fs + 3;
      const idBox = { x0: s.rect.x + s.rect.w + 6, x1: s.rect.x + s.rect.w + 6 + idW, y0: y - fs, y1: y + 3 };
      const full = { x0: idBox.x0 - 12 - lispW, x1: idBox.x1, y0: idBox.y0, y1: idBox.y1 };
      const chars = Math.floor((s.age - 80) / 20) * 4;
      if (fits(full)) {
        placed.push(full);
        const text = `${LISP}  ${id}`;
        const shownText = text.slice(0, Math.max(0, Math.min(text.length, chars)));
        g.fillText(shownText.slice(0, Math.min(LISP.length, shownText.length)), full.x0, y);
        if (shownText.length > LISP.length + 2) g.fillText(id.slice(0, shownText.length - LISP.length - 2), idBox.x0, y);
      } else if (fits(idBox)) {
        placed.push(idBox);
        g.fillText(id.slice(0, Math.max(0, chars)), idBox.x0, y);
      }
    }
  };

  let lastDetect = 0;
  const frameStep = (now) => {
    state.raf = 0;
    if (state.destroyed) return;
    const dt = state.last ? Math.min(64, now - state.last) : 16;
    state.last = now;
    const t = (now - state.t0) / 1000;
    updateView(t);
    if (now - lastDetect > 30 || !lastDetect) {
      track(detect(t), now, Math.max(dt, now - lastDetect || dt));
      lastDetect = now;
    }
    updateHub(dt);
    updateLinks(dt);
    draw(now);
    if (!state.ready) {
      state.ready = true;
      onReady?.();
    }
    if (state.visible && state.inView) state.raf = requestAnimationFrame(frameStep);
  };

  function wake() {
    if (state.destroyed || state.raf || !photo || !state.visible || !state.inView) return;
    state.last = 0;
    state.raf = requestAnimationFrame(frameStep);
  }

  const warm = () => {
    for (let i = 0; i < 14; i += 1) {
      const now = performance.now() - (14 - i) * 33;
      updateView((now - state.t0) / 1000);
      track(detect((now - state.t0) / 1000), now - 600, 33);
    }
    for (const tr of state.tracks) {
      if (tr.mode === "live") tr.born = -10000;
    }
    updateLinks(10000);
  };

  const setHubFromEvent = (e) => {
    const rect = frame.getBoundingClientRect();
    const [ix, iy] = toImage(e.clientX - rect.left, e.clientY - rect.top);
    state.hub.tx = Math.max(0, Math.min(IW, ix));
    state.hub.ty = Math.max(0, Math.min(IH, iy));
    state.hub.active = true;
  };

  const onMove = (e) => {
    if (e.pointerType !== "mouse" && !frame.hasPointerCapture?.(e.pointerId)) return;
    setHubFromEvent(e);
  };
  const onDown = (e) => {
    frame.setPointerCapture?.(e.pointerId);
    setHubFromEvent(e);
    frame.dataset.pointer = "";
  };
  const onUp = (e) => {
    if (frame.hasPointerCapture?.(e.pointerId)) frame.releasePointerCapture(e.pointerId);
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 120 : 40;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    delete frame.dataset.pointer;
    state.hub.tx = Math.max(0, Math.min(IW, state.hub.tx + d[0]));
    state.hub.ty = Math.max(0, Math.min(IH, state.hub.ty + d[1]));
  };
  frame.addEventListener("pointermove", onMove);
  frame.addEventListener("pointerdown", onDown);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);
  frame.addEventListener("keydown", onKey);

  const onVisibility = () => {
    state.visible = document.visibilityState === "visible";
    if (state.visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    state.inView = entry.isIntersecting;
    if (state.inView) wake();
  });
  io.observe(frame);
  const ro = new ResizeObserver(resize);
  ro.observe(frame);

  const img = new Image();
  img.decoding = "async";
  img.src = src;
  const fontReady = document.fonts?.load ? document.fonts.load(`11px "BlobTrack Arimo"`).catch(() => {}) : Promise.resolve();
  Promise.all([img.decode(), fontReady])
    .then(() => {
      if (state.destroyed) return;
      photo = img;
      lum = buildLuma(img);
      smear = buildSmear(img);
      resize();
      warm();
      wake();
    })
    .catch(() => {});

  return {
    setThreshold(v) {
      state.threshold = v;
      wake();
    },
    setCount(v) {
      state.count = v;
      wake();
    },
    async setSound(on) {
      if (on && !audio) audio = createBlips();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerdown", onDown);
      frame.removeEventListener("pointerup", onUp);
      frame.removeEventListener("pointercancel", onUp);
      frame.removeEventListener("keydown", onKey);
      audio?.destroy();
      audio = null;
    },
  };
}
