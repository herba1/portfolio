import { INK, PAPER_BACK, SHEETS, dotPattern, hatchPattern, paintSheet } from "./crumpleSheets";

const FPS = 12;
const STEP_MS = 1000 / FPS;
const NX = 14;
const LIGHT = (() => {
  const v = [-0.45, -0.6, 0.66];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const LEVELS = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function createSound() {
  let ctx = null;
  let noise = null;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function burst({ gain, freq, q, dur, type = "bandpass" }) {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.8, dur + 0.02);
  }
  return {
    wake() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume();
    },
    crackle(amount) {
      const n = 1 + Math.round(amount * 3);
      for (let i = 0; i < n; i += 1) burst({ gain: 0.05 + amount * 0.07, freq: 1800 + Math.random() * 3200, q: 1.4, dur: 0.025 + Math.random() * 0.04 });
    },
    whoosh() {
      burst({ gain: 0.06, freq: 700, q: 0.6, dur: 0.22, type: "lowpass" });
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}

export async function createCrumple({ root, stage, canvas, cursor, onSheet, onReady }) {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createSound();
  const view = { w: 1, h: 1, dpr: 1, hx: 0, hy: 0, sw: 1, sh: 1 };
  const textures = new Map();
  let sheetIdx = 0;
  let pendingSheet = -1;
  let mesh = null;
  let patterns = [];
  let shadowPattern = null;
  let raf = 0;
  let last = 0;
  let acc = STEP_MS;
  let dirty = true;
  let active = true;
  let destroyed = false;
  let frameSeed = 1;
  let impact = 0;
  let ironing = 0;

  const state = {
    c: 0,
    vc: 0,
    target: 0,
    gx: 0,
    gy: 0,
    bx: 0,
    by: 0,
    vbx: 0,
    vby: 0,
    tbx: 0,
    tby: 0,
    held: false,
    peak: 0,
    lastDrawnC: 0,
    seed: 7,
    lines: [],
  };
  const creases = { segs: [], alpha: 1, canvas: null, key: "" };
  const pointer = { x: -100, y: -100, id: null, inside: false, type: "mouse" };

  function buildMesh() {
    const sheet = SHEETS[sheetIdx];
    const nx = NX;
    const ny = Math.max(8, Math.round(NX / sheet.aspect));
    const count = (nx + 1) * (ny + 1);
    const rest = new Float32Array(count * 2);
    const uv = new Float32Array(count * 2);
    for (let j = 0; j <= ny; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        const k = j * (nx + 1) + i;
        uv[k * 2] = i / nx;
        uv[k * 2 + 1] = j / ny;
      }
    }
    const tris = [];
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        if ((i + j) % 2) tris.push([a, b, d], [a, d, c]);
        else tris.push([a, b, c], [b, d, c]);
      }
    }
    const edges = new Map();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e += 1) {
        const p = t[e];
        const q = t[(e + 1) % 3];
        const key = p < q ? `${p}_${q}` : `${q}_${p}`;
        const entry = edges.get(key);
        if (entry) entry.t2 = ti;
        else edges.set(key, { p, q, t1: ti, t2: -1 });
      }
    });
    const edgeList = [...edges.values()];
    const triEdges = tris.map(() => []);
    edgeList.forEach((ed, ei) => {
      triEdges[ed.t1].push(ei);
      if (ed.t2 >= 0) triEdges[ed.t2].push(ei);
    });
    mesh = {
      nx,
      ny,
      count,
      rest,
      uv,
      tris,
      edges: edgeList,
      triEdges,
      fold: new Float32Array(count),
      res: new Float32Array(count * 3),
      pos: new Float32Array(count * 3),
      normals: new Float32Array(tris.length * 3),
      order: new Int32Array(tris.length),
      rank: new Int32Array(tris.length),
      front: new Uint8Array(tris.length),
    };
    layoutRest();
    reseedFold();
  }

  function layoutRest() {
    if (!mesh) return;
    for (let k = 0; k < mesh.count; k += 1) {
      mesh.rest[k * 2] = (mesh.uv[k * 2] - 0.5) * view.sw;
      mesh.rest[k * 2 + 1] = (mesh.uv[k * 2 + 1] - 0.5) * view.sh;
    }
  }

  function reseedFold() {
    state.seed += 1;
    const rand = rng(state.seed * 97 + sheetIdx * 13);
    const lines = [];
    state.lines = lines;
    for (let i = 0; i < 22; i += 1) {
      const a = rand() * Math.PI;
      lines.push({ nx: Math.cos(a), ny: Math.sin(a), lambda: 0.14 + rand() * 0.38, phase: rand(), amp: 0.4 + rand() * 0.6 });
    }
    let max = 1e-6;
    for (let k = 0; k < mesh.count; k += 1) {
      const u = mesh.uv[k * 2] - 0.5;
      const v = (mesh.uv[k * 2 + 1] - 0.5) / SHEETS[sheetIdx].aspect;
      let f = 0;
      for (const l of lines) {
        const x = (u * l.nx + v * l.ny) / l.lambda + l.phase;
        f += l.amp * (Math.abs(x - Math.floor(x) - 0.5) * 2 - 0.5);
      }
      mesh.fold[k] = f;
      max = Math.max(max, Math.abs(f));
    }
    for (let k = 0; k < mesh.count; k += 1) mesh.fold[k] /= max;
  }

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const narrow = view.w < 720;
    const top = narrow ? 148 : 96;
    const bottom = narrow ? 92 : 96;
    const availH = Math.max(200, view.h - top - bottom);
    const availW = view.w - 32;
    const aspect = SHEETS[sheetIdx].aspect;
    view.sh = Math.min(availH * 0.92, (availW * (narrow ? 0.9 : 0.5)) / aspect);
    view.sw = view.sh * aspect;
    view.hx = view.w / 2;
    view.hy = top + availH / 2;
    const pitch = 6 * view.dpr;
    patterns = [null, dotPattern(ctx, pitch, pitch * 0.16, INK), dotPattern(ctx, pitch, pitch * 0.26, INK), hatchPattern(ctx, 5 * view.dpr, 1.1 * view.dpr, INK)];
    shadowPattern = dotPattern(ctx, 5 * view.dpr, 1.7 * view.dpr, "rgb(28 26 36 / 0.55)");
    layoutRest();
    if (!state.held) {
      state.bx = state.tbx = view.hx + state.gx;
      state.by = state.tby = view.hy + state.gy;
    }
    ensureTexture(sheetIdx);
    dirty = true;
    acc = STEP_MS;
  }

  function ensureTexture(idx) {
    const width = Math.min(1400, Math.round(view.sw * view.dpr * 1.1));
    const have = textures.get(idx);
    if (have && (have.pending || Math.abs(have.width - width) < 80)) return have.promise;
    const promise = paintSheet(SHEETS[idx], width, root).then((tex) => {
      textures.set(idx, { canvas: tex, width, promise });
      dirty = true;
      wake();
      return tex;
    });
    textures.set(idx, { pending: true, width, promise, canvas: have?.canvas });
    return promise;
  }

  function paperTexture() {
    const tex = textures.get(sheetIdx)?.canvas;
    if (!tex || !creases.segs.length) return tex;
    const key = `${sheetIdx}:${tex.width}:${creases.segs.length}:${creases.alpha.toFixed(2)}`;
    if (creases.key === key && creases.canvas) return creases.canvas;
    if (!creases.canvas) creases.canvas = document.createElement("canvas");
    const out = creases.canvas;
    out.width = tex.width;
    out.height = tex.height;
    const c = out.getContext("2d");
    c.drawImage(tex, 0, 0);
    const tw = tex.width;
    const th = tex.height;
    const unit = tw / 420;
    c.lineCap = "round";
    for (const pass of [0, 1]) {
      c.strokeStyle = pass ? `rgb(28 26 36 / ${0.38 * creases.alpha})` : `rgb(255 253 246 / ${0.9 * creases.alpha})`;
      for (const seg of creases.segs) {
        const off = pass ? 0 : 1.6 * unit;
        const x0 = seg.x0 * tw + tw / 2 + off;
        const y0 = seg.y0 * tw + th / 2 + off;
        const x1 = seg.x1 * tw + tw / 2 + off;
        const y1 = seg.y1 * tw + th / 2 + off;
        const mx = (x0 + x1) / 2 - (y1 - y0) * seg.bend;
        const my = (y0 + y1) / 2 + (x1 - x0) * seg.bend;
        c.lineWidth = (pass ? 1.1 : 1.6) * unit * seg.weight;
        c.beginPath();
        c.moveTo(x0, y0);
        c.quadraticCurveTo(mx, my, x1, y1);
        c.stroke();
      }
    }
    creases.key = key;
    return out;
  }

  function solve() {
    const e = smooth(clamp(state.c, 0, 1));
    const wob = Math.sin(Math.PI * clamp(state.c, 0, 1));
    const g = [state.gx, state.gy];
    const corners = [
      [-view.sw / 2, -view.sh / 2],
      [view.sw / 2, -view.sh / 2],
      [-view.sw / 2, view.sh / 2],
      [view.sw / 2, view.sh / 2],
    ];
    let lmax = 1;
    for (const [x, y] of corners) lmax = Math.max(lmax, Math.hypot(x - g[0], y - g[1]));
    const rb = Math.sqrt(view.sw * view.sh) * 0.2;
    const { rest, res, pos, fold } = mesh;
    for (let k = 0; k < mesh.count; k += 1) {
      const rx = rest[k * 2];
      const ry = rest[k * 2 + 1];
      const fx = rx + res[k * 3] - g[0];
      const fy = ry + res[k * 3 + 1] - g[1];
      const fz = res[k * 3 + 2];
      const dx = rx - g[0];
      const dy = ry - g[1];
      const l = Math.hypot(dx, dy);
      const ux = l > 1e-4 ? dx / l : 0;
      const uy = l > 1e-4 ? dy / l : 0;
      const th = (l / lmax) * Math.PI * 0.86;
      const rad = rb * (1 + 0.34 * fold[k]);
      const sx = ux * rad * Math.sin(th);
      const sy = uy * rad * Math.sin(th);
      const sz = rad * Math.cos(th);
      const crinkle = fold[k] * rb * 0.55 * wob;
      pos[k * 3] = state.bx + fx + (sx - fx) * e;
      pos[k * 3 + 1] = state.by + fy + (sy - fy) * e;
      pos[k * 3 + 2] = fz + (sz - fz) * e + crinkle;
    }
  }

  function shadeAndSort() {
    const { tris, pos, normals, order, front, rank } = mesh;
    const depth = new Float32Array(tris.length);
    tris.forEach(([a, b, c], t) => {
      const ax = pos[a * 3];
      const ay = pos[a * 3 + 1];
      const az = pos[a * 3 + 2];
      const e1x = pos[b * 3] - ax;
      const e1y = pos[b * 3 + 1] - ay;
      const e1z = pos[b * 3 + 2] - az;
      const e2x = pos[c * 3] - ax;
      const e2y = pos[c * 3 + 1] - ay;
      const e2z = pos[c * 3 + 2] - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      front[t] = nz >= 0 ? 1 : 0;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[t * 3] = nx / l;
      normals[t * 3 + 1] = ny / l;
      normals[t * 3 + 2] = nz / l;
      depth[t] = az + pos[b * 3 + 2] + pos[c * 3 + 2];
      order[t] = t;
    });
    order.sort((p, q) => depth[p] - depth[q]);
    order.forEach((t, i) => {
      rank[t] = i;
    });
  }

  function triPath(a, b, c, grow) {
    const { pos } = mesh;
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    ctx.beginPath();
    [a, b, c].forEach((v, i) => {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const dx = x - cx;
      const dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      const px = x + (dx / l) * grow;
      const py = y + (dy / l) * grow;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
  }

  function draw() {
    const tex = paperTexture();
    const d = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!mesh || !tex) return;
    solve();
    shadeAndSort();
    const rand = rng(frameSeed);
    const jitter = () => (rand() - 0.5) * 0.9;
    const { tris, pos, uv, order, normals, front, edges, triEdges, rank } = mesh;
    const e = smooth(clamp(state.c, 0, 1));
    const lift = 5 + e * 16 + (state.held ? 6 : 0);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.save();
    ctx.translate(lift * 0.7, lift);
    ctx.fillStyle = shadowPattern;
    for (const t of order) {
      const [a, b, c] = tris[t];
      triPath(a, b, c, 0.8);
      ctx.fill();
    }
    ctx.restore();

    const tw = tex.width;
    const th = tex.height;
    for (const t of order) {
      const [a, b, c] = tris[t];
      const x0 = pos[a * 3];
      const y0 = pos[a * 3 + 1];
      const x1 = pos[b * 3];
      const y1 = pos[b * 3 + 1];
      const x2 = pos[c * 3];
      const y2 = pos[c * 3 + 1];
      ctx.save();
      triPath(a, b, c, 1.1);
      ctx.clip();
      if (front[t]) {
        const u0 = uv[a * 2] * tw;
        const v0 = uv[a * 2 + 1] * th;
        const u1 = uv[b * 2] * tw;
        const v1 = uv[b * 2 + 1] * th;
        const u2 = uv[c * 2] * tw;
        const v2 = uv[c * 2 + 1] * th;
        const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
        if (Math.abs(den) > 1e-6) {
          const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
          const m12 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
          const m21 = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
          const m22 = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
          const dx = x0 - m11 * u0 - m21 * v0;
          const dy = y0 - m12 * u0 - m22 * v0;
          ctx.transform(m11, m12, m21, m22, dx, dy);
          ctx.drawImage(tex, 0, 0);
        }
      } else {
        ctx.fillStyle = PAPER_BACK;
        ctx.fill();
      }
      ctx.restore();
      const lam = normals[t * 3] * LIGHT[0] + normals[t * 3 + 1] * LIGHT[1] + normals[t * 3 + 2] * LIGHT[2];
      const dark = clamp((0.5 - lam) / 0.55, 0, 1);
      const level = dark < 0.18 ? 0 : dark < 0.5 ? 1 : dark < 0.82 ? 2 : LEVELS - 1;
      if (level > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(d, d);
        triPath(a, b, c, 0.4);
        ctx.fillStyle = patterns[level];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = INK;
      ctx.lineCap = "round";
      for (const ei of triEdges[t]) {
        const ed = edges[ei];
        let width = 0;
        if (ed.t2 < 0) width = 2.4;
        else {
          const other = ed.t1 === t ? ed.t2 : ed.t1;
          if (rank[other] > rank[t]) continue;
          const dot = normals[t * 3] * normals[other * 3] + normals[t * 3 + 1] * normals[other * 3 + 1] + normals[t * 3 + 2] * normals[other * 3 + 2];
          if (front[t] !== front[other]) width = 2.2;
          else if (dot < 0.86) width = 1 + (0.86 - dot) * 5;
        }
        if (!width) continue;
        ctx.lineWidth = Math.min(2.8, width) * (0.85 + rand() * 0.3);
        ctx.beginPath();
        ctx.moveTo(pos[ed.p * 3] + jitter(), pos[ed.p * 3 + 1] + jitter());
        ctx.lineTo(pos[ed.q * 3] + jitter(), pos[ed.q * 3 + 1] + jitter());
        ctx.stroke();
      }
    }

    if (impact > 0) {
      const rb = Math.sqrt(view.sw * view.sh) * 0.2;
      ctx.strokeStyle = INK;
      ctx.lineCap = "round";
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2 + rand() * 0.4;
        const r0 = rb * (1.5 + rand() * 0.2) + (3 - impact) * 6;
        const r1 = r0 + rb * (0.25 + rand() * 0.25);
        ctx.lineWidth = 2.2 + rand();
        ctx.beginPath();
        ctx.moveTo(state.bx + Math.cos(a) * r0, state.by + Math.sin(a) * r0);
        ctx.lineTo(state.bx + Math.cos(a) * r1, state.by + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
  }

  function onPaper(x, y) {
    if (!mesh) return false;
    if (state.c > 0.35) return Math.hypot(x - state.bx, y - state.by) < Math.sqrt(view.sw * view.sh) * 0.32;
    return Math.abs(x - view.hx) < view.sw / 2 + 6 && Math.abs(y - view.hy) < view.sh / 2 + 6;
  }

  function grab(x, y) {
    if (state.c < 0.08) {
      state.gx = clamp(x - view.hx, -view.sw / 2, view.sw / 2);
      state.gy = clamp(y - view.hy, -view.sh / 2, view.sh / 2);
      state.bx = state.tbx = view.hx + state.gx;
      state.by = state.tby = view.hy + state.gy;
      reseedFold();
    }
    state.held = true;
    state.target = 1;
    state.peak = Math.max(state.peak, state.c);
    root.dataset.holding = "";
    wake();
  }

  function release() {
    if (!state.held) return;
    state.held = false;
    state.target = 0;
    delete root.dataset.holding;
    sound.whoosh();
    settleCreases();
    wake();
  }

  function settleCreases() {
    const amount = clamp(state.peak, 0, 1);
    if (amount < 0.05) return;
    const rb = Math.sqrt(view.sw * view.sh) * 0.2;
    const rand = rng(state.seed * 31 + 5);
    const aspect = SHEETS[sheetIdx].aspect;
    const halfV = 0.5 / aspect;
    const ranked = [...state.lines].sort((p, q) => q.amp - p.amp).slice(0, 3 + Math.round(amount * 5));
    for (const l of ranked) {
      const reach = Math.abs(l.nx) * 0.5 + Math.abs(l.ny) * halfV;
      const lo = Math.ceil((-reach / l.lambda + l.phase) * 2);
      const hi = Math.floor((reach / l.lambda + l.phase) * 2);
      if (hi < lo) continue;
      const n = lo + Math.floor(rand() * (hi - lo + 1));
      const d = (n / 2 - l.phase) * l.lambda;
      const span = Math.hypot(0.5, halfV);
      const mid = (rand() - 0.5) * span;
      const len = span * (0.35 + rand() * 0.6);
      const px = l.nx * d;
      const py = l.ny * d;
      const dx = -l.ny;
      const dy = l.nx;
      creases.segs.push({
        x0: px + dx * (mid - len / 2),
        y0: py + dy * (mid - len / 2),
        x1: px + dx * (mid + len / 2),
        y1: py + dy * (mid + len / 2),
        bend: (rand() - 0.5) * 0.02,
        weight: 0.6 + amount * 0.4,
      });
    }
    if (creases.segs.length > 60) creases.segs.splice(0, creases.segs.length - 60);
    creases.alpha = 1;
    creases.key = "";
    for (let k = 0; k < mesh.count; k += 1) {
      const f = mesh.fold[k];
      mesh.res[k * 3 + 2] = clamp(mesh.res[k * 3 + 2] + f * rb * 0.012 * amount, -rb * 0.05, rb * 0.05);
      const edge = Math.max(Math.abs(mesh.uv[k * 2] - 0.5), Math.abs(mesh.uv[k * 2 + 1] - 0.5)) * 2;
      const pull = edge * edge * amount * 0.008;
      mesh.res[k * 3] = clamp(mesh.res[k * 3] - mesh.rest[k * 2] * pull + (rand() - 0.5) * 1.4 * amount, -view.sw * 0.04, view.sw * 0.04);
      mesh.res[k * 3 + 1] = clamp(mesh.res[k * 3 + 1] - mesh.rest[k * 2 + 1] * pull + (rand() - 0.5) * 1.4 * amount, -view.sh * 0.04, view.sh * 0.04);
    }
    state.peak = 0;
  }

  function step(dt) {
    let moving = false;
    if (state.held && pointer.id !== null) {
      state.tbx = pointer.x;
      state.tby = pointer.y;
    } else if (!state.held) {
      state.tbx = view.hx + state.gx;
      state.tby = view.hy + state.gy;
    }
    const rate = state.target > state.c ? 1.5 : 1.15;
    const before = state.c;
    if (reduced) state.c = state.target;
    else state.c = state.target > state.c ? Math.min(state.target, state.c + dt * rate) : Math.max(state.target, state.c - dt * rate);
    if (state.held) state.peak = Math.max(state.peak, state.c);
    if (state.c !== before || state.c !== state.target) moving = true;
    const k = 1 - Math.exp(-dt * (state.held ? 14 : 7));
    state.bx += (state.tbx - state.bx) * k;
    state.by += (state.tby - state.by) * k;
    if (Math.abs(state.tbx - state.bx) + Math.abs(state.tby - state.by) > 0.3) moving = true;
    else {
      state.bx = state.tbx;
      state.by = state.tby;
    }
    if (ironing > 0) {
      ironing -= dt;
      const keep = Math.exp(-dt * 7);
      for (let i = 0; i < mesh.res.length; i += 1) mesh.res[i] *= keep;
      creases.alpha *= keep;
      if (ironing <= 0) {
        mesh.res.fill(0);
        creases.segs = [];
        creases.alpha = 1;
      }
      moving = true;
    }
    if (pendingSheet >= 0 && state.c >= 0.999) {
      sheetIdx = pendingSheet;
      pendingSheet = -1;
      buildMesh();
      creases.segs = [];
      creases.key = "";
      layout();
      state.gx = 0;
      state.gy = 0;
      onSheet?.(sheetIdx);
      state.held = false;
      state.target = 0;
      sound.whoosh();
      moving = true;
    }
    return moving;
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    const moving = step(dt);
    acc += dt * 1000;
    if (cursor) {
      cursor.style.transform = `translate3d(${pointer.x.toFixed(1)}px, ${pointer.y.toFixed(1)}px, 0)`;
    }
    if ((moving || dirty || impact > 0) && acc >= STEP_MS) {
      acc = acc % STEP_MS;
      const dc = Math.abs(state.c - state.lastDrawnC);
      if (dc > 0.015 && state.target > 0.5) sound.crackle(clamp(dc * 6, 0, 1));
      if (state.held && state.c >= 0.999 && state.lastDrawnC < 0.999) impact = 3;
      state.lastDrawnC = state.c;
      frameSeed += 1;
      draw();
      dirty = false;
      if (impact > 0) {
        impact -= 1;
        if (impact === 0) dirty = true;
      }
      onReady?.();
    }
    if (moving || dirty || impact > 0 || pointer.inside) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !active) return;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    pointer.type = e.pointerType;
    sound.wake();
    if (!onPaper(x, y) || pendingSheet >= 0) return;
    pointer.id = e.pointerId;
    stage.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    grab(x, y);
  }

  function onMove(e) {
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    pointer.type = e.pointerType;
    pointer.inside = e.pointerType === "mouse";
    root.toggleAttribute("data-over", onPaper(x, y));
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.id = null;
    release();
  }

  function onLeave() {
    pointer.inside = false;
    root.removeAttribute("data-over");
  }

  function onKey(e) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      sound.wake();
      if (state.held) release();
      else grab(view.hx, view.hy);
    } else if (e.key === "Escape") release();
  }

  function onKeyUp(e) {
    if ((e.key === " " || e.key === "Enter") && state.held && state.c >= 0.6) release();
  }

  buildMesh();
  layout();
  await ensureTexture(sheetIdx);
  draw();
  onReady?.();

  const ro = new ResizeObserver(() => {
    layout();
    wake();
  });
  ro.observe(root);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);

  return {
    setActive(on) {
      active = on;
      if (on) {
        last = 0;
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    setSheet(idx) {
      if (idx === sheetIdx || pendingSheet >= 0) return;
      sound.wake();
      ensureTexture(idx);
      pendingSheet = idx;
      if (state.c < 0.08) {
        state.gx = 0;
        state.gy = 0;
        state.bx = state.tbx = view.hx;
        state.by = state.tby = view.hy;
        reseedFold();
      }
      state.held = true;
      state.target = 1;
      wake();
    },
    smooth() {
      sound.wake();
      sound.whoosh();
      ironing = 0.9;
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
      sound.destroy();
    },
  };
}
