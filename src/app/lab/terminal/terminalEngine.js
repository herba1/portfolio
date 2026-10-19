import { ALBUMS } from "@/app/lab/_music/catalog";

import { createTerminalSound } from "./terminalAudio";
import { createGL } from "./terminalGL";

const FONT = "TerminalVT";
const GREEN = "rgb(96, 250, 142)";
const BRIGHT = "rgb(206, 255, 222)";
const INK = "rgb(0, 0, 0)";
const CELL = 3;
const BLINK = 530;
const START = ALBUMS.findIndex((a) => a.id === "abbey-road");

function lower(text) {
  return text.toLowerCase();
}

function atkinson(img, n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high";
  x.drawImage(img, 0, 0, n, n);
  const src = x.getImageData(0, 0, n, n).data;
  const base = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) base[i] = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255;
  const lum = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let xx = 0; xx < n; xx += 1) {
      const i = y * n + xx;
      let blur = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const yy = y + dy;
          const xk = xx + dx;
          if (yy < 0 || yy >= n || xk < 0 || xk >= n) continue;
          blur += base[yy * n + xk];
          count += 1;
        }
      }
      const sharp = base[i] + (base[i] - blur / count) * 0.9;
      lum[i] = 0.8 * Math.pow(Math.min(1, Math.max(0, (sharp - 0.5) * 1.3 + 0.5)), 1.45);
    }
  }
  const on = new Uint8Array(n * n);
  const spread = (i, e) => {
    if (i >= 0 && i < n * n) lum[i] += e;
  };
  for (let y = 0; y < n; y += 1) {
    for (let xx = 0; xx < n; xx += 1) {
      const i = y * n + xx;
      const v = lum[i] > 0.5 ? 1 : 0;
      on[i] = v;
      const e = (lum[i] - v) / 8;
      if (xx + 1 < n) spread(i + 1, e);
      if (xx + 2 < n) spread(i + 2, e);
      if (y + 1 < n) {
        if (xx > 0) spread(i + n - 1, e);
        spread(i + n, e);
        if (xx + 1 < n) spread(i + n + 1, e);
      }
      if (y + 2 < n) spread(i + n * 2, e);
    }
  }
  const paint = (rgb) => {
    const out = document.createElement("canvas");
    out.width = n;
    out.height = n;
    const o = out.getContext("2d");
    const im = o.createImageData(n, n);
    for (let i = 0; i < n * n; i += 1) {
      if (!on[i]) continue;
      im.data[i * 4] = rgb[0];
      im.data[i * 4 + 1] = rgb[1];
      im.data[i * 4 + 2] = rgb[2];
      im.data[i * 4 + 3] = 255;
    }
    o.putImageData(im, 0, 0);
    return out;
  };
  return { normal: paint([78, 222, 124]), bright: paint([214, 255, 228]) };
}

export function createTerminal(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "terminal-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Record menu. Use the arrow keys to choose a record and Enter to open it.");
  const canvas = document.createElement("canvas");
  canvas.className = "terminal-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const scene = document.createElement("canvas");
  const sx = scene.getContext("2d");
  const touchy = window.matchMedia("(hover: none)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sound = null;

  let W = 0;
  let H = 0;
  let scale = 1;
  let fontPx = 24;
  let cellW = 10;
  let lineH = 26;
  let padX = 24;
  let padY = 24;
  let cols = 60;
  let curve = 0.045;

  let mode = "menu";
  let sel = START;
  let album = START;
  let hover = null;
  let lines = [];
  let queue = [];
  let printIdx = 0;
  let printWait = 0;
  let printing = false;
  let promptLine = null;
  let cursorLine = null;
  let cover = null;
  let ready = false;
  let power = reduced ? 1 : 0;
  let powerClock = -0.12;
  let blink = 0;
  let dirty = true;
  let raf = 0;
  let last = 0;
  let lastActive = 0;
  let wakeTimer = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let wheelAcc = 0;
  let press = null;

  const images = new Map();
  const dithers = new Map();

  const loadCover = (index) => {
    const a = ALBUMS[index];
    if (images.has(a.id)) return images.get(a.id);
    const entry = { img: new Image(), ready: false };
    entry.img.decoding = "async";
    entry.img.onload = () => {
      entry.ready = true;
      if (mode === "album" && ALBUMS[album].id === a.id) wake();
    };
    entry.img.src = a.cover;
    images.set(a.id, entry);
    return entry;
  };

  const ditherFor = (index, n) => {
    const a = ALBUMS[index];
    const key = `${a.id}:${n}`;
    if (dithers.has(key)) return dithers.get(key);
    const entry = loadCover(index);
    if (!entry.ready) return null;
    const d = atkinson(entry.img, n);
    dithers.set(key, d);
    return d;
  };

  const setLine = (props) => {
    const line = { shown: 0, mode: "type", bright: false, ...props };
    lines.push(line);
    return line;
  };

  const enqueue = (line) => {
    queue.push(line);
    printing = true;
  };

  const menuRowText = (i, contentCols) => {
    const a = ALBUMS[i];
    const num = String(i + 1).padStart(2, "0");
    const withYear = contentCols >= 46;
    const room = contentCols - 4 - (withYear ? 6 : 0);
    let title = lower(a.title);
    if (title.length > room) title = `${title.slice(0, room - 2).trimEnd()}..`;
    return withYear ? `${num}  ${title.padEnd(room)}  ${a.year}` : `${num}  ${title}`;
  };

  const promptText = () => `> ${lower(ALBUMS[sel].title)}`;

  const buildMenu = (instant) => {
    lines = [];
    queue = [];
    printIdx = 0;
    printWait = instant ? 0 : 120;
    cover = null;
    const contentCols = Math.min(cols, 56);
    const x0 = Math.round(padX + Math.max(0, (W - padX * 2 - contentCols * cellW) / 2));
    const blockH = lineH * (4 + ALBUMS.length);
    const top = Math.round(padY + Math.max(0, (H - padY * 2 - blockH) * 0.42));
    const header = setLine({ x: x0, y: top, text: "shall we play a record?", bright: true });
    enqueue(header);
    const hx = Math.round(x0 - cellW * 0.6);
    const hw = Math.round(contentCols * cellW + cellW * 1.2);
    ALBUMS.forEach((_, i) => {
      enqueue(setLine({ x: x0, y: top + lineH * (2 + i), text: menuRowText(i, contentCols), mode: "dump", menu: i, hit: { x: hx, y: top + lineH * (2 + i), w: hw, h: lineH } }));
    });
    promptLine = setLine({ x: x0, y: top + lineH * (3 + ALBUMS.length), text: promptText(), mode: "type" });
    promptLine.shown = 2;
    enqueue(promptLine);
    cursorLine = promptLine;
    if (instant) finishPrinting();
  };

  const buildAlbum = (instant) => {
    lines = [];
    queue = [];
    printIdx = 0;
    printWait = instant ? 0 : 160;
    const a = ALBUMS[album];
    const x0 = padX;
    const y0 = padY;
    const rowsAvail = Math.floor((H - padY * 2) / lineH);
    const footerY = y0 + (rowsAvail - 1) * lineH;
    const landscape = W / H > 1.08 && cols >= 64;
    let size;
    let coverX = x0;
    const coverY = Math.ceil((y0 + lineH * 3) / CELL) * CELL;
    let trackX;
    let trackY;
    const n = a.tracks.length;
    if (landscape) {
      size = Math.min(footerY - lineH * 1.5 - coverY, (W - padX * 2) * 0.46);
      size = Math.floor(size / CELL) * CELL;
      trackX = Math.round(coverX + size + cellW * 4);
      trackY = coverY;
    } else {
      size = Math.min(W - padX * 2, footerY - coverY - lineH * (n + 2));
      size = Math.floor(size / CELL) * CELL;
      trackX = x0;
      trackY = coverY + size + lineH;
    }
    const titleRoom = Math.floor((W - padX - (landscape ? trackX : x0)) / cellW);
    enqueue(setLine({ x: x0, y: y0, text: lower(a.title).slice(0, cols), bright: true }));
    enqueue(setLine({ x: x0, y: y0 + lineH, text: `the beatles, ${a.year}` }));
    a.tracks.forEach((t, i) => {
      let title = lower(t);
      if (title.length + 4 > titleRoom) title = `${title.slice(0, titleRoom - 6).trimEnd()}..`;
      enqueue(setLine({ x: trackX, y: trackY + lineH * i, text: `${String(i + 1).padStart(2, "0")}  ${title}` }));
    });
    const lastTrack = lines[lines.length - 1];
    const segs = [
      ["back", "< records"],
      ["prev", "< prev"],
      ["next", "next >"],
    ];
    let col = 0;
    segs.forEach(([action, text]) => {
      const x = Math.round(x0 + col * cellW);
      enqueue(setLine({ x, y: footerY, text, mode: "dump", action, hit: { x: Math.round(x - cellW * 0.6), y: footerY, w: Math.round((text.length + 1.2) * cellW), h: lineH } }));
      col += text.length + 4;
    });
    cursorLine = lastTrack;
    promptLine = null;
    cover = { index: album, x: coverX, y: coverY, size, n: Math.round(size / CELL), reveal: instant || reduced ? 1 : 0, delay: instant ? 0 : 0.22 };
    loadCover(album);
    if (instant) finishPrinting();
  };

  const finishPrinting = () => {
    for (const l of queue) l.shown = l.text.length;
    printIdx = queue.length;
    printing = false;
    dirty = true;
  };

  const charDelay = (ch, fast) => {
    if (fast) return 13 + Math.random() * 10;
    let d = 15 + Math.random() * 26;
    if (ch === " ") d += Math.random() < 0.4 ? 34 : 6;
    if (",.?".includes(ch)) d += 80;
    return d;
  };

  const advancePrint = (ms) => {
    if (!printing || power < 0.92) return false;
    printWait -= ms;
    let guard = 0;
    while (printIdx < queue.length && printWait <= 0 && guard < 64) {
      guard += 1;
      const line = queue[printIdx];
      const len = line.text.length;
      if (line.mode === "dump") {
        line.shown = len;
        printIdx += 1;
        printWait += 34;
        sound?.key(true);
        dirty = true;
        continue;
      }
      if (line.shown < len) {
        const ch = line.text[line.shown];
        line.shown += 1;
        dirty = true;
        if (ch !== " ") sound?.key(line.mode === "fast");
        printWait += charDelay(ch, line.mode === "fast");
      }
      if (line.shown >= len) {
        printIdx += 1;
        printWait += line.mode === "fast" ? 0 : 80 + Math.random() * 70;
      }
    }
    if (printIdx >= queue.length) printing = false;
    return printing;
  };

  const retypePrompt = () => {
    if (!promptLine) return;
    promptLine.text = promptText();
    promptLine.mode = "fast";
    promptLine.shown = 2;
    if (queue[printIdx] !== promptLine && !queue.slice(printIdx).includes(promptLine)) {
      queue.push(promptLine);
      printing = true;
    }
    printWait = Math.min(printWait, 0);
    dirty = true;
  };

  const select = (i, viaPointer) => {
    const next = (i + ALBUMS.length) % ALBUMS.length;
    if (next === sel) return;
    sel = next;
    sound?.tick();
    retypePrompt();
    if (!viaPointer) onLive(lower(ALBUMS[sel].title));
    wake();
  };

  const open = (i) => {
    album = (i + ALBUMS.length) % ALBUMS.length;
    sel = album;
    mode = "album";
    hover = null;
    sound?.clunk();
    buildAlbum(false);
    const a = ALBUMS[album];
    onLive(`${a.title}, ${a.year}. ${a.tracks.join(", ")}.`);
    dirty = true;
    wake();
  };

  const back = () => {
    mode = "menu";
    hover = null;
    sound?.clunk();
    sound?.raster(false);
    buildMenu(false);
    printWait = 60;
    onLive("Records");
    dirty = true;
    wake();
  };

  const act = (action) => {
    if (action === "back") back();
    else if (action === "prev") open(album - 1);
    else if (action === "next") open(album + 1);
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 16 : 32;
    const bottom = narrow ? 56 : 64;
    let w = sr.width - side * 2;
    let left = side;
    if (caption) {
      caption.style.left = `${left}px`;
      caption.style.width = `${w}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 20) : side;
    const h = Math.max(240, sr.height - top - (caption ? bottom : side));
    if (w > h * 1.62) {
      w = Math.round(h * 1.62);
      left = Math.round((sr.width - w) / 2);
      if (caption) {
        caption.style.left = `${left}px`;
        caption.style.width = `${w}px`;
      }
    }
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    W = Math.round(w);
    H = Math.round(h);
    const maxScale = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(maxScale, Math.sqrt(4200000 / (W * H)));
    scene.width = Math.round(W * scale);
    scene.height = Math.round(H * scale);
    gl.resize(scene.width, scene.height);
    padX = Math.max(20, Math.round(W * 0.065));
    padY = Math.max(20, Math.round(H * 0.07));
    curve = W > H ? 0.05 : 0.035;
    sx.font = `100px ${FONT}`;
    const adv = sx.measureText("0").width / 100;
    fontPx = Math.round(Math.min(32, (W - padX * 2) / (46 * adv), (H - padY * 2) / (17.4 * 1.1)));
    fontPx = Math.max(14, fontPx);
    cellW = adv * fontPx;
    lineH = Math.round(fontPx * 1.1);
    cols = Math.floor((W - padX * 2) / cellW);
    if (mode === "menu") buildMenu(true);
    else buildAlbum(true);
    dirty = true;
    wake();
  };

  const draw = (now) => {
    sx.setTransform(scale, 0, 0, scale, 0, 0);
    sx.fillStyle = INK;
    sx.fillRect(0, 0, W, H);
    sx.font = `${fontPx}px ${FONT}`;
    sx.textBaseline = "middle";
    const mid = lineH / 2 + fontPx * 0.04;
    for (const line of lines) {
      if (!line.shown) continue;
      const text = line.text.slice(0, line.shown);
      const lit = (line.menu !== undefined && line.menu === sel && mode === "menu") || (line.action && line.action === hover);
      if (lit && line.hit) {
        sx.fillStyle = GREEN;
        sx.fillRect(line.hit.x, line.hit.y, line.hit.w, line.hit.h);
        sx.fillStyle = INK;
      } else {
        sx.fillStyle = line.bright ? BRIGHT : GREEN;
      }
      sx.fillText(text, line.x, line.y + mid);
    }
    if (cover) {
      const d = ditherFor(cover.index, cover.n);
      if (d) {
        const rows = Math.min(cover.n, Math.floor(cover.reveal * cover.n));
        sx.imageSmoothingEnabled = false;
        if (rows > 0) sx.drawImage(d.normal, 0, 0, cover.n, rows, cover.x, cover.y, cover.size, rows * CELL);
        if (rows < cover.n && cover.reveal > 0) {
          const r = Math.max(0, rows);
          sx.drawImage(d.bright, 0, r, cover.n, 1, cover.x, cover.y + r * CELL, cover.size, CELL);
          sx.fillStyle = "rgba(214, 255, 228, 0.5)";
          sx.fillRect(cover.x, cover.y + r * CELL + CELL * 0.33, cover.size, CELL * 0.34);
        }
        sx.imageSmoothingEnabled = true;
      }
    }
    let cur = null;
    if (printing && printIdx < queue.length) {
      const l = queue[printIdx];
      if (l.mode !== "dump") cur = { x: l.x + l.shown * cellW, y: l.y };
    } else if (cursorLine) {
      const on = Math.floor(now / BLINK) % 2 === 0;
      if (on) cur = { x: cursorLine.x + (cursorLine.text.length + (promptLine ? 0 : 1)) * cellW, y: cursorLine.y };
    }
    if (cur) {
      sx.fillStyle = GREEN;
      sx.fillRect(Math.round(cur.x + cellW * 0.08), Math.round(cur.y + lineH * 0.14), Math.round(cellW * 0.84), Math.round(lineH * 0.72));
    }
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
    const dt = Math.min(0.05, raw);
    last = now;
    let busy = false;
    if (power < 1) {
      powerClock += raw;
      power = Math.min(1, Math.max(0, powerClock / 0.76));
      busy = true;
    }
    if (advancePrint(raw * 1000)) busy = true;
    if (cover && cover.reveal < 1) {
      if (cover.delay > 0) {
        cover.delay -= raw;
        busy = true;
      } else if (ditherFor(cover.index, cover.n)) {
        if (cover.reveal === 0) sound?.raster(true);
        cover.reveal = Math.min(1, cover.reveal + raw / 1.3);
        if (cover.reveal >= 1) sound?.raster(false);
        dirty = true;
        busy = true;
      }
    }
    const b = Math.floor(now / BLINK);
    if (b !== blink) {
      blink = b;
      if (!printing) dirty = true;
    }
    const upload = dirty;
    if (dirty) {
      draw(now);
      dirty = false;
      lastActive = now;
    }
    const flicker = Math.random() * 0.014 + (Math.random() < 0.02 ? 0.03 : 0);
    gl.render({ source: scene, upload, decay: Math.exp(-raw / 0.05), time: now / 1000, power, flicker, curve, sceneW: W, sceneH: H });
    if (busy || now - lastActive < 320) {
      raf = requestAnimationFrame(frame);
    } else {
      clearTimeout(wakeTimer);
      wakeTimer = window.setTimeout(wake, BLINK - (now % BLINK) + 4);
    }
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    clearTimeout(wakeTimer);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const toScene = (e) => {
    const r = root.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = ((e.clientY - r.top) / r.height) * 2 - 1;
    const wx = cx * (1 + curve * cy * cy);
    const wy = cy * (1 + curve * cx * cx);
    return { x: ((wx + 1) / 2) * W, y: ((wy + 1) / 2) * H };
  };

  const hitAt = (p) => {
    for (const line of lines) {
      if (!line.hit || !line.shown) continue;
      const h = line.hit;
      if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return line;
    }
    return null;
  };

  const setHover = (action) => {
    if (action === hover) return;
    hover = action;
    if (action) sound?.tick();
    dirty = true;
    wake();
  };

  const onMove = (e) => {
    const hit = hitAt(toScene(e));
    root.style.cursor = hit ? "pointer" : "";
    if (press && e.pointerType !== "mouse") {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) press.moved = true;
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (mode === "menu") {
      if (hit && hit.menu !== undefined) select(hit.menu, true);
    } else {
      setHover(hit?.action ?? null);
    }
  };

  const onDown = (e) => {
    if (e.button > 0) return;
    const hit = hitAt(toScene(e));
    press = { x: e.clientX, y: e.clientY, hit, moved: false };
    if (e.pointerType !== "mouse" && hit) {
      if (hit.menu !== undefined) select(hit.menu, true);
      else if (hit.action) setHover(hit.action);
    }
  };

  const onUp = (e) => {
    const p = press;
    press = null;
    if (!p || p.moved) {
      if (e.pointerType !== "mouse") setHover(null);
      return;
    }
    const hit = hitAt(toScene(e));
    if (!hit || hit !== p.hit) {
      if (e.pointerType !== "mouse") setHover(null);
      return;
    }
    if (hit.menu !== undefined && mode === "menu") open(hit.menu);
    else if (hit.action) {
      act(hit.action);
      if (e.pointerType !== "mouse") setHover(null);
    }
  };

  const onLeave = () => {
    if (mode === "album") setHover(null);
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== root && t !== document.body && (t.closest?.("button, input, textarea, a") || t.isContentEditable)) return;
    const k = e.key;
    let handled = true;
    if (mode === "menu") {
      if (k === "ArrowDown" || k === "j") select(sel + 1);
      else if (k === "ArrowUp" || k === "k") select(sel - 1);
      else if (k === "Home") select(0);
      else if (k === "End") select(ALBUMS.length - 1);
      else if (k === "Enter" || k === " " || k === "ArrowRight") open(sel);
      else handled = false;
    } else if (k === "Escape" || k === "Backspace" || k === "Enter") back();
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "k") open(album - 1);
    else if (k === "ArrowRight" || k === "ArrowDown" || k === "j") open(album + 1);
    else handled = false;
    if (handled) {
      e.preventDefault();
    }
  };

  const onWheel = (e) => {
    if (mode !== "menu" || embedded) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    while (Math.abs(wheelAcc) >= 60) {
      select(sel + Math.sign(wheelAcc));
      wheelAcc -= Math.sign(wheelAcc) * 60;
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("pointerleave", onLeave);
  root.addEventListener("wheel", onWheel, { passive: false });
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);

  const boot = async () => {
    await Promise.race([document.fonts.load(`24px ${FONT}`).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    if (destroyed) return;
    ALBUMS.forEach((_, i) => loadCover(i));
    layout(true);
    buildMenu(false);
    ready = true;
    root.dataset.ready = "";
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !sound) sound = createTerminalSound();
      if (!sound) return false;
      const result = await sound.setEnabled(on);
      return result;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(wakeTimer);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("wheel", onWheel);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
