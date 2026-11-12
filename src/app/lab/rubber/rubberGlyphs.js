// Glyph shapes as signed distance fields, in em, positive inside the ink.
// Rasterised from the real font on a 2D canvas, then turned into exact
// distances with the Felzenszwalb transform (sub-pixel seeded from coverage,
// as in Mapbox's tiny-sdf).

export const GLYPH_PX = 256;
const PAD = 0.12; // em of field kept around the ink
const INF = 1e20;
// The raster is drawn and transformed at this many times the atlas scale,
// then averaged down: coverage seeding is least exact where a curve runs
// tangent to the pixel grid, and at 1x that leaves a nick at every extreme
// of a bowl.
const SS = 3;

function edt1d(f, d, v, z, n) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  let k = 0;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function edt(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

// One character: its field plus where the ink sits, all in atlas pixels.
export function glyphField(ch, family, weight) {
  const S = GLYPH_PX;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `${weight} ${S}px ${family}`;
  const m = probe.measureText(ch);
  const left = Math.ceil(m.actualBoundingBoxLeft) + 1;
  const right = Math.ceil(m.actualBoundingBoxRight) + 1;
  const asc = Math.ceil(m.actualBoundingBoxAscent) + 1;
  const desc = Math.ceil(m.actualBoundingBoxDescent) + 1;
  const pad = Math.ceil(PAD * S);
  const w = left + right + pad * 2;
  const h = asc + desc + pad * 2;
  const W = w * SS, H = h * SS;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.font = `${weight} ${S * SS}px ${family}`;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  const ox = pad + left, oy = pad + asc;
  ctx.fillText(ch, ox * SS, oy * SS);
  const img = ctx.getImageData(0, 0, W, H).data;

  const outer = new Float64Array(W * H), inner = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = img[i * 4 + 3] / 255;
    if (a >= 1) { outer[i] = 0; inner[i] = INF; }
    else if (a <= 0) { outer[i] = INF; inner[i] = 0; }
    else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, W, H);
  edt(inner, W, H);
  // Down to atlas scale, each texel the mean of its SS x SS block.
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let j = 0; j < SS; j++)
        for (let k = 0; k < SS; k++) {
          const i = (y * SS + j) * W + x * SS + k;
          acc += Math.sqrt(inner[i]) - Math.sqrt(outer[i]);
        }
      field[y * w + x] = acc / (SS * SS * S * SS);
    }
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (field[y * w + x] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  // A raster EDT is faintly stepped; shading takes its slope, so smooth it.
  const tmp = new Float32Array(w * h);
  const K = [1, 4, 6, 4, 1].map((v) => v / 16);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -2; k <= 2; k++) acc += field[y * w + Math.min(w - 1, Math.max(0, x + k))] * K[k + 2];
        tmp[y * w + x] = acc;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -2; k <= 2; k++) acc += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x] * K[k + 2];
        field[y * w + x] = acc;
      }
  }
  return {
    field, w, h,
    // Ink box in atlas px, and the pen origin (advance in px too).
    ink: { x0, x1: x1 + 1, y0, y1: y1 + 1 },
    origin: { x: ox, y: oy },
    advance: m.width,
  };
}

export const sampleField = (g, x, y) => {
  const xi = Math.max(0, Math.min(g.w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(g.h - 1, Math.round(y)));
  return g.field[yi * g.w + xi];
};
