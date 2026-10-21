import { createPencilAudio } from "./marginsAudio";
import { NOTES } from "./marginsLyric";
import { geometry, mulberry, recognize, strokeLength } from "./marginsShapes";

const GRAPHITE = "52, 52, 60";

function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function graphiteTile() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fine = hash(x, y, 1);
      const streak = hash(Math.floor(x / 3), y, 2);
      const v = fine * 0.6 + streak * 0.4;
      const o = (y * size + x) * 4;
      image.data[o] = 48;
      image.data[o + 1] = 48;
      image.data[o + 2] = 56;
      image.data[o + 3] = Math.floor(Math.min(1, Math.max(0, (v - 0.12) / 0.7)) * 235);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function paperURL() {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = hash(i % size, Math.floor(i / size), 9);
    const o = i * 4;
    image.data[o] = v > 0.5 ? 255 : 120;
    image.data[o + 1] = v > 0.5 ? 252 : 108;
    image.data[o + 2] = v > 0.5 ? 240 : 86;
    image.data[o + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 18);
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function createMargins({ root, sheet, canvas, notesLayer, embedded, onCount, onReady }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const mainCtx = canvas.getContext("2d");
  let ctx = mainCtx;
  const pattern = mainCtx.createPattern(graphiteTile(), "repeat");
  const fine = window.matchMedia?.("(pointer: fine)").matches ?? true;
  root.style.setProperty("--margins-paper", `url(${paperURL()})`);
  let layout = null;
  let marks = [];
  const residue = [];
  const ghosts = [];
  let raw = null;
  let rawId = null;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let audio = null;
  let soundWanted = true;
  let seedCounter = 1;
  let noteCounter = 0;
  let sheetRect = sheet.getBoundingClientRect();
  let lastSample = null;
  let resizeTimer = 0;

  const pan = (x) => Math.max(-0.7, Math.min(0.7, (x / Math.max(1, layout?.width ?? 1)) * 1.4 - 0.7));

  const ensureAudio = async () => {
    if (!soundWanted) return;
    if (!audio) audio = createPencilAudio();
    await audio?.wake();
  };

  function measure() {
    const rect = sheet.getBoundingClientRect();
    sheetRect = rect;
    const nodes = sheet.querySelectorAll(".margins-word");
    const raw = [];
    nodes.forEach((node) => {
      const r = node.getBoundingClientRect();
      raw.push({ id: Number(node.dataset.w), left: r.left - rect.left, right: r.right - rect.left, top: r.top - rect.top, bottom: r.bottom - rect.top });
    });
    const rows = [];
    for (const w of raw) {
      let row = rows.find((r) => Math.abs(r.top - w.top) < 4);
      if (!row) {
        row = { id: rows.length, top: w.top, bottom: w.bottom, left: w.left, right: w.right };
        rows.push(row);
      }
      row.left = Math.min(row.left, w.left);
      row.right = Math.max(row.right, w.right);
      row.bottom = Math.max(row.bottom, w.bottom);
      w.line = row.id;
    }
    layout = {
      width: rect.width,
      height: rect.height,
      words: raw,
      lines: rows,
      textLeft: Math.min(...rows.map((r) => r.left)),
      textRight: Math.max(...rows.map((r) => r.right)),
    };
    canvas.width = Math.max(2, Math.round(rect.width * dpr));
    canvas.height = Math.max(2, Math.round(rect.height * dpr));
  }

  function rebuild() {
    for (const mark of marks) {
      mark.geo = geometry(mark.spec, layout, mark.seed);
      mark.len = mark.geo ? strokeLength(mark.geo.strokes) : 0;
      if (mark.note) placeNote(mark);
    }
  }

  function pencil(pts, upTo, w, seed, alpha) {
    let walked = 0;
    let prev = pts[0];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let n = 1; n < pts.length && walked < upTo; n += 1) {
      const a = pts[n - 1];
      const b = pts[n];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pieces = Math.max(1, Math.ceil(seg / 3));
      for (let p = 1; p <= pieces && walked < upTo; p += 1) {
        const t = p / pieces;
        const next = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        walked += seg / pieces;
        const press = 0.78 + Math.sin(seed + walked * 0.045) * 0.12 + Math.sin(seed * 2.3 + walked * 0.17) * 0.06;
        ctx.globalAlpha = alpha * press;
        ctx.lineWidth = w * (0.85 + press * 0.3);
        ctx.strokeStyle = pattern;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(next[0], next[1]);
        ctx.stroke();
        ctx.globalAlpha = alpha * press * 0.4;
        ctx.lineWidth = w * 0.5;
        ctx.strokeStyle = `rgb(${GRAPHITE})`;
        ctx.stroke();
        prev = next;
      }
    }
  }

  function drawGeo(geo, amount, alpha, seed, width = 2.1) {
    let budget = amount;
    let pen = null;
    geo.strokes.forEach((stroke, i) => {
      if (budget <= 0) return;
      let len = 0;
      for (let n = 1; n < stroke.length; n += 1) len += Math.hypot(stroke[n][0] - stroke[n - 1][0], stroke[n][1] - stroke[n - 1][1]);
      const upTo = Math.min(len, budget);
      pencil(stroke, upTo, width, seed + i * 7, alpha);
      if (upTo < len) {
        let walked = 0;
        for (let n = 1; n < stroke.length; n += 1) {
          const seg = Math.hypot(stroke[n][0] - stroke[n - 1][0], stroke[n][1] - stroke[n - 1][1]);
          if (walked + seg >= upTo) {
            pen = { x: stroke[n][0], angle: Math.atan2(stroke[n][1] - stroke[n - 1][1], stroke[n][0] - stroke[n - 1][0]) };
            break;
          }
          walked += seg;
        }
      }
      budget -= len;
    });
    return pen;
  }

  let still = null;
  let stillDirty = true;

  function sketch(pts, alpha) {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = pattern;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function paintStill() {
    if (!still || still.width !== canvas.width || still.height !== canvas.height) {
      still = document.createElement("canvas");
      still.width = canvas.width;
      still.height = canvas.height;
    }
    const target = ctx;
    const sctx = still.getContext("2d");
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, still.width, still.height);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx = sctx;
    for (const r of residue) drawGeo(r.geo, Infinity, 0.07, r.seed, 3.2);
    for (const mark of marks) if (mark.geo && !mark.erasing && mark.drawn >= 1) drawGeo(mark.geo, Infinity, 1, mark.seed);
    ctx = target;
    stillDirty = false;
  }

  function render() {
    if (stillDirty) paintStill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(still, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let pen = null;
    for (const mark of marks) {
      if (!mark.geo || (!mark.erasing && mark.drawn >= 1)) continue;
      if (mark.erasing) {
        ctx.filter = `blur(${((1 - mark.alpha) * 2.4).toFixed(2)}px)`;
        drawGeo(mark.geo, Infinity, Math.max(0, mark.alpha), mark.seed);
        ctx.filter = "none";
      } else {
        pen = drawGeo(mark.geo, mark.drawn * mark.len, 1, mark.seed) || pen;
      }
    }
    for (const g of ghosts) sketch(g.pts, g.alpha * 0.45);
    if (raw && raw.length > 1) sketch(raw, 0.45);
    ctx.globalAlpha = 1;
    return pen;
  }

  function tick(now) {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
    last = now;
    let busy = Boolean(raw);
    for (const mark of marks) {
      if (mark.erasing) {
        mark.alpha -= dt / 0.42;
        busy = true;
      } else if (mark.drawn < 1) {
        const duration = Math.min(0.75, Math.max(0.24, mark.len / 820));
        mark.drawn = Math.min(1, mark.drawn + dt / duration);
        if (mark.drawn >= 1) stillDirty = true;
        if (mark.drawn >= 1 && mark.note) revealNote(mark);
        busy = true;
      }
    }
    const gone = marks.filter((m) => m.erasing && m.alpha <= 0);
    if (gone.length) {
      for (const m of gone) residue.push({ geo: m.geo, seed: m.seed });
      stillDirty = true;
      if (residue.length > 24) residue.splice(0, residue.length - 24);
      marks = marks.filter((m) => !(m.erasing && m.alpha <= 0));
    }
    for (let i = ghosts.length - 1; i >= 0; i -= 1) {
      ghosts[i].alpha -= dt / 0.3;
      if (ghosts[i].alpha <= 0) ghosts.splice(i, 1);
      else busy = true;
    }
    const pen = render();
    if (pen) audio?.draw(0.2, pen.angle, pan(pen.x));
    else if (!raw) audio?.draw(0, 0, 0);
    if (busy) raf = requestAnimationFrame(tick);
    else audio?.draw(0, 0, 0);
  }

  const wake = () => {
    if (raf || destroyed) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const count = () => onCount?.(marks.filter((m) => !m.erasing).length);

  function addMark(spec, { drawn = 0 } = {}) {
    const seed = (seedCounter += 1) * 97 + 13;
    const geo = geometry(spec, layout, seed);
    if (!geo) return null;
    const mark = { spec, seed, geo, len: strokeLength(geo.strokes), drawn, alpha: 1, erasing: false, note: null };
    marks.push(mark);
    count();
    return mark;
  }

  function placeNote(mark) {
    const { note, geo } = mark;
    if (!note || !geo?.end) return;
    const { x, y, angle } = geo.end;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let ax = 0;
    let ay = -0.5;
    let px = x + 8;
    let py = y;
    if (c > 0.45) {
      ax = 0;
      px = x + 10;
    } else if (c < -0.45) {
      ax = -1;
      px = x - 10;
    } else if (s > 0) {
      ax = -0.5;
      ay = 0;
      px = x;
      py = y + 6;
    } else {
      ax = -0.5;
      ay = -1;
      px = x;
      py = y - 6;
    }
    const w = note.offsetWidth;
    const h = note.offsetHeight;
    let left = px + ax * w;
    let top = py + ay * h;
    left = Math.max(8, Math.min(layout.width - w - 8, left));
    top = Math.max(8, Math.min(layout.height - h - 8, top));
    if (x > left - 6 && x < left + w + 6 && y > top - 6 && y < top + h + 6) {
      left = Math.max(8, Math.min(layout.width - w - 8, x - w * 0.7));
      top = s > 0.2 || y - h - 10 < 8 ? y + 10 : y - h - 10;
      top = Math.max(8, Math.min(layout.height - h - 8, top));
    }
    note.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) rotate(${mark.noteTilt}deg)`;
  }

  function addNote(mark, text) {
    const note = document.createElement("div");
    note.className = "margins-note";
    const field = document.createElement("span");
    field.className = "margins-note-text";
    field.contentEditable = "plaintext-only";
    field.spellcheck = false;
    field.setAttribute("role", "textbox");
    field.setAttribute("aria-label", "Margin note");
    field.textContent = text ?? NOTES[noteCounter % NOTES.length];
    noteCounter += 1;
    note.append(field);
    notesLayer.append(note);
    mark.note = note;
    mark.noteTilt = (mulberry(mark.seed)() - 0.5) * 5;
    placeNote(mark);
    if (text) return;
    note.dataset.writing = "";
    if (fine && !raw) {
      field.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(field);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  function revealNote(mark) {
    const note = mark.note;
    if (!note || note.dataset.writing !== "") return;
    note.getBoundingClientRect();
    note.dataset.writing = "go";
    audio?.draw(0.22, 0.3, pan(mark.geo.end.x));
    setTimeout(() => {
      if (destroyed) return;
      audio?.draw(0, 0, 0);
      delete note.dataset.writing;
    }, 640);
  }

  const onNoteKey = (e) => {
    const field = e.target.closest?.(".margins-note-text");
    if (!field) return;
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      field.blur();
      return;
    }
    if (e.key.length === 1 && field.textContent.length >= 44 && !window.getSelection()?.toString()) e.preventDefault();
  };

  const onNoteInput = (e) => {
    const field = e.target.closest?.(".margins-note-text");
    if (!field) return;
    const mark = marks.find((m) => m.note?.contains(field));
    if (mark) {
      delete mark.note.dataset.writing;
      placeNote(mark);
    }
    audio?.touch(0);
  };

  const onNoteBlur = (e) => {
    const field = e.target.closest?.(".margins-note-text");
    if (!field) return;
    window.getSelection()?.removeAllRanges();
    if (!field.textContent.trim()) {
      const mark = marks.find((m) => m.note?.contains(field));
      field.closest(".margins-note")?.remove();
      if (mark) mark.note = null;
      if (mark) mark.noteDismissed = true;
    }
  };

  function undo() {
    const mark = [...marks].reverse().find((m) => !m.erasing);
    if (!mark) return;
    ensureAudio();
    mark.erasing = true;
    mark.drawn = 1;
    stillDirty = true;
    if (mark.note) {
      const note = mark.note;
      note.dataset.leaving = "";
      setTimeout(() => note.remove(), 360);
    }
    audio?.rub(pan(mark.geo?.end?.x ?? layout.width / 2));
    count();
    wake();
  }

  const toSheet = (e) => [e.clientX - sheetRect.left, e.clientY - sheetRect.top];

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest?.(".margins-note")) return;
    if (raw) return;
    e.preventDefault();
    const active = document.activeElement;
    if (active && notesLayer.contains(active)) active.blur();
    ensureAudio();
    sheetRect = sheet.getBoundingClientRect();
    raw = [toSheet(e)];
    rawId = e.pointerId;
    lastSample = { t: performance.now(), p: raw[0] };
    sheet.setPointerCapture?.(e.pointerId);
    root.dataset.drawing = "";
    audio?.touch(pan(raw[0][0]));
    wake();
  };

  const onPointerMove = (e) => {
    if (!raw || e.pointerId !== rawId) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const p = toSheet(ev);
      const prev = raw[raw.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= 1.5) raw.push(p);
    }
    const now = performance.now();
    const p = raw[raw.length - 1];
    const dt = Math.max(1, now - lastSample.t);
    const speed = Math.hypot(p[0] - lastSample.p[0], p[1] - lastSample.p[1]) / dt;
    lastSample = { t: now, p };
    audio?.draw(Math.min(0.32, speed * 0.25), Math.atan2(p[1] - (raw[raw.length - 2]?.[1] ?? p[1]), p[0] - (raw[raw.length - 2]?.[0] ?? p[0])), pan(p[0]));
    wake();
  };

  const onPointerUp = (e) => {
    if (!raw || e.pointerId !== rawId) return;
    const pts = raw;
    raw = null;
    rawId = null;
    delete root.dataset.drawing;
    audio?.draw(0, 0, 0);
    const spec = recognize(pts, layout);
    ghosts.push({ pts, alpha: 1 });
    const mark = spec ? addMark(spec) : null;
    if (mark && spec.type === "arrow") addNote(mark);
    wake();
  };

  const onKey = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    if (e.target?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
    e.preventDefault();
    undo();
  };

  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (destroyed) return;
      measure();
      rebuild();
      stillDirty = true;
      render();
    }, 80);
  });

  const onScroll = () => {
    sheetRect = sheet.getBoundingClientRect();
  };

  function seedDefaults() {
    const find = (text, after = -1) => layout.words.find((w) => w.id > after && sheet.querySelector(`[data-w="${w.id}"]`)?.textContent === text);
    const soft = find("soft");
    if (soft) addMark({ type: "circle", words: [soft.id] }, { drawn: 1 });
    const keep = find("keep");
    const home = keep && find("home", keep.id);
    const i = keep && layout.words.find((w) => w.id === keep.id - 1);
    if (i && home) {
      const ids = layout.words.filter((w) => w.id >= i.id && w.id <= home.id && w.line === i.line).map((w) => w.id);
      addMark({ type: "underline", words: ids }, { drawn: 1 });
    }
    const narrow = layout.width - layout.textRight < 150;
    if (!narrow) {
      const easy = find("easy");
      const comes = easy && find("comes", easy.id);
      if (comes) {
        const W = layout.width;
        const H = layout.height;
        const ex = Math.min(W - 170, layout.textRight + 64);
        const ey = comes.top - 26;
        const mark = addMark(
          { type: "arrow", from: { word: comes.id, fx: 1.12, fy: 0.42 }, to: { x: ex / W, y: ey / H }, bend: -0.22 },
          { drawn: 1 },
        );
        if (mark) addNote(mark, "every time");
      }
    } else {
      const goes = find("goes");
      if (goes) {
        const W = layout.width;
        const H = layout.height;
        const mark = addMark(
          { type: "arrow", from: { word: goes.id, fx: 0.5, fy: 1.15 }, to: { x: (goes.left - 40) / W, y: (goes.bottom + 44) / H }, bend: -0.25 },
          { drawn: 1 },
        );
        if (mark) addNote(mark, "every time");
      }
    }
  }

  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("pointermove", onPointerMove);
  sheet.addEventListener("pointerup", onPointerUp);
  sheet.addEventListener("pointercancel", onPointerUp);
  notesLayer.addEventListener("keydown", onNoteKey);
  notesLayer.addEventListener("input", onNoteInput);
  notesLayer.addEventListener("focusout", onNoteBlur);
  if (!embedded) window.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });

  const boot = async () => {
    await Promise.all([
      document.fonts?.load?.("19px MarginsGaramond").catch(() => {}),
      document.fonts?.load?.("italic 19px MarginsGaramond").catch(() => {}),
      document.fonts?.load?.("20px MarginsCaveat").catch(() => {}),
    ]);
    if (destroyed) return;
    measure();
    seedDefaults();
    stillDirty = true;
    render();
    ro.observe(sheet);
    onReady?.();
  };
  boot();

  return {
    undo,
    async setSound(on) {
      soundWanted = on;
      if (on && !audio) audio = createPencilAudio();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      ro.disconnect();
      sheet.removeEventListener("pointerdown", onPointerDown);
      sheet.removeEventListener("pointermove", onPointerMove);
      sheet.removeEventListener("pointerup", onPointerUp);
      sheet.removeEventListener("pointercancel", onPointerUp);
      notesLayer.removeEventListener("keydown", onNoteKey);
      notesLayer.removeEventListener("input", onNoteInput);
      notesLayer.removeEventListener("focusout", onNoteBlur);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
      notesLayer.textContent = "";
      audio?.destroy();
    },
  };
}
