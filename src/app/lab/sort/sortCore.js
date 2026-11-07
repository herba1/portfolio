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
// The wave is made by moving whole sorted rows, never by bending the sort.
// At the verge the sorted runs stay where they were sorted, and everything
// else (a pole, a sign) is left untouched. Up the curl the picture is cut
// into its own horizontal stripes, thick at the verge and thinning toward
// the crest (the face recedes, so its rows foreshorten), with a few hairlines
// among them. Each stripe is lifted whole: across the envelope (the mask) it
// shows one long sorted run from a verge band, picked by the stripe's radius
// on the curl, stretched from cut to cut with its gradient kept, so every
// strip ramps from the darkest green at its root to the run's bright tail at
// the wave's edge. The further the brush has pushed the envelope, the longer
// the stripes and the further their runs are stretched. A handful of the
// brightest tails near the crest break off as glint tiles.
export const WAVE_ON = 0.12; // the envelope: mask level where the wave begins
// The curl's stripes show the verge bands between these rows (the green), by
// radius: the inner edge of the curl shows the top of the verge.
export const VERGE0 = 1000;
export const VERGE1 = 1400;
export const CURL_R0 = 90 * S;
export const CURL_R1 = 330 * S;
export const CREST_Y = CY - CURL_R1; // the top of the curl, grid px
export const RUN_MIN = 48; // shorter verge runs are never lifted
export const GLINT_LUM = 0.68; // a run's tail this bright...
export const GLINT_PEAK = 0.8; // ...ending in a highlight this bright can break off
export const GLINTS = 10; // glint tiles at most
// Stripe height, grid px, from the verge (near) to the crest (far).
export const STRIPE_NEAR = 14;
export const STRIPE_FAR = 2.5;
export const STRIPES = (() => {
  // Cut from the bottom up, so the thick rows sit on the verge.
  const y0 = [];
  const h = [];
  let y = GH;
  for (let j = 0; y > 0; j++) {
    const p = clamp((y - CREST_Y) / (GH - CREST_Y), 0, 1);
    let hh = (STRIPE_FAR + (STRIPE_NEAR - STRIPE_FAR) * p ** 1.4) * (0.7 + 0.6 * hash(j, 41));
    // A few hairlines among them, at every height.
    if (hash(j, 43) < 0.13) hh = 1 + Math.floor(hash(j, 47) * 2);
    hh = Math.min(y, Math.max(1, Math.round(hh)));
    y -= hh;
    y0.push(y);
    h.push(hh);
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
export const NS = STRIPES.n;
// Each stripe holds up to PARTS lifted runs, two RGBA16UI texels each, in a
// texture NS wide and 2 x PARTS tall: (a, b, source band + 1, reversed) for
// the stripe's cut [a, b) and (x0, x1, 0, 0) for the run [x0, x1) shown there.
export const PARTS = 4;

// Below the curl centre (and a ragged few rows above it) a band is verge left
// of its split: there the runs stay in place.
const vergeLow = (d) => BANDS.c[d] + 0.5 >= CY - CURL_R0 * 0.25 * hash(d, 29);
const vergeSplit = (d) => CX + (hash(d, 23) - 0.5) * 120;

export function geometry(mask8, base, link, out = {}) {
  const geo = out.geo || new Uint16Array(DW * DH * 2);
  const table = out.table || new Uint16Array(NS * 2 * PARTS * 4);
  const glints = out.glints || new Float32Array(GLINTS * 8);
  geo.fill(0);
  table.fill(0);
  glints.fill(0);
  const B = BANDS;
  const r = runs(link);

  // The verge: sorted runs in place, inside the envelope.
  const mrow = new Float32Array(GW);
  for (let d = 0; d < DH; d++) {
    if (!vergeLow(d)) continue;
    const row = d * DW;
    const split = Math.min(DW, Math.round(vergeSplit(d)));
    maskRow(mask8, B.c[d] + 0.5, mrow);
    for (let k = 0; k < split; k++) {
      if (!(link[row + k] || (k > 0 && link[row + k - 1]))) continue;
      if (mrow[k] < WAVE_ON) continue;
      geo[(row + k) * 2] = k + 1;
      geo[(row + k) * 2 + 1] = d;
    }
  }

  // The runs that may be lifted: long verge runs, by band.
  const lum = base.lum16;
  const cand = [];
  for (let n = 0; n < r.length; n += 3) {
    const d = r[n];
    const x0 = r[n + 1];
    const x1 = r[n + 2];
    if (B.c[d] < VERGE0 || x1 - x0 < RUN_MIN || x0 > CX) continue;
    cand.push({ d, x0, x1, y: B.c[d] });
  }
  if (!cand.length) return { geo, table, glints, glintN: 0 };
  cand.sort((p, q) => q.x1 - q.x0 - (p.x1 - p.x0));
  const pick = (ty, len, seed) => {
    // Runs near the target row; the longer, the likelier, never stretched
    // past four times its length where a longer one is near.
    let near = cand.filter((c) => Math.abs(c.y - ty) < 70);
    if (near.length < 3) near = cand.filter((c) => Math.abs(c.y - ty) < 220);
    if (!near.length) near = cand;
    const fit = near.filter((c) => (c.x1 - c.x0) * 4 >= len);
    const pool = (fit.length >= 2 ? fit : near).slice(0, 6);
    return pool[Math.floor(seed * seed * pool.length)];
  };

  // The curl: per stripe, its cut through the envelope, less the verge.
  const tails = [];
  const on = new Uint8Array(DW);
  for (let s = 0; s < NS; s++) {
    const y = STRIPES.c[s] + 0.5;
    const d = B.of[STRIPES.c[s]];
    const low = vergeLow(d);
    const split = low ? Math.round(vergeSplit(d)) : 0;
    on.fill(0);
    maskRow(mask8, y, mrow);
    for (let x = split; x < DW; x++) on[x] = mrow[x] >= WAVE_ON ? 1 : 0;
    const parts = [];
    for (let x = 0; x < DW; ) {
      if (!on[x]) {
        x++;
        continue;
      }
      const a = x;
      while (x < DW && on[x]) x++;
      const b = x;
      if (b - a < 6) continue;
      // Over the top the stripe roots near the curl's axis: its left half
      // runs out to the lip, its right half out to the back of the wave.
      const xs = Math.round(CX + (hash(s, 51) - 0.5) * 200);
      if (a + 24 < xs && xs < b - 24) {
        parts.push([a, xs, 1], [xs, b, 0]);
      } else parts.push([a, b, (a + b) / 2 < CX ? 1 : 0]);
    }
    // Blades of different lengths: each tail stops short of the envelope by
    // a hashed amount, more toward the crest, so the wave's edge is combed.
    const far = 1 - clamp((y - CREST_Y) / (GH - CREST_Y), 0, 1);
    for (let i = 0; i < Math.min(PARTS, parts.length); i++) {
      let [a, b, rev] = parts[i];
      const jag = Math.round(hash(s, 57 + i) ** 2 * (30 + 260 * far) * Math.min(1, (b - a) / 300));
      if (rev) a += jag;
      else b -= jag;
      if (b - a < 6) continue;
      const [, rr] = fwd((a + b) / 2, y);
      const t = clamp((rr - CURL_R0) / (CURL_R1 - CURL_R0), 0, 1);
      const c = pick(VERGE0 + t * (VERGE1 - VERGE0), b - a, hash(s * 7 + i, 53));
      const o = (s + i * 2 * NS) * 4;
      table[o] = a;
      table[o + 1] = b;
      table[o + 2] = c.d + 1;
      table[o + 3] = rev;
      table[o + NS * 4] = c.x0;
      table[o + NS * 4 + 1] = c.x1;
      // A bright tail out at the crest may break off as a glint.
      if (y < CY - CURL_R0) {
        const row = c.d * DW;
        let peak = 0;
        let n = 0;
        // The sort puts the run's brightest pixels last: its tail is as long
        // as the run has bright pixels.
        for (let x = c.x0; x < c.x1; x++) {
          if (lum[row + x] >= GLINT_LUM * 65535) n++;
          if (lum[row + x] > peak) peak = lum[row + x];
        }
        if (peak >= GLINT_PEAK * 65535 && n >= 2) tails.push({ s, a, b, rev, c, n, y, w: hash(s, 61 + i) });
      }
    }
  }

  // Glints: a handful of the bright tails, the highest first, spaced apart.
  tails.sort((p, q) => p.y - q.y + (p.w - q.w) * 60);
  let gn = 0;
  const taken = [];
  for (const g of tails) {
    if (gn >= GLINTS) break;
    const end = g.rev ? g.a : g.b;
    if (taken.some(([x, y]) => Math.abs(x - end) < 90 && Math.abs(y - g.y) < 40)) continue;
    taken.push([end, g.y]);
    const w = Math.round(clamp(g.n * ((g.b - g.a) / (g.c.x1 - g.c.x0)), 14, 56));
    const gap = 3 + Math.floor(hash(g.s, 67) * 8);
    const tall = 8 + Math.floor(hash(g.s, 71) * 10);
    const x0 = g.rev ? end - gap - w : end + gap;
    const y1 = STRIPES.y0[g.s] + STRIPES.h[g.s];
    const o = gn * 8;
    glints[o] = x0;
    glints[o + 1] = y1 - tall;
    glints[o + 2] = x0 + w;
    glints[o + 3] = y1;
    glints[o + 4] = g.c.x1 - 1;
    glints[o + 5] = g.c.d;
    gn++;
  }
  return { geo, table, glints, glintN: gn };
}
