import { ALBUMS } from "@/app/lab/_music/catalog";

import { createTeletextSound } from "./teletextAudio";
import { CELL_H, CELL_W, glyphBits } from "./teletextFont";
import { createTeletextGL } from "./teletextGL";
import { C, PAGE_INDEX, PALETTE, SERVICE, albumPage, blankPage, buildAlbum, buildIndex, decodePage, mosaicFromImage, pageAlbum, row } from "./teletextPages";

const SRC_W = 40 * CELL_W;
const SRC_H = 25 * CELL_H;
const ROLL_STEP = 0.05;
const ROW_STEP = 0.026;
const SUB_SECONDS = 14;
const IDLE_SECONDS = 7;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOUR = ["abbey-road", "revolver", "rubber-soul", "let-it-be", "sgt-pepper", "help", "a-hard-days-night", "magical-mystery-tour", "white-album", "please-please-me", "with-the-beatles", "beatles-for-sale"].map((id) => ALBUMS.findIndex((a) => a.id === id));

const RGBA = PALETTE.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);

export function createTeletext(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "teletext-screen";
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Teletext. Type a three digit page number, or tap a record.");
  if (embedded) root.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "teletext-canvas";
  root.append(canvas);
  stage.append(root);
  const input = document.createElement("input");
  input.className = "teletext-input";
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Page number");
  stage.append(input);

  const gl = createTeletextGL(canvas);
  if (!gl) {
    input.remove();
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const src = document.createElement("canvas");
  src.width = SRC_W;
  src.height = SRC_H;
  const sx = src.getContext("2d");
  const image = sx.createImageData(SRC_W, SRC_H);
  const pix = new Uint32Array(image.data.buffer);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let sound = null;
  let shown = blankPage();
  let pageNum = PAGE_INDEX;
  let sub = 1;
  let links = [];
  let typed = "";
  let search = null;
  let arrival = null;
  let rollNum = PAGE_INDEX;
  let rollIdx = 0;
  let sinceArrive = 0;
  let idle = 0;
  let tourIdx = 0;
  let autoTyping = null;
  let userHold = 0;
  let clockKey = "";
  let flashOn = true;
  let dirty = true;
  let fade = reduced ? 1 : 0;
  let clock = 0;
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let box = [0, 0, 1, 1];

  const images = new Map();
  const mosaics = new Map();

  const loadCover = (i) => {
    const a = ALBUMS[i];
    if (images.has(a.id)) return images.get(a.id);
    const entry = { img: new Image(), ready: false };
    entry.img.decoding = "async";
    entry.img.onload = () => {
      entry.ready = true;
      if (pageAlbum(pageNum) === i && !search) refreshImage();
    };
    entry.img.src = a.cover;
    images.set(a.id, entry);
    return entry;
  };

  const mosaicFor = (i) => {
    const a = ALBUMS[i];
    if (mosaics.has(a.id)) return mosaics.get(a.id);
    const entry = loadCover(i);
    if (!entry.ready) return null;
    const m = mosaicFromImage(entry.img);
    mosaics.set(a.id, m);
    return m;
  };

  const buildPage = (n, s) => {
    if (n === PAGE_INDEX) return buildIndex();
    const ai = pageAlbum(n);
    if (ai < 0) return null;
    return buildAlbum(ai, s, mosaicFor(ai));
  };

  const startArrival = (n, s, quiet) => {
    const built = buildPage(n, s);
    if (!built) return;
    arrival = { rows: built.rows, links: built.links, next: 1, t: 0, page: n, sub: s };
    if (!quiet) sound?.arrive(24, ROW_STEP);
    dirty = true;
  };

  function refreshImage() {
    const ai = pageAlbum(pageNum);
    if (ai < 0 || arrival) return;
    const built = buildPage(pageNum, sub);
    if (!built) return;
    for (let r = 4; r <= 16; r += 1) shown[r] = built.rows[r];
    links = built.links;
    dirty = true;
    wake();
  }

  const request = (n, viaUser) => {
    pageNum = pageNum || PAGE_INDEX;
    typed = String(n);
    search = { target: n, t: 0 };
    arrival = null;
    if (viaUser) {
      userHold = 18;
      autoTyping = null;
    }
    const ai = pageAlbum(n);
    if (ai >= 0) loadCover(ai);
    rollIdx = Math.max(0, SERVICE.indexOf(pageNum));
    sound?.searching(true);
    dirty = true;
    wake();
  };

  const typeDigit = (d, viaUser) => {
    if (viaUser) {
      userHold = 18;
      autoTyping = null;
    }
    if (typed.length >= 3 || search) {
      typed = "";
      search = null;
      sound?.searching(false);
    }
    if (typed.length === 0 && (d === "0" || d === "9")) return;
    typed += d;
    sound?.key();
    dirty = true;
    if (typed.length === 3) request(Number(typed), viaUser);
    wake();
  };

  const setSub = (s) => {
    if (pageAlbum(pageNum) < 0 || search) return;
    sub = s;
    sinceArrive = 0;
    startArrival(pageNum, s, false);
  };

  const headerRow = () => {
    const d = new Date(Date.now());
    const date = `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}/${String(d.getSeconds()).padStart(2, "0")}`;
    const shownNum = search ? String(rollNum) : String(pageNum);
    const pfield = `P${typed ? typed : String(pageNum)}`.padEnd(8);
    if (search) return row(pfield, "HERB.ART", C.green, shownNum, C.white, date, C.yellow, time);
    return row(pfield, "HERB.ART ", shownNum, " ", date, C.yellow, time);
  };

  const sextant = (code) => {
    const v = code - 0x20;
    return [v & 1, v & 2, v & 4, v & 8, v & 16, v & 64].map(Boolean);
  };

  const paintCell = (r, c, cell) => {
    const x0 = c * CELL_W;
    const y0 = r * CELL_H;
    const bg = RGBA[cell.bg];
    const fg = RGBA[cell.fg];
    const hidden = cell.flash && !flashOn;
    const showFg = !hidden && cell.code !== 0x20;
    let bits = null;
    let blocks = null;
    if (showFg && cell.mosaic) blocks = sextant(cell.code);
    else if (showFg) bits = glyphBits(String.fromCharCode(cell.code));
    for (let y = 0; y < CELL_H; y += 1) {
      const rowBase = (y0 + y) * SRC_W + x0;
      let sy = y;
      if (cell.half === 1) sy = Math.floor(y / 2);
      else if (cell.half === 2) sy = 10 + Math.floor(y / 2);
      for (let x = 0; x < CELL_W; x += 1) {
        let on = false;
        if (bits) on = bits[sy * CELL_W + x] === 1;
        else if (blocks) {
          const bx = x < 6 ? 0 : 1;
          const by = sy < 6 ? 0 : sy < 14 ? 1 : 2;
          on = blocks[by * 2 + bx];
          if (on && cell.sep) {
            const lx = x - bx * 6;
            const top = by === 0 ? 0 : by === 1 ? 6 : 14;
            const hgt = by === 1 ? 8 : 6;
            const ly = sy - top;
            if (lx < 2 || ly >= hgt - 2) on = false;
          }
        }
        pix[rowBase + x] = on ? fg : bg;
      }
    }
  };

  const paint = () => {
    const rows = shown.slice();
    rows[0] = headerRow();
    const cells = decodePage(rows);
    for (let r = 0; r < 25; r += 1) for (let c = 0; c < 40; c += 1) paintCell(r, c, cells[r][c]);
    sx.putImageData(image, 0, 0);
  };

  const pickTour = () => {
    const ai = TOUR[tourIdx % TOUR.length];
    tourIdx += 1;
    return tourIdx % 5 === 0 ? PAGE_INDEX : albumPage(ai);
  };

  const update = (dt) => {
    clock += dt;
    if (fade < 1) fade = Math.min(1, fade + dt / 0.5);
    const fo = clock % 1 < 0.75;
    if (fo !== flashOn) {
      flashOn = fo;
      dirty = true;
    }
    const d = new Date(Date.now());
    const ck = `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
    if (ck !== clockKey) {
      clockKey = ck;
      dirty = true;
    }
    if (userHold > 0) userHold -= dt;
    if (search) {
      search.t += dt;
      while (search && search.t >= ROLL_STEP) {
        search.t -= ROLL_STEP;
        rollIdx = (rollIdx + 1) % SERVICE.length;
        rollNum = SERVICE[rollIdx];
        dirty = true;
        if (rollNum === search.target) {
          pageNum = search.target;
          sub = 1;
          search = null;
          typed = "";
          sinceArrive = 0;
          startArrival(pageNum, 1, false);
          const ai = pageAlbum(pageNum);
          onLive(ai >= 0 ? `Page ${pageNum}: ${ALBUMS[ai].title}, ${ALBUMS[ai].year}` : `Page ${pageNum}: index`);
        }
      }
    }
    if (arrival) {
      arrival.t += dt;
      while (arrival && arrival.t >= ROW_STEP) {
        arrival.t -= ROW_STEP;
        shown[arrival.next] = arrival.rows[arrival.next];
        arrival.next += 1;
        dirty = true;
        if (arrival.next >= 25) {
          links = arrival.links;
          arrival = null;
          idle = 0;
        }
      }
    }
    if (!search && !arrival) {
      sinceArrive += dt;
      idle += dt;
      if (pageAlbum(pageNum) >= 0 && sinceArrive >= SUB_SECONDS) {
        sub = sub === 1 ? 2 : 1;
        sinceArrive = 0;
        startArrival(pageNum, sub, true);
      }
      if (!autoTyping && userHold <= 0 && idle >= IDLE_SECONDS) {
        autoTyping = { digits: String(pickTour()), t: -0.2 };
        typed = "";
      }
    }
    if (autoTyping) {
      autoTyping.t += dt;
      if (autoTyping.t >= 0.32) {
        autoTyping.t -= 0.32;
        const dgt = autoTyping.digits[typed.length];
        const done = typed.length + 1 >= 3;
        if (done) autoTyping = null;
        if (dgt) typeDigit(dgt, false);
      }
    }
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    update(dt);
    const upload = dirty;
    if (dirty) {
      paint();
      dirty = false;
    }
    gl.render({ image: src, upload, box, time: clock, fade: fade * fade * (3 - 2 * fade) });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = narrow ? 8 : 32;
    const bottom = narrow ? 24 : 56;
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 24) : side;
    const availW = sr.width - side * 2;
    const availH = Math.max(160, sr.height - top - bottom);
    let bw = availW;
    let bh = bw * (narrow ? 1 : 0.75);
    if (bh > availH) {
      bh = availH;
      bw = bh / 0.75;
    }
    const bx = (sr.width - bw) / 2;
    const by = top + Math.max(0, (availH - bh) * 0.35);
    W = sr.width;
    H = sr.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    root.style.width = `${W}px`;
    root.style.height = `${H}px`;
    gl.resize(Math.round(W * dpr), Math.round(H * dpr));
    box = [bx * dpr, by * dpr, bw * dpr, bh * dpr];
    if (caption) {
      caption.style.left = `${Math.max(16, bx)}px`;
      caption.style.width = `${Math.min(W - 32, bw)}px`;
    }
  };

  const cellAt = (e) => {
    const r = root.getBoundingClientRect();
    const x = ((e.clientX - r.left) * dpr - box[0]) / box[2];
    const y = ((e.clientY - r.top) * dpr - box[1]) / box[3];
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { col: Math.floor(x * 40), row: Math.floor(y * 25) };
  };

  const linkAt = (e) => {
    const c = cellAt(e);
    if (!c || arrival || search) return null;
    return links.find((l) => l.row === c.row && c.col >= l.c0 && c.col <= l.c1) || null;
  };

  const onMove = (e) => {
    if (e.pointerType !== "mouse") return;
    root.style.cursor = linkAt(e) ? "pointer" : "";
  };

  const follow = (l) => {
    userHold = 18;
    autoTyping = null;
    if (l.sub && l.page === pageNum) {
      sound?.key();
      setSub(l.sub);
      return;
    }
    sound?.key();
    request(l.page, true);
  };

  let press = null;
  const onDown = (e) => {
    if (e.button > 0) return;
    press = { x: e.clientX, y: e.clientY, link: linkAt(e) };
  };

  const onUp = (e) => {
    const p = press;
    press = null;
    if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
    const cell = cellAt(e);
    if (cell && cell.row === 0 && e.pointerType !== "mouse") {
      input.value = "";
      input.focus({ preventScroll: true });
      return;
    }
    const l = linkAt(e);
    if (l && p.link && l.page === p.link.page && l.sub === p.link.sub) follow(l);
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== root && t !== document.body && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable)) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      typeDigit(k, true);
      return;
    }
    const ai = pageAlbum(pageNum);
    if (k === "ArrowRight" || k === "ArrowDown" || k === "+") {
      e.preventDefault();
      request(ai >= 0 ? albumPage((ai + 1) % ALBUMS.length) : albumPage(0), true);
      sound?.key();
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "-") {
      e.preventDefault();
      request(ai >= 0 ? (ai === 0 ? PAGE_INDEX : albumPage(ai - 1)) : albumPage(ALBUMS.length - 1), true);
      sound?.key();
    } else if (k === "Escape" || k === "Home") {
      e.preventDefault();
      request(PAGE_INDEX, true);
      sound?.key();
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      userHold = 18;
      setSub(sub === 1 ? 2 : 1);
      sound?.key();
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  const onInput = () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    input.value = "";
    for (const d of digits) typeDigit(d, true);
    if (typed.length >= 3 || search) input.blur();
  };
  input.addEventListener("input", onInput);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);
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
    else sleep();
  });
  io.observe(root);

  ALBUMS.forEach((_, i) => loadCover(i));
  layout(true);
  const first = buildIndex();
  if (reduced) {
    shown = first.rows.slice();
    links = first.links;
  } else {
    arrival = { rows: first.rows, links: first.links, next: 1, t: -0.35, page: PAGE_INDEX, sub: 1 };
  }
  ready = true;
  root.dataset.ready = "";
  wake();

  return {
    async setSound(on) {
      if (on && !sound) sound = createTeletextSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      input.removeEventListener("input", onInput);
      input.remove();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
