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
export const EXIT = 0.3;
// Sort key: luminance, pulled down by greenness. So a sorted run is one
// long ramp from its darkest, greenest pixels (rooted where the span starts)
// to its brightest, least green ones (the sky and wall highlights) out at its
// far end, rather than a scatter of hues.
export const GREEN_PULL = 0.5;
export const VEG_RUN = 4; // green texels in a row that count as grass
export const GREEN_FULL = 32; // g over max(r, b), in 8-bit steps, that counts as fully green
export function sortKey(r, g, b) {
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const green = clamp((g - Math.max(r, b)) / GREEN_FULL, 0, 1);
  // Stays in 0..1 for 16-bit storage.
  return clamp(l * (1 - GREEN_PULL) + (1 - green) * GREEN_PULL, 0, 1);
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

// ---- the sheet's light
// The wave is lit as a surface, and the light comes from the sort order: a
// stripe's facing (0 = tucked under the overhang, 1 = turned full to the sky)
// picks which stretch of its sorted run it shows. The sheet is the stack of
// layers the resting mask draws: sheetT is the depth through it, 0 on the
// inner face (the hollow, the underside of the hook) and 1 on the outer face,
// with the same droop over the lip. Its gradient is the outer face's normal.
export const SHEET_R0 = 90; // layout units, as demoMask
export const SHEET_R1 = 330;
export const SHEET_DROOP = 900;
// Light from the sky, over the back of the wave (grid axes, y down).
export const LIGHT_X = 0.42;
export const LIGHT_Y = -0.907;
// The inner face sees the light only past the overhang: this much of it.
export const FACE_INNER = 0.4;
// Nearer the crest the sheet sees more sky.
export const FACE_HIGH = 0.16;
export function sheetT(x, y) {
  const [u, r] = fwd(x, y);
  const over = Math.max(0, u - Math.PI * r) / S;
  return (r / S + (over * over) / SHEET_DROOP - SHEET_R0) / (SHEET_R1 - SHEET_R0);
}
export function facing(x, y) {
  const e = 6;
  const t = sheetT(x, y);
  const gx = sheetT(x + e, y) - sheetT(x - e, y);
  const gy = sheetT(x, y + e) - sheetT(x, y - e);
  const n = Math.hypot(gx, gy) || 1e-6;
  const d = (gx * LIGHT_X + gy * LIGHT_Y) / n;
  const outer = 0.5 + 0.5 * d;
  const inner = (0.5 - 0.5 * d) * FACE_INNER;
  const w = smooth(-0.2, 0.75, t);
  const high = clamp((CY - y) / (330 * S), 0, 1);
  return clamp(inner + (outer - inner) * w + FACE_HIGH * (high - 0.3), 0, 1);
}
// Which stretch of its sorted run a stripe shows, as fractions of the run
// from its dark green head to its brightest tail, by facing f: the underside
// reads only the head, the lit face reads the run's last stretch, where its
// few white-gold pixels sit, and lingers there, so it blooms.
export const FACE_LO = 0.82; // window start at f = 1 (0 at f = 0)
export const FACE_HI0 = 0.15; // window end at f = 0 (1 from f = FACE_FULL)
export const FACE_FULL = 0.8;
export function faceRead(f, s) {
  const lo = FACE_LO * f ** 1.5;
  const hi = FACE_HI0 + (1 - FACE_HI0) * smooth(0, FACE_FULL, f);
  return lo + (hi - lo) * (1 - (1 - s) ** (1 + 1.5 * f));
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
      // Over the top the lines droop as they run out, so the lip arches
      // and hooks down over the crossing instead of ending in a flat shelf.
      const over = Math.max(0, u - Math.PI * r);
      const t = (r + (over * over) / 900 - R0) / (R1 - R0);
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
  return { lum16, key: key16, depth, reachQ, veg };
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
// The curl is a stack of layers, and every layer is one of the verge's own
// bands: below the curl centre a layer is the band's own row, straight along
// the verge; right of the centre it bends round as an arc about it; over the
// top it runs back and droops, so the lip hooks down. So each band's sorted
// run, rooted where its grass starts, is carried rightward along its own row
// and only then bends up into the hook: the verge peels into the wave.
//
// Every pixel of the wave is a stripe with hard ends: a band is split into
// two or three sub-strips, each showing the band's sorted run stretched from
// its root to its tail, each by its own stretch and with its own tail length,
// so they come apart as they rise. Up the curl the face recedes and the
// bands foreshorten: a 1-2 px gap of the photo opens between them. A
// strip's length follows its run's length, so the lip and the back of the
// wave are combed by the runs, not cut by the mask. Left of a strip's root
// the band stays sorted in place; some sub-strips slide off their root, so
// the source is left a sorted, partly evacuated band.
//
// The stripe's facing (see facing()) picks the stretch of its run the
// shader reads, per position along the strip (never across it, so a strip
// stays one colour across its height); a handful of bright tails where the
// facing peaks over the top break off as glint tiles.
export const WAVE_ON = 0.12; // the envelope: mask level where the wave begins
export const RUN_MIN = 48; // shorter verge runs are never lifted
export const GLINT_LUM = 0.68; // a run's tail this bright...
export const GLINT_PEAK = 0.8; // ...ending in a highlight this bright can break off
export const GLINTS = 10; // glint tiles at most
export const GLINT_FACE = 0.62; // only where the sheet faces the light this fully
// A layer over the top sinks by over^2 / DROOP_G (grid px), as sheetT.
export const DROOP_G = SHEET_DROOP * S;
// Along-layer coordinates are stored offset by this, as unsigned.
export const UOFF = 8192;
// The gap that opens between sub-strips, grid px, as the face recedes.
export const GAP = 2;
// Each band holds up to PARTS sub-strips, two RGBA16UI texels each, in a
// texture DH wide and 2 x PARTS tall: (uA + UOFF, uB + UOFF, source band + 1,
// q0 | q1 << 5 | outermost << 10) for the sub-strip's span along its layer and its rows within
// the band, and (x0, x1, 0, 0) for the sorted run it shows.
export const PARTS = 8;

// A point of layer rho (its verge row is CY + rho) at distance u along it
// from the curl's foot (negative on the verge). The shader inverts this per
// pixel, measuring u at the strip's centre layer so its pixel blocks run
// straight across it.
export function layerPoint(u, rho) {
  if (u < 0) return [CX + u, CY + rho];
  const arc = Math.PI * rho;
  if (u <= arc) {
    const th = u / Math.max(rho, 1e-6);
    return [CX + rho * Math.sin(th), CY + rho * Math.cos(th)];
  }
  const over = u - arc;
  return [CX - over, CY - (rho - (over * over) / DROOP_G)];
}

// Below the curl centre (and a ragged few rows above it) a band is verge left
// of its split: there the runs stay in place.
export const CURL_R0 = 90 * S;
const vergeLow = (d) => BANDS.c[d] + 0.5 >= CY - CURL_R0 * 0.25 * hash(d, 29);
const vergeSplit = (d) => CX + (hash(d, 23) - 0.5) * 120;
// A root run may start this far right of the curl's foot, and a strip
// starts no further left than ROOT_X, right of the crossing's poles.
const ROOT_PAST = 100;
const ROOT_X = 712;
// A verge run in place slides toward the curl by up to this much of itself.
const SLIDE = 0.3;
// A root run must be this much grass to carry its own pixels up the curl.
const VEG_MIN = 0.45;

export function geometry(mask8, base, link, out = {}) {
  const geo = out.geo || new Uint16Array(DW * DH * 2);
  const table = out.table || new Uint16Array(DH * 2 * PARTS * 4);
  const glints = out.glints || new Float32Array(GLINTS * 8);
  geo.fill(0);
  table.fill(0);
  glints.fill(0);
  const B = BANDS;
  const r = runs(link);
  const byBand = Array.from({ length: DH }, () => []);
  for (let n = 0; n < r.length; n += 3) byBand[r[n]].push([r[n + 1], r[n + 2]]);

  // The verge: sorted runs in place, inside the envelope, each slid a
  // hashed way toward the curl. The pixels pushed past its end have gone
  // into the wave; the photo shows at its root, where they left from.
  const mrow = new Float32Array(GW);
  for (let d = 0; d < DH; d++) {
    if (!vergeLow(d)) continue;
    const row = d * DW;
    const split = Math.min(DW, Math.round(vergeSplit(d)));
    maskRow(mask8, B.c[d] + 0.5, mrow);
    for (const [x0, x1] of byBand[d]) {
      if (x0 >= split) continue;
      const slide = Math.round((x1 - x0) * SLIDE * hash(d * 131 + x0, 93) ** 1.3 * (B.y0[d] >= CY ? 1 : 0.3));
      for (let k = x0 + slide; k < Math.min(x1, split); k++) {
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
  // Each verge band's layer: where the envelope lies along it, and the run
  // rooted on it.
  const STEP = 4;
  const layers = [];
  for (let d = 0; d < DH; d++) {
    if (B.y0[d] < CY) continue;
    const rho = B.c[d] + 0.5 - CY;
    const segs = [];
    let ua = null;
    const uMax = Math.PI * rho + CX;
    for (let u = -CX; u <= uMax; u += STEP) {
      const [x, y] = layerPoint(u, rho);
      const past = u > Math.PI * rho && y > CY; // drooped back down past the centre
      const on = !past && x >= 0 && x < GW && y >= 0 && y < GH && maskAt(mask8, x, y) >= WAVE_ON;
      if (on && ua === null) ua = u;
      if (!on && ua !== null) {
        segs.push([ua, u]);
        ua = null;
      }
      if (past) break;
    }
    if (ua !== null) segs.push([ua, uMax]);
    if (!segs.length) continue;
    // The root: the rightmost long run starting on the verge (or just past
    // the foot) inside the envelope. Its grass is what peels up the curl.
    let root = null;
    let longest = null;
    for (const [x0, x1] of byBand[d]) {
      if (x1 - x0 < RUN_MIN || x0 > CX + ROOT_PAST) continue;
      if (vegOf(d, x0, x1) >= VEG_MIN && (!longest || x1 - x0 > longest[1] - longest[0])) longest = [x0, x1];
      const seg = segs.find(([a, b]) => x0 - CX >= a - STEP && x0 - CX < b);
      if (seg && (!root || x1 > root.x1)) root = { x0, x1, seg };
    }
    layers.push({ d, rho, segs, root, longest });
  }
  // Strip length follows run length: a run this long reaches the envelope's end.
  const lens = layers.filter((l) => l.root).map((l) => l.root.x1 - l.root.x0);
  lens.sort((a, b) => a - b);
  const lFull = lens.length ? lens[Math.floor(lens.length * 0.85)] : 1;
  // Any run, for an envelope that the brush has opened away from a root.
  const anyRun = (d) => {
    for (let k = 0; k < 12; k++) {
      for (const dd of [d - k, d + k]) {
        if (dd < 0 || dd >= DH) continue;
        let best = null;
        for (const [x0, x1] of byBand[dd]) if (x1 - x0 >= RUN_MIN && (!best || x1 - x0 > best[2] - best[1])) best = [dd, x0, x1];
        if (best) return best;
      }
    }
    return null;
  };

  const lum = base.lum16;
  const tails = [];
  for (const L of layers) {
    const { d, root } = L;
    const h = B.h[d];
    // The band's sub-strips: two or three, cut at hashed rows.
    const cuts = [0];
    if (h >= 12) cuts.push(Math.round(h * (0.24 + 0.14 * hash(d, 81))), Math.round(h * (0.58 + 0.16 * hash(d, 83))));
    else cuts.push(Math.round(h * (0.36 + 0.28 * hash(d, 81))));
    cuts.push(h);
    let part = 0;
    for (const seg of L.segs) {
      const rooted = root && root.seg === seg;
      let src;
      let u0;
      if (rooted) {
        // A short root run, or one that is mostly road, carries the row's
        // longest grass instead.
        const len = root.x1 - root.x0;
        const own = len >= 200 && vegOf(d, root.x0, root.x1) >= VEG_MIN;
        src = !own && L.longest && L.longest[1] - L.longest[0] > len ? [d, ...L.longest] : [d, root.x0, root.x1];
        // A strip never rises from beyond the last pole before the foot.
        u0 = Math.max(root.x0, ROOT_X) - CX;
      } else {
        // Away from a root (where the brush has opened the envelope up the
        // curl), the strip shows the nearest long run; the verge itself
        // stays sorted in place.
        src = anyRun(d);
        u0 = Math.max(0, seg[0]);
        if (seg[1] - u0 < 140) continue;
      }
      if (!src) continue;
      const len = src[2] - src[1];
      const room = seg[1] - u0;
      if (room < 12) continue;
      for (let k = 0; k + 1 < cuts.length && part < PARTS; k++) {
        const q0 = cuts[k];
        const q1 = cuts[k + 1];
        if (q1 <= q0) continue;
        const hk = hash(d * 5 + k, 87);
        // Some sub-strips slide off their root: the sorted band they leave
        // shows behind them.
        const slide = rooted && hash(d * 5 + k, 89) < 0.45 ? Math.round(hash(d * 5 + k, 91) ** 1.5 * 0.35 * Math.min(len, CX - (u0 + CX) + 40)) : 0;
        const uA = u0 + Math.max(0, slide);
        const frac = (0.66 + 0.34 * clamp(Math.sqrt(Math.min(len, root ? root.x1 - root.x0 : len) / lFull), 0, 1)) * (0.86 + 0.14 * hk);
        const uB = Math.round(Math.min(seg[1], uA + (seg[1] - uA) * (rooted ? frac : 0.75 + 0.25 * hk)));
        if (uB - uA < 8) continue;
        const o = (d + part * 2 * DH) * 4;
        table[o] = Math.round(uA) + UOFF;
        table[o + 1] = uB + UOFF;
        table[o + 2] = src[0] + 1;
        // The band's outermost sub-strip carries the gap (flag 1 << 10).
        table[o + 3] = q0 | (q1 << 5) | (q1 === h ? 1024 : 0);
        table[o + DH * 4] = src[1];
        table[o + DH * 4 + 1] = src[2];
        part++;
        // A bright tail over the top, where the sheet faces the light, may
        // break off as a glint.
        const rc = B.y0[d] + (q0 + q1) / 2 - CY;
        if (uB < Math.PI * rc * 0.8) continue;
        const [tx, ty] = layerPoint(uB, rc);
        const fe = facing(tx, ty);
        if (fe < GLINT_FACE) continue;
        const row = src[0] * DW;
        let peak = 0;
        let n = 0;
        for (let x = src[1]; x < src[2]; x++) {
          if (lum[row + x] >= GLINT_LUM * 65535) n++;
          if (lum[row + x] > peak) peak = lum[row + x];
        }
        if (peak >= GLINT_PEAK * 65535 && n >= 2) tails.push({ tx, ty, th: Math.max(2, q1 - q0 - (q1 === h ? GAP : 0)), src, n, fe, w: hash(d, 61 + k), stretch: (uB - uA) / len });
      }
    }
  }

  // Glints: a handful of the bright tails where the facing peaks, spaced
  // apart. Each is the strip's own end carried on a little past it, leftward
  // as the strip runs over the top, as tall as the strip.
  tails.sort((p, q) => q.fe - p.fe + (q.w - p.w) * 0.08);
  let gn = 0;
  const taken = [];
  for (const g of tails) {
    if (gn >= GLINTS) break;
    if (taken.some(([x, y]) => Math.abs(x - g.tx) < 90 && Math.abs(y - g.ty) < 40)) continue;
    taken.push([g.tx, g.ty]);
    const w = Math.round(clamp(g.n * g.stretch, 10, 40));
    const lap = 4;
    const o = gn * 8;
    glints[o] = Math.round(g.tx) - w;
    glints[o + 1] = Math.round(g.ty - g.th / 2);
    glints[o + 2] = Math.round(g.tx) + lap;
    glints[o + 3] = Math.round(g.ty - g.th / 2) + g.th;
    glints[o + 4] = g.src[2] - 1;
    glints[o + 5] = g.src[0];
    gn++;
  }
  return { geo, table, glints, glintN: gn };
}
