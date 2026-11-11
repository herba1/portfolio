// The CPU half of Sort, shared by the engine and offline checks: the bands,
// the stack's shape, the resting wave's mask, the bake (one sort row per
// band), the spans the mask opens, and the wave's geometry. Plain arrays in, plain
// arrays out; no DOM.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The grid is the print's own resolution (the photo is shown at 2400x1600).
export const GW = 2400;
export const GH = 1600;
const S = GW / 1200; // grid px per layout unit
export const CELL = 24; // mask cell, grid px; sampled bilinearly, so the region has soft edges
export const MW = Math.ceil(GW / CELL);
export const MH = Math.ceil(GH / CELL);
// Span interval on luminance: lo = mix(LO0, LO1, m).
export const LO0 = 0.5;
export const LO1 = 0.0;
export const HI = 1.0;
export const HOLD_DEPTH = 44; // nearer than this (0..255), and not grass or sky, stands in front of the stack
export const HOLD_TALL = 34; // a holdout must run this many grid rows unbroken
export const JUMP = 16; // a depth step this large between neighbours breaks a span
export const EDGE = 18; // depth step (0..255 over 4 layout px) that marks a silhouette
export const REACH = 760 * S; // a band's reach at m = 1, before the clamp below
// Span exit clamp: a span ends once it has run this fraction of its band's
// reach through pixels that are not vegetation since the last one that was.
// So the wave carries its own green out of the verge and over a gap (the
// road, a wall, a strip of sky) but never drags a long tail of sky behind it.
export const EXIT = 0.3;
// Green: the vegetation that a span may start from.
const isVeg = (r, g, b) => g > r + 6 && g > b + 12;
// Sort key: luminance, with every green pixel ahead of every other. So a
// sorted run is one clean luminance ramp through its grass, darkest green
// (rooted where the span starts) to brightest yellow-green, and only then
// whatever else it carried (the sky and wall highlights), again dark to
// bright, out at its far end. Greenness itself never enters the order, so
// the ramp is not broken into a scatter of hues.
export const GREEN_SPAN = 0.5; // the key range the grass takes
export const VEG_RUN = 4; // green texels in a row that count as grass
export function sortKey(r, g, b) {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Stays in 0..1 for 16-bit storage.
  return clamp(isVeg(r, g, b) ? l * GREEN_SPAN : GREEN_SPAN + l * (1 - GREEN_SPAN), 0, 1);
}

// Small deterministic hash noise.
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- bands
// The picture is cut into horizontal bands 4-7 grid px tall (about 3-6
// device px at the usual print size), each height from a hash, so at DPR 2
// the sorted runs read as fine streaks rather than blocks. A band is
// sorted once, along its centre row, and that one sorted row is written down
// the band's full height: every run is a solid rectangle with hard ends.
export const BAND_MIN = 4;
export const BAND_MAX = 7;
export const BANDS = (() => {
  const y0 = [];
  const h = [];
  let y = 0;
  for (let j = 0; y < GH; j++) {
    const hh = Math.min(GH - y, BAND_MIN + Math.floor(hash(j, 71) * (BAND_MAX - BAND_MIN + 1)));
    y0.push(y);
    h.push(hh);
    y += hh;
  }
  const n = y0.length;
  const of = new Uint16Array(GH);
  const c = new Uint16Array(n);
  for (let j = 0; j < n; j++) {
    c[j] = y0[j] + (h[j] >> 1);
    for (let k = 0; k < h[j]; k++) of[y0[j] + k] = j;
  }
  return { n, y0: Uint16Array.from(y0), h: Uint8Array.from(h), c, of };
})();
// The sort domain: one row per band, one texel per grid column.
export const DW = GW;
export const DH = BANDS.n;

// ---- the stack
// The wave is a staircase of straight strips, after herb's reference 2:
// every strip is one band's sorted run, a hard-edged horizontal rectangle at
// its own row, never bent. The rise comes only from stacking. Bands of the
// verge (rows VERGE_TOP..VERGE_BOT) are sorted in place and are the root;
// above them every band row is a layer of the stack, and each layer shows a
// verge band's run lifted up to it and stepped right by a smooth function of
// its height, so the stack leans over as it climbs. Over the top the crest
// runs on to the right and a lip of shorter strips hangs down from its end,
// so the staircase reads as a blade of grass peeling up and curling over.
// The crossing (the road and the rails, right of centre) stays clear.
export const VERGE_TOP = 1236; // grid rows below this are the verge, sorted in place
export const VERGE_BOT = 1470; // ...down to here (the rails start below)
export const CREST = 392; // the stack's top row
export const ROOT_X1 = 1160; // the root zone runs from the print's left edge to here
export const X_ROOT = 210; // a strip's left end at the foot of the stack...
export const LEAN = 820; // ...and how far right it has stepped at the crest
export const LEAN_POW = 2.1;
export const LEN0 = 420; // a strip's length at the foot, before the brush scales it
export const LEN1 = 260; // ...and what the crest adds
// The lip: how far the crest's rows may reach as they run on over the top
// and hang down. It is a reach, not an outline; each row still ends where
// its last whole run ends.
export const LIP_H = 420; // the lip hangs this far below the crest
export const WELD = 0.7; // down to here (share of LIP_H) the lip is the face's own rows; below, its tip hangs free
export const LIP_X = 1720; // its reach at its widest
export const LIP_W = 400; // its width at the crest, tapering to a point
export const LIP_TOP = 160; // the reach rounds in by this over the shoulder...
export const LIP_IN = 380; // ...and curls back in by this to the tip
export const stackT = (y) => (VERGE_TOP - y) / (VERGE_TOP - CREST);
export const stackLeft = (t) => X_ROOT + LEAN * Math.max(0, t) ** LEAN_POW;
// The lip's reach on row y: it rounds over the shoulder and curls back in
// towards the face as it hangs, so the rows' ragged ends turn a hook. Down
// to WELD the crest's rows run on into it unbroken; below that only its tip
// hangs, tapering, curling in over a hollow that opens downward.
const LIP_SH = 0.22; // where the outer edge is furthest out, as a share of LIP_H
export function lipSpan(y) {
  const s = (y - CREST) / LIP_H;
  if (s < 0 || s > 1) return null;
  const u = s < LIP_SH ? (LIP_SH - s) / LIP_SH : (s - LIP_SH) / (1 - LIP_SH);
  const xb = LIP_X - (s < LIP_SH ? LIP_TOP : LIP_IN) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
  return [xb - (LIP_W * (1 - s) ** 1.15 + 36), xb, s];
}
// Mask level a layer at height t needs before it lifts: the stack climbs as
// the brush works.
export const liftAt = (t) => WAVE_ON + (0.97 - WAVE_ON) * clamp(t, 0, 1);

// The stack's rows. The stack is not cut on the sort's bands: from the crest
// down to the verge it is cut into its own rows, mostly thin (3-11 grid px,
// 2-9 device px at DPR 2) with an occasional thick one (14-29 grid px, up to
// 24 device px), each height from a hash, so the sheet mixes hairlines with
// chunky blocks the way reference 2 does. Rows abut: no sky between them.
export const ROW_MIN = 3;
export const ROW_MAX = 29;
export const ROWS = (() => {
  const y0 = [];
  const h = [];
  let y = CREST;
  let thickLast = false;
  for (let j = 0; y < VERGE_TOP; j++) {
    const u = hash(j, 173);
    // The upper third, where the light reads into the tails, is where the
    // chunky blocks gather: tall rows (20-29 grid px, 16-24 device px) whose
    // blown ends stack into the crest's glowing spine.
    const up = stackT(y) > 0.55;
    const thick = !thickLast && hash(j, 179) < (up ? 0.3 : 0.13);
    const t0 = up ? 20 : 14;
    let hh = thick ? t0 + Math.floor(u * (ROW_MAX - t0 + 1)) : ROW_MIN + Math.floor(u ** 2.2 * 9);
    // No sliver at the foot: the last row takes what is left.
    if (VERGE_TOP - y - hh < ROW_MIN) hh = VERGE_TOP - y;
    y0.push(y);
    h.push(hh);
    y += hh;
    thickLast = thick;
  }
  return { n: y0.length, y0: Uint16Array.from(y0), h: Uint8Array.from(h) };
})();

// The mask at grid point (x, y), bilinear between cell centres.
export function maskAt(mask8, x, y) {
  const fx = clamp(x / CELL - 0.5, 0, MW - 1);
  const fy = clamp(y / CELL - 0.5, 0, MH - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(MW - 1, x0 + 1);
  const y1 = Math.min(MH - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = mask8[y0 * MW + x0] + (mask8[y0 * MW + x1] - mask8[y0 * MW + x0]) * tx;
  const b = mask8[y1 * MW + x0] + (mask8[y1 * MW + x1] - mask8[y1 * MW + x0]) * tx;
  return (a + (b - a) * ty) / 255;
}

// The mask along grid row y, every column, as maskAt would read it.
export function maskRow(mask8, y, out = new Float32Array(GW)) {
  const fy = clamp(y / CELL - 0.5, 0, MH - 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(MH - 1, y0 + 1);
  const ty = fy - y0;
  const cell = (cx) => (mask8[y0 * MW + cx] + (mask8[y1 * MW + cx] - mask8[y0 * MW + cx]) * ty) / 255;
  // Between cell centres the mask is linear in x: walk it a cell at a time.
  const h = CELL / 2;
  let c0 = cell(0);
  out.fill(c0, 0, Math.min(GW, h));
  for (let cx = 0; cx < MW - 1; cx++) {
    const c1 = cell(cx + 1);
    const xa = cx * CELL + h;
    const xb = Math.min(GW, xa + CELL);
    if (c0 === c1) out.fill(c0, xa, xb);
    else for (let x = xa; x < xb; x++) out[x] = c0 + ((c1 - c0) * (x + 0.5 - xa)) / CELL;
    c0 = c1;
  }
  const xe = (MW - 1) * CELL + h;
  if (xe < GW) out.fill(c0, xe, GW);
  return out;
}

// The resting wave's mask: the verge, from the print's left edge to just
// short of the crossing, held at the amount. The stack climbs from it as far
// as that amount lets it (liftAt), and the brush can open it anywhere else.
export function demoMask(amount) {
  const m = new Float32Array(MW * MH);
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const n = vnoise(x / 160, y / 160) - 0.5;
      const v = smooth(VERGE_TOP - 90, VERGE_TOP - 20, y) * smooth(VERGE_BOT + 50, VERGE_BOT, y) * smooth(ROOT_X1 + 60, ROOT_X1 - 40, x + n * 160);
      m[cy * MW + cx] = clamp(v * amount, 0, 1);
    }
  }
  return m;
}

// Everything the CPU prepares once, per band texel (x, band j), read off the
// band's centre row: luminance (16 bit), depth (255 on a silhouette, never in
// a span), reach (1 + 253 x how many non-vegetation pixels lie between this
// texel and the last vegetation on its row, as a fraction of EXIT x that
// band's reach; 255 = out of reach), and the sort key. A span may only enter
// at grass and run on, through sky and whatever else, as far as the mask
// allows (m >= reach) and until a silhouette or a depth jump. So grass is
// carried out of the verge and over the sky, and a pole or a sign, with no
// grass of its own, is never entered.
export function bake(photoPx, depthPx) {
  // Depth, opened (min then max over a few px): the overhead wires, a pixel
  // or two wide, drop out of it, so they neither break a span nor stop the
  // wave; anything thicker (a pole, a sign) keeps its outline.
  const dep = new Uint8Array(GW * GH);
  {
    const R = 3;
    const a = new Uint8Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) a[i] = depthPx[i * 4];
    const b = new Uint8Array(GW * GH);
    const pass = (src, dst, horiz, lo) => {
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          let v = lo ? 255 : 0;
          for (let k = -R; k <= R; k++) {
            const w = horiz ? src[y * GW + clamp(x + k, 0, GW - 1)] : src[clamp(y + k, 0, GH - 1) * GW + x];
            v = lo ? (w < v ? w : v) : w > v ? w : v;
          }
          dst[y * GW + x] = v;
        }
      }
    };
    pass(a, b, true, true);
    pass(b, a, false, true);
    pass(a, b, true, false);
    pass(b, dep, false, false);
  }
  const D = (x, y) => dep[clamp(y, 0, GH - 1) * GW + clamp(x, 0, GW - 1)];
  const greenAt = (x, y) => {
    const s = (clamp(y, 0, GH - 1) * GW + clamp(x, 0, GW - 1)) * 4;
    return isVeg(photoPx[s], photoPx[s + 1], photoPx[s + 2]);
  };
  // Silhouettes: a step in depth whose near side is not grass (a pole, a
  // sign, a cabinet against what lies behind it). Foliage against the sky is
  // no silhouette. Only the band centre rows are needed.
  const edgeAt = (x, y) => {
    const o = 2 * S;
    const l = D(x - o, y);
    const r = D(x + o, y);
    const t = D(x, y - o);
    const b = D(x, y + o);
    const gx = Math.abs(r - l);
    const gy = Math.abs(b - t);
    if (Math.max(gx, gy) <= EDGE) return 0;
    const [dx, dy] = gx >= gy ? [r > l ? 1 : -1, 0] : [0, b > t ? 1 : -1];
    const far = D(x - dx * o, y - dy * o);
    if (greenAt(x + dx * o, y + dy * o)) return 0;
    // A wire (an object thinner than a few px) is no silhouette.
    if (D(x + dx * 2 * o, y + dy * 2 * o) - far <= EDGE * 0.6) return 0;
    return 1;
  };

  const N = DW * DH;
  const lum16 = new Uint16Array(N);
  const key16 = new Uint16Array(N);
  const depth = new Uint8Array(N);
  const reachQ = new Uint8Array(N);
  const veg = new Uint8Array(N); // 1 on vegetation
  const k0 = 2 * S;
  const eRow = new Uint8Array(GW);
  for (let j = 0; j < DH; j++) {
    const y = BANDS.c[j];
    // Silhouette, dilated a few px along the row and across it.
    const g = new Uint8Array(GW);
    for (let x = 0; x < GW; x++) {
      let e = 0;
      for (let k = -k0; k <= k0 && !e; k++) e = edgeAt(x, y + k);
      g[x] = e;
    }
    for (let x = 0; x < GW; x++) {
      let e = 0;
      for (let k = -k0; k <= k0 && !e; k++) e = g[clamp(x + k, 0, GW - 1)];
      eRow[x] = e;
    }
    const reach = REACH * (0.3 + 0.45 * vnoise(y / (26 * S), 3.7) + 0.25 * hash(j, 11));
    let last = -1e9; // x of the last grass on this row
    let prevD = -1;
    let vegRun = 0;
    for (let x = 0; x < GW; x++) {
      const k = j * DW + x;
      const p = y * GW + x;
      const s = p * 4;
      const l = (0.2126 * photoPx[s] + 0.7152 * photoPx[s + 1] + 0.0722 * photoPx[s + 2]) / 255;
      const d = eRow[x] ? 255 : Math.min(254, dep[p]);
      // A silhouette or a depth jump ends whatever run of grass came before.
      if (d === 255 || (prevD >= 0 && Math.abs(d - prevD) >= JUMP)) last = -1e9;
      // Grass, as a span root, is a few green texels in a row: a lone green
      // speck in the asphalt roots nothing.
      vegRun = d < 255 && isVeg(photoPx[s], photoPx[s + 1], photoPx[s + 2]) ? vegRun + 1 : 0;
      if (vegRun >= VEG_RUN) last = x;
      prevD = d;
      const rq = 1 + Math.round((253 * (x - last)) / (EXIT * reach));
      lum16[k] = Math.round(l * 65535);
      key16[k] = Math.round(sortKey(photoPx[s], photoPx[s + 1], photoPx[s + 2]) * 65535);
      depth[k] = d;
      reachQ[k] = rq > 254 ? 255 : rq;
      veg[k] = isVeg(photoPx[s], photoPx[s + 1], photoPx[s + 2]) ? 1 : 0;
    }
  }
  // The holdout, per grid pixel: what stands in front of the stack. A pole,
  // a sign or a cabinet is near in depth and neither grass nor sky; the
  // strips pass behind it, so every pole stays whole. Opened, so a stray
  // dark leaf in a tree holds nothing out.
  const hold = new Uint8Array(GW * GH);
  {
    const a = new Uint8Array(GW * GH);
    for (let p = 0; p < GW * GH; p++) {
      const s = p * 4;
      const r = photoPx[s];
      const g = photoPx[s + 1];
      const b = photoPx[s + 2];
      const hi = Math.max(r, g, b);
      const sky = (b > r + 24 && b >= g - 12) || (hi > 205 && hi - Math.min(r, g, b) < 34);
      a[p] = dep[p] > HOLD_DEPTH && !isVeg(r, g, b) && !sky ? 1 : 0;
    }
    const b = new Uint8Array(GW * GH);
    const R = 4;
    const pass = (src, dst, horiz, lo) => {
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          let v = lo ? 1 : 0;
          for (let k = -R; k <= R; k++) {
            const w = horiz ? src[y * GW + clamp(x + k, 0, GW - 1)] : src[clamp(y + k, 0, GH - 1) * GW + x];
            v = lo ? v & w : v | w;
          }
          dst[y * GW + x] = v;
        }
      }
    };
    pass(a, b, true, true);
    pass(b, a, false, true);
    pass(a, b, true, false);
    pass(b, hold, false, false);
    // Only what stands tall holds out: a pole, a sign or a cabinet runs
    // unbroken down many rows, a clump of dry leaves in a tree does not, and
    // would punch specks of photo through the sheet. Each holdout region is
    // kept whole (a lamp's thin bracket with it) if any of it stands tall.
    const keep = a; // reused: 255 = kept
    keep.fill(0);
    const stack = [];
    for (let x = 0; x < GW; x++) {
      let y = 0;
      while (y < GH) {
        if (!hold[y * GW + x]) {
          y++;
          continue;
        }
        const y0 = y;
        while (y < GH && hold[y * GW + x]) y++;
        if (y - y0 >= HOLD_TALL && !keep[y0 * GW + x]) {
          keep[y0 * GW + x] = 255;
          stack.push(y0 * GW + x);
        }
      }
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % GW;
      const nb = [x > 0 ? p - 1 : -1, x < GW - 1 ? p + 1 : -1, p - GW, p + GW];
      for (const q of nb) {
        if (q < 0 || q >= GW * GH || keep[q] || !hold[q]) continue;
        keep[q] = 255;
        stack.push(q);
      }
    }
    hold.set(keep);
  }
  return { lum16, key: key16, depth, reachQ, veg, hold };
}

// The mask read once per band texel (on the band's centre row), 0..255.
export function bandMask(mask8, out = new Uint8Array(DW * DH)) {
  for (let j = 0; j < DH; j++) {
    const y = BANDS.c[j] + 0.5;
    for (let x = 0; x < DW; x++) out[j * DW + x] = Math.round(maskAt(mask8, x + 0.5, y) * 255);
  }
  return out;
}

// The links the mask opens: link[k] = 1 when texels k and k + 1 of a band
// lie in one span (both in span, no depth jump between them). The GPU network
// only ever swaps across an open link; everywhere else it orders by home
// index, so a pixel outside a span flows home.
export function links(base, bm, out = new Uint8Array(DW * DH)) {
  const { lum16, depth, reachQ } = base;
  const inSpan = (k) => {
    const rq = reachQ[k];
    if (depth[k] === 255 || bm[k] < 1) return false;
    const m = bm[k] / 255;
    if ((rq - 1) / 253 > m) return false;
    const l = lum16[k] / 65535;
    return l >= LO0 + (LO1 - LO0) * m && l <= HI;
  };
  for (let j = 0; j < DH; j++) {
    const row = j * DW;
    let prev = inSpan(row);
    for (let x = 0; x < DW - 1; x++) {
      const next = inSpan(row + x + 1);
      out[row + x] = prev && next && Math.abs(depth[row + x] - depth[row + x + 1]) < JUMP ? 1 : 0;
      prev = next;
    }
    out[row + DW - 1] = 0;
  }
  return out;
}

// The runs: maximal chains of open links, as [band, x0, x1) triples.
export function runs(link) {
  const out = [];
  for (let j = 0; j < DH; j++) {
    const row = j * DW;
    let x = 0;
    while (x < DW) {
      if (!link[row + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < DW && link[row + x]) x++;
      out.push(j, x0, x + 1);
    }
  }
  return out;
}

// The resting sort, on the CPU: same runs, keys and tie-break as the GPU
// network, so it is a fixed point of it.
export function restSort(base, link, state = new Uint16Array(DW * DH)) {
  for (let k = 0; k < DW * DH; k++) state[k] = k % DW;
  const r = runs(link);
  const key16 = base.key;
  for (let n = 0; n < r.length; n += 3) {
    const row = r[n] * DW;
    const x0 = r[n + 1];
    const x1 = r[n + 2];
    const idx = [];
    for (let x = x0; x < x1; x++) idx.push(x);
    idx.sort((a, b) => key16[row + a] - key16[row + b] || a - b);
    for (let i = 0; i < idx.length; i++) state[row + x0 + i] = idx[i];
  }
  return state;
}

// ---- the wave's geometry
// The wave is made by moving whole sorted rows, never by bending the sort.
// The verge's bands are sorted in place (each long run slid a hashed way to
// the right where it has been lifted, so the photo shows where its pixels
// left). Above the verge the stack is cut into ROWS, and a lifted row is an
// opaque straight strip from stackLeft(t), tiled end to end from the sorted
// runs of several verge bands, each read from its dark green head towards
// its brightest tail. There is no drawn outline: a row is given only a reach
// (how far the brush lets it run), and it ends where its last whole run
// ends, so the outer edge is ragged row by row and is the sort's own. Over
// the top the crest's rows run on out and hang down as the lip, welded to the
// face: one sheet curling over, no sky inside it.
//
// The stack is lit by its own sort order: each row carries a facing (0
// tucked low under the lean, 1 at the crest turned to the sky), and the
// facing picks which stretch of its runs the row reads. Low rows read the
// dark green heads; across the upper third the rows read on into the tails,
// and each row's tail lands at its end as a block gone over to white-gold.
// The tall rows up there blow out whole at their ends, a broken column of
// glowing blocks (the spine), and a few glint tiles break off the crest.
export const WAVE_ON = 0.12; // mask level where the verge sorts in place and the stack's foot lifts
export const RUN_MIN = 120; // shorter verge runs are never lifted
export const SHOW_MIN = 72; // shorter runs stay photo, not sorted in place: no mosaic of stubs
export const GLINT_PEAK = 0.5; // a run whose brightest pixel is this bright can throw a glint
export const GLINTS = 16; // glint tiles at most
// A layer's run is chosen among its source band's runs left of here.
const SRC_X1 = ROOT_X1 + 240;
// Each grid row holds up to PARTS tiles, three RGBA16UI texels each, in a
// texture GH wide and 3 x PARTS tall: (x0, x1, source band + 1, flags) for
// the tile's span, (run x0, run x1, facing x 65535, vegetation share of the
// run x 65535), and (row x0, row x1, tile ramp depth x 65535, blow-out x
// 65535) for the whole row the tile is part of. The first tile that holds a pixel draws it,
// so glints and end blocks are written first.
export const PARTS = 12;
export const F_LIFT = 1; // a lifted strip: held out behind poles, lit by its facing
export const F_GLINT = 2; // a glint tile: the run's brightest pixel, white-gold
export const F_BLOWN = 4; // a row's end block: its run's tail, gone over to white-gold
// A verge run in place slides right by up to this much of itself where it
// has been lifted.
const SLIDE = 0.3;
// A run must be this much grass to be lifted.
const VEG_MIN = 0.5;

// Which layers lift, and from where, for this mask. The stack's foot is the
// verge: the mask over the root zone (its upper quartile, so a few strokes
// along the verge count) lifts every layer it reaches with liftAt, and the
// mask under a layer itself can lift it too.
export function liftPlan(mask8) {
  const B = BANDS;
  const zone = [];
  for (let cy = 0; cy < MH; cy++) {
    const y = (cy + 0.5) * CELL;
    if (y < VERGE_TOP - 40 || y > VERGE_BOT) continue;
    for (let cx = 0; cx * CELL < ROOT_X1; cx++) zone.push(mask8[cy * MW + cx]);
  }
  zone.sort((a, b) => a - b);
  const root = zone.length ? zone[Math.floor(zone.length * 0.75)] / 255 : 0;
  const verge = [];
  for (let d = 0; d < DH; d++) if (B.c[d] >= VERGE_TOP && B.c[d] <= VERGE_BOT) verge.push(d);
  const nv = verge.length;
  const layers = [];
  let i = 0;
  for (let r = ROWS.n - 1; r >= 0; r--) {
    const c = ROWS.y0[r] + ROWS.h[r] / 2;
    const t = stackT(c);
    const xl = stackLeft(t) + (hash(r, 31) - 0.5) * 20;
    const reach = LEN0 + LEN1 * t;
    const m = Math.max(root, maskAt(mask8, xl + 0.35 * reach, c));
    // Bottom to top the rows walk the verge in a scrambled order, so no two
    // neighbours start on the same band.
    const src = (i * 7 + Math.floor(i / nv)) % nv;
    const L = { r, t, xl, m, on: m >= liftAt(t), src, lip: null };
    const lip = lipSpan(c);
    if (lip) {
      const ml = Math.max(root, maskAt(mask8, lip[0], c));
      if (ml >= liftAt(1)) L.lip = { xa: lip[0], xb: lip[1], s: lip[2], m: ml, src: (i * 11 + 5) % nv };
    }
    layers.push(L);
    i++;
  }
  return { root, layers, verge };
}

// The mask read once per band texel, as bandMask, raised on every verge band
// once any row lifts: a row is tiled from runs of several verge bands, so the
// sort runs on all of them whether or not the brush has touched the verge
// itself. (Sorting a band shows nothing in place unless the mask is there.)
export function liftMask(mask8, plan, out = new Uint8Array(DW * DH)) {
  bandMask(mask8, out);
  let m = 0;
  for (const L of plan.layers) {
    if (L.on) m = Math.max(m, L.m);
    if (L.lip) m = Math.max(m, L.lip.m);
  }
  if (m <= 0) return out;
  const v = Math.round(m * 255);
  for (const d of plan.verge) {
    const row = d * DW;
    for (let x = 0; x < SRC_X1; x++) if (out[row + x] < v) out[row + x] = v;
  }
  return out;
}

export function geometry(mask8, base, link, plan, out = {}) {
  const geo = out.geo || new Uint16Array(DW * DH * 2);
  const table = out.table || new Uint16Array(GH * 3 * PARTS * 4);
  geo.fill(0);
  table.fill(0);
  const B = BANDS;
  const r = runs(link);
  const byBand = Array.from({ length: DH }, () => []);
  for (let n = 0; n < r.length; n += 3) byBand[r[n]].push([r[n + 1], r[n + 2]]);
  const lifted = new Uint8Array(DH);
  for (const L of plan.layers) {
    if (L.on) lifted[plan.verge[L.src]] = 1;
    if (L.lip) lifted[plan.verge[L.lip.src]] = 1;
  }

  // In place: every long run under the mask, slid right where it was lifted.
  const mrow = new Float32Array(GW);
  for (let d = 0; d < DH; d++) {
    const row = d * DW;
    maskRow(mask8, B.c[d] + 0.5, mrow);
    for (const [x0, x1] of byBand[d]) {
      if (x1 - x0 < SHOW_MIN) continue;
      const slide = lifted[d] ? Math.round((x1 - x0) * SLIDE * hash(d * 131 + x0, 93) ** 1.3) : 0;
      for (let k = x0 + slide; k < x1; k++) {
        if (mrow[k] < WAVE_ON) continue;
        geo[(row + k) * 2] = k - slide + 1;
        geo[(row + k) * 2 + 1] = d;
      }
    }
  }

  const vegOf = (d, x0, x1) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += base.veg[d * DW + x];
    return n / Math.max(1, x1 - x0);
  };
  // A band's liftable runs, longest first.
  const pool = new Map();
  const runsOf = (d) => {
    if (!pool.has(d)) {
      const c = byBand[d].filter(([x0, x1]) => x1 - x0 >= RUN_MIN && x0 < SRC_X1 && vegOf(d, x0, x1) >= VEG_MIN);
      c.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
      pool.set(d, c);
    }
    return pool.get(d);
  };
  // A run for a tile: one of a verge band's two longest (by hash), or the
  // next verge band's when it has none.
  const verge = plan.verge;
  const nv = verge.length;
  const pick = (vi, salt) => {
    for (let k = 0; k < nv; k++) {
      const dd = verge[(vi + k) % nv];
      const c = runsOf(dd);
      if (!c.length) continue;
      const [x0, x1] = c[c.length > 1 && hash(dd, salt) > 0.62 ? 1 : 0];
      return { d: dd, x0, x1, vf: vegOf(dd, x0, x1) };
    }
    return null;
  };
  const lum = base.lum16;
  const peakOf = (run) => {
    let p = 0;
    for (let x = run.x0; x < run.x1; x++) p = Math.max(p, lum[run.d * DW + x]);
    return p / 65535;
  };

  // A tile on stack row r, written down every grid row the stack row covers.
  const parts = new Uint8Array(ROWS.n);
  const put = (r, x0, x1, flags, run, f, rx0, rx1, w, blow = 0) => {
    if (parts[r] >= PARTS) return;
    const a = clamp(Math.round(x0), 0, GW);
    const b = clamp(Math.round(x1), 0, GW);
    if (b - a < 2) return;
    const k = parts[r]++;
    const ra = clamp(Math.round(rx0), 0, GW);
    const rb = Math.max(ra + 1, clamp(Math.round(rx1), 0, GW));
    for (let y = ROWS.y0[r]; y < ROWS.y0[r] + ROWS.h[r]; y++) {
      const o = (3 * k * GH + y) * 4;
      const o1 = o + GH * 4;
      const o2 = o + GH * 8;
      table[o] = a;
      table[o + 1] = b;
      table[o + 2] = run.d + 1;
      table[o + 3] = flags;
      table[o1] = run.x0;
      table[o1 + 1] = run.x1;
      table[o1 + 2] = Math.round(clamp(f, 0, 1) * 65535);
      table[o1 + 3] = Math.round(clamp(run.vf, 0, 1) * 65535);
      table[o2] = ra;
      table[o2 + 1] = rb;
      table[o2 + 2] = Math.round(clamp(w, 0, 1) * 65535);
      table[o2 + 3] = Math.round(clamp(blow, 0, 1) * 65535);
    }
  };

  // Tiling: a row of the sheet starts at its inner edge xa and is laid end to
  // end with sorted runs from verge bands further and further round the
  // scrambled walk, each tile as long as its run makes it (a hashed share of
  // the run's length). The row has no drawn outer edge: it ends where its
  // last whole tile ends, whichever run end lies nearest the reach it was
  // given, so row by row the ends are ragged by the runs' own lengths. Each
  // tile is a hard-edged block reading a stretch of its run (depth w) riding
  // on the row's one ramp, so the row still goes dark to bright, and its last
  // tile reads on into the run's tail.
  const TILE_MAX = 8;
  const tile = (r, xa, reach, vi, salt, f, list) => {
    const out = [];
    let x = xa;
    for (let k = 0; k < TILE_MAX && x < reach; k++) {
      const run = pick((vi + k * 5) % nv, salt + k);
      if (!run) break;
      const len = run.x1 - run.x0;
      let tl = clamp(len * (0.5 + 0.75 * hash(r * 13 + k, salt)), 48, 520);
      // The first tile of a row that has only just lifted may be cut down,
      // so a stack that has not reached its crest still tapers.
      if (k === 0) tl = Math.min(tl, Math.max(40, (reach - xa) * (0.7 + 0.9 * hash(r, salt + 29))));
      // Stop short rather than overshoot by more than the gap left.
      else if (x + tl - reach > reach - x) break;
      out.push([x, x + tl, run]);
      x += tl;
    }
    for (const [x0, x1, run] of out) {
      const last = x1 === x;
      const w = last ? 0.85 : clamp((0.55 * (x1 - x0)) / Math.max(1, run.x1 - run.x0), 0.14, 0.5);
      list.push([r, x0, x1, F_LIFT, run, f, xa, x, w]);
    }
    return { tiles: out, xb: x };
  };

  // The tiles, collected first so glints and end blocks can be written
  // ahead of the face they sit on.
  const face = [];
  const ends = [];
  const tails = [];
  for (const L of plan.layers) {
    const { r, t } = L;
    const c = ROWS.y0[r] + ROWS.h[r] / 2;
    const lip = L.lip;
    if (!L.on && !lip) continue;
    // The row's reach: how far the brush lets it run. The topmost rows the
    // mask has only just lifted reach less, so a stack short of its crest
    // tapers. Over the top the crest's rows run on out to the lip's reach and
    // hang down as it: the lip is the face's own rows, one sheet.
    const xa = L.xl;
    let reach = 0;
    let f = clamp(smooth(0.06, 0.8, t) ** 1.1 + (hash(r, 47) - 0.5) * 0.12, 0, 1);
    if (L.on) {
      const grow = 0.25 + 0.75 * smooth(0, 0.16, L.m - liftAt(t));
      reach = L.xl + (LEN0 + LEN1 * t) * (0.55 + 0.45 * L.m) * grow;
    }
    const tip = lip && lip.s > WELD;
    if (lip && !tip) {
      reach = Math.max(reach, lip.xb);
      // The shoulder is turned fully to the sky; the lip darkens as it
      // hangs and turns under.
      f = Math.max(f * (1 - 0.35 * smooth(0.4, 1, lip.s)), 1 - 0.62 * lip.s ** 1.2);
    } else if (tip && L.on) {
      // Under the weld the face falls away from the tip as a rounded vault,
      // so the hollow opens downward out of the sheet, not across it.
      const u = (lip.s - WELD) / (1 - WELD);
      reach = Math.max(reach, lip.xa + (reach - lip.xa) * u ** 0.75);
    }
    // The tip, hanging free under the welded sheet: its own short row,
    // turned under and darkening, ragged at both ends.
    if (tip) {
      const ft = 1 - 0.62 * lip.s ** 1.2;
      const ta = lip.xa + (hash(r, 59) - 0.5) * 24;
      const tt = tile(r, ta, lip.xb, lip.src, 53, ft, face);
      if (tt.tiles.length) {
        const [, , trun] = tt.tiles[tt.tiles.length - 1];
        const bl = clamp((tt.xb - ta) * (0.15 + 0.2 * hash(r, 73)), 10, 60);
        ends.push([r, tt.xb - bl, tt.xb, F_LIFT | F_BLOWN, trun, ft, ta, tt.xb, 0, smooth(0.38, 0.85, ft) * 0.6]);
      }
    }
    if (!L.on || reach - xa < 24) continue;
    const { tiles, xb } = tile(r, xa, reach, L.src, 41, f, face);
    if (!tiles.length) continue;
    const [lx0, , run] = tiles[tiles.length - 1];
    const h = ROWS.h[r];
    // The run's tail lands at the row's end as a block gone over to
    // white-gold, more of it the more the row faces the sky. The tall rows
    // of the upper third blow out whole: the spine.
    const blow = smooth(0.38, 0.85, f);
    if (blow > 0.04) {
      const spine = h >= 20 && f > 0.55;
      const share = spine ? 0.4 + 0.3 * hash(r, 71) : 0.12 + 0.22 * hash(r, 71) * blow;
      const bl = clamp((xb - lx0) * share, spine ? 64 : 14, spine ? 220 : 120);
      ends.push([r, xb - bl, xb, F_LIFT | F_BLOWN, run, f, xa, xb, 0, spine ? 1 : blow]);
    }
    if (f > 0.6) tails.push({ r, x1: xb, run, f, y: ROWS.y0[r], xa, xb });
  }

  // Glints: a handful of bright tails where the facing peaks, spaced apart.
  // Each is the strip's own brightest pixel broken off past its end, after a
  // short gap, as tall as the row.
  const glint = [];
  tails.sort((p, q) => q.f - p.f + (hash(q.r, 61) - hash(p.r, 61)) * 0.3);
  for (const g of tails) {
    if (glint.length >= GLINTS) break;
    if (peakOf(g.run) < GLINT_PEAK) continue;
    if (glint.some((o) => Math.abs(o.x - g.x1) < 60 && Math.abs(o.y - g.y) < 16)) continue;
    const gap = 4 + Math.round(hash(g.r, 63) * 10);
    const w = 12 + Math.round(hash(g.r, 65) * 30);
    glint.push({ x: g.x1, y: g.y });
    put(g.r, g.x1 + gap, g.x1 + gap + w, F_LIFT | F_GLINT, g.run, 1, g.xa, g.xb, 0, 1);
  }
  for (const p of ends) put(...p);
  for (const p of face) put(...p);
  return { geo, table, glintN: glint.length };
}
