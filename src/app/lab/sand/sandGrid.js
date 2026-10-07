export const LOOSE = 2;
export const PICTURE = 255;
export const LANDED = 254;

const GRAVITY = 0.12;
const TERMINAL = 4;
const SLIDE_CHANCE = 0.6;
const SPREAD_SPEED = 0.4;
const SPREAD_CHANCE = 0.45;
const SLIDE_KEEP = 0.7;
const POKE_LIFT = 4;
const POKE_DEPTH = 4;

export const pack = (homeX, homeY, kind) => homeX | (homeY << 8) | (kind << 16);

export function createRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  return {
    bits: next,
    unit: () => next() / 4294967296,
  };
}

export function hashCell(x, y) {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function createGrid(width, height) {
  const cells = new Uint32Array(width * height);
  return {
    width,
    height,
    cover: width,
    cells,
    bytes: new Uint8Array(cells.buffer),
    glued: new Uint8Array(width * height),
    velocity: new Float32Array(width * height),
    loose: 0,
    tick: 0,
  };
}

export function fillIntact(grid) {
  const { width, cover, cells, glued, velocity } = grid;
  cells.fill(0);
  velocity.fill(0);
  glued.fill(0);
  glued.fill(PICTURE, 0, width * cover);
  grid.loose = 0;
}

export function stepGrid(grid, random, gravityScale = 1) {
  const { width, height, cells, velocity } = grid;
  const gravity = GRAVITY * gravityScale;
  const terminal = TERMINAL * Math.max(1, gravityScale);
  const total = cells.length;
  grid.tick += 1;
  let moved = 0;
  for (let y = height - 2; y >= 0; y -= 1) {
    const forward = ((y + grid.tick) & 1) === 0;
    const row = y * width;
    for (let k = 0; k < width; k += 1) {
      const x = forward ? k : width - 1 - k;
      const index = row + x;
      const value = cells[index];
      if (value >>> 16 !== LOOSE) continue;
      const below = index + width;
      if (cells[below] === 0) {
        let speed = velocity[index] + gravity;
        if (speed > terminal) speed = terminal;
        const reach = 1 + (speed | 0);
        let target = below;
        let probe = below + width;
        for (let travelled = 1; travelled < reach && probe < total && cells[probe] === 0; travelled += 1) {
          target = probe;
          probe += width;
        }
        cells[target] = value;
        cells[index] = 0;
        velocity[target] = speed;
        velocity[index] = 0;
        moved += 1;
        continue;
      }
      const speed = velocity[index];
      const bits = random.bits();
      const side = bits & 1 ? 1 : -1;
      if ((bits >>> 1) / 2147483648 < SLIDE_CHANCE) {
        let landed = -1;
        const first = x + side;
        const second = x - side;
        if (first >= 0 && first < width && cells[below + side] === 0) landed = below + side;
        else if (second >= 0 && second < width && cells[below - side] === 0) landed = below - side;
        if (landed >= 0) {
          cells[landed] = value;
          cells[index] = 0;
          velocity[landed] = speed * SLIDE_KEEP;
          velocity[index] = 0;
          moved += 1;
          continue;
        }
      }
      if (speed > SPREAD_SPEED && random.unit() < SPREAD_CHANCE) {
        const far = x + side * 2;
        if (far >= 0 && far < width && cells[index + side] === 0 && cells[below + side * 2] === 0) {
          const landed = below + side * 2;
          cells[landed] = value;
          cells[index] = 0;
          velocity[landed] = speed * 0.45;
          velocity[index] = 0;
          moved += 1;
          continue;
        }
      }
      velocity[index] = speed > 0.05 ? speed * 0.5 : 0;
    }
  }
  return moved;
}

export function loosenDisc(grid, centreX, centreY, radius, chance, random) {
  const { width, height, cover, cells, glued, velocity } = grid;
  const radiusSquared = radius * radius;
  const top = Math.max(0, Math.floor(centreY - radius));
  const bottom = Math.min(Math.min(height, cover) - 1, Math.ceil(centreY + radius));
  const left = Math.max(0, Math.floor(centreX - radius));
  const right = Math.min(width - 1, Math.ceil(centreX + radius));
  let freed = 0;
  for (let y = top; y <= bottom; y += 1) {
    const dy = y + 0.5 - centreY;
    for (let x = left; x <= right; x += 1) {
      const index = y * width + x;
      if (glued[index] === 0 || cells[index] !== 0) continue;
      const dx = x + 0.5 - centreX;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) continue;
      const falloff = 1 - distanceSquared / radiusSquared;
      if (random.unit() >= chance * (0.35 + 0.65 * falloff)) continue;
      glued[index] = 0;
      cells[index] = pack(x, y, LOOSE);
      velocity[index] = 0;
      freed += 1;
    }
  }
  grid.loose += freed;
  return freed;
}

export function plowDisc(grid, centreX, centreY, radius, stepX, stepY) {
  const { width, height, cells, velocity } = grid;
  if (!stepX && !stepY) return 0;
  const radiusSquared = radius * radius;
  const top = Math.max(1, Math.floor(centreY - radius));
  const bottom = Math.min(height - 1, Math.ceil(centreY + radius));
  const left = Math.max(1, Math.floor(centreX - radius));
  const right = Math.min(width - 2, Math.ceil(centreX + radius));
  const rowStart = stepY > 0 ? bottom : top;
  const rowEnd = stepY > 0 ? top - 1 : bottom + 1;
  const rowStep = stepY > 0 ? -1 : 1;
  const columnStart = stepX > 0 ? right : left;
  const columnEnd = stepX > 0 ? left - 1 : right + 1;
  const columnStep = stepX > 0 ? -1 : 1;
  let moved = 0;
  for (let y = rowStart; y !== rowEnd; y += rowStep) {
    const dy = y + 0.5 - centreY;
    for (let x = columnStart; x !== columnEnd; x += columnStep) {
      const dx = x + 0.5 - centreX;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const index = y * width + x;
      const value = cells[index];
      if (value >>> 16 !== LOOSE) continue;
      let target = index + stepY * width + stepX;
      if (cells[target] !== 0) target = index - width + stepX;
      if (target < 0 || cells[target] !== 0) continue;
      cells[target] = value;
      cells[index] = 0;
      velocity[target] = 0;
      velocity[index] = 0;
      moved += 1;
    }
  }
  return moved;
}

export function pokeDisc(grid, centreX, centreY, radius, random) {
  const { width, height, cells, velocity } = grid;
  let moved = loosenDisc(grid, centreX, centreY, radius * 0.55, 0.7, random);
  const left = Math.max(0, Math.floor(centreX - radius));
  const right = Math.min(width - 1, Math.ceil(centreX + radius));
  const searchTop = Math.max(1, Math.floor(centreY - radius * 1.5));
  const searchBottom = Math.min(height - 1, Math.ceil(centreY + radius * 1.5));
  for (let x = left; x <= right; x += 1) {
    const dx = (x + 0.5 - centreX) / radius;
    const falloff = 1 - dx * dx;
    if (falloff <= 0) continue;
    const lift = Math.round(POKE_LIFT * falloff * (0.65 + 0.35 * random.unit()));
    if (lift < 1) continue;
    let top = -1;
    for (let y = searchTop; y <= searchBottom; y += 1) {
      if (cells[y * width + x] !== 0) {
        top = y;
        break;
      }
    }
    if (top < 0 || cells[(top - 1) * width + x] !== 0) continue;
    const drift = dx > 0.2 ? 1 : dx < -0.2 ? -1 : 0;
    for (let depth = 0; depth < POKE_DEPTH; depth += 1) {
      const row = top + depth;
      if (row >= height) break;
      const index = row * width + x;
      const value = cells[index];
      if (value === 0) break;
      let target = index;
      for (let climb = 0; climb < lift; climb += 1) {
        const above = target - width;
        if (above < 0 || cells[above] !== 0) break;
        target = above;
      }
      const targetX = target % width;
      const drifted = target + drift;
      if (depth === 0 && drift !== 0 && targetX + drift >= 0 && targetX + drift < width && cells[drifted] === 0) target = drifted;
      if (target === index) continue;
      cells[target] = value;
      cells[index] = 0;
      velocity[target] = 0;
      velocity[index] = 0;
      moved += 1;
    }
  }
  return moved;
}

export function releaseCascade(grid, elapsedMs, spanMs, jitterMs) {
  const { width, cover, cells, glued, velocity } = grid;
  let freed = 0;
  const reachRow = Math.min(cover - 1, Math.floor((elapsedMs / spanMs) * cover));
  for (let y = 0; y <= reachRow; y += 1) {
    const rowTime = (y / cover) * spanMs;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      if (glued[index] === 0 || cells[index] !== 0) continue;
      if (rowTime + hashCell(x, y) * jitterMs > elapsedMs) continue;
      glued[index] = 0;
      cells[index] = pack(x, y, LOOSE);
      velocity[index] = 0;
      freed += 1;
    }
  }
  grid.loose += freed;
  return freed;
}

export function countGrains(grid) {
  const { cells, glued } = grid;
  let loose = 0;
  let picture = 0;
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== 0) loose += 1;
    if (glued[index] !== 0) picture += 1;
  }
  return { loose, picture };
}
