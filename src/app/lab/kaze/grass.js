// The grass, as geometry: the stalks seen from where you lie, worm's-eye.
//
// The camera sits 4 cm off the ground and looks straight up through a 155 deg
// stereographic lens centred on the zenith, its frame shifted a little so the
// zenith, where every upright stalk points, is in frame just above and right
// of its centre, a point of open cobalt. The ground is all round the image
// circle's rim, outside the frame, and every blade rooted on it runs in over
// the frame's edge at its own azimuth toward that vanishing point: an
// upright stalk draws as a dead straight line into it, so the grass comes in
// from all four edges at once and converges overhead, as the towers in a
// street do looking straight up. Only the stalks within a pace or so are
// tall enough to reach into frame. Built once, here, as world-space
// ribbons (a blade, a culm, a pedicel, a spikelet), each a centreline with its
// half-width turned to face the lens; the vertex shader projects them, bends
// them about their roots under the wind and keeps any sliver at least a
// device pixel wide (fading its coverage instead), and they are drawn opaque
// into 4x MSAA targets, premultiplied, so every edge is the blade's own
// coverage of the pixel: no matte, no alpha test, no fringe of another colour.
//
// Two layers: the near one at full resolution (the field's blades nearer
// than about 30 cm, nearly in focus, the brome culms, and the anchor, one
// tall culm with a seed head at your shoulder, near-black olive, sharp) and
// the field behind (full resolution and 4x MSAA too, read a touch into its
// own mips so it sits slightly diffused behind it), lit against the light:
// a near-black deep green body and a thin yellow-green transmission rim on
// the edge toward the sun, opaque at every distance, so the field is a ring
// of varied dark shapes framing the sky, never a pale ghost over the cloud
// or an olive comb, and the anchor stands clear above it.

const DEG = Math.PI / 180;

// The lens: aimed straight up, at the zenith, with the frame shifted a
// little off its axis, so the zenith, where every upright stalk points, sits
// in frame a little above and right of its centre and the ring of grass
// round it is deepest at the bottom corners (about 12 deg above the ground
// there, 70 deg at the top edge). Stereographic about the zenith: every vertical line through the
// lens is a great circle through the projection's centre, so every upright
// culm draws as a dead straight line converging on that point, at its own
// azimuth, and a stalk at the edge is never stretched (the projection is
// conformal: a blade at the corners is magnified, never stretched). FOV is
// the image circle that just takes in the frame's far (bottom) corners; VP is where the zenith lands in NDC (x, y); ROLL turns
// the field about it.
export const CAM = { h: 0.04, fov: 155, vp: [0.05, 0.52], roll: 0 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.max(1e-9, Math.hypot(a[0], a[1], a[2])));

// The camera for a W x H frame: position, basis (right, up, forward: the
// zenith), the stereographic scale to NDC and the shift (where the zenith
// lands). The bottom corners take the image circle's rim whatever the
// screen's shape: a tall screen looks a little further down, a wide one
// keeps the same reach across its bottom edge.
export function camera(W, H) {
  const A = W / H;
  // Stereographic: a direction at angle t from the axis lands at 2 tan(t/2).
  const R = 2 * Math.tan((CAM.fov * DEG) / 4);
  const s = R / Math.hypot(A + Math.abs(CAM.vp[0]) * A, 1 + CAM.vp[1]);
  const k = [1 / (A * s), 1 / s];
  const c = Math.cos(CAM.roll * DEG);
  const sn = Math.sin(CAM.roll * DEG);
  // screen right is +x (east), screen up is -y: the ground ahead of you (+y)
  // lies below the bottom edge, the ground behind your head beyond the top
  const r = [c, -sn, 0];
  const u = [-sn, -c, 0];
  return { pos: [0, 0, CAM.h], r, u, f: [0, 0, 1], k, o: CAM.vp };
}

export function project(cam, P) {
  const d = norm(sub(P, cam.pos));
  const z = dot(d, cam.f);
  const q = 2 / Math.max(1e-3, 1 + z);
  return [dot(d, cam.r) * q * cam.k[0] + cam.o[0], dot(d, cam.u) * q * cam.k[1] + cam.o[1]];
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lin = (hex) => {
  const v = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => c / 255);
  return v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A centreline: from p0, heading az (horizontal) at a0 from vertical, the
// angle growing by bend * s^bp along it (gravity on a leaf comes on toward
// its tip); n segments over length L. The bend may turn another way than the
// lean (bendAz): a culm stood straight out along its own line of sight from
// the lens and its head nodding across it. Returns points and unit tangents.
function curve(p0, az, a0, bend, bp, L, n, h, bendAz) {
  const hz = h || [Math.sin(az), Math.cos(az), 0];
  const hb = bendAz == null ? hz : [Math.sin(bendAz), Math.cos(bendAz), 0];
  const dirAt = (s) => {
    const k = bend * Math.pow(s, bp);
    const t = add(mul(hz, a0), mul(hb, k));
    const a = Math.hypot(t[0], t[1]);
    return a < 1e-9 ? [0, 0, 1] : add(mul(t, Math.sin(a) / a), [0, 0, Math.cos(a)]);
  };
  const pts = [p0];
  const tan = [];
  let p = p0;
  for (let i = 0; i <= n; i++) {
    tan.push(dirAt(i / n));
    if (i < n) {
      p = add(p, mul(dirAt((i + 0.5) / n), L / n));
      pts.push(p);
    }
  }
  return { pts, tan };
}

// Width profiles, s in 0..1 along the ribbon, as a fraction of its widest.
const PROFILE = {
  // a grass leaf: full width most of its length, then a long point
  leaf: (s) => Math.pow(Math.min(1, (1 - s) / 0.5), 0.85) * (0.5 + 0.5 * Math.min(1, s * 5)),
  // a plain blade: widest a little above the sheath, then tapering
  // steadily all the way to a fine point
  blade: (s) => Math.pow(1 - s, 0.75) * (0.7 + 0.3 * Math.min(1, s * 6)),
  // a culm: tapering a little toward the top
  culm: (s) => 1 - 0.45 * s,
  // a pedicel: hair-thin all along
  hair: () => 1,
  // a spikelet: a narrow lance, widest past its middle, drawn out into an awn
  spike: (s) => (s < 0.75 ? Math.pow(Math.sin(Math.PI * (0.08 + (0.84 * s) / 0.75)), 0.7) : (0.16 * (1 - s)) / 0.25),
};

// Vertex layout: P(3) S(3) tip(3) col(3) lever, trans, phase, then the
// shading frame: along (0 root .. 1 tip), across (-1 .. 1), the plant's seed,
// and its depth (0 at your shoulder .. 1 the field a few paces off), and how
// much of the lens's defocus it takes (1 for all but the blades at your cheek).
export const STRIDE = 20;

// A seed in 0..1 from a plant's phase, so every ribbon of one plant (stem,
// leaves, panicle) shares its hue and value without drawing on the layout's
// random stream.
const seedOf = (ph) => {
  const x = Math.sin(ph * 91.7 + 3.1) * 43758.5453;
  return x - Math.floor(x);
};

function builder(cam) {
  const v = [];
  const idx = [];
  let nv = 0;
  const st = { depth: 0, focus: 1 };
  // ribbon: points + tangents, half width per point, the wind's reference
  // point (the culm or blade tip) and the lever per point (metres of tip
  // travel per unit of bend), colours base -> tip; the plant's seed and where
  // along its own length each point stands, for the fragment shading (a
  // constant for the hanging panicle, which has no root of its own to darken).
  const ribbon = ({ pts, tan }, hw, tip, lever, c0, c1, trans, phase, seed = seedOf(phase), along = (s) => s) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const P = pts[i];
      const side = norm(cross(tan[i], sub(P, cam)));
      const w = hw(s);
      const col = mix3(c0, c1, Math.pow(s, 1.3));
      const lv = lever(s);
      const al = along(s);
      for (const sg of [-1, 1]) {
        v.push(P[0], P[1], P[2], side[0] * w * sg, side[1] * w * sg, side[2] * w * sg, tip[0], tip[1], tip[2], col[0], col[1], col[2], lv, trans, phase, al, sg, seed, st.depth, st.focus);
      }
      if (i < n - 1) {
        const a = nv + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    nv += n * 2;
  };
  return { ribbon, st, raw: () => ({ v, idx, nv }), out: () => ({ verts: new Float32Array(v), index: new Uint32Array(idx), count: idx.length }) };
}

// One layer from several builders, each drawn over the one before.
function merged(...bs) {
  const raws = bs.map((b) => b.raw());
  const index = new Uint32Array(raws.reduce((n, r) => n + r.idx.length, 0));
  const verts = new Float32Array(raws.reduce((n, r) => n + r.v.length, 0));
  let ni = 0;
  let nf = 0;
  let base = 0;
  for (const r of raws) {
    for (let i = 0; i < r.idx.length; i++) index[ni + i] = r.idx[i] + base;
    verts.set(r.v, nf);
    ni += r.idx.length;
    nf += r.v.length;
    base += r.nv;
  }
  return { verts, index, count: index.length };
}

// Wind: the tip of a stalk of length L travels AMP * L * s^2 per unit of bend.
const AMP = 0.32;

// A culm with a nodding brome panicle: the stem, a leaf or two off its lower
// nodes, and at the top a few whorls of hair-thin pedicels, each hanging a
// spikelet with a short awn.
function culmWithHead(b, R, o) {
  const { root, az, lean, L, w0, cStem, cTip, cHead, trans, segs, leaves = 1 } = o;
  const phase = R() * 6.283;
  const seed = seedOf(phase);
  const stem = curve(root, az, lean, o.nod ?? 0.75, 5, L, segs, null, o.nodAz);
  const tip = stem.pts[stem.pts.length - 1];
  const lever = (s) => AMP * L * s * s;
  b.ribbon(stem, (s) => w0 * PROFILE.culm(s), tip, lever, cStem, cTip, trans * 0.5, phase, seed);
  // leaves off the lower nodes
  for (let k = 0; k < leaves; k++) {
    const sN = 0.08 + 0.18 * k + 0.08 * R();
    const at = stem.pts[Math.round(sN * segs)];
    const laz = az + (R() < 0.5 ? -1 : 1) * (0.8 + R() * 1.6);
    const LL = L * (0.3 + 0.2 * R());
    const lc = curve(at, laz, 0.35 + 0.3 * R(), 1.1 + R() * 0.8, 1.8, LL, Math.max(8, Math.round(segs * 0.5)));
    const ltip = lc.pts[lc.pts.length - 1];
    b.ribbon(lc, (s) => w0 * (o.leafW ?? 1.6) * PROFILE.leaf(s), ltip, (s) => AMP * (L * sN * sN + LL * s * s * 0.6), cStem, cTip, trans, phase + 1.3, seed, (s) => 0.15 + 0.85 * s);
  }
  // the panicle: whorls on the top fifth of the culm, the pedicels spread and
  // droop, the spikelets hang from them
  const whorls = o.whorls ?? 4;
  for (let k = 0; k < whorls; k++) {
    const sN = 0.8 + (0.2 * k) / Math.max(1, whorls - 1) - 0.02;
    const i = Math.min(segs, Math.round(sN * segs));
    const at = stem.pts[i];
    const n = 2 + Math.floor(R() * 2.5) - (k === whorls - 1 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const paz = az + (R() - 0.5) * 2.6 + (j % 2 ? 0.9 : -0.9);
      const PL = L * (0.025 + 0.035 * R()) * (1 - 0.35 * (k / whorls));
      const ped = curve(at, paz, 0.7 + 0.5 * R(), 1.4 + R() * 0.8, 1.2, PL, 8);
      const pend = ped.pts[ped.pts.length - 1];
      const plv = (s) => AMP * L * sN * sN + AMP * 0.6 * PL * s * s;
      b.ribbon(ped, () => 0.00028, tip, plv, cHead, cHead, trans, phase + j, seed, () => 0.85);
      const dir = ped.tan[ped.tan.length - 1];
      const SL = (0.022 + 0.012 * R()) * (o.big ?? 1);
      const hz = norm([dir[0], dir[1], 0]);
      const a0 = Math.acos(Math.max(-1, Math.min(1, dir[2])));
      const sp = curve(pend, 0, a0, 0.3, 1, SL, 12, hz);
      const end = AMP * L * sN * sN + AMP * 0.6 * PL;
      const SW = (0.0019 + 0.0008 * R()) * (o.big ?? 1);
      b.ribbon(sp, (s) => SW * PROFILE.spike(s), tip, (s) => end + AMP * 0.8 * SL * s, cHead, cHead, trans, phase + j, seed, (s) => 0.8 + 0.2 * s);
    }
  }
}

// A plain leaf blade, rooted outside the frame: nearly straight, leaning
// out away from you along its own azimuth so it draws as a straight line into
// the zenith; its tip droops a little, mostly outward along that same line
// (where it stays straight on screen) and now and then across it, so a few
// of them arc over their neighbours. A gentle twist turns it edge-on in
// places.
function blade(b, R, o) {
  const { root, az, L, w0, c0, c1, trans, segs } = o;
  const tw = R() * 6.283;
  const twr = (R() - 0.5) * 2.4;
  const ph = R() * 6.283;
  // thinned out: it still takes its draws from the layout's random stream,
  // so every blade kept stands exactly where it stood
  if (o.skip) return;
  const lc = curve(root, az, o.lean, o.droop, 2.2, L, segs, null, az + o.droopTurn);
  const tip = lc.pts[lc.pts.length - 1];
  b.ribbon(lc, (s) => w0 * PROFILE.blade(s) * (0.55 + 0.45 * Math.abs(Math.cos(tw + twr * s))), tip, (s) => AMP * L * s * s, c0, c1, trans, ph);
}

// Is any of a stalk (root to its top, standing) in frame for a wide or a tall
// screen, with a margin for the wind?
function inFrame(root, H) {
  for (const cam of [camera(16, 10), camera(9, 16)]) {
    for (let i = 0; i <= 6; i++) {
      const p = project(cam, add(root, [0, 0, (H * i) / 6]));
      if (Math.abs(p[0]) < 1.4 && Math.abs(p[1]) < 1.4) return true;
    }
  }
  return false;
}

export function buildGrass() {
  const cam = [0, 0, CAM.h];
  const R = rng(11);
  // a second stream for each blade's own width, length and hue and for the
  // thinning, so the layout's stream (and so the frame) is unchanged
  const R2 = rng(29);
  // the anchor, and the few blades nearer than it (dark, wide, out of focus,
  // drawn over it at full resolution)
  const near = builder(cam);
  const rest = builder(cam);
  // the three brome culms round the frame, drawn with the rest but over it
  // (they are the nearest of it)
  const shoulder = builder(cam);
  // the field's blades nearer than the anchor: drawn at full resolution
  // with the anchor, under the brome culms and it, and given only a little
  // of the lens's defocus. At half resolution and fully defocused they
  // printed as one soft dark olive smear along the bottom of the frame; at
  // full resolution and nearly in focus each is its own crisp silhouette.
  const fore = builder(cam);
  const FORE = 0.3;
  const at = (D, phi) => [D * Math.sin(phi * DEG), D * Math.cos(phi * DEG), 0];

  // ---- the ring, on screen ----
  // The zenith is in frame, a little above and right of centre, and the
  // ground is all round the image circle's rim: whatever stands near enough
  // and tall enough comes in over the edge of the frame at its own azimuth
  // and runs straight in toward the zenith, from the bottom edge (ahead of
  // you), the top (behind your head) and both sides alike. Distances on
  // screen are taken from the zenith in frame heights (x times the aspect),
  // so a circle round it is a circle; a world azimuth phi (0 ahead, 90 to
  // your right) leaves the zenith along (sin phi, -cos phi).
  const wide = camera(16, 10);
  const WA = 16 / 10;
  const VP = CAM.vp;
  const rOf = (p) => Math.hypot((p[0] - VP[0]) * WA, p[1] - VP[1]);
  // how far the frame's edge is from the zenith along azimuth phi
  const edgeOf = (phi) => {
    const dx = Math.sin(phi * DEG) / WA;
    const dy = -Math.cos(phi * DEG);
    let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (1 - VP[0]) / dx);
    if (dx < -1e-6) t = Math.min(t, (-1 - VP[0]) / dx);
    if (dy > 1e-6) t = Math.min(t, (1 - VP[1]) / dy);
    if (dy < -1e-6) t = Math.min(t, (-1 - VP[1]) / dy);
    return t;
  };
  const dAz = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  // The open sky the ring leaves: no tip comes nearer the zenith than OPEN,
  // and how far in from the edge a tip may reach, as a share of the way to
  // the zenith, is held back toward the sun (its corner stays open, the
  // bloom runs clean into the cobalt) and across the tower's lit flank
  // (it is framed by the ring, not buried in it).
  const SUN_AZ = -100;
  const TOWER_AZ = 48;
  const OPEN = 0.2;
  const reachOf = (phi) => {
    const sun = Math.exp(-((dAz(phi, SUN_AZ) / 26) ** 2));
    const tower = Math.exp(-((dAz(phi, TOWER_AZ) / 20) ** 2));
    return 0.7 * (1 - 0.8 * sun) * (1 - 0.45 * tower);
  };
  const innerOf = (phi) => Math.max(OPEN, edgeOf(phi) * (1 - reachOf(phi)));
  const tipAt = (phi, D, z) => project(wide, add(at(D, phi), [0, 0, z]));
  // the heights at which the top of a stalk at (D, phi) comes in over the
  // edge of the frame and at which it meets its inner limit; null if it
  // never shows inside it
  const span = (phi, D) => {
    const e = edgeOf(phi);
    const rin = innerOf(phi);
    let lo = null;
    let hi = null;
    for (let i = 1; i <= 160; i++) {
      const z = CAM.h + (1.2 * i) / 160;
      const r = rOf(tipAt(phi, D, z));
      if (lo == null && r < e) lo = z;
      if (r >= rin) hi = z;
    }
    return lo == null || hi == null || hi <= lo ? null : [lo, hi];
  };
  // a point on the frame's edge, its length taken evenly (the top edge, the
  // behind-your-head side, a little sparser), as an azimuth from the zenith
  const PER = [
    [3.2, 1.0, (u) => [-1 + 2 * u, -1]],
    [2.0, 1.0, (u) => [1, -1 + 2 * u]],
    [3.2, 0.8, (u) => [1 - 2 * u, 1]],
    [2.0, 1.0, (u) => [-1, 1 - 2 * u]],
  ];
  const perTotal = PER.reduce((a, p) => a + p[0] * p[1], 0);
  const edgeAz = () => {
    let x = R() * perTotal;
    for (const [len, w, f] of PER) {
      if (x < len * w) {
        const p = f(x / (len * w));
        return Math.atan2((p[0] - VP[0]) * WA, -(p[1] - VP[1])) / DEG;
      }
      x -= len * w;
    }
    return 0;
  };

  // ---- the anchor, and three seed heads round the ring ----
  // The only panicles in the field: the hero, near-black, sharp, full
  // resolution, in from the bottom edge across the tower, and three brome
  // culms in from the other edges, lit against the light like the field.
  // Each stands straight out along its own line of sight, so it runs dead
  // straight into the zenith; only the heads nod across that line, at
  // staggered distances from it so they never meet. Each is cut to the
  // height that brings its top k of the way in from the frame's edge to
  // the open sky round the zenith.
  const ink = lin(0x1c2414);
  const inkTip = lin(0x232d18);
  const HERO = 30;
  const anchors = [
    { D: 0.27, phi: 116, k: 0.72, lean: 0.03, nod: 0.3, nodAz: 30 },
    { D: 0.3, phi: -46, k: 0.66, lean: 0.02, nod: 0.3, nodAz: 40 },
    { D: 0.25, phi: 152, k: 0.6, lean: 0.02, nod: 0.3, nodAz: 62 },
    { D: 0.2, phi: HERO, k: 0.8, lean: 0.0, nod: 0.35, nodAz: 114, hero: 1 },
  ];
  const heightTo = (phi, D, r) => {
    for (let z = 0.05; z < 3; z += 0.005) if (rOf(tipAt(phi, D, z)) <= r) return z;
    return 3;
  };
  for (const a of anchors) {
    const lit = !a.hero;
    // the anchor's foot, nearer than the focus, takes only a little of the
    // lens's defocus, so the stalk runs in as one sharp line, not a smear
    near.st.focus = 0.2;
    culmWithHead(lit ? shoulder : near, R, {
      root: at(a.D, a.phi),
      az: a.phi * DEG,
      lean: a.lean,
      nod: a.nod,
      nodAz: a.nodAz * DEG,
      L: heightTo(a.phi, a.D, edgeOf(a.phi) - (edgeOf(a.phi) - OPEN) * a.k) - CAM.h,
      w0: lit ? 0.0015 : 0.0017,
      cStem: lit ? lin(0x18240f) : ink,
      cTip: lit ? lin(0x243216) : inkTip,
      cHead: lit ? lin(0x1e2a12) : ink,
      trans: lit ? 1 : 0,
      segs: 72,
      leaves: 0,
      whorls: 6,
      big: lit ? 1.1 : 1.25,
    });
  }

  // ---- the field: plain blades, far to near (painter's order) ----
  // Each is laid out by where its tip lands on screen rather than its
  // length: in over the frame's edge at its own azimuth, all the way round,
  // and stopping somewhere between the edge and its inner limit, so the
  // ring is densest at the frame's edge and thins inward, every blade
  // converging on the zenith, and the middle stays open cobalt round it.
  const items = [];
  // n blades at D0..D1, their tips from f0 to f1 of the way from where they
  // come in over the edge to the inner limit (fp biases them toward the edge)
  const put = (n, kind, D0, D1, Dp, f0, f1, fp) => {
    for (let i = 0; i < n; i++) {
      const D = D0 + (D1 - D0) * Math.pow(R(), Dp);
      const phi = edgeAz();
      const f = f0 + (f1 - f0) * Math.pow(R(), fp);
      const sp = span(phi, D);
      // never in frame inside the limit: no blade
      if (!sp) continue;
      const z = sp[0] + (sp[1] - sp[0]) * f;
      // a little over the height: the lean and the droop bring it down
      items.push({ kind, D, phi, L: Math.min(1.4, (z - CAM.h) * 1.03 + 0.01) });
    }
  };
  // the field behind: a sparse few, standing a pace or two off
  put(260, "far", 0.42, 0.95, 1.0, 0.3, 1.0, 0.8);
  // the body of it, round your head
  put(340, "mid", 0.15, 0.45, 0.9, 0.1, 1.0, 1.4);
  // a low fringe all round the edge, the mass the rest rises out of
  put(720, "mat", 0.09, 0.3, 1.1, 0.0, 0.5, 1.3);
  items.sort((p, q) => q.D - p.D);
  for (const it of items) {
    const root = at(it.D, it.phi);
    if (!inFrame(root, it.L)) continue;
    // depth: 0 at your shoulder .. 1 the field behind (more sky in front)
    const dep = Math.min(1, Math.max(0, (it.D - 0.15) / 0.75));
    const into = it.D < FORE ? fore : rest;
    into.st.depth = dep;
    // the nearest of the low fringe take only part of the lens's defocus,
    // so along the edge they hold as soft-edged blades rather than
    // spreading into dark swaths (in the corners, where the lens is widest,
    // fully defocused they smeared into streaks, like motion blur)
    const nf = Math.min(1, Math.max(0, (it.D - 0.09) / 0.2));
    // (the near field: from a twentieth of it at your cheek to a quarter by
    // the time it meets the field behind, and thinner the nearer it is)
    const fk = Math.min(1, Math.max(0, (it.D - 0.09) / (FORE - 0.09)));
    into.st.focus = it.D < FORE ? 0.05 + 0.2 * fk * fk : 0.25 + 0.55 * nf * nf * (3 - 2 * nf);
    const vary = 0.8 + 0.4 * R();
    const dry = R() < 0.1 ? 1 : 0;
    // Against the light a leaf's body is near-black deep green, #0F1A0C to
    // #1C2A14; only its sunward margin glows (the rim, in GRASS_FRAG). Each
    // blade its own: most a deep sap green, some cooler and bluer, the odd
    // one dry and toward a dark umber, and its value its own, so the ring
    // reads as separate dark shapes, never one olive comb.
    const fam = R2();
    const tv = R2();
    const core = dry
      ? mix3(lin(0x1a1a0c), lin(0x262412), tv)
      : fam < 0.28
        ? mix3(lin(0x0d1810), lin(0x162418), tv)
        : fam < 0.82
          ? mix3(lin(0x0f1a0c), lin(0x1c2a14), tv)
          : mix3(lin(0x161c0b), lin(0x222a10), tv);
    // a pace off a touch less dark, the air between (GRASS_FRAG adds it)
    const base = core.map((c) => c * vary * (1 + 0.15 * dep));
    const tipC = mix3(core, lin(0x2c3816), 0.35).map((c) => c * vary * (1 + 0.15 * dep));
    // In the band below the zenith (ahead of you, the bottom edge's middle)
    // the field is thinned by about two in five, so the bottom of the frame
    // is a varied run of dark shapes with sky between, not a comb, and the
    // hero culm stands clear in it.
    const band = 1 - Math.min(1, Math.max(0, (dAz(it.phi, 0) - 34) / 16));
    const skip = R2() < 0.38 * band;
    // its own width and length: a few broad, most medium, some fine; and
    // some cut short, so the tips do not all stop on one line
    const wk = 0.5 + 1.15 * Math.pow(R2(), 1.4);
    const lk = 0.62 + 0.46 * R2();
    // mostly a droop outward, along its own line; a third of them across it
    const across = R() < 0.25;
    blade(into, R, {
      root,
      az: (it.phi + (R() - 0.5) * 3) * DEG,
      lean: 0.01 + 0.07 * R(),
      droop: across ? 0.08 + 0.14 * R() : 0.04 + 0.12 * R(),
      droopTurn: across ? (R() < 0.5 ? -1 : 1) * (0.9 + 0.5 * R()) : (R() - 0.5) * 0.5,
      L: Math.min(it.L, it.L * lk),
      // a leaf 3-7 mm wide, and then its own
      w0: (0.0022 + 0.0024 * R()) * wk * (it.kind === "far" ? 1.2 : it.kind === "mat" ? 1.4 : 1) * (it.D < FORE ? 0.6 + 0.4 * fk : 1),
      c0: base,
      c1: tipC,
      trans: 1,
      segs: Math.round(16 + 20 * (1 - dep)),
      skip,
    });
  }

  rest.st.focus = 1;
  fore.st.focus = 1;

  // ---- the nearest few: at your cheek, thin and dark, nearly in focus ----
  // Drawn over the anchor at full resolution and kept off its azimuth (and
  // off the sun's) so none hides it. Round the ring, and low in it: a dark
  // frame along the edges, not a wall across the cumulus. Fine leaves, and
  // given only a little of the lens's defocus: wide and fully defocused, at
  // a few centimetres they spread into broad near-black swaths; thin, they
  // print as crisp dark silhouettes.
  for (let i = 0, k = 0; i < 200 && k < 14; i++) {
    const phi = edgeAz();
    if (dAz(phi, HERO) < 9 || dAz(phi, SUN_AZ) < 30) continue;
    const D = 0.05 + 0.07 * R();
    const sp = span(phi, D);
    if (!sp) continue;
    const z = sp[0] + (sp[1] - sp[0]) * (0.12 + 0.36 * R());
    const L = Math.min(0.9, z - CAM.h + 0.01);
    const root = at(D, phi);
    if (!inFrame(root, L)) continue;
    k++;
    near.st.depth = 0;
    near.st.focus = 0.05;
    const v = 0.85 + 0.3 * R();
    blade(near, R, {
      root,
      az: (phi + (R() - 0.5) * 2) * DEG,
      lean: 0.02 + 0.05 * R(),
      droop: 0.06 + 0.12 * R(),
      droopTurn: (R() - 0.5) * 0.6,
      L,
      w0: 0.0009 + 0.0006 * R(),
      c0: lin(0x10150b).map((c) => c * v),
      c1: lin(0x1d2612).map((c) => c * v),
      trans: 0.3,
      segs: 36,
    });
  }
  near.st.focus = 1;
  // full resolution: the near field, the brome culms over it as before,
  // then the anchor and the blades at your cheek
  return { near: merged(fore, shoulder, near), rest: rest.out() };
}

export const GRASS_VERT = `#version 300 es
in vec3 aP;      // centreline point, world (m)
in vec3 aS;      // signed half-width, world, facing the lens
in vec3 aTip;    // the stalk's tip: where it reads the wind
in vec3 aCol;    // linear colour
in vec3 aK;      // lever (m of travel per unit bend), translucency, phase
in vec3 aB;      // along (0 root .. 1 tip), across (-1 .. 1), the plant's seed
in float aD;     // depth: 0 at your shoulder .. 1 the field a few paces off
in float aF;     // its share of the lens's defocus
uniform vec3 uCam;
uniform vec3 uR;
uniform vec3 uU;
uniform vec3 uF;
uniform vec2 uK;
uniform vec2 uO;           // where the zenith lands, NDC (the lens's shift)
uniform vec2 uRes;         // target size, px
uniform vec4 uView;        // image uv on screen (for the wind grid)
uniform sampler2D uWind;
uniform float uTime;
uniform float uDebug;
uniform vec2 uSun;         // the sun on screen, NDC
out vec3 vCol;
out float vA;
out float vTrans;
out vec2 vNdc;
out float vAlong;
out float vAcross;
out float vSunward;
out float vDepth;
out float vHalf;
out float vBlur;
out float vH;
out vec3 vRim;

vec2 proj(vec3 P) {
  vec3 d = normalize(P - uCam);
  vec3 c = vec3(dot(d, uR), dot(d, uU), dot(d, uF));
  return 2.0 * c.xy / max(1.0 + c.z, 1e-3) * uK + uO;
}

// A hue turn about the grey axis (Rodrigues), radians.
vec3 hueTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

void main() {
  // The wind where the tip is on screen (the grid covers the frame in image uv).
  vec2 t = proj(aTip);
  vec2 iuv = uView.xy + vec2(t.x * 0.5 + 0.5, 0.5 - t.y * 0.5) * uView.zw;
  vec4 W = textureLod(uWind, iuv, 0.0);
  vec2 b = W.xy;          // bend: across (+ right), and away (+)
  float ws = length(W.zw);
  // across is the lens's right, laid level; away is level, ahead (screen
  // down: the lens looks straight up, so ahead is its down)
  vec3 rx = normalize(vec3(uR.xy, 0.0));
  vec3 fz = normalize(vec3(-uU.xy, 0.0));
  float lv = aK.x;
  // flutter: the thin leaves and seed heads quiver in the stronger air
  float fl = sin(uTime * (4.0 + 1.3 * sin(aK.z)) + aK.z * 3.0) * smoothstep(1.5, 9.0, ws);
  vec3 dsp = (rx * (b.x + 0.06 * fl) + fz * 0.6 * b.y) * lv;
  // lying over, the tip comes down
  dsp.z -= 0.9 * dot(b, b) * lv * lv / max(0.05, length(aTip - aP) + lv);
  vec3 P = aP + dsp;
  vec2 c0 = proj(P);
  vec2 sp = (proj(P + aS) - c0) * uRes * 0.5;
  float hw = length(sp);
  // never thinner than ~0.8 px: a hair-thin pedicel keeps its width and
  // gives up coverage instead, so it neither breaks up nor crawls
  const float MINW = 0.8;
  vA = 1.0;
  if (hw < MINW) {
    vA = hw / MINW;
    sp *= MINW / max(hw, 1e-6);
  }
  // Depth of field: the lens is focused about half a metre out, on the
  // anchor; a blade nearer than that spreads into a disc of confusion that
  // grows as 1/distance, so the few at your cheek go soft and wide while the
  // anchor stays sharp. The ribbon is widened by the disc's radius and the
  // fragment shader spreads the blade's coverage across it (a box blur of a
  // box, exact), so a thin blade out of focus also goes thinner in value.
  float hwp = max(hw, MINW);
  float bl = aF * uRes.y * 0.0042 * clamp(0.5 / length(P - uCam) - 1.0, 0.0, 6.0);
  sp *= (hwp + bl) / hwp;
  vHalf = hwp;
  vBlur = bl;
  vH = P.z;
  vec2 ndc = c0 + sp / (uRes * 0.5);
  vNdc = ndc;
  // Each plant its own: about +-6 deg of hue and +-10% of value, so the
  // field reads as separate blades rather than one olive.
  float h1 = fract(aB.z * 13.731);
  float h2 = fract(aB.z * 71.377 + 0.31);
  vCol = max(hueTurn(aCol, (h1 - 0.5) * 2.0 * 0.105), vec3(0.0)) * (0.9 + 0.2 * h2);
  // and its rim, the light through its margin, its own too: from a cool
  // sap green to a warm straw, brighter on some than others
  float h3 = fract(aB.z * 37.913 + 0.67);
  vRim = max(hueTurn(vec3(0.6, 0.58, 0.1), (h3 - 0.45) * 0.42), vec3(0.0)) * (0.75 + 0.5 * h2);
  if (uDebug > 0.5) vCol = mix(vCol, vec3(1.0, 0.2, 0.1), clamp(length(b) * lv * 6.0, 0.0, 1.0));
  vTrans = aK.y;
  vAlong = aB.x;
  vAcross = aB.y;
  vDepth = aD;
  // Which edge faces the sun: this vertex's offset from the centreline
  // against the way to the sun, on screen. The pair's offsets are opposite,
  // so across the width it runs from +1 on the sunward edge to -1, faded
  // out where the blade points at the sun and neither edge faces it.
  vec2 toSun = (uSun - c0) * uRes * 0.5;
  float q = dot(sp / max(length(sp), 1e-6), toSun / max(length(toSun), 1e-6));
  vSunward = sign(q) * smoothstep(0.15, 0.6, abs(q));
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const GRASS_FRAG = `#version 300 es
precision highp float;
in vec3 vCol;
in float vA;
in float vTrans;
in vec2 vNdc;
in float vAlong;
in float vAcross;
in float vSunward;
in float vDepth;
in float vHalf;           // the blade's half-width here, px
in float vBlur;           // its disc of confusion, px
in float vH;              // height above the ground, m
in vec3 vRim;             // the light through its margin, this plant's own
uniform vec2 uSun;        // the sun on screen, NDC
uniform float uAspect;
uniform vec4 uView;       // image uv on screen
uniform sampler2D uSky;   // the sky photograph, sRGB
uniform float uSkyLod;    // a soft level of it: what is behind, not its texture
out vec4 outColor;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

void main() {
  // A grass leaf against the light: a silhouette. Its body is near-black
  // deep green (the vertex colour, #0F1A0C to #1C2A14 printed), the light
  // only reaching you through its thin sunward margin, so the field is a
  // ring of dark shapes framing the sky and the rims draw it.
  // Root to tip: the base sits in the shade of the sward; the tip is thin
  // and up in the light, a little less dark.
  float s = clamp(vAlong, 0.0, 1.0);
  float lift = mix(0.8, 1.1, smoothstep(0.0, 1.0, pow(s, 0.8)));
  vec3 c = vCol * lift;
  // where across the blade itself this is, px, and how much of the pixel
  // the defocused blade covers: the overlap of the blade with the disc
  float px = vAcross * (vHalf + vBlur);
  float bb = max(vBlur, 1e-3);
  float dof = vBlur < 0.05 ? 1.0 : clamp((min(vHalf, px + bb) - max(-vHalf, px - bb)) / (2.0 * bb), 0.0, 1.0);
  float x = clamp(px / vHalf, -1.0, 1.0);
  float lit = clamp(vTrans, 0.0, 1.0);

  // What is behind the leaf: the sky photograph at this point, softened.
  // Lit cloud is what shines through; open blue (no red in it) barely does.
  vec2 uv = uView.xy + vec2(vNdc.x * 0.5 + 0.5, 0.5 - vNdc.y * 0.5) * uView.zw;
  vec3 sky = toLin(textureLod(uSky, uv, uSkyLod).rgb);
  vec3 skyFar = toLin(textureLod(uSky, uv, uSkyLod + 2.0).rgb);
  float cloud = smoothstep(0.12, 0.7, min(sky.r, sky.g));
  vec2 d = (vNdc - uSun) * vec2(uAspect, 1.0);
  float sn = exp(-dot(d, d) / 0.35);
  float behind = max(cloud, 0.45 * sn);
  // Down in the sward the light has come through every blade above it: the
  // lower a stretch of leaf stands, the darker it is.
  float sward = smoothstep(0.06, 0.5, vH);
  c *= mix(0.55, 1.0, sward);
  // Transmission through the body: only a whisper of yellow-green, toward
  // the thin tip with bright cloud behind; the body stays dark.
  const vec3 TRANS = vec3(0.337, 0.431, 0.069);
  float tw = lit * behind * s * s * sward;
  c += TRANS * 0.03 * tw;
  // Across: a shallow trough, the edges a little darker than the middle.
  c *= mix(0.8, 1.0, sqrt(max(0.0, 1.0 - x * x)));
  // The air between you and a blade: a pace or two of it, no more, so it
  // only cools the farthest blades a touch toward the sky's hue at a low
  // value. Still opaque and darker than what is behind it, never a ghost.
  float dep = clamp(vDepth, 0.0, 1.0);
  float air = lit * (0.02 + 0.05 * smoothstep(0.0, 1.0, dep));
  vec3 tint = mix(vec3(0.78, 1.0, 0.5), vec3(0.94, 0.98, 1.0), smoothstep(0.2, 0.9, dep));
  c = mix(c, skyFar * tint * 0.3, air);
  // The sun-facing edge: a thin yellow-green rim where the light grazes
  // through the leaf's margin, the only colour the field shows. Brighter
  // toward the sun and with bright cloud behind; the air dims it a little.
  // Only the margin itself, a pixel or two in from the sunward edge (a
  // little more on a wide blade), so a broad leaf stays dark through its
  // body with one bright line along a side; on a hair-thin tip the margin
  // is the whole blade, so it is held back there.
  // Out of focus the line spreads over the blade's disc of confusion, its
  // light shared out over it, so a soft blade gets a soft dim rim, not a
  // broad bright band over its whole blurred skirt.
  float rw = 0.9 + 0.08 * vHalf;
  float edge = exp(-max(0.0, vHalf - abs(px)) / (rw + vBlur)) * rw / (rw + 1.5 * vBlur);
  float rim = smoothstep(0.2, 0.75, vSunward) * edge;
  float rimK = (0.7 + 0.7 * sn + 0.6 * behind) * mix(0.6, 1.0, s) * (1.0 - 0.2 * dep) * mix(0.6, 1.0, sward);
  rimK *= mix(0.5, 1.0, smoothstep(0.8, 2.5, vHalf));
  c += vRim * rim * rimK * (0.03 + 0.97 * lit);
  // opaque at every distance: a blade's coverage is its own, near or far
  float cov = vA * dof;
  outColor = vec4(c * cov, cov);
}`;
