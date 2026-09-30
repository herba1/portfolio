import { CLIP_NAME_RE, EXPORTS_ROOT, FALLBACK_CLIP, TEXTURE_WIDTH } from "./splatVideoParams";

export class Splat4dError extends Error {
  constructor(message, { clip = null, missing = false } = {}) {
    super(message);
    this.name = "Splat4dError";
    this.clip = clip;
    this.missing = missing;
  }
}

function entryName(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.name === "string") return entry.name;
  return null;
}

function indexEntries(index) {
  if (Array.isArray(index)) return index;
  if (index && Array.isArray(index.exports)) return index.exports;
  if (index && Array.isArray(index.clips)) return index.clips;
  return [];
}

export async function resolveClip(requested, signal) {
  if (requested) {
    if (!CLIP_NAME_RE.test(requested)) throw new Splat4dError(`“${requested}” is not a valid clip name.`, { clip: requested });
    return requested;
  }
  try {
    const response = await fetch(`${EXPORTS_ROOT}/index.json`, { cache: "no-store", signal });
    if (!response.ok) return FALLBACK_CLIP;
    const names = indexEntries(await response.json())
      .map(entryName)
      .filter((name) => name && CLIP_NAME_RE.test(name));
    return names.find((name) => name !== FALLBACK_CLIP) ?? FALLBACK_CLIP;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return FALLBACK_CLIP;
  }
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function validateMeta(meta, clip) {
  const fail = (why) => {
    throw new Splat4dError(`meta.json for “${clip}” ${why}`, { clip });
  };
  if (!meta || meta.format !== "splat4d") fail("is not a splat4d export.");
  if (meta.version === 2) {
    if (meta.kind !== "flipbook") fail(`has an unknown kind “${meta.kind}”.`);
    if (!isCount(meta.count) || !isCount(meta.staticCount)) fail("has invalid counts.");
    if (!(meta.fps > 0)) fail("has no fps.");
    const offsets = meta.frameOffsets;
    if (!Array.isArray(offsets) || offsets.length !== meta.frames + 1 || !offsets.every(isCount)) fail("has invalid frameOffsets.");
    if (meta.staticCount + offsets[offsets.length - 1] !== meta.count) fail("has frameOffsets that do not add up to count.");
  } else if (meta.version === 1) {
    if (!isCount(meta.count) || !isCount(meta.staticCount) || !isCount(meta.dynamicCount)) fail("has invalid counts.");
    if (meta.count !== meta.staticCount + meta.dynamicCount) fail("has a count that is not static plus dynamic.");
  } else {
    fail(`is version ${meta.version}; this player reads versions 1 and 2.`);
  }
  if (meta.count === 0) fail("has no splats.");
  if (!Number.isInteger(meta.frames) || meta.frames < 1) fail("has no frames.");
  if (!(meta.duration > 0)) fail("has no duration.");
  if (!isVector(meta.bounds?.min) || !isVector(meta.bounds?.max)) fail("has invalid bounds.");
  if (!(meta.covScale > 0)) fail("has an invalid covScale.");
  if (!(meta.camera?.vfovDeg > 0 && meta.camera.vfovDeg < 170)) fail("has no camera.vfovDeg.");
  const [, , minZ] = meta.bounds.min;
  const [, , maxZ] = meta.bounds.max;
  return {
    ...meta,
    camera: {
      vfovDeg: meta.camera.vfovDeg,
      aspect: meta.camera.aspect > 0 ? meta.camera.aspect : 16 / 9,
      pivotDepth: meta.camera.pivotDepth > 0 ? meta.camera.pivotDepth : Math.max(0.5, (minZ + maxZ) / 2),
    },
  };
}

function rowsFor(count) {
  return Math.max(1, Math.ceil(count / TEXTURE_WIDTH));
}

function linearWriter(bytes) {
  return (chunk, offset) => bytes.set(chunk, offset);
}

function frameMajorWriter(bytes, frameBytes, layerBytes) {
  return (chunk, offset) => {
    let read = 0;
    while (read < chunk.length) {
      const source = offset + read;
      const frame = Math.floor(source / frameBytes);
      const within = source - frame * frameBytes;
      const take = Math.min(chunk.length - read, frameBytes - within);
      bytes.set(chunk.subarray(read, read + take), frame * layerBytes + within);
      read += take;
    }
  };
}

async function streamInto({ url, name, clip, expected, write, signal, onChunk }) {
  if (expected === 0) return;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Splat4dError(`${name} for “${clip}” answered ${response.status}.`, { clip, missing: response.status === 404 });
  }
  const tooLong = () => new Splat4dError(`${name} for “${clip}” is larger than meta.json says (${expected} bytes).`, { clip });
  let received = 0;
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > expected) throw tooLong();
    write(whole, 0);
    received = whole.length;
    onChunk(whole.length);
  } else {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > expected) {
        reader.cancel();
        throw tooLong();
      }
      write(value, received);
      received += value.length;
      onChunk(value.length);
    }
  }
  if (received !== expected) {
    throw new Splat4dError(`${name} for “${clip}” is ${received} bytes; meta.json expects ${expected}.`, { clip });
  }
}

export async function loadSplat4d(clip, { signal, onProgress } = {}) {
  const folder = `${EXPORTS_ROOT}/${clip}`;
  let response;
  try {
    response = await fetch(`${folder}/meta.json`, { cache: "no-store", signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Splat4dError(`Could not reach ${folder}/meta.json.`, { clip });
  }
  if (response.status === 404) throw new Splat4dError(`No export named “${clip}” yet.`, { clip, missing: true });
  if (!response.ok) throw new Splat4dError(`${folder}/meta.json answered ${response.status}.`, { clip });

  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Splat4dError(`meta.json for “${clip}” is not valid JSON.`, { clip, missing: true });
  }
  const meta = validateMeta(raw, clip);
  if (meta.kind === "flipbook") return loadFlipbook(clip, folder, meta, { signal, onProgress });

  const baseRows = rowsFor(meta.count);
  const staticRows = rowsFor(meta.staticCount);
  const dynamicRows = rowsFor(meta.dynamicCount);
  const layerTexels = TEXTURE_WIDTH * dynamicRows;

  const base = new Uint32Array(TEXTURE_WIDTH * baseRows * 4);
  const staticPoints = new Uint16Array(TEXTURE_WIDTH * staticRows * 4);
  const dynamicPoints = new Uint16Array(layerTexels * meta.frames * 4);

  const expected = {
    base: meta.count * 16,
    static: meta.staticCount * 8,
    dynamic: meta.frames * meta.dynamicCount * 8,
  };
  const total = expected.base + expected.static + expected.dynamic;
  let loaded = 0;
  const onChunk = (bytes) => {
    loaded += bytes;
    if (onProgress) onProgress(loaded, total);
  };
  if (onProgress) onProgress(0, total);

  const version = `?v=${encodeURIComponent(String(meta.exportId ?? "0"))}`;
  await Promise.all([
    streamInto({
      url: `${folder}/base.bin${version}`,
      name: "base.bin",
      clip,
      expected: expected.base,
      write: linearWriter(new Uint8Array(base.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/static.bin${version}`,
      name: "static.bin",
      clip,
      expected: expected.static,
      write: linearWriter(new Uint8Array(staticPoints.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/dynamic.bin${version}`,
      name: "dynamic.bin",
      clip,
      expected: expected.dynamic,
      write: frameMajorWriter(new Uint8Array(dynamicPoints.buffer), meta.dynamicCount * 8, layerTexels * 8),
      signal,
      onChunk,
    }),
  ]);

  return {
    clip,
    meta,
    bytes: total,
    base,
    staticPoints,
    dynamicPoints,
    layout: { width: TEXTURE_WIDTH, baseRows, staticRows, dynamicRows, layerTexels },
  };
}

async function loadFlipbook(clip, folder, meta, { signal, onProgress }) {
  const rows = rowsFor(meta.count);
  const base = new Uint32Array(TEXTURE_WIDTH * rows * 4);
  const points = new Uint16Array(TEXTURE_WIDTH * rows * 4);
  const expected = { base: meta.count * 16, points: meta.count * 8 };
  const total = expected.base + expected.points;
  let loaded = 0;
  const onChunk = (bytes) => {
    loaded += bytes;
    if (onProgress) onProgress(loaded, total);
  };
  if (onProgress) onProgress(0, total);

  const version = `?v=${encodeURIComponent(String(meta.exportId ?? "0"))}`;
  await Promise.all([
    streamInto({
      url: `${folder}/base.bin${version}`,
      name: "base.bin",
      clip,
      expected: expected.base,
      write: linearWriter(new Uint8Array(base.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/points.bin${version}`,
      name: "points.bin",
      clip,
      expected: expected.points,
      write: linearWriter(new Uint8Array(points.buffer)),
      signal,
      onChunk,
    }),
  ]);

  return {
    clip,
    meta: { ...meta, dynamicCount: 0 },
    bytes: total,
    base,
    staticPoints: points,
    dynamicPoints: new Uint16Array(4),
    layout: { width: TEXTURE_WIDTH, baseRows: rows, staticRows: rows, dynamicRows: 1, layerTexels: 1 },
  };
}
