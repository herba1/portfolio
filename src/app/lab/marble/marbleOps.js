export const OP_DROP = 1;
export const OP_TINE = 2;
export const OP_SWIRL = 3;
export const OP_WAVE = 4;

export const OPS_PER_ROW = 64;
export const OP_TEXELS = 3;
export const OP_ROWS = 32;
export const MAX_OPS = OPS_PER_ROW * OP_ROWS;
export const COVER_SLOTS = 16;
export const FACE_CROP = 0.94;
const STONE_WINDOW_MIN = 0.12;
const STONE_WINDOW_MAX = 0.4;
const TILE_TEXELS = 512;
const FALLBACK_UNIT_PX = 900;

export const TOOLS = [
  { id: "stylus", label: "Stylus", key: "1", tines: 1, spacing: 0.1 },
  { id: "rake", label: "Rake", key: "2", tines: 5, spacing: 0.12 },
  { id: "comb", label: "Comb", key: "3", tines: 15, spacing: 0.045 },
  { id: "swirl", label: "Swirl", key: "4", tines: 0, spacing: 0 },
];

export function makeDrop(x, y, radius, cover) {
  return { type: OP_DROP, x, y, radius, dx: 0, dy: 0, phase: 0, spacing: 0, alpha: 0, tines: 0, cover, amount: 1 };
}

export function makeStone(x, y, radius, cover, windowX, windowY, zoom) {
  return { ...makeDrop(x, y, radius, cover), dx: windowX, dy: windowY, spacing: zoom, field: true };
}

export function makeTine(x, y, dx, dy, alpha, tines = 1, spacing = 0.1) {
  const length = Math.hypot(dx, dy) || 1;
  return { type: OP_TINE, x, y, radius: 0, dx: dx / length, dy: dy / length, phase: 0, spacing, alpha, tines, cover: 0, amount: 1 };
}

export function makeSwirl(x, y, radius, angle) {
  return { type: OP_SWIRL, x, y, radius, dx: 0, dy: 0, phase: 0, spacing: 0, alpha: angle, tines: 0, cover: 0, amount: 1 };
}

export function makeWave(x, y, dx, dy, amplitude, wavelength, phase = 0) {
  const length = Math.hypot(dx, dy) || 1;
  return { type: OP_WAVE, x, y, radius: 0, dx: dx / length, dy: dy / length, phase, spacing: wavelength, alpha: amplitude, tines: 0, cover: 0, amount: 1 };
}

export function packOp(target, index, op) {
  const row = Math.floor(index / OPS_PER_ROW);
  const column = index % OPS_PER_ROW;
  const at = (row * OPS_PER_ROW * OP_TEXELS + column * OP_TEXELS) * 4;
  target[at] = op.type;
  target[at + 1] = op.x;
  target[at + 2] = op.y;
  target[at + 3] = op.radius;
  target[at + 4] = op.dx;
  target[at + 5] = op.dy;
  target[at + 6] = op.phase;
  target[at + 7] = op.spacing;
  target[at + 8] = op.alpha;
  target[at + 9] = op.tines;
  target[at + 10] = op.cover;
  target[at + 11] = op.amount;
}

export function seededRandom(seed) {
  let state = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function plateHalf(aspect) {
  return { halfW: Math.max(aspect, 1) * 0.5, halfH: Math.max(1 / aspect, 1) * 0.5 };
}

function sheetHalf(aspect) {
  const { halfW, halfH } = plateHalf(aspect);
  const reach = Math.max(halfW, halfH);
  return { halfW, halfH, reach };
}

function makeInker(seed, unitPx) {
  const windows = seededRandom(seed * 1.618 + 0.37);
  const devicePx = unitPx > 0 ? unitPx : FALLBACK_UNIT_PX;
  return (x, y, radius, cover) => {
    const sharp = (2 * radius * devicePx) / TILE_TEXELS;
    const zoom = Math.min(STONE_WINDOW_MAX, Math.max(STONE_WINDOW_MIN, sharp));
    const reach = 0.5 - zoom * 0.5 - 0.04;
    const windowX = 0.5 + (windows() * 2 - 1) * reach;
    const windowY = 0.5 + (windows() * 2 - 1) * reach;
    return makeStone(x, y, radius, cover, windowX, windowY, zoom);
  };
}

function stoneField(random, ink, reach, coverCount, coverage) {
  const side = reach * 2 + 0.2;
  const area = side * side * coverage;
  const ops = [];
  let filled = 0;
  let index = 0;
  while (filled < area) {
    const radius = 0.07 + random() * 0.08;
    const x = (random() * 2 - 1) * (reach + 0.08);
    const y = (random() * 2 - 1) * (reach + 0.08);
    ops.push(ink(x, y, radius, (index * 5 + 1) % coverCount));
    filled += Math.PI * radius * radius;
    index += 1;
  }
  return ops;
}

function tinesAcross(reach, overscan, spacing) {
  return Math.ceil((reach * overscan) / spacing) | 1;
}

function bouquet({ seed, aspect, coverCount, unitPx }) {
  const random = seededRandom(seed);
  const ink = makeInker(seed, unitPx);
  const { reach } = sheetHalf(aspect);
  const ops = stoneField(random, ink, reach, coverCount, 1.3);
  const centreX = aspect >= 1 ? -0.1 : 0;
  const centreY = aspect >= 1 ? 0.02 : 0.06;
  const rings = [0.19, 0.16, 0.14, 0.12];
  rings.forEach((radius, index) => ops.push(makeDrop(centreX, centreY, radius, (index + 2) % coverCount)));
  ops.push(makeDrop(centreX, centreY, 0.2, 0));
  ops.push(makeTine(centreX, 0, 0, -1, 0.12, tinesAcross(reach, 2.4, 0.2), 0.2));
  ops.push(makeWave(0, 0, 1, 0, 0.022, 0.5, 1.2));
  return ops;
}

function stone({ seed, aspect, coverCount, unitPx }) {
  const random = seededRandom(seed);
  const ink = makeInker(seed, unitPx);
  const { halfW, halfH, reach } = sheetHalf(aspect);
  const ops = stoneField(random, ink, reach, coverCount, 1.1);
  for (let index = 0; index < 5; index += 1) {
    const x = (random() * 2 - 1) * halfW * 0.7;
    const y = (random() * 2 - 1) * halfH * 0.6;
    ops.push(makeDrop(x, y, 0.08 + random() * 0.06, index % coverCount));
  }
  return ops;
}

function nonpareil({ seed, aspect, coverCount, unitPx }) {
  const random = seededRandom(seed);
  const ink = makeInker(seed, unitPx);
  const { reach } = sheetHalf(aspect);
  const ops = [];
  const step = 0.15;
  let index = 0;
  for (let y = -reach; y <= reach + 0.01; y += step) {
    for (let x = -reach + ((Math.round(y / step) & 1) * step) / 2; x <= reach + 0.01; x += step) {
      ops.push(ink(x + (random() - 0.5) * 0.02, y, 0.092, index % coverCount));
      index += 1;
    }
  }
  const across = tinesAcross(reach, 2.2, 0.12);
  ops.push(makeTine(0, 0, 0, -1, 0.16, across, 0.12));
  ops.push(makeTine(0.06, 0, 0, 1, 0.16, across, 0.12));
  ops.push(makeTine(0, 0, 0, -1, 0.05, tinesAcross(reach, 2.2, 0.03), 0.03));
  return ops;
}

function spiral({ seed, aspect, coverCount, unitPx }) {
  const random = seededRandom(seed);
  const ink = makeInker(seed, unitPx);
  const { reach } = sheetHalf(aspect);
  const ops = stoneField(random, ink, reach, coverCount, 0.7);
  const radii = [0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.08];
  radii.forEach((radius, index) => ops.push(makeDrop(0, 0, radius, (index + 1) % coverCount)));
  ops.push(makeSwirl(0, 0, 0.12, 2.4));
  ops.push(makeSwirl(0, 0, 0.26, -1.6));
  ops.push(makeSwirl(0, 0, 0.38, 1.1));
  return ops;
}

function chevron({ seed, aspect, coverCount, unitPx }) {
  const random = seededRandom(seed);
  const ink = makeInker(seed, unitPx);
  const { reach } = sheetHalf(aspect);
  const ops = stoneField(random, ink, reach, coverCount, 1.1);
  const across = tinesAcross(reach, 2.2, 0.14);
  ops.push(makeTine(0, 0, 1, 0, 0.12, across, 0.14));
  ops.push(makeTine(0, 0.07, -1, 0, 0.12, across, 0.14));
  ops.push(makeTine(0, 0, 0, 1, 0.07, tinesAcross(reach, 2.2, 0.1), 0.1));
  ops.push(makeWave(0, 0, 1, 0, 0.03, 0.42, random() * 6.28));
  return ops;
}

export const RECIPES = { bouquet, stone, nonpareil, spiral, chevron };

export function fitRecipe(ops, limit) {
  if (ops.length <= limit) return ops;
  const stones = ops.filter((op) => op.field);
  const features = ops.filter((op) => !op.field);
  const keep = Math.min(stones.length, Math.max(0, limit - features.length));
  if (!keep) return ops.slice(-limit);
  const grow = Math.sqrt(stones.length / keep);
  const kept = [];
  for (let index = 0; index < keep; index += 1) {
    const stone = stones[Math.floor((index * stones.length) / keep)];
    kept.push({ ...stone, radius: stone.radius * grow });
  }
  return [...kept, ...features].slice(-limit);
}

export function introLanding(aspect) {
  const { halfW, halfH } = plateHalf(aspect);
  const radius = Math.min(0.15, 0.3 * Math.min(halfW, halfH));
  const margin = radius + 0.05;
  if (aspect >= 1) return { x: Math.max(0, Math.min(0.5, halfW - margin)), y: -0.08, radius };
  return { x: 0.05, y: Math.min(0, Math.max(-0.52, -(halfH - margin))), radius };
}

export function introPull(ops) {
  for (let index = ops.length - 1; index >= Math.max(0, ops.length - 4); index -= 1) {
    if (ops[index].type === OP_TINE) return ops[index];
  }
  return null;
}
