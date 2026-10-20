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
const BPM = 122;
const BEAT = 60 / BPM;
const CYCLE = 32;
const ACCENT = [1, 0, 0.5, 0.2, 0.9, 0, 0.5, 0.35, 1, 0, 0.55, 0.2, 0.9, 0.4, 0.7, 0.5];
const CODES = [
  LISP,
  "(setq lum (blob 0.72))",
  "(defun track (b) b)",
  "(mapcar #'id frame)",
  "(let ((x 0)) (incf x))",
  "(when (> l th) (box))",
  "(cons 'light nil)",
  "(sort cols #'<)",
];
const GLYPHS = "01#%&*+=<>/\\";

function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function hex(n) {
  return `#x${(Math.floor(hash(n) * 65535) | 0).toString(16).padStart(4, "0")}`;
}

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

function toCanvas(buf, w, h, tone) {
  const out = new ImageData(w, h);
  const n = w * h;
  for (let i = 0; i < n; i += 1) {
    const r = buf[i * 3];
    const g = buf[i * 3 + 1];
    const b = buf[i * 3 + 2];
    const v = tone(r, g, b);
    out.data[i * 4] = v[0];
    out.data[i * 4 + 1] = v[1];
    out.data[i * 4 + 2] = v[2];
    out.data[i * 4 + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").putImageData(out, 0, 0);
  return c;
}

const TINT = [0.86, 0.87, 1.06];

function grade(r, g, b, lift, crush = 0) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const rgb = [r, g, b];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    let v = l + (rgb[c] - l) * 0.42;
    if (crush) v = Math.pow(Math.max(0, v - crush) / (1 - crush), 1.35);
    v = v * TINT[c];
    v = lift * TINT[c] + v * 0.92;
    v = Math.pow(Math.max(0, v), 0.94);
    out[c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

function streaks(src, w, h, lo, down, up) {
  const out = new Float32Array(w * h * 3);
  for (let x = 0; x < w; x += 1) {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let y = 0; y < h; y += 1) {
      const i = (y * w + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const m = smoothstep(lo, 0.95, l);
      r = Math.max(src[i] * m, r * down);
      g = Math.max(src[i + 1] * m, g * down);
      bl = Math.max(src[i + 2] * m, bl * down);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = bl;
    }
    r = 0;
    g = 0;
    bl = 0;
    for (let y = h - 1; y >= 0; y -= 1) {
      const i = (y * w + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const m = smoothstep(lo + 0.08, 0.95, l);
      r = Math.max(src[i] * m, r * up);
      g = Math.max(src[i + 1] * m, g * up);
      bl = Math.max(src[i + 2] * m, bl * up);
      out[i] = Math.max(out[i], r);
      out[i + 1] = Math.max(out[i + 1], g);
      out[i + 2] = Math.max(out[i + 2], bl);
    }
  }
  return out;
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
  const base = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 1) base[i] = b[i] * 0.62 + src[i] * 0.38;
  const baseCanvas = toCanvas(base, SW, SH, (r, g, bl) => grade(r, g, bl, 0.035, 0.14));
  const layer = (lo, down, up) => {
    const st = streaks(src, SW, SH, lo, down, up);
    boxBlurColumns(st, a, SW, SH, 3);
    return toCanvas(a, SW, SH, (r, g, bl) => grade(r * 0.78, g * 0.78, bl * 0.78, 0, 0.04));
  };
  const index = new Float32Array(SW);
  for (let x = 0; x < SW; x += 1) {
    let best = 0;
    let at = SH / 2;
    for (let y = 0; y < SH; y += 2) {
      const i = (y * SW + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      if (l > best) {
        best = l;
        at = y;
      }
    }
    index[x] = at;
  }
  const sources = [];
  for (let y = 0; y < SH; y += 3) {
    for (let x = 0; x < SW; x += 3) {
      const i = (y * SW + x) * 3;
      const l = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      if (l > 0.62) sources.push([x, y, src[i], src[i + 1], src[i + 2]]);
    }
  }
  return { base: baseCanvas, a: layer(0.56, 0.987, 0.974), b: layer(0.5, 0.993, 0.984), anchor: index, sources };
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
    hub: { x: 640, y: 1080, tx: 640, ty: 1080, vx: 0, vy: 0, active: false },
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
    rhythm: { beat: -1, at: 0, power: 0, pulse: 0, energy: 0.3, drop: 0, dropAt: -10000 },
    splits: [],
    scouts: [],
    edges: [],
    tails: [],
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
    state.view.s = ZOOM + a * (0.008 * Math.sin(t * 0.13 + 0.5) + 0.014 * Math.min(1.5, state.rhythm.pulse));
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
      state.tracks.push({ id: 0, x: det.x, y: det.y, w: det.w, h: det.h, det, hits: 0, miss: 0, mode: "pending", born: 0, died: 0, link: 0, curve: 0, epoch: 0, labelAt: 0, hotAt: -10000 });
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

  const STRIP = 4;
  const strips = Array.from({ length: SW / STRIP }, (_, i) => {
    const h = (k) => {
      const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    return { f: 0.35 + h(1) * 0.7, g: 0.9 + h(2) * 1.6, p: h(3) * 6.283, q: h(4) * 6.283, amp: 0.14 + h(5) * 0.3, kick: 0, drag: 0.4 + h(6) * 0.6 };
  });

  const kickColumns = (power, wide) => {
    const centre = Math.random() * SW;
    const width = wide ? SW : 24 + Math.random() * 150 * power;
    for (let i = 0; i < strips.length; i += 1) {
      const d = Math.abs(i * STRIP - centre) / width;
      if (d >= 1) continue;
      const v = power * (1 - d * d) * (wide ? 0.45 + 0.55 * strips[i].drag : 1);
      if (v > strips[i].kick) strips[i].kick = v;
    }
  };

  const spawnTail = (now, power) => {
    const list = smear.sources;
    if (!list.length) return;
    const s = list[(Math.random() * list.length) | 0];
    const w = 4 + Math.random() * (14 + 40 * power);
    state.tails.push({
      x: Math.max(0, Math.min(IW - w, s[0] * (IW / SW) - w / 2)),
      y: s[1] * (IH / SH),
      w,
      len: 260 + Math.random() * 760 * power,
      born: now,
      life: 700 + Math.random() * 900,
    });
  };
  let drips = [];

  const seedDrip = (d, t, fresh) => {
    const list = smear.sources;
    const s = list[(Math.random() * list.length) | 0];
    d.x = s[0] + Math.random() * 3;
    d.y0 = s[1];
    d.born = t - (fresh ? 0 : Math.random() * 6);
    d.speed = 14 + Math.random() * 46;
    d.len = 40 + Math.random() * 160;
    d.life = 3 + Math.random() * 5;
    d.w = Math.random() < 0.2 ? 2 : 1;
    d.color = `rgb(${Math.round(Math.min(1, s[2] * 1.05) * 255)}, ${Math.round(Math.min(1, s[3] * 1.05) * 255)}, ${Math.round(Math.min(1, s[4] * 1.1) * 255)})`;
    return d;
  };

  const drawSmear = (t, now, dt) => {
    const { dx, dy, r, s } = state.view;
    const k = IW / SW;
    const energy = state.rhythm.energy;
    const decay = Math.exp(-dt / 420);
    g.save();
    g.translate(state.fw / 2 + dx, state.fh / 2 + dy);
    g.rotate(r);
    g.scale(s * state.k, s * state.k);
    g.translate(-IW / 2, -IH / 2);
    const breathe = reduced ? 0 : 1;
    const sx = (x) => x * k;
    g.drawImage(smear.base, 0, 0, SW, SH, 0, 0 + breathe * 6 * Math.sin(t * 0.21), IW, IH + breathe * 10 * Math.sin(t * 0.17 + 1));
    g.globalCompositeOperation = "screen";
    for (let i = 0; i < strips.length; i += 1) {
      const st = strips[i];
      const x = i * STRIP;
      const anchor = smear.anchor[x] * k;
      st.kick *= decay;
      const kick = breathe * st.kick;
      const stretch = 1 + breathe * st.amp * (1 + energy * 0.9) * (0.65 * Math.sin(t * 0.32 * st.f + st.p) + 0.35 * Math.sin(t * 0.9 * st.g + st.q)) + kick * 2.6 * st.drag;
      const flow = breathe * 28 * Math.sin(t * 0.18 * st.f + st.q) + kick * 170 * st.drag;
      const h = IH * stretch;
      const y = anchor - anchor * stretch + flow;
      const mix = breathe ? 0.5 + 0.5 * Math.sin(t * 0.42 - i * 0.07 + st.p * 0.3) : 0;
      const shimmer = Math.min(1, 0.82 + breathe * 0.18 * Math.sin(t * 3.1 * st.g + st.p) + kick * 0.35);
      if (mix < 0.98) {
        g.globalAlpha = (1 - mix) * shimmer;
        g.drawImage(smear.a, x, 0, STRIP, SH, sx(x), y, STRIP * k + 0.6, h);
      }
      if (mix > 0.02) {
        g.globalAlpha = mix * shimmer;
        g.drawImage(smear.b, x, 0, STRIP, SH, sx(x), y, STRIP * k + 0.6, h);
      }
    }
    g.globalCompositeOperation = "lighter";
    if (breathe && smear.sources.length) {
      for (const d of drips) {
        const age = t - d.born;
        if (age > d.life || age < 0) {
          seedDrip(d, t, true);
          continue;
        }
        const env = Math.min(1, age / 0.6) * Math.min(1, (d.life - age) / 1.2);
        const head = d.y0 + age * d.speed;
        const len = d.len * Math.min(1, age / 1.5);
        g.fillStyle = d.color;
        g.globalAlpha = 0.3 * env;
        g.fillRect(sx(d.x), (head - len) * k, d.w * k, len * k * 0.6);
        g.globalAlpha = 0.55 * env;
        g.fillRect(sx(d.x), (head - len * 0.4) * k, d.w * k, len * k * 0.4);
        g.globalAlpha = 0.9 * env;
        g.fillRect(sx(d.x), (head - 2) * k, d.w * k, 2 * k);
      }
    }
    if (breathe && state.tails.length) {
      g.globalCompositeOperation = "screen";
      const px = photo.naturalWidth / IW;
      const py = photo.naturalHeight / IH;
      for (const tl of state.tails) {
        const age = now - tl.born;
        const u = Math.min(1, age / 420);
        const grow = 1 - Math.pow(1 - u, 3);
        const fade = Math.min(1, (tl.life - age) / 360);
        if (fade <= 0) continue;
        const len = tl.len * grow;
        g.globalAlpha = 0.78 * fade;
        g.drawImage(photo, tl.x * px, tl.y * py, tl.w * px, 2 * py, tl.x, tl.y, tl.w, len);
        g.globalAlpha = 0.45 * fade;
        g.drawImage(photo, tl.x * px, (tl.y + 6) * py, tl.w * px, 2 * py, tl.x + tl.w * 0.2, tl.y + len * 0.4, tl.w * 0.6, len * 0.9);
      }
    }
    if (breathe && state.rhythm.pulse > 0.01) {
      g.globalCompositeOperation = "screen";
      g.globalAlpha = Math.min(0.14, 0.06 * state.rhythm.pulse);
      g.fillStyle = "#c8d2ff";
      g.fillRect(0, 0, IW, IH);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.restore();
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

  const draw = (now, dt) => {
    const dpr = state.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = "#16151c";
    g.fillRect(0, 0, state.fw, state.fh);
    drawSmear((now - state.t0) / 1000, now, dt);

    const shown = [];
    for (const tr of state.tracks) {
      if (tr.mode === "pending") continue;
      const age = now - tr.born;
      const dying = tr.mode === "dying" ? now - tr.died : -1;
      const rect = rectOf(tr);
      shown.push({ tr, rect, age, dying });
    }
    const rh = state.rhythm;
    const pulse = reduced ? 0 : rh.pulse;
    const sk = state.view.s * state.k;
    const [hx, hy] = toFrame(state.hub.x, state.hub.y);
    const hs = Math.round(Math.max(30, state.fw * 0.072) * (1 + 0.08 * Math.min(1, pulse)));
    const hubRect = { x: Math.round(hx - hs / 2) + 0.5, y: Math.round(hy - hs / 2) + 0.5, w: hs, h: hs, cx: hx, cy: hy };
    const boxOf = (cx, cy, w, h) => ({ x: Math.round(cx - w / 2) + 0.5, y: Math.round(cy - h / 2) + 0.5, w: Math.round(w), h: Math.round(h), cx, cy });

    const kids = [];
    for (const sp of state.splits) {
      const age = now - sp.born;
      if (age < 0 || age > sp.life) continue;
      const e = 1 - Math.pow(1 - Math.min(1, age / 280), 3);
      const [cx, cy] = toFrame(sp.x + sp.ox * e, sp.y + sp.oy * e);
      const shrink = 1 - 0.18 * e;
      kids.push({ sp, age, rect: boxOf(cx, cy, Math.max(5, sp.w * sk * shrink), Math.max(5, sp.h * sk * shrink)), fade: Math.min(1, (sp.life - age) / 240) });
    }
    const scouts = [];
    for (const sc of state.scouts) {
      const age = now - sc.born;
      if (age < 0 || age > sc.life) continue;
      const [cx, cy] = toFrame(sc.x, sc.y);
      const on = age > 180 || Math.floor(age / 45) % 2 === 0;
      if (!on) continue;
      const w = Math.max(6, sc.s * sk);
      scouts.push({ sc, age, rect: boxOf(cx, cy, w, w * sc.ar), fade: Math.min(1, (sc.life - age) / 200) });
    }

    g.save();
    g.beginPath();
    for (const s of shown) if (s.dying < 0 && s.age > 40) g.rect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    for (const kd of kids) if (kd.age > 60 && kd.fade > 0.5) g.rect(kd.rect.x, kd.rect.y, kd.rect.w, kd.rect.h);
    g.rect(hubRect.x, hubRect.y, hubRect.w, hubRect.h);
    g.clip();
    drawPhoto(photo);
    g.restore();

    for (const s of shown) {
      const since = now - s.tr.hotAt;
      if (s.dying >= 0 || since > 600) continue;
      g.fillStyle = `rgba(201, 242, 92, ${(0.26 * Math.exp(-since / 170)).toFixed(3)})`;
      g.fillRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    }

    g.lineWidth = 1;
    const curveEnds = [];
    const quad = (ax, ay, bx, by, bendK, side) => {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const bend = bendK * Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay);
      const ny = bx - ax;
      const nl = Math.hypot(nx, ny) || 1;
      return [mx + (nx / nl) * bend * side, my + (ny / nl) * bend * side];
    };
    const at = (ax, ay, cx, cy, bx, by, u) => {
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      return [a * ax + b * cx + c * bx, a * ay + b * cy + c * by];
    };
    const strokeQuad = (ax, ay, cx, cy, bx, by, u0, u1) => {
      const steps = 28;
      g.beginPath();
      let p = at(ax, ay, cx, cy, bx, by, u0);
      g.moveTo(p[0], p[1]);
      for (let i = 1; i <= steps; i += 1) {
        p = at(ax, ay, cx, cy, bx, by, u0 + ((u1 - u0) * i) / steps);
        g.lineTo(p[0], p[1]);
      }
      g.stroke();
    };
    g.strokeStyle = CURVE;
    for (const s of shown) {
      if (s.tr.curve <= 0.001) continue;
      const e = s.tr.curve;
      const tx = s.rect.cx;
      const ty = s.rect.y;
      const [cx, cy] = quad(hx, hy, tx, ty, 0.32, s.tr.id % 2 ? 1 : -1);
      strokeQuad(hx, hy, cx, cy, tx, ty, 0, Math.max(0.04, e));
      if (e > 0.98) curveEnds.push([tx, ty]);
    }
    const byTrack = new Map(shown.map((s) => [s.tr, s]));
    const packets = [];
    for (const ed of state.edges) {
      const a = byTrack.get(ed.a);
      const b = byTrack.get(ed.b);
      if (!a || !b || a.dying >= 0 || b.dying >= 0) continue;
      const age = now - ed.born;
      if (age < 0 || age > ed.life) continue;
      const grow = 1 - Math.pow(1 - Math.min(1, age / 360), 3);
      const shrink = Math.max(0, (age - (ed.life - 380)) / 380);
      const u0 = 1 - Math.pow(1 - shrink, 3);
      if (grow - u0 < 0.01) continue;
      const ax = a.rect.cx;
      const ay = a.rect.cy;
      const bx = b.rect.cx;
      const by = b.rect.cy;
      const [cx, cy] = quad(ax, ay, bx, by, ed.bend, ed.side);
      g.strokeStyle = ed.lime ? LINE : CURVE;
      strokeQuad(ax, ay, cx, cy, bx, by, u0, grow);
      if (grow > 0.98) {
        const u = ((age - 360) / 900) % 1;
        if (u > u0) packets.push(at(ax, ay, cx, cy, bx, by, u));
        curveEnds.push([bx, by]);
      }
    }
    g.strokeStyle = LINE;
    g.beginPath();
    const ends = [];
    for (const s of shown) {
      if (s.tr.link <= 0.001) continue;
      const e = 1 - Math.pow(1 - s.tr.link, 3);
      const tx = s.rect.x;
      const ty = s.rect.y;
      g.moveTo(hx, hy);
      g.lineTo(hx + (tx - hx) * e, hy + (ty - hy) * e);
      if (e > 0.98) ends.push([tx, ty]);
    }
    g.stroke();
    g.strokeStyle = "rgba(214, 246, 112, 0.42)";
    g.beginPath();
    for (const kd of kids) {
      if (kd.age > 320 || kd.fade < 1) continue;
      const parent = kd.sp.parent;
      const ps = byTrack.get(parent);
      if (!ps) continue;
      g.moveTo(ps.rect.cx, ps.rect.cy);
      g.lineTo(kd.rect.cx, kd.rect.cy);
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
    for (const kd of kids) {
      g.globalAlpha = kd.fade;
      if (kd.age < 60) strokeCorners(kd.rect, Math.min(4, kd.rect.w / 3, kd.rect.h / 3));
      else g.strokeRect(kd.rect.x, kd.rect.y, kd.rect.w, kd.rect.h);
    }
    for (const sc of scouts) {
      g.globalAlpha = sc.fade * 0.95;
      strokeCorners(sc.rect, Math.min(5, sc.rect.w / 3, sc.rect.h / 3));
    }
    g.globalAlpha = 1;
    g.strokeRect(hubRect.x, hubRect.y, hubRect.w, hubRect.h);
    g.strokeRect(hubRect.x + 3, hubRect.y + 3, hubRect.w - 6, hubRect.h - 6);

    const scan = now - rh.dropAt;
    if (!reduced && scan >= 0 && scan < 900) {
      const u = scan / 900;
      const y = Math.round(state.fh * (1 - Math.pow(1 - u, 2))) + 0.5;
      g.globalAlpha = 0.75 * (1 - u);
      g.strokeStyle = BOX;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(state.fw, y);
      for (let x = 12; x < state.fw; x += 24) {
        g.moveTo(x + 0.5, y - 3);
        g.lineTo(x + 0.5, y + 3);
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    g.fillStyle = DOT;
    for (const [x, y] of ends.concat(curveEnds)) {
      g.beginPath();
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#ffffff";
    for (const [x, y] of packets) {
      g.beginPath();
      g.arc(x, y, 1.8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = DOT;
    g.beginPath();
    g.arc(hx, hy, 2.4, 0, Math.PI * 2);
    g.fill();

    const fs = state.font;
    g.font = `${fs}px ${FONT}`;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffffff";
    g.shadowColor = "rgba(8, 8, 12, 0.75)";
    g.shadowBlur = 3;
    const placed = [];
    const lineH = fs + 4;
    const tick = Math.floor(now / 45);
    const scramble = (str, n, seed) => {
      const shownText = str.slice(0, Math.max(0, Math.min(str.length, n)));
      if (n >= str.length || reduced) return shownText;
      const tail = Math.min(3, shownText.length);
      let out = shownText.slice(0, shownText.length - tail);
      for (let i = 0; i < tail; i += 1) out += GLYPHS[Math.floor(hash(seed + i * 7 + tick) * GLYPHS.length)];
      return out;
    };
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
    const rolling = !reduced && scan >= 0 && scan < 420;
    for (const s of ordered) {
      const tr = s.tr;
      const code = CODES[(tr.id * 3 + tr.epoch) % CODES.length];
      const id = rolling ? `${Math.floor(1000000 + hash(tr.id + tick) * 8999999)}.0` : `${tr.id}.0`;
      const idW = g.measureText(id).width;
      const codeW = g.measureText(code).width;
      const y = s.rect.y + s.rect.h + fs + 3;
      const idBox = { x0: s.rect.x + s.rect.w + 6, x1: s.rect.x + s.rect.w + 6 + idW, y0: y - fs, y1: y + 3 };
      const full = { x0: idBox.x0 - 12 - codeW, x1: idBox.x1, y0: idBox.y0, y1: idBox.y1 };
      const since = now - Math.max(tr.born + 80, tr.labelAt);
      const chars = Math.floor(since / 20) * 4;
      if (fits(full)) {
        placed.push(full);
        g.fillText(scramble(code, chars, tr.id), full.x0, y);
        if (chars > code.length + 2) g.fillText(scramble(id, chars - code.length - 2, tr.id + 3), idBox.x0, y);
      } else if (fits(idBox)) {
        placed.push(idBox);
        g.fillText(scramble(id, chars, tr.id + 3), idBox.x0, y);
      }
    }
    for (const kd of kids) {
      if (kd.age < 90 || kd.fade < 0.6) continue;
      const label = kd.sp.label;
      const w = g.measureText(label).width;
      const box = { x0: kd.rect.x + kd.rect.w + 4, x1: kd.rect.x + kd.rect.w + 4 + w, y0: kd.rect.y - 2, y1: kd.rect.y + fs + 2 };
      if (!fits(box)) continue;
      placed.push(box);
      g.globalAlpha = kd.fade;
      g.fillText(scramble(label, Math.floor((kd.age - 90) / 16) * 3, kd.sp.seed), box.x0, kd.rect.y + fs - 1);
    }
    g.fillStyle = BOX;
    for (const sc of scouts) {
      if (sc.age < 120 || sc.fade < 0.6) continue;
      const label = sc.sc.label;
      const w = g.measureText(label).width;
      const box = { x0: sc.rect.x, x1: sc.rect.x + w, y0: sc.rect.y - fs - 4, y1: sc.rect.y - 1 };
      if (!fits(box)) continue;
      placed.push(box);
      g.globalAlpha = sc.fade;
      g.fillText(scramble(label, Math.floor((sc.age - 120) / 18) * 2, sc.sc.seed), box.x0, sc.rect.y - 4);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.shadowColor = "transparent";
  };

  const pickLive = () => state.tracks.filter((tr) => tr.mode === "live");

  const spawnScouts = (now, n) => {
    const list = smear.sources;
    if (!list.length) return;
    for (let i = 0; i < n && state.scouts.length < 100; i += 1) {
      const s = list[(Math.random() * list.length) | 0];
      const seed = Math.floor(Math.random() * 100000);
      state.scouts.push({
        x: s[0] * (IW / SW) + (Math.random() - 0.5) * 30,
        y: s[1] * (IH / SH) + (Math.random() - 0.5) * 30,
        s: 16 + Math.random() * 54,
        ar: 0.6 + Math.random() * 0.9,
        born: now + i * 28,
        life: 380 + Math.random() * 900,
        seed,
        label: Math.random() < 0.5 ? hex(seed) : `${(0.5 + hash(seed) * 0.5).toFixed(2)}`,
      });
    }
  };

  const splitTrack = (tr, now) => {
    const sk = state.view.s * state.k;
    if (tr.w * sk < 16 || tr.h * sk < 16) return;
    const tall = tr.h > tr.w * 1.6;
    const wide = tr.w > tr.h * 1.6;
    const cols = tall ? 1 : wide ? 3 : 2;
    const rows = tall ? 3 : wide ? 1 : 2;
    let n = 0;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (state.splits.length >= 72) return;
        n += 1;
        const fx = (i + 0.5) / cols - 0.5;
        const fy = (j + 0.5) / rows - 0.5;
        const len = Math.hypot(fx, fy) || 1;
        const push = 0.35 + Math.random() * 0.55;
        const seed = Math.floor(Math.random() * 100000);
        state.splits.push({
          parent: tr,
          x: tr.x + fx * tr.w,
          y: tr.y + fy * tr.h,
          w: tr.w / cols,
          h: tr.h / rows,
          ox: (fx / len) * push * (tr.w / cols) * 1.2 + (Math.random() - 0.5) * 16,
          oy: (fy / len) * push * (tr.h / rows) * 1.2 + (Math.random() - 0.5) * 16,
          born: now + n * 18,
          life: 760 + Math.random() * 640,
          seed,
          label: `${tr.id}.${n}`,
        });
      }
    }
  };

  const spawnEdge = (live, now, lime) => {
    if (live.length < 2 || state.edges.length >= 22) return;
    const a = live[(Math.random() * live.length) | 0];
    const others = live.filter((tr) => tr !== a && Math.hypot(tr.x - a.x, tr.y - a.y) > 140);
    if (!others.length) return;
    const b = others[(Math.random() * others.length) | 0];
    state.edges.push({ a, b, born: now, life: 1300 + Math.random() * 1300, bend: 0.18 + Math.random() * 0.3, side: Math.random() < 0.5 ? -1 : 1, lime });
  };

  const onBeat = (b, now) => {
    const c = ((b % CYCLE) + CYCLE) % CYCLE;
    const drop = c === 0;
    const build = c >= 24 ? (c - 23) / 8 : 0;
    const accent = drop ? 1.5 : build ? 0.45 + build * 0.6 : ACCENT[c % 16];
    const rh = state.rhythm;
    rh.beat = b;
    rh.at = now;
    rh.power = Math.max(0.15, accent);
    if (drop) rh.dropAt = now;
    audio?.beat(accent, drop);
    if (accent < 0.3) {
      spawnScouts(now, 2);
      return;
    }
    const live = pickLive();
    kickColumns(Math.min(1.2, accent), drop);
    if (accent >= 0.9 || build) kickColumns(Math.min(1, accent * 0.7), false);
    const tails = drop ? 14 : Math.round(accent * 4);
    for (let i = 0; i < tails && state.tails.length < 34; i += 1) spawnTail(now + i * 30, Math.min(1.2, accent));
    spawnScouts(now, Math.round(accent * (drop ? 18 : 9)));
    const order = live.slice().sort(() => Math.random() - 0.5);
    const splitN = drop ? 9 : accent >= 0.9 ? 3 : 2;
    for (let i = 0; i < Math.min(splitN, order.length); i += 1) splitTrack(order[i], now);
    for (const tr of live) {
      if (drop || hash(tr.id + b * 13) < accent * 0.3) {
        tr.epoch += 1;
        tr.labelAt = now;
      }
      if (drop || hash(tr.id * 7 + b) < accent * 0.35) tr.hotAt = now;
    }
    const edgeN = drop ? 8 : accent >= 0.9 ? 3 : 2;
    for (let i = 0; i < edgeN; i += 1) spawnEdge(live, now, i % 2 === 1);
    const [px] = toFrame(state.hub.x, state.hub.y);
    if (accent >= 0.9) audio?.acquire(0.4 + Math.random() * 0.5, (px / state.fw) * 2 - 1);
  };

  const stepRhythm = (t, now, dt) => {
    const rh = state.rhythm;
    const pos = t / BEAT + 20;
    const b = Math.floor(pos);
    if (b !== rh.beat) onBeat(b, now);
    rh.pulse = rh.power * Math.exp(-(now - rh.at) / 170);
    const c = ((b % CYCLE) + CYCLE) % CYCLE;
    const build = c >= 24 ? (c - 24 + (pos - b)) / 8 : 0;
    const speed = Math.min(0.4, Math.hypot(state.hub.vx, state.hub.vy) / 4000);
    const target = Math.min(1.5, 0.2 + 0.7 * rh.pulse + build * 0.55 + speed);
    rh.energy += (target - rh.energy) * (1 - Math.exp(-dt / 120));
    state.splits = state.splits.filter((sp) => now - sp.born < sp.life && sp.parent.mode !== "dying");
    state.scouts = state.scouts.filter((sc) => now - sc.born < sc.life);
    state.edges = state.edges.filter((ed) => now - ed.born < ed.life && ed.a.mode === "live" && ed.b.mode === "live");
    state.tails = state.tails.filter((tl) => now - tl.born < tl.life);
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
    if (!reduced && smear) stepRhythm(t, now, dt);
    draw(now, dt);
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
      const t = (performance.now() - state.t0) / 1000;
      drips = Array.from({ length: 220 }, () => seedDrip({}, t, false));
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
