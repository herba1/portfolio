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
// The sort domain: one texel per grid column, one row per band, and below
// them one more row per source band (SRC, after the stack's constants).
export const DW = GW;

// ---- the stack
// The wave is a staircase of straight strips, after herb's reference 2:
// every strip is one band's sorted run, a hard-edged horizontal rectangle at
// its own row, never bent. The rise comes only from stacking. The verge
// (ZONE_TOP..ZONE_BOT) is the root, a graded zone the stack grows out of:
// short runs sorted in place inside whole grass at its foot, longer and more
// of them up it, with lifted strips starting out of each row's own grass;
// above it every row is a layer of the stack, and each layer shows a
// verge band's run lifted up to it, both its ends stepped right as the
// square of its height, so the stack leans over as it climbs. Over the top the crest
// runs on to the right and a lip of shorter strips hangs down from its end,
// so the staircase reads as a blade of grass peeling up and curling over.
// The crossing (the road and the rails, right of centre) stays clear.
export const VERGE_TOP = 1236; // grid rows below this are the verge, the stack's root
export const VERGE_BOT = 1470; // ...down to here (the rails start below)
// The root is not a slab: the verge is a graded zone the stack grows out of.
// At ZONE_BOT (the grass just above the rails) the photo stays whole, with
// only short runs sorted in place along its grass; moving up, the runs grow
// longer and more of each band is sorted, and lifted strips start out of the
// grass where each row's own grass starts, until at ZONE_TOP the rows join
// the stack. Below ZONE_BOT the rails and the foreground stay photo.
export const ZONE_TOP = VERGE_TOP;
export const ZONE_BOT = 1430;
export const zoneZ = (y) => clamp((ZONE_BOT - y) / (ZONE_BOT - ZONE_TOP), 0, 1);
// The stack's rows read their runs from the zone's grass bands; each source
// band is sorted again, whole, on a row of its own below the bands, so the
// in-place runs on the zone can stay short while the stack's runs are long.
export const SRC = (() => {
  const s = [];
  for (let j = 0; j < BANDS.n; j++) if (BANDS.c[j] >= ZONE_TOP && BANDS.c[j] <= ZONE_BOT) s.push(j);
  return Uint16Array.from(s);
})();
export const DH = BANDS.n + SRC.length;
// The grid row each domain row is read off (a band's centre row).
export const DOMAIN_C = (() => {
  const c = new Uint16Array(DH);
  c.set(BANDS.c, 0);
  for (let i = 0; i < SRC.length; i++) c[BANDS.n + i] = BANDS.c[SRC[i]];
  return c;
})();
export const CREST = 392; // the stack's top row
export const ROOT_X1 = 1160; // the root zone reaches across from the left to here
// Both edges of the stack step right as the square of its height, so the
// lower half rises nearly straight and the upper third leans well out past
// the face below it: the back rounds over, and the face goes concave.
export const X_ROOT = 150; // a strip's left end at the foot of the stack...
export const LEAN = 760; // ...and how far right it has stepped at the crest
export const FACE0 = 820; // a strip's reach at the foot, at full mask...
export const FACE1 = 760; // ...and how far the face has leant out at the crest
export const LEAN_POW = 2;
// The lip: how far the crest's rows may reach as they run on over the top
// and hang down. It is a reach, not an outline; each row still ends where
// its last whole run ends.
export const LIP_H = 390; // the lip hangs this far below the crest
export const WELD = 0.26; // down to here (share of LIP_H) the lip is the crest's own rows; below, it hangs free over the hollow
export const LIP_X = 1800; // its reach at its widest
export const LIP_W = 560; // its width at the crest, tapering to a point
export const LIP_TOP = 170; // the reach rounds in by this over the shoulder...
export const LIP_IN = 470; // ...and curls back in by this to the tip
export const stackT = (y) => (VERGE_TOP - y) / (VERGE_TOP - CREST);
export const stackLeft = (t) => X_ROOT + LEAN * clamp(t, 0, 1) ** LEAN_POW;
export const stackRight = (t) => FACE0 + FACE1 * clamp(t, 0, 1) ** LEAN_POW;
// The lip's reach on row y: it rounds over the shoulder and curls back in
// towards the face as it hangs, so the rows' ragged ends turn a hook. Down
// to WELD the crest's rows run on into it unbroken; below that it hangs
// free, tapering, its inner edge well clear of the face, so a hollow of
// open sky shows between them and opens downward.
const LIP_SH = 0.2; // where the outer edge is furthest out, as a share of LIP_H
export function lipSpan(y) {
  const s = (y - CREST) / LIP_H;
  if (s < 0 || s > 1) return null;
  const u = s < LIP_SH ? (LIP_SH - s) / LIP_SH : (s - LIP_SH) / (1 - LIP_SH);
  const xb = LIP_X - (s < LIP_SH ? LIP_TOP : LIP_IN) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
  return [xb - (LIP_W * (1 - s) ** 1.45 + 40), xb, s];
}
// Mask level a layer at height t needs before it lifts: the stack climbs as
// the brush works. A full mask clears the crest with room to spare, so the
// top rows run their whole reach; the lip wants a little more still.
const LIFT_TOP = 0.86;
export const liftAt = (t) => WAVE_ON + (LIFT_TOP - WAVE_ON) * clamp(t, 0, 1);
export const LIP_ON = 0.94;

// The stack's rows. The stack is not cut on the sort's bands: from the crest
// down through the verge it is cut into its own rows, mostly thin (3-10 grid
// px, 2-8 device px at DPR 2) broken by thick ones (12-29 grid px, up to 24
// device px), each height from a hash, so the sheet mixes hairlines with
// chunky blocks the way reference 2 does. Rows abut: no sky between them.
// Below VERGE_TOP the rows cross the zone, where their strips start out of
// each row's own grass, so the grass turns into the stack without a seam.
export const ROW_MIN = 3;
export const ROW_MAX = 29;
export const ROWS = (() => {
  const y0 = [];
  const h = [];
  let y = CREST;
  let thickLast = false;
  for (let j = 0; y < ZONE_BOT; j++) {
    const u = hash(j, 173);
    // The upper third, where the light reads into the tails, is where the
    // chunky blocks gather: tall rows (20-29 grid px, 16-24 device px) whose
    // blown ends stack into the crest's glowing spine.
    const up = stackT(y) > 0.7;
    const thick = !thickLast && hash(j, 179) < (up ? 0.62 : 0.2);
    const t0 = up ? 20 : 12;
    let hh = thick ? t0 + Math.floor(u * (ROW_MAX - t0 + 1)) : ROW_MIN + Math.floor(u ** 1.6 * 8);
    // No sliver at the foot: the last row takes what is left.
    if (ZONE_BOT - y - hh < ROW_MIN) hh = ZONE_BOT - y;
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

// The resting wave's mask: the zone, from the print's left edge to just
// short of the crossing, held at the amount (above it the stack covers the
// bands, so nothing there is sorted in place). The stack climbs from it as far
// as that amount lets it (liftAt), and the brush can open it anywhere else.
export function demoMask(amount) {
  const m = new Float32Array(MW * MH);
  for (let cy = 0; cy < MH; cy++) {
    for (let cx = 0; cx < MW; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const n = vnoise(x / 160, y / 160) - 0.5;
      const v = smooth(ZONE_TOP - 36, ZONE_TOP + 4, y) * smooth(ZONE_BOT + 40, ZONE_BOT - 8, y) * smooth(ROOT_X1 + 60, ROOT_X1 - 40, x + n * 160);
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
// allows (m >= reach) and until a silhouette (the edge of something the
// holdout matte keeps in front) or a depth jump. So grass is
// carried out of the verge and over the sky, and a pole or a sign, with no
// grass of its own, is never entered.
export function bake(photoPx, depthPx, holdPx) {
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
    // Only the edge of something held in front stops a span: a cabinet or
    // a sign housing the holdout dropped has the rows run on behind it.
    if (holdPx) {
      const hx = (k) => holdPx[clamp(y + dy * k * o, 0, GH - 1) * GW + clamp(x + dx * k * o, 0, GW - 1)];
      if (Math.max(hx(1), hx(2)) < 96) return 0;
    }
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
  for (let j = 0; j < BANDS.n; j++) {
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
  // The source rows: each a copy of its band, sorted whole for the stack.
  for (let i = 0; i < SRC.length; i++) {
    const a = SRC[i] * DW;
    const b = (BANDS.n + i) * DW;
    for (const arr of [lum16, key16, depth, reachQ, veg]) arr.copyWithin(b, a, a + DW);
  }
  return { lum16, key: key16, depth, reachQ, veg, win: zoneWindows(veg) };
}

// A band's grass: its stretches of vegetation, gaps of a few px bridged, as
// [x0, x1) pairs, dropping specks.
export function vegSegs(veg, d, min = 10) {
  const out = [];
  const row = d * DW;
  let s = -1;
  let gap = 0;
  for (let x = 0; x <= DW; x++) {
    const v = x < DW && veg[row + x];
    if (v) {
      if (s < 0) s = x;
      gap = 0;
    } else if (s >= 0 && (++gap > 4 || x === DW)) {
      const e = x - gap + 1;
      if (e - s >= min) out.push([s, e]);
      s = -1;
      gap = 0;
    }
  }
  return out;
}

// The windows a zone band may sort in place: win[k] is the id of the window
// texel k lies in (0: none, it stays photo), and a span never crosses from
// one window into another. Off the zone every texel is in window 1, no
// constraint. On the zone a band is cut along its own grass into windows,
// short at the zone's foot and longer up it, and only some of them open (more
// of them up the zone), so at the foot a few short runs sort in place inside
// whole grass and by the top nearly all of it is sorted in long runs.
export const ZONE_RUN = [18, 210]; // a window's length at the zone's foot and top
export const ZONE_OPEN = [0.4, 1]; // the share of windows that sort
function zoneWindows(veg) {
  const win = new Uint16Array(DW * DH).fill(1);
  let id = 2;
  for (let j = 0; j < BANDS.n; j++) {
    const c = BANDS.c[j];
    if (c < ZONE_TOP || c > ZONE_BOT + 48) continue;
    const z = zoneZ(c);
    const row = j * DW;
    win.fill(0, row, row + DW);
    const len = ZONE_RUN[0] + (ZONE_RUN[1] - ZONE_RUN[0]) * z ** 1.4;
    const open = ZONE_OPEN[0] + (ZONE_OPEN[1] - ZONE_OPEN[0]) * z;
    let n = 0;
    for (const [s0, e0] of vegSegs(veg, j, 8)) {
      let x = s0;
      while (x < e0) {
        n++;
        const w = Math.max(6, Math.round(len * (0.5 + hash(j * 977 + n, 13))));
        const x1 = Math.min(e0, x + w);
        if (hash(j * 977 + n, 17) < open) {
          win.fill(id, row + x, row + x1);
          id = id >= 65000 ? 2 : id + 1;
        }
        x = x1;
      }
    }
  }
  return win;
}

// The mask read once per band texel (on the band's centre row), 0..255.
export function bandMask(mask8, out = new Uint8Array(DW * DH)) {
  for (let j = 0; j < DH; j++) {
    const y = DOMAIN_C[j] + 0.5;
    for (let x = 0; x < DW; x++) out[j * DW + x] = Math.round(maskAt(mask8, x + 0.5, y) * 255);
  }
  return out;
}

// The links the mask opens: link[k] = 1 when texels k and k + 1 of a band
// lie in one span (both in span, no depth jump between them). The GPU network
// only ever swaps across an open link; everywhere else it orders by home
// index, so a pixel outside a span flows home.
export function links(base, bm, out = new Uint8Array(DW * DH)) {
  const { lum16, depth, reachQ, win } = base;
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
      const k = row + x;
      out[k] = prev && next && win[k] && win[k] === win[k + 1] && Math.abs(depth[k] - depth[k + 1]) < JUMP ? 1 : 0;
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
// opaque straight strip from stackLeft(t), one long sorted run of a single
// verge band stretched over its whole length, read from its dark green head
// towards its brightest tail, each row at its own offset into the sort order. There is no drawn outline: a row is given only a reach
// (how far the brush lets it run), and it ends where its last whole run
// ends, so the outer edge is ragged row by row and is the sort's own. Over
// the top the crest's rows run on out to the lip's reach, and below them the
// lip hangs free, its own short rows curling back in over a hollow of open
// sky; the face under it stops well short. Under the stack the zone grades
// from whole photo with a few short runs sorted in place into the sheet.
//
// The stack is lit by its own sort order: every row reads a long stretch of
// its run (readWindow), so each shows the whole ramp from dark green heads to
// bright tails. Each row carries a facing (0 tucked low under the lean, 1 at
// the crest turned to the sky) that tips the stretch and shades the row's
// head. Across the upper third each row's tail lands at its end as a block
// gone over to white; the tall rows up there blow out whole at their ends, a
// broken column of glowing blocks (the spine), tall rows all down the face
// blow out too, and glint tiles break off strip ends at every height.
export const WAVE_ON = 0.12; // mask level where the verge sorts in place and the stack's foot lifts
export const RUN_MIN = 120; // shorter verge runs are never lifted
export const SHOW_MIN = 72; // shorter runs stay photo, not sorted in place: no mosaic of stubs
export const GLINT_PEAK = 0.5; // a run whose brightest pixel is this bright can throw a glint
export const GLINTS = 44; // glint tiles at most...
const CREST_GLINTS = 16; // ...of them at the crest
// The stretch an end block or a glint reads: the run's very tail.
const TAIL = [0.9, 1];
// Tall rows anywhere on the face (BLOCK_H grid px and up, 16-24 device px at
// the usual print size) blow out at their ends, so white blocks break off
// all through the field, not only at the crest.
const BLOCK_H = 18;
// A layer's run is chosen among its source band's runs left of here.
const SRC_X1 = ROOT_X1 + 240;
// Zone rows above this share of the zone run whole, as the stack's do.
const ZONE_JOIN = 0.88;
// The stack's foot, up to this height, starts where its rows' grass starts.
const FOOT = 0.3;
// How far in from the print's left edge a zone row's strips may start: low
// in the zone the grass runs to the edge, but up it the tree and the fence
// stand, so the strips start out of the grass right of the stack's back edge.
const zoneLeft = (z) => (X_ROOT + 30) * smooth(0.35, 0.95, z);
// Each grid row holds up to PARTS tiles, three RGBA16UI texels each, in a
// texture GH wide and 3 x PARTS tall: (x0, x1, source band + 1, flags) for
// the tile's span, (run x0, run x1, facing x 65535, vegetation share of the
// run x 65535), and (row x0, row x1, the stretch of the ramp the row reads
// as two bytes (lo << 8 | hi, readWindow), blow-out x 65535) for the whole
// row the tile is part of. The first tile that holds a pixel draws it,
// so glints and end blocks are written first.
export const PARTS = 24;
export const F_LIFT = 1; // a lifted strip: lit by its facing (the holdout matte covers every sorted pixel)
export const F_GLINT = 2; // a glint tile: the run's brightest pixel, white-gold
export const F_BLOWN = 4; // a row's end block: its run's tail, gone over to white-gold
// A run must be this much grass to be lifted.
const VEG_MIN = 0.5;
// A row's span is a verge band's longest run, at least this share of the
// longest of them.
const LONG = 0.5;
// Each row's offset into the sort order, 0..1 (0.5 reads the stretch its
// facing picks; 0 a darker stretch, 1 a brighter one). Mostly far from the
// middle, by hash, so a dark row often lies against a bright one, with a
// slow drift down the stack so the sheet has broad swells as well.
export function rowShift(r, salt) {
  const u = 2 * hash(r, salt + 7) - 1;
  const v = Math.sign(u) * Math.abs(u) ** 0.6;
  const drift = (vnoise(r / 9, salt * 0.13) - 0.5) * 0.7;
  return clamp(0.5 + 0.5 * clamp(0.8 * v + drift, -1, 1), 0, 1);
}

// The ramp a row reads, in ramp coordinates: 0..RAMP_GREEN is its run's
// grass, darkest green to brightest yellow-green, and RAMP_GREEN..1 the
// bright half of whatever else the run carried (sky and wall highlights),
// so the ramp never drops back to dark where the grass ends. The shader
// maps a ramp coordinate onto the sort order with the run's grass share.
export const RAMP_GREEN = 0.82;
// The stretch of the ramp a row reads, [lo, hi], inner edge to outer end.
// Every row reads a long stretch, at least about three quarters of the
// ramp, so the whole dark-head to bright-tail gradient shows inside it:
// dark green where it leaves the stack's inner edge, bright yellow-green on
// out into the near-white tail. The facing tips the stretch (under the lean
// the row starts on the darkest heads and stops at the brightest grass; at
// the crest it starts lighter and runs on through the tail), and the row's
// own offset slides it darker or brighter, so neighbours still differ.
export function readWindow(r, salt, f) {
  const sh = 2 * rowShift(r, salt) - 1;
  const width = 0.74 + 0.16 * hash(r, salt + 9) + 0.1 * f;
  const lo = clamp(0.02 + 0.16 * f + 0.12 * sh, 0, 0.3);
  const hi = clamp(lo + width + 0.08 * sh, RAMP_GREEN - 0.02, 1);
  return [lo, hi];
}
const packWindow = (w) => (Math.round(clamp(w[0], 0, 1) * 255) << 8) | Math.round(clamp(w[1], 0, 1) * 255);

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
  // The stack reads the source rows: the zone's grass bands sorted whole.
  const verge = Array.from(SRC, (_, i) => B.n + i);
  const nv = verge.length;
  const layers = [];
  let i = 0;
  for (let r = ROWS.n - 1; r >= 0; r--) {
    const c = ROWS.y0[r] + ROWS.h[r] / 2;
    const t = stackT(c);
    // Below the stack's foot a row is in the zone, where its strips start
    // out of its own grass (geometry finds where), reaching out towards the
    // crossing; above it, a strip of the stack from its back edge to its face.
    const vg = t < 0;
    const xl = vg ? 0 : stackLeft(t) + (hash(r, 31) - 0.5) * 20;
    const xr = vg ? ROOT_X1 - 60 + (hash(r, 37) - 0.5) * 140 : stackRight(t);
    const m = Math.max(root, maskAt(mask8, xl + 0.35 * (xr - xl), c));
    // Bottom to top the rows walk the verge in a scrambled order, so no two
    // neighbours start on the same band.
    const src = (i * 7 + Math.floor(i / nv)) % nv;
    const L = { r, t, xl, xr, m, on: m >= liftAt(t), src, lip: null };
    const lip = lipSpan(c);
    if (lip) {
      const ml = Math.max(root, maskAt(mask8, lip[0], c));
      if (ml >= LIP_ON) L.lip = { xa: lip[0], xb: lip[1], s: lip[2], m: ml, src: (i * 11 + 5) % nv };
    }
    layers.push(L);
    i++;
  }
  return { root, layers, verge };
}

// The mask read once per band texel, as bandMask, raised on every source
// row once any row lifts: a row reads the longest run of some source row, so
// the sort runs on all of them whether or not the brush has touched the
// verge itself. (Source rows are never shown in place.)
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

  // In place: every long run under the mask, where it lies. On the zone the
  // runs are the short windows the band was cut into along its grass, so
  // every one of them shows.
  const mrow = new Float32Array(GW);
  for (let d = 0; d < B.n; d++) {
    const row = d * DW;
    const c = B.c[d];
    const min = c >= ZONE_TOP && c <= ZONE_BOT + 48 ? 6 : SHOW_MIN;
    maskRow(mask8, c + 0.5, mrow);
    for (const [x0, x1] of byBand[d]) {
      if (x1 - x0 < min) continue;
      for (let k = x0; k < x1; k++) {
        if (mrow[k] < WAVE_ON) continue;
        geo[(row + k) * 2] = k + 1;
        geo[(row + k) * 2 + 1] = d;
      }
    }
  }
  // A band's grass, for rows that start out of it.
  const segPool = new Map();
  const segsAt = (y) => {
    const d = B.of[clamp(Math.round(y), 0, GH - 1)];
    if (!segPool.has(d)) segPool.set(d, vegSegs(base.veg, d, 10));
    return segPool.get(d);
  };

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
  // The long spans a row may read: every verge band's longest run, kept
  // only if it is long (within reach of the longest of them), so a row is
  // never stitched from stubs. A row takes one of them whole and resamples it
  // to its own length.
  const verge = plan.verge;
  const long = [];
  for (const dd of verge) {
    const c = runsOf(dd);
    if (c.length) long.push({ d: dd, x0: c[0][0], x1: c[0][1], vf: vegOf(dd, c[0][0], c[0][1]) });
  }
  long.sort((p, q) => q.x1 - q.x0 - (p.x1 - p.x0));
  const top = long.length ? long[0].x1 - long[0].x0 : 0;
  const spans = long.filter((p) => p.x1 - p.x0 >= Math.max(RUN_MIN, LONG * top));
  // A span for row r, by hash; never the one the row below it read, so no
  // two neighbouring rows carry the same grain.
  const pick = (r, salt, prev) => {
    if (!spans.length) return null;
    let i = Math.floor(hash(r, salt) * spans.length);
    if (spans.length > 1 && spans[i] === prev) i = (i + 1 + Math.floor(hash(r, salt + 1) * (spans.length - 1))) % spans.length;
    return spans[i];
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
      table[o2 + 2] = packWindow(w);
      table[o2 + 3] = Math.round(clamp(blow, 0, 1) * 65535);
    }
  };

  // A row of the sheet is one span: a single long verge run, read from its
  // dark green head at the row's inner edge xa to its tail at the outer end
  // and stretched to the row's whole length, so the row is one unbroken
  // luminance ramp carrying the run's own sorted grain. The row has no drawn
  // outer edge: it ends near the reach it was given, set ragged by noise that
  // drifts from row to row. Each row reads its own stretch of the sort order
  // (its offset, shift), so dark rows lie beside bright ones.
  const prevRun = {};
  const tile = (r, xa, reach, salt, f, list) => {
    const J = 34 + 46 * hash(r, salt + 3);
    const end = reach + ((vnoise(ROWS.y0[r] / 30, salt * 0.37) - 0.5) * 1.5 + (hash(r, salt + 5) - 0.5) * 0.7) * J;
    const run = end - xa >= 24 ? pick(r, salt, prevRun[salt]) : null;
    if (!run) return { tiles: [], xb: xa };
    prevRun[salt] = run;
    list.push([r, xa, end, F_LIFT, run, f, xa, end, readWindow(r, salt, f)]);
    return { tiles: [[xa, end, run]], xb: end };
  };
  // A zone row below the join: lifted strips start out of the row's own
  // grass, at the start of each stretch of it, short and few at the zone's
  // foot, longer and more of them up it, and further up they run on past
  // the stretch's end, over the gaps, until the row joins the stack. Between
  // them the band's own short runs sorted in place, and the photo, show.
  const zoneStrips = (L, z, f, xEnd) => {
    const { r } = L;
    const c = ROWS.y0[r] + ROWS.h[r] / 2;
    const p = smooth(0.22, 0.85, z);
    const len = 26 + 560 * z ** 1.9;
    const x0 = zoneLeft(z);
    let n = 0;
    for (const [s0, e0] of segsAt(c)) {
      if (s0 >= xEnd) break;
      if (e0 - Math.max(s0, x0) < 16) continue;
      let x = Math.max(s0, x0);
      while (x < Math.min(e0, xEnd) && n < PARTS - 6) {
        const u = hash(r * 61 + Math.round(x), 141);
        const w = len * (0.45 + 1.1 * hash(r * 61 + Math.round(x), 143));
        if (u < p) {
          const xb = Math.min(xEnd, x + w, e0 + w * z * 0.7);
          const run = xb - x >= 10 ? pick(r * 13 + n, 41, prevRun[41]) : null;
          if (run) {
            prevRun[41] = run;
            n++;
            face.push([r, x, xb, F_LIFT, run, f, x, xb, readWindow(r * 13 + n, 41, f)]);
          }
          x = xb + 4 + len * (0.15 + 0.6 * hash(r, Math.round(x))) * (1 - z);
        } else x += w * 0.8;
      }
    }
  };
  // A row's end block, from about x0 (a smooth line down the rows, so the
  // blocks stack into a column) to the row's end.
  const endBlock = (r, tt, x0, f, xa, blow) => {
    if (!tt.tiles.length) return;
    const [, , run] = tt.tiles[tt.tiles.length - 1];
    const a = Math.min(x0 + (hash(r, 71) - 0.5) * 40, tt.xb - 48);
    ends.push([r, a, tt.xb, F_LIFT | F_BLOWN, run, f, xa, tt.xb, TAIL, blow]);
  };

  // The tiles, collected first so glints and end blocks can be written
  // ahead of the face they sit on.
  const face = [];
  const ends = [];
  const tails = [];
  for (const L of plan.layers) {
    const { r, t } = L;
    const lip = L.lip;
    if (!L.on && !lip) continue;
    const h = ROWS.h[r];
    const thick = h >= 20;
    // Facing: the verge and the stack's foot catch some light; the face
    // under the lean is turned away (the dark band); across the top the
    // rows turn to the sky.
    let f = t < 0 ? 0.5 : Math.max(0.48 * (1 - smooth(0.04, 0.4, t)), smooth(0.64, 0.97, t) ** 1.1);
    f = clamp(f + (hash(r, 47) - 0.5) * 0.08, 0, 1);
    // The row's reach: how far the brush lets it run. The topmost rows the
    // mask has only just lifted reach less, so a stack short of its crest
    // tapers.
    let xa = L.xl;
    if (t < 0) {
      // The zone: below the join, strips out of the row's grass; at the
      // join the row is one strip, from where its grass starts.
      const z = zoneZ(ROWS.y0[r] + ROWS.h[r] / 2);
      f = clamp(0.3 + 0.25 * z + (hash(r, 47) - 0.5) * 0.1, 0, 1);
      const xEnd = L.xr * (0.6 + 0.4 * L.m);
      if (z < ZONE_JOIN) {
        zoneStrips(L, z, f, xEnd);
        continue;
      }
      const x0 = zoneLeft(z);
      const s0 = segsAt(ROWS.y0[r] + ROWS.h[r] / 2).find(([a, b]) => b - Math.max(a, x0) >= 30 && a < xEnd - 160);
      if (!s0) continue;
      xa = Math.max(s0[0], x0);
    } else if (t < FOOT) {
      // The stack's foot starts where its row's own grass starts, close to
      // its back edge, so the edge is ragged and follows the leaves, and the
      // trunk between them stays photo.
      const s0 = segsAt(ROWS.y0[r] + ROWS.h[r] / 2).find(([a, b]) => b - Math.max(a, xa) >= 24);
      if (s0 && s0[0] - xa < 240 * (1 - t / FOOT)) xa = Math.max(xa, s0[0]);
    }
    let reach = 0;
    if (L.on) {
      const grow = 0.25 + 0.75 * smooth(0, 0.12, L.m - liftAt(t));
      reach = xa + (L.xr - xa) * (0.55 + 0.45 * L.m) * grow;
    }
    const weld = lip && lip.s <= WELD;
    const hang = lip && lip.s > WELD;
    if (weld) {
      // Over the top the crest's rows run on out to the lip's reach: the
      // shoulder is the crest's own rows, turned full to the sky.
      reach = Math.max(reach, lip.xb);
      f = Math.max(f, 0.9 + 0.1 * hash(r, 49));
    } else if (hang) {
      // Under the weld the face lies inside the hollow, under the lean,
      // turned away from the light, and it stops well short of the lip.
      f *= 0.45;
      reach = Math.min(reach, lip.xa - 70 - 140 * smooth(WELD, WELD + 0.3, lip.s));
    }
    // The lip, hanging free over the hollow: its own short row, turned under
    // and darkening as it falls, ragged at both ends.
    if (hang) {
      const ft = clamp(0.95 - 0.8 * smooth(WELD, 1, lip.s) + (hash(r, 57) - 0.5) * 0.06, 0, 1);
      const ta = lip.xa + (hash(r, 59) - 0.5) * 30;
      const tt = tile(r, ta, lip.xb, 53, ft, face);
      // Down the lip's shoulder the spine runs on, fading as it turns under.
      const bl = smooth(0.78, WELD + 0.05, lip.s);
      if (bl > 0.05) endBlock(r, tt, lip.xb - (thick ? 210 : 150) * (1 - 0.4 * smooth(WELD, 0.7, lip.s)), ft, ta, bl);
      if (ft > 0.6) tails.push({ r, x1: tt.xb, run: tt.tiles.length ? tt.tiles[tt.tiles.length - 1][2] : null, f: ft, y: ROWS.y0[r], xa: ta, xb: tt.xb });
    }
    if (!L.on || reach - xa < 24) continue;
    const tt = tile(r, xa, reach, 41, f, face);
    if (!tt.tiles.length) continue;
    const { xb } = tt;
    const [lx0, , run] = tt.tiles[tt.tiles.length - 1];
    if (weld) {
      // The spine: every crest row blows out at its end, all from about one
      // line, so the blocks stack into a solid white-gold column; the tall
      // rows go over hardest.
      endBlock(r, tt, reach - (thick ? 240 : 170) - 30 * hash(r, 75), f, xa, thick ? 1 : 0.62);
    } else {
      // Elsewhere the run's tail lands at the row's end as a block gone over
      // to white-gold, more of it the more the row faces the sky. A tall row
      // anywhere on the face, under the lean as well, blows out at its end
      // more often than not: its tail read on past 0.9, a white block.
      let blow = t > 0.5 ? smooth(0.45, 0.9, f) : 0;
      if (h >= BLOCK_H && hash(r, 83) < (t < 0 ? 0.34 : 0.66)) blow = Math.max(blow, 0.8 + 0.2 * hash(r, 85));
      if (blow > 0.04) {
        const bl = clamp((xb - lx0) * (0.12 + 0.22 * hash(r, 71) * blow), 14, h >= BLOCK_H ? 150 : 120);
        ends.push([r, xb - bl, xb, F_LIFT | F_BLOWN, run, f, xa, xb, TAIL, blow]);
      }
    }
    // Any row may throw a glint off its end, the crest's most often: the
    // white rectangles break off at every height.
    if (f > 0.6 || hash(r, 87) < 0.22 + (h >= BLOCK_H ? 0.3 : 0)) tails.push({ r, x1: xb, run, f, y: ROWS.y0[r], xa, xb });
  }

  // Glints: bright tails all down the face, most where the facing peaks,
  // spaced apart.
  // Each is the strip's own brightest pixel broken off past its end, after a
  // short gap, as tall as the row.
  const glint = [];
  tails.sort((p, q) => q.f - p.f + (hash(q.r, 61) - hash(p.r, 61)) * 0.3);
  let crestN = 0;
  for (const g of tails) {
    if (glint.length >= GLINTS) break;
    if (!g.run) continue;
    // The crest keeps its handful; the rest are spread down the face.
    if (g.f > 0.6 && crestN >= CREST_GLINTS) continue;
    if (peakOf(g.run) < GLINT_PEAK) continue;
    if (glint.some((o) => Math.abs(o.x - g.x1) < 60 && Math.abs(o.y - g.y) < 16)) continue;
    const gap = 4 + Math.round(hash(g.r, 63) * 10);
    const w = 12 + Math.round(hash(g.r, 65) * 30);
    glint.push({ x: g.x1, y: g.y });
    if (g.f > 0.6) crestN++;
    put(g.r, g.x1 + gap, g.x1 + gap + w, F_LIFT | F_GLINT, g.run, 1, g.xa, g.xb, [0.97, 1], 1);
  }
  for (const p of ends) put(...p);
  for (const p of face) put(...p);
  return { geo, table, glintN: glint.length };
}
