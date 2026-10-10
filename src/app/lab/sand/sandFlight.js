export const PATH_STRIDE = 13;
export const CLUMP_FIELDS = 7;
export const REGION_SPLIT = 3;
export const REGION_COUNT = REGION_SPLIT * REGION_SPLIT;

const SETTLE_SWEEP_S = 0.7;
const SETTLE_DEPTH = 0.55;
const FRONT_WARP_S = 0.14;
const FRONT_JITTER_S = 0.05;
const DEPART_S = 0.2;
const AIRBORNE_S = 0.04;
const RELEASE_FROM = 0.64;
const RELEASE_S = 0.95;
const RELEASE_MIN_S = 0.45;
const CLUMP_FLOOR_S = 0.9;
const ORDER_BUCKETS = 512;

export function regionOf(x, y, cover) {
  const column = Math.min(REGION_SPLIT - 1, Math.floor((x * REGION_SPLIT) / cover));
  const row = Math.min(REGION_SPLIT - 1, Math.floor((y * REGION_SPLIT) / cover));
  return row * REGION_SPLIT + column;
}

export function createFlightScratch(capacity, clumpSlots) {
  return {
    path: new Float32Array(capacity * PATH_STRIDE),
    colour: new Uint8Array(capacity * 8),
    sortedPath: new Float32Array(capacity * PATH_STRIDE),
    sortedColour: new Uint8Array(capacity * 8),
    clumps: new Int32Array(capacity),
    sums: new Float64Array(clumpSlots * CLUMP_FIELDS),
    starts: new Float64Array(clumpSlots),
    counts: new Uint32Array(ORDER_BUCKETS + 1),
  };
}

export function scheduleLandings(data, count, { cover, diagonal, originX, frontNoise, airborneFrom, slots, flightFor }) {
  const { path, clumps, sums, starts } = data;
  const frontX = Math.min(cover, Math.max(0, originX));
  const frontY = cover * (1 + SETTLE_DEPTH);
  const nearest = cover * SETTLE_DEPTH;
  const farthest = Math.max(Math.hypot(frontX, frontY), Math.hypot(cover - frontX, frontY));
  const frontScale = SETTLE_SWEEP_S / Math.max(1, farthest - nearest);
  sums.fill(0, 0, slots * CLUMP_FIELDS);
  starts.fill(Infinity, 0, slots);
  for (let rank = 0; rank < count; rank += 1) {
    const at = rank * PATH_STRIDE;
    const toX = path[at + 2];
    const toY = path[at + 3];
    const front = Math.max(0, Math.hypot(toX + 0.5 - frontX, frontY - toY - 0.5) - nearest) * frontScale;
    const lands = front + (frontNoise[toY * cover + toX] - 0.5) * FRONT_WARP_S + path[at + 5] * FRONT_JITTER_S;
    path[at + 6] = lands;
    const clump = clumps[rank];
    const sum = clump * CLUMP_FIELDS;
    sums[sum] += path[at];
    sums[sum + 1] += path[at + 1];
    sums[sum + 2] += toX;
    sums[sum + 3] += toY;
    sums[sum + 4] += path[at + 4];
    sums[sum + 5] += 1;
    if (lands < starts[clump]) starts[clump] = lands;
  }

  let earliest = Infinity;
  for (let clump = 0; clump < slots; clump += 1) {
    const sum = clump * CLUMP_FIELDS;
    const members = sums[sum + 5];
    if (!members) continue;
    sums[sum] /= members;
    sums[sum + 1] /= members;
    sums[sum + 2] /= members;
    sums[sum + 3] /= members;
    const span = Math.hypot(sums[sum + 2] - sums[sum], sums[sum + 3] - sums[sum + 1]) / diagonal;
    const arrives = starts[clump];
    const flies = Math.max(CLUMP_FLOOR_S, flightFor(span));
    const departs = arrives - flies - (sums[sum + 4] / members) * DEPART_S;
    sums[sum + 4] = arrives;
    starts[clump] = departs;
    if (clump < airborneFrom && departs < earliest) earliest = departs;
  }
  if (earliest === Infinity) earliest = 0;

  for (let clump = 0; clump < slots; clump += 1) {
    const sum = clump * CLUMP_FIELDS;
    if (!sums[sum + 5]) continue;
    const departs = clump >= airborneFrom ? AIRBORNE_S : starts[clump] - earliest;
    const arrives = Math.max(sums[sum + 4] - earliest, departs + CLUMP_FLOOR_S);
    starts[clump] = departs;
    sums[sum + 4] = arrives;
    sums[sum + 6] = arrives - departs;
  }

  let latest = 0;
  for (let rank = 0; rank < count; rank += 1) {
    const at = rank * PATH_STRIDE;
    const clump = clumps[rank];
    const sum = clump * CLUMP_FIELDS;
    const departs = starts[clump];
    const flies = sums[sum + 6];
    path[at + 7] = sums[sum];
    path[at + 8] = sums[sum + 1];
    path[at + 9] = sums[sum + 2];
    path[at + 10] = sums[sum + 3];
    path[at + 11] = departs;
    path[at + 12] = flies;
    const due = Math.max(path[at + 6] - earliest, sums[sum + 4]);
    const releases = Math.max(departs + flies * RELEASE_FROM, due - RELEASE_S);
    const lands = Math.max(due, releases + RELEASE_MIN_S);
    path[at + 4] = releases;
    path[at + 6] = lands - releases;
    if (lands > latest) latest = lands;
  }
  return latest;
}

export function orderByLanding(data, count, latest) {
  const { path, colour, sortedPath, sortedColour, clumps, counts } = data;
  const scale = (ORDER_BUCKETS - 1) / Math.max(latest, 0.001);
  counts.fill(0);
  for (let rank = 0; rank < count; rank += 1) {
    const at = rank * PATH_STRIDE;
    const bucket = Math.min(ORDER_BUCKETS - 1, Math.floor((path[at + 4] + path[at + 6]) * scale));
    clumps[rank] = bucket;
    counts[bucket + 1] += 1;
  }
  for (let bucket = 0; bucket < ORDER_BUCKETS; bucket += 1) counts[bucket + 1] += counts[bucket];
  for (let rank = 0; rank < count; rank += 1) {
    const slot = counts[clumps[rank]]++;
    const source = rank * PATH_STRIDE;
    const target = slot * PATH_STRIDE;
    for (let field = 0; field < PATH_STRIDE; field += 1) sortedPath[target + field] = path[source + field];
    const tint = rank * 8;
    const sortedTint = slot * 8;
    for (let byte = 0; byte < 8; byte += 1) sortedColour[sortedTint + byte] = colour[tint + byte];
  }
  data.path = sortedPath;
  data.sortedPath = path;
  data.colour = sortedColour;
  data.sortedColour = colour;
}
