const ATLAS_LIMIT = 2048;
const PAD_EM = 0.42;
const STEM_EM = 0.118;
const TRACKING_K = 0.043;
const ROOT_SPREAD = 0.18;

export const trackingAt = (sizePx) => -TRACKING_K * (sizePx - 12);

export function rasterWord(text, family, rasterSize) {
  const S = Math.max(48, Math.round(rasterSize));
  const font = `600 ${S}px ${family}`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const chars = Array.from(text);
  const prefixEm = [0];
  for (let i = 1; i <= chars.length; i += 1) prefixEm.push(probe.measureText(chars.slice(0, i).join("")).width / S);
  const cap = probe.measureText("H");
  const capEm = cap.actualBoundingBoxAscent / S;
  const pad = Math.ceil(PAD_EM * S);

  const metrics = [];
  let maxAscent = cap.actualBoundingBoxAscent;
  let maxDescent = 0;
  chars.forEach((char, textIndex) => {
    if (char === " ") return;
    const m = probe.measureText(char);
    maxAscent = Math.max(maxAscent, m.actualBoundingBoxAscent);
    maxDescent = Math.max(maxDescent, m.actualBoundingBoxDescent);
    metrics.push({ char, textIndex, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent });
  });

  const tileHeight = Math.ceil(maxAscent + maxDescent) + pad * 2;
  let cursorX = 0;
  let cursorY = 0;
  let atlasWidth = 0;
  const glyphs = metrics.map((m) => {
    const tileWidth = Math.ceil(m.left + m.right) + pad * 2 + 2;
    if (cursorX + tileWidth > ATLAS_LIMIT) {
      cursorX = 0;
      cursorY += tileHeight;
    }
    const glyph = {
      char: m.char,
      textIndex: m.textIndex,
      tile: [cursorX, cursorY, tileWidth, tileHeight],
      ox: pad + 1 + m.left,
      oy: pad + maxAscent,
      inkLeft: -m.left,
      inkRight: m.right,
      inkTop: -m.ascent,
      inkBottom: m.descent,
    };
    cursorX += tileWidth;
    atlasWidth = Math.max(atlasWidth, cursorX);
    return glyph;
  });
  const atlasHeight = cursorY + tileHeight;

  let tileWidthMax = 1;
  for (const glyph of glyphs) tileWidthMax = Math.max(tileWidthMax, glyph.tile[2]);
  const canvas = document.createElement("canvas");
  canvas.width = tileWidthMax;
  canvas.height = tileHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.font = font;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  const alpha = new Uint8ClampedArray(atlasWidth * atlasHeight);
  for (const glyph of glyphs) {
    const [tx, ty, tw, th] = glyph.tile;
    context.clearRect(0, 0, tw, th);
    context.fillText(glyph.char, glyph.ox, glyph.oy);
    const data = context.getImageData(0, 0, tw, th).data;
    for (let y = 0; y < th; y += 1) {
      const row = (ty + y) * atlasWidth + tx;
      const source = y * tw * 4 + 3;
      for (let x = 0; x < tw; x += 1) alpha[row + x] = data[source + x * 4];
    }
  }
  canvas.width = 0;
  canvas.height = 0;

  return {
    text,
    chars,
    glyphs,
    prefixEm,
    capEm,
    S,
    pad,
    width: atlasWidth,
    height: atlasHeight,
    alpha,
    tiles: glyphs.map((glyph) => glyph.tile),
    half: null,
    coarse: null,
    coarseWidth: 0,
    anchorSets: new Map(),
  };
}

function lineWidth(word, from, to, F) {
  const count = to - from;
  return (word.prefixEm[to] - word.prefixEm[from]) * F + Math.max(0, count - 1) * trackingAt(F);
}

function fitSize(word, from, to, target) {
  const count = to - from;
  const em = word.prefixEm[to] - word.prefixEm[from];
  const denominator = em - TRACKING_K * Math.max(0, count - 1);
  return (target - 0.516 * Math.max(0, count - 1)) / Math.max(denominator, 0.1);
}

function splitLines(word, boxW, boxH, narrow) {
  const n = word.chars.length;
  const share = narrow ? 0.9 : 0.7;
  const heightCap = boxH * (narrow ? 0.2 : 0.3);
  const single = Math.min(fitSize(word, 0, n, boxW * share), heightCap, 420);
  const spaces = [];
  word.chars.forEach((char, i) => {
    if (char === " ") spaces.push(i);
  });
  if (!narrow || !spaces.length) return { lines: [[0, n]], F: single };
  let best = null;
  for (const at of spaces) {
    const F = Math.min(fitSize(word, 0, at, boxW * share), fitSize(word, at + 1, n, boxW * share), heightCap * 0.78, 420);
    if (!best || F > best.F) best = { F, lines: [[0, at], [at + 1, n]] };
  }
  return best && best.F > single * 1.25 ? best : { lines: [[0, n]], F: single };
}

const COARSE_SCALE = 8;

const fieldAt = (word, x, y) => word.coarse[(y >> 1) * word.coarseWidth + (x >> 1)] / COARSE_SCALE;

export function interiorAnchor(word, glyph, a, targetX, targetY) {
  const [tx0, ty0, tw, th] = glyph.tile;
  const deep = -STEM_EM * word.S * 0.28;
  let best = null;
  let bestDistance = Infinity;
  for (const threshold of [deep, deep * 0.4, 0]) {
    for (let y = 0; y < th; y += 2) {
      for (let x = 0; x < tw; x += 2) {
        if (fieldAt(word, tx0 + x, ty0 + y) >= threshold) continue;
        const lx = (x - glyph.ox) / a;
        const ly = (y - glyph.oy) / a;
        const dx = lx - targetX;
        const dy = ly - targetY;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x: lx, y: ly };
        }
      }
    }
    if (best) break;
  }
  return best || { x: 0, y: 0 };
}

function placeRows(word, lines, F, boxW, firstBaseline, leading) {
  const a = word.S / F;
  const tracking = trackingAt(F);
  const byTextIndex = new Map(word.glyphs.map((glyph, index) => [glyph.textIndex, index]));
  const placed = word.glyphs.map(() => null);
  const rows = [];
  lines.forEach(([from, to], lineIndex) => {
    const width = lineWidth(word, from, to, F);
    const startX = (boxW - width) / 2;
    const baseline = firstBaseline + lineIndex * leading;
    rows.push({ text: word.chars.slice(from, to).join(""), x: startX, baseline });
    let previous = -1;
    for (let c = from; c < to; c += 1) {
      const index = byTextIndex.get(c);
      if (index === undefined) continue;
      const glyph = word.glyphs[index];
      const penX = startX + (word.prefixEm[c] - word.prefixEm[from]) * F + (c - from) * tracking;
      placed[index] = {
        penX,
        penY: baseline,
        line: lineIndex,
        centreX: (glyph.inkLeft + glyph.inkRight) / 2 / a,
        centreY: (glyph.inkTop + glyph.inkBottom) / 2 / a,
        left: penX + glyph.inkLeft / a,
        right: penX + glyph.inkRight / a,
        top: baseline + glyph.inkTop / a,
        bottom: baseline + glyph.inkBottom / a,
        prev: previous,
        next: -1,
      };
      if (previous >= 0) placed[previous].next = index;
      previous = index;
    }
  });
  return { placed, rows };
}

function nominalAnchors(word, lines) {
  const key = lines.map(([from, to]) => `${from}-${to}`).join("|");
  const cached = word.anchorSets?.get(key);
  if (cached) return cached;
  const F = word.S;
  const capH = word.capEm * F;
  const { placed } = placeRows(word, lines, F, 0, 0, F * 1.06);
  const anchors = placed.map((place, index) => {
    const glyph = word.glyphs[index];
    const toward = (other) => {
      const target = placed[other];
      return interiorAnchor(word, glyph, 1, target.penX + target.centreX - place.penX, target.penY + target.centreY - place.penY);
    };
    const root = (side) => ({ x: place.centreX + side * ROOT_SPREAD * (place.right - place.left), y: 0 });
    const rootLeft = root(-1);
    const rootRight = root(1);
    const toRoot = (point) => interiorAnchor(word, glyph, 1, point.x, point.y - capH * 0.08);
    return {
      left: place.prev >= 0 ? toward(place.prev) : toRoot(rootLeft),
      right: place.next >= 0 ? toward(place.next) : toRoot(rootRight),
      rootLeft,
      rootRight,
    };
  });
  word.anchorSets?.set(key, anchors);
  return anchors;
}

const scalePoint = (point, k) => ({ x: point.x * k, y: point.y * k });

export function layoutWord(word, boxW, boxH) {
  const narrow = boxW < 640;
  const { lines, F } = splitLines(word, boxW, boxH, narrow);
  const a = word.S / F;
  const capH = word.capEm * F;
  const tracking = trackingAt(F);
  const leading = F * 1.06;
  const blockHeight = capH + (lines.length - 1) * leading;
  const centreY = boxH * (narrow ? 0.4 : 0.42);
  const firstBaseline = centreY - blockHeight / 2 + capH;
  const { placed, rows } = placeRows(word, lines, F, boxW, firstBaseline, leading);

  const stem = STEM_EM * F;
  const k = 1 / a;
  const anchors = nominalAnchors(word, lines).map((set) => ({
    left: scalePoint(set.left, k),
    right: scalePoint(set.right, k),
    rootLeft: scalePoint(set.rootLeft, k),
    rootRight: scalePoint(set.rootRight, k),
  }));

  const rowBoxes = rows.map((row) => ({ left: Infinity, right: -Infinity, top: row.baseline - capH, bottom: row.baseline }));
  for (const place of placed) {
    const box = rowBoxes[place.line];
    box.left = Math.min(box.left, place.left);
    box.right = Math.max(box.right, place.right);
    box.top = Math.min(box.top, place.top);
    box.bottom = Math.max(box.bottom, place.bottom);
  }

  let bottom = 0;
  for (const place of placed) bottom = Math.max(bottom, place.penY + Math.max(capH * 0.1, place.bottom - place.penY));

  return { F, a, capH, stem, tracking, placed, anchors, rows, rowBoxes, lines: lines.length, bottom, boxW, boxH, narrow };
}

export function sampleField(word, glyph, a, lx, ly) {
  const x = Math.floor(glyph.ox + lx * a);
  const y = Math.floor(glyph.oy + ly * a);
  const [tx, ty, tw, th] = glyph.tile;
  if (x < 0 || y < 0 || x >= tw || y >= th) return Infinity;
  return fieldAt(word, tx + x, ty + y) / a;
}
