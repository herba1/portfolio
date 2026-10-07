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
const STONE_WINDOW_MAX = 0.18;

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

function plateHalf(aspect) {
  return { halfW: Math.max(aspect, 1) * 0.5, halfH: Math.max(1 / aspect, 1) * 0.5 };
}

function stoneWindow(windows) {
  const zoom = STONE_WINDOW_MIN + windows() * (STONE_WINDOW_MAX - STONE_WINDOW_MIN);
  const reach = 0.5 - zoom * 0.5 - 0.04;
  return { zoom, x: 0.5 + (windows() * 2 - 1) * reach, y: 0.5 + (windows() * 2 - 1) * reach };
}

function inkStone(windows, x, y, radius, cover) {
  const crop = stoneWindow(windows);
  return makeStone(x, y, radius, cover, crop.x, crop.y, crop.zoom);
}

function stoneField(random, windows, halfW, halfH, coverCount, coverage) {
  const area = (halfW * 2 + 0.2) * (halfH * 2 + 0.2) * coverage;
  const ops = [];
  let filled = 0;
  let index = 0;
  while (filled < area) {
    const radius = 0.07 + random() * 0.08;
    const x = (random() * 2 - 1) * (halfW + 0.08);
    const y = (random() * 2 - 1) * (halfH + 0.08);
    ops.push(inkStone(windows, x, y, radius, (index * 5 + 1) % coverCount));
    filled += Math.PI * radius * radius;
    index += 1;
  }
  return ops;
}

function bouquet({ seed, aspect, coverCount }) {
  const random = seededRandom(seed);
  const windows = seededRandom(seed * 1.618 + 0.37);
  const { halfW, halfH } = plateHalf(aspect);
  const ops = stoneField(random, windows, halfW, halfH, coverCount, 1.3);
  const centreX = aspect >= 1 ? -0.1 : 0;
  const centreY = aspect >= 1 ? 0.02 : 0.06;
  const rings = [0.19, 0.16, 0.14, 0.12];
  rings.forEach((radius, index) => ops.push(makeDrop(centreX, centreY, radius, (index + 2) % coverCount)));
  ops.push(makeDrop(centreX, centreY, 0.2, 0));
  const across = Math.ceil((halfW * 2.4) / 0.2) | 1;
  ops.push(makeTine(centreX, 0, 0, -1, 0.12, across, 0.2));
  ops.push(makeWave(0, 0, 1, 0, 0.022, 0.5, 1.2));
  return ops;
}

function stone({ seed, aspect, coverCount }) {
  const random = seededRandom(seed);
  const windows = seededRandom(seed * 1.618 + 0.37);
  const { halfW, halfH } = plateHalf(aspect);
  const ops = stoneField(random, windows, halfW, halfH, coverCount, 1.1);
  for (let index = 0; index < 5; index += 1) {
    const x = (random() * 2 - 1) * halfW * 0.7;
    const y = (random() * 2 - 1) * halfH * 0.6;
    ops.push(makeDrop(x, y, 0.08 + random() * 0.06, index % coverCount));
  }
  return ops;
}

function nonpareil({ seed, aspect, coverCount }) {
  const random = seededRandom(seed);
  const windows = seededRandom(seed * 1.618 + 0.37);
  const { halfW, halfH } = plateHalf(aspect);
  const ops = [];
  const step = 0.15;
  let index = 0;
  for (let y = -halfH; y <= halfH + 0.01; y += step) {
    for (let x = -halfW + ((Math.round(y / step) & 1) * step) / 2; x <= halfW + 0.01; x += step) {
      ops.push(inkStone(windows, x + (random() - 0.5) * 0.02, y, 0.092, index % coverCount));
      index += 1;
    }
  }
  const across = Math.ceil((halfW * 2.2) / 0.12) | 1;
  ops.push(makeTine(0, 0, 0, -1, 0.16, across, 0.12));
  ops.push(makeTine(0.06, 0, 0, 1, 0.16, across, 0.12));
  ops.push(makeTine(0, 0, 0, -1, 0.05, Math.ceil((halfW * 2.2) / 0.03) | 1, 0.03));
  return ops;
}

function spiral({ seed, aspect, coverCount }) {
  const random = seededRandom(seed);
  const windows = seededRandom(seed * 1.618 + 0.37);
  const { halfW, halfH } = plateHalf(aspect);
  const ops = stoneField(random, windows, halfW, halfH, coverCount, 0.7);
  const radii = [0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.08];
  radii.forEach((radius, index) => ops.push(makeDrop(0, 0, radius, (index + 1) % coverCount)));
  ops.push(makeSwirl(0, 0, 0.12, 2.4));
  ops.push(makeSwirl(0, 0, 0.26, -1.6));
  ops.push(makeSwirl(0, 0, 0.38, 1.1));
  return ops;
}

function chevron({ seed, aspect, coverCount }) {
  const random = seededRandom(seed);
  const windows = seededRandom(seed * 1.618 + 0.37);
  const { halfW, halfH } = plateHalf(aspect);
  const ops = stoneField(random, windows, halfW, halfH, coverCount, 1.1);
  const across = Math.ceil((halfH * 2.2) / 0.14) | 1;
  ops.push(makeTine(0, 0, 1, 0, 0.12, across, 0.14));
  ops.push(makeTine(0, 0.07, -1, 0, 0.12, across, 0.14));
  const fine = Math.ceil((halfW * 2.2) / 0.1) | 1;
  ops.push(makeTine(0, 0, 0, 1, 0.07, fine, 0.1));
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
  return aspect >= 1 ? { x: 0.5, y: -0.08, radius: 0.15 } : { x: 0.05, y: -0.52, radius: 0.15 };
}
