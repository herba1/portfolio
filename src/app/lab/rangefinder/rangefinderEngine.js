import { PRINT_H, PRINT_W, createRangefinderGL } from "./rangefinderGL";
import { PHOTO, buildDepth, metresFor, sampleDepth } from "./rangefinderScene";

const IMG_ASPECT = 480 / 600;
const CROP_CENTER = 0.5;
const REST_SUBJECT = [0.572, 0.352];
const REST_ERROR = 0.07;
const INTRO_FROM = 0.6;
const MAGNET = 0.04;
const PATCH_OMEGA = 20;
const FOCUS_OMEGA = 18;
const SETTLE_OMEGA = 24;
const INTRO_OMEGA = 2.8;
const STRIP_OMEGA = 10;
const LEVER_OMEGA = 26;
const LEVER_OUT = 34;
const FLY_MS = 920;
const ROLL = 36;
const COC_K = 38;
const COC_MAX = 18;
const PRE_EXPOSED = [
  { focus: 0.135, pan: [-0.02, -0.035] },
  { focus: 0.35, pan: [-0.05, 0.02] },
  { focus: 0.52, pan: [0.04, 0.0] },
  { focus: 0.2, pan: [0.0, -0.015] },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function springStep(x, v, target, omega, dt) {
  const x0 = x - target;
  const b = v + omega * x0;
  const e = Math.exp(-omega * dt);
  const x1 = (x0 + b * dt) * e;
  return [target + x1, (b - omega * (x0 + b * dt)) * e];
}

function magnet(raw, s) {
  const x = raw - s;
  const ax = Math.abs(x);
  if (ax >= MAGNET) return raw;
  const t = ax / MAGNET;
  return s + x * t * t * (3 - 2 * t);
}

function unmagnet(f, s) {
  if (Math.abs(f - s) >= MAGNET) return f;
  if (Math.abs(f - s) < 1e-5) return s;
  let lo = f > s ? s : f - MAGNET;
  let hi = f > s ? f + MAGNET : s;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (magnet(mid, s) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function rubber(raw) {
  if (raw < 0) return -0.05 * Math.tanh(-raw / 0.1);
  if (raw > 1) return 1 + 0.05 * Math.tanh((raw - 1) / 0.1);
  return raw;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function distanceLabel(u) {
  const m = metresFor(u);
  if (!Number.isFinite(m) || m > 40) return "infinity";
  if (m >= 10) return `${Math.round(m)} metres`;
  return `${m.toFixed(m < 1 ? 2 : 1)} metres`;
}

export function createRangefinder({ box, refs, embedded, onReady }) {
  const { canvas, ring, track, lever, counter, shutter, holes, slots, flyers, header } = refs;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createRangefinderGL(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");

  const L = {
    W: 1,
    H: 1,
    bw: 1,
    bh: 1,
    bx: 0,
    by: 0,
    plate: 32,
    m: 16,
    fw: 1,
    fh: 1,
    winR: 20,
    bezel: 8,
    frame: [0, 0, 1, 1],
    patchW: 40,
    patchH: 24,
    ringX: 0,
    ringW: 1,
    span: 1,
    stripX: 0,
    stripY: 0,
    stripW: 1,
    frameW: 1,
    frameH: 1,
    pitch: 1,
    filmTop: 0,
    crop: [0, 0, 1, 1],
    dpr: 1,
  };

  const st = {
    px: 0,
    py: 0,
    pvx: 0,
    pvy: 0,
    tx: 0,
    ty: 0,
    placed: false,
    f: reduced ? 0 : INTRO_FROM,
    fv: 0,
    mode: reduced ? "idle" : "intro",
    target: 0,
    omega: FOCUS_OMEGA,
    raw: 0,
    drag: null,
    wheelPending: 0,
    wheelAt: 0,
    wheelSeen: false,
    s: 0,
    lock: 0,
    locked: false,
    touch: false,
    fade: reduced ? 1 : 0,
    shotAt: -1,
    pendingShots: 0,
    lever: 0,
    leverV: 0,
    leverUntil: 0,
    strip: 0,
    stripV: 0,
    stripReady: false,
    n: 0,
    landed: new Set(),
  };

  const cache = new Map();
  const slotState = slots.map((el) => ({
    el,
    canvas: el.querySelector("canvas"),
    ctx: el.querySelector("canvas").getContext("2d"),
    num: el.querySelector("[data-num]"),
    numA: el.querySelector("[data-num-a]"),
    k: null,
    shown: null,
  }));
  const flyerState = flyers.map((el) => ({ el, ctx: el.getContext("2d"), k: -1, t0: 0, from: null, busy: false }));

  let depth = null;
  let ready = false;
  let readySent = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let destroyed = false;
  let lastTrack = NaN;
  let lastLever = NaN;
  let lastHoles = NaN;
  let lastAria = "";
  let lastCounter = "";

  function layout() {
    const rect = box.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    L.W = W;
    L.H = H;
    const narrow = W < 640;
    let top = embedded ? 12 : 112;
    if (!embedded && header) {
      const hr = header.getBoundingClientRect();
      top = Math.max(narrow ? 0 : 112, hr.bottom - rect.top + (narrow ? 20 : 24));
    }
    const bottom = embedded ? 12 : narrow ? 16 : 52;
    const side = embedded ? 12 : narrow ? 16 : 32;
    const stripH = Math.round(embedded ? clamp(W * 0.085, 60, 96) : narrow ? clamp(W * 0.28, 92, 112) : clamp(W * 0.085, 76, 112));
    const gap = embedded ? 12 : narrow ? 20 : 28;
    const overhang = 12;
    const availH = Math.max(160, H - top - bottom - stripH - gap - overhang);
    const maxW = Math.max(200, Math.min(W - 2 * side, 1000));
    const dims = (bw, aspect) => {
      const plate = clamp(bw * 0.048, 24, 40);
      const m = clamp(bw * 0.028, 10, 22);
      const ringH = clamp(bw * 0.075, 48, 60);
      const fw = bw - 2 * m;
      const fh = fw / aspect;
      const bh = plate + m + fh + m * 0.9 + ringH + m * 0.9;
      return { plate, m, ringH, fw, fh, bh };
    };
    let bw = maxW;
    let d = dims(bw, 1.5);
    if (d.bh > availH) {
      let lo = 160;
      let hi = maxW;
      for (let i = 0; i < 28; i += 1) {
        const mid = (lo + hi) / 2;
        if (dims(mid, 1.5).bh > availH) hi = mid;
        else lo = mid;
      }
      bw = Math.floor(lo);
      d = dims(bw, 1.5);
    } else {
      const spare = availH - d.bh;
      const fhWant = d.fh + spare * (narrow ? 0.7 : 0.3);
      const aspect = clamp(d.fw / fhWant, narrow ? 1.12 : 1.36, 1.5);
      d = dims(bw, aspect);
    }
    L.bw = bw;
    L.bh = Math.round(d.bh);
    L.plate = d.plate;
    L.m = d.m;
    L.fw = d.fw;
    L.fh = d.fh;
    const stackH = overhang + L.bh + gap + stripH;
    const stackTop = top + Math.max(0, (H - top - bottom - stackH) / 2);
    L.bx = Math.round((W - bw) / 2);
    L.by = Math.round(stackTop + overhang);
    L.winR = Math.min(d.fh * 0.12, 36);
    L.bezel = clamp(bw * 0.011, 5, 9);
    const fwf = Math.min(d.fw * 0.84, d.fh * 0.86 * 1.5);
    const fhf = fwf / 1.5;
    L.frame = [(d.fw - fwf) / 2, (d.fh - fhf) / 2, fwf, fhf];
    L.patchW = fwf * 0.15;
    L.patchH = L.patchW * 0.62;
    const ringY = d.plate + d.m + d.fh + d.m * 0.9;
    const shutterSize = d.ringH;
    L.ringX = d.m;
    L.ringW = bw - 2 * d.m - shutterSize - d.m;
    L.span = L.ringW * 0.86;
    const winAspect = d.fw / d.fh;
    const ch = Math.min(1, IMG_ASPECT / winAspect);
    const cw = Math.min(1, winAspect / IMG_ASPECT);
    const cv = clamp(CROP_CENTER, ch / 2, 1 - ch / 2);
    L.crop = [(1 - cw) / 2, cv - ch / 2, cw, ch];
    L.stripW = Math.round(Math.min(W - 2 * side, bw + (narrow ? 0 : 280)));
    L.stripX = Math.round((W - L.stripW) / 2);
    L.stripY = Math.round(L.by + L.bh + gap);
    const pad = Math.round(stripH * 0.08);
    const filmH = stripH - 2 * pad;
    const rebate = Math.round(filmH * 0.16);
    L.frameH = filmH - 2 * rebate;
    L.frameW = Math.round(L.frameH * 1.5);
    L.pitch = L.frameW + Math.round(L.frameH * 0.1);
    L.filmTop = pad + rebate;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    L.dpr = Math.max(0.75, Math.min(dprCap, Math.sqrt(2600000 / (bw * L.bh))));
    gl?.resize(Math.max(1, Math.round(bw * L.dpr)), Math.max(1, Math.round(L.bh * L.dpr)));

    const s = box.style;
    s.setProperty("--rf-bx", `${L.bx}px`);
    s.setProperty("--rf-by", `${L.by}px`);
    s.setProperty("--rf-bw", `${bw}px`);
    s.setProperty("--rf-bh", `${L.bh}px`);
    s.setProperty("--rf-plate", `${d.plate}px`);
    s.setProperty("--rf-m", `${d.m}px`);
    s.setProperty("--rf-ring-y", `${ringY}px`);
    s.setProperty("--rf-ring-h", `${d.ringH}px`);
    s.setProperty("--rf-ring-w", `${L.ringW}px`);
    s.setProperty("--rf-span", `${L.span}px`);
    s.setProperty("--rf-strip-x", `${L.stripX}px`);
    s.setProperty("--rf-strip-y", `${L.stripY}px`);
    s.setProperty("--rf-strip-w", `${L.stripW}px`);
    s.setProperty("--rf-strip-h", `${stripH}px`);
    s.setProperty("--rf-pad", `${pad}px`);
    s.setProperty("--rf-rebate", `${rebate}px`);
    s.setProperty("--rf-frame-w", `${L.frameW}px`);
    s.setProperty("--rf-frame-h", `${L.frameH}px`);
    s.setProperty("--rf-pitch", `${L.pitch}px`);
    s.setProperty("--rf-hole", `${L.pitch / 8}px`);

    const minX = L.frame[0] + L.patchW / 2;
    const maxX = L.frame[0] + L.frame[2] - L.patchW / 2;
    const minY = L.frame[1] + L.patchH / 2;
    const maxY = L.frame[1] + L.frame[3] - L.patchH / 2;
    if (!st.placed) {
      const [px, py] = windowFromUv(REST_SUBJECT[0], REST_SUBJECT[1]);
      st.px = st.tx = clamp(px, minX, maxX);
      st.py = st.ty = clamp(py, minY, maxY);
      st.placed = true;
    } else {
      st.tx = clamp(st.tx, minX, maxX);
      st.ty = clamp(st.ty, minY, maxY);
      st.px = clamp(st.px, minX, maxX);
      st.py = clamp(st.py, minY, maxY);
    }
    st.strip = stripTarget();
    st.stripV = 0;
    lastTrack = NaN;
    lastLever = NaN;
    lastHoles = NaN;
    for (const slot of slotState) slot.k = null;
  }

  function windowFromUv(u, v) {
    return [((u - L.crop[0]) / L.crop[2]) * L.fw, ((v - L.crop[1]) / L.crop[3]) * L.fh];
  }

  function uvFromWindow(x, y) {
    return [L.crop[0] + (x / L.fw) * L.crop[2], L.crop[1] + (y / L.fh) * L.crop[3]];
  }

  function patchBounds() {
    return [
      L.frame[0] + L.patchW / 2,
      L.frame[0] + L.frame[2] - L.patchW / 2,
      L.frame[1] + L.patchH / 2,
      L.frame[1] + L.frame[3] - L.patchH / 2,
    ];
  }

  function frameShift(f) {
    const c = clamp(f, 0, 1);
    return [c * L.fw * 0.012, c * L.fh * 0.018];
  }

  function frameRegion(f, pan = [0, 0]) {
    const [sx, sy] = frameShift(f);
    const [u0, v0] = uvFromWindow(L.frame[0] + sx, L.frame[1] + sy);
    const [u1, v1] = uvFromWindow(L.frame[0] + sx + L.frame[2], L.frame[1] + sy + L.frame[3]);
    return [u0 + pan[0], v0 + pan[1], u1 - u0, v1 - v0];
  }

  function subjectDepth() {
    if (!depth) return 0.2;
    const [u, v] = uvFromWindow(st.px, st.py);
    const du = (L.patchW * 0.12 * L.crop[2]) / L.fw;
    const dv = (L.patchH * 0.12 * L.crop[3]) / L.fh;
    return (
      (sampleDepth(depth, u, v) * 2 +
        sampleDepth(depth, u - du, v) +
        sampleDepth(depth, u + du, v) +
        sampleDepth(depth, u, v - dv) +
        sampleDepth(depth, u, v + dv)) /
      6
    );
  }

  function stripTarget() {
    return L.stripW / 2 - (st.n * L.pitch + L.frameW / 2);
  }

  function slotRect(k) {
    return [L.stripX + k * L.pitch + st.strip, L.stripY + L.filmTop, L.frameW, L.frameH];
  }

  function printFor(focus, pan, k) {
    const image = gl.renderPrint({ region: frameRegion(focus, pan), focus, cocK: COC_K, cocMax: COC_MAX, seed: (k % 97) * 7.31 + 1.7 });
    return image;
  }

  function storeFromCanvas(k, source) {
    const c = document.createElement("canvas");
    c.width = PRINT_W / 2;
    c.height = PRINT_H / 2;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, c.width, c.height);
    cache.set(k, c);
    for (const key of cache.keys()) if (key < k - 40) cache.delete(key);
  }

  const scratch = document.createElement("canvas");
  scratch.width = PRINT_W;
  scratch.height = PRINT_H;
  const scratchCtx = scratch.getContext("2d");

  function preExpose() {
    PRE_EXPOSED.forEach((shot, k) => {
      scratchCtx.putImageData(printFor(shot.focus, shot.pan, k), 0, 0);
      storeFromCanvas(k, scratch);
      st.landed.add(k);
    });
    st.n = PRE_EXPOSED.length;
    st.strip = stripTarget();
    st.stripV = 0;
  }

  function fireShot(now) {
    st.pendingShots = 0;
    if (!ready) return;
    const k = st.n;
    st.n += 1;
    const image = printFor(st.f, [0, 0], k);
    let flyer = flyerState.find((fl) => !fl.busy);
    if (!flyer) {
      flyer = flyerState.reduce((a, b) => (a.t0 <= b.t0 ? a : b));
      land(flyer);
    }
    flyer.ctx.putImageData(image, 0, 0);
    storeFromCanvas(k, flyer.el);
    const [sx, sy] = frameShift(st.f);
    flyer.from = [L.bx + L.m + L.frame[0] + sx, L.by + L.plate + L.m + L.frame[1] + sy, L.frame[2], L.frame[3]];
    flyer.k = k;
    flyer.t0 = now;
    flyer.busy = true;
    flyer.el.style.width = `${flyer.from[2]}px`;
    flyer.el.style.height = `${flyer.from[3]}px`;
    flyer.el.style.opacity = "0";
    flyer.el.style.visibility = "visible";
    st.shotAt = now;
    st.leverUntil = now + 190;
    if (reduced) land(flyer);
    if (st.touch) navigator.vibrate?.(10);
    box.dataset.shot = String(k);
    shutter?.setAttribute("data-pressed", "");
  }

  function land(flyer) {
    flyer.busy = false;
    flyer.el.style.visibility = "hidden";
    st.landed.add(flyer.k);
    const slot = slotState.find((sl) => sl.k === flyer.k);
    if (slot) slot.shown = null;
  }

  function updateFlyers(now) {
    let busy = false;
    for (const fl of flyerState) {
      if (!fl.busy) continue;
      const t = clamp((now - fl.t0) / FLY_MS, 0, 1);
      const appear = smooth(0.0, 0.12, t);
      const tt = clamp((t - 0.1) / 0.9, 0, 1);
      const ex = tt < 1 ? 0.5 * (tt * tt * (3 - 2 * tt)) + 0.5 * (1 - Math.pow(1 - tt, 3)) : 1;
      const ey = 1 - Math.pow(1 - tt, 2.4);
      const to = slotRect(fl.k);
      const [fx, fy, fw, fh] = fl.from;
      const w = fw + (to[2] - fw) * ex;
      const h = fh + (to[3] - fh) * ex;
      const x = fx + (to[0] - fx) * ex;
      const y = fy + (to[1] - fy) * ey;
      const lift = Math.sin(Math.PI * clamp(tt, 0, 1)) * (1 - smooth(0.85, 1, tt));
      const sc = w / fw;
      fl.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${sc.toFixed(4)}, ${(h / fh).toFixed(4)})`;
      fl.el.style.opacity = appear.toFixed(3);
      const blur = (6 + 30 * lift) / sc;
      const dy = (2 + 16 * lift) / sc;
      fl.el.style.boxShadow = `0 ${dy.toFixed(1)}px ${blur.toFixed(1)}px rgb(0 0 0 / ${(0.18 + 0.22 * lift).toFixed(3)})`;
      if (t >= 1) land(fl);
      else busy = true;
    }
    return busy;
  }

  function updateSlots() {
    const S = slotState.length;
    const first = Math.floor(-st.strip / L.pitch) - 1;
    for (let j = 0; j < S; j += 1) {
      const slot = slotState[j];
      const k = first + ((((j - first) % S) + S) % S);
      const x = k * L.pitch + st.strip;
      slot.el.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      if (slot.k !== k) {
        slot.k = k;
        slot.shown = null;
        slot.el.style.visibility = k < 0 ? "hidden" : "visible";
        if (k >= 0) {
          const label = String((k % ROLL) + 1);
          slot.num.textContent = label;
          slot.numA.textContent = `${label}A`;
        }
      }
      const want = k >= 0 && st.landed.has(k) && cache.has(k) ? k : -1;
      if (slot.shown !== want) {
        slot.shown = want;
        if (want >= 0) slot.ctx.drawImage(cache.get(k), 0, 0, slot.canvas.width, slot.canvas.height);
        else slot.ctx.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
        slot.el.toggleAttribute("data-exposed", want >= 0);
      }
    }
    const period = L.pitch / 8;
    const off = (((st.strip % period) + period) % period) - period;
    if (!(Math.abs(off - lastHoles) <= 0.01)) {
      lastHoles = off;
      holes.style.transform = `translate3d(${off.toFixed(2)}px, 0, 0)`;
    }
  }

  function simulate(now, dt, sim) {
    let busy = false;
    const [nx0, nx1, ny0, ny1] = patchBounds();
    st.tx = clamp(st.tx, nx0, nx1);
    st.ty = clamp(st.ty, ny0, ny1);
    const po = reduced ? 40 : PATCH_OMEGA;
    [st.px, st.pvx] = springStep(st.px, st.pvx, st.tx, po, dt);
    [st.py, st.pvy] = springStep(st.py, st.pvy, st.ty, po, dt);
    if (Math.abs(st.px - st.tx) < 0.05 && Math.abs(st.py - st.ty) < 0.05 && Math.hypot(st.pvx, st.pvy) < 0.5) {
      st.px = st.tx;
      st.py = st.ty;
      st.pvx = 0;
      st.pvy = 0;
    } else busy = true;

    const s = subjectDepth();
    st.s = s;

    if (st.mode === "drag") {
      const d = st.drag;
      const raw = d.startRaw - (d.x - d.startX) / L.span;
      const next = magnet(rubber(raw), s);
      if (dt > 0.002) {
        const inst = (next - st.f) / dt;
        st.fv += (inst - st.fv) * (1 - Math.exp(-dt / 0.05));
      }
      st.f = next;
      if (d.releasing) {
        st.drag = null;
        delete box.dataset.grabbing;
        release(d.cancelled ? 0 : st.fv);
      }
      busy = true;
    } else if (st.mode === "wheel") {
      if (st.wheelPending !== 0) {
        st.raw += st.wheelPending;
        st.wheelPending = 0;
        st.wheelAt = now;
      } else if (!st.wheelSeen) st.wheelAt = now;
      st.wheelSeen = true;
      const next = magnet(rubber(st.raw), s);
      if (dt > 0.002) {
        const inst = (next - st.f) / dt;
        st.fv += (inst - st.fv) * (1 - Math.exp(-dt / 0.06));
      }
      st.f = next;
      if (now - st.wheelAt > 170) release(st.fv * 0.4);
      busy = true;
    } else if (st.mode === "spring" || st.mode === "intro") {
      if (st.mode === "spring" && Math.abs(st.target - s) < MAGNET * 0.6 && Math.abs(st.target - s) > 1e-4 && st.omega === SETTLE_OMEGA) st.target = s;
      [st.f, st.fv] = springStep(st.f, st.fv, st.target, st.omega, dt);
      if (Math.abs(st.f - st.target) < 0.0003 && Math.abs(st.fv) < 0.004) {
        st.f = st.target;
        st.fv = 0;
        st.mode = "idle";
      }
      busy = true;
    }

    const err = Math.abs(st.f - s);
    st.lock = 1 - smooth(0.003, 0.016, err);
    const isLocked = st.lock > 0.98;
    if (isLocked && !st.locked && st.touch && (st.mode === "drag" || st.mode === "wheel")) navigator.vibrate?.(6);
    if (isLocked !== st.locked) box.toggleAttribute("data-locked", isLocked);
    st.locked = isLocked;

    if (ready && st.fade < 1) {
      st.fade = reduced ? 1 : Math.min(1, st.fade + dt / 0.9);
      busy = true;
    }

    const leverTarget = sim < st.leverUntil ? LEVER_OUT : 0;
    if (reduced) {
      st.lever = 0;
    } else {
      [st.lever, st.leverV] = springStep(st.lever, st.leverV, leverTarget, LEVER_OMEGA, dt);
      if (Math.abs(st.lever - leverTarget) < 0.02 && Math.abs(st.leverV) < 0.1 && sim >= st.leverUntil) {
        st.lever = 0;
        st.leverV = 0;
      } else busy = true;
    }

    const stripGoal = stripTarget();
    if (reduced || !st.stripReady) {
      st.strip = stripGoal;
      st.stripV = 0;
      st.stripReady = true;
    } else if (sim - st.shotAt > 140 || st.shotAt < 0) {
      [st.strip, st.stripV] = springStep(st.strip, st.stripV, stripGoal, STRIP_OMEGA, dt);
      if (Math.abs(st.strip - stripGoal) < 0.05 && Math.abs(st.stripV) < 0.5) {
        st.strip = stripGoal;
        st.stripV = 0;
      } else busy = true;
    } else busy = true;

    if (st.shotAt >= 0 && sim - st.shotAt < 400) busy = true;
    else if (st.shotAt >= 0) shutter?.removeAttribute("data-pressed");
    if (updateFlyers(sim)) busy = true;
    return busy;
  }

  function release(v) {
    const vel = clamp(v, -3, 3);
    st.fv = vel;
    const projected = st.f + vel * 0.07;
    if (Math.abs(projected - st.s) < MAGNET * 1.1) {
      st.target = st.s;
      st.omega = SETTLE_OMEGA;
    } else {
      st.target = clamp(projected, 0, 1);
      st.omega = FOCUS_OMEGA;
    }
    st.mode = "spring";
  }

  function blinkAt(now) {
    if (st.shotAt < 0) return 0;
    const t = now - st.shotAt;
    if (t < 0) return 0;
    if (t < 18) return t / 18;
    if (t < 64) return 1;
    if (t < 150) return 1 - smooth(64, 150, t);
    return 0;
  }

  function render(now) {
    const sc = L.dpr;
    const [sx, sy] = frameShift(st.f);
    const cx = st.px / L.fw - 0.5;
    const cy = st.py / L.fh - 0.5;
    gl.draw({
      scale: sc,
      win: [L.m * sc, (L.plate + L.m) * sc, L.fw * sc, L.fh * sc],
      winR: L.winR * sc,
      bezel: L.bezel * sc,
      plate: L.plate * sc,
      crop: L.crop,
      frame: [(L.frame[0] + sx) * sc, (L.frame[1] + sy) * sc, L.frame[2] * sc, L.frame[3] * sc],
      patch: [st.px * sc, st.py * sc, L.patchW * sc, L.patchH * sc],
      focus: st.f,
      ghostK: L.frame[2] * 0.24 * sc,
      lock: st.lock,
      blink: reduced ? blinkAt(now) * 0.5 : blinkAt(now),
      fade: ready ? 1 - Math.pow(1 - st.fade, 3) : 0,
      eye: [-cx * 2.2 * sc, -cy * 1.6 * sc],
    });
    updateDom();
    if (ready && !readySent) {
      readySent = true;
      onReady?.();
    }
  }

  function updateDom() {
    const x = L.ringW / 2 - st.f * L.span;
    if (!(Math.abs(x - lastTrack) <= 0.01)) {
      lastTrack = x;
      track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    }
    if (lever && !(Math.abs(st.lever - lastLever) <= 0.01)) {
      lastLever = st.lever;
      lever.style.transform = `rotate(${st.lever.toFixed(3)}deg)`;
    }
    updateSlots();
    const count = String(((st.n - 1 + ROLL) % ROLL) + 1);
    if (counter && count !== lastCounter && ready) {
      lastCounter = count;
      counter.textContent = count;
    }
    if (st.mode === "idle") {
      const aria = distanceLabel(st.f);
      if (aria !== lastAria) {
        lastAria = aria;
        ring.setAttribute("aria-valuenow", String(Math.round(st.f * 100)));
        ring.setAttribute("aria-valuetext", aria);
      }
    }
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    clock += dt * 1000;
    if (st.pendingShots > 0) fireShot(clock);
    const busy = simulate(now, dt, clock);
    render(clock);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function canvasLocal(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left - L.m, e.clientY - r.top - L.plate - L.m];
  }

  function aimAt(x, y) {
    st.tx = x;
    st.ty = y;
    wake();
  }

  let press = null;

  function onCanvasDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.touch = e.pointerType !== "mouse";
    const [x, y] = canvasLocal(e);
    if (e.pointerType === "mouse") {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: true };
      aimAt(x, y);
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: false };
    aimAt(x, y - L.patchH * 1.4);
  }

  function onCanvasMove(e) {
    if (e.pointerType === "mouse") {
      st.touch = false;
      const [x, y] = canvasLocal(e);
      aimAt(x, y);
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    const [x, y] = canvasLocal(e);
    aimAt(x, y - L.patchH * 1.4);
  }

  function onCanvasUp(e) {
    if (!press || press.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const wasMouse = press.mouse;
    press = null;
    if (e.type === "pointerup" && wasMouse && moved < 8) shoot();
  }

  function shoot() {
    st.pendingShots = 1;
    wake();
  }

  function onRingDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag && !st.drag.releasing) return;
    st.touch = e.pointerType !== "mouse";
    ring.setPointerCapture?.(e.pointerId);
    st.fv = st.mode === "spring" ? st.fv : 0;
    st.drag = { id: e.pointerId, startX: e.clientX, x: e.clientX, startRaw: unmagnet(st.f, st.s), releasing: false, cancelled: false };
    st.mode = "drag";
    box.dataset.grabbing = "";
    wake();
  }

  function onRingMove(e) {
    const d = st.drag;
    if (!d || d.releasing || e.pointerId !== d.id) return;
    d.x = e.clientX;
    wake();
  }

  function onRingUp(e) {
    const d = st.drag;
    if (!d || d.releasing || e.pointerId !== d.id) return;
    if (e.type === "pointerup") d.x = e.clientX;
    d.cancelled = e.type === "pointercancel";
    d.releasing = true;
    wake();
  }

  function onWheel(e) {
    if (embedded && !box.contains(document.activeElement)) return;
    if (st.drag) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * scale;
    const dx = e.deltaX * scale;
    const delta = clamp((Math.abs(dy) >= Math.abs(dx) ? dy : -dx) * 0.00045, -0.08, 0.08);
    if (st.mode !== "wheel") {
      st.raw = unmagnet(st.f, st.s);
      st.mode = "wheel";
      st.wheelSeen = false;
    }
    st.wheelPending += delta;
    wake();
  }

  function stepFocus(delta) {
    if (st.drag) return;
    const base = st.mode === "spring" ? st.target : st.f;
    let next = clamp(base + delta, 0, 1);
    if (Math.abs(next - st.s) < MAGNET * 0.6 || (base - st.s) * (next - st.s) < 0) next = st.s;
    if (Math.abs(base - st.s) < 1e-4) next = clamp(base + delta, 0, 1);
    st.target = next;
    st.omega = FOCUS_OMEGA;
    st.mode = "spring";
    wake();
  }

  function onRingKey(e) {
    const big = e.shiftKey ? 4 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") stepFocus(0.02 * big);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") stepFocus(-0.02 * big);
    else if (e.key === "PageUp") stepFocus(0.1);
    else if (e.key === "PageDown") stepFocus(-0.1);
    else if (e.key === "Home") stepFocus(-1);
    else if (e.key === "End") stepFocus(1);
    else return;
    e.preventDefault();
  }

  function onCanvasKey(e) {
    const step = e.shiftKey ? 36 : 12;
    if (e.key === "ArrowLeft") aimAt(st.tx - step, st.ty);
    else if (e.key === "ArrowRight") aimAt(st.tx + step, st.ty);
    else if (e.key === "ArrowUp") aimAt(st.tx, st.ty - step);
    else if (e.key === "ArrowDown") aimAt(st.tx, st.ty + step);
    else if (e.key === "," || e.key === "[") stepFocus(-0.02);
    else if (e.key === "." || e.key === "]") stepFocus(0.02);
    else if (e.key === " " || e.key === "Enter") shoot();
    else return;
    e.preventDefault();
  }

  function onRootKey(e) {
    if (e.key !== " " || e.repeat) return;
    if (e.target === canvas || e.target === shutter) return;
    if (e.target === ring) {
      e.preventDefault();
      shoot();
    }
  }

  function onShutter() {
    shoot();
  }

  function onLost(e) {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    gl = null;
  }

  layout();
  updateDom();

  loadImage(PHOTO)
    .then((img) => {
      if (destroyed || !gl) return;
      depth = buildDepth(img);
      gl.uploadScene(img, depth);
      ready = true;
      preExpose();
      const s = subjectDepth();
      st.s = s;
      const rest = clamp(s + REST_ERROR, 0, 1);
      if (reduced) {
        st.f = rest;
        st.mode = "idle";
      } else {
        st.f = INTRO_FROM;
        st.fv = 0;
        st.target = rest;
        st.omega = INTRO_OMEGA;
        st.mode = "intro";
      }
      wake();
    })
    .catch((error) => {
      console.error(error);
    });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        last = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasUp);
  canvas.addEventListener("keydown", onCanvasKey);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onLost);
  ring.addEventListener("pointerdown", onRingDown);
  ring.addEventListener("pointermove", onRingMove);
  ring.addEventListener("pointerup", onRingUp);
  ring.addEventListener("pointercancel", onRingUp);
  ring.addEventListener("lostpointercapture", onRingUp);
  ring.addEventListener("keydown", onRingKey);
  ring.addEventListener("wheel", onWheel, { passive: false });
  shutter?.addEventListener("click", onShutter);
  box.addEventListener("keydown", onRootKey);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerup", onCanvasUp);
      canvas.removeEventListener("pointercancel", onCanvasUp);
      canvas.removeEventListener("keydown", onCanvasKey);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      ring.removeEventListener("pointerdown", onRingDown);
      ring.removeEventListener("pointermove", onRingMove);
      ring.removeEventListener("pointerup", onRingUp);
      ring.removeEventListener("pointercancel", onRingUp);
      ring.removeEventListener("lostpointercapture", onRingUp);
      ring.removeEventListener("keydown", onRingKey);
      ring.removeEventListener("wheel", onWheel);
      shutter?.removeEventListener("click", onShutter);
      box.removeEventListener("keydown", onRootKey);
      cache.clear();
      gl?.destroy();
      gl = null;
    },
  };
}
