// The pole sprites' key layout, shared by the engine and the bake
// (tools/depth/bakes/train-window/poles_render.mjs, poles.py).
//
// The camera sits 1.7 m up, looking square out at a pole line 3.4 m off,
// right beside the ballast. A pole at image-plane x = px (its along-track
// offset / D) is seen from atan(px) to the side, so its crossarm, which runs
// in depth and reaches to within 2.3 m of the lens, swings from a long spike
// rushing up out of the top of the print (px = 0) to a long diagonal near the
// edges. Each key is the model rendered from the camera's real viewpoint for
// one px, in the level pinhole's image plane, relative to the pole's foot; the
// engine draws a pole from the two keys either side of its px. The view
// changes with the angle atan(px), so the keys are spaced evenly in it: every
// 4° for the head, where the hardware is, every 12° for the bare trunk.
// Rows are uniform in atan(y), the way the lens spends its pixels; a cell
// spans exactly the plane interval its region's box (the hardware's extent:
// along track a, in depth z, metres) can project to, and its columns get
// sparser toward the edges, where the lens squeezes the plane (texels per
// unit = dens / (1 + sq px^2)).

export const POLE_GEOM = { D: 3.4, camH: 1.7, scale: 1.88 };

// y0 / y1: the region's plane rows (head: 6.3 m up to the near end of the
// upper arm, 11 m up and 2.3 m from the lens; trunk: from under the bottom
// of the print to 6.6 m). n keys from -tMax to +tMax (degrees off square).
export const POLE_REGIONS = {
  head: { y0: 1.36, y1: 4.2, rowsPerDeg: 16, tMax: 72, n: 37, a0: -0.3, a1: 0.86, z0: -1.17, z1: 1.17, dens: 340, sq: 0.18 },
  trunk: { y0: -0.1, y1: 1.44, rowsPerDeg: 12, tMax: 72, n: 13, a0: -0.29, a1: 0.29, z0: -0.29, z1: 0.29, dens: 820, sq: 0.55 },
};

const GAP = 4; // clear texels between cells
const MAX_W = 4096;

// Plane interval [l, r] (relative to the pole's foot) that the region's box
// can project to for a pole at px: lx = (a - px z) / (D + z), extreme at the
// box's corners, plus a margin.
export function poleSpan(R, px) {
  const D = POLE_GEOM.D;
  let l = Infinity;
  let r = -Infinity;
  for (const a of [R.a0, R.a1])
    for (const z of [R.z0, R.z1]) {
      const lx = (a - px * z) / (D + z);
      l = Math.min(l, lx);
      r = Math.max(r, lx);
    }
  return [l - 0.03, r + 0.03];
}

// Key i's px.
export const poleKey = (R, i) => Math.tan(((-R.tMax + (2 * R.tMax * i) / (R.n - 1)) * Math.PI) / 180);

// Cells of one region: { px, l, r (plane offsets of the cell's edges), w
// (texels), x, y (top-left in the atlas) }, plus the atlas size and the row
// count.
export function poleCells(R) {
  const elTop = Math.atan(R.y1);
  const elBot = Math.atan(R.y0);
  const rows = Math.round(((elTop - elBot) * 180) / Math.PI * R.rowsPerDeg);
  const cells = [];
  let x = GAP;
  let y = 0;
  let width = 0;
  for (let i = 0; i < R.n; i++) {
    const px = +poleKey(R, i).toFixed(5);
    const [l, r] = poleSpan(R, px);
    const w = Math.round(((r - l) * R.dens) / (1 + R.sq * px * px));
    if (x + w + GAP > MAX_W) {
      x = GAP;
      y += rows;
    }
    cells.push({ px, l, r, w, x, y });
    x += w + GAP;
    width = Math.max(width, x);
  }
  return { cells, rows, width, height: y + rows, elTop, elBot };
}
