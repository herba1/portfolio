import { createCardSound } from "./cardAudio";

const UNIT_W = 1000;
const UNIT_H = 1250;
const STEP = 0.25;
const LEAD = 0.5;
const HOLD = 1.75;
const BAR = 0.5;
const SANS = "LyricSans";
const SERIF = "LyricSerif";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fontOf = (size, face, italic = false) =>
  face === "serif" ? `${italic ? "italic " : ""}400 ${size}px "${SERIF}", Georgia, serif` : `400 ${size}px "${SANS}", Arial, sans-serif`;

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

function buildBase(img, photo, W, H) {
  const { grade, threshold, bloom } = photo;
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
  const frame = s.getImageData(0, 0, sw, sh);
  const px = frame.data;
  const { lift, sat, expo, gamma, tint } = grade;
  const N = 1024;
  const luts = tint.map((k, c) => {
    const lut = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      const v = i / (N - 1);
      lut[i] = clamp((lift * (c === 2 ? 1.1 : 1) + Math.pow(clamp(v * expo, 0, 1), gamma) * (1 - lift)) * k, 0, 1) * 255;
    }
    return lut;
  });
  const q = (N - 1) / 255;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px[i] = luts[0][clamp(Math.round((lum + (r - lum) * sat) * q), 0, N - 1)];
    px[i + 1] = luts[1][clamp(Math.round((lum + (g - lum) * sat) * q), 0, N - 1)];
    px[i + 2] = luts[2][clamp(Math.round((lum + (b - lum) * sat) * q), 0, N - 1)];
  }
  s.putImageData(frame, 0, 0);
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
    o.drawImage(small, 0, 0, w, h);
  }
  o.globalCompositeOperation = "screen";
  o.globalAlpha = bloom * 0.08;
  const wash = canvasOf(w / 16, h / 16);
  wash.getContext("2d").drawImage(soft, 0, 0, wash.width, wash.height);
  o.drawImage(wash, 0, 0, w, h);
  o.globalAlpha = 1;
  o.globalCompositeOperation = "source-over";
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

function tokensOf(lines, measure) {
  const tokens = [];
  lines.forEach((line, li) => {
    const words = line.split(/\s+/).filter(Boolean);
    words.forEach((word, wi) => tokens.push({ word, width: measure.measureText(word).width, lineEnd: wi === words.length - 1, lyric: li }));
  });
  return tokens;
}

function justifyBreaks(tokens, M, space, whole) {
  const n = tokens.length;
  const best = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    let ink = 0;
    for (let i = j - 1; i >= 0; i -= 1) {
      ink += tokens[i].width;
      const count = j - i;
      if (count > 1 && ink + space * 0.86 * (count - 1) > M) break;
      if (count === 1 && ink > M) break;
      let cost;
      if (count === 1) {
        const fill = ink / M;
        cost = whole && n === 1 ? (1 - fill) * 40 : fill > 0.62 ? 30 + (1 - fill) * 120 : whole && j === n && fill > 0.3 ? 48 : 900;
      } else {
        const ratio = (M - ink) / ((count - 1) * space);
        if (j === n && ratio > 2.2) cost = ink + space * (count - 1) > M * 0.34 ? 6 : 60;
        else {
          cost = (ratio - 1.5) * (ratio - 1.5) * 6;
          if (ratio > 2.8) cost += (ratio - 2.8) * (ratio - 2.8) * 80;
        }
      }
      const total = best[i] + cost + 8;
      if (total < best[j]) {
        best[j] = total;
        from[j] = i;
      }
    }
  }
  if (!Number.isFinite(best[n])) return null;
  const rows = [];
  let j = n;
  while (j > 0) {
    const i = from[j];
    rows.unshift(tokens.slice(i, j));
    j = i;
  }
  return { rows, cost: best[n] };
}

function balanceBreaks(tokens, M, space) {
  const total = tokens.reduce((s, t) => s + t.width, 0) + space * (tokens.length - 1);
  const k = Math.max(1, Math.ceil(total / M));
  const target = total / k;
  const n = tokens.length;
  const best = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    let w = -space;
    for (let i = j - 1; i >= 0; i -= 1) {
      w += tokens[i].width + space;
      if (w > M && j - i > 1) break;
      const d = (w - target) / target;
      const total2 = best[i] + d * d * 100 + 20 + (j - i === 1 && n > 1 ? 40 : 0);
      if (total2 < best[j]) {
        best[j] = total2;
        from[j] = i;
      }
    }
  }
  const rows = [];
  let j = n;
  while (j > 0) {
    const i = from[j];
    rows.unshift(tokens.slice(i, j));
    j = i;
  }
  return rows;
}

function blockAt(lines, measure, size) {
  let pick = null;
  measure.font = fontOf(size, "sans");
  const space = measure.measureText(" ").width;
  const tokens = tokensOf(lines, measure);
  const lead = Math.round(size * 1.1);
  for (let M = 560; M <= 800; M += 40) {
    const result = justifyBreaks(tokens, M, space, true);
    if (!result) continue;
    const height = result.rows.length * lead;
    if (height > UNIT_H * 0.56 || result.rows.length > 5) continue;
    const ratios = result.rows
      .filter((r) => r.length > 1)
      .map((r) => (M - r.reduce((sum, t) => sum + t.width, 0)) / ((r.length - 1) * space))
      .filter((r, i, all) => !(i === all.length - 1 && r > 2.2));
    const spread = ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0;
    const lone = result.rows.length === 1 ? (M - result.rows[0].reduce((sum, t) => sum + t.width, 0)) * 0.2 : 0;
    const score = result.cost + spread * spread * 12 + Math.abs(M - 680) * 0.03 + lone;
    if (!pick || score < pick.score) pick = { ...result, size, lead, space, score, M };
  }
  return pick;
}

const blockSizes = new WeakMap();
function sharedBlockSize(verses, measure) {
  if (blockSizes.has(verses)) return blockSizes.get(verses);
  let chosen = 64;
  for (let size = 132; size >= 64; size -= 2) {
    const picks = verses.map((v) => blockAt(v.lines, measure, size));
    if (picks.every((p) => p && p.score < 140)) {
      chosen = size;
      break;
    }
  }
  blockSizes.set(verses, chosen);
  return chosen;
}

function planBlock(lines, measure, y, verses) {
  let pick = null;
  if (verses) {
    for (let size = sharedBlockSize(verses, measure); size >= 40 && !pick; size -= 2) pick = blockAt(lines, measure, size);
  } else {
    for (let size = 132; size >= 40 && !pick; size -= 2) pick = blockAt(lines, measure, size);
  }
  const { rows, size, lead, M } = pick;
  const left = (UNIT_W - M) / 2;
  const top = clamp(UNIT_H * y - (rows.length * lead) / 2, 96, UNIT_H - 96 - rows.length * lead);
  const items = [];
  rows.forEach((row, ri) => {
    const ink = row.reduce((sum, t) => sum + t.width, 0);
    const stretch = row.length > 1 ? (M - ink) / (row.length - 1) : 0;
    const ragged = rows.length > 1 && ri === rows.length - 1 && stretch / pick.space > 2.2;
    const gap = ragged ? pick.space : stretch;
    let x = row.length > 1 || rows.length > 1 ? left : (UNIT_W - ink) / 2;
    const baseline = top + ri * lead + size * 0.8;
    for (const t of row) {
      items.push({ ...t, x, y: baseline, italic: false });
      x += t.width + gap;
    }
  });
  return { items, size, face: "sans", shade: 0.22 };
}

function planSerif(lines, measure, y) {
  const M = 800;
  let chosen = null;
  for (let size = 136; size >= 88; size *= 0.97) {
    measure.font = fontOf(size, "serif", true);
    const space = measure.measureText(" ").width * 1.06;
    const fits = lines.every((line) => measure.measureText(line).width + space * 0.06 * line.length <= M);
    const lead = Math.round(size * 1.0);
    if (!fits || lines.length * lead > UNIT_H * 0.56) continue;
    measure.font = fontOf(size, "serif");
    const rows = lines.map((line, li) => tokensOf([line], measure).map((t) => ({ ...t, lyric: li })));
    chosen = { rows, size, space: measure.measureText(" ").width * 1.06, lead };
    break;
  }
  for (let size = 150; size >= 48 && !chosen; size *= 0.95) {
    measure.font = fontOf(size, "serif");
    const space = measure.measureText(" ").width * 1.06;
    const rows = [];
    lines.forEach((line, li) => {
      const tokens = tokensOf([line], measure).map((t) => ({ ...t, lyric: li }));
      rows.push(...balanceBreaks(tokens, M, space));
    });
    const tooWide = rows.some((r) => r.reduce((s, t) => s + t.width, 0) + space * (r.length - 1) > M);
    const lead = Math.round(size * 1.0);
    if (tooWide || rows.length > 5 || rows.length * lead > UNIT_H * 0.56) continue;
    chosen = { rows, size, space, lead };
    break;
  }
  const { rows, size, space, lead } = chosen;
  const top = clamp(UNIT_H * y - (rows.length * lead) / 2, 96, UNIT_H - 96 - rows.length * lead);
  const lastLyric = lines.length - 1;
  const items = [];
  rows.forEach((row, ri) => {
    const italic = lines.length > 1 && row[0].lyric === lastLyric;
    measure.font = fontOf(size, "serif", italic);
    const widths = row.map((t) => measure.measureText(t.word).width);
    const natural = widths.reduce((s, w) => s + w, 0) + space * (row.length - 1);
    let x = (UNIT_W - natural) / 2;
    const baseline = top + ri * lead + size * 0.78;
    row.forEach((t, i) => {
      items.push({ ...t, width: widths[i], x, rel: x - (UNIT_W - natural) / 2, row: ri, y: baseline, italic });
      x += widths[i] + space;
    });
  });
  return { items, size, face: "serif", shade: 0.26, center: true };
}

function planCaption(lines, measure) {
  const size = 38;
  const M = 780;
  measure.font = fontOf(size, "sans");
  const space = measure.measureText(" ").width;
  const rows = [];
  lines.forEach((line, li) => {
    const tokens = tokensOf([line], measure).map((t) => ({ ...t, lyric: li }));
    rows.push(...balanceBreaks(tokens, M, space));
  });
  const lead = 50;
  const bottom = UNIT_H * 0.86;
  const top = bottom - rows.length * lead;
  const items = [];
  rows.forEach((row, ri) => {
    const natural = row.reduce((s, t) => s + t.width, 0) + space * (row.length - 1);
    let x = (UNIT_W - natural) / 2;
    const baseline = top + ri * lead + size * 0.86;
    for (const t of row) {
      items.push({ ...t, x, rel: x - (UNIT_W - natural) / 2, row: ri, y: baseline, italic: false });
      x += t.width + space;
    }
  });
  return { items, size, face: "sans", shade: 0.5, center: true };
}

export function planVerse(verse, style, measure, verses) {
  const plan = style === "serif" ? planSerif(verse.lines, measure, verse.y) : style === "caption" ? planCaption(verse.lines, measure) : planBlock(verse.lines, measure, verse.y, verses);
  let at = LEAD;
  for (const item of plan.items) {
    item.at = at;
    at += item.lineEnd ? STEP * 2 : STEP;
  }
  const last = plan.items.length ? plan.items[plan.items.length - 1].at : 0;
  plan.length = Math.ceil((last + HOLD) / BAR) * BAR;
  return plan;
}

function drawWords(ctx, W, plan, elapsed) {
  const k = W / UNIT_W;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = `rgba(0, 0, 0, ${plan.shade})`;
  ctx.shadowBlur = 16 * k;
  ctx.textBaseline = "alphabetic";
  if ("fontKerning" in ctx) ctx.fontKerning = "normal";
  let font = "";
  const reach = new Map();
  if (plan.center) {
    for (const item of plan.items) if (elapsed >= item.at) reach.set(item.row, item.rel + item.width);
  }
  for (const item of plan.items) {
    if (elapsed < item.at) continue;
    const x = plan.center ? (UNIT_W - reach.get(item.row)) / 2 + item.rel : item.x;
    const next = fontOf(plan.size, plan.face, item.italic);
    if (next !== font) {
      ctx.font = next;
      font = next;
    }
    ctx.fillText(item.word, x, item.y);
  }
  ctx.restore();
}

function surfacesFor(W, H) {
  const text = canvasOf(W, H);
  return { text, tctx: text.getContext("2d"), q4: canvasOf(W / 4, H / 4), q12: canvasOf(W / 12, H / 12) };
}

function compose(ctx, W, H, base, grain, surf, plan, elapsed, opts) {
  const { drift = 0, time = 0, grainSeed = 0, pulse = 0 } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#0b0a0c";
  ctx.fillRect(0, 0, W, H);
  if (base) {
    const amp = W * 0.007 * drift;
    const ox = amp * (Math.sin(time * 0.83) + 0.5 * Math.sin(time * 2.1 + 1.3));
    const oy = amp * (Math.cos(time * 0.71 + 0.4) + 0.4 * Math.sin(time * 1.7));
    const rot = 0.002 * drift * Math.sin(time * 0.57 + 2);
    const zoom = 1.045 + pulse * 0.004;
    ctx.save();
    ctx.translate(W / 2 + ox, H / 2 + oy);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, -W / 2, -H / 2, W, H);
    ctx.restore();
    if (pulse > 0.01) {
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = pulse * 0.05;
      ctx.fillStyle = "#fff6ec";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }
  const { text, tctx, q4, q12 } = surf;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, text.width, text.height);
  drawWords(tctx, W, plan, elapsed);
  const bloom = 0.34 + pulse * 0.3;
  const c4 = q4.getContext("2d");
  c4.clearRect(0, 0, q4.width, q4.height);
  c4.drawImage(text, 0, 0, q4.width, q4.height);
  const c12 = q12.getContext("2d");
  c12.clearRect(0, 0, q12.width, q12.height);
  c12.drawImage(q4, 0, 0, q12.width, q12.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = clamp(bloom * 0.7, 0, 1);
  ctx.drawImage(q12, 0, 0, W, H);
  ctx.globalAlpha = clamp(bloom * 0.45, 0, 1);
  ctx.drawImage(q4, 0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.97;
  ctx.drawImage(text, 0, 0);
  ctx.globalAlpha = 1;
  const tile = Math.max(256, Math.round(W / 3.2));
  const gx = -((grainSeed * 97) % tile);
  const gy = -((grainSeed * 61) % tile);
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.22;
  for (let y = gy; y < H; y += tile) for (let x = gx; x < W; x += tile) ctx.drawImage(grain, x, y, tile, tile);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

export function createCard(host, { verses, photos, onVerse }) {
  const canvas = document.createElement("canvas");
  canvas.className = "lyric-card-canvas";
  canvas.setAttribute("role", "img");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const measure = document.createElement("canvas").getContext("2d");
  const grain = makeGrain();

  let surf = null;
  let style = "block";
  let index = 0;
  let plan = null;
  const bases = new Map();
  let verseStart = 0;
  let clock = 0;
  let last = 0;
  let raf = 0;
  let visible = true;
  let destroyed = false;
  let fontsReady = false;
  let sound = null;
  let lastGrain = 0;
  let grainSeed = 0;

  const describe = () => {
    canvas.setAttribute("aria-label", `Lyric card: ${verses[index].lines.join(" / ")}`);
  };

  const ensureBases = async () => {
    const ids = [...new Set(verses.map((v) => v.photo))];
    const order = [verses[index].photo, ...ids.filter((id) => id !== verses[index].photo)];
    for (const id of order) {
      const key = `${id}|${canvas.width}x${canvas.height}`;
      if (bases.has(key)) continue;
      const img = await loadImage(photos[id].src).catch(() => null);
      if (!img || destroyed) return;
      bases.set(key, buildBase(img, photos[id], canvas.width, canvas.height));
      if (!raf) draw();
    }
  };

  const currentBase = () => bases.get(`${verses[index].photo}|${canvas.width}x${canvas.height}`) || null;

  const replan = () => {
    if (!fontsReady) return;
    plan = planVerse(verses[index], style, measure, verses);
    describe();
  };

  const go = (next, at = clock) => {
    index = ((next % verses.length) + verses.length) % verses.length;
    verseStart = at;
    replan();
    onVerse?.(index);
  };

  const draw = () => {
    if (!surf || !plan) return;
    const elapsed = clock - verseStart;
    let pulse = 0;
    for (const item of plan.items) {
      const age = elapsed - item.at;
      if (age >= 0 && age < 0.3) pulse = Math.max(pulse, Math.exp(-age / 0.07));
    }
    compose(ctx, canvas.width, canvas.height, currentBase(), grain, surf, plan, elapsed, {
      drift: 1,
      time: clock,
      grainSeed,
      pulse,
    });
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    if (plan) {
      const elapsed = clock - verseStart;
      if (elapsed >= plan.length) go(index + 1, verseStart + plan.length);
    }
    if (now - lastGrain > 83) {
      lastGrain = now;
      grainSeed = (grainSeed + 1) % 997;
    }
    draw();
    raf = requestAnimationFrame(frame);
  };

  const syncBeat = () => {
    if (!sound?.live()) return;
    const delay = BAR - (clock % BAR);
    sound.startBeat(delay < 0.04 ? delay + BAR : delay);
  };

  const wake = () => {
    if (destroyed || raf || !visible || !fontsReady) return;
    syncBeat();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (cw === canvas.width && ch === canvas.height && surf) return;
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    surf = surfacesFor(cw, ch);
    for (const key of [...bases.keys()]) if (!key.endsWith(`|${cw}x${ch}`)) bases.delete(key);
    draw();
    ensureBases();
  };

  const ro = new ResizeObserver(() => resize());
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) wake();
    else sound?.fadeBeat(0.2);
  });
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible) wake();
    else sound?.fadeBeat(0.2);
  };
  document.addEventListener("visibilitychange", onVis);

  const ready = (async () => {
    if (document.fonts?.load) {
      await Promise.all([document.fonts.load(fontOf(40, "sans")), document.fonts.load(fontOf(40, "serif")), document.fonts.load(fontOf(40, "serif", true))]).catch(() => {});
    }
    if (destroyed) return;
    fontsReady = true;
    replan();
    describe();
    ro.observe(host);
    resize();
    await loadImage(photos[verses[index].photo].src).catch(() => null);
    await ensureBases();
    if (destroyed) return;
    io.observe(host);
    wake();
  })();

  const bar = () => Math.ceil((clock + 0.02) / BAR) * BAR;

  return {
    ready,
    setStyle(next) {
      if (next === style) return;
      style = next;
      go(index, bar());
    },
    next() {
      go(index + 1, bar());
    },
    prev() {
      go(index - 1, bar());
    },
    async exportBlob() {
      await ready;
      const EW = 1080;
      const EH = 1350;
      const verse = verses[index];
      const photo = photos[verse.photo];
      const img = await loadImage(photo.src);
      const out = canvasOf(EW, EH);
      const octx = out.getContext("2d");
      const eb = buildBase(img, photo, EW, EH);
      compose(octx, EW, EH, eb, grain, surfacesFor(EW, EH), plan, Infinity, { drift: 0, grainSeed: 3 });
      sound?.shutter();
      return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    },
    async setSound(on) {
      if (on && !sound) sound = createCardSound();
      if (!sound) return false;
      const result = await sound.setEnabled(on);
      if (result) syncBeat();
      return result;
    },
    destroy() {
      destroyed = true;
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
