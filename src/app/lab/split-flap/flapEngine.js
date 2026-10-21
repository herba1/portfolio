import { SLOTS, STRIDE, createFlapGL } from "./flapGL";

const STEP = 46;
const FALL = 124;
const POOL = 2;
const BUCKETS = 5;
const SIG = 12;
const THRESH = 13;
const SETTLE = 6;
const STALE = 1800;
const BLANK = [13, 12, 11];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
}

function poseAngle(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 180;
  if (u < 0.86) {
    const k = u / 0.86;
    return 176 * (0.22 * k + 0.78 * k * k);
  }
  const k = (u - 0.86) / 0.14;
  return 176 + 4 * (1 - (1 - k) * (1 - k) * (1 - k));
}

function fitBoard(availW, availH, narrow, embedded) {
  const pad = narrow || embedded ? 12 : 20;
  const aspect = narrow ? 4 / 5 : 16 / 10;
  let bw = availW - pad * 2;
  let bh = bw / aspect;
  if (bh > availH - pad * 2) {
    bh = availH - pad * 2;
    bw = bh * aspect;
  }
  const cols = narrow ? 11 : embedded ? clamp(Math.round(bw / 30), 10, 20) : clamp(Math.round(bw / 40), 14, 24);
  const px = Math.max(10, Math.floor(bw / cols));
  const rows = Math.max(4, Math.round(bh / (px * 1.38)));
  const py = Math.max(14, Math.floor(bh / rows));
  const cg = Math.max(2, Math.round(px * 0.08));
  const rg = Math.max(2, Math.round(py * 0.07));
  const w = px - cg;
  const h = py - rg;
  const gap = h >= 40 ? 2 : 1;
  const topH = Math.floor((h - gap) / 2);
  const boardW = cols * px - cg;
  const boardH = rows * py - rg;
  return { cols, rows, px, py, w, h, cg, rg, gap, topH, botY: topH + gap, pad, boardW, boardH, outerW: boardW + pad * 2, outerH: boardH + pad * 2 };
}

export function createBoard(stage, { embedded = false, caption = null, footer = null, onLive = () => {}, onPlaying = () => {}, onFail = () => {} } = {}) {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;

  const board = document.createElement("div");
  board.className = "split-flap-board";
  stage.appendChild(board);
  const canvas = document.createElement("canvas");
  canvas.className = "split-flap-canvas";
  board.appendChild(canvas);

  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");


  let renderer = null;
  try {
    renderer = createFlapGL(canvas);
  } catch (error) {
    console.error(error);
  }
  if (!renderer) onFail();

  let layout = null;
  let cells = [];
  let sigs = new Float32Array(0);
  let latest = new Float32Array(0);
  let data = new Float32Array(0);
  let groups = [];
  let crop = [0, 0, 1, 1];
  let clock = 0;
  let last = null;
  let raf = 0;
  let visible = false;
  let revealed = false;
  let destroyed = false;
  let sampled = false;
  let lastVideoTime = -1;
  let userPaused = false;
  let audio = null;
  let dpr = 1;
  let token = 0;
  let objectUrl = "";
  let wave = 0;
  let dirty = true;
  const active = new Set();
  const counts = new Float32Array(BUCKETS);
  const upper = [];

  function build() {
    const g = layout;
    board.style.width = `${g.outerW}px`;
    board.style.height = `${g.outerH}px`;
    board.style.setProperty("--split-flap-pad", `${g.pad}px`);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const tile = [Math.min(64, Math.max(4, Math.round(g.w * dpr))), Math.min(88, Math.max(6, Math.round(g.h * dpr)))];
    active.clear();
    cells = [];
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        const flaps = [];
        for (let k = 0; k < POOL; k += 1) flaps.push({ busy: false, t0: 0, from: 0, to: 0, theta: 0 });
        const seed = hash(r * 97 + 13, c * 31 + 7);
        cells.push({
          x: g.pad + c * g.px,
          y: g.pad + r * g.py,
          col: c,
          row: r,
          seed,
          jitter: (seed % 1000) / 1000,
          speed: 1 + ((hash(c, r) % 1000) / 1000 - 0.5) * 0.12,
          bucket: Math.min(BUCKETS - 1, Math.floor((c / g.cols) * BUCKETS)),
          flaps,
          started: 0,
          shown: 0,
          nextAt: 0,
          pending: 0,
          lastFlip: 0,
          landed: -1,
          ct: 0,
          cb: 0,
          ck: 1,
        });
      }
    }
    sigs = new Float32Array(cells.length * SIG);
    for (let i = 0; i < cells.length; i += 1) for (let k = 0; k < SIG; k += 1) sigs[i * SIG + k] = BLANK[k % 3];
    latest = new Float32Array(cells.length * SIG);
    data = new Float32Array(cells.length * (3 + POOL * 2) * STRIDE);
    groups = Array.from({ length: SLOTS }, () => []);
    sampled = false;
    lastVideoTime = -1;
    if (renderer) {
      renderer.setView({
        w: g.outerW,
        h: g.outerH,
        dpr,
        cell: [g.w, g.h, g.topH, g.botY],
        persp: Math.round(g.h * 3.4),
        center: [g.outerW / 2, g.outerH * 1.1],
        thick: Math.max(1.5, g.h * 0.035),
        radius: Math.max(1, Math.round(g.w * 0.1)),
        grid: [g.cols, g.rows],
        tile,
      });
    }
    updateCrop();
    dirty = true;
    if (revealed) rollIn(0);
  }

  function updateCrop() {
    if (!layout || !video.videoWidth) return;
    const va = video.videoWidth / video.videoHeight;
    const ba = (layout.cols * layout.px) / (layout.rows * layout.py);
    if (va > ba) {
      const w = ba / va;
      crop = [(1 - w) / 2, 0, w, 1];
    } else {
      const h = va / ba;
      crop = [0, (1 - h) / 2, 1, h];
    }
  }

  function rollIn(base) {
    for (const cell of cells) {
      cell.nextAt = Math.max(cell.nextAt, clock + base + cell.col * 11 + cell.row * 19 + cell.jitter * 40);
      cell.pending = 0;
    }
  }

  function collect() {
    const g = layout;
    const W = g.cols * 2;
    const px = renderer.collect();
    if (!px || px.length !== W * g.rows * 2 * 4) return;
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        const o = (r * g.cols + c) * SIG;
        let k = 0;
        for (let j = 0; j < 2; j += 1) {
          for (let i = 0; i < 2; i += 1) {
            const p = ((r * 2 + j) * W + c * 2 + i) * 4;
            latest[o + k] = px[p];
            latest[o + k + 1] = px[p + 1];
            latest[o + k + 2] = px[p + 2];
            k += 3;
          }
        }
      }
    }
    sampled = true;
  }

  function freeSlot(cell) {
    for (let s = 0; s < SLOTS; s += 1) {
      if (s === cell.started || s === cell.shown) continue;
      let used = false;
      for (const f of cell.flaps) if (f.busy && (f.from === s || f.to === s)) used = true;
      if (!used) return s;
    }
    return -1;
  }

  function decide() {
    for (const g of groups) g.length = 0;
    if (!sampled || !revealed) return;
    const gap = reduced ? 420 : STEP;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (clock < cell.nextAt) continue;
      const o = i * SIG;
      let diff = 0;
      let tint = 0;
      for (let k = 0; k < SIG; k += 3) {
        const a0 = latest[o + k];
        const a1 = latest[o + k + 1];
        const a2 = latest[o + k + 2];
        const b0 = sigs[o + k];
        const b1 = sigs[o + k + 1];
        const b2 = sigs[o + k + 2];
        diff += Math.abs(a0 - b0) + Math.abs(a1 - b1) + Math.abs(a2 - b2);
        tint += Math.abs(Math.max(a0, a1, a2) - Math.min(a0, a1, a2) - Math.max(b0, b1, b2) + Math.min(b0, b1, b2));
      }
      const limit = clock - cell.lastFlip > STALE ? SETTLE : THRESH;
      if (diff / SIG + (tint / 4) * 0.8 <= limit) {
        cell.pending = 0;
        continue;
      }
      if (!cell.pending) {
        cell.pending = clock + cell.jitter * 36;
        continue;
      }
      if (clock < cell.pending) continue;
      const flap = cell.flaps.find((f) => !f.busy);
      if (!flap) continue;
      const slot = freeSlot(cell);
      if (slot < 0) continue;
      groups[slot].push(cell.col, cell.row);
      for (let k = 0; k < SIG; k += 1) sigs[o + k] = latest[o + k];
      flap.busy = true;
      flap.t0 = clock;
      flap.from = cell.started;
      flap.to = slot;
      flap.theta = 0;
      cell.started = slot;
      cell.lastFlip = clock;
      cell.nextAt = clock + gap * cell.speed;
      cell.pending = 0;
      active.add(cell);
      dirty = true;
    }
    renderer?.capture(groups);
  }

  function step(cell) {
    let newest = 999;
    let oldest = -1;
    const fall = reduced ? 1 : FALL * cell.speed;
    for (const flap of cell.flaps) {
      if (!flap.busy) continue;
      const u = (clock - flap.t0) / fall;
      if (u >= 1) {
        flap.busy = false;
        if (flap.t0 >= cell.landed) {
          cell.landed = flap.t0;
          cell.shown = flap.to;
        }
        counts[cell.bucket] += 1;
        continue;
      }
      flap.theta = poseAngle(u);
      if (flap.theta < newest) newest = flap.theta;
      if (flap.theta > oldest) oldest = flap.theta;
    }
    cell.ct = newest < 60 ? 0.5 * Math.pow(1 - newest / 60, 1.5) : 0;
    cell.cb = oldest > 0 ? 0.62 * Math.pow(oldest / 180, 1.3) : 0;
    cell.ck = 0.25 + (0.75 * Math.max(0, oldest)) / 180;
    return cell.flaps.some((f) => f.busy);
  }

  function put(i, cell, kind, slot, b0, b1, b2, b3) {
    const o = i * STRIDE;
    data[o] = cell.x;
    data[o + 1] = cell.y;
    data[o + 2] = kind;
    data[o + 3] = slot;
    data[o + 4] = b0;
    data[o + 5] = b1;
    data[o + 6] = b2;
    data[o + 7] = b3;
    data[o + 8] = cell.col;
    data[o + 9] = cell.row;
    data[o + 10] = (cell.seed % 997) / 997;
    data[o + 11] = 0;
  }

  function render() {
    if (!renderer || !layout) return;
    let n = 0;
    upper.length = 0;
    for (const cell of cells) {
      put(n++, cell, 0, 0, 0, 0, 0, 0);
      const moving = cell.flaps.some((f) => f.busy);
      put(n++, cell, 1, cell.started, 0, 0, moving ? cell.ct : 0, 0);
      put(n++, cell, 2, cell.shown, 0, 0, moving ? cell.cb : 0, moving ? cell.ck : 1);
      for (const flap of cell.flaps) if (flap.busy) upper.push([cell, flap]);
    }
    upper.sort((a, b) => Math.sin((a[1].theta * Math.PI) / 180) - Math.sin((b[1].theta * Math.PI) / 180));
    for (const [cell, flap] of upper) {
      if (flap.theta < 90) {
        const k = flap.theta / 90;
        put(n++, cell, 3, flap.from, flap.theta, 0.52 * Math.pow(k, 1.6), 0, Math.sin(k * Math.PI));
      } else {
        const k = (180 - flap.theta) / 90;
        put(n++, cell, 4, flap.to, flap.theta, 0.6 * Math.pow(k, 1.4), 0, 0);
      }
      put(n++, cell, 5, 0, flap.theta, 0, 0, 0);
    }
    renderer.draw(data, n);
  }

  function frame(ts) {
    raf = 0;
    if (destroyed) return;
    const dt = last == null ? 16.7 : Math.min(64, Math.max(0, ts - last));
    last = ts;
    clock += dt;
    counts.fill(0);
    if (layout && renderer && video.readyState >= 2 && video.videoWidth) {
      const t = video.currentTime;
      // Upload only once the previous frame's read-back has landed, or a
      // frame the GPU is still busy with gets re-uploaded every tick.
      if (t !== lastVideoTime && renderer.idle()) {
        if (wave) updateCrop();
        renderer.uploadVideo(video);
        if (renderer.prepare(crop, layout.cols * 2, layout.rows * 2)) lastVideoTime = t;
        if (!revealed) {
          revealed = true;
          rollIn(reduced ? 0 : 160);
        }
        if (wave) {
          wave = 0;
          if (!reduced) rollIn(60);
        }
      }
    }
    if (layout && renderer) collect();
    decide();
    if (active.size) dirty = true;
    for (const cell of active) if (!step(cell)) active.delete(cell);
    if (audio) audio.play(counts);
    if (dirty) {
      render();
      dirty = false;
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = null;
  }

  function kick() {
    if (raf || destroyed || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function syncPlayback() {
    const want = visible && !document.hidden && !userPaused;
    if (want && video.paused && video.src) video.play().catch(() => {});
    else if (!want && !video.paused) video.pause();
    onPlaying(!userPaused);
  }

  let laidW = 0;
  let laidH = 0;
  let laidCap = -1;
  let layoutRaf = 0;

  function relayout() {
    layoutRaf = 0;
    const rect = stage.getBoundingClientRect();
    const W = Math.floor(rect.width);
    const H = Math.floor(rect.height);
    if (W < 40 || H < 40) return;
    const capH = caption ? caption.offsetHeight : 0;
    const footH = footer ? footer.offsetHeight : 0;
    if (W === laidW && H === laidH && capH + footH * 1000 === laidCap) return;
    laidW = W;
    laidH = H;
    laidCap = capH + footH * 1000;
    const narrow = W < 640;
    const side = embedded ? (W < 600 ? 12 : 16) : narrow ? 16 : 48;
    const top = embedded ? side : (narrow ? 72 : 88) + capH + (narrow ? 16 : 24);
    const bottom = embedded ? side : footH + (narrow ? 32 : 48);
    const next = fitBoard(W - side * 2, Math.max(80, H - top - bottom), narrow, embedded);
    const changed = !layout || next.cols !== layout.cols || next.rows !== layout.rows || next.px !== layout.px || next.py !== layout.py;
    if (changed) {
      layout = next;
      build();
    }
    const left = Math.round((W - layout.outerW) / 2);
    const free = H - top - bottom - layout.outerH;
    const y = Math.round(top + Math.max(0, free) * 0.5);
    board.style.left = `${left}px`;
    board.style.top = `${y}px`;
    stage.style.setProperty("--split-flap-board-x", `${left}px`);
    stage.style.setProperty("--split-flap-board-y", `${y}px`);
    stage.style.setProperty("--split-flap-board-w", `${layout.outerW}px`);
    stage.style.setProperty("--split-flap-board-h", `${layout.outerH}px`);
    kick();
  }

  const ro = new ResizeObserver(() => {
    if (!layoutRaf) layoutRaf = requestAnimationFrame(relayout);
  });
  ro.observe(stage);
  if (caption) ro.observe(caption);
  if (footer) ro.observe(footer);
  relayout();

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
      if (visible) kick();
    },
    { threshold: 0.05 },
  );
  io.observe(board);

  const onVisibility = () => {
    syncPlayback();
    if (!document.hidden) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onReduced = () => {
    reduced = reducedQuery.matches;
  };
  reducedQuery.addEventListener("change", onReduced);
  const onMeta = () => {
    updateCrop();
    kick();
  };
  video.addEventListener("loadedmetadata", onMeta);

  function togglePause() {
    userPaused = !userPaused;
    syncPlayback();
    onLive(userPaused ? "Paused." : "Playing.");
  }

  const onClick = () => togglePause();
  const onKey = (event) => {
    if (event.key === " " || event.key === "Enter" || event.key === "k") {
      event.preventDefault();
      togglePause();
    }
  };
  board.tabIndex = 0;
  board.setAttribute("role", "button");
  board.setAttribute("aria-label", "A split-flap board playing a film. Press to pause or play.");
  board.addEventListener("click", onClick);
  board.addEventListener("keydown", onKey);

  return {
    setSource(source) {
      const id = ++token;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      let url = "";
      if (source instanceof Blob) {
        objectUrl = URL.createObjectURL(source);
        url = objectUrl;
      } else {
        const webm = video.canPlayType('video/webm; codecs="vp9"');
        url = webm && source.webm ? source.webm : source.mp4 || source.webm;
      }
      if (id !== token) return;
      video.src = url;
      video.load();
      if (revealed) wave = 1;
      userPaused = false;
      syncPlayback();
      kick();
    },
    async setSound(on) {
      if (on && !audio) {
        const { createClicks } = await import("./flapAudio");
        if (destroyed) return false;
        audio = createClicks();
      }
      if (!audio) return false;
      await audio.setEnabled(on);
      return on;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(layoutRaf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedQuery.removeEventListener("change", onReduced);
      video.removeEventListener("loadedmetadata", onMeta);
      board.removeEventListener("click", onClick);
      board.removeEventListener("keydown", onKey);
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      audio?.destroy();
      renderer?.destroy();
      board.remove();
    },
  };
}
