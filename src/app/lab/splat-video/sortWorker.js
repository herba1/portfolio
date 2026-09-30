const BUCKETS = 65536;

let scene = null;

function largestFrame(offsets) {
  let largest = 0;
  for (let f = 0; f + 1 < offsets.length; f += 1) largest = Math.max(largest, offsets[f + 1] - offsets[f]);
  return largest;
}

function init(message) {
  const frameOffsets = message.frameOffsets ?? null;
  const capacity = frameOffsets
    ? message.staticCount + largestFrame(frameOffsets)
    : message.staticCount + message.dynamicCount;
  const pointCount = frameOffsets ? message.staticCount + frameOffsets[frameOffsets.length - 1] : capacity;
  scene = {
    staticPoints: message.staticPoints,
    dynamicPoints: message.dynamicPoints,
    staticCount: message.staticCount,
    dynamicCount: message.dynamicCount,
    layerTexels: message.layerTexels,
    boundsMin: message.boundsMin,
    boundsSize: message.boundsSize,
    frameOffsets,
    capacity,
    staticDepths: new Float32Array(frameOffsets ? pointCount : message.staticCount),
    depths: new Float32Array(capacity),
    indices: new Uint32Array(capacity),
    keys: new Uint16Array(capacity),
    counts: new Uint32Array(BUCKETS),
    staticRow: null,
  };
}

function sameRow(a, b) {
  return b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function projection(zRow) {
  const { boundsMin, boundsSize } = scene;
  const unit = 1 / 65535;
  return {
    ax: zRow[0] * boundsSize[0] * unit,
    ay: zRow[1] * boundsSize[1] * unit,
    az: zRow[2] * boundsSize[2] * unit,
    offset: zRow[0] * boundsMin[0] + zRow[1] * boundsMin[1] + zRow[2] * boundsMin[2] + zRow[3],
  };
}

function gather(zRow, frame0, frame1, blend) {
  const { staticPoints, dynamicPoints, staticCount, dynamicCount, layerTexels, frameOffsets, staticDepths, depths, indices } = scene;
  const { ax, ay, az, offset } = projection(zRow);
  const rowChanged = !sameRow(zRow, scene.staticRow);

  if (frameOffsets) {
    const start = staticCount + frameOffsets[frame0];
    const end = staticCount + frameOffsets[frame0 + 1];
    if (rowChanged) {
      for (let i = 0; i < staticCount; i += 1) {
        const p = i * 4;
        staticDepths[i] = ax * staticPoints[p] + ay * staticPoints[p + 1] + az * staticPoints[p + 2] + offset;
      }
      scene.staticRow = zRow.slice();
    }
    for (let i = 0; i < staticCount; i += 1) {
      depths[i] = staticDepths[i];
      indices[i] = i;
    }
    let n = staticCount;
    for (let i = start; i < end; i += 1) {
      const p = i * 4;
      depths[n] = ax * staticPoints[p] + ay * staticPoints[p + 1] + az * staticPoints[p + 2] + offset;
      indices[n] = i;
      n += 1;
    }
    return n;
  }

  if (rowChanged) {
    for (let i = 0; i < staticCount; i += 1) {
      const p = i * 4;
      staticDepths[i] = ax * staticPoints[p] + ay * staticPoints[p + 1] + az * staticPoints[p + 2] + offset;
    }
    scene.staticRow = zRow.slice();
  }
  for (let i = 0; i < staticCount; i += 1) {
    depths[i] = staticDepths[i];
    indices[i] = i;
  }
  const layer0 = frame0 * layerTexels * 4;
  const layer1 = frame1 * layerTexels * 4;
  for (let j = 0; j < dynamicCount; j += 1) {
    const p0 = layer0 + j * 4;
    const p1 = layer1 + j * 4;
    const z0 = ax * dynamicPoints[p0] + ay * dynamicPoints[p0 + 1] + az * dynamicPoints[p0 + 2];
    const z1 = ax * dynamicPoints[p1] + ay * dynamicPoints[p1 + 1] + az * dynamicPoints[p1 + 2];
    depths[staticCount + j] = z0 + (z1 - z0) * blend + offset;
    indices[staticCount + j] = staticCount + j;
  }
  return staticCount + dynamicCount;
}

function sort({ zRow, frame0, frame1, blend, recycle, id }) {
  const { depths, indices, keys, counts, capacity } = scene;
  const count = gather(zRow, frame0, frame1, blend);

  let nearest = -Infinity;
  let farthest = Infinity;
  for (let i = 0; i < count; i += 1) {
    const depth = depths[i];
    if (depth > nearest) nearest = depth;
    if (depth < farthest) farthest = depth;
  }

  const range = nearest - farthest;
  const scale = range > 0 ? (BUCKETS - 1) / range : 0;
  counts.fill(0);
  for (let i = 0; i < count; i += 1) {
    const key = ((depths[i] - farthest) * scale) | 0;
    keys[i] = key;
    counts[key] += 1;
  }
  let running = 0;
  for (let k = 0; k < BUCKETS; k += 1) {
    const size = counts[k];
    counts[k] = running;
    running += size;
  }

  const order = recycle && recycle.length === capacity ? recycle : new Float32Array(capacity);
  for (let i = 0; i < count; i += 1) {
    const key = keys[i];
    order[counts[key]] = indices[i];
    counts[key] += 1;
  }

  self.postMessage({ type: "sorted", id, order, count, frame: frame0 }, [order.buffer]);
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") init(message);
  else if (message.type === "sort" && scene) sort(message);
};
