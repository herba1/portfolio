import { BRIDGES } from "./xpbd";

const NUB_LENGTH = 2.4;
const NUB_POINTS = 7;
const NUB_BASE = 0.75;
const NUB_ROUGHNESS = 0.4;
const NUB_DRIFT = 0.04;
const NUB_WHISKERS = 2;
const NUB_WHISKER_MIN = 0.5;
const NUB_WHISKER_SPREAD = 0.8;
const PINCH = 0.4;
const REACH = 0.65;
const OVAL = 0.75;
const HOLE_POINTS = 10;
const HOLE_FRAY = 0.1;
const FRAY_ONSET = 0.2;
const FRAY_RAMP = 0.3;
const HOLE_WHISKERS = 1;
const HOLE_WHISKER_MIN = 0.4;
const HOLE_WHISKER_SPREAD = 0.4;

export function createEdge() {
  return {
    broken: new Uint8Array(BRIDGES),
    gap: new Float64Array(BRIDGES),
    load: new Float64Array(BRIDGES),
    share: new Float64Array(BRIDGES).fill(0.5),
    seed: new Uint32Array(BRIDGES),
  };
}

function seeded(seed, salt) {
  let t = (seed + Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fixed(value) {
  return Math.round(value * 100) / 100;
}

const point = { x: 0, y: 0 };

function nubPoint(edge, k, x, y0, y1, outward, t, salt) {
  const seed = edge.seed[k];
  const length = NUB_LENGTH * edge.share[k];
  const bump = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.6);
  const reach = length * bump * (NUB_BASE + seeded(seed, salt) * NUB_ROUGHNESS);
  const drift = (seeded(seed, salt + 40) - 0.5) * (y1 - y0) * NUB_DRIFT * bump;
  point.x = x + outward * reach;
  point.y = y0 + (y1 - y0) * t + drift;
  return point;
}

function nub(edge, k, x, y0, y1, outward) {
  let d = "";
  for (let j = 1; j < NUB_POINTS; j += 1) {
    const at = nubPoint(edge, k, x, y0, y1, outward, j / NUB_POINTS, j + 1);
    d += `L${fixed(at.x)} ${fixed(at.y)}`;
  }
  return `${d}L${fixed(x)} ${fixed(y1)}`;
}

function whisker(x, y, angle, length) {
  return `M${fixed(x)} ${fixed(y)}l${fixed(Math.cos(angle) * length)} ${fixed(Math.sin(angle) * length)}`;
}

function tornNub(edge, k, x, y0, y1, outward, acc) {
  const seed = edge.seed[k];
  for (let w = 0; w < NUB_WHISKERS; w += 1) {
    const t = 0.12 + 0.76 * seeded(seed, 80 + w);
    const slot = Math.max(1, Math.min(NUB_POINTS - 1, Math.round(t * NUB_POINTS)));
    const at = nubPoint(edge, k, x, y0, y1, outward, slot / NUB_POINTS, slot + 1);
    const base = outward > 0 ? 0 : Math.PI;
    const angle = base + (seeded(seed, 90 + w) - 0.5) * 1.1;
    acc.fibres += whisker(at.x, at.y, angle, NUB_WHISKER_MIN + seeded(seed, 100 + w) * NUB_WHISKER_SPREAD);
  }
  return `M${fixed(x)} ${fixed(y0)}${nub(edge, k, x, y0, y1, outward)}`;
}

function bridgeFill(edge, k, x, y0, y1, outward) {
  if (edge.broken[k]) return nub(edge, k, x, y0, y1, outward);
  const reach = Math.min(1.3, edge.gap[k] * REACH);
  if (reach < 0.05 && edge.load[k] < 0.05) return `L${fixed(x)} ${fixed(y1)}`;
  const inset = (y1 - y0) * PINCH * edge.load[k];
  return (
    `L${fixed(x + outward * reach)} ${fixed(y0 + inset)}` +
    `L${fixed(x + outward * reach)} ${fixed(y1 - inset)}` +
    `L${fixed(x)} ${fixed(y1)}`
  );
}

function bridgeLine(edge, k, x, y0, y1, outward, attached) {
  if (edge.broken[k]) return nub(edge, k, x, y0, y1, outward);
  if (!attached) return `L${fixed(x)} ${fixed(y1)}`;
  const reach = Math.min(1.3, edge.gap[k] * REACH);
  if (reach < 0.05 && edge.load[k] < 0.05) return `M${fixed(x)} ${fixed(y1)}`;
  const inset = (y1 - y0) * PINCH * edge.load[k];
  return (
    `L${fixed(x + outward * reach)} ${fixed(y0 + inset)}` +
    `M${fixed(x + outward * reach)} ${fixed(y1 - inset)}` +
    `L${fixed(x)} ${fixed(y1)}`
  );
}

function holeLoad(edge, before, after) {
  const first = before >= 0 && !edge.broken[before] ? edge.load[before] : 0;
  const second = after < BRIDGES && !edge.broken[after] ? edge.load[after] : 0;
  return Math.max(first, second);
}

function holeFray(edge, index) {
  if ((index > 0 && edge.broken[index - 1]) || (index < BRIDGES && edge.broken[index])) return 1;
  return Math.min(1, Math.max(0, (holeLoad(edge, index - 1, index) - FRAY_ONSET) / FRAY_RAMP));
}

function hole(edge, index, radius, x, center, inward, seed, acc) {
  const stretch = radius * (1 + OVAL * holeLoad(edge, index - 1, index));
  const direction = inward < 0 ? 1 : -1;
  const endY = fixed(center + direction * radius);
  const amount = holeFray(edge, index);
  if (amount <= 0) return `A${fixed(stretch)} ${fixed(radius)} 0 0 0 ${fixed(x)} ${endY}`;
  const salt = (inward < 0 ? 0 : 5000) + index * 37;
  const fray = HOLE_FRAY * amount;
  let d = "";
  for (let j = 1; j < HOLE_POINTS; j += 1) {
    const theta = (Math.PI * j) / HOLE_POINTS;
    const ragged = 1 + (seeded(seed, salt + j) - 0.5) * 2 * fray;
    d += `L${fixed(x + inward * stretch * Math.sin(theta) * ragged)} ${fixed(center - direction * radius * Math.cos(theta) * ragged)}`;
  }
  for (let w = 0; w < HOLE_WHISKERS; w += 1) {
    const theta = Math.PI * (0.18 + 0.64 * seeded(seed, salt + 20 + w));
    const startX = x + inward * stretch * Math.sin(theta);
    const startY = center - direction * radius * Math.cos(theta);
    const angle = Math.atan2(center - startY, x - startX) + (seeded(seed, salt + 24 + w) - 0.5) * 0.9;
    acc.fibres += whisker(startX, startY, angle, amount * (HOLE_WHISKER_MIN + seeded(seed, salt + 28 + w) * HOLE_WHISKER_SPREAD));
  }
  return `${d}L${fixed(x)} ${endY}`;
}

export function paperPaths(width, height, left, right, leftAttached, rightAttached, seed, out) {
  const spacing = height / BRIDGES;
  const radius = Math.max(1.6, spacing * 0.2);
  const r = fixed(radius);
  let fill = `M${r} 0L${fixed(width - radius)} 0A${r} ${r} 0 0 0 ${fixed(width)} ${r}`;
  let line = fill;
  let torn = "";
  out.fibres = "";
  for (let k = 0; k < BRIDGES; k += 1) {
    const top = k * spacing + radius;
    const bottom = (k + 1) * spacing - radius;
    if (right.broken[k]) torn += tornNub(right, k, width, top, bottom, 1, out);
    fill += bridgeFill(right, k, width, top, bottom, 1);
    line += bridgeLine(right, k, width, top, bottom, 1, rightAttached);
    const turn =
      k + 1 < BRIDGES ? hole(right, k + 1, radius, width, (k + 1) * spacing, -1, seed, out) : `A${r} ${r} 0 0 0 ${fixed(width - radius)} ${fixed(height)}`;
    fill += turn;
    line += turn;
  }
  const base = `L${r} ${fixed(height)}A${r} ${r} 0 0 0 0 ${fixed(height - radius)}`;
  fill += base;
  line += base;
  for (let k = BRIDGES - 1; k >= 0; k -= 1) {
    const bottom = (k + 1) * spacing - radius;
    const top = k * spacing + radius;
    if (left.broken[k]) torn += tornNub(left, k, 0, bottom, top, -1, out);
    fill += bridgeFill(left, k, 0, bottom, top, -1);
    line += bridgeLine(left, k, 0, bottom, top, -1, leftAttached);
    const turn = k > 0 ? hole(left, k, radius, 0, k * spacing, 1, seed, out) : `A${r} ${r} 0 0 0 ${r} 0`;
    fill += turn;
    line += turn;
  }
  out.fill = `${fill}Z`;
  out.line = line;
  out.torn = torn;
  return out;
}
