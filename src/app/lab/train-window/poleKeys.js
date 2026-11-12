// The pole sprites' key layout, shared by the engine and the bake
// (tools/depth/bakes/train-window/poles_render.mjs, poles.py).
//
// The camera sits 1.7 m up, looking square out at a pole line 8 m off. A pole
// at image-plane x = px (its along-track offset / 8) is seen from atan(px) to
// the side, so its crossarm, which runs in depth, swings from a stub over the
// trunk (px = 0) to a long diagonal near the edges. Each key is the model
// rendered from the camera's real viewpoint for one px, in the level pinhole's
// image plane, relative to the pole's foot; the engine draws a pole from the
// two keys either side of its px. The hardware lives up in the head, where
// the view changes fastest, so the head is keyed every 0.2 (1.6 m of track);
// the bare trunk below it every 0.6. Rows are uniform in atan(y), the way the
// lens spends its pixels; columns get sparser toward the edges, where the lens
// squeezes the plane (texels per unit = dens / (1 + 0.3 px^2)).

export const POLE_GEOM = { D: 8, camH: 1.7, scale: 1.88 };

export const POLE_REGIONS = {
  head: { y0: 0.55, y1: 1.4, rowsPerDeg: 14, k0: -2.4, dk: 0.2, n: 25, w0: 0.13, wk: 0.17, dens: 620 },
  trunk: { y0: -0.25, y1: 0.6, rowsPerDeg: 12, k0: -2.4, dk: 0.6, n: 9, w0: 0.045, wk: 0.04, dens: 1000 },
};

const GAP = 4; // clear texels between cells
const MAX_W = 4096;

// Cells of one region: { px, hw (half width, plane units), w (texels), x, y
// (top-left in the atlas) }, plus the atlas size and the row count.
export function poleCells(R) {
  const elTop = Math.atan(R.y1);
  const elBot = Math.atan(R.y0);
  const rows = Math.round(((elTop - elBot) * 180) / Math.PI * R.rowsPerDeg);
  const cells = [];
  let x = GAP;
  let y = 0;
  let width = 0;
  for (let i = 0; i < R.n; i++) {
    const px = +(R.k0 + i * R.dk).toFixed(4);
    const hw = R.w0 + R.wk * Math.abs(px);
    const w = Math.round((2 * hw * R.dens) / (1 + 0.3 * px * px));
    if (x + w + GAP > MAX_W) {
      x = GAP;
      y += rows;
    }
    cells.push({ px, hw, w, x, y });
    x += w + GAP;
    width = Math.max(width, x);
  }
  return { cells, rows, width, height: y + rows, elTop, elBot };
}
