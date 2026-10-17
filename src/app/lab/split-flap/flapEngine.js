import { DRUM, DRUM_INDEX, cleanTitle, initialSet, moveRow, playRow, renameRow, rowLines, titleOf } from "./flapSet";
import { STRIDE, createFlapGL } from "./flapGL";

const L = DRUM.length;
const STEP = 46;
const FALL = 124;
const POOL = 3;
const TONES = 16;
const BUCKETS = 5;
const ATLAS_COLS = 12;

const HOUSING_LIGHT =
  "linear-gradient(to bottom, rgb(255 255 255 / 0.07) 0%, rgb(255 255 255 / 0.025) 6%, rgb(255 255 255 / 0.008) 30%, rgb(0 0 0 / 0) 60%, rgb(0 0 0 / 0.12) 100%)";

const VARIANTS = [
  { name: "wide", time: 5, title: 16, status: 11, minW: 19 },
  { name: "mid", time: 5, title: 13, status: 7, minW: 17 },
  { name: "narrow", time: 5, title: 12, status: 0, minW: 17 },
  { name: "compact", time: 0, title: 12, status: 0, minW: 0 },
];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function makeTones() {
  const rand = mulberry(77);
  const bg = [];
  const ink = [];
  for (let i = 0; i < TONES; i += 1) {
    bg.push(hsl(26 + rand() * 20, 0.03 + rand() * 0.04, 0.072 + rand() * 0.03));
    ink.push(hsl(40 + rand() * 12, 0.1 + rand() * 0.12, 0.865 + rand() * 0.07));
  }
  return { bg, ink };
}

function grainTile(strength, seed) {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  const img = g.createImageData(size, size);
  const rand = mulberry(seed);
  for (let i = 0; i < size * size; i += 1) {
    const v = rand();
    const on = v > 0.5;
    img.data[i * 4] = on ? 255 : 0;
    img.data[i * 4 + 1] = on ? 250 : 0;
    img.data[i * 4 + 2] = on ? 240 : 0;
    img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * strength);
  }
  g.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function buildAtlas(g, dpr, family, weight) {
  const cw = Math.ceil(g.w * dpr) + 4;
  const ch = Math.ceil(g.h * dpr) + 4;
  const rows = Math.ceil(L / ATLAS_COLS);
  const canvas = document.createElement("canvas");
  canvas.width = cw * ATLAS_COLS;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d");
  const size = Math.round(g.h * 0.68 * dpr);
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cap = ctx.measureText("H").actualBoundingBoxAscent || size * 0.7;
  const baseline = g.h * dpr * 0.5 + cap * 0.5;
  for (let i = 1; i < L; i += 1) {
    const x = (i % ATLAS_COLS) * cw + 2 + (g.w * dpr) / 2;
    const y = Math.floor(i / ATLAS_COLS) * ch + 2 + baseline;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.93, 1);
    ctx.fillText(DRUM[i], 0, 0);
    ctx.restore();
  }
  return { canvas, cw, ch };
}

function geometry(variant, rows, w) {
  const h = 2 * Math.round(w * 0.74);
  const cg = Math.max(1, Math.round(w * 0.09));
  const gut = Math.max(6, Math.round(w * 0.78));
  const lampCol = Math.max(14, Math.round(w * 1.2));
  const rg = Math.max(4, Math.round(h * 0.2));
  const groups = [];
  let x = lampCol;
  const add = (key, n) => {
    if (!n) return;
    if (groups.length) x += gut;
    groups.push({ key, n, x });
    x += n * w + (n - 1) * cg;
  };
  add("time", variant.time);
  add("title", variant.title);
  add("status", variant.status);
  const rowW = x;
  const padX = Math.max(8, Math.round(w * 0.62));
  const padY = Math.max(8, Math.round(rg * 1.15));
  const winW = rowW + padX * 2;
  const winH = rows * h + (rows - 1) * rg + padY * 2;
  const hp = Math.max(12, Math.round(w * 0.72));
  const head = hp + 44;
  const gap = h >= 36 ? 2 : 1;
  const topH = Math.floor((h - gap) / 2);
  return {
    variant,
    rows,
    w,
    h,
    cg,
    rg,
    gap,
    topH,
    botY: topH + gap,
    botH: h - topH - gap,
    lampCol,
    groups,
    rowW,
    padX,
    padY,
    winW,
    winH,
    hp,
    head,
    boardW: winW + hp * 2,
    boardH: head + winH + hp,
  };
}

function fitLayout(availW, availH, maxRows) {
  let fallback = null;
  for (const variant of VARIANTS) {
    for (let rows = maxRows; rows >= 4; rows -= 1) {
      let found = null;
      for (let w = 44; w >= 9; w -= 1) {
        const g = geometry(variant, rows, w);
        if (g.boardW <= availW && g.boardH <= availH) {
          found = g;
          break;
        }
      }
      if (found && found.w >= Math.max(variant.minW, rows > 5 ? 15 : 13)) return found;
      if (found && !fallback) fallback = found;
    }
  }
  return fallback || geometry(VARIANTS[3], 4, 9);
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

export function createBoard(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const tones = makeTones();
  const paint = grainTile(20, 4);
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;

  const board = document.createElement("div");
  board.className = "split-flap-board";
  const sheet = document.createElement("style");
  sheet.textContent = `.split-flap-board .split-flap-housing { background-image: url(${paint}), ${HOUSING_LIGHT}; }`;
  board.appendChild(sheet);
  stage.appendChild(board);

  const housing = document.createElement("div");
  housing.className = "split-flap-housing";
  board.appendChild(housing);

  const plate = document.createElement("div");
  plate.className = "split-flap-plate";
  plate.innerHTML = '<span class="split-flap-venue">Monovolt</span><span class="split-flap-night">Tonight’s set</span>';
  board.appendChild(plate);

  const vents = document.createElement("div");
  vents.className = "split-flap-vents";
  board.appendChild(vents);

  const screws = [0, 1, 2, 3].map((i) => {
    const s = document.createElement("span");
    s.className = "split-flap-screw";
    s.style.setProperty("--split-flap-screw-turn", `${[18, 64, 131, 102][i]}deg`);
    board.appendChild(s);
    return s;
  });

  const labels = document.createElement("div");
  labels.className = "split-flap-labels";
  board.appendChild(labels);

  const win = document.createElement("div");
  win.className = "split-flap-window";
  board.appendChild(win);

  const canvas = document.createElement("canvas");
  canvas.className = "split-flap-canvas";
  win.appendChild(canvas);
  const overlay = document.createElement("div");
  overlay.className = "split-flap-overlay";
  win.appendChild(overlay);

  const slot = document.createElement("div");
  slot.className = "split-flap-slot";
  const mark = document.createElement("div");
  mark.className = "split-flap-mark";
  const caret = document.createElement("div");
  caret.className = "split-flap-caret";
  const input = document.createElement("input");
  input.className = "split-flap-input";
  input.type = "text";
  input.autocomplete = "off";
  input.autocapitalize = "words";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Track title");
  input.tabIndex = -1;

  let renderer = null;
  try {
    renderer = createFlapGL(canvas);
  } catch (error) {
    console.error(error);
  }
  if (!renderer) onFail();

  let set = initialSet();
  let layout = null;
  let cells = [];
  let lamps = [];
  let clock = 0;
  let last = null;
  let raf = 0;
  let visible = false;
  let revealed = false;
  let destroyed = false;
  let atlasReady = false;
  let atlasToken = 0;
  let dirty = true;
  let data = new Float32Array(0);
  const active = new Set();
  const counts = new Float32Array(BUCKETS);
  let audio = null;
  let dpr = 1;

  let hoverRow = -1;
  let focusRow = 0;
  let keyboardFocus = false;
  let press = null;
  let drag = null;
  let editing = -1;
  let editOriginal = "";

  const lampState = () => {
    lamps.forEach((lamp, r) => {
      let state = "off";
      if (r === 0) state = "on";
      else if (drag && drag.from === r) state = "warm";
      else if (!drag && hoverRow === r) state = "warm";
      if (lamp.dataset.state !== state) lamp.dataset.state = state;
    });
  };

  const toneTop = (cell, ch) => hash(cell.seed, ch) % TONES;
  const toneBot = (cell, ch) => hash(cell.seed, (ch + L - 1) % L) % TONES;

  async function loadAtlas() {
    if (!renderer || !layout) return;
    const token = ++atlasToken;
    const style = getComputedStyle(board);
    const family = style.fontFamily || "sans-serif";
    const weight = style.fontWeight || "600";
    const size = Math.round(layout.h * 0.68 * dpr);
    try {
      await document.fonts.load(`${weight} ${size}px ${family}`, "AaGg09");
    } catch {}
    if (destroyed || token !== atlasToken || !layout) return;
    const atlas = buildAtlas(layout, dpr, family, weight);
    renderer.setAtlas(atlas.canvas, ATLAS_COLS, atlas.cw, atlas.ch);
    atlasReady = true;
    dirty = true;
    if (visible) reveal();
    kick();
  }

  function build() {
    overlay.textContent = "";
    labels.textContent = "";
    active.clear();
    cells = [];
    lamps = [];
    const g = layout;
    board.style.width = `${g.boardW}px`;
    board.style.height = `${g.boardH}px`;
    board.style.setProperty("--split-flap-lamp", `${Math.max(7, Math.round(g.w * 0.42))}px`);
    win.style.left = `${g.hp}px`;
    win.style.top = `${g.head}px`;
    win.style.width = `${g.winW}px`;
    win.style.height = `${g.winH}px`;
    labels.style.left = `${g.hp + g.padX}px`;
    labels.style.top = `${g.hp + 24}px`;
    const names = { time: "Time", title: "Track", status: "Status" };
    for (const group of g.groups) {
      const label = document.createElement("span");
      label.className = "split-flap-label";
      label.textContent = names[group.key];
      label.style.left = `${group.x}px`;
      labels.appendChild(label);
    }
    for (let r = 0; r < g.rows; r += 1) {
      const y = g.padY + r * (g.h + g.rg);
      const lamp = document.createElement("span");
      lamp.className = "split-flap-lamp";
      lamp.style.left = `${g.padX + Math.round(g.lampCol * 0.42)}px`;
      lamp.style.top = `${y + g.h / 2}px`;
      lamp.dataset.state = "off";
      overlay.appendChild(lamp);
      lamps.push(lamp);
      for (const group of g.groups) {
        for (let c = 0; c < group.n; c += 1) {
          const x = group.x + c * (g.w + g.cg);
          const flaps = [];
          for (let k = 0; k < POOL; k += 1) flaps.push({ busy: false, t0: 0, from: 0, to: 0, theta: 0 });
          cells.push({
            x: g.padX + x,
            y,
            flaps,
            row: r,
            group: group.key,
            index: c,
            col: x / (g.w + g.cg),
            seed: hash(r * 97 + 13, cells.length * 31 + group.n),
            speed: 1 + ((hash(cells.length, 7) % 1000) / 1000 - 0.5) * 0.1,
            bucket: Math.min(BUCKETS - 1, Math.floor(((g.padX + x) / g.winW) * BUCKETS)),
            started: 0,
            shown: 0,
            target: 0,
            nextAt: 0,
            landed: -1,
            ct: 0,
            cb: 0,
            ck: 1,
          });
        }
      }
    }
    data = new Float32Array(cells.length * (3 + POOL) * STRIDE);
    overlay.appendChild(mark);
    overlay.appendChild(slot);
    overlay.appendChild(caret);
    overlay.appendChild(input);
    slot.style.left = `${Math.round(g.padX * 0.4)}px`;
    slot.style.width = `${g.winW - Math.round(g.padX * 0.8)}px`;
    const sx = [g.hp / 2, g.boardW - g.hp / 2];
    const sy = [g.hp / 2, g.boardH - g.hp / 2];
    screws[0].style.transform = `translate(${sx[0]}px, ${sy[0]}px)`;
    screws[1].style.transform = `translate(${sx[1]}px, ${sy[0]}px)`;
    screws[2].style.transform = `translate(${sx[0]}px, ${sy[1]}px)`;
    screws[3].style.transform = `translate(${sx[1]}px, ${sy[1]}px)`;
    plate.style.left = `${g.hp + g.padX}px`;
    plate.style.top = `${g.hp - 2}px`;
    vents.style.right = `${g.hp + g.padX}px`;
    vents.style.top = `${g.hp + 4}px`;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (renderer) {
      renderer.setView({
        w: g.winW,
        h: g.winH,
        dpr,
        cell: [g.w, g.h, g.topH, g.botY],
        persp: Math.round(g.h * 6.5),
        center: [g.winW / 2, g.winH / 2],
        radius: Math.max(1, Math.round(g.w * 0.08)),
      });
    }
    atlasReady = false;
    dirty = true;
    lampState();
    placeMark();
    loadAtlas();
  }

  function settleCell(cell, ch) {
    cell.started = ch;
    cell.shown = ch;
    cell.target = ch;
    for (const f of cell.flaps) f.busy = false;
    cell.ct = 0;
    cell.cb = 0;
    active.delete(cell);
    dirty = true;
  }

  function setTarget(cell, ch, delay) {
    if (cell.target === ch) return;
    const idle = cell.started === cell.target && !cell.flaps.some((f) => f.busy);
    cell.target = ch;
    if (idle) cell.nextAt = clock + delay;
    active.add(cell);
  }

  function targets() {
    const lines = rowLines(set, { rows: layout.rows, title: layout.variant.title, status: layout.variant.status });
    const out = [];
    for (const cell of cells) {
      const line = lines[cell.row];
      const text = line ? line[cell.group] : "";
      const ch = (text && text[cell.index]) || " ";
      out.push([cell, DRUM_INDEX.get(ch) ?? 0]);
    }
    return out;
  }

  function apply(wave) {
    if (!layout) return;
    if (!revealed) return;
    for (const [cell, ch] of targets()) {
      if (reduced) {
        if (cell.target !== ch) {
          const idle = cell.started === cell.target && !cell.flaps.some((f) => f.busy);
          cell.target = ch;
          if (idle) cell.nextAt = clock;
          active.add(cell);
        }
        continue;
      }
      const jitter = (hash(cell.seed, cell.target + 3) % 1000) / 1000;
      setTarget(cell, ch, wave * (cell.row * 24 + cell.col * 4) + jitter * 34);
    }
    kick();
  }

  function settleAll() {
    for (const [cell, ch] of targets()) settleCell(cell, ch);
    kick();
  }

  function step(cell) {
    while (cell.started !== cell.target && clock >= cell.nextAt) {
      const flap = cell.flaps.find((f) => !f.busy);
      if (!flap) break;
      const from = cell.started;
      const to = reduced ? cell.target : (from + 1) % L;
      flap.busy = true;
      flap.t0 = cell.nextAt;
      flap.from = from;
      flap.to = to;
      cell.started = to;
      cell.nextAt += STEP * cell.speed;
    }
    let newest = 999;
    let oldest = -1;
    const fall = reduced ? FALL * 1.6 : FALL;
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
    cell.ct = newest < 60 ? 0.55 * Math.pow(1 - newest / 60, 1.5) : 0;
    cell.cb = oldest > 0 ? 0.72 * Math.pow(oldest / 180, 1.3) : 0;
    cell.ck = 0.25 + 0.75 * Math.max(0, oldest) / 180;
    return cell.started !== cell.target || cell.flaps.some((f) => f.busy);
  }

  const upper = [];
  const lower = [];

  function put(i, cell, kind, glyph, b0, b1, b2, b3, tone) {
    const o = i * STRIDE;
    const bg = tones.bg[tone];
    const ink = tones.ink[tone];
    data[o] = cell.x;
    data[o + 1] = cell.y;
    data[o + 2] = kind;
    data[o + 3] = glyph;
    data[o + 4] = b0;
    data[o + 5] = b1;
    data[o + 6] = b2;
    data[o + 7] = b3;
    data[o + 8] = bg[0];
    data[o + 9] = bg[1];
    data[o + 10] = bg[2];
    data[o + 11] = ((cell.seed % 997) / 997) * 0.5 + (tone / TONES) * 0.5;
    data[o + 12] = ink[0];
    data[o + 13] = ink[1];
    data[o + 14] = ink[2];
    data[o + 15] = 0;
  }

  function render() {
    if (!renderer || !atlasReady) return;
    let n = 0;
    upper.length = 0;
    lower.length = 0;
    for (const cell of cells) {
      put(n++, cell, 0, 0, 0, 0, 0, 0, 0);
      put(n++, cell, 1, cell.started, 0, 0, cell.ct, 0, toneTop(cell, cell.started));
      put(n++, cell, 2, cell.shown, 0, 0, cell.cb, cell.ck, toneBot(cell, cell.shown));
      for (const flap of cell.flaps) {
        if (!flap.busy) continue;
        if (flap.theta < 90) upper.push([cell, flap]);
        else lower.push([cell, flap]);
      }
    }
    upper.sort((a, b) => a[1].theta - b[1].theta);
    lower.sort((a, b) => b[1].theta - a[1].theta);
    for (const [cell, flap] of upper) {
      const k = flap.theta / 90;
      put(n++, cell, 3, flap.from, flap.theta, 0.62 * k * k, 0, 0.09 * Math.sin(k * Math.PI), toneTop(cell, flap.from));
    }
    for (const [cell, flap] of lower) {
      const k = (180 - flap.theta) / 90;
      put(n++, cell, 4, flap.to, flap.theta, 0.7 * Math.pow(k, 1.4), 0, 0, toneBot(cell, flap.to));
    }
    renderer.draw(data, n);
    dirty = false;
  }

  const springSlot = { y: 0, v: 0, on: false, shown: 0 };

  function slotY(k) {
    const g = layout;
    return g.padY + k * (g.h + g.rg) - g.rg / 2;
  }

  function dragAnimating() {
    if (!layout) return false;
    if (drag) return true;
    return springSlot.shown > 0.002;
  }

  function updateSlot(dt) {
    const g = layout;
    if (!g) return;
    const target = drag ? slotY(drag.slot) : springSlot.y;
    if (drag && !springSlot.on) {
      springSlot.on = true;
      springSlot.y = target;
      springSlot.v = 0;
    }
    const k = 1 - Math.exp(-dt / 55);
    springSlot.y += (target - springSlot.y) * k;
    const want = drag ? 1 : 0;
    springSlot.shown += (want - springSlot.shown) * (1 - Math.exp(-dt / 70));
    if (!drag && springSlot.shown < 0.002) {
      springSlot.shown = 0;
      springSlot.on = false;
    }
    slot.style.transform = `translate3d(0, ${springSlot.y.toFixed(2)}px, 0)`;
    slot.style.opacity = springSlot.shown.toFixed(3);
  }

  function frame(ts) {
    raf = 0;
    if (destroyed) return;
    const dt = last == null ? 16.7 : Math.min(64, Math.max(0, ts - last));
    last = ts;
    clock += dt;
    counts.fill(0);
    if (atlasReady) {
      for (const cell of active) if (!step(cell)) active.delete(cell);
      if (active.size) dirty = true;
    }
    for (let b = 0; b < BUCKETS; b += 1) if (counts[b] > 0) dirty = true;
    if (audio) audio.play(counts);
    updateSlot(dt);
    if (dirty) render();
    if (visible && !document.hidden && ((atlasReady && active.size) || dragAnimating())) raf = requestAnimationFrame(frame);
    else last = null;
  }

  function kick() {
    if (raf || destroyed || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function placeMark() {
    if (!layout) return;
    const g = layout;
    let r = -1;
    let mode = "";
    if (drag) {
      r = drag.from;
      mode = "drag";
    } else if (editing >= 0) {
      r = editing;
      mode = "edit";
    } else if (keyboardFocus) {
      r = focusRow;
      mode = "focus";
    }
    if (r < 0) {
      mark.dataset.mode = "";
      return;
    }
    const pad = Math.max(3, Math.round(g.rg * 0.45));
    mark.dataset.mode = mode;
    mark.style.left = `${g.padX - pad}px`;
    mark.style.top = `${g.padY + r * (g.h + g.rg) - pad}px`;
    mark.style.width = `${g.rowW + pad * 2}px`;
    mark.style.height = `${g.h + pad * 2}px`;
  }

  function placeCaret() {
    if (editing < 0 || !layout) {
      caret.dataset.on = "";
      return;
    }
    const g = layout;
    const group = g.groups.find((x) => x.key === "title");
    const a = Math.min(input.selectionStart ?? 0, g.variant.title - 1);
    const b = Math.max(a + 1, Math.min(input.selectionEnd ?? a, g.variant.title));
    const span = input.selectionEnd > input.selectionStart ? b - a : 1;
    caret.dataset.on = "true";
    caret.dataset.range = span > 1 ? "true" : "";
    const x = g.padX + group.x + a * (g.w + g.cg);
    caret.style.left = `${x}px`;
    caret.style.top = `${g.padY + editing * (g.h + g.rg) + g.h + Math.max(2, Math.round(g.rg * 0.3))}px`;
    caret.style.width = `${span * g.w + (span - 1) * g.cg}px`;
    caret.dataset.tick = caret.dataset.tick === "a" ? "b" : "a";
  }

  function announce(text) {
    onLive(text);
  }

  function play(r) {
    if (r <= 0 || r >= layout.rows) return;
    const id = set.rows[r];
    set = playRow(set, r);
    focusRow = 0;
    apply(1);
    lampState();
    placeMark();
    announce(`Now playing: ${titleOf(set, id)}.`);
  }

  function beginEdit(r, seed) {
    if (!layout || !layout.groups.some((x) => x.key === "title")) return;
    editing = r;
    focusRow = r;
    editOriginal = titleOf(set, set.rows[r]);
    const g = layout;
    const group = g.groups.find((x) => x.key === "title");
    input.maxLength = g.variant.title;
    input.style.left = `${g.padX + group.x}px`;
    input.style.top = `${g.padY + r * (g.h + g.rg)}px`;
    input.style.width = `${group.n * g.w + (group.n - 1) * g.cg}px`;
    input.style.height = `${g.h}px`;
    input.value = seed != null ? seed : editOriginal.slice(0, g.variant.title);
    input.tabIndex = 0;
    board.dataset.editing = "true";
    input.focus({ preventScroll: true });
    if (seed != null) {
      input.setSelectionRange(input.value.length, input.value.length);
      commitText(input.value);
    } else input.select();
    placeMark();
    placeCaret();
    announce(`Renaming ${editOriginal}. Type a new title, Enter to keep it, Escape to undo.`);
  }

  function commitText(value) {
    const clean = cleanTitle(value, layout.variant.title);
    if (clean !== input.value) {
      const at = Math.min(clean.length, input.selectionStart ?? clean.length);
      input.value = clean;
      input.setSelectionRange(at, at);
    }
    set = renameRow(set, editing, clean);
    apply(0);
  }

  function endEdit(revert) {
    if (editing < 0) return;
    const r = editing;
    if (revert) {
      set = renameRow(set, r, editOriginal);
      apply(0);
    } else if (!input.value.trim()) {
      set = renameRow(set, r, editOriginal);
      apply(0);
    }
    editing = -1;
    input.tabIndex = -1;
    delete board.dataset.editing;
    placeMark();
    placeCaret();
    announce(revert ? "Title restored." : `Renamed to ${titleOf(set, set.rows[r])}.`);
    if (document.activeElement === input) board.focus({ preventScroll: true });
  }

  input.addEventListener("input", () => {
    if (editing < 0) return;
    commitText(input.value);
    placeCaret();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      endEdit(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      endEdit(true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      endEdit(false);
    }
    event.stopPropagation();
  });
  input.addEventListener("keyup", placeCaret);
  input.addEventListener("select", placeCaret);
  input.addEventListener("pointerup", placeCaret);
  input.addEventListener("blur", () => endEdit(false));
  const onSelection = () => {
    if (editing >= 0 && document.activeElement === input) placeCaret();
  };
  document.addEventListener("selectionchange", onSelection);

  function rowAt(clientY) {
    const rect = win.getBoundingClientRect();
    const g = layout;
    const y = clientY - rect.top - g.padY + g.rg / 2;
    return Math.max(0, Math.min(g.rows - 1, Math.floor(y / (g.h + g.rg))));
  }

  function slotAt(clientY) {
    const rect = win.getBoundingClientRect();
    const g = layout;
    const y = clientY - rect.top - g.padY + g.rg / 2;
    return Math.max(0, Math.min(g.rows, Math.round(y / (g.h + g.rg))));
  }

  function insideRows(event) {
    const rect = win.getBoundingClientRect();
    const g = layout;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return x >= g.padX * 0.5 && x <= g.winW - g.padX * 0.5 && y >= g.padY * 0.5 && y <= g.winH - g.padY * 0.5;
  }

  let longPress = 0;

  function startDrag() {
    if (!press) return;
    drag = { from: press.row, slot: press.row, pointerId: press.pointerId };
    clearTimeout(longPress);
    try {
      win.setPointerCapture(press.pointerId);
    } catch {}
    board.dataset.dragging = "true";
    lampState();
    placeMark();
    kick();
  }

  const onDown = (event) => {
    if (!layout || event.button > 0) return;
    if (event.target === input) return;
    if (!insideRows(event)) return;
    keyboardFocus = false;
    board.dataset.pointer = "true";
    const r = rowAt(event.clientY);
    if (editing >= 0 && r === editing) return;
    if (editing >= 0) endEdit(false);
    focusRow = r;
    press = { row: r, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch: event.pointerType !== "mouse" };
    if (press.touch) longPress = setTimeout(startDrag, 320);
    else {
      event.preventDefault();
      board.focus({ preventScroll: true });
    }
  };

  const onMove = (event) => {
    if (!layout) return;
    if (drag && event.pointerId === drag.pointerId) {
      event.preventDefault();
      drag.slot = slotAt(event.clientY);
      kick();
      return;
    }
    if (press && event.pointerId === press.pointerId) {
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (press.touch) {
        if (Math.hypot(dx, dy) > 9) {
          clearTimeout(longPress);
          press = null;
        }
      } else if (Math.abs(dy) > 5) {
        startDrag();
        drag.slot = slotAt(event.clientY);
      }
      return;
    }
    if (event.pointerType === "mouse") {
      const r = insideRows(event) ? rowAt(event.clientY) : -1;
      if (r !== hoverRow) {
        hoverRow = r;
        board.dataset.hover = r > 0 ? "row" : r === 0 ? "now" : "";
        lampState();
      }
    }
  };

  const onUp = (event) => {
    clearTimeout(longPress);
    if (drag && event.pointerId === drag.pointerId) {
      const from = drag.from;
      const to = drag.slot > from ? drag.slot - 1 : drag.slot;
      drag = null;
      press = null;
      delete board.dataset.dragging;
      if (to !== from) {
        const id = set.rows[from];
        set = moveRow(set, from, to);
        focusRow = set.rows.indexOf(id);
        apply(1);
        announce(`Moved ${titleOf(set, id)} to position ${focusRow + 1}.`);
      }
      lampState();
      placeMark();
      kick();
      return;
    }
    if (!press || event.pointerId !== press.pointerId) return;
    const r = press.row;
    press = null;
    if (event.type === "pointercancel") return;
    if (r === 0) beginEdit(0);
    else play(r);
  };

  const onLeave = () => {
    if (hoverRow !== -1) {
      hoverRow = -1;
      board.dataset.hover = "";
      lampState();
    }
  };

  win.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  win.addEventListener("pointerleave", onLeave);

  board.tabIndex = 0;
  board.setAttribute("role", "application");
  board.setAttribute(
    "aria-label",
    "Departure board with tonight's setlist. Arrow keys choose a track, Enter puts it on, Alt with an arrow moves it, and typing renames it.",
  );

  const onKey = (event) => {
    if (!layout || event.target === input) return;
    delete board.dataset.pointer;
    const rows = layout.rows;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      keyboardFocus = true;
      const dir = event.key === "ArrowDown" ? 1 : -1;
      if (event.altKey) {
        const to = Math.max(0, Math.min(rows - 1, focusRow + dir));
        if (to !== focusRow) {
          const id = set.rows[focusRow];
          set = moveRow(set, focusRow, to);
          focusRow = set.rows.indexOf(id);
          apply(1);
          lampState();
          announce(`Moved ${titleOf(set, id)} to position ${focusRow + 1}.`);
        }
      } else focusRow = Math.max(0, Math.min(rows - 1, focusRow + dir));
      placeMark();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      keyboardFocus = true;
      if (focusRow === 0) beginEdit(0);
      else play(focusRow);
      placeMark();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && DRUM_INDEX.has(event.key)) {
      event.preventDefault();
      beginEdit(focusRow, event.key);
    }
  };
  board.addEventListener("keydown", onKey);
  board.addEventListener("focus", () => {
    placeMark();
  });
  board.addEventListener("blur", () => {
    if (keyboardFocus && editing < 0) {
      keyboardFocus = false;
      placeMark();
    }
  });

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
    const capH = caption ? caption.offsetHeight + (W < 700 ? 16 : 24) : 0;
    if (W === laidW && H === laidH && capH === laidCap) return;
    laidW = W;
    laidH = H;
    laidCap = capH;
    const side = embedded ? (W < 600 ? 12 : 20) : W < 700 ? 16 : 48;
    const top = embedded ? side : 72 + capH;
    const bottom = embedded ? side : W < 700 ? 24 : 40;
    const availW = W - side * 2;
    const availH = H - top - bottom;
    const next = fitLayout(availW, availH, 8);
    const changed =
      !layout ||
      next.w !== layout.w ||
      next.rows !== layout.rows ||
      next.variant !== layout.variant;
    if (changed) {
      if (editing >= 0) {
        editing = -1;
        input.tabIndex = -1;
        delete board.dataset.editing;
        input.blur();
      }
      layout = next;
      build();
      if (revealed) settleAll();
      focusRow = Math.min(focusRow, layout.rows - 1);
    }
    const left = Math.round((W - layout.boardW) / 2);
    const freeH = availH - layout.boardH;
    const y = Math.round(top + Math.max(0, freeH) * (embedded ? 0.5 : 0.42));
    board.style.left = `${left}px`;
    board.style.top = `${y}px`;
    stage.style.setProperty("--split-flap-board-x", `${left}px`);
    stage.style.setProperty("--split-flap-board-y", `${y}px`);
    stage.style.setProperty("--split-flap-board-w", `${layout.boardW}px`);
  }

  const ro = new ResizeObserver(() => {
    if (!layoutRaf) layoutRaf = requestAnimationFrame(relayout);
  });
  ro.observe(stage);
  if (caption) ro.observe(caption);
  relayout();

  function reveal() {
    if (revealed || !layout || !atlasReady) return;
    revealed = true;
    if (reduced) {
      settleAll();
      return;
    }
    for (const [cell, ch] of targets()) {
      const col = cell.col;
      const jitter = (hash(cell.seed, 5) % 1000) / 1000;
      cell.target = ch;
      cell.started = 0;
      cell.shown = 0;
      cell.nextAt = clock + 260 + cell.row * 46 + col * 9 + jitter * 50;
      if (ch !== 0) active.add(cell);
    }
    kick();
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        reveal();
        kick();
      }
    },
    { threshold: 0.2 },
  );
  io.observe(board);

  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onReduced = () => {
    reduced = reducedQuery.matches;
  };
  reducedQuery.addEventListener("change", onReduced);

  return {
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
      clearTimeout(longPress);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("selectionchange", onSelection);
      reducedQuery.removeEventListener("change", onReduced);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      audio?.destroy();
      renderer?.destroy();
      board.remove();
    },
  };
}
