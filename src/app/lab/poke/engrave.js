// The engraving's lines, laid out on the CPU.
//
// The crown is drawn as a line halftone, the way an engraver cuts a tree: long
// strokes that run along the contours of the leaves' light, so they bunch,
// curve and swell with the shading instead of sitting on a lattice.
//
// 1. orientation(): the contour direction of the tree's luminance at every
//    spot of the plate (half resolution), from the smoothed structure tensor
//    of its gradient. Where the light has no direction of its own (flat
//    shadow, open sky inside the matte) a faint bias tensor lets the lines
//    fall back to one diagonal hatch, so the engraving reads as one hand.
// 2. strokes(): evenly spaced streamlines of that field (Jobard and Lefer,
//    "Creating Evenly-Spaced Streamlines of Arbitrary Density", 1997), seeded
//    in a shuffled jittered order and then outward from each finished line at
//    the separation distance, so the hatch is blue-noise even with no grid in
//    it. Each streamline is cut into strokes of varied length, each resampled
//    to P spine points in plate px; a stroke that lies wholly in deep shadow
//    is dropped (its width would be zero).

export const P = 12; // spine points per stroke

const HATCH = (-28 * Math.PI) / 180; // fallback hatch angle (screen, y down)

function boxBlur(src, W, H, r, tmp, out) {
  // separable running-sum box blur, radius r (clamped edges)
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[o + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / n;
      s += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

// three box passes approximate a gaussian of sigma ~ r * 1.0
function gauss(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  let a = new Float32Array(src);
  const b = new Float32Array(W * H);
  for (let i = 0; i < 3; i++) {
    boxBlur(a, W, H, r, tmp, b);
    a.set(b);
  }
  return a;
}

export function orientation(bmp, PW, PH) {
  const W = PW >> 1;
  const H = PH >> 1;
  let cv;
  if (typeof OffscreenCanvas !== "undefined") cv = new OffscreenCanvas(W, H);
  else {
    cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
  }
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, W, H);
  const px = cx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3] / 255;
    alpha[i] = a;
    lum[i] = ((0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255) * a;
  }
  // the silhouette counts as an edge of the light too, so lines near the
  // rim run along it
  const L = gauss(lum, W, H, 1);
  const jxx = new Float32Array(W * H);
  const jxy = new Float32Array(W * H);
  const jyy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (L[i + 1] - L[i - 1]) * 0.5;
      const gy = (L[i + W] - L[i - W]) * 0.5;
      jxx[i] = gx * gx;
      jxy[i] = gx * gy;
      jyy[i] = gy * gy;
    }
  const R = 7; // half px: ~14 plate px of smoothing
  const sxx = gauss(jxx, W, H, R);
  const sxy = gauss(jxy, W, H, R);
  const syy = gauss(jyy, W, H, R);
  let mean = 0;
  for (let i = 0; i < W * H; i++) mean += sxx[i] + syy[i];
  mean /= W * H;
  // bias: a gradient normal to the fallback hatch
  const nx = -Math.sin(HATCH);
  const ny = Math.cos(HATCH);
  const eps = mean * 0.2;
  const c2 = new Float32Array(W * H);
  const s2 = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = sxx[i] + eps * nx * nx;
    const b = sxy[i] + eps * nx * ny;
    const d = syy[i] + eps * ny * ny;
    // major axis (the gradient) at angle g; the contour is g + 90 deg, so its
    // doubled angle is 2g + 180 deg
    const g2 = Math.atan2(2 * b, a - d);
    c2[i] = -Math.cos(g2);
    s2[i] = -Math.sin(g2);
  }
  return { W, H, PW, PH, lum, alpha, c2, s2 };
}

function sampler(F) {
  const { W, H, PW } = F;
  const k = W / PW;
  return (arr, x, y) => {
    const gx = Math.min(W - 1.001, Math.max(0, x * k - 0.5));
    const gy = Math.min(H - 1.001, Math.max(0, y * k - 0.5));
    const x0 = gx | 0;
    const y0 = gy | 0;
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * W + x0;
    return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + W] * (1 - fx) + arr[i + W + 1] * fx) * fy;
  };
}

// strokes at separation dsep (plate px), as a Float32Array of P points each
export function strokes(F, dsep, rand, { lumLo = 0.05, box = [0, 0, F.PW, F.PH] } = {}) {
  const { PW, PH } = F;
  const S = sampler(F);
  const dir = (x, y, px, py) => {
    const th = 0.5 * Math.atan2(S(F.s2, x, y), S(F.c2, x, y));
    let dx = Math.cos(th);
    let dy = Math.sin(th);
    if (dx * px + dy * py < 0) {
      dx = -dx;
      dy = -dy;
    }
    return [dx, dy];
  };
  const inTree = (x, y) => x >= box[0] && y >= box[1] && x < box[2] && y < box[3] && S(F.alpha, x, y) > 0.3;

  const h = Math.max(0.75, dsep * 0.25); // integration step
  const dtest = dsep * 0.55;
  const cs = dsep;
  const GX = Math.ceil(PW / cs) + 1;
  const GY = Math.ceil(PH / cs) + 1;
  const grid = new Array(GX * GY);
  const far = (x, y, d) => {
    const ci = Math.floor(x / cs);
    const cj = Math.floor(y / cs);
    const d2 = d * d;
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || j < 0 || i >= GX || j >= GY) continue;
        const c = grid[j * GX + i];
        if (!c) continue;
        for (let n = 0; n < c.length; n += 2) if ((c[n] - x) ** 2 + (c[n + 1] - y) ** 2 < d2) return false;
      }
    return true;
  };
  const add = (x, y) => {
    const k = Math.floor(y / cs) * GX + Math.floor(x / cs);
    (grid[k] || (grid[k] = [])).push(x, y);
  };
  const maxSteps = Math.ceil((dsep * 60) / h);

  const half = (x0, y0, sx, sy) => {
    const out = [];
    let x = x0;
    let y = y0;
    let [px, py] = [sx, sy];
    for (let s = 0; s < maxSteps; s++) {
      const [ax, ay] = dir(x, y, px, py);
      const [bx, by] = dir(x + ax * h * 0.5, y + ay * h * 0.5, ax, ay);
      // a sharp turn means the field has no clear direction here: stop
      if (bx * px + by * py < 0.8) break;
      const nx2 = x + bx * h;
      const ny2 = y + by * h;
      if (!inTree(nx2, ny2) || !far(nx2, ny2, dtest)) break;
      x = nx2;
      y = ny2;
      px = bx;
      py = by;
      out.push(x, y);
    }
    return out;
  };

  const lines = [];
  const queue = [];
  const trace = (x, y) => {
    if (!inTree(x, y) || !far(x, y, dsep)) return;
    const [dx, dy] = dir(x, y, 1, 0);
    const f = half(x, y, dx, dy);
    const b = half(x, y, -dx, -dy);
    const pts = [];
    for (let i = b.length - 2; i >= 0; i -= 2) pts.push(b[i], b[i + 1]);
    pts.push(x, y);
    for (let i = 0; i < f.length; i++) pts.push(f[i]);
    const n = pts.length / 2;
    if (n * h < dsep * 1.2) return;
    for (let i = 0; i < n; i++) add(pts[i * 2], pts[i * 2 + 1]);
    lines.push(pts);
    // seeds for the neighbours, one separation off either side
    const every = Math.max(1, Math.round(dsep / h));
    for (let i = 0; i < n; i += every) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let tx = pts[i1 * 2] - pts[i0 * 2];
      let ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      queue.push(pts[i * 2] - ty * dsep, pts[i * 2 + 1] + tx * dsep);
      queue.push(pts[i * 2] + ty * dsep, pts[i * 2 + 1] - tx * dsep);
    }
  };

  // random starts: a shuffled jittered grid
  const starts = [];
  const g = dsep * 3;
  for (let y = box[1] + g / 2; y < box[3]; y += g)
    for (let x = box[0] + g / 2; x < box[2]; x += g) starts.push(x + (rand() - 0.5) * g, y + (rand() - 0.5) * g);
  for (let i = starts.length / 2 - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [starts[i * 2], starts[j * 2]] = [starts[j * 2], starts[i * 2]];
    [starts[i * 2 + 1], starts[j * 2 + 1]] = [starts[j * 2 + 1], starts[i * 2 + 1]];
  }
  for (let s = 0; s < starts.length; s += 2) {
    trace(starts[s], starts[s + 1]);
    while (queue.length) {
      const y = queue.pop();
      const x = queue.pop();
      trace(x, y);
    }
  }

  // cut each line into strokes of varied length and resample them
  const out = [];
  for (const pts of lines) {
    const n = pts.length / 2;
    const arc = new Float32Array(n);
    for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const total = arc[n - 1];
    let a0 = -rand() * dsep * 2; // a staggered start, so cuts don't line up
    let k = 0;
    while (a0 < total) {
      let a1 = a0 + dsep * (4 + rand() * 5);
      if (total - a1 < dsep * 1.5) a1 = total;
      const s0 = Math.max(0, a0);
      if (a1 - s0 >= dsep * 1.2) {
        const stroke = new Float32Array(P * 2);
        let lmax = 0;
        for (let p = 0; p < P; p++) {
          const a = s0 + ((a1 - s0) * p) / (P - 1);
          while (k < n - 2 && arc[k + 1] < a) k++;
          const t = Math.min(1, Math.max(0, (a - arc[k]) / Math.max(1e-6, arc[k + 1] - arc[k])));
          const x = pts[k * 2] + (pts[k * 2 + 2] - pts[k * 2]) * t;
          const y = pts[k * 2 + 1] + (pts[k * 2 + 3] - pts[k * 2 + 1]) * t;
          stroke[p * 2] = x;
          stroke[p * 2 + 1] = y;
          lmax = Math.max(lmax, S(F.lum, x, y));
        }
        if (lmax > lumLo) out.push(stroke);
      }
      a0 = a1;
    }
  }
  const flat = new Float32Array(out.length * P * 2);
  out.forEach((s, i) => flat.set(s, i * P * 2));
  return { data: flat, count: out.length };
}
