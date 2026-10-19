import { BANDS, MAX_DB } from "./eqPresets";

const F_MIN = 20;
const F_MAX = 20000;
const BINS = 44;
const BPM = 116;
const LOG_SPAN = Math.log2(F_MAX / F_MIN);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const xOfFreq = (f) => Math.log2(f / F_MIN) / LOG_SPAN;
const BAND_X = BANDS.map(xOfFreq);

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function curveAt(gains, u) {
  const n = gains.length;
  if (u <= BAND_X[0]) return gains[0];
  if (u >= BAND_X[n - 1]) return gains[n - 1];
  let i = 0;
  while (i < n - 2 && u > BAND_X[i + 1]) i += 1;
  const t = (u - BAND_X[i]) / (BAND_X[i + 1] - BAND_X[i]);
  const p0 = gains[Math.max(0, i - 1)];
  const p1 = gains[i];
  const p2 = gains[i + 1];
  const p3 = gains[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function musicAt(f, t) {
  const beat = 60 / BPM;
  const phase = (t % beat) / beat;
  const bar = Math.floor(t / beat) % 4;
  const lf = Math.log2(f);
  const kick = Math.exp(-phase * 7) * Math.exp(-((lf - 5.9) ** 2) / 0.9);
  const snareOn = bar === 1 || bar === 3 ? Math.exp(-phase * 9) : 0;
  const snare = snareOn * Math.exp(-((lf - 10.5) ** 2) / 6);
  const eighth = ((t % (beat / 2)) / (beat / 2));
  const hat = Math.exp(-eighth * 14) * Math.exp(-((lf - 13.2) ** 2) / 1.2);
  const bassNote = 6.6 + 0.6 * Math.sin(Math.floor(t / beat) * 1.7);
  const bass = 0.75 * Math.exp(-((lf - bassNote) ** 2) / 0.3) * (0.7 + 0.3 * Math.sin(t * 9));
  const pad = 0.55 * Math.exp(-((lf - 9.4) ** 2) / 5) * (0.8 + 0.2 * Math.sin(t * 1.3 + lf));
  const air = 0.18 * Math.exp(-((lf - 12.5) ** 2) / 3);
  const level = kick * 1.1 + snare * 0.8 + hat * 0.6 + bass + pad + air;
  return 20 * Math.log10(0.02 + level);
}

export function createEqEngine({ canvas, handles, stage, initial, accent, onRounded, onCustom, onGrab }) {
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const st = {
    gains: initial.slice(),
    vel: initial.map(() => 0),
    target: initial.slice(),
    rounded: initial.map((g) => Math.round(g)),
    accent: accent.slice(),
    accentTarget: accent.slice(),
    bars: new Float32Array(BINS),
    drag: null,
    w: 1,
    h: 1,
    dpr: 1,
    raf: 0,
    last: performance.now(),
    t: 0,
    visible: true,
    onScreen: true,
  };

  const pad = () => ({ top: 52, bottom: 28, left: 0, right: 0 });
  const yOfDb = (db) => {
    const p = pad();
    const mid = p.top + (st.h - p.top - p.bottom) / 2;
    return mid - (db / MAX_DB) * ((st.h - p.top - p.bottom) / 2);
  };
  const dbOfY = (y) => {
    const p = pad();
    const half = (st.h - p.top - p.bottom) / 2;
    return ((p.top + half - y) / half) * MAX_DB;
  };
  const xOf = (u) => u * st.w;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    st.w = Math.max(1, r.width);
    st.h = Math.max(1, r.height);
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(st.w * st.dpr);
    canvas.height = Math.round(st.h * st.dpr);
    draw(0);
  };

  const rgb = (a = 1, lift = 0) => {
    const [r, g, b] = st.accent.map((c) => Math.round(c + (255 - c) * lift));
    return `rgba(${r},${g},${b},${a})`;
  };

  function step(dt) {
    st.t += dt;
    const k = reduce ? 900 : 210;
    const c = reduce ? 60 : 24;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < st.gains.length; i += 1) {
      const dragging = st.drag && st.drag.band === i;
      const kk = dragging ? 1400 : k;
      const cc = dragging ? 75 : c;
      for (let s = 0; s < n; s += 1) {
        const a = kk * (st.target[i] - st.gains[i]) - cc * st.vel[i];
        st.vel[i] += a * h;
        st.gains[i] += st.vel[i] * h;
      }
    }
    for (let j = 0; j < 3; j += 1) st.accent[j] += (st.accentTarget[j] - st.accent[j]) * Math.min(1, dt * 5);
    const rounded = st.target.map((g) => clamp(Math.round(g), -MAX_DB, MAX_DB));
    if (rounded.some((r, i) => r !== st.rounded[i])) {
      st.rounded = rounded;
      onRounded(rounded);
    }
  }

  function draw(dt) {
    const { w, h, dpr } = st;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 1;
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = Math.round(yOfDb(db)) + 0.5;
      ctx.strokeStyle = db === 0 ? "rgba(20,20,19,0.18)" : "rgba(20,20,19,0.06)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    BAND_X.forEach((u) => {
      const x = Math.round(xOf(u)) + 0.5;
      ctx.strokeStyle = "rgba(20,20,19,0.05)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });

    const barW = w / BINS;
    const floor = h;
    const room = h - pad().top * 0.5;
    for (let b = 0; b < BINS; b += 1) {
      const u = (b + 0.5) / BINS;
      const f = F_MIN * 2 ** (u * LOG_SPAN);
      const jitter = (hash(b, Math.floor(st.t * 10)) - 0.5) * 2;
      const db = musicAt(f, st.t) + curveAt(st.gains, u) * 1.1 + jitter;
      const want = clamp((db + 34) / 42, 0, 1);
      const cur = st.bars[b];
      st.bars[b] = want > cur ? cur + (want - cur) * Math.min(1, dt * 22) : cur + (want - cur) * Math.min(1, dt * 6);
    }
    const grad = ctx.createLinearGradient(0, floor, 0, floor - room);
    grad.addColorStop(0, rgb(0.16));
    grad.addColorStop(0.4, rgb(0.11));
    grad.addColorStop(0.75, rgb(0.06));
    grad.addColorStop(1, rgb(0.03));
    ctx.fillStyle = grad;
    const bw = Math.max(2, barW * 0.62);
    for (let b = 0; b < BINS; b += 1) {
      const x = b * barW + (barW - bw) / 2;
      const bh = st.bars[b] * room;
      ctx.beginPath();
      ctx.roundRect(x, floor - bh, bw, bh, [Math.min(bw / 2, 4), Math.min(bw / 2, 4), 0, 0]);
      ctx.fill();
    }

    const steps = Math.max(80, Math.round(w / 3));
    const pts = [];
    for (let s = 0; s <= steps; s += 1) {
      const u = s / steps;
      pts.push([xOf(u), yOfDb(clamp(curveAt(st.gains, u), -MAX_DB - 1, MAX_DB + 1))]);
    }
    const zero = yOfDb(0);
    const area = ctx.createLinearGradient(0, yOfDb(MAX_DB), 0, yOfDb(-MAX_DB));
    area.addColorStop(0, rgb(0.34));
    area.addColorStop(0.25, rgb(0.22));
    area.addColorStop(0.42, rgb(0.1));
    area.addColorStop(0.5, rgb(0.04));
    area.addColorStop(0.58, rgb(0.1));
    area.addColorStop(0.75, rgb(0.22));
    area.addColorStop(1, rgb(0.34));
    ctx.fillStyle = area;
    ctx.beginPath();
    ctx.moveTo(0, zero);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(w, zero);
    ctx.closePath();
    ctx.fill();

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = rgb(1);
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();

    stage.style.setProperty("--eq-accent", rgb(1));
    handles.forEach((el, i) => {
      if (!el) return;
      const x = xOf(BAND_X[i]);
      const y = yOfDb(clamp(st.gains[i], -MAX_DB, MAX_DB));
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    });
  }

  const loop = (now) => {
    const dt = Math.min(0.033, (now - st.last) / 1000);
    st.last = now;
    step(dt);
    draw(dt);
    st.raf = st.visible && st.onScreen ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => {
    if (st.raf || !st.visible || !st.onScreen) return;
    st.last = performance.now();
    st.raf = requestAnimationFrame(loop);
  };

  const pointerDb = (e) => {
    const r = canvas.getBoundingClientRect();
    return clamp(dbOfY(e.clientY - r.top), -MAX_DB, MAX_DB);
  };
  const nearestBand = (e) => {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    let best = 0;
    BAND_X.forEach((bx, i) => {
      if (Math.abs(bx - u) < Math.abs(BAND_X[best] - u)) best = i;
    });
    return best;
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const handleIndex = handles.indexOf(e.target.closest("[data-band]"));
    const band = handleIndex >= 0 ? handleIndex : nearestBand(e);
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const offset = handleIndex >= 0 ? st.gains[band] - pointerDb(e) : 0;
    st.drag = { id: e.pointerId, band, offset };
    handles[band]?.focus({ preventScroll: true, focusVisible: false });
    stage.dataset.dragging = String(band);
    setBand(band, pointerDb(e) + offset);
    onGrab(band);
  };
  const onMove = (e) => {
    if (!st.drag || e.pointerId !== st.drag.id) return;
    setBand(st.drag.band, pointerDb(e) + st.drag.offset);
  };
  const onUp = (e) => {
    if (!st.drag || e.pointerId !== st.drag.id) return;
    st.drag = null;
    delete stage.dataset.dragging;
    onGrab(-1);
  };

  function setBand(i, db) {
    const snapped = Math.round(db);
    st.target[i] = clamp(snapped, -MAX_DB, MAX_DB);
    onCustom();
    kick();
  }

  const io = new IntersectionObserver(([entry]) => {
    st.onScreen = entry.isIntersecting;
    kick();
  });
  io.observe(canvas);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const onVis = () => {
    st.visible = !document.hidden;
    kick();
  };
  document.addEventListener("visibilitychange", onVis);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("lostpointercapture", onUp);
  resize();
  kick();

  return {
    setPreset(gains, accent) {
      st.target = gains.slice();
      st.accentTarget = accent.slice();
      kick();
    },
    nudge(i, delta) {
      setBand(i, st.target[i] + delta);
    },
    reset(i) {
      setBand(i, 0);
    },
    destroy() {
      cancelAnimationFrame(st.raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("lostpointercapture", onUp);
    },
  };
}
