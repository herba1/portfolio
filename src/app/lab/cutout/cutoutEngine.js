import { createPaperAudio } from "./cutoutAudio";
import { PRINTS, composeThumb, createPrint } from "./cutoutPrint";

const BACKS = [
  "continued on page fourteen",
  "the forecast for the weekend is",
  "letters to the editor",
  "tickets go on sale friday at",
  "said the council would meet",
  "photographs by the author",
  "a short walk from the station",
  "in the spring of that year",
];

export const PAPERS = [
  { id: "news", label: "Newsprint", paper: "#ebe9e1", ink: "#1b1916" },
  { id: "cream", label: "Cream", paper: "#f3e7cf", ink: "#2c2117" },
  { id: "rose", label: "Rose", paper: "#eec3bb", ink: "#3b1717" },
  { id: "sky", label: "Pale blue", paper: "#c6d8e4", ink: "#14243a" },
  { id: "kraft", label: "Kraft", paper: "#c7a074", ink: "#26190c" },
  { id: "night", label: "Black", paper: "#1d1e26", ink: "#f1ebdd" },
];
const DEFAULT_LINE = "it must be out there.";
const MAX_DT = 1 / 30;

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

function grainURL() {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const rnd = mulberry(77);
  for (let i = 0; i < size * size; i += 1) {
    const r = rnd();
    const o = i * 4;
    if (r < 0.55) {
      image.data[o] = 70;
      image.data[o + 1] = 64;
      image.data[o + 2] = 52;
      image.data[o + 3] = Math.floor(rnd() * 16);
    } else if (r > 0.9) {
      image.data[o] = 255;
      image.data[o + 1] = 255;
      image.data[o + 2] = 250;
      image.data[o + 3] = Math.floor(rnd() * 40);
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = "rgba(90, 80, 64, 0.08)";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 26; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const l = 4 + rnd() * 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

function cutPath(rnd) {
  const j = (n) => (rnd() * n).toFixed(2);
  const midTop = (30 + rnd() * 40).toFixed(1);
  const midBottom = (30 + rnd() * 40).toFixed(1);
  return `polygon(${j(2)}px ${j(1.6)}px, calc(${midTop}% + 0px) ${j(1.2)}px, calc(100% - ${j(2.4)}px) ${j(1.6)}px, calc(100% - ${j(1.4)}px) calc(100% - ${j(1.6)}px), calc(${midBottom}% + 0px) calc(100% - ${j(1.2)}px), ${j(2.2)}px calc(100% - ${j(1.8)}px))`;
}

function spring(value, velocity, target, stiffness, ratio, dt) {
  const damping = 2 * Math.sqrt(stiffness) * ratio;
  const accel = stiffness * (target - value) - damping * velocity;
  const v = velocity + accel * dt;
  return [value + v * dt, v];
}

export function createCutout({ root, page, sheets, layer, input, sources, album, embedded, onReady, onFail, onDraft, onThumbs }) {
  const printScale = 2;
  const rnd = mulberry(20261019);
  const strips = [];
  let print = null;
  let images = null;
  let printId = PRINTS[0].id;
  let front = 0;
  let paperId = PAPERS[0].id;
  let active = null;
  let angle = 0;
  let audio = null;
  let soundWanted = true;
  let width = page.clientWidth;
  let height = page.clientHeight;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let z = 1;
  let ids = 0;
  let draft = null;
  let drag = null;
  let renderTimer = 0;
  let pageRect = page.getBoundingClientRect();

  root.style.setProperty("--cutout-grain", `url(${grainURL()})`);

  const fontSize = () => Math.round(Math.min(34, Math.max(17, width * 0.05)));

  const sizeStrip = (strip) => {
    const size = Math.round(fontSize() * strip.scale * strip.fit);
    const lead = Math.round((size * 1.4) / 4) * 4;
    strip.paper.style.fontSize = `${size}px`;
    strip.paper.style.lineHeight = `${lead}px`;
    strip.paper.style.paddingInline = `${Math.round(size * 0.34)}px ${Math.round(size * 0.42)}px`;
    strip.back.style.fontSize = `${Math.round(size * 0.8)}px`;
  };

  const dressStrip = (strip, id) => {
    const paper = PAPERS.find((p) => p.id === id) ?? PAPERS[0];
    strip.paperId = paper.id;
    strip.paper.style.backgroundColor = paper.paper;
    strip.paper.style.setProperty("--cutout-strip-ink", paper.ink);
    strip.el.dataset.paper = paper.id;
  };

  const makeStrip = (text, x, y, opts = {}) => {
    const el = document.createElement("div");
    el.className = "cutout-strip";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const far = document.createElement("div");
    far.className = "cutout-strip-far";
    const near = document.createElement("div");
    near.className = "cutout-strip-near";
    const paper = document.createElement("div");
    paper.className = "cutout-strip-paper";
    paper.style.clipPath = cutPath(rnd);
    const back = document.createElement("span");
    back.className = "cutout-strip-back";
    back.setAttribute("aria-hidden", "true");
    back.textContent = BACKS[Math.floor(rnd() * BACKS.length)];
    back.style.transform = `scaleX(-1) translate(${(rnd() * 30 - 40).toFixed(0)}%, ${(rnd() * 30 - 22).toFixed(0)}%)`;
    const label = document.createElement("span");
    label.className = "cutout-strip-text";
    paper.append(back, label);
    el.append(far, near, paper);
    layer.append(el);
    const strip = {
      id: (ids += 1),
      el,
      far,
      near,
      paper,
      back,
      label,
      caret: null,
      text: "",
      x,
      y,
      vx: 0,
      vy: 0,
      tx: x,
      ty: y,
      base: opts.base ?? (rnd() * 2.4 - 1.2),
      tilt: 0,
      tiltV: 0,
      lift: opts.lift ?? 0,
      liftV: 0,
      liftT: opts.lift ?? 0,
      alpha: opts.alpha ?? 1,
      alphaT: 1,
      scale: opts.scale ?? 0.94 + rnd() * 0.1,
      fit: 1,
      high: (opts.lift ?? 0) > 0.4,
      removing: false,
      draft: Boolean(opts.draft),
      outside: false,
    };
    el.style.zIndex = String((z += 1));
    dressStrip(strip, opts.paper ?? paperId);
    sizeStrip(strip);
    setText(strip, text, false);
    strips.push(strip);
    paint(strip);
    return strip;
  };

  function setText(strip, text, animate) {
    const prev = strip.text;
    strip.text = text;
    if (animate && text.startsWith(prev)) {
      for (const ch of text.slice(prev.length)) {
        const span = document.createElement("span");
        span.className = "cutout-char";
        span.dataset.fresh = "";
        span.textContent = ch;
        strip.label.append(span);
      }
    } else {
      strip.label.textContent = "";
      for (const ch of text) {
        const span = document.createElement("span");
        span.className = "cutout-char";
        span.textContent = ch;
        strip.label.append(span);
      }
    }
    if (strip.caret) strip.label.append(strip.caret);
    fitStrip(strip);
    strip.el.setAttribute("aria-label", text ? `Cut-out strip: ${text}` : "New strip");
  }

  function fitStrip(strip) {
    const room = width * 0.92;
    const natural = strip.paper.offsetWidth / strip.fit;
    const fit = natural > room ? Math.max(0.5, room / natural) : 1;
    if (Math.abs(fit - strip.fit) < 0.01) return;
    strip.fit = fit;
    sizeStrip(strip);
  }

  function paint(strip) {
    const s = 1 + strip.lift * 0.035;
    const r = strip.base + strip.tilt;
    strip.el.style.transform = `translate3d(${strip.x.toFixed(2)}px, ${strip.y.toFixed(2)}px, 0) translate(-50%, -50%) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
    strip.el.style.opacity = strip.alpha.toFixed(3);
    strip.far.style.opacity = (strip.lift * 0.9).toFixed(3);
    strip.far.style.transform = `translate(${(strip.lift * 4).toFixed(2)}px, ${(2 + strip.lift * 14).toFixed(2)}px)`;
    strip.near.style.opacity = (1 - strip.lift * 0.85).toFixed(3);
  }

  const pan = (x) => Math.max(-0.8, Math.min(0.8, (x / Math.max(1, width)) * 1.6 - 0.8));

  const ensureAudio = async () => {
    if (!soundWanted) return;
    if (!audio) audio = createPaperAudio();
    await audio?.wake();
  };

  const wake = () => {
    if (raf || destroyed) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  function tick(now) {
    raf = 0;
    const dt = Math.min(MAX_DT, Math.max(0.001, (now - last) / 1000));
    last = now;
    let busy = false;
    for (let i = strips.length - 1; i >= 0; i -= 1) {
      const strip = strips[i];
      const dragging = drag?.strip === strip;
      if (dragging) {
        strip.tx = drag.px - drag.ox;
        strip.ty = drag.py - drag.oy;
      }
      const ratio = dragging ? 0.92 : 1;
      const stiff = dragging ? 620 : 260;
      [strip.x, strip.vx] = spring(strip.x, strip.vx, strip.tx, stiff, ratio, dt);
      [strip.y, strip.vy] = spring(strip.y, strip.vy, strip.ty, stiff, ratio, dt);
      const swing = dragging ? Math.max(-5, Math.min(5, -strip.vx * 0.0055)) : 0;
      [strip.tilt, strip.tiltV] = spring(strip.tilt, strip.tiltV, swing, 140, 0.72, dt);
      [strip.lift, strip.liftV] = spring(strip.lift, strip.liftV, strip.liftT, 260, 0.95, dt);
      if (strip.lift > 0.4) strip.high = true;
      if (strip.high && strip.liftT === 0 && strip.lift < 0.08) {
        strip.high = false;
        if (!strip.removing) audio?.land(0.5 + Math.min(0.5, Math.abs(strip.liftV) * 0.06), pan(strip.x));
      }
      const outside = !strip.removing && (strip.x < 0 || strip.x > width || strip.y < 0 || strip.y > height);
      if (outside !== strip.outside) {
        strip.outside = outside;
        strip.el.toggleAttribute("data-outside", outside);
      }
      strip.alpha += (strip.alphaT - strip.alpha) * Math.min(1, dt * (strip.removing ? 9 : 14));
      paint(strip);
      if (strip.removing && strip.alpha < 0.02) {
        strip.el.remove();
        strips.splice(i, 1);
        continue;
      }
      const moving =
        Math.abs(strip.tx - strip.x) > 0.05 ||
        Math.abs(strip.ty - strip.y) > 0.05 ||
        Math.abs(strip.vx) + Math.abs(strip.vy) > 0.05 ||
        Math.abs(strip.tilt) > 0.005 ||
        Math.abs(strip.tiltV) > 0.01 ||
        Math.abs(strip.lift - strip.liftT) > 0.002 ||
        Math.abs(strip.liftV) > 0.01 ||
        Math.abs(strip.alpha - strip.alphaT) > 0.004;
      if (moving || dragging) busy = true;
    }
    if (drag) {
      const speed = Math.hypot(drag.strip.vx, drag.strip.vy);
      audio?.slide(speed, pan(drag.strip.x));
    } else {
      audio?.slide(0, 0);
    }
    if (busy) raf = requestAnimationFrame(tick);
  }

  const toPage = (e) => {
    const cx = pageRect.left + pageRect.width / 2;
    const cy = pageRect.top + pageRect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    return { x: dx * c - dy * s + width / 2, y: dx * s + dy * c + height / 2 };
  };

  const readAngle = () => {
    const m = getComputedStyle(page).transform;
    if (!m || m === "none") return 0;
    const v = m.match(/matrix\(([^)]+)\)/);
    if (!v) return 0;
    const [a, b] = v[1].split(",").map(Number);
    return Math.atan2(b, a);
  };

  const onPointerDown = (e) => {
    const el = e.target.closest?.(".cutout-strip");
    if (!el || (e.button !== undefined && e.button !== 0)) return;
    const strip = strips.find((s) => s.el === el);
    if (!strip || strip.removing) return;
    e.preventDefault();
    ensureAudio();
    active = strip;
    pageRect = page.getBoundingClientRect();
    angle = readAngle();
    const p = toPage(e);
    drag = { strip, id: e.pointerId, px: p.x, py: p.y, ox: p.x - strip.x, oy: p.y - strip.y };
    el.setPointerCapture?.(e.pointerId);
    el.dataset.dragging = "";
    root.dataset.dragging = "";
    el.style.zIndex = String((z += 1));
    strip.liftT = 1;
    audio?.lift(pan(strip.x));
    wake();
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toPage(e);
    drag.px = Math.max(-width * 0.25, Math.min(width * 1.25, p.x));
    drag.py = Math.max(-height * 0.25, Math.min(height * 1.25, p.y));
    wake();
  };

  const discard = (strip) => {
    strip.removing = true;
    strip.alphaT = 0;
    strip.liftT = 1;
    strip.el.setAttribute("aria-hidden", "true");
    strip.el.tabIndex = -1;
    if (strip === active) active = null;
    if (strip === draft) {
      draft = null;
      onDraft?.(false);
    }
    audio?.lift(pan(strip.x));
    wake();
  };

  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { strip } = drag;
    drag = null;
    delete strip.el.dataset.dragging;
    delete root.dataset.dragging;
    if (strip.outside) {
      discard(strip);
      return;
    }
    if (!strip.draft) strip.liftT = 0;
    wake();
  };

  const commitDraft = () => {
    if (!draft) return;
    const strip = draft;
    const text = strip.text.trim();
    draft = null;
    onDraft?.(false);
    if (!text) {
      discard(strip);
      return;
    }
    strip.draft = false;
    strip.caret?.remove();
    strip.caret = null;
    setText(strip, text, false);
    delete strip.el.dataset.draft;
    strip.base += rnd() * 1.6 - 0.8;
    if (drag?.strip !== strip) strip.liftT = 0;
    audio?.snip(pan(strip.x));
    wake();
  };

  const openDraft = () => {
    if (draft) return draft;
    const x = width * 0.5;
    const y = height * (width < 560 ? 0.62 : 0.68);
    const strip = makeStrip("", x, y + 28, { lift: 1, alpha: 0, draft: true, base: rnd() * 1.4 - 0.7 });
    active = strip;
    strip.ty = y;
    strip.el.dataset.draft = "";
    const caret = document.createElement("span");
    caret.className = "cutout-caret";
    caret.setAttribute("aria-hidden", "true");
    strip.caret = caret;
    strip.label.append(caret);
    draft = strip;
    onDraft?.(true);
    wake();
    return strip;
  };

  const onInput = () => {
    ensureAudio();
    const strip = openDraft();
    const value = input.value.replace(/\s+/g, " ");
    const grew = value.length > strip.text.length;
    setText(strip, value, true);
    if (grew) audio?.key(pan(strip.x));
  };

  const onInputKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
      input.value = "";
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (draft) discard(draft);
      input.value = "";
      input.blur();
    }
  };

  const onInputBlur = () => {
    if (!draft) return;
    commitDraft();
    input.value = "";
  };

  const onInputFocus = () => {
    ensureAudio();
    openDraft();
    if (input.value) setText(draft, input.value, false);
  };

  const onWindowKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target === input) return;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const strip = strips.find((s) => s.el === target);
    if (strip) {
      const step = e.shiftKey ? 24 : 6;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        strip.tx = Math.max(0, Math.min(width, strip.tx + moves[e.key][0]));
        strip.ty = Math.max(0, Math.min(height, strip.ty + moves[e.key][1]));
        wake();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        discard(strip);
        return;
      }
    }
    if (e.key.length === 1 && e.key !== " " && !target?.closest?.("button")) input.focus({ preventScroll: true });
  };

  const onWheel = (e) => {
    const el = e.target.closest?.(".cutout-strip");
    const strip = el && strips.find((s) => s.el === el);
    if (!strip || strip.removing) return;
    e.preventDefault();
    strip.base = Math.max(-24, Math.min(24, strip.base + Math.max(-40, Math.min(40, e.deltaY)) * 0.04));
    wake();
  };

  const renderPrint = (into = front) => {
    if (!print || !images) return;
    const p = PRINTS.find((item) => item.id === printId) ?? PRINTS[0];
    const img = p.id === "album" ? images.album : p.id === "dusk" ? images.dusk : images.sea;
    print.render(sheets[into], p, img, album, width, height, printScale);
    root.style.setProperty("--cutout-shadow", p.shadow);
  };

  const showSheets = () => {
    sheets.forEach((sheet, i) => sheet.toggleAttribute("data-front", i === front));
  };

  const ro = new ResizeObserver(() => {
    const w = page.clientWidth;
    const h = page.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    const sx = w / width;
    const sy = h / height;
    width = w;
    height = h;
    pageRect = page.getBoundingClientRect();
    angle = readAngle();
    for (const strip of strips) {
      strip.x *= sx;
      strip.tx *= sx;
      strip.y *= sy;
      strip.ty *= sy;
      sizeStrip(strip);
      fitStrip(strip);
      paint(strip);
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPrint, 140);
  });

  const onScroll = () => {
    pageRect = page.getBoundingClientRect();
  };

  layer.addEventListener("pointerdown", onPointerDown);
  layer.addEventListener("pointermove", onPointerMove);
  layer.addEventListener("pointerup", onPointerUp);
  layer.addEventListener("pointercancel", onPointerUp);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onInputKey);
  input.addEventListener("blur", onInputBlur);
  input.addEventListener("focus", onInputFocus);
  if (!embedded) {
    window.addEventListener("keydown", onWindowKey);
    layer.addEventListener("wheel", onWheel, { passive: false });
  }
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  ro.observe(page);

  const boot = async () => {
    try {
      print = createPrint();
    } catch {
      print = null;
    }
    if (!print) {
      onFail?.();
      return;
    }
    const load = (src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image.decode().then(() => image).catch(() => image);
    };
    const [dusk, sea, cover] = await Promise.all([
      load(sources.dusk),
      load(sources.sea),
      load(sources.album),
      document.fonts?.load?.("32px CutoutTinos").catch(() => {}),
      document.fonts?.load?.("italic 32px CutoutTinos").catch(() => {}),
    ]);
    if (destroyed) return;
    images = { dusk, sea, album: cover };
    width = page.clientWidth;
    height = page.clientHeight;
    pageRect = page.getBoundingClientRect();
    angle = readAngle();
    renderPrint();
    showSheets();
    const first = makeStrip(DEFAULT_LINE, width * 0.5, height * 0.34, { base: -0.8, scale: 1, paper: "news" });
    first.el.style.zIndex = "3";
    const second = makeStrip("keep looking.", width * 0.64, height * 0.47, { base: 2.2, scale: 0.72, paper: "sky" });
    second.el.style.zIndex = "2";
    onReady?.();
    const thumbs = {};
    for (const p of PRINTS) {
      const img = p.id === "album" ? images.album : p.id === "dusk" ? images.dusk : images.sea;
      thumbs[p.id] = composeThumb(p, img, album, 56, 72);
    }
    if (!destroyed) onThumbs?.(thumbs);
  };
  boot();

  return {
    async setSound(on) {
      soundWanted = on;
      if (on && !audio) audio = createPaperAudio();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    setPrint(id) {
      if (id === printId) return;
      printId = id;
      if (!images) return;
      const back = 1 - front;
      renderPrint(back);
      front = back;
      showSheets();
      ensureAudio().then(() => audio?.sheet(0));
    },
    setPaper(id) {
      paperId = id;
      const strip = active && !active.removing && strips.includes(active) ? active : null;
      if (!strip) return;
      if (strip.paperId === id) return;
      dressStrip(strip, id);
      strip.paper.style.clipPath = cutPath(rnd);
      strip.base += rnd() * 1.2 - 0.6;
      ensureAudio().then(() => audio?.snip(pan(strip.x)));
      wake();
    },
    newLine() {
      ensureAudio();
      if (draft && draft.text.trim()) {
        commitDraft();
        input.value = "";
      }
      if (document.activeElement === input) openDraft();
      else input.focus({ preventScroll: true });
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(renderTimer);
      ro.disconnect();
      layer.removeEventListener("pointerdown", onPointerDown);
      layer.removeEventListener("pointermove", onPointerMove);
      layer.removeEventListener("pointerup", onPointerUp);
      layer.removeEventListener("pointercancel", onPointerUp);
      layer.removeEventListener("wheel", onWheel);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onInputKey);
      input.removeEventListener("blur", onInputBlur);
      input.removeEventListener("focus", onInputFocus);
      window.removeEventListener("keydown", onWindowKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
      for (const strip of strips) strip.el.remove();
      strips.length = 0;
      print?.destroy();
      audio?.destroy();
    },
  };
}
