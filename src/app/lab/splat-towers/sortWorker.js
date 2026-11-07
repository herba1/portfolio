// Back-to-front order for the splat field, off the main thread.
//
// init: { pos: Float32Array xyz, meta: Uint8Array flags }
// sort: { cam: [x,y,z], fwd: [x,y,z], cut, id } -> { order: Uint32Array, count, id }
//
// A 16-bit counting sort on log view depth: towers 20 m off and a sky dome
// 1.5 km off share one key range without crowding either end.

const BUCKETS = 65536;
let pos = null;
let meta = null;
let n = 0;
let keys = null;
const counts = new Uint32Array(BUCKETS);

// Level-of-detail cut: every leaf down to `cut`, plus the coarser cell that
// stands in for the leaves below it.
// The edges of the view draw from a coarse cut (16 px cells) so the splats
// there are big enough to be seen as splats; both sets are sorted together.
const COARSE = 4;
function active(f, cut) {
  const leaf = (f >> 1) & 1;
  const level = (f >> 2) & 7;
  return leaf ? level <= cut || level <= COARSE : level === cut || level === COARSE;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    pos = m.pos;
    meta = m.meta;
    n = meta.length;
    keys = new Uint16Array(n);
    return;
  }
  if (m.type !== "sort" || !pos) return;
  const [cx, cy, cz] = m.cam;
  const [fx, fy, fz] = m.fwd;
  const cut = m.cut;
  const LMIN = Math.log(0.5);
  const LMAX = Math.log(8000);
  const scale = (BUCKETS - 1) / (LMAX - LMIN);
  counts.fill(0);
  const order = new Uint32Array(n);
  let count = 0;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    if (!active(meta[i], cut)) continue;
    const p = i * 3;
    const z = (pos[p] - cx) * fx + (pos[p + 1] - cy) * fy + (pos[p + 2] - cz) * fz;
    if (z < 0.5) continue;
    // far first: invert the key
    let k = Math.round((Math.log(z) - LMIN) * scale);
    k = BUCKETS - 1 - (k < 0 ? 0 : k > BUCKETS - 1 ? BUCKETS - 1 : k);
    keys[count] = k;
    idx[count] = i;
    counts[k]++;
    count++;
  }
  let sum = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const c = counts[b];
    counts[b] = sum;
    sum += c;
  }
  for (let j = 0; j < count; j++) order[counts[keys[j]]++] = idx[j];
  self.postMessage({ order, count, id: m.id }, [order.buffer]);
};
