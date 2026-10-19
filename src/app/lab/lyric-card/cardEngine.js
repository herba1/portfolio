import { createCardSound } from "./cardAudio";

const UNIT_W = 1000;
const UNIT_H = 1250;
const STEP = 0.25;
const LEAD = 0.5;
const HOLD = 1.4;
const SANS = "LyricSans";
const SERIF = "LyricSerif";

const SPECS = {
  block: { sans: 58, serif: 70, lead: 1.12, measure: 470, align: "justify", flow: true },
  caption: { sans: 34, serif: 42, lead: 1.3, measure: 780, align: "center", flow: false },
  build: { sans: 60, serif: 72, lead: 1.12, measure: 470, align: "justify", flow: true },
  big: { sans: 100, serif: 118, lead: 1.02, measure: 420, align: "left", flow: true },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fontOf = (size, serif) => `400 ${size}px "${serif ? SERIF : SANS}", ${serif ? "Georgia, serif" : "Arial, sans-serif"}`;

const images = new Map();
function loadImage(src) {
  if (!images.has(src)) {
    images.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      }),
    );
  }
  return images.get(src);
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function buildBase(img, photo, W, H, bloomIn) {
  const bloom = photo.night ? bloomIn : bloomIn * 0.55;
  const out = canvasOf(W, H);
  const o = out.getContext("2d");
  const soft = canvasOf(W * 0.62, H * 0.62);
  const s = soft.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(soft.width / img.naturalWidth, soft.height / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = clamp(soft.width / 2 - dw * photo.focus[0], soft.width - dw, 0);
  const dy = clamp(soft.height / 2 - dh * photo.focus[1], soft.height - dh, 0);
  s.imageSmoothingQuality = "high";
  s.drawImage(img, dx, dy, dw, dh);
  const sw = soft.width;
  const sh = soft.height;
  const sctx = s;
  const frame = sctx.getImageData(0, 0, sw, sh);
  const px = frame.data;
  const lift = photo.night ? 0.035 : 0.06;
  const sat = photo.night ? 0.86 : 0.82;
  const expo = photo.night ? 0.8 : 0.96;
  const gamma = photo.night ? 1.28 : 1.06;
  const N = 1024;
  const lutR = new Float32Array(N);
  const lutG = new Float32Array(N);
  const lutB = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const v = i / (N - 1);
    lutR[i] = (lift + Math.pow(clamp(v * expo, 0, 1), gamma) * 1.03 * (1 - lift)) * 255;
    lutG[i] = (lift * 0.94 + Math.pow(clamp(v * expo, 0, 1), gamma) * (1 - lift)) * 255;
    lutB[i] = (lift * 1.1 + Math.pow(clamp(v * expo, 0, 1), gamma * 0.96) * 0.94 * (1 - lift)) * 255;
  }
  const q = (N - 1) / 255;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px[i] = lutR[clamp(Math.round((lum + (r - lum) * sat) * q), 0, N - 1)];
    px[i + 1] = lutG[clamp(Math.round((lum + (g - lum) * sat) * q), 0, N - 1)];
    px[i + 2] = lutB[clamp(Math.round((lum + (b - lum) * sat) * q), 0, N - 1)];
  }
  sctx.putImageData(frame, 0, 0);
  const w = out.width;
  const h = out.height;
  o.imageSmoothingQuality = "high";
  o.drawImage(soft, 0, 0, w, h);
  const vignette = o.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, Math.hypot(w / 2, h * 0.5));
  vignette.addColorStop(0, "rgb(255 255 255)");
  vignette.addColorStop(0.45, "rgb(246 246 246)");
  vignette.addColorStop(0.7, "rgb(214 214 214)");
  vignette.addColorStop(0.88, "rgb(176 176 176)");
  vignette.addColorStop(1, "rgb(148 148 148)");
  o.globalCompositeOperation = "multiply";
  o.fillStyle = vignette;
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = "source-over";
  const threshold = photo.night ? 0.58 : 0.84;
  if (bloom > 0.01) {
    for (const [div, gainK] of [
      [10, 1],
      [28, 0.9],
    ]) {
      const small = canvasOf(w / div, h / div);
      const sc = small.getContext("2d", { willReadFrequently: true });
      sc.drawImage(soft, 0, 0, small.width, small.height);
      const sf = sc.getImageData(0, 0, small.width, small.height);
      const sp = sf.data;
      for (let i = 0; i < sp.length; i += 4) {
        const lum = (0.2126 * sp[i] + 0.7152 * sp[i + 1] + 0.0722 * sp[i + 2]) / 255;
        const k = Math.pow(clamp((lum - threshold) / (1 - threshold), 0, 1), 1.5) * 1.6;
        sp[i] = clamp(sp[i] * k * 1.08, 0, 255);
        sp[i + 1] = clamp(sp[i + 1] * k * 0.96, 0, 255);
        sp[i + 2] = clamp(sp[i + 2] * k * 0.84, 0, 255);
      }
      sc.putImageData(sf, 0, 0);
      o.globalCompositeOperation = "lighter";
      o.globalAlpha = clamp(bloom * gainK, 0, 1);
      o.imageSmoothingQuality = "high";
      o.drawImage(small, 0, 0, w, h);
    }
    o.globalCompositeOperation = "screen";
    o.globalAlpha = bloom * 0.08;
    const wash = canvasOf(w / 16, h / 16);
    wash.getContext("2d").drawImage(soft, 0, 0, wash.width, wash.height);
    o.drawImage(wash, 0, 0, w, h);
    o.globalAlpha = 1;
    o.globalCompositeOperation = "source-over";
  }
  return out;
}

function makeGrain() {
  const c = canvasOf(256, 256);
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  let seed = 777;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const a = seed / 4294967296;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const b = seed / 4294967296;
    const n = clamp(128 + (a + b - 1) * 90, 0, 255);
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function layoutWords(lines, layout, serif, measure, textY = 0.47) {
  const spec = SPECS[layout] || SPECS.block;
  let size = serif ? spec.serif : spec.sans;
  for (let i = 0; i < 10; i += 1) {
    const plan = layoutAt(lines, layout, serif, measure, textY, size);
    if (plan.height <= UNIT_H - 200 && plan.right <= UNIT_W - 60) return plan;
    size *= 0.9;
  }
  return layoutAt(lines, layout, serif, measure, textY, size);
}

function layoutAt(lines, layout, serif, measure, textY, size) {
  const spec = SPECS[layout] || SPECS.block;
  const scale = size / (serif ? spec.serif : spec.sans);
  measure.font = fontOf(size, serif);
  const space = measure.measureText(" ").width;
  const tokens = [];
  lines.forEach((line, li) => {
    const words = line.split(/\s+/).filter(Boolean);
    words.forEach((word, wi) => tokens.push({ word, width: measure.measureText(word).width, lineEnd: wi === words.length - 1, lyric: li }));
  });
  const widest = tokens.reduce((m, t) => Math.max(m, t.width), 0);
  const M = Math.max(spec.measure * scale, widest);
  const rows = [];
  let row = [];
  let rowW = 0;
  for (const t of tokens) {
    const next = row.length ? rowW + space + t.width : t.width;
    if (row.length && next > M) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    rowW = row.length ? rowW + space + t.width : t.width;
    row.push(t);
    if (!spec.flow && t.lineEnd) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
  }
  if (row.length) rows.push(row);
  const lh = size * spec.lead;
  const total = rows.length * lh;
  let top;
  let left;
  if (layout === "caption") top = UNIT_H * 0.84 - total;
  else if (layout === "build") top = 92;
  else top = clamp(UNIT_H * textY - total / 2, 80, UNIT_H - 80 - total);
  if (layout === "build") left = 72;
  else if (layout === "big") left = 84;
  else left = (UNIT_W - M) / 2;
  const items = [];
  rows.forEach((r, ri) => {
    const natural = r.reduce((s, t) => s + t.width, 0) + space * (r.length - 1);
    const last = ri === rows.length - 1;
    let gap = space;
    let x = left;
    if (spec.align === "justify" && r.length > 1 && !(last && natural < M * 0.7)) gap = (M - r.reduce((s, t) => s + t.width, 0)) / (r.length - 1);
    if (spec.align === "center") x = (UNIT_W - natural) / 2;
    const baselineY = top + ri * lh + size * 0.86;
    for (const t of r) {
      items.push({ word: t.word, x, y: baselineY, lineEnd: t.lineEnd, width: t.width });
      x += t.width + gap;
    }
  });
  let at = LEAD;
  for (const item of items) {
    item.at = at;
    at += item.lineEnd ? STEP * 2 : STEP;
  }
  const right = items.reduce((m, it) => Math.max(m, it.x + it.width), 0);
  return { items, size, serif, layout, height: total, right, end: items.length ? items[items.length - 1].at : 0 };
}

function drawWords(ctx, W, H, plan, elapsed) {
  const k = W / UNIT_W;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.font = fontOf(plan.size, plan.serif);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = `rgba(0, 0, 0, ${plan.shade})`;
  ctx.shadowBlur = 14 * k;
  ctx.textBaseline = "alphabetic";
  for (const item of plan.items) {
    const age = elapsed - item.at;
    if (age < 0) continue;
    if (plan.layout === "big") {
      const pop = age < 1 / 30 ? 1.14 : age < 2 / 30 ? 1.05 : 1;
      if (pop !== 1) {
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.scale(pop, pop);
        ctx.fillText(item.word, 0, 0);
        ctx.restore();
        continue;
      }
      ctx.fillText(item.word, item.x, item.y);
    } else {
      ctx.globalAlpha = age < 1 / 30 ? 0.55 : 1;
      ctx.fillText(item.word, item.x, item.y);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function surfacesFor(W, H) {
  const text = canvasOf(W, H);
  return {
    text,
    tctx: text.getContext("2d"),
    q4: canvasOf(W / 4, H / 4),
    q12: canvasOf(W / 12, H / 12),
  };
}

function compose(ctx, W, H, base, grain, surf, plan, elapsed, opts) {
  const { drift = 0, time = 0, grainAmount, bloom, grainSeed = 0 } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#0b0a0c";
  ctx.fillRect(0, 0, W, H);
  if (base) {
    const amp = W * 0.008 * drift;
    const ox = amp * (Math.sin(time * 0.83) + 0.5 * Math.sin(time * 2.1 + 1.3));
    const oy = amp * (Math.cos(time * 0.71 + 0.4) + 0.4 * Math.sin(time * 1.7));
    const rot = 0.0025 * drift * Math.sin(time * 0.57 + 2);
    ctx.save();
    ctx.translate(W / 2 + ox, H / 2 + oy);
    ctx.rotate(rot);
    ctx.scale(1.045, 1.045);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, -W / 2, -H / 2, W, H);
    ctx.restore();
  }
  const { text, tctx, q4, q12 } = surf;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, text.width, text.height);
  drawWords(tctx, W, H, plan, elapsed);
  if (bloom > 0.01) {
    const c4 = q4.getContext("2d");
    c4.clearRect(0, 0, q4.width, q4.height);
    c4.drawImage(text, 0, 0, q4.width, q4.height);
    const c12 = q12.getContext("2d");
    c12.clearRect(0, 0, q12.width, q12.height);
    c12.drawImage(q4, 0, 0, q12.width, q12.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = clamp(bloom * 0.75, 0, 1);
    ctx.drawImage(q12, 0, 0, W, H);
    ctx.globalAlpha = clamp(bloom * 0.6, 0, 1);
    ctx.drawImage(q4, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = 0.96;
  ctx.drawImage(text, 0, 0);
  ctx.globalAlpha = 1;
  if (grainAmount > 0.01) {
    const tile = Math.max(256, Math.round(W / 3.2));
    const ox = -((grainSeed * 97) % tile);
    const oy = -((grainSeed * 61) % tile);
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = clamp(grainAmount * 0.5, 0, 1);
    for (let y = oy; y < H; y += tile) for (let x = ox; x < W; x += tile) ctx.drawImage(grain, x, y, tile, tile);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
}

export function createCard(host, { photos, onState }) {
  const canvas = document.createElement("canvas");
  canvas.className = "lyric-card-canvas";
  canvas.setAttribute("role", "img");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const measure = document.createElement("canvas").getContext("2d");
  const grain = makeGrain();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let surf = null;
  let state = null;
  let plan = { items: [], size: 50, serif: false, layout: "block", end: 0, shade: 0.2 };
  let base = null;
  let baseKey = "";
  let building = 0;
  let start = 0;
  let playing = false;
  let raf = 0;
  let visible = true;
  let destroyed = false;
  let fontsReady = false;
  let pending = 0;
  let sound = null;
  let beatFaded = false;
  let lastGrain = 0;
  let grainSeed = 0;

  const photoOf = (id) => photos.find((p) => p.id === id) || photos[0];
  const total = () => plan.end + HOLD;

  const describe = () => {
    const words = plan.items.map((i) => i.word).join(" ");
    canvas.setAttribute("aria-label", words ? `Lyric card: ${words}` : "Lyric card with no lines picked");
  };

  const relayout = () => {
    if (!state || !fontsReady) return;
    const photo = photoOf(state.photo);
    plan = { ...layoutWords(state.lines, state.layout, state.serif, measure, photo.textY), shade: photo.night ? 0.22 : 0.42 };
    describe();
  };

  const ensureBase = async () => {
    if (!state || !W) return;
    const photo = photoOf(state.photo);
    const key = `${photo.id}|${canvas.width}x${canvas.height}|${state.bloom.toFixed(2)}`;
    if (key === baseKey) return;
    const ticket = ++building;
    const img = await loadImage(photo.src).catch(() => null);
    if (!img || destroyed || ticket !== building) return;
    base = buildBase(img, photo, canvas.width, canvas.height, state.bloom);
    baseKey = key;
    if (!playing) draw();
    onState?.({ loaded: true });
  };

  const elapsedNow = (now) => (playing ? (now - start) / 1000 : Infinity);

  const draw = (now = performance.now()) => {
    if (!surf || !state) return;
    const elapsed = elapsedNow(now);
    const t = playing ? elapsed : 0;
    const tail = playing ? clamp((total() - elapsed) / 0.9, 0, 1) : 0;
    const drift = playing ? Math.min(1, elapsed / 0.4) * tail : 0;
    if (playing && now - lastGrain > 83) {
      lastGrain = now;
      grainSeed = (grainSeed + 1) % 997;
    }
    compose(ctx, canvas.width, canvas.height, base, grain, surf, plan, elapsed, {
      drift,
      time: t,
      grainAmount: state.grain,
      bloom: state.bloom,
      grainSeed,
    });
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const elapsed = elapsedNow(now);
    if (playing && !beatFaded && elapsed > total() - 0.7) {
      beatFaded = true;
      sound?.fadeBeat(0.9);
    }
    if (playing && elapsed >= total()) {
      playing = false;
      onState?.({ playing: false });
    }
    draw(now);
    if (playing && visible) raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !visible) return;
    raf = requestAnimationFrame(frame);
  };

  const play = () => {
    clearTimeout(pending);
    pending = 0;
    if (!plan.items.length) {
      playing = false;
      draw();
      return;
    }
    playing = true;
    beatFaded = false;
    start = performance.now();
    sound?.startBeat();
    onState?.({ playing: true });
    wake();
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w;
    H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    surf = surfacesFor(canvas.width, canvas.height);
    draw();
    ensureBase();
  };

  const ro = new ResizeObserver(() => resize());
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible && playing) wake();
  });
  io.observe(host);
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible && playing) wake();
  };
  document.addEventListener("visibilitychange", onVis);

  const ready = (async () => {
    if (document.fonts?.load) await Promise.all([document.fonts.load(fontOf(40, false)), document.fonts.load(fontOf(40, true))]).catch(() => {});
    if (destroyed) return;
    fontsReady = true;
    ro.observe(host);
    resize();
    relayout();
    await ensureBase();
    draw();
  })();

  return {
    ready,
    set(next, { replay = false } = {}) {
      const prev = state;
      state = next;
      relayout();
      ensureBase();
      if (replay) {
        clearTimeout(pending);
        pending = setTimeout(play, 160);
      } else if (!playing) draw();
      if (prev && prev.grain !== next.grain && !playing) draw();
    },
    replay() {
      play();
    },
    async exportBlob() {
      await ready;
      const EW = 1080;
      const EH = 1350;
      const photo = photoOf(state.photo);
      const img = await loadImage(photo.src);
      const out = canvasOf(EW, EH);
      const octx = out.getContext("2d", { willReadFrequently: true });
      const eb = buildBase(img, photo, EW, EH, state.bloom);
      compose(octx, EW, EH, eb, grain, surfacesFor(EW, EH), plan, Infinity, { grainAmount: state.grain, bloom: state.bloom, grainSeed: 3 });
      sound?.shutter();
      return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    },
    tick(on) {
      sound?.select(on);
    },
    async setSound(on) {
      if (on && !sound) sound = createCardSound();
      if (!sound) return false;
      const result = await sound.setEnabled(on);
      if (result && playing) sound.startBeat();
      return result;
    },
    destroy() {
      destroyed = true;
      clearTimeout(pending);
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      sound?.destroy();
      sound = null;
      canvas.remove();
    },
  };
}
