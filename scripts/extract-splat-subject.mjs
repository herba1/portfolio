#!/usr/bin/env node
/**
 * Extract a single subject (the person) out of a .splat capture and drop the
 * rest of the scene.
 *
 * The .splat format (antimatter15) is 32 bytes per gaussian:
 *   float32 x, y, z            (12)
 *   float32 sx, sy, sz         (12)
 *   uint8   r, g, b, a         (4)
 *   uint8   qw, qx, qy, qz     (4)   rotation, 128-centred
 *
 * Note drei's SplatLoader renders (x, -y, -z), so the capture's +Y is DOWN.
 *
 * Pipeline:
 *   1. cylinder ROI around the subject's footprint
 *   2. ground plane cut just under the soles
 *   3. drop oversized / near-transparent gaussians (background blobs)
 *   4. voxel connected-components, keep the largest blob (kills floaters)
 *   5. recentre to the origin, optionally normalise height
 *
 * Every CFG key below is overridable from the CLI, which is how the numbers
 * were dialled in: node scripts/extract-splat-subject.mjs --yGround=0.86
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const SRC = "public/splats/herb-scan-clean.splat";
const DST = "public/splats/herb-isolated.splat";
const VERSION_MODULE = "src/app/isolate/splatVersion.js";

// --- tuning -----------------------------------------------------------------
const CFG = {
  // subject footprint in capture space (XZ), metres-ish
  centerX: -0.02,
  centerZ: -0.07,
  radius: 0.42,
  // capture +Y is down: yTop = head, yGround = where the model stops. Set at
  // the ankle rather than the sole — see fadeBand.
  yTop: -1.05,
  yGround: 0.84,
  // he is standing behind a low hedge, not on grass — the foliage sits in
  // front of his shins at capture-y 0.69-0.84, i.e. ABOVE the soles. A plane
  // cut high enough to miss it eats his feet, so the hedge goes by colour
  // instead: below vegY, reject anything whose green channel leads.
  vegY: 0.55,
  vegDelta: 2,
  // Below pavY the subject is just two feet, so the ROI stops being one wide
  // cylinder and becomes a narrow one around each leg. This is what separates
  // him from the pavement: his socks sit under his legs, the slab is
  // everywhere. Doing it spatially matters — an earlier tonal version keyed on
  // brightness and deleted his white socks, which look exactly like slab.
  pavY: 0.86,
  legRadius: 0.15,
  // leg axes are found by k-means over this band of trouser, then tracked
  // downwards slice by slice — his legs angle outward and the feet sit
  // forward of the shins, so a cylinder pinned to the trouser axis slides off
  // one foot and clips it.
  legBandTop: 0.58,
  legBandBottom: 0.70,
  trackSlice: 0.02,
  trackDamping: 0.55,
  // a foot may travel this far from its trouser axis, and the two centres may
  // never come closer than legMinGap — without both, the pair collapses onto
  // whichever blob is densest and one foot gets clipped.
  legMaxDrift: 0.13,
  legMinGap: 0.16,
  // Everything below smearY was poorly seen — the hedge starts here, so the
  // solver had few views and painted the gaps with big soft blobs. Those are
  // the streaks that trail off the trouser legs. The whole occluded band gets
  // a tighter size limit than the body, not just the strip near the ground.
  smearY: 0.70,
  footMaxScale: 0.03,
  // the ROI tapers to the feet between vegY and yGround — the body needs the
  // full radius at shoulder height, the shoes need far less, and the extra
  // room is where the ground creeps in.
  footRadius: 0.34,
  // reject gaussians bigger than this (background smears)
  maxScale: 0.09,
  // reject near-invisible gaussians
  minAlpha: 26,
  // connected components
  voxel: 0.035,
  // statistical outlier removal — a splat needs at least minNeighbours others
  // inside its own voxel and the 26 around it, or it is loose debris.
  minNeighbours: 32,
  // A second, finer pass over the foot zone only. The voxel trim above works
  // on a 10cm block, which is coarse enough that a crumb sitting beside a shoe
  // still passes; this one asks for real neighbours within isolationRadius.
  // Tuned against the socks: 3.1cm/3 drops 27 orphans for the cost of one sock
  // splat. Tightening either value eats the socks fast — they are genuinely
  // sparser than the leg above them, so this is the ceiling, not a safe knob.
  isolationRadius: 0.031,
  isolationMin: 3,
  // A final connectivity pass at a finer grain than the first one. The 3.5cm
  // grid used above bridges gaps wide enough to keep detached crumbs welded to
  // the body. This drops anything not actually joined to him — including the
  // lowest scraps of sock, which turn out to be a genuine floating island
  // rather than attached geometry, and were the blobs hanging under his feet.
  finalVoxel: 0.024,
  // The capture below the ankle is too poor to use — the hedge blocked it, so
  // the feet come out as smears and floating scraps. Rather than end on a
  // short fade that still reads as damage, the dissolve runs from roughly the
  // knee down, which is long enough to look like a decision. Everything below
  // still runs, so raising yGround back toward 1.00 and dropping fadeBand
  // brings the feet and socks back if a future scan earns it.
  fadeBand: 0.60,
  // Shape of the fade. 1 is a straight linear ramp; above 1 drops away sooner
  // and lands softer, which is what makes a long fade actually look long.
  fadeCurve: 1.7,
  // normalise so the subject is exactly this tall in world units
  targetHeight: 2.0,
};

for (const a of process.argv.slice(2)) {
  const m = /^--([a-zA-Z]+)=(-?[\d.]+)$/.exec(a);
  if (m && m[1] in CFG) CFG[m[1]] = parseFloat(m[2]);
}

const buf = fs.readFileSync(SRC);
const count = buf.length / 32;
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);

// --- 0. locate the two leg axes --------------------------------------------
// k-means (k=2) over a band of trouser, so the foot cylinders below follow
// wherever he actually planted his feet rather than a hardcoded guess.
const legSample = [];
for (let i = 0; i < count; i++) {
  const y = f32[i * 8 + 1];
  if (y < CFG.legBandTop || y > CFG.legBandBottom) continue;
  if (Math.hypot(f32[i * 8] - CFG.centerX, f32[i * 8 + 2] - CFG.centerZ) > 0.30) continue;
  if (u8[i * 32 + 27] < CFG.minAlpha) continue;
  if (Math.max(f32[i * 8 + 3], f32[i * 8 + 4], f32[i * 8 + 5]) > 0.04) continue;
  legSample.push([f32[i * 8], f32[i * 8 + 2]]);
}
let legs = [
  [CFG.centerX - 0.1, CFG.centerZ],
  [CFG.centerX + 0.1, CFG.centerZ],
];
for (let iter = 0; iter < 40; iter++) {
  const acc = [[0, 0, 0], [0, 0, 0]];
  for (const p of legSample) {
    const k = Math.hypot(p[0] - legs[0][0], p[1] - legs[0][1]) <
              Math.hypot(p[0] - legs[1][0], p[1] - legs[1][1]) ? 0 : 1;
    acc[k][0] += p[0]; acc[k][1] += p[1]; acc[k][2]++;
  }
  for (let k = 0; k < 2; k++) if (acc[k][2]) legs[k] = [acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]];
}
log(`leg axes: (${legs[0][0].toFixed(3)}, ${legs[0][1].toFixed(3)}) (${legs[1][0].toFixed(3)}, ${legs[1][1].toFixed(3)}) from ${legSample.length} samples`);

// --- 0b. track each leg down to the sole ------------------------------------
// Bucket the plausible body splats by height slice, then walk each leg's
// centre downwards, re-centring on the local centroid as it goes.
const sliceOf = (y) => Math.floor(y / CFG.trackSlice);
const slices = new Map();
for (let i = 0; i < count; i++) {
  const y = f32[i * 8 + 1];
  if (y < CFG.legBandBottom || y > CFG.yGround) continue;
  if (u8[i * 32 + 27] < CFG.minAlpha) continue;
  if (Math.max(f32[i * 8 + 3], f32[i * 8 + 4], f32[i * 8 + 5]) > CFG.footMaxScale) continue;
  const r = u8[i * 32 + 24], g = u8[i * 32 + 25], b = u8[i * 32 + 26];
  if (g - Math.max(r, b) > CFG.vegDelta) continue; // foliage must not pull the centre
  const k = sliceOf(y);
  let bucket = slices.get(k);
  if (!bucket) slices.set(k, (bucket = []));
  bucket.push(i);
}

const track = new Map();
let cur = legs.map((l) => [l[0], l[1]]);
for (let y = CFG.legBandBottom; y < CFG.yGround; y += CFG.trackSlice) {
  const k = sliceOf(y);
  const bucket = slices.get(k) || [];
  const next = cur.map((c) => [c[0], c[1]]);
  // assign each splat to its NEAREST leg rather than letting both legs claim
  // the same points, which is how the two centres used to merge
  const acc = [[0, 0, 0], [0, 0, 0]];
  for (const i of bucket) {
    const x = f32[i * 8], z = f32[i * 8 + 2];
    const d0 = Math.hypot(x - cur[0][0], z - cur[0][1]);
    const d1 = Math.hypot(x - cur[1][0], z - cur[1][1]);
    const leg = d0 < d1 ? 0 : 1;
    if (Math.min(d0, d1) > CFG.legRadius * 1.35) continue;
    acc[leg][0] += x; acc[leg][1] += z; acc[leg][2]++;
  }
  for (let leg = 0; leg < 2; leg++) {
    if (acc[leg][2] < 4) continue;
    let nx = cur[leg][0] + (acc[leg][0] / acc[leg][2] - cur[leg][0]) * CFG.trackDamping;
    let nz = cur[leg][1] + (acc[leg][1] / acc[leg][2] - cur[leg][1]) * CFG.trackDamping;
    // clamp to a leash around the original trouser axis
    const dx = nx - legs[leg][0], dz = nz - legs[leg][1];
    const d = Math.hypot(dx, dz);
    if (d > CFG.legMaxDrift) {
      nx = legs[leg][0] + (dx / d) * CFG.legMaxDrift;
      nz = legs[leg][1] + (dz / d) * CFG.legMaxDrift;
    }
    next[leg] = [nx, nz];
  }
  // push apart if they have drifted into each other
  const gx = next[1][0] - next[0][0], gz = next[1][1] - next[0][1];
  const gap = Math.hypot(gx, gz) || 1e-6;
  if (gap < CFG.legMinGap) {
    const push = (CFG.legMinGap - gap) / 2;
    const ux = gx / gap, uz = gz / gap;
    next[0] = [next[0][0] - ux * push, next[0][1] - uz * push];
    next[1] = [next[1][0] + ux * push, next[1][1] + uz * push];
  }
  track.set(k, next);
  cur = next;
}
const lastTrack = cur;
const centresAt = (y) => track.get(sliceOf(y)) || lastTrack;
log(`tracked soles: (${cur[0][0].toFixed(3)}, ${cur[0][1].toFixed(3)}) (${cur[1][0].toFixed(3)}, ${cur[1][1].toFixed(3)})`);

// --- 1–3. ROI + ground + size/alpha rejects ---------------------------------
const kept = [];
for (let i = 0; i < count; i++) {
  const x = f32[i * 8 + 0];
  const y = f32[i * 8 + 1];
  const z = f32[i * 8 + 2];
  if (y < CFG.yTop || y > CFG.yGround) continue;
  const dx = x - CFG.centerX;
  const dz = z - CFG.centerZ;
  if (y > CFG.pavY) {
    // foot zone: must sit under one of the two tracked legs
    const c = centresAt(y);
    const near = c.some((L) => Math.hypot(x - L[0], z - L[1]) <= CFG.legRadius);
    if (!near) continue;
  } else {
    const taper = Math.min(1, Math.max(0, (y - CFG.vegY) / (CFG.pavY - CFG.vegY)));
    const rAtY = CFG.radius + (CFG.footRadius - CFG.radius) * taper;
    if (dx * dx + dz * dz > rAtY * rAtY) continue;
  }
  const s = Math.max(f32[i * 8 + 3], f32[i * 8 + 4], f32[i * 8 + 5]);
  if (s > (y > CFG.smearY ? CFG.footMaxScale : CFG.maxScale)) continue;
  if (u8[i * 32 + 27] < CFG.minAlpha) continue;
  const r = u8[i * 32 + 24], g = u8[i * 32 + 25], b = u8[i * 32 + 26];
  if (y > CFG.vegY && g - Math.max(r, b) > CFG.vegDelta) continue;
  kept.push(i);
}
log(`ROI + filters: ${kept.length} / ${count}`);

// --- 4. voxel connected components ------------------------------------------
const v = CFG.voxel;
const key = (a, b, c) => `${a},${b},${c}`;
const cells = new Map();
for (const i of kept) {
  const a = Math.floor(f32[i * 8 + 0] / v);
  const b = Math.floor(f32[i * 8 + 1] / v);
  const c = Math.floor(f32[i * 8 + 2] / v);
  const k = key(a, b, c);
  let bucket = cells.get(k);
  if (!bucket) cells.set(k, (bucket = []));
  bucket.push(i);
}

const seen = new Set();
let best = null;
for (const start of cells.keys()) {
  if (seen.has(start)) continue;
  const stack = [start];
  const comp = [];
  seen.add(start);
  while (stack.length) {
    const k = stack.pop();
    comp.push(k);
    const [a, b, c] = k.split(",").map(Number);
    for (let da = -1; da <= 1; da++)
      for (let db = -1; db <= 1; db++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!da && !db && !dc) continue;
          const nk = key(a + da, b + db, c + dc);
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
  }
  const size = comp.reduce((n, k) => n + cells.get(k).length, 0);
  if (!best || size > best.size) best = { comp, size };
}
const component = best.comp.flatMap((k) => cells.get(k));
log(`largest component: ${component.length} splats (${cells.size} voxels total)`);

// --- 4b. density trim -------------------------------------------------------
// Connected components keeps anything that touches the body, which still lets
// a crumb of pavement in via a single bridging voxel. Density is what actually
// separates him from the ground: he is solid, the leftovers are sparse.
// Only the foot zone gets trimmed — run this over the whole body and it starts
// eating holes in the jacket, which is thin at the back.
const trimFrom = CFG.pavY / CFG.voxel;
const keepCell = new Map();
for (const k of best.comp) {
  const [a, b, c] = k.split(",").map(Number);
  if (b < trimFrom) { keepCell.set(k, true); continue; }
  let n = 0;
  for (let da = -1; da <= 1; da++)
    for (let db = -1; db <= 1; db++)
      for (let dc = -1; dc <= 1; dc++) {
        const nb = cells.get(key(a + da, b + db, c + dc));
        if (nb) n += nb.length;
      }
  keepCell.set(k, n >= CFG.minNeighbours);
}
const dense = best.comp.filter((k) => keepCell.get(k)).flatMap((k) => cells.get(k));
log(`density trim: ${dense.length} splats (dropped ${component.length - dense.length})`);

// --- 4c. isolation trim over the foot zone ----------------------------------
const iso = CFG.isolationRadius;
const isoGrid = new Map();
for (const i of dense) {
  const k = key(
    Math.floor(f32[i * 8] / iso),
    Math.floor(f32[i * 8 + 1] / iso),
    Math.floor(f32[i * 8 + 2] / iso)
  );
  let bucket = isoGrid.get(k);
  if (!bucket) isoGrid.set(k, (bucket = []));
  bucket.push(i);
}
const neighbours = (i) => {
  const x = f32[i * 8], y = f32[i * 8 + 1], z = f32[i * 8 + 2];
  const a = Math.floor(x / iso), b = Math.floor(y / iso), c = Math.floor(z / iso);
  let n = 0;
  for (let da = -1; da <= 1; da++)
    for (let db = -1; db <= 1; db++)
      for (let dc = -1; dc <= 1; dc++) {
        const bucket = isoGrid.get(key(a + da, b + db, c + dc));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          const dx = f32[j * 8] - x, dy = f32[j * 8 + 1] - y, dz = f32[j * 8 + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= iso * iso) n++;
        }
      }
  return n;
};
const subject = dense.filter(
  (i) => f32[i * 8 + 1] <= CFG.pavY || neighbours(i) >= CFG.isolationMin
);
log(`isolation trim: ${subject.length} splats (dropped ${dense.length - subject.length})`);

// --- 4d. final connectivity pass --------------------------------------------
function largestComponent(indices, voxel) {
  const grid = new Map();
  for (const i of indices) {
    const k = key(
      Math.floor(f32[i * 8] / voxel),
      Math.floor(f32[i * 8 + 1] / voxel),
      Math.floor(f32[i * 8 + 2] / voxel)
    );
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(i);
  }
  const visited = new Set();
  let winner = null;
  for (const start of grid.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const comp = [];
    visited.add(start);
    while (stack.length) {
      const k = stack.pop();
      comp.push(k);
      const [a, b, c] = k.split(",").map(Number);
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++)
          for (let dc = -1; dc <= 1; dc++) {
            if (!da && !db && !dc) continue;
            const nk = key(a + da, b + db, c + dc);
            if (grid.has(nk) && !visited.has(nk)) {
              visited.add(nk);
              stack.push(nk);
            }
          }
    }
    const size = comp.reduce((n, k) => n + grid.get(k).length, 0);
    if (!winner || size > winner.size) winner = { comp, size };
  }
  return winner ? winner.comp.flatMap((k) => grid.get(k)) : [];
}

const welded = largestComponent(subject, CFG.finalVoxel);
log(`final connectivity: ${welded.length} splats (dropped ${subject.length - welded.length})`);
subject.length = 0;
subject.push(...welded);

// --- 5. recentre + normalise -------------------------------------------------
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const i of subject) {
  x0 = Math.min(x0, f32[i * 8]); x1 = Math.max(x1, f32[i * 8]);
  y0 = Math.min(y0, f32[i * 8 + 1]); y1 = Math.max(y1, f32[i * 8 + 1]);
  z0 = Math.min(z0, f32[i * 8 + 2]); z1 = Math.max(z1, f32[i * 8 + 2]);
}
const height = y1 - y0;
const scale = CFG.targetHeight > 0 ? CFG.targetHeight / height : 1;
const cx = (x0 + x1) / 2;
const cy = (y0 + y1) / 2;
const cz = (z0 + z1) / 2;
log(`bounds x[${x0.toFixed(2)} ${x1.toFixed(2)}] y[${y0.toFixed(2)} ${y1.toFixed(2)}] z[${z0.toFixed(2)} ${z1.toFixed(2)}] h=${height.toFixed(3)} scale=${scale.toFixed(3)}`);

// Fade shape. Smootherstep holds full alpha for the first third of the band,
// which bunches the whole dissolve into the last few centimetres and makes a
// long fade look no longer than a short one. This curve starts falling almost
// immediately and eases out at the bottom, so the gradient actually reads
// across the distance it covers.
const fadeAlpha = (t) => {
  const k = Math.min(1, Math.max(0, t));
  return Math.pow(1 - k, CFG.fadeCurve);
};

const out = Buffer.alloc(subject.length * 32);
const of32 = new Float32Array(out.buffer, out.byteOffset, out.length / 4);
const ou8 = new Uint8Array(out.buffer, out.byteOffset, out.length);
const fadeFrom = y1 - CFG.fadeBand;
subject.forEach((i, n) => {
  buf.copy(out, n * 32, i * 32, i * 32 + 32);
  if (CFG.fadeBand > 0) {
    const y = f32[i * 8 + 1];
    if (y > fadeFrom) {
      const t = Math.min(1, (y - fadeFrom) / CFG.fadeBand);
      ou8[n * 32 + 27] = Math.round(u8[i * 32 + 27] * fadeAlpha(t));
    }
  }
  of32[n * 8 + 0] = (f32[i * 8 + 0] - cx) * scale;
  of32[n * 8 + 1] = (f32[i * 8 + 1] - cy) * scale;
  of32[n * 8 + 2] = (f32[i * 8 + 2] - cz) * scale;
  of32[n * 8 + 3] = f32[i * 8 + 3] * scale;
  of32[n * 8 + 4] = f32[i * 8 + 4] * scale;
  of32[n * 8 + 5] = f32[i * 8 + 5] * scale;
});

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, out);
log(`wrote ${DST} — ${subject.length} splats, ${(out.length / 1024).toFixed(0)} KB`);

// /splats/* is served `immutable` for a year (see next.config.mjs), which is
// right for production but means a regenerated file is invisible to any
// browser that already has one — it will not even revalidate. Stamping the
// content hash into the URL is what makes a new build actually load.
const hash = crypto.createHash("sha1").update(out).digest("hex").slice(0, 10);
fs.writeFileSync(
  VERSION_MODULE,
  `// Generated by scripts/extract-splat-subject.mjs — do not edit by hand.\n` +
    `export const SPLAT_VERSION = "${hash}";\n`
);
log(`wrote ${VERSION_MODULE} — version ${hash}`);

function log(...a) { console.log("[extract]", ...a); }
