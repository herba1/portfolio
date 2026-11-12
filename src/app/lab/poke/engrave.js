// The engraving's lines, laid out on the CPU.
//
// The whole print is one line engraving, the way an engraver cuts a tree in a
// ruled sky: long strokes that run along the contours of the light, so they
// bunch, curve and swell with the shading instead of sitting on a lattice.
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
//    it. A streamline may close to a little under half the separation before
//    it stops, so neighbours bunch into moire where the contours converge,
//    and one shorter than `shortest` is not laid at all. Each streamline is
//    cut into strokes of varied length (the crown's long, so its lines run
//    on through the leaves the way a burin's do), each resampled
//    to P spine points in plate px; a stroke that lies wholly in deep shadow
//    is dropped (its width would be zero) unless the renderer gives shadow a
//    hairline (lumLo below zero). A line on a speck of the matte is not laid.
// 3. skyField(): the same for the sky behind the crown, with a much broader
//    smoothing and a strong level bias, so its lines run nearly horizontally
//    and drift with the polariser falloff, and a density that closes the
//    lines up where a cloud brightens, so a cloud is lines swelling and
//    bunching rather than a soft patch.
// 4. tone(): the crown's light at the scale of its clumps, locally
//    equalised, which the renderer turns into line width, so the crown is a
//    line halftone whose coverage is its tone.
// Both are laid into one shared separation grid (createSpace), the crown
// first, so the sky's lines run up to the crown's and stop at the
// separation distance from them: the two meet the way two hatchings do on
// a plate, with no cut-out edge between them.

export const P = 40; // spine points per stroke (a crown line may run 36 separations)
export const META = 4; // per stroke: kind (0 crown, 1 sky, 2 sky under the crown), length, cap at start, cap at end

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

function pixels(bmp, W, H) {
  let cv;
  if (typeof OffscreenCanvas !== "undefined") cv = new OffscreenCanvas(W, H);
  else {
    cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
  }
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, W, H);
  return cx.getImageData(0, 0, W, H).data;
}

// the contour direction of L (doubled angle, as cos and sin) from its
// structure tensor smoothed over radius R (half px), leaning toward a
// gradient (nx, ny) by bias times the tensor's mean
function contour(L, W, H, R, nx, ny, bias) {
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
  const sxx = gauss(jxx, W, H, R);
  const sxy = gauss(jxy, W, H, R);
  const syy = gauss(jyy, W, H, R);
  let mean = 0;
  for (let i = 0; i < W * H; i++) mean += sxx[i] + syy[i];
  mean /= W * H;
  const eps = mean * bias;
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
  return { c2, s2 };
}

export function orientation(bmp, PW, PH, { R = 7 } = {}) {
  const W = PW >> 1;
  const H = PH >> 1;
  const px = pixels(bmp, W, H);
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3] / 255;
    alpha[i] = a;
    lum[i] = ((0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255) * a;
  }
  // the silhouette counts as an edge of the light too, so lines near the
  // rim run along it
  const { c2, s2 } = contour(gauss(lum, W, H, 1), W, H, R, -Math.sin(HATCH), Math.cos(HATCH), 0.2);
  // how deep inside the matte each spot is, to tell a speck from a twig
  const solid = gauss(alpha, W, H, 5);
  return { W, H, PW, PH, lum, alpha, solid, c2, s2 };
}

// The crown's tone, at the scale of its clumps rather than its leaves, laid
// out as a line halftone: the leaves' light blurred over a few line pitches
// (normalised by the matte, so the rim doesn't darken), so single-leaf glints
// fold into the lit masses they belong to; then equalised locally (CLAHE,
// contrast-limited adaptive histogram equalisation) over tiles of the
// matte's bounding box, bilinearly between tile centres, with a share of the
// whole crown's own equalisation mixed in so the big lit/shadow relations
// survive. The result (0..1, uniform over the matte) is what each crown line
// is as wide as, so the share of plate the lines cover is the tone.
export function tone(F, sep, { pitches = 4, tiles = [8, 5], bins = 128, clip = 3, whole = 0.3 } = {}) {
  const { W, H, PW, lum, alpha } = F;
  const r = Math.max(2, Math.round((pitches * sep * W) / PW));
  const a = gauss(alpha, W, H, r);
  const l = gauss(lum, W, H, r);
  const v = new Float32Array(W * H);
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      v[i] = a[i] > 1e-3 ? Math.min(1, l[i] / a[i]) : 0;
      if (alpha[i] > 0.3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  const out = new Float32Array(W * H);
  if (x1 < x0) return out;
  const [TX, TY] = tiles;
  const tw = (x1 - x0 + 1) / TX;
  const th = (y1 - y0 + 1) / TY;
  const hist = new Float32Array(TX * TY * bins);
  const glob = new Float32Array(bins);
  const bin = (t) => Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
  // a curve read between bin middles, so the tone has no steps in it
  const at = (c, t) => {
    const f = Math.min(bins - 1, Math.max(0, t * bins - 0.5));
    const b = Math.min(bins - 2, Math.floor(f));
    return c[b] + (c[b + 1] - c[b]) * (f - b);
  };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (alpha[i] <= 0.3) continue;
      const b = bin(v[i]);
      const t = Math.min(TY - 1, Math.floor((y - y0) / th)) * TX + Math.min(TX - 1, Math.floor((x - x0) / tw));
      hist[t * bins + b] += 1;
      glob[b] += 1;
    }
  // a histogram's clipped cumulative distribution, read at the middle of
  // each bin; what the clip takes off is spread back over the tones the tile
  // actually has (not over empty ones, which would keep its lightest leaves
  // from ever reaching the top of the light)
  const cdf = (h, off, lim) => {
    let n = 0;
    let lo = bins;
    let hi = -1;
    for (let b = 0; b < bins; b++) {
      n += h[off + b];
      if (h[off + b] > 0) {
        lo = Math.min(lo, b);
        hi = b;
      }
    }
    const c = new Float32Array(bins);
    if (n < 1) return { c, n };
    let ex = 0;
    const occupied = (h, b) => h[off + b] > 0 || (b > lo && b < hi);
    let span = 0;
    for (let b = 0; b < bins; b++) span += occupied(h, b) ? 1 : 0;
    const cap = (lim * n) / span;
    const hh = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      hh[b] = Math.min(h[off + b], cap);
      ex += h[off + b] - hh[b];
    }
    let cum = 0;
    for (let b = 0; b < bins; b++) {
      const k = hh[b] + (occupied(h, b) ? ex / span : 0);
      c[b] = (cum + k * 0.5) / n;
      cum += k;
    }
    // below and above the tile's tones the curve runs on to 0 and 1
    for (let b = 0; b < lo; b++) c[b] = (c[lo] * (b + 0.5)) / (lo + 0.5);
    for (let b = hi + 1; b < bins; b++) c[b] = c[hi] + ((1 - c[hi]) * (b - hi)) / (bins - hi);
    return { c, n };
  };
  const G = cdf(glob, 0, 1e9).c;
  // a tile with little matte in it leans on the whole crown's distribution
  const T = [];
  for (let t = 0; t < TX * TY; t++) {
    const { c, n } = cdf(hist, t * bins, clip);
    const w = Math.min(1, n / (0.25 * tw * th));
    for (let b = 0; b < bins; b++) c[b] = G[b] + (c[b] - G[b]) * w;
    T.push(c);
  }
  for (let y = y0; y <= y1; y++) {
    const fy = Math.min(TY - 1, Math.max(0, (y - y0) / th - 0.5));
    const ty0 = Math.min(TY - 2, Math.floor(fy));
    const ay = TY > 1 ? fy - Math.max(0, ty0) : 0;
    const r0 = Math.max(0, ty0);
    const r1 = Math.min(TY - 1, r0 + 1);
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (alpha[i] <= 0.02) continue;
      const fx = Math.min(TX - 1, Math.max(0, (x - x0) / tw - 0.5));
      const tx0 = Math.max(0, Math.min(TX - 2, Math.floor(fx)));
      const ax = TX > 1 ? fx - tx0 : 0;
      const c1 = Math.min(TX - 1, tx0 + 1);
      const t = v[i];
      const top = at(T[r0 * TX + tx0], t) * (1 - ax) + at(T[r0 * TX + c1], t) * ax;
      const bot = at(T[r1 * TX + tx0], t) * (1 - ax) + at(T[r1 * TX + c1], t) * ax;
      out[i] = (top * (1 - ay) + bot * ay) * (1 - whole) + at(G, t) * whole;
    }
  }
  return out;
}

// The sky: its light softened past the fill's leftover specks, its contours
// smoothed over a wide radius and leaned hard toward level, and a density
// (1 = the plate's line pitch) that closes up to CLOSE where a cloud lifts
// the light above the clear sky.
export function skyField(bmp, PW, PH, { cloud = [0.57, 0.72], close = 0.62 } = {}) {
  const W = PW >> 1;
  const H = PH >> 1;
  const px = pixels(bmp, W, H);
  const raw = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) raw[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  const lum = gauss(raw, W, H, 4);
  const { c2, s2 } = contour(lum, W, H, 16, 0, 1, 6);
  const dens = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const t = Math.min(1, Math.max(0, (lum[i] - cloud[0]) / (cloud[1] - cloud[0])));
    dens[i] = 1 - (1 - close) * t * t * (3 - 2 * t);
  }
  return { W, H, PW, PH, lum, dens, c2, s2 };
}

// the separation grid every line of the plate is laid into
export function createSpace(PW, PH, cs) {
  const GX = Math.ceil(PW / cs) + 1;
  const GY = Math.ceil(PH / cs) + 1;
  const grid = new Array(GX * GY);
  return {
    far(x, y, d) {
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
    },
    add(x, y) {
      const k = Math.floor(y / cs) * GX + Math.floor(x / cs);
      (grid[k] || (grid[k] = [])).push(x, y);
    },
  };
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

// Strokes at separation dsep (plate px), as a Float32Array of P points each
// and META floats each. space: the shared separation grid. sky: lay the
// sky's lines (anywhere not already engraved, closing up with F.dens) instead
// of the crown's (inside the matte). cut: the range of stroke lengths, in
// separations; a sky line is cut into long runs that join without a taper,
// so it reads as one ruled line.
export function strokes(
  F,
  dsep,
  rand,
  {
    space,
    sky = false,
    lumLo = 0.05,
    solidMin = 0,
    box = [0, 0, F.PW, F.PH],
    cut = [4, 9],
    reach = 60,
    shortest = 1.2,
    under = 0,
    dtest = 0.55,
  } = {},
) {
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
  const inBox = (x, y) => x >= box[0] && y >= box[1] && x < box[2] && y < box[3];
  const inside = sky ? inBox : (x, y) => inBox(x, y) && S(F.alpha, x, y) > 0.3;
  // local separation: the sky closes up where a cloud brightens
  const sepAt = sky ? (x, y) => dsep * S(F.dens, x, y) : () => dsep;

  const h = Math.max(0.75, dsep * 0.25); // integration step
  const { far, add } = space;
  const maxSteps = Math.ceil((dsep * reach) / h);

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
      if (!inside(nx2, ny2) || !far(nx2, ny2, sepAt(nx2, ny2) * dtest)) break;
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
    // a sky line may start a little nearer its neighbours than the pitch, so
    // where two fronts of level lines meet they close up instead of leaving
    // a seam of ground nearly two lines wide
    if (!inside(x, y) || !far(x, y, sepAt(x, y) * (sky ? 0.7 : 1))) return;
    const [dx, dy] = dir(x, y, 1, 0);
    const f = half(x, y, dx, dy);
    const b = half(x, y, -dx, -dy);
    const pts = [];
    for (let i = b.length - 2; i >= 0; i -= 2) pts.push(b[i], b[i + 1]);
    pts.push(x, y);
    for (let i = 0; i < f.length; i++) pts.push(f[i]);
    const n = pts.length / 2;
    if (n * h < dsep * shortest) return;
    if (solidMin > 0) {
      // a line on a speck of the matte out in the sky is not laid at all, so
      // the sky's ruling runs on over it
      let deep = 0;
      for (let i = 0; i < n; i++) deep += S(F.solid, pts[i * 2], pts[i * 2 + 1]);
      if (deep / n < solidMin) return;
    }
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
      const d = sepAt(pts[i * 2], pts[i * 2 + 1]);
      queue.push(pts[i * 2] - ty * d, pts[i * 2 + 1] + tx * d);
      queue.push(pts[i * 2] + ty * d, pts[i * 2 + 1] - tx * d);
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

  // Under the crown: each sky line that stopped against the crown runs on
  // beneath it, up to UNDER separations, kept apart from the sky's other
  // lines and from each other but not from the crown's. These are drawn only
  // where a pull swings the crown off the sky it covered at rest, so the
  // ruling carries on behind it instead of leaving a hole.
  const runs = lines.map((pts) => [pts, sky ? 1 : 0, 1, 1]);
  if (sky && under > 0) {
    const hid = createSpace(F.PW, F.PH, dsep);
    for (const pts of lines) for (let i = 0; i < pts.length; i += 2) hid.add(pts[i], pts[i + 1]);
    const dclear = dsep * 0.55;
    const steps = Math.ceil((dsep * under) / h);
    const extend = (x0, y0, px, py) => {
      const out = [x0, y0];
      let x = x0;
      let y = y0;
      for (let s = 0; s < steps; s++) {
        const [ax, ay] = dir(x, y, px, py);
        const [bx, by] = dir(x + ax * h * 0.5, y + ay * h * 0.5, ax, ay);
        if (bx * px + by * py < 0.8) break;
        const nx2 = x + bx * h;
        const ny2 = y + by * h;
        // its own line lies just behind it: test only once clear of that
        const clear = Math.hypot(nx2 - x0, ny2 - y0) > dclear * 1.05;
        if (!inBox(nx2, ny2) || (clear && !hid.far(nx2, ny2, sepAt(nx2, ny2) * 0.55))) break;
        x = nx2;
        y = ny2;
        px = bx;
        py = by;
        out.push(x, y);
      }
      return out;
    };
    lines.forEach((pts, li) => {
      const n = pts.length / 2;
      if (n < 2) return;
      for (const end of [0, 1]) {
        const i = end ? n - 1 : 0;
        const j = end ? n - 2 : 1;
        let tx = pts[i * 2] - pts[j * 2];
        let ty = pts[i * 2 + 1] - pts[j * 2 + 1];
        const l = Math.hypot(tx, ty) || 1;
        const e = extend(pts[i * 2], pts[i * 2 + 1], tx / l, ty / l);
        if (e.length / 2 < 2 || (e.length / 2 - 1) * h < dsep * 3) continue;
        for (let k = 2; k < e.length; k += 2) hid.add(e[k], e[k + 1]);
        runs.push([e, 2, 0, 1]);
        // the line runs on: no taper where it meets its continuation
        runs[li][2 + end] = 0;
      }
    });
  }

  // cut each line into strokes of varied length and resample them
  const out = [];
  const meta = [];
  for (const [pts, kind, capA, capB] of runs) {
    const n = pts.length / 2;
    const arc = new Float32Array(n);
    for (let i = 1; i < n; i++)
      arc[i] = arc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const total = arc[n - 1];
    let a0 = -rand() * dsep * 2; // a staggered start, so cuts don't line up
    let k = 0;
    while (a0 < total) {
      let a1 = a0 + dsep * (cut[0] + rand() * (cut[1] - cut[0]));
      if (total - a1 < dsep * cut[0] * 0.5) a1 = total;
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
          if (!sky) lmax = Math.max(lmax, S(F.lum, x, y));
        }
        if (sky || lmax > lumLo) {
          out.push(stroke);
          // a sky run tapers only where its line really ends
          meta.push(kind, a1 - s0, sky ? capA * +(s0 <= 0) : 1, sky ? capB * +(a1 >= total) : 1);
        }
      }
      a0 = a1;
    }
  }
  const flat = new Float32Array(out.length * P * 2);
  out.forEach((s, i) => flat.set(s, i * P * 2));
  return { data: flat, meta: new Float32Array(meta), count: out.length };
}
