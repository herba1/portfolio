export const VANISHED = 255;
const SHEET_CLAIM = 256;
const FREE = -1;

export function detachIslands(pixels, size, labels, { holeAt, minTexels, fleckTexels, dilate, final, firstLabel, room, lastLabel }) {
  const cells = size * size;
  const holeByte = Math.round(holeAt * 255);
  const parent = new Int32Array(cells).fill(-1);
  for (let index = 0; index < cells; index += 1) if (!labels[index] && pixels[index * 4] < holeByte) parent[index] = index;

  const rootOf = (index) => {
    let node = index;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const join = (a, b) => {
    const rootA = rootOf(a);
    const rootB = rootOf(b);
    if (rootA === rootB) return;
    if (rootA < rootB) parent[rootB] = rootA;
    else parent[rootA] = rootB;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (parent[index] < 0) continue;
      if (x > 0 && parent[index - 1] >= 0) join(index, index - 1);
      if (y > 0 && parent[index - size] >= 0) join(index, index - size);
    }
  }

  const islandOfRoot = new Int32Array(cells).fill(-1);
  const found = [];
  const anchorRow = size - 1;
  let burnWeight = 0;
  let burnX = 0;
  let burnY = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const burn = labels[index] ? 1 : pixels[index * 4 + 2] / 255;
      burnWeight += burn;
      burnX += (x + 0.5) * burn;
      burnY += (y + 0.5) * burn;
      if (parent[index] < 0) continue;
      const root = rootOf(index);
      let islandIndex = islandOfRoot[root];
      if (islandIndex < 0) {
        islandIndex = found.length;
        islandOfRoot[root] = islandIndex;
        found.push({ area: 0, sumX: 0, sumY: 0, minX: x, maxX: x, minY: y, maxY: y, heat: 0, anchored: false, claim: SHEET_CLAIM });
      }
      const island = found[islandIndex];
      island.area += 1;
      island.sumX += x + 0.5;
      island.sumY += y + 0.5;
      if (x < island.minX) island.minX = x;
      if (x > island.maxX) island.maxX = x;
      if (y < island.minY) island.minY = y;
      if (y > island.maxY) island.maxY = y;
      if (y === anchorRow) island.anchored = true;
      const heat = pixels[index * 4 + 1] / 255;
      if (heat > island.heat) island.heat = heat;
    }
  }

  let attachedArea = 0;
  for (const island of found) if (island.anchored) attachedArea += island.area;
  const loose = found.filter((island) => final || !island.anchored).sort((a, b) => b.area - a.area);
  const summary = {
    attachedShare: attachedArea / cells,
    centreU: burnWeight > 0.5 ? burnX / burnWeight / size : 0.5,
    centreV: burnWeight > 0.5 ? burnY / burnWeight / size : 0.3,
  };
  if (!loose.length) return { ...summary, changed: false, islands: [], firstLabel, nextLabel: firstLabel, looseShare: 0 };

  let nextLabel = firstLabel;
  const kept = [];
  let looseArea = 0;
  for (const island of loose) {
    looseArea += island.area;
    if (island.area >= minTexels && kept.length < room && nextLabel <= lastLabel) {
      island.claim = nextLabel;
      nextLabel += 1;
      kept.push(island);
    } else island.claim = VANISHED;
  }

  const claims = new Int16Array(cells);
  for (let index = 0; index < cells; index += 1) {
    if (labels[index]) claims[index] = 0;
    else if (parent[index] < 0) claims[index] = FREE;
    else claims[index] = found[islandOfRoot[rootOf(index)]].claim;
  }

  let frontier = new Int32Array(cells);
  let next = new Int32Array(cells);
  let frontierCount = 0;
  for (let index = 0; index < cells; index += 1) {
    const claim = claims[index];
    if (claim <= 0 || claim === VANISHED) continue;
    const x = index % size;
    const open =
      (x > 0 && claims[index - 1] === FREE) ||
      (x < size - 1 && claims[index + 1] === FREE) ||
      (index >= size && claims[index - size] === FREE) ||
      (index < cells - size && claims[index + size] === FREE);
    if (open) {
      frontier[frontierCount] = index;
      frontierCount += 1;
    }
  }

  for (let step = 0; step < dilate && frontierCount; step += 1) {
    let nextCount = 0;
    for (let cursor = 0; cursor < frontierCount; cursor += 1) {
      const index = frontier[cursor];
      const x = index % size;
      const claim = claims[index];
      if (x > 0 && claims[index - 1] === FREE) {
        claims[index - 1] = claim;
        next[nextCount++] = index - 1;
      }
      if (x < size - 1 && claims[index + 1] === FREE) {
        claims[index + 1] = claim;
        next[nextCount++] = index + 1;
      }
      if (index >= size && claims[index - size] === FREE) {
        claims[index - size] = claim;
        next[nextCount++] = index - size;
      }
      if (index < cells - size && claims[index + size] === FREE) {
        claims[index + size] = claim;
        next[nextCount++] = index + size;
      }
    }
    const spent = frontier;
    frontier = next;
    next = spent;
    frontierCount = nextCount;
  }

  for (let index = 0; index < cells; index += 1) {
    const claim = claims[index];
    if (claim > 0 && claim !== SHEET_CLAIM) labels[index] = claim;
  }

  const islands = kept.map((island) => ({
    label: island.claim,
    texels: island.area,
    share: island.area / cells,
    cx: island.sumX / island.area / size,
    cy: island.sumY / island.area / size,
    minU: Math.max(0, island.minX - dilate) / size,
    maxU: Math.min(size, island.maxX + 1 + dilate) / size,
    minV: Math.max(0, island.minY - dilate) / size,
    maxV: Math.min(size, island.maxY + 1 + dilate) / size,
    heat: island.heat * 2,
    fleck: island.area < fleckTexels,
  }));

  return { ...summary, changed: true, islands, firstLabel, nextLabel, looseShare: looseArea / cells };
}
