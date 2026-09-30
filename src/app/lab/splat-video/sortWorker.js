const BUCKETS = 65536;

let scene = null;

function init(message) {
  const total = message.staticCount + message.dynamicCount;
  scene = {
    staticPoints: message.staticPoints,
    dynamicPoints: message.dynamicPoints,
    staticCount: message.staticCount,
    dynamicCount: message.dynamicCount,
    layerTexels: message.layerTexels,
    boundsMin: message.boundsMin,
    boundsSize: message.boundsSize,
    total,
    depths: new Float32Array(total),
    keys: new Uint16Array(total),
    counts: new Uint32Array(BUCKETS),
    staticRow: null,
  };
}

function sameRow(a, b) {
  return b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function sort({ zRow, frame0, frame1, blend, recycle, id }) {
  const { staticPoints, dynamicPoints, staticCount, dynamicCount, layerTexels, boundsMin, boundsSize, total, depths, keys, counts } = scene;
  const unit = 1 / 65535;
  const ax = zRow[0] * boundsSize[0] * unit;
  const ay = zRow[1] * boundsSize[1] * unit;
  const az = zRow[2] * boundsSize[2] * unit;
  const offset = zRow[0] * boundsMin[0] + zRow[1] * boundsMin[1] + zRow[2] * boundsMin[2] + zRow[3];

  if (!sameRow(zRow, scene.staticRow)) {
    for (let i = 0; i < staticCount; i += 1) {
      const p = i * 4;
      depths[i] = ax * staticPoints[p] + ay * staticPoints[p + 1] + az * staticPoints[p + 2] + offset;
    }
    scene.staticRow = zRow.slice();
  }

  const layer0 = frame0 * layerTexels * 4;
  const layer1 = frame1 * layerTexels * 4;
  for (let j = 0; j < dynamicCount; j += 1) {
    const p0 = layer0 + j * 4;
    const p1 = layer1 + j * 4;
    const z0 = ax * dynamicPoints[p0] + ay * dynamicPoints[p0 + 1] + az * dynamicPoints[p0 + 2];
    const z1 = ax * dynamicPoints[p1] + ay * dynamicPoints[p1 + 1] + az * dynamicPoints[p1 + 2];
    depths[staticCount + j] = z0 + (z1 - z0) * blend + offset;
  }

  let nearest = -Infinity;
  let farthest = Infinity;
  for (let i = 0; i < total; i += 1) {
    const depth = depths[i];
    if (depth > nearest) nearest = depth;
    if (depth < farthest) farthest = depth;
  }

  const range = nearest - farthest;
  const scale = range > 0 ? (BUCKETS - 1) / range : 0;
  counts.fill(0);
  for (let i = 0; i < total; i += 1) {
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

  const order = recycle && recycle.length === total ? recycle : new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const key = keys[i];
    order[counts[key]] = i;
    counts[key] += 1;
  }

  self.postMessage({ type: "sorted", id, order }, [order.buffer]);
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") init(message);
  else if (message.type === "sort" && scene) sort(message);
};
