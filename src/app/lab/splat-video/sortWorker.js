const BUCKETS = 65536;

let scene = null;
let stream = null;

function sortBuffers(capacity) {
  return {
    capacity,
    depths: new Float32Array(capacity),
    indices: new Uint32Array(capacity),
    keys: new Uint16Array(capacity),
    counts: new Uint32Array(BUCKETS),
  };
}

function init(message) {
  const frameOffsets = message.frameOffsets ?? null;
  const capacity = message.capacity;
  scene = {
    staticPoints: message.staticPoints,
    dynamicPoints: message.dynamicPoints,
    staticCount: message.staticCount,
    dynamicCount: message.dynamicCount,
    layerTexels: message.layerTexels,
    boundsMin: message.boundsMin,
    boundsSize: message.boundsSize,
    frameOffsets,
    staticDepths: new Float32Array(message.staticCount),
    staticRow: null,
    ...sortBuffers(capacity),
  };
}

function sameRow(a, b) {
  return b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function projection(zRow, boundsMin, boundsSize) {
  const unit = 1 / 65535;
  return {
    ax: zRow[0] * boundsSize[0] * unit,
    ay: zRow[1] * boundsSize[1] * unit,
    az: zRow[2] * boundsSize[2] * unit,
    offset: zRow[0] * boundsMin[0] + zRow[1] * boundsMin[1] + zRow[2] * boundsMin[2] + zRow[3],
  };
}

function refreshStaticDepths(state, zRow, points, boundsMin, boundsSize) {
  if (sameRow(zRow, state.staticRow)) return;
  const { ax, ay, az, offset } = projection(zRow, boundsMin, boundsSize);
  const { staticDepths, staticCount } = state;
  for (let i = 0; i < staticCount; i += 1) {
    const p = i * 4;
    staticDepths[i] = ax * points[p] + ay * points[p + 1] + az * points[p + 2] + offset;
  }
  state.staticRow = zRow.slice();
}

function copyStatic(state) {
  const { staticDepths, staticCount, depths, indices } = state;
  for (let i = 0; i < staticCount; i += 1) {
    depths[i] = staticDepths[i];
    indices[i] = i;
  }
}

function gatherMoments(zRow, momentA, momentB) {
  const { staticPoints, staticCount, frameOffsets, depths, indices } = scene;
  const { ax, ay, az, offset } = projection(zRow, scene.boundsMin, scene.boundsSize);
  refreshStaticDepths(scene, zRow, staticPoints, scene.boundsMin, scene.boundsSize);
  copyStatic(scene);

  const start = staticCount + frameOffsets[momentA];
  const end = staticCount + frameOffsets[momentB + 1];
  let n = staticCount;
  for (let i = start; i < end; i += 1) {
    const p = i * 4;
    depths[n] = ax * staticPoints[p] + ay * staticPoints[p + 1] + az * staticPoints[p + 2] + offset;
    indices[n] = i;
    n += 1;
  }
  return n;
}

function gatherFrames(zRow, frame0, frame1, blend) {
  const { staticPoints, dynamicPoints, staticCount, dynamicCount, layerTexels, depths, indices } = scene;
  const { ax, ay, az, offset } = projection(zRow, scene.boundsMin, scene.boundsSize);
  refreshStaticDepths(scene, zRow, staticPoints, scene.boundsMin, scene.boundsSize);
  copyStatic(scene);

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

function backToFront(state, count, recycle) {
  const { depths, indices, keys, counts, capacity } = state;

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
  return order;
}

function sort({ zRow, frame0, frame1, blend, momentA, momentB, recycle, id }) {
  if (scene.frameOffsets) {
    const count = gatherMoments(zRow, momentA, momentB);
    const order = backToFront(scene, count, recycle);
    const movingStart = scene.staticCount;
    const split = scene.staticCount + scene.frameOffsets[momentA + 1];
    self.postMessage({ type: "sorted", id, order, count, momentA, momentB, movingStart, split }, [order.buffer]);
    return;
  }
  const count = gatherFrames(zRow, frame0, frame1, blend);
  const order = backToFront(scene, count, recycle);
  self.postMessage({ type: "sorted", id, order, count, frame: frame0 }, [order.buffer]);
}

function initStream(message) {
  stream = {
    staticPoints: message.staticPoints,
    staticCount: message.staticCount,
    boundsMin: message.boundsMin,
    boundsSize: message.boundsSize,
    staticDepths: new Float32Array(message.staticCount),
    staticRow: null,
    chunks: new Map(),
    ...sortBuffers(message.capacity),
  };
}

function addChunk({ index, token, points, shared, frameOffsets, boundsMin, boundsSize }) {
  stream.chunks.set(index, { token, points, shared: shared ?? 0, frameOffsets, boundsMin, boundsSize });
}

function dropChunk({ index, token }) {
  if (stream.chunks.get(index)?.token === token) stream.chunks.delete(index);
}

function sortChunk({ zRow, chunk, token, momentA, momentB, recycle, id }) {
  const entry = stream.chunks.get(chunk);
  if (!entry || entry.token !== token) {
    self.postMessage({ type: "sorted", id, order: recycle ?? null, count: 0, chunk, token, momentA, momentB, missing: true }, recycle ? [recycle.buffer] : []);
    return;
  }
  const { staticCount, depths, indices } = stream;
  refreshStaticDepths(stream, zRow, stream.staticPoints, stream.boundsMin, stream.boundsSize);
  copyStatic(stream);

  const { points, frameOffsets, shared } = entry;
  const { ax, ay, az, offset } = projection(zRow, entry.boundsMin, entry.boundsSize);
  const end = frameOffsets[momentB + 1];
  let n = staticCount;
  for (let j = 0; j < shared; j += 1) {
    const p = j * 4;
    depths[n] = ax * points[p] + ay * points[p + 1] + az * points[p + 2] + offset;
    indices[n] = staticCount + j;
    n += 1;
  }
  for (let j = frameOffsets[momentA]; j < end; j += 1) {
    const p = j * 4;
    depths[n] = ax * points[p] + ay * points[p + 1] + az * points[p + 2] + offset;
    indices[n] = staticCount + j;
    n += 1;
  }

  const order = backToFront(stream, n, recycle);
  const movingStart = staticCount + shared;
  const split = staticCount + frameOffsets[momentA + 1];
  self.postMessage({ type: "sorted", id, order, count: n, chunk, token, momentA, momentB, movingStart, split }, [order.buffer]);
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") init(message);
  else if (message.type === "sort" && scene) sort(message);
  else if (message.type === "stream") initStream(message);
  else if (message.type === "chunk" && stream) addChunk(message);
  else if (message.type === "drop" && stream) dropChunk(message);
  else if (message.type === "sortChunk" && stream) sortChunk(message);
};
