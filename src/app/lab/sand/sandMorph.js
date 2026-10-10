import { hashCell } from "./sandGrid";

const TONE_LEVELS = 256;

const MORPH_PASSES = [
  { tones: 16, hues: 8, pooled: false },
  { tones: 8, hues: 4, pooled: false },
  { tones: 8, hues: 2, pooled: false },
  { tones: TONE_LEVELS, hues: 1, pooled: true },
];

const MOST_BINS = MORPH_PASSES.reduce((most, { tones, hues }) => Math.max(most, tones * hues * hues), 1);

function hilbertIndex(side, x, y) {
  let index = 0;
  for (let span = side >> 1; span > 0; span >>= 1) {
    const right = (x & span) > 0 ? 1 : 0;
    const lower = (y & span) > 0 ? 1 : 0;
    index += span * span * ((3 * right) ^ lower);
    if (lower === 0) {
      if (right === 1) {
        x = side - 1 - x;
        y = side - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
  }
  return index;
}

export function curveOrder(width, height) {
  let side = 1;
  while (side < width || side < height) side <<= 1;
  const slots = new Int32Array(side * side).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) slots[hilbertIndex(side, x, y)] = y * width + x;
  }
  const order = new Int32Array(width * height);
  let count = 0;
  for (let slot = 0; slot < slots.length; slot += 1) {
    if (slots[slot] >= 0) order[count++] = slots[slot];
  }
  return order;
}

export function pictureOrder(order, cover) {
  const homes = cover * cover;
  const picture = new Int32Array(homes);
  let count = 0;
  for (let rank = 0; rank < order.length && count < homes; rank += 1) {
    if (order[rank] < homes) picture[count++] = order[rank];
  }
  return picture;
}

export function fieldNoise(x, y) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const fx = x - left;
  const fy = y - top;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hashCell(left, top);
  const b = hashCell(left + 1, top);
  const c = hashCell(left, top + 1);
  const d = hashCell(left + 1, top + 1);
  const upper = a + (b - a) * sx;
  const lower = c + (d - c) * sx;
  return upper + (lower - upper) * sy;
}

export function createMorphScratch(capacity) {
  return {
    targets: new Int32Array(capacity),
    activeGrains: new Int32Array(capacity),
    activeHomes: new Int32Array(capacity),
    sortedGrains: new Int32Array(capacity),
    sortedHomes: new Int32Array(capacity),
    grainBins: new Uint16Array(capacity),
    homeBins: new Uint16Array(capacity),
    taken: new Uint8Array(capacity),
    grainStarts: new Int32Array(MOST_BINS + 1),
    homeStarts: new Int32Array(MOST_BINS + 1),
    grainCursor: new Int32Array(MOST_BINS),
    homeCursor: new Int32Array(MOST_BINS),
  };
}

function binOf(tone, at, tones, hues) {
  return ((tone[at] * tones) >> 8) * hues * hues + ((tone[at + 1] * hues) >> 8) * hues + ((tone[at + 2] * hues) >> 8);
}

function bucket(active, count, bins, starts, cursor, sorted, binCount) {
  starts.fill(0, 0, binCount + 1);
  for (let rank = 0; rank < count; rank += 1) starts[bins[rank] + 1] += 1;
  for (let bin = 0; bin < binCount; bin += 1) {
    starts[bin + 1] += starts[bin];
    cursor[bin] = starts[bin];
  }
  for (let rank = 0; rank < count; rank += 1) sorted[cursor[bins[rank]]++] = active[rank];
}

function pairRange(targets, taken, sortedGrains, grainStart, grains, sortedHomes, homeStart, homes) {
  if (grains >= homes) {
    const stride = grains / homes;
    for (let pick = 0; pick < homes; pick += 1) {
      const home = sortedHomes[homeStart + pick];
      targets[sortedGrains[grainStart + Math.floor((pick + 0.5) * stride)]] = home;
      taken[home] = 1;
    }
    return homes;
  }
  const stride = homes / grains;
  for (let pick = 0; pick < grains; pick += 1) {
    const home = sortedHomes[homeStart + Math.floor((pick + 0.5) * stride)];
    targets[sortedGrains[grainStart + pick]] = home;
    taken[home] = 1;
  }
  return grains;
}

export function planMorph(scratch, grainCount, grainHomes, fromTone, homeOrder, toTone) {
  const {
    targets,
    activeGrains,
    activeHomes,
    sortedGrains,
    sortedHomes,
    grainBins,
    homeBins,
    taken,
    grainStarts,
    homeStarts,
    grainCursor,
    homeCursor,
  } = scratch;
  let grainsLeft = grainCount;
  let homesLeft = homeOrder.length;
  targets.fill(-1, 0, grainCount);
  taken.fill(0, 0, homesLeft);
  for (let rank = 0; rank < grainsLeft; rank += 1) activeGrains[rank] = rank;
  activeHomes.set(homeOrder);
  let matched = 0;
  for (const { tones, hues, pooled } of MORPH_PASSES) {
    if (!grainsLeft || !homesLeft) break;
    const binCount = tones * hues * hues;
    for (let rank = 0; rank < grainsLeft; rank += 1) {
      grainBins[rank] = binOf(fromTone, grainHomes[activeGrains[rank]] * 3, tones, hues);
    }
    for (let rank = 0; rank < homesLeft; rank += 1) {
      homeBins[rank] = binOf(toTone, activeHomes[rank] * 3, tones, hues);
    }
    bucket(activeGrains, grainsLeft, grainBins, grainStarts, grainCursor, sortedGrains, binCount);
    bucket(activeHomes, homesLeft, homeBins, homeStarts, homeCursor, sortedHomes, binCount);
    if (pooled) {
      matched += pairRange(targets, taken, sortedGrains, 0, grainsLeft, sortedHomes, 0, homesLeft);
    } else {
      for (let bin = 0; bin < binCount; bin += 1) {
        const grainStart = grainStarts[bin];
        const homeStart = homeStarts[bin];
        const grains = grainStarts[bin + 1] - grainStart;
        const homes = homeStarts[bin + 1] - homeStart;
        if (!grains || !homes) continue;
        matched += pairRange(targets, taken, sortedGrains, grainStart, grains, sortedHomes, homeStart, homes);
      }
    }
    let keptGrains = 0;
    for (let rank = 0; rank < grainsLeft; rank += 1) {
      const grain = activeGrains[rank];
      if (targets[grain] < 0) activeGrains[keptGrains++] = grain;
    }
    let keptHomes = 0;
    for (let rank = 0; rank < homesLeft; rank += 1) {
      const home = activeHomes[rank];
      if (!taken[home]) activeHomes[keptHomes++] = home;
    }
    grainsLeft = keptGrains;
    homesLeft = keptHomes;
  }
  return matched;
}
