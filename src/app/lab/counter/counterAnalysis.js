export const LEADING = 0.98;
export const TRACKING_K = 0.043;
export const MIN_RHO_EM = 0.08;
export const FRAME_DIAGONAL_IN_RHO = 1.9;
export const MAX_FONT_PX = 2048;

const MEASURE_PX = 100;
const ANALYSIS_MAX_WIDTH = 900;
const ANALYSIS_MAX_PIXELS = 420000;
const PORTHOLE_RES = 384;
const PORTHOLE_DILATE = 2;
const FAR = 1 << 24;

export const trackingAt = (size) => -TRACKING_K * (size - 12);
export const fontAt = (size, family) => `600 ${size}px ${family}`;

export function createMeasurer(family) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  ctx.font = fontAt(MEASURE_PX, family);
  const cap = ctx.measureText("H").actualBoundingBoxAscent / MEASURE_PX || 0.71;
  const descent = ctx.measureText("gjpqy").actualBoundingBoxDescent / MEASURE_PX || 0.22;
  const cache = new Map();
  const prefixes = (text) => {
    const hit = cache.get(text);
    if (hit) return hit;
    const chars = Array.from(text);
    const xs = new Float32Array(chars.length + 1);
    let prefix = "";
    for (let index = 0; index < chars.length; index += 1) {
      xs[index] = ctx.measureText(prefix).width / MEASURE_PX;
      prefix += chars[index];
    }
    xs[chars.length] = ctx.measureText(prefix).width / MEASURE_PX;
    const entry = { chars, xs };
    cache.set(text, entry);
    return entry;
  };
  return { cap, descent, prefixes };
}

function breakings(words, lineCount) {
  const results = [];
  const count = words.length;
  if (lineCount === 1) return [[words.join(" ")]];
  if (lineCount === 2) {
    for (let a = 1; a < count; a += 1) results.push([words.slice(0, a).join(" "), words.slice(a).join(" ")]);
    return results;
  }
  for (let a = 1; a < count - 1; a += 1) {
    for (let b = a + 1; b < count; b += 1) {
      results.push([words.slice(0, a).join(" "), words.slice(a, b).join(" "), words.slice(b).join(" ")]);
    }
  }
  return results;
}

function sizeForWidth(entry, maxWidth) {
  const gaps = Math.max(0, entry.chars.length - 1);
  const em = entry.xs[entry.chars.length] - TRACKING_K * gaps;
  return (maxWidth - 0.516 * gaps) / Math.max(0.05, em);
}

function lineWidth(entry, size) {
  const gaps = Math.max(0, entry.chars.length - 1);
  return size * entry.xs[entry.chars.length] + gaps * trackingAt(size);
}

export function layoutTitle(title, measurer, frameW, frameH, fitW, fitH, centreY = 0.5) {
  const words = title.split(/\s+/).filter(Boolean);
  const maxLines = Math.min(3, words.length);
  let best = null;
  for (let lineCount = 1; lineCount <= maxLines; lineCount += 1) {
    const heightCap = (fitH * frameH) / (measurer.cap + (lineCount - 1) * LEADING);
    for (const lines of breakings(words, lineCount)) {
      let size = heightCap;
      const entries = lines.map((line) => measurer.prefixes(line));
      for (const entry of entries) size = Math.min(size, sizeForWidth(entry, fitW * frameW));
      const score = size * (1 - 0.05 * (lineCount - 1));
      if (!best || score > best.score) best = { score, size, entries };
    }
  }
  const { size, entries } = best;
  const tracking = trackingAt(size);
  const widths = entries.map((entry) => lineWidth(entry, size));
  const blockW = Math.max(...widths);
  const blockH = measurer.cap * size + (entries.length - 1) * LEADING * size;
  const left = (frameW - blockW) / 2;
  const top = frameH * centreY - blockH / 2 - measurer.descent * size * 0.25;
  const lines = entries.map((entry, row) => {
    const count = entry.chars.length;
    const xs = new Float32Array(count + 1);
    for (let index = 0; index <= count; index += 1) xs[index] = left + size * entry.xs[index] + index * tracking;
    return { chars: entry.chars, xs, baseline: top + measurer.cap * size + row * LEADING * size };
  });
  return {
    size,
    lines,
    cap: measurer.cap,
    descent: measurer.descent,
    box: { x: left, y: top, w: blockW, h: blockH + measurer.descent * size },
  };
}

export function drawLayout(ctx, layout, family, scale, offsetX, offsetY, viewW, viewH, cull, pixelRatio = 1) {
  const fontPx = layout.size * scale;
  const glyphScale = fontPx > MAX_FONT_PX ? fontPx / MAX_FONT_PX : 1;
  ctx.font = fontAt(fontPx / glyphScale, family);
  if (glyphScale !== 1) ctx.setTransform(pixelRatio * glyphScale, 0, 0, pixelRatio * glyphScale, 0, 0);
  const above = layout.cap * fontPx * 1.2;
  const below = layout.descent * fontPx * 1.2;
  for (const line of layout.lines) {
    const y = offsetY + line.baseline * scale;
    if (cull && (y - above > viewH || y + below < 0)) continue;
    const { chars, xs } = line;
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      if (char === " ") continue;
      const x = offsetX + xs[index] * scale;
      if (cull && (x > viewW || offsetX + xs[index + 1] * scale + fontPx * 0.2 < 0)) continue;
      ctx.fillText(char, x / glyphScale, y / glyphScale);
    }
  }
  if (glyphScale !== 1) ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function scratch(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  return ctx;
}

function rasterInk(canvas, layout, family, box, scale, width, height) {
  const ctx = scratch(canvas, width, height);
  drawLayout(ctx, layout, family, scale, -box.x * scale, -box.y * scale, width, height, false);
  const { data } = ctx.getImageData(0, 0, width, height);
  const ink = new Uint8Array(width * height);
  for (let index = 0; index < ink.length; index += 1) ink[index] = data[index * 4 + 3] >= 128 ? 1 : 0;
  return ink;
}

function floodOutside(label, width, height, queue) {
  let head = 0;
  let tail = 0;
  const seed = (index) => {
    if (label[index] !== 0) return;
    label[index] = 2;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (index >= width) seed(index - width);
    if (index < (height - 1) * width) seed(index + width);
  }
}

function chamfer(label, width, height) {
  const dist = new Int32Array(width * height);
  for (let index = 0; index < dist.length; index += 1) dist[index] = label[index] === 0 ? FAR : 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!dist[index]) continue;
      let value = dist[index];
      const up = index - width;
      value = Math.min(value, dist[index - 1] + 3, dist[up] + 3, dist[up - 1] + 4, dist[up + 1] + 4);
      dist[index] = value;
    }
  }
  let bestIndex = -1;
  let bestValue = 0;
  for (let y = height - 2; y >= 1; y -= 1) {
    for (let x = width - 2; x >= 1; x -= 1) {
      const index = y * width + x;
      if (!dist[index]) continue;
      let value = dist[index];
      const down = index + width;
      value = Math.min(value, dist[index + 1] + 3, dist[down] + 3, dist[down + 1] + 4, dist[down - 1] + 4);
      dist[index] = value;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
  }
  return { bestIndex, bestValue };
}

function growComponent(passable, width, height, start, queue, member) {
  let head = 0;
  let tail = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let leaked = false;
  member[start] = 1;
  queue[tail] = start;
  tail += 1;
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) leaked = true;
    const visit = (next) => {
      if (member[next] || !passable(next)) return;
      member[next] = 1;
      queue[tail] = next;
      tail += 1;
    };
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }
  return { minX, minY, maxX, maxY, leaked };
}

function dilateInto(member, ink, width, height, steps) {
  let frontier = [];
  for (let index = 0; index < member.length; index += 1) if (member[index]) frontier.push(index);
  for (let step = 0; step < steps; step += 1) {
    const next = [];
    for (const index of frontier) {
      const x = index % width;
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width];
      for (const other of neighbours) {
        if (other < 0 || other >= member.length || member[other] || !ink[other]) continue;
        member[other] = 1;
        next.push(other);
      }
    }
    frontier = next;
  }
}

function buildPorthole(canvas, layout, family, centre, compBox) {
  const pad = layout.size * 0.04;
  const box = { x: compBox.x - pad, y: compBox.y - pad, w: compBox.w + pad * 2, h: compBox.h + pad * 2 };
  const scale = PORTHOLE_RES / Math.max(box.w, box.h);
  const width = Math.max(8, Math.ceil(box.w * scale));
  const height = Math.max(8, Math.ceil(box.h * scale));
  box.w = width / scale;
  box.h = height / scale;
  const ink = rasterInk(canvas, layout, family, box, scale, width, height);
  const start = Math.floor((centre.y - box.y) * scale) * width + Math.floor((centre.x - box.x) * scale);
  if (start < 0 || start >= ink.length || ink[start]) return null;
  const member = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const grown = growComponent((index) => !ink[index], width, height, start, queue, member);
  if (grown.leaked) return null;
  dilateInto(member, ink, width, height, PORTHOLE_DILATE);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  const image = maskCtx.createImageData(width, height);
  for (let index = 0; index < member.length; index += 1) {
    if (!member[index]) continue;
    const at = index * 4;
    image.data[at] = 255;
    image.data[at + 1] = 255;
    image.data[at + 2] = 255;
    image.data[at + 3] = 255;
  }
  maskCtx.putImageData(image, 0, 0);
  return { canvas: maskCanvas, member, width, height, scale, box };
}

export function analyseLayout(canvas, layout, family, frameW, frameH, minScale) {
  const pad = layout.size * 0.12;
  const region = { x: layout.box.x - pad, y: layout.box.y - pad, w: layout.box.w + pad * 2, h: layout.box.h + pad * 2 };
  const scale = Math.min(ANALYSIS_MAX_WIDTH / region.w, Math.sqrt(ANALYSIS_MAX_PIXELS / (region.w * region.h)));
  const width = Math.max(16, Math.ceil(region.w * scale));
  const height = Math.max(16, Math.ceil(region.h * scale));
  const ink = rasterInk(canvas, layout, family, region, scale, width, height);
  const label = new Uint8Array(ink);
  const queue = new Int32Array(width * height);
  floodOutside(label, width, height, queue);
  const { bestIndex, bestValue } = chamfer(label, width, height);
  if (bestIndex < 0) return null;
  const rho = bestValue / 3 / scale - 0.5 / scale;
  if (rho < MIN_RHO_EM * layout.size) return null;
  const nestScale = (FRAME_DIAGONAL_IN_RHO * rho) / Math.hypot(frameW, frameH);
  if (nestScale < minScale) return null;
  const bx = bestIndex % width;
  const by = (bestIndex - bx) / width;
  const centre = { x: region.x + (bx + 0.5) / scale, y: region.y + (by + 0.5) / scale };
  const member = new Uint8Array(width * height);
  const comp = growComponent((index) => label[index] === 0, width, height, bestIndex, queue, member);
  const compBox = {
    x: region.x + comp.minX / scale,
    y: region.y + comp.minY / scale,
    w: (comp.maxX - comp.minX + 1) / scale,
    h: (comp.maxY - comp.minY + 1) / scale,
  };
  const porthole = buildPorthole(canvas, layout, family, centre, compBox);
  if (!porthole) return null;
  const shift = { x: centre.x - nestScale * frameW * 0.5, y: centre.y - nestScale * frameH * 0.5 };
  const fixed = { x: shift.x / (1 - nestScale), y: shift.y / (1 - nestScale) };
  const artHalf = Math.max(centre.x - compBox.x, compBox.x + compBox.w - centre.x, centre.y - compBox.y, compBox.y + compBox.h - centre.y);
  return { rho, centre, scale: nestScale, shift, fixed, porthole, artHalf };
}

export function portholeHit(analysis, x, y) {
  const { porthole } = analysis;
  const mx = Math.floor((x - porthole.box.x) * porthole.scale);
  const my = Math.floor((y - porthole.box.y) * porthole.scale);
  if (mx < 0 || my < 0 || mx >= porthole.width || my >= porthole.height) return false;
  return porthole.member[my * porthole.width + mx] === 1;
}
