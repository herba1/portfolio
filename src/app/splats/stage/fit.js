// Robust framing for a splat. A capture's bounding box is set by its worst
// floaters — a handful of stray Gaussians metres away — so fitting the raw box
// shrinks the subject to a speck. Instead take percentiles of the splat
// centres per axis: the 1st–99th percentile box is the subject.

const SAMPLE_LIMIT = 60000;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Returns { center: [x, y, z], radius, box } in the mesh's local space. Cheap:
 * it strides through at most SAMPLE_LIMIT splats and skips near-transparent
 * ones. `keep(center)` drops splats from the measurement (a crop).
 */
export function robustBounds(mesh, { low = 0.01, high = 0.99, minOpacity = 0.2, keep } = {}) {
  const total = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
  const stride = Math.max(1, Math.floor(total / SAMPLE_LIMIT));
  const xs = [];
  const ys = [];
  const zs = [];
  let i = 0;
  mesh.forEachSplat((_, center, _scales, _quat, opacity) => {
    if (i++ % stride !== 0 || opacity < minOpacity) return;
    if (keep && !keep(center)) return;
    xs.push(center.x);
    ys.push(center.y);
    zs.push(center.z);
  });
  if (!xs.length) return { center: [0, 0, 0], radius: 1, box: [[-1, 1], [-1, 1], [-1, 1]] };
  for (const list of [xs, ys, zs]) list.sort((a, b) => a - b);
  const box = [xs, ys, zs].map((list) => [percentile(list, low), percentile(list, high)]);
  const center = box.map(([lo, hi]) => (lo + hi) / 2);
  const radius = Math.max(...box.map(([lo, hi]) => (hi - lo) / 2)) || 1;
  return { center, radius, box };
}

const AXES = ["x", "y", "z"];

/**
 * The capture's "up" in its own local space, given the orientation fix-up
 * applied to it: { axis: 0|1|2, sign: ±1 }. Most captures are y-down, so with
 * the usual [π, 0, 0] fix-up this is { axis: 1, sign: -1 }.
 */
export function localUp(THREE, rotation) {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)).invert(),
  );
  const parts = [up.x, up.y, up.z];
  const axis = parts.reduce((best, v, i) => (Math.abs(v) > Math.abs(parts[best]) ? i : best), 0);
  return { axis, sign: Math.sign(parts[axis]) || 1, name: AXES[axis] };
}
