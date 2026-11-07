// The CPU half of Sort, shared by the engine and offline checks: the bands,
// the curl map, the resting wave's mask, the bake (one sort row per band),
// the spans the mask opens, and the wave's geometry. Plain arrays in, plain
// arrays out; no DOM.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The grid is the print's own resolution (the photo is shown at 2400x1600).
export const GW = 2400;
export const GH = 1600;
const S = GW / 1200; // grid px per layout unit (the shapes below are drawn on a 1200x800 sheet)
export const CX = 520 * S; // curl centre, grid px
export const CY = 470 * S;
export const CELL = 24; // mask cell, grid px; sampled bilinearly, so the region has soft edges
export const MW = Math.ceil(GW / CELL);
export const MH = Math.ceil(GH / CELL);
// Span interval on luminance: lo = mix(LO0, LO1, m).
export const LO0 = 0.5;
export const LO1 = 0.0;
export const HI = 1.0;
export const JUMP = 16; // a depth step this large between neighbours breaks a span
export const EDGE = 18; // depth step (0..255 over 4 layout px) that marks a silhouette
export const REACH = 760 * S; // a band's reach at m = 1, before the clamp below
// Span exit clamp: a span ends once it has run this fraction of its band's
// reach through pixels that are not vegetation since the last one that was.
// So the wave carries its own green out of the verge and over a gap (the
// road, a wall, a strip of sky) but never drags a long tail of sky behind it.
export const EXIT = 0.15;
// Sort key: greenness in a few tiers first, luminance within a tier. So a
// sorted run is a handful of long, even stretches (the greenest, darkest
// first, rooted where the span starts), each one hue, rather than a single
// luminance ramp whose hues flicker from pixel to pixel; and the sky and wall
// highlights, the least green, are pushed out to the run's far end.
export const GREEN_TIERS = 4;
export const VEG_RUN = 4; // green texels in a row that count as grass
export const GREEN_FULL = 32; // g over max(r, b), in 8-bit steps, that counts as fully green
export function sortKey(r, g, b) {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const green = clamp((g - Math.max(r, b)) / GREEN_FULL, 0, 1);
  const tier = GREEN_TIERS - 1 - Math.min(GREEN_TIERS - 1, Math.floor(green * GREEN_TIERS));
  // Stays in 0..1 for 16-bit storage.
  return (tier + clamp(l, 0, 0.999)) / GREEN_TIERS;
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
// The picture is cut into horizontal bands 8-14 grid px tall (about 6-12
// device px at the usual print size), each height from a hash. A band is
// sorted once, along its centre row, and that one sorted row is written down
// the band's full height: every run is a solid rectangle with hard ends.
export const BAND_MIN = 8;
export const BAND_MAX = 14;
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

// Curl map, grid px <-> (arc length u, radius r): straight along the verge
// left of the centre C, round C as concentric arcs, back over the top.
export function fwd(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  if (dx < 0) return dy >= 0 ? [dx, dy] : [Math.PI * -dy - dx, -dy];
  const r = Math.hypot(dx, dy);
  return [r * Math.atan2(dx, dy), r];
}
export function inv(u, r) {
  if (u < 0) return [CX + u, CY + r];
  const arc = Math.PI * r;
  if (u <= arc) {
    const th = u / Math.max(r, 1e-6);
    return [CX + r * Math.sin(th), CY + r * Math.cos(th)];
  }
  return [CX - (u - arc), CY - r];
}

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

// The resting wave: a broad region that enters low along the verge, rides up
// round the curl and breaks over the sky, thinning into fragments at its
// crest. Drawn on the 1200x800 layout sheet.
export function demoMask(amount) {
  const m = new Float32Array(MW * MH);
  const R0 = 90;
  const R1 = 330;
  const cx0 = CX / S;
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const x = ((cx + 0.5) * CELL) / S;
      const y = ((cy + 0.5) * CELL) / S;
      const [u0, r0] = fwd(x * S, y * S);
      const u = u0 / S;
      const r = r0 / S;
      const t = (r - R0) / (R1 - R0);
      const n = vnoise(x / 90, y / 90) - 0.5;
      // Start at the left edge of the verge; finish over the crest, inner lines curling furthest.
      const start = -cx0 - 40 + n * 120;
      const thEnd = Math.PI * (1.08 - 0.5 * t) + n * 0.4;
      const end = r * thEnd + (1 - t) * 260;
      if (t < -0.1 || t > 1.1 || u < start - 30 || u > end + 60) continue;
      const across = Math.min(smooth(-0.1, 0.08, t + n * 0.1), smooth(1.1, 0.9, t + n * 0.14));
      const fromStart = smooth(start - 30, start + 40, u);
      const toEnd = smooth(end + 60, end - r * 0.5, u);
      const v = across * fromStart * (0.6 + 0.4 * toEnd);
      m[cy * MW + cx] = clamp(v * amount, 0, 1);
    }
  }
  return m;
}

// Green: the vegetation that a span may start from.
const isVeg = (r, g, b) => g > r + 6 && g > b + 12;

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
    }
  }
  return { lum16, key: key16, depth, reachQ };
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
// The wave is made by moving whole slabs, never by bending the sort. Every
// band is cut into blocks along x (16-48 px, from a hash, so the cuts never
// line up from band to band); each block of the region is a rigid
// horizontal rectangle that shows a band lower down (a whole-pixel lift) a
// whole number of px along (a shift). The lift and shift follow the curl:
// the block's place on the curl is read off the curl map, and its source is
// that same place unrolled flat onto the verge, scaled by how far the wave
// has been pushed there (the mask). So at the verge, where the curl is flat,
// both are zero; up the face they rise block by block toward the crest, and
// the region becomes a staircase of stacked slabs that climbs and curls. Cut
// at the envelope (the mask), it replaces the photo beneath it outright.
//
// geo, per display texel (x, band d), four u16: source x + 1 (0 = the photo,
// untouched), source band, glint run end + 1 (0 = none), glint band.
export const WAVE_ON = 0.12; // the envelope: mask level where a block joins the wave
export const MIN_RUN = 20; // shorter runs are left out of the lifted slabs
// The curl's slabs show the verge bands between these rows (the green), by
// radius: the inner edge of the curl shows the top of the verge.
export const VERGE0 = 1000;
export const VERGE1 = 1400;
export const CURL_R0 = 90 * S;
export const CURL_R1 = 330 * S;
export const GLINT_LUM = 0.68; // a run's tail this bright breaks off as a tile...
export const GLINT_PEAK = 0.76; // ...when its brightest pixel reads as a highlight
export const GLINT_MAX = 64; // longest glint tile, px
export const blockOf = (() => {
  // Per band, the block start for every x: brick-like cuts.
  const starts = new Uint16Array(DW * DH);
  for (let d = 0; d < DH; d++) {
    let x = -Math.floor(hash(d, 5) * 48);
    let b = 0;
    while (x < DW) {
      const w = 16 + Math.floor(hash(d * 131 + b, 9) * 33);
      for (let k = Math.max(0, x); k < Math.min(DW, x + w); k++) starts[d * DW + k] = Math.max(0, x);
      x += w;
      b++;
    }
  }
  return starts;
})();
const blockEnd = (d, x) => {
  let e = x;
  while (e < DW && blockOf[d * DW + e] === blockOf[d * DW + x]) e++;
  return e;
};

export function geometry(mask8, base, link, geo = new Uint16Array(DW * DH * 4)) {
  geo.fill(0);
  const B = BANDS;
  const r = runs(link);
  // Each band's runs long enough to read as a strip, right to left, as
  // [x0, x1) pairs.
  const byBand = Array.from({ length: DH }, () => []);
  for (let n = r.length - 3; n >= 0; n -= 3) if (r[n + 2] - r[n + 1] >= MIN_RUN) byBand[r[n]].push(r[n + 1], r[n + 2]);
  const on = new Uint8Array(DW);
  for (let d = 0; d < DH; d++) {
    const yc = B.c[d] + 0.5;
    const row = d * DW;
    // The band's cut: its blocks inside the envelope.
    on.fill(0);
    for (let x = 0; x < DW; ) {
      const x1 = blockEnd(d, x);
      if (maskAt(mask8, (x + x1) / 2, yc) >= WAVE_ON) on.fill(1, x, x1);
      x = x1;
    }
    // Each stretch of the cut is a slab; below the curl centre the verge
    // part (left of it) and the face (right of it) are separate slabs, split
    // at a block cut near the centre so the face's inner edge steps too.
    let split = blockOf[row + clamp(Math.round(CX + (hash(d, 23) - 0.5) * 120), 0, DW - 1)];
    if (split === 0) split = CX;
    // Just above the centre, inside the curl's hollow, the rows still count
    // as verge: the lip's underside steps instead of cutting straight.
    const low = yc >= CY || CY - yc < CURL_R0 * (0.55 + 0.45 * hash(d, 29));
    for (let x = 0; x < DW; ) {
      if (!on[x]) {
        x++;
        continue;
      }
      const x0 = x;
      const verge = low && x0 < split;
      while (x < DW && on[x] && (!low || x < split === verge)) x++;
      const x1 = x;
      if (verge) {
        // At the verge the sorted runs stay in place, and everything else
        // (a pole, a sign) is left untouched.
        for (let k = x0; k < x1; k++) {
          if (link[row + k] || (k > 0 && link[row + k - 1])) {
            geo[(row + k) * 4] = k + 1;
            geo[(row + k) * 4 + 1] = d;
          }
        }
        continue;
      }
      // Up the curl: the slab's place on the curl (its radius) picks the
      // verge band it shows, the curl folded flat onto the green rows, and
      // the lift to it grows with how hard the brush has pushed the wave.
      const xm = (x0 + x1) / 2;
      const [, rr] = fwd(xm, yc);
      const a = smooth(WAVE_ON, 0.9, maskAt(mask8, xm, yc));
      const t = clamp((rr - CURL_R0) / (CURL_R1 - CURL_R0), 0, 1);
      const ty = VERGE0 + t * (VERGE1 - VERGE0);
      const lift = Math.round((ty - yc) * a);
      const s0 = B.of[clamp(Math.round(yc + lift), 0, GH - 1)];
      // The slab fills from its outer (right) cut inward with that band's
      // runs laid end to end, each a whole-pixel shift of itself: the gaps
      // between them (the poles) drop out and the slab is solid sorted
      // colour from cut to cut. When that band's runs are used up, the next
      // band down carries on.
      let s = s0;
      let list = byBand[s];
      // Most slabs start on their source's last run, its bright tail out at
      // the face; the rest skip in a run or two so the run ends never stack
      // into columns.
      let ri = Math.min(list.length, 2 * Math.floor(hash(d, x0) * hash(d, 3) * 3));
      let xs = ri < list.length ? list[ri + 1] : 0;
      for (let k = x1 - 1; k >= x0; k--) {
        while (ri >= list.length || xs <= list[ri]) {
          if (ri < list.length) {
            ri += 2;
            if (ri < list.length) xs = list[ri + 1];
            continue;
          }
          if (s + 1 >= DH || s - s0 >= 6) break;
          s++;
          list = byBand[s];
          ri = 0;
          xs = list.length ? list[1] : 0;
        }
        if (ri >= list.length) break;
        xs--;
        geo[(row + k) * 4] = xs + 1;
        geo[(row + k) * 4 + 1] = s;
      }
    }
  }
  // Glints: where a run ends in bright pixels, that tail breaks off as one
  // solid tile the colour of the run's brightest end, one or two bands tall.
  // The sort puts a run's brightest, least green pixels last, so the tail is
  // as long as the run has bright pixels.
  const tail = new Int32Array(DW * DH).fill(-1); // run end x, per band texel in a tail
  const lum = base.lum16;
  const lim = Math.round(GLINT_LUM * 65535);
  for (let n = 0; n < r.length; n += 3) {
    const row = r[n] * DW;
    const x0 = r[n + 1];
    const x1 = r[n + 2];
    let c = 0;
    let peak = 0;
    for (let x = x0; x < x1; x++) {
      const l = lum[row + x];
      if (l >= lim) c++;
      if (l > peak) peak = l;
    }
    if (peak < GLINT_PEAK * 65535) continue;
    c = Math.min(c, GLINT_MAX, x1 - x0 - 1);
    if (c < 4) continue;
    // Block-quantised, so the tile's hard edge reads as a cut.
    c = Math.max(4, (c >> 2) << 2);
    for (let x = x1 - c; x < x1; x++) tail[row + x] = x1 - 1;
  }
  for (let d = 0; d < DH; d++) {
    for (let x = 0; x < DW; x++) {
      const o = (d * DW + x) * 4;
      if (!geo[o]) continue;
      const s = geo[o + 1];
      const xs = geo[o] - 1;
      const e = tail[s * DW + xs];
      if (e < 0) continue;
      geo[o + 2] = e + 1;
      geo[o + 3] = s;
      // Taller tiles reach up into the band above.
      if (d > 0 && hash(s, e) < 0.5) {
        const p = ((d - 1) * DW + x) * 4;
        if (geo[p]) {
          geo[p + 2] = e + 1;
          geo[p + 3] = s;
        }
      }
    }
  }
  return geo;
}
