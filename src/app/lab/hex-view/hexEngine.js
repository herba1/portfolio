import { createKeys } from "./hexAudio";

const W = 32;
const H = 32;
const HEADER = 54;
const STRIDE = W * 3;
const SIZE = HEADER + STRIDE * H;
const ROW_H = 20;
const CHANNELS = ["blue", "green", "red"];
const FIELDS = [
  [0, 2, "signature"],
  [2, 4, "file size"],
  [6, 4, "reserved"],
  [10, 4, "pixel data offset"],
  [14, 4, "header size"],
  [18, 4, "width"],
  [22, 4, "height"],
  [26, 2, "colour planes"],
  [28, 2, "bits per pixel"],
  [30, 4, "compression"],
  [34, 4, "image size"],
  [38, 4, "horizontal resolution"],
  [42, 4, "vertical resolution"],
  [46, 4, "palette colours"],
  [50, 4, "important colours"],
];
const SEED_TEXT = "it must be out there.";

const hex2 = (v) => v.toString(16).padStart(2, "0").toUpperCase();
const hex8 = (v) => v.toString(16).padStart(8, "0").toUpperCase();
const printable = (v) => (v >= 32 && v < 127 ? String.fromCharCode(v) : ".");

function writeHeader(bytes) {
  const dv = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  dv.setUint32(2, SIZE, true);
  dv.setUint32(6, 0, true);
  dv.setUint32(10, HEADER, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, W, true);
  dv.setInt32(22, H, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, STRIDE * H, true);
  dv.setUint32(38, 2835, true);
  dv.setUint32(42, 2835, true);
  dv.setUint32(46, 0, true);
  dv.setUint32(50, 0, true);
}

function downsample(img) {
  let src = img;
  let size = Math.max(img.naturalWidth, img.naturalHeight);
  while (size / 2 >= W * 2) {
    size = Math.round(size / 2);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, size, size);
    src = c;
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, W, H);
  return g.getImageData(0, 0, W, H).data;
}

export const pixelOf = (i) => {
  const p = i - HEADER;
  const row = Math.floor(p / STRIDE);
  return { x: Math.floor((p % STRIDE) / 3), y: H - 1 - row, channel: p % 3 };
};

const offsetOf = (x, y) => HEADER + (H - 1 - y) * STRIDE + x * 3;

export function createHexView({ dump, canvas, plate, hoverBox, selBox, input, status, onFile }) {
  const g = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  const pixel = g.createImageData(1, 1);
  const bytes = new Uint8Array(SIZE);
  const pristine = new Uint8Array(SIZE);
  const edits = new Map();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let hexSpans = [];
  let ascSpans = [];
  let rows = [];
  let bpr = 0;
  let sel = { i: 0, mode: "ascii", nibble: 0 };
  let hover = -1;
  let hoverPixel = null;
  let lit = [];
  let audio = null;
  let destroyed = false;
  let scrollRaf = 0;
  let loaded = false;
  let token = 0;

  const paintPixel = (x, y) => {
    const o = offsetOf(x, y);
    pixel.data[0] = bytes[o + 2];
    pixel.data[1] = bytes[o + 1];
    pixel.data[2] = bytes[o];
    pixel.data[3] = 255;
    g.putImageData(pixel, x, y);
  };

  const paintAll = () => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const o = offsetOf(x, y);
        const k = (y * W + x) * 4;
        img.data[k] = bytes[o + 2];
        img.data[k + 1] = bytes[o + 1];
        img.data[k + 2] = bytes[o];
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  };

  const build = () => {
    const width = dump.clientWidth;
    const next = width < 520 ? 8 : 16;
    if (next === bpr && rows.length) return;
    bpr = next;
    dump.textContent = "";
    hexSpans = new Array(SIZE);
    ascSpans = new Array(SIZE);
    rows = [];
    const frag = document.createDocumentFragment();
    for (let start = 0; start < SIZE; start += bpr) {
      const row = document.createElement("div");
      row.className = "hex-view-row";
      const off = document.createElement("span");
      off.className = "hex-view-off";
      off.textContent = hex8(start);
      const hx = document.createElement("span");
      hx.className = "hex-view-hex";
      const as = document.createElement("span");
      as.className = "hex-view-asc";
      for (let k = 0; k < bpr; k += 1) {
        const i = start + k;
        const b = document.createElement("span");
        const a = document.createElement("span");
        if (i < SIZE) {
          b.className = i < HEADER ? "hex-view-byte is-header" : "hex-view-byte";
          a.className = i < HEADER ? "hex-view-char is-header" : "hex-view-char";
          b.dataset.i = i;
          a.dataset.i = i;
          b.dataset.col = "hex";
          a.dataset.col = "ascii";
          b.textContent = hex2(bytes[i]);
          a.textContent = printable(bytes[i]);
          if (edits.has(i)) {
            b.classList.add("is-edited");
            a.classList.add("is-edited");
          }
          hexSpans[i] = b;
          ascSpans[i] = a;
        } else {
          b.className = "hex-view-byte is-empty";
          a.className = "hex-view-char is-empty";
          b.textContent = "  ";
          a.textContent = " ";
        }
        if (k === 7 && bpr === 16) b.classList.add("is-mid");
        hx.appendChild(b);
        as.appendChild(a);
      }
      row.append(off, hx, as);
      rows.push(row);
      frag.appendChild(row);
    }
    dump.appendChild(frag);
    lit = [];
    applySelection();
    if (hover >= 0) lightPixelBytes(hover);
  };

  const refreshByte = (i) => {
    if (!hexSpans[i]) return;
    hexSpans[i].textContent = hex2(bytes[i]);
    ascSpans[i].textContent = printable(bytes[i]);
    const edited = bytes[i] !== pristine[i];
    hexSpans[i].classList.toggle("is-edited", edited);
    ascSpans[i].classList.toggle("is-edited", edited);
  };

  const placeBox = (box, x, y, on) => {
    if (!on) {
      box.dataset.on = "false";
      return;
    }
    box.dataset.on = "true";
    box.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  };

  const describe = (i) => {
    if (i < HEADER) {
      const field = FIELDS.find(([s, n]) => i >= s && i < s + n);
      const [s, n, name] = field;
      const dv = new DataView(bytes.buffer);
      const value = n === 2 ? dv.getUint16(s, true) : dv.getInt32(s, true);
      const shown = s === 0 ? "BM" : String(value);
      return `0x${hex8(i)}   header   ${name}   ${shown}`;
    }
    const p = pixelOf(i);
    const changed = bytes[i] !== pristine[i] ? `   was ${hex2(pristine[i])}` : "";
    return `0x${hex8(i)}   pixel ${p.x}, ${p.y}   ${CHANNELS[p.channel]}   ${hex2(bytes[i])} = ${bytes[i]}${changed}`;
  };

  const updateStatus = () => {
    const i = hover >= 0 ? hover : sel.i;
    status.textContent = hover >= 0 ? describe(i) : `${describe(i)}   ${sel.mode === "hex" ? "typing hex" : "typing text"}`;
  };

  const lightPixelBytes = (i) => {
    for (const el of lit) el.classList.remove("is-lit");
    lit = [];
    if (i < 0) return;
    const start = i < HEADER ? FIELDS.find(([s, n]) => i >= s && i < s + n)[0] : i - ((i - HEADER) % 3);
    const len = i < HEADER ? FIELDS.find(([s, n]) => i >= s && i < s + n)[1] : 3;
    for (let k = start; k < start + len; k += 1) {
      if (!hexSpans[k]) continue;
      hexSpans[k].classList.add("is-lit");
      ascSpans[k].classList.add("is-lit");
      lit.push(hexSpans[k], ascSpans[k]);
    }
  };

  let selEls = [];
  const applySelection = () => {
    for (const el of selEls) el.classList.remove("is-sel", "is-sel-ghost", "is-half");
    selEls = [];
    const i = sel.i;
    if (!hexSpans[i]) return;
    const active = sel.mode === "hex" ? hexSpans[i] : ascSpans[i];
    const ghost = sel.mode === "hex" ? ascSpans[i] : hexSpans[i];
    active.classList.add("is-sel");
    if (sel.mode === "hex" && sel.nibble === 1) active.classList.add("is-half");
    ghost.classList.add("is-sel-ghost");
    selEls = [active, ghost];
    if (i >= HEADER) {
      const p = pixelOf(i);
      placeBox(selBox, p.x, p.y, true);
      selBox.dataset.channel = CHANNELS[p.channel];
    } else placeBox(selBox, 0, 0, false);
    updateStatus();
  };

  const scrollToByte = (i, smooth) => {
    const row = Math.floor(i / bpr);
    const top = row * ROW_H;
    const view = dump.clientHeight;
    const cur = dump.scrollTop;
    if (top >= cur + ROW_H * 2 && top <= cur + view - ROW_H * 3) return;
    const target = Math.max(0, Math.min(dump.scrollHeight - view, top - view / 2 + ROW_H / 2));
    cancelAnimationFrame(scrollRaf);
    if (!smooth || reduced) {
      dump.scrollTop = target;
      return;
    }
    const from = cur;
    const t0 = performance.now();
    const dur = Math.min(420, 180 + Math.abs(target - from) * 0.15);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      dump.scrollTop = from + (target - from) * e;
      if (p < 1) scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  };

  const select = (i, mode, smooth = true) => {
    sel = { i: Math.max(HEADER, Math.min(SIZE - 1, i)), mode: mode || sel.mode, nibble: 0 };
    applySelection();
    scrollToByte(sel.i, smooth);
  };

  const setByte = (i, v) => {
    if (i < HEADER || i >= SIZE) return;
    bytes[i] = v;
    if (v === pristine[i]) edits.delete(i);
    else edits.set(i, v);
    refreshByte(i);
    const p = pixelOf(i);
    paintPixel(p.x, p.y);
    if (!reduced && selBox.animate) {
      selBox.animate([{ outlineOffset: "3px", outlineColor: "#ffffff" }, { outlineOffset: "0px", outlineColor: "#5dff8f" }], { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    onFile?.(edits.size);
  };

  const focusInput = () => {
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  };

  const typeChars = (text) => {
    for (const ch of text) {
      if (sel.mode === "hex") {
        const d = parseInt(ch, 16);
        if (Number.isNaN(d)) continue;
        const old = bytes[sel.i];
        if (sel.nibble === 0) {
          setByte(sel.i, (d << 4) | (old & 15));
          sel.nibble = 1;
          applySelection();
        } else {
          setByte(sel.i, (old & 0xf0) | d);
          if (sel.i < SIZE - 1) select(sel.i + 1, "hex");
          else applySelection();
        }
      } else {
        const code = ch.charCodeAt(0);
        if (code < 32 || code > 126) continue;
        setByte(sel.i, code);
        if (sel.i < SIZE - 1) select(sel.i + 1, "ascii");
        else applySelection();
      }
      audio?.key();
    }
  };

  const back = () => {
    const i = sel.nibble === 1 ? sel.i : Math.max(HEADER, sel.i - 1);
    setByte(i, pristine[i]);
    select(i, sel.mode);
    audio?.key();
  };

  const onInput = () => {
    const v = input.value;
    input.value = "";
    if (v) typeChars(v);
  };

  const onBeforeInput = (e) => {
    if (e.inputType === "deleteContentBackward") {
      e.preventDefault();
      back();
    }
  };

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -bpr, ArrowDown: bpr };
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      select(sel.i + moves[e.key], sel.mode);
      audio?.tick();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    } else if (e.key === "Tab") {
      e.preventDefault();
      sel.mode = sel.mode === "hex" ? "ascii" : "hex";
      sel.nibble = 0;
      applySelection();
    } else if (e.key === "Escape") {
      input.blur();
    }
  };

  const byteFromEvent = (e) => {
    const el = e.target.closest?.("[data-i]");
    if (!el) return null;
    return { i: Number(el.dataset.i), col: el.dataset.col };
  };

  const setHover = (i) => {
    if (i === hover) return;
    hover = i;
    lightPixelBytes(i);
    if (i >= HEADER) {
      const p = pixelOf(i);
      placeBox(hoverBox, p.x, p.y, true);
    } else placeBox(hoverBox, 0, 0, false);
    updateStatus();
  };

  const onDumpMove = (e) => {
    const hit = byteFromEvent(e);
    setHover(hit ? hit.i : -1);
  };

  const onDumpLeave = () => setHover(-1);

  const onDumpDown = (e) => {
    const hit = byteFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    if (hit.i < HEADER) {
      setHover(hit.i);
      return;
    }
    select(hit.i, hit.col, false);
    focusInput();
    audio?.tick();
  };

  const pixelFromEvent = (e) => {
    const rect = plate.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * W);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return { x, y };
  };

  const onPlateMove = (e) => {
    const p = pixelFromEvent(e);
    if (!p) return;
    if (hoverPixel && hoverPixel.x === p.x && hoverPixel.y === p.y) return;
    hoverPixel = p;
    const i = offsetOf(p.x, p.y);
    setHover(i);
    scrollToByte(i, true);
  };

  const onPlateLeave = () => {
    hoverPixel = null;
    setHover(-1);
  };

  const onPlateDown = (e) => {
    const p = pixelFromEvent(e);
    if (!p) return;
    e.preventDefault();
    select(offsetOf(p.x, p.y), sel.mode, true);
    focusInput();
    audio?.tick();
  };

  const onFocus = () => dump.parentElement?.setAttribute("data-editing", "");
  const onBlur = () => dump.parentElement?.removeAttribute("data-editing");

  const onClick = () => {
    if (sel.i >= HEADER) focusInput();
  };

  dump.addEventListener("pointermove", onDumpMove);
  dump.addEventListener("pointerleave", onDumpLeave);
  dump.addEventListener("pointerdown", onDumpDown);
  plate.addEventListener("pointermove", onPlateMove);
  plate.addEventListener("pointerleave", onPlateLeave);
  plate.addEventListener("pointerdown", onPlateDown);
  plate.addEventListener("click", onClick);
  dump.addEventListener("click", onClick);
  input.addEventListener("input", onInput);
  input.addEventListener("beforeinput", onBeforeInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  const ro = new ResizeObserver(() => {
    if (!loaded) return;
    build();
    scrollToByte(sel.i, false);
  });
  ro.observe(dump);

  const load = (src, seed) => {
    token += 1;
    const mine = token;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    return img
      .decode()
      .then(() => {
        if (destroyed || mine !== token) return;
        const data = downsample(img);
        writeHeader(pristine);
        for (let y = 0; y < H; y += 1) {
          for (let x = 0; x < W; x += 1) {
            const o = offsetOf(x, y);
            const k = (y * W + x) * 4;
            pristine[o] = data[k + 2];
            pristine[o + 1] = data[k + 1];
            pristine[o + 2] = data[k];
          }
        }
        bytes.set(pristine);
        if (seed) {
          const start = offsetOf(13, 4);
          for (let k = 0; k < SEED_TEXT.length; k += 1) edits.set(start + k, SEED_TEXT.charCodeAt(k));
          sel = { i: start + SEED_TEXT.length, mode: "ascii", nibble: 0 };
        }
        for (const [i, v] of edits) bytes[i] = v;
        paintAll();
        if (!loaded || rows.length === 0) {
          loaded = true;
          build();
        } else {
          for (let i = 0; i < SIZE; i += 1) refreshByte(i);
          applySelection();
        }
        scrollToByte(sel.i, false);
        onFile?.(edits.size);
      })
      .catch(() => {});
  };

  return {
    start(src) {
      return load(src, true);
    },
    setCover(src) {
      audio?.tick();
      return load(src, false);
    },
    reset() {
      edits.clear();
      bytes.set(pristine);
      paintAll();
      for (let i = 0; i < SIZE; i += 1) refreshByte(i);
      applySelection();
      onFile?.(0);
      audio?.key();
    },
    file() {
      return new Blob([bytes], { type: "image/bmp" });
    },
    focus() {
      scrollToByte(sel.i, true);
      focusInput();
    },
    async setSound(on) {
      if (on && !audio) audio = createKeys();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(scrollRaf);
      ro.disconnect();
      dump.removeEventListener("pointermove", onDumpMove);
      dump.removeEventListener("pointerleave", onDumpLeave);
      dump.removeEventListener("pointerdown", onDumpDown);
      plate.removeEventListener("pointermove", onPlateMove);
      plate.removeEventListener("pointerleave", onPlateLeave);
      plate.removeEventListener("pointerdown", onPlateDown);
      plate.removeEventListener("click", onClick);
      dump.removeEventListener("click", onClick);
      input.removeEventListener("input", onInput);
      input.removeEventListener("beforeinput", onBeforeInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      audio?.destroy();
      audio = null;
    },
  };
}

export const FILE_SIZE = SIZE;
