import { BRIDGES } from "./xpbd";

const NUB_LENGTH = 2.4;
const PINCH = 0.4;
const REACH = 0.65;
const OVAL = 0.75;

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

function nub(edge, k, x, y0, y1, outward) {
  const span = y1 - y0;
  const length = NUB_LENGTH * edge.share[k];
  const seed = edge.seed[k];
  const first = length * (0.35 + seeded(seed, 1) * 0.65);
  const middle = length * (0.2 + seeded(seed, 2) * 0.5);
  const last = length * (0.35 + seeded(seed, 3) * 0.65);
  return (
    `Q${fixed(x + outward * first * 2)} ${fixed(y0 + span * 0.25)} ${fixed(x + outward * middle)} ${fixed(y0 + span * 0.5)}` +
    `Q${fixed(x + outward * last * 2)} ${fixed(y0 + span * 0.75)} ${fixed(x)} ${fixed(y1)}`
  );
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

function hole(edge, index, radius) {
  const stretch = fixed(radius * (1 + OVAL * holeLoad(edge, index - 1, index)));
  return `A${stretch} ${fixed(radius)} 0 0 0`;
}

export function paperPaths(width, height, left, right, leftAttached, rightAttached, out) {
  const spacing = height / BRIDGES;
  const radius = Math.max(1.6, spacing * 0.2);
  const r = fixed(radius);
  let fill = `M${r} 0L${fixed(width - radius)} 0A${r} ${r} 0 0 0 ${fixed(width)} ${r}`;
  let line = fill;
  for (let k = 0; k < BRIDGES; k += 1) {
    const top = k * spacing + radius;
    const bottom = (k + 1) * spacing - radius;
    fill += bridgeFill(right, k, width, top, bottom, 1);
    line += bridgeLine(right, k, width, top, bottom, 1, rightAttached);
    const turn =
      k + 1 < BRIDGES
        ? `${hole(right, k + 1, radius)} ${fixed(width)} ${fixed((k + 1) * spacing + radius)}`
        : `A${r} ${r} 0 0 0 ${fixed(width - radius)} ${fixed(height)}`;
    fill += turn;
    line += turn;
  }
  const base = `L${r} ${fixed(height)}A${r} ${r} 0 0 0 0 ${fixed(height - radius)}`;
  fill += base;
  line += base;
  for (let k = BRIDGES - 1; k >= 0; k -= 1) {
    const bottom = (k + 1) * spacing - radius;
    const top = k * spacing + radius;
    fill += bridgeFill(left, k, 0, bottom, top, -1);
    line += bridgeLine(left, k, 0, bottom, top, -1, leftAttached);
    const turn = k > 0 ? `${hole(left, k, radius)} 0 ${fixed(k * spacing - radius)}` : `A${r} ${r} 0 0 0 ${r} 0`;
    fill += turn;
    line += turn;
  }
  out.fill = `${fill}Z`;
  out.line = line;
  return out;
}
