import { albumById } from "@/app/lab/_music/catalog";

import { createPlotSound } from "./plotAudio";
import { HERSHEY } from "./plotHershey";
import { plotJob } from "./plotPaths";
import { locate, planPlot, sample } from "./plotPlan";

const SHEETS = [
  { id: "help", line: "you don't have to carry it all by yourself", title: "help! 1965", count: 9000, gamma: 1.6, target: 50 },
  { id: "a-hard-days-night", line: "you can rest now, the long day is done", title: "a hard day's night 1964", count: 11000, gamma: 2.4, target: 64 },
  { id: "with-the-beatles", line: "half in the light is still in the light", title: "with the beatles 1963", count: 11000, gamma: 2.6, target: 62 },
  { id: "let-it-be", line: "some things are better left the way they were", title: "let it be 1970", count: 11000, gamma: 2.4, target: 62 },
  { id: "rubber-soul", line: "i keep your voice on the walk home", title: "rubber soul 1965", count: 11000, gamma: 2.4, target: 62 },
  { id: "beatles-for-sale", line: "it will take a while to feel like this again", title: "beatles for sale 1964", count: 11000, gamma: 2.2, target: 62 },
];

const GRID = 320;
const INK = "#1d1c1b";
const BUCKETS = 6;
const LIFT_MS = 1700;
const REST_MS = 3400;

function textStrokes(str, font, size, baseline, maxWidth) {
  const glyphs = HERSHEY[font];
  let width = 0;
  for (const ch of str) width += (glyphs[ch] || glyphs[" "])[0];
  const k = Math.min(size / 21, maxWidth / width);
  let x = 0.5 - (width * k) / 2;
  const out = [];
  for (const ch of str) {
    const [adv, strokes] = glyphs[ch] || glyphs[" "];
    for (const s of strokes) {
      const pts = new Float32Array(s.length);
      for (let i = 0; i < s.length; i += 2) {
        pts[i] = x + s[i] * k;
        pts[i + 1] = baseline + (s[i + 1] - 9) * k;
      }
      out.push(pts);
    }
    x += adv * k;
  }
  return out;
}

function paperTile() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  let seed = 7331;
  const r = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const m = Math.sin((TAU * x) / size + 1.1) * Math.sin((TAU * 2 * y) / size) * 0.5 + Math.sin((TAU * 3 * (x - y)) / size) * 0.5;
      const n = (r() - 0.5) * 6 + m * 1.6;
      const i = (y * size + x) * 4;
      img.data[i] = 242 + n;
      img.data[i + 1] = 237 + n;
      img.data[i + 2] = 227 + n * 0.9;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let f = 0; f < 220; f += 1) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * TAU;
    const l = 3 + r() * 9;
    g.strokeStyle = r() < 0.5 ? "rgba(120,100,70,0.045)" : "rgba(255,255,250,0.16)";
    g.lineWidth = 0.5 + r() * 0.5;
    g.beginPath();
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + Math.cos(a + 0.25) * l * 0.5, y + dy + Math.sin(a + 0.25) * l * 0.5, x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
      }
    }
    g.stroke();
  }
  return c.toDataURL("image/png");
}

function makeWorker() {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") return null;
  try {
    const src = `const plotJob = ${plotJob.toString()};\nself.onmessage = (e) => { const out = plotJob(e.data); self.postMessage({ id: e.data.id, out }, [out.buffer]); };`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    return { worker, url };
  } catch {
    return null;
  }
}

async function coverGray(src) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = GRID;
  c.height = GRID;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, GRID, GRID);
  const data = g.getImageData(0, 0, GRID, GRID).data;
  const gray = new Float32Array(GRID * GRID);
  for (let i = 0; i < gray.length; i += 1) gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  return gray;
}

export function createPlot(stage, { embedded = false, onLive, onGesture } = {}) {
  const root = document.createElement("div");
  root.className = "plot-surface";
  root.tabIndex = 0;
  root.setAttribute("role", "img");
  const base = document.createElement("div");
  base.className = "plot-paper";
  const sheet = document.createElement("div");
  sheet.className = "plot-paper plot-sheet";
  const canvas = document.createElement("canvas");
  canvas.className = "plot-ink";
  const grain = document.createElement("div");
  grain.className = "plot-grain";
  const pen = document.createElement("div");
  pen.className = "plot-pen";
  sheet.append(canvas, grain);
  root.append(base, sheet, pen);
  stage.append(root);

  const tile = paperTile();
  root.style.setProperty("--plot-paper", `url(${tile})`);

  const ctx = canvas.getContext("2d");
  const sound = createPlotSound();
  const workerBox = makeWorker();
  let jobId = 0;
  const pending = new Map();
  if (workerBox) {
    workerBox.worker.onmessage = (e) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data.out);
    };
  }
  const runJob = (job) =>
    new Promise((resolve) => {
      if (workerBox) {
        jobId += 1;
        pending.set(jobId, resolve);
        workerBox.worker.postMessage({ ...job, id: jobId }, [job.gray.buffer]);
      } else {
        setTimeout(() => resolve(plotJob(job)), 0);
      }
    });

  let W = 0;
  let H = 0;
  let S = 0;
  let ox = 0;
  let oy = 0;
  let dpr = 1;
  let baseW = 1;
  let destroyed = false;
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;

  let index = 0;
  let current = null;
  let next = null;
  let time = 0;
  let state = "loading";
  let doneAt = 0;
  let liftAt = 0;
  let drawnSeg = 0;
  let drawnEvent = 0;
  let drawnPool = 0;
  let eventCursor = 0;
  let scrub = null;
  let prevPos = null;
  let firstReady = false;
  const pos = { x: 0, y: 0, v: 0, vx: 0, vy: 0, down: false };

  const layout = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const pad = Math.max(16, Math.min(W, H) * 0.06);
    S = Math.floor(Math.min(W - pad * 2, (H - pad * 2) / 1.26, 620));
    ox = Math.round((W - S) / 2);
    oy = Math.round(Math.max(pad, (H - S * 1.22) / 2));
    baseW = Math.max(0.6, Math.min(1, (S / 520) * 0.82));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    redraw();
  };

  const prepare = async (k) => {
    const spec = SHEETS[k % SHEETS.length];
    const album = albumById(spec.id);
    const gray = await coverGray(album.cover);
    const count = Math.round(spec.count * Math.max(0.42, Math.min(1, (S / 520) ** 2)));
    const cover = await runJob({ gray, size: GRID, count, seed: 11 + k, gamma: spec.gamma, cap: 1 });
    const strokes = [cover];
    const line = textStrokes(spec.line, "scripts", 0.062, 1.135, 1.0);
    const title = textStrokes(spec.title, "futural", 0.024, 1.205, 0.6);
    strokes.push(...line, ...title);
    const plan = planPlot(strokes, { start: [0.5, -0.04], target: spec.target });
    const buckets = new Uint8Array(plan.n);
    for (let i = 0; i < plan.n; i += 1) buckets[i] = Math.min(BUCKETS - 1, Math.round(((plan.width[i] - 1) / 0.75) * (BUCKETS - 1)));
    return { spec, album, plan, buckets };
  };

  const queueNext = () => {
    const k = index + 1;
    prepare(k)
      .then((p) => {
        if (destroyed) return;
        next = p;
      })
      .catch(() => {});
  };

  const X = (u) => (ox + u * S) * dpr;
  const Y = (v) => (oy + v * S) * dpr;

  const strokeRange = (a, b) => {
    if (!current || b <= a) return;
    const { plan, buckets } = current;
    const { xs, ys, downs } = plan;
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let bk = 0; bk < BUCKETS; bk += 1) {
      let open = false;
      let lastEnd = -1;
      ctx.beginPath();
      for (let i = a; i < b; i += 1) {
        if (!downs[i] || buckets[i] !== bk) continue;
        if (lastEnd !== i) ctx.moveTo(X(xs[i]), Y(ys[i]));
        ctx.lineTo(X(xs[i + 1]), Y(ys[i + 1]));
        lastEnd = i + 1;
        open = true;
      }
      if (open) {
        ctx.lineWidth = baseW * (1 + (bk / (BUCKETS - 1)) * 0.75) * dpr;
        ctx.stroke();
      }
    }
  };

  const dot = (x, y, r) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), r * dpr, 0, Math.PI * 2);
    ctx.fill();
  };

  const dotsUpTo = (seg, t) => {
    const { plan } = current;
    while (drawnPool < plan.pool.length && plan.pool[drawnPool] <= seg) {
      const v = plan.pool[drawnPool];
      dot(plan.xs[v], plan.ys[v], baseW * 0.62);
      drawnPool += 1;
    }
    while (drawnEvent < plan.events.length && plan.events[drawnEvent].t <= t) {
      const e = plan.events[drawnEvent];
      dot(e.x, e.y, baseW * (e.type === "down" ? 0.95 : 0.8));
      drawnEvent += 1;
    }
  };

  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawnSeg = 0;
    drawnEvent = 0;
    drawnPool = 0;
    if (!current) return;
    paint(time, true);
  };

  const paint = (t, full) => {
    if (!current) return;
    const { plan } = current;
    const i = locate(plan, t);
    if (!full && i < drawnSeg) {
      redraw();
      return;
    }
    strokeRange(drawnSeg, i);
    drawnSeg = i;
    dotsUpTo(i - 1, t);
    sample(plan, i, t, pos);
    if (plan.downs[i] && plan.L[i] > 0) {
      ctx.strokeStyle = INK;
      ctx.lineCap = "round";
      ctx.lineWidth = baseW * plan.width[i] * dpr;
      ctx.beginPath();
      ctx.moveTo(X(plan.xs[i]), Y(plan.ys[i]));
      ctx.lineTo(X(pos.x), Y(pos.y));
      ctx.stroke();
    }
  };

  const scrubTo = (t) => {
    if (!current) return;
    const target = Math.max(0, Math.min(current.plan.duration, t));
    const back = target < time;
    time = target;
    if (back) redraw();
    else paint(time, false);
    eventCursor = current.plan.events.findIndex((e) => e.t > time);
    if (eventCursor < 0) eventCursor = current.plan.events.length;
  };

  const install = (p, startAt) => {
    current = p;
    time = startAt;
    eventCursor = 0;
    prevPos = null;
    state = "drawing";
    sheet.style.transform = "";
    sheet.style.boxShadow = "";
    redraw();
    eventCursor = p.plan.events.findIndex((e) => e.t > time);
    if (eventCursor < 0) eventCursor = p.plan.events.length;
    root.setAttribute("aria-label", `A pen plotter drawing ${p.album.title} by The Beatles as one continuous line, then writing: ${p.spec.line}`);
    onLive?.(`Drawing ${p.album.title}`);
    queueNext();
  };

  const movePen = () => {
    if (!current) return;
    const lifted = state === "lift";
    pen.style.transform = `translate3d(${ox + pos.x * S}px, ${oy + pos.y * S}px, 0)`;
    pen.toggleAttribute("data-down", pos.down && !lifted);
    pen.toggleAttribute("data-hidden", lifted);
  };

  const tick = (now) => {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (current) {
      const plan = current.plan;
      if (state === "drawing" && !scrub) {
        time = Math.min(plan.duration, time + dt);
        paint(time, false);
        while (eventCursor < plan.events.length && plan.events[eventCursor].t <= time) {
          const e = plan.events[eventCursor];
          sound?.pen(e.type === "down", (e.x - 0.5) * 0.8);
          eventCursor += 1;
        }
        if (time >= plan.duration) {
          state = "done";
          doneAt = now;
        }
      } else if (state === "done" && !scrub) {
        if (now - doneAt > REST_MS && next) {
          state = "lift";
          liftAt = now;
          sound?.lift();
        }
      } else if (state === "lift") {
        const e = Math.min(1, (now - liftAt) / LIFT_MS);
        const ease = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
        const rise = ease * (H + 120);
        sheet.style.transform = `translate3d(${ease * W * 0.04}px, ${-rise}px, 0) rotate(${-ease * 2.2}deg) scale(${1 + Math.sin(e * Math.PI) * 0.012})`;
        sheet.style.boxShadow = `0 ${10 + ease * 30}px ${30 + ease * 40}px rgb(60 48 30 / ${Math.min(0.16, e * 0.6)})`;
        if (e >= 1 && next) {
          index += 1;
          const p = next;
          next = null;
          install(p, 0);
        }
      }
      const axis = current.plan.vmax / current.plan.scale;
      if (prevPos && dt > 0 && state !== "lift") {
        const vx = Math.abs(pos.x - prevPos.x) / dt / axis;
        const vy = Math.abs(pos.y - prevPos.y) / dt / axis;
        sound?.motion(vx, vy, pos.down);
      } else {
        sound?.quiet();
      }
      prevPos = { x: pos.x, y: pos.y };
      movePen();
    }
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (running && !raf && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const setRunning = () => {
    const should = visible && document.visibilityState === "visible" && !destroyed;
    if (should === running) return;
    running = should;
    if (running) wake();
    else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      sound?.quiet();
    }
  };

  const gesture = () => {
    onGesture?.();
  };

  const onDown = (e) => {
    gesture();
    if (!current || e.button > 0) return;
    scrub = { id: e.pointerId, x: e.clientX, y: e.clientY, t: time, active: e.pointerType === "mouse" };
    if (scrub.active) {
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        scrub.active = true;
      }
    }
    root.setAttribute("data-grabbing", "");
  };
  const onMove = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.x;
    const dy = e.clientY - scrub.y;
    if (!scrub.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (embedded && Math.abs(dy) > Math.abs(dx)) {
        scrub = null;
        root.removeAttribute("data-grabbing");
        return;
      }
      scrub.active = true;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        scrub.active = true;
      }
    }
    const span = current.plan.duration * 0.9;
    scrubTo(scrub.t + (dx / Math.max(320, W)) * span);
    if (state !== "lift") state = time >= current.plan.duration ? "done" : "drawing";
    if (state === "done") doneAt = performance.now();
  };
  const onUp = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub = null;
    root.removeAttribute("data-grabbing");
    if (state === "done") doneAt = performance.now();
  };
  const onKey = (e) => {
    if (!current) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      gesture();
      e.preventDefault();
      scrubTo(time + (e.key === "ArrowRight" ? 2 : -2));
      if (state !== "lift") state = time >= current.plan.duration ? "done" : "drawing";
      if (state === "done") doneAt = performance.now();
    }
  };
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    setRunning();
  });
  io.observe(stage);
  const onVis = () => setRunning();
  document.addEventListener("visibilitychange", onVis);

  layout();
  prepare(0)
    .then((p) => {
      if (destroyed) return;
      install(p, p.plan.duration * 0.3);
      sample(p.plan, locate(p.plan, time), time, pos);
      movePen();
      firstReady = true;
      root.setAttribute("data-ready", "");
      setRunning();
      wake();
    })
    .catch(() => {});

  return {
    get ready() {
      return firstReady;
    },
    async setSound(on) {
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("keydown", onKey);
      if (workerBox) {
        workerBox.worker.terminate();
        URL.revokeObjectURL(workerBox.url);
      }
      sound?.destroy();
      root.remove();
    },
  };
}
