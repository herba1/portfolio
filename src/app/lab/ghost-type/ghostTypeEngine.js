export const POEM = ["who has seen the wind?", "neither i nor you:", "but when the leaves", "hang trembling, the wind", "is passing through."];
const POEM_NARROW = ["who has seen", "the wind?", "neither i nor", "you: but when", "the leaves hang", "trembling, the", "wind is passing", "through."];
const DRIFT_WORDS = ["wind?", "through.", "seen", "passing", "who", "has"];

const GHOSTS = 6;
const WEIGHT = 700;
const PAPER = "#f3f1ec";
const INK = "#151412";
const MAX_HISTORY = 900;
const PHASE_RATE = 0.42;
const MAX_FREE = 24;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function bezier(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

export function createGhostType(host, { canvas, onReady, onActive, onPlaced, insets }) {
  const ctx = canvas.getContext("2d");
  const family = getComputedStyle(host).fontFamily || "sans-serif";
  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    fs: 80,
    lineH: 76,
    words: [],
    lines: [],
    block: { x: 0, y: 0, w: 0 },
    drag: null,
    raf: 0,
    last: 0,
    time: 0,
    visible: true,
    destroyed: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    drift: null,
    driftWait: 0,
    driftOrder: [],
    driftIndex: 0,
    quietUntil: 0,
    ready: false,
    hover: -1,
    zTop: 0,
    touched: false,
    placedCount: 0,
  };

  function makeWord(text, line) {
    return {
      text,
      line,
      free: line < 0,
      w: 0,
      x: 0,
      y: 0,
      hx: 0,
      hy: 0,
      lifted: false,
      placed: null,
      flight: null,
      history: [],
      trail: 0,
      bend: 0,
      vx: 0,
      vy: 0,
      z: 0,
      alpha: 1,
      phase: Math.random() * 6.28,
      solid: null,
      lift: null,
      ghost: null,
    };
  }

  function buildWords(lines) {
    state.lines = [];
    state.words = [];
    lines.forEach((line, li) => {
      state.lines.push(
        line.split(" ").map((text) => {
          const word = makeWord(text, li);
          state.words.push(word);
          return word;
        }),
      );
    });
    const order = [];
    for (const text of DRIFT_WORDS) {
      const last = lines.length - 1;
      const i = state.words.findIndex((w, k) => w.text === text && (w.line === 0 || w.line === last) && !order.includes(k));
      if (i >= 0) order.push(i);
    }
    state.driftOrder = order;
    state.driftIndex = 0;
  }

  function font(px) {
    return `${WEIGHT} ${px}px ${family}`;
  }

  function tracking(px) {
    return -0.043 * (px - 12);
  }

  function setFont(c, px) {
    c.font = font(px);
    if ("letterSpacing" in c) c.letterSpacing = `${tracking(px)}px`;
  }

  function layout() {
    const inset = insets?.() || { top: 120, bottom: 80, roof: 16, floor: state.height - 16 };
    state.roof = inset.roof;
    state.floor = inset.floor;
    const narrow = state.width < 640;
    const side = narrow ? 16 : Math.max(48, state.width * 0.09);
    const availW = narrow ? state.width - side * 2 : Math.min(state.width * 0.72, 1040);
    const availH = (state.height - inset.top - inset.bottom) * (narrow ? 0.72 : 0.66);
    setFont(ctx, 100);
    const minGap = 0.3;
    const space = ctx.measureText(" ").width / 100;
    let fs = 400;
    for (const line of state.lines) {
      let sum = 0;
      for (const w of line) sum += ctx.measureText(w.text).width / 100;
      const need = sum + Math.max(0, line.length - 1) * Math.max(minGap, space);
      fs = Math.min(fs, availW / need);
    }
    const leading = 0.98;
    fs = Math.min(fs, availH / (state.lines.length * leading + 0.2));
    fs = Math.max(28, Math.floor(fs));
    state.fs = fs;
    state.lineH = Math.round(fs * leading);
    setFont(ctx, fs);
    for (const w of state.words) {
      w.w = ctx.measureText(w.text).width - tracking(fs);
      buildGlyphs(w);
    }
    const blockW = availW;
    const blockH = state.lines.length * state.lineH;
    const roomH = state.height - inset.top - inset.bottom;
    state.block = {
      x: (state.width - blockW) / 2,
      y: inset.top + Math.max(0, (roomH - blockH) / 2),
      w: blockW,
    };
    justify(true);
  }

  function justify(snap) {
    const { x, y, w } = state.block;
    state.lines.forEach((line, li) => {
      const home = line.filter((word) => !word.lifted);
      const sum = home.reduce((a, b) => a + b.w, 0);
      const gap = home.length > 1 ? (w - sum) / (home.length - 1) : 0;
      let cx = x;
      const baseline = y + li * state.lineH + state.fs * 0.78;
      for (const word of line) {
        if (word.lifted) continue;
        word.hx = cx;
        word.hy = baseline;
        cx += word.w + gap;
      }
      for (const word of line) {
        if (!word.lifted) continue;
        const all = line.reduce((a, b) => a + b.w, 0);
        const fullGap = line.length > 1 ? (w - all) / (line.length - 1) : 0;
        let fx = x;
        for (const other of line) {
          if (other === word) break;
          fx += other.w + fullGap;
        }
        word.hx = fx;
        word.hy = baseline;
      }
      if (snap) {
        for (const word of line) {
          if (word.lifted || word.flight) continue;
          word.x = word.hx;
          word.y = word.hy;
        }
      }
    });
  }

  function slotOf(word) {
    if (word.free) return null;
    const line = state.lines[word.line];
    const all = line.reduce((a, b) => a + b.w, 0);
    const gap = line.length > 1 ? (state.block.w - all) / (line.length - 1) : 0;
    let fx = state.block.x;
    for (const other of line) {
      if (other === word) break;
      fx += other.w + gap;
    }
    return [fx, state.block.y + word.line * state.lineH + state.fs * 0.78];
  }

  function buildGlyphs(word) {
    const fs = state.fs;
    const dpr = state.dpr;
    const pad = Math.ceil(fs * 0.3);
    const w = Math.ceil(word.w + pad * 2);
    const h = Math.ceil(fs * 1.3 + pad);
    const make = (solid) => {
      const c = document.createElement("canvas");
      c.width = Math.ceil(w * dpr);
      c.height = Math.ceil(h * dpr);
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      setFont(g, fs);
      g.textBaseline = "alphabetic";
      g.lineJoin = "round";
      if (solid === "lift") {
        g.strokeStyle = PAPER;
        g.lineWidth = Math.max(4, fs * 0.09);
        g.strokeText(word.text, pad, pad + fs * 0.92);
        g.fillStyle = INK;
        g.fillText(word.text, pad, pad + fs * 0.92);
      } else if (solid) {
        g.fillStyle = INK;
        g.fillText(word.text, pad, pad + fs * 0.92);
      } else {
        g.strokeStyle = INK;
        g.lineWidth = Math.max(1.25, fs / 56);
        g.strokeText(word.text, pad, pad + fs * 0.92);
      }
      return c;
    };
    word.solid = make(true);
    word.lift = make("lift");
    word.ghost = make(false);
    word.pad = pad;
    word.gw = w;
    word.gh = h;
  }

  function drawBent(word, img, x, y, amp, phase, alpha) {
    const { gw, gh, pad } = word;
    const ox = x - pad;
    const oy = y - pad - state.fs * 0.92;
    ctx.globalAlpha = alpha;
    if (Math.abs(amp) < 0.25) {
      ctx.drawImage(img, ox, oy, gw, gh);
      return;
    }
    const dpr = state.dpr;
    const step = 2;
    const freq = 1.15;
    for (let row = 0; row < gh; row += step) {
      const yn = row / gh;
      const a = Math.sin(yn * Math.PI * 2 * freq + phase);
      const b = Math.cos(yn * Math.PI * freq * 0.65 - phase * 0.7);
      const bend = (a * 0.72 + b * 0.28) * amp;
      const sh = Math.min(step, gh - row);
      ctx.drawImage(img, 0, row * dpr, img.width, sh * dpr, ox + bend, oy + row, gw, sh + 0.6);
    }
  }

  function pointAlong(word, dist) {
    const hist = word.history;
    let px = word.x;
    let py = word.y;
    let left = dist;
    for (let i = hist.length - 1; i >= 0; i -= 1) {
      const [hx, hy] = hist[i];
      const seg = Math.hypot(px - hx, py - hy);
      if (seg >= left && seg > 0) {
        const t = left / seg;
        return [px + (hx - px) * t, py + (hy - py) * t];
      }
      left -= seg;
      px = hx;
      py = hy;
    }
    return [px, py];
  }

  function record(word) {
    const hist = word.history;
    const lastPt = hist[hist.length - 1];
    if (!lastPt || Math.hypot(word.x - lastPt[0], word.y - lastPt[1]) > 3) hist.push([word.x, word.y]);
    let total = 0;
    for (let i = hist.length - 1; i > 0; i -= 1) {
      total += Math.hypot(hist[i][0] - hist[i - 1][0], hist[i][1] - hist[i - 1][1]);
      if (total > MAX_HISTORY) {
        hist.splice(0, i - 1);
        break;
      }
    }
  }

  function bounds(word, x, y) {
    const m = 16;
    return [
      clamp(x, m, Math.max(m, state.width - word.w - m)),
      clamp(y, state.roof + state.fs * 0.78, Math.max(state.roof + state.fs * 0.78, state.floor - state.fs * 0.24)),
    ];
  }

  function countPlaced() {
    const drifting = state.drift ? state.drift.word : null;
    const n = state.words.filter((w) => !(w.flight && w.flight.remove) && w !== drifting && (w.free || w.lifted || w.placed)).length;
    if (n !== state.placedCount) {
      state.placedCount = n;
      onPlaced?.(n);
    }
  }

  function place(word, vx, vy) {
    word.flight = null;
    word.placed = bounds(word, word.x + vx * 0.11, word.y + vy * 0.11);
    state.touched = true;
    countPlaced();
  }

  function flyTo(word, from, to, remove) {
    const lift = state.fs * (remove ? 0.6 : 1.4);
    const p1 = [from[0] + (to[0] - from[0]) * 0.35, Math.min(from[1], to[1]) - lift];
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    word.flight = { p0: [from[0], from[1]], p1, t: 0, T: clamp(0.7 + dist / 1800, 0.7, 1.2), to, remove: Boolean(remove) };
    word.placed = null;
  }

  function freeSpot(word) {
    const others = state.words.filter((o) => o !== word && o.alpha > 0.5);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i += 1) {
      const p = bounds(word, Math.random() * state.width, state.roof + Math.random() * (state.floor - state.roof));
      let score = Infinity;
      for (const o of others) {
        const ox = o.placed ? o.placed[0] : o.x;
        const oy = o.placed ? o.placed[1] : o.y;
        const dx = Math.max(0, Math.max(ox - (p[0] + word.w), p[0] - (ox + o.w)));
        const dy = Math.max(0, Math.abs(oy - p[1]) - state.fs * 0.9);
        score = Math.min(score, Math.hypot(dx, dy));
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  function addWord(text) {
    const free = state.words.filter((w) => w.free && !(w.flight && w.flight.remove));
    if (free.length >= MAX_FREE) clearWord(free[0]);
    const word = makeWord(text, -1);
    setFont(ctx, state.fs);
    word.w = ctx.measureText(text).width - tracking(state.fs);
    buildGlyphs(word);
    word.z = ++state.zTop;
    state.words.push(word);
    return word;
  }

  function clearWord(word) {
    const to = state.dock ? state.dock() : [state.width / 2, state.height];
    flyTo(word, [word.x, word.y], [to[0] - word.w / 2, to[1]], true);
  }

  function startFlight(word, vx, vy) {
    const slot = slotOf(word);
    word.placed = null;
    const p0 = [word.x, word.y];
    const dist = Math.hypot(slot[0] - p0[0], slot[1] - p0[1]);
    const T = clamp(0.62 + dist / 1800, 0.62, 1.15);
    const sp = Math.hypot(vx, vy);
    const cap = Math.min(1, 2600 / Math.max(1, sp));
    const lead = (T / 4) * cap;
    const p1 = [p0[0] + vx * lead, p0[1] + vy * lead];
    word.flight = { p0, p1, t: 0, T };
    word.pending = false;
    if (word.lifted) {
      word.lifted = false;
      justify(false);
    }
  }

  function lift(word) {
    word.flight = null;
    word.pending = true;
  }

  function settleLift(word) {
    if (!word.pending) return;
    const slot = slotOf(word);
    if (Math.hypot(word.x - slot[0], word.y - slot[1]) < state.fs * 1.05) return;
    word.pending = false;
    word.lifted = true;
    justify(false);
  }

  function hit(x, y) {
    const order = state.words.map((w, i) => i).sort((a, b) => state.words[b].z - state.words[a].z);
    for (const i of order) {
      const w = state.words[i];
      if (w.flight && w.flight.remove) continue;
      const top = w.y - state.fs * 0.82;
      const bottom = w.y + state.fs * 0.26;
      const padX = state.fs * 0.12;
      if (x >= w.x - padX && x <= w.x + w.w + padX && y >= top && y <= bottom) return i;
    }
    return -1;
  }

  function scheduleDrift(now) {
    if (state.reduced) return;
    const idx = state.driftOrder[state.driftIndex % state.driftOrder.length];
    state.driftIndex += 1;
    const word = state.words[idx];
    if (!word || word.lifted || word.placed || word.flight || (state.drag && state.drag.word === word)) return;
    const narrow = state.width < 640;
    const dir = word.hx + word.w / 2 > state.width / 2 ? -1 : 1;
    const reach = narrow ? state.width * 0.3 : Math.min(380, state.width * 0.24);
    const up = word.line < state.lines.length / 2;
    const rise = up
      ? word.hy - Math.max(state.roof + state.fs * 0.8, word.hy - (word.line + 2) * state.lineH)
      : word.hy - Math.min(state.floor - state.fs * 0.3, word.hy + (state.lines.length - word.line + 1) * state.lineH);
    lift(word);
    state.drift = { word, t0: now, T: 5.2, dir, reach, rise, ox: word.x, oy: word.y };
  }

  function driftPoint(d, t) {
    const k = clamp(t / d.T, 0, 1);
    const out = Math.sin(Math.PI * k);
    const sway = Math.sin(Math.PI * 2 * k);
    return [d.ox + d.dir * d.reach * out ** 2 + d.dir * sway * d.reach * 0.18, d.oy - d.rise * Math.sin(Math.PI * k) ** 0.6];
  }

  function step(now) {
    state.raf = 0;
    if (state.destroyed) return;
    const tNow = now / 1000;
    const dt = Math.min(0.05, Math.max(0.001, tNow - (state.last || tNow)));
    state.last = tNow;
    state.time += dt;
    let busy = false;

    if (!state.reduced && !state.touched && !state.drift && !state.drag && tNow > state.quietUntil) {
      if (state.driftWait <= 0) {
        scheduleDrift(tNow);
        state.driftWait = 2.4;
      } else state.driftWait -= dt;
      busy = true;
    }

    const d = state.drift;
    if (d) {
      const t = tNow - d.t0;
      const word = d.word;
      if (t >= d.T * 0.82) {
        const prev = driftPoint(d, t - dt);
        const cur = driftPoint(d, t);
        state.drift = null;
        word.x = cur[0];
        word.y = cur[1];
        startFlight(word, (cur[0] - prev[0]) / dt, (cur[1] - prev[1]) / dt);
      } else {
        const p = driftPoint(d, t);
        word.vx = (p[0] - word.x) / dt;
        word.vy = (p[1] - word.y) / dt;
        word.x = p[0];
        word.y = p[1];
      }
      busy = true;
    }

    for (const word of state.words) {
      const dragging = state.drag && state.drag.word === word;
      if (dragging) {
        const tx = state.drag.px - state.drag.ox;
        const ty = state.drag.py - state.drag.oy;
        const nx = damp(word.x, tx, 22, dt);
        const ny = damp(word.y, ty, 22, dt);
        word.vx = (nx - word.x) / dt;
        word.vy = (ny - word.y) / dt;
        word.x = nx;
        word.y = ny;
        if (!word.free && word.lifted) {
          const slot = slotOf(word);
          if (Math.hypot(word.x - slot[0], word.y - slot[1]) < state.fs * 0.8) {
            word.lifted = false;
            word.pending = true;
            justify(false);
          }
        }
      } else if (word.flight) {
        const f = word.flight;
        f.t += dt;
        const k = clamp(f.t / f.T, 0, 1);
        const target = f.to || slotOf(word);
        const p = bezier(f.p0, f.p1, target, easeOutCubic(k));
        word.vx = (p[0] - word.x) / dt;
        word.vy = (p[1] - word.y) / dt;
        word.x = p[0];
        word.y = p[1];
        if (f.remove) word.alpha = 1 - clamp((k - 0.45) / 0.55, 0, 1) ** 1.5;
        if (k >= 1) {
          word.flight = null;
          word.x = target[0];
          word.y = target[1];
          if (f.remove) word.dead = true;
          else if (f.to) word.placed = [target[0], target[1]];
          countPlaced();
        }
      } else if (!(state.drift && state.drift.word === word)) {
        const rest = word.placed || [word.hx, word.hy];
        const nx = damp(word.x, rest[0], 9, dt);
        const ny = damp(word.y, rest[1], 9, dt);
        word.vx = (nx - word.x) / dt;
        word.vy = (ny - word.y) / dt;
        word.x = nx;
        word.y = ny;
        if (Math.abs(word.x - rest[0]) < 0.05 && Math.abs(word.y - rest[1]) < 0.05) {
          word.x = rest[0];
          word.y = rest[1];
          word.vx = 0;
          word.vy = 0;
        }
      }
      settleLift(word);
      const speed = Math.hypot(word.vx, word.vy);
      const moving = dragging || word.flight || (state.drift && state.drift.word === word);
      const drifting = state.drift && state.drift.word === word;
      const trailTarget = moving ? clamp(speed / 900, drifting ? 0.6 : 0.35, 1) : 0;
      word.trail = damp(word.trail, trailTarget, moving ? 3 : 2.4, dt);
      const bendTarget = clamp(speed / 1600, 0, 1) * (dragging ? 1 : 0.7);
      word.bend = damp(word.bend, bendTarget, bendTarget > word.bend ? 8 : 3, dt);
      if (moving || word.trail > 0.004) record(word);
      else word.history.length = 0;
      if (word.trail < 0.004 && !moving) word.trail = 0;
      const rest = word.placed || [word.hx, word.hy];
      if (moving || word.trail > 0 || word.bend > 0.004 || Math.abs(word.x - rest[0]) > 0.05 || Math.abs(word.y - rest[1]) > 0.05) busy = true;
    }
    if (state.words.some((w) => w.dead)) {
      state.words = state.words.filter((w) => !w.dead);
      countPlaced();
    }

    draw();
    if (!state.ready) {
      state.ready = true;
      onReady?.();
    }
    if ((busy || !state.reduced) && state.visible) state.raf = requestAnimationFrame(step);
    else state.last = 0;
  }

  function draw() {
    const { width, height, dpr } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    const phaseT = state.time * PHASE_RATE;
    const order = [...state.words].sort((a, b) => a.z - b.z || (a.trail > 0) - (b.trail > 0));
    for (const word of order) {
      if (word.alpha <= 0.004) continue;
      const wa = word.alpha;
      if (word.trail > 0.004 && word.history.length) {
        const spacing = state.fs * 1.05 * word.trail;
        const phase = (phaseT + word.hx * 0.0002) % 1;
        for (let i = GHOSTS; i >= 1; i -= 1) {
          const age = GHOSTS - i + phase;
          const p = pointAlong(word, age * spacing);
          const fade = (1 - age / GHOSTS) ** 1.35;
          const amp = state.fs * 0.05 * word.trail * (0.35 + (age / GHOSTS) * 0.65);
          drawBent(word, word.ghost, p[0], p[1], amp, word.phase + state.time * 2.2 + age * 0.8, fade * 0.9 * Math.min(1, word.trail * 1.8) * wa);
        }
      }
      const amp = state.fs * 0.06 * word.bend;
      const away = word.free || word.placed || Math.hypot(word.x - word.hx, word.y - word.hy) > 2 || word.trail > 0.02;
      drawBent(word, away ? word.lift : word.solid, word.x, word.y, amp, word.phase + state.time * 2.6, wa);
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (state.destroyed || state.raf || !state.visible) return;
    state.raf = requestAnimationFrame(step);
  }

  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = toLocal(e);
    const i = hit(x, y);
    if (i < 0) return;
    const word = state.words[i];
    if (state.drift && state.drift.word === word) state.drift = null;
    canvas.setPointerCapture?.(e.pointerId);
    grabWord(word, e.pointerId, x, y, e.timeStamp);
  }

  function grabWord(word, id, x, y, ts) {
    if (!word.free) lift(word);
    word.flight = null;
    word.placed = null;
    word.z = ++state.zTop;
    state.drag = { id, word, px: x, py: y, ox: x - word.x, oy: y - word.y, samples: [[ts, x, y]] };
    state.quietUntil = Infinity;
    host.setAttribute("data-dragging", "");
    onActive?.(word.text);
    frame();
  }

  function onMove(e) {
    const [x, y] = toLocal(e);
    const d = state.drag;
    if (!d && e.target !== canvas) return;
    if (d && d.id === e.pointerId) {
      d.px = x;
      d.py = y;
      d.samples.push([e.timeStamp, x, y]);
      while (d.samples.length > 2 && e.timeStamp - d.samples[0][0] > 100) d.samples.shift();
      frame();
      return;
    }
    if (e.pointerType === "mouse") {
      const i = hit(x, y);
      if (i !== state.hover) {
        state.hover = i;
        if (i >= 0) host.setAttribute("data-hover", "");
        else host.removeAttribute("data-hover");
      }
    }
  }

  function onUp(e) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    state.drag = null;
    host.removeAttribute("data-dragging");
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const span = Math.max(16, b[0] - a[0]) / 1000;
    const recent = e.timeStamp - b[0] < 140;
    const vx = recent ? (b[1] - a[1]) / span : 0;
    const vy = recent ? (b[2] - a[2]) / span : 0;
    const word = d.word;
    const cvx = clamp(vx, -3000, 3000);
    const cvy = clamp(vy, -3000, 3000);
    if (!word.free && !word.lifted) startFlight(word, cvx, cvy);
    else place(word, cvx, cvy);
    countPlaced();
    state.quietUntil = performance.now() / 1000 + 5;
    state.driftWait = 0;
    onActive?.(null);
    frame();
  }

  function resize() {
    const r = host.getBoundingClientRect();
    const dprNow = Math.min(window.devicePixelRatio || 1, 2);
    if (state.laidOut && Math.abs(r.width - state.width) < 0.5 && Math.abs(r.height - state.height) < 0.5 && dprNow === state.dpr) return;
    state.laidOut = true;
    state.width = Math.max(1, r.width);
    state.height = Math.max(1, r.height);
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    const narrow = state.width < 640;
    if (narrow !== state.narrow || !state.words.length) {
      state.narrow = narrow;
      const extra = state.words.filter((w) => w.free);
      buildWords(narrow ? POEM_NARROW : POEM);
      state.words.push(...extra);
      countPlaced();
    }
    const sw = state.width;
    const sh = state.height;
    state.words = state.words.filter((w) => !(w.flight && w.flight.remove));
    for (const w of state.words) {
      w.history.length = 0;
      w.trail = 0;
      if (w.flight && w.flight.to) w.placed = w.flight.to;
      w.flight = null;
      w.pending = false;
      if (w.placed) w.placed = [(w.placed[0] / (state.prevW || sw)) * sw, (w.placed[1] / (state.prevH || sh)) * sh];
    }
    state.prevW = sw;
    state.prevH = sh;
    state.drift = null;
    state.drag = null;
    layout();
    for (const w of state.words) {
      if (w.placed) {
        w.placed = bounds(w, w.placed[0], w.placed[1]);
        w.x = w.placed[0];
        w.y = w.placed[1];
      }
    }
    draw();
    frame();
  }

  function prime() {
    if (state.reduced) return;
    const now = performance.now() / 1000;
    scheduleDrift(now - 1.9);
    const d = state.drift;
    if (!d) return;
    const word = d.word;
    for (let t = 0; t <= 1.9; t += 1 / 60) {
      const p = driftPoint(d, t);
      word.x = p[0];
      word.y = p[1];
      word.history.push([p[0], p[1]]);
    }
    word.trail = 0.7;
    word.bend = 0.2;
    state.driftWait = 2.4;
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);

  const ro = new ResizeObserver(() => resize());
  const io = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting && document.visibilityState === "visible";
    frame();
  });
  const onVisibility = () => {
    state.visible = document.visibilityState === "visible";
    frame();
  };
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotion = () => {
    state.reduced = motionQuery.matches;
    frame();
  };

  document.fonts
    .load(font(120), POEM.join(" "))
    .catch(() => null)
    .then(() => {
      if (state.destroyed) return;
      ro.observe(host);
      io.observe(host);
      document.addEventListener("visibilitychange", onVisibility);
      motionQuery.addEventListener?.("change", onMotion);
      resize();
      prime();
      frame();
    });

  return {
    setDock(fn) {
      state.dock = fn;
    },
    drop(text, from) {
      if (!state.laidOut) return;
      const word = addWord(text);
      if (state.drift) {
        const dw = state.drift.word;
        state.drift = null;
        startFlight(dw, 0, 0);
      }
      const start = from || [state.width / 2, state.height];
      const to = freeSpot(word);
      word.x = start[0] - word.w / 2;
      word.y = start[1];
      flyTo(word, [word.x, word.y], to, false);
      state.touched = true;
      countPlaced();
      frame();
    },
    grab(text, e) {
      if (!state.laidOut) return;
      const word = addWord(text);
      if (state.drift) {
        const dw = state.drift.word;
        state.drift = null;
        startFlight(dw, 0, 0);
      }
      const [x, y] = toLocal(e);
      word.x = x - word.w / 2;
      word.y = y + state.fs * 0.3;
      grabWord(word, e.pointerId, x, y, e.timeStamp);
      state.touched = true;
      countPlaced();
    },
    putBack() {
      state.drag = null;
      state.drift = null;
      host.removeAttribute("data-dragging");
      for (const word of state.words) {
        if (word.free) {
          if (!(word.flight && word.flight.remove)) clearWord(word);
        } else if (word.lifted || word.placed || word.pending) {
          startFlight(word, 0, -400);
        }
      }
      state.touched = false;
      countPlaced();
      state.quietUntil = performance.now() / 1000 + 4;
      state.driftWait = 0;
      frame();
    },
    release() {
      state.quietUntil = 0;
      state.driftWait = 0;
      if (!state.drift) scheduleDrift(performance.now() / 1000);
      frame();
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener?.("change", onMotion);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
    },
  };
}
