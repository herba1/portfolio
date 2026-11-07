// The grass, as geometry: the stalks seen from where you lie, worm's-eye.
//
// The camera sits 4 cm off the ground and looks up through a wide (116 deg)
// stereographic lens, pitched so the zenith, where every upright stalk points,
// lands just above the top of the frame. Every blade is rooted on the ground
// below the bottom edge and runs up toward that vanishing point: the ones at
// your shoulder run long and nearly the full height of the frame, the field
// behind only reaches in as a low fringe. Built once, here, as world-space
// ribbons (a blade, a culm, a pedicel, a spikelet), each a centreline with its
// half-width turned to face the lens; the vertex shader projects them, bends
// them about their roots under the wind and keeps any sliver at least a
// device pixel wide (fading its coverage instead), and they are drawn opaque
// into 4x MSAA targets, premultiplied, so every edge is the blade's own
// coverage of the pixel: no matte, no alpha test, no fringe of another colour.
//
// Two layers: the anchors (three culms with seed heads at your shoulder,
// near-black olive, full resolution, sharp) and the rest (half resolution, so
// slightly diffused behind them).

const DEG = Math.PI / 180;

// The lens. FOV is across the longer side of the frame; VP is where the
// zenith sits, in NDC of the shorter side's axis, just past the top edge;
// ROLL turns it a little to the right of centre.
export const CAM = { h: 0.04, fov: 116, vp: 1.12, roll: 7 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.max(1e-9, Math.hypot(a[0], a[1], a[2])));

// The camera for a W x H frame: position, basis (right, up, forward) and the
// stereographic scale to NDC.
export function camera(W, H) {
  const R = 2 * Math.tan((CAM.fov * DEG) / 4);
  // Stereographic: a direction at angle t from the axis lands at 2 tan(t/2).
  // A tall screen keeps the wide frame's vertical reach (about 40 deg either
  // side of the axis) and gives up width, so it never looks down past the
  // grass to the horizon.
  const ky = W >= H ? W / H / R : Math.max(1 / R, 1 / (2 * Math.tan(20 * DEG)));
  const k = [(ky * H) / W, ky];
  const half = 2 * Math.atan(1 / ky / 2);
  const tz = 2 * Math.atan(CAM.vp / k[1] / Math.cos(CAM.roll * DEG) / 2);
  const el = Math.max(Math.PI / 2 - tz, half + 9 * DEG);
  const f = [0, Math.cos(el), Math.sin(el)];
  const r0 = [1, 0, 0];
  const u0 = cross(r0, f);
  const c = Math.cos(CAM.roll * DEG);
  const s = Math.sin(CAM.roll * DEG);
  const r = add(mul(r0, c), mul(u0, s));
  const u = sub(mul(u0, c), mul(r0, s));
  return { pos: [0, 0, CAM.h], r, u, f, k };
}

export function project(cam, P) {
  const d = norm(sub(P, cam.pos));
  const z = dot(d, cam.f);
  const q = 2 / Math.max(1e-3, 1 + z);
  return [dot(d, cam.r) * q * cam.k[0], dot(d, cam.u) * q * cam.k[1]];
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
// its tip); n segments over length L. Returns points and unit tangents.
function curve(p0, az, a0, bend, bp, L, n, h) {
  const hz = h || [Math.sin(az), Math.cos(az), 0];
  const pts = [p0];
  const tan = [];
  let p = p0;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const a = a0 + bend * Math.pow(s, bp);
    const d = add(mul(hz, Math.sin(a)), [0, 0, Math.cos(a)]);
    tan.push(d);
    if (i < n) {
      const sm = (i + 0.5) / n;
      const am = a0 + bend * Math.pow(sm, bp);
      p = add(p, mul(add(mul(hz, Math.sin(am)), [0, 0, Math.cos(am)]), L / n));
      pts.push(p);
    }
  }
  return { pts, tan };
}

// Width profiles, s in 0..1 along the ribbon, as a fraction of its widest.
const PROFILE = {
  // a grass leaf: full width most of its length, then a long point
  leaf: (s) => Math.pow(Math.min(1, (1 - s) / 0.5), 0.85) * (0.5 + 0.5 * Math.min(1, s * 5)),
  // a culm: tapering a little toward the top
  culm: (s) => 1 - 0.45 * s,
  // a pedicel: hair-thin all along
  hair: () => 1,
  // a spikelet: a narrow lance, widest past its middle, drawn out into an awn
  spike: (s) => (s < 0.75 ? Math.pow(Math.sin(Math.PI * (0.08 + (0.84 * s) / 0.75)), 0.7) : (0.16 * (1 - s)) / 0.25),
};

// Vertex layout: P(3) S(3) tip(3) col(3) lever, trans, phase, then the
// shading frame: along (0 root .. 1 tip), across (-1 .. 1), the plant's seed.
export const STRIDE = 18;

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
        v.push(P[0], P[1], P[2], side[0] * w * sg, side[1] * w * sg, side[2] * w * sg, tip[0], tip[1], tip[2], col[0], col[1], col[2], lv, trans, phase, al, sg, seed);
      }
      if (i < n - 1) {
        const a = nv + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    nv += n * 2;
  };
  return { ribbon, out: () => ({ verts: new Float32Array(v), index: new Uint32Array(idx), count: idx.length }) };
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
  const stem = curve(root, az, lean, o.nod ?? 0.75, 5, L, segs);
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

function leaf(b, R, o) {
  const { root, az, L, w0, c0, c1, trans, segs } = o;
  const lc = curve(root, az, o.lean, o.bend, 1.8, L, segs);
  const tip = lc.pts[lc.pts.length - 1];
  const tw = R() * 6.283;
  const twr = (R() - 0.5) * 5;
  const ph = R() * 6.283;
  b.ribbon(lc, (s) => w0 * PROFILE.leaf(s) * (0.3 + 0.7 * Math.abs(Math.cos(tw + twr * s))), tip, (s) => AMP * L * s * s, c0, c1, trans, ph);
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
  const R = rng(7);
  const near = builder(cam);
  const rest = builder(cam);
  const at = (D, phi) => [D * Math.sin(phi * DEG), D * Math.cos(phi * DEG), 0];

  // ---- the anchors: three brome culms at your shoulder ----
  const ink = lin(0x1c2414);
  const inkTip = lin(0x232d18);
  const anchors = [
    { D: 0.17, phi: -40, L: 0.98, az: 60, lean: 0.07, nod: 1.6, leaves: 0 },
    { D: 0.22, phi: -16, L: 0.9, az: 100, lean: 0.05, nod: 1.4, leaves: 0 },
    { D: 0.2, phi: 30, L: 0.95, az: -70, lean: 0.06, nod: 1.7, leaves: 0 },
  ];
  for (const a of anchors) {
    culmWithHead(near, R, {
      root: at(a.D, a.phi),
      az: a.az * DEG,
      lean: a.lean,
      nod: a.nod,
      L: a.L,
      w0: 0.0017,
      cStem: ink,
      cTip: inkTip,
      cHead: ink,
      trans: 0,
      segs: 72,
      leaves: a.leaves,
      whorls: 6,
      big: 1.25,
    });
  }

  // ---- the rest, far to near (painter's order), half resolution ----
  const items = [];
  // culms with heads
  for (let i = 0; i < 60; i++) {
    const D = 0.45 + 2.2 * Math.pow(R(), 1.15);
    const phi = (R() - 0.5) * 230;
    const L = 0.55 + 0.6 * R();
    items.push({ kind: "culm", D, phi, L });
  }
  // leaves, in tufts
  for (let i = 0; i < 210; i++) {
    const D = 0.4 + 2.9 * Math.pow(R(), 0.8);
    const phi = (R() - 0.5) * 220;
    const n = 2 + Math.floor(R() * 3);
    for (let j = 0; j < n; j++) items.push({ kind: "leaf", D: D + (R() - 0.5) * 0.04, phi: phi + (R() - 0.5) * 4, L: 0.25 + 0.45 * R(), j });
  }
  // the field beyond: short leaves a few paces off, seen nearly edge-on,
  // closing the foot of the frame so no horizon shows between the stalks
  for (let i = 0; i < 280; i++) {
    const D = 1.2 + 2.6 * R();
    const phi = (R() - 0.5) * 200;
    for (let j = 0; j < 2; j++) items.push({ kind: "leaf", D: D + (R() - 0.5) * 0.05, phi: phi + (R() - 0.5) * 2, L: 0.35 + 0.3 * R(), j, field: 1 });
  }
  // the low mat: short leaves a pace or so off, a dark fringe along the foot
  // of the frame that the stalks rise out of
  for (let i = 0; i < 70; i++) {
    const D = 0.45 + 0.9 * R();
    const phi = (R() - 0.5) * 200;
    for (let j = 0; j < 3; j++) items.push({ kind: "leaf", D: D + (R() - 0.5) * 0.04, phi: phi + (R() - 0.5) * 5, L: 0.16 + 0.2 * R(), j, mat: 1 });
  }
  // one that crosses the sun, in from the left edge, for the halation to catch
  items.push({ kind: "culm", D: 0.32, phi: -60.5, L: 0.95, lean: 0.0 });
  items.sort((p, q) => q.D - p.D);
  for (const it of items) {
    const root = at(it.D, it.phi);
    if (!inFrame(root, it.L)) continue;
    // depth tone: the nearer stalks stand dark against the sky, the field
    // behind is a lighter, greyer olive (more sky between you and it)
    const far = it.mat ? 0.15 : it.field ? 0.85 : Math.min(1, Math.max(0, (it.D - 0.45) / 2.3));
    const vary = 0.82 + 0.36 * R();
    const dry = R() < 0.12 ? 0.5 : 0;
    const base = mix3(mix3(lin(0x24301a), lin(0x3a4824), far), lin(0x4b4a24), dry * 0.6).map((c) => c * vary);
    const tipC = mix3(mix3(lin(0x3c4b20), lin(0x67763c), far), lin(0x7a7434), dry).map((c) => c * vary);
    const segs = Math.round(14 + 26 * (1 - far));
    if (it.kind === "culm") {
      culmWithHead(rest, R, {
        root,
        az: R() * 6.283,
        lean: it.lean ?? 0.04 + 0.12 * R(),
        nod: 0.5 + 0.6 * R(),
        L: it.L,
        w0: it.D < 0.4 ? 0.0016 : 0.0011 + 0.0006 * R(),
        cStem: base,
        cTip: tipC,
        cHead: mix3(base, lin(0x55552c), 0.35),
        trans: 1,
        segs,
        leaves: R() < 0.6 ? 1 : 0,
        whorls: 3 + Math.floor(R() * 2),
      });
    } else {
      leaf(rest, R, {
        root,
        az: R() * 6.283,
        lean: it.lean ?? 0.05 + 0.3 * R(),
        bend: it.bend ?? 0.15 + 0.7 * R(),
        L: it.L,
        w0: (0.0017 + 0.0016 * R()) * (it.field ? 1.8 : 1),
        c0: base,
        c1: tipC,
        trans: 1,
        segs: it.field ? 10 : segs,
      });
    }
  }
  return { near: near.out(), rest: rest.out() };
}

export const GRASS_VERT = `#version 300 es
in vec3 aP;      // centreline point, world (m)
in vec3 aS;      // signed half-width, world, facing the lens
in vec3 aTip;    // the stalk's tip: where it reads the wind
in vec3 aCol;    // linear colour
in vec3 aK;      // lever (m of travel per unit bend), translucency, phase
in vec3 aB;      // along (0 root .. 1 tip), across (-1 .. 1), the plant's seed
uniform vec3 uCam;
uniform vec3 uR;
uniform vec3 uU;
uniform vec3 uF;
uniform vec2 uK;
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

vec2 proj(vec3 P) {
  vec3 d = normalize(P - uCam);
  vec3 c = vec3(dot(d, uR), dot(d, uU), dot(d, uF));
  return 2.0 * c.xy / max(1.0 + c.z, 1e-3) * uK;
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
  // across is the lens's right, laid level; away is level, ahead
  vec3 rx = normalize(vec3(uR.xy, 0.0));
  vec3 fz = normalize(vec3(uF.xy, 0.0));
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
  vec2 ndc = c0 + sp / (uRes * 0.5);
  vNdc = ndc;
  // Each plant its own: about +-6 deg of hue and +-10% of value, so the
  // field reads as separate blades rather than one olive.
  float h1 = fract(aB.z * 13.731);
  float h2 = fract(aB.z * 71.377 + 0.31);
  vCol = max(hueTurn(aCol, (h1 - 0.5) * 2.0 * 0.105), vec3(0.0)) * (0.9 + 0.2 * h2);
  if (uDebug > 0.5) vCol = mix(vCol, vec3(1.0, 0.2, 0.1), clamp(length(b) * lv * 6.0, 0.0, 1.0));
  vTrans = aK.y;
  vAlong = aB.x;
  vAcross = aB.y;
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
uniform vec2 uSun;        // the sun on screen, NDC
uniform float uAspect;
uniform vec4 uView;       // image uv on screen
uniform sampler2D uSky;   // the sky photograph, sRGB
uniform float uSkyLod;    // a soft level of it: what is behind, not its texture
out vec4 outColor;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

void main() {
  // A grass leaf against the light, not a flat ribbon.
  // Root to tip: the base sits in the shade of the sward and is thick; the
  // tip is thin and up in the light.
  float s = clamp(vAlong, 0.0, 1.0);
  float lift = mix(0.55, 1.15, smoothstep(0.0, 1.0, pow(s, 0.8)));
  vec3 c = vCol * lift;
  float x = clamp(vAcross, -1.0, 1.0);

  // What is behind the leaf: the sky photograph at this point, softened.
  // Lit cloud is what shines through; open blue (no red in it) barely does.
  vec2 uv = uView.xy + vec2(vNdc.x * 0.5 + 0.5, 0.5 - vNdc.y * 0.5) * uView.zw;
  vec3 sky = toLin(textureLod(uSky, uv, uSkyLod).rgb);
  float cloud = smoothstep(0.12, 0.7, min(sky.r, sky.g));
  vec2 d = (vNdc - uSun) * vec2(uAspect, 1.0);
  float sn = exp(-dot(d, d) / 0.35);
  float behind = max(cloud, 0.45 * sn);
  // Transmission: a thin blade with bright sky behind glows a translucent
  // yellow-green (#9DB04A), stronger toward the thin tip, less down the
  // thicker midrib. The anchors carry none and stay ink.
  const vec3 TRANS = vec3(0.337, 0.431, 0.069);
  float tw = vTrans * behind * mix(0.35, 1.0, s);
  c = mix(c, TRANS * mix(0.55, 1.0, s), 0.72 * tw);
  // Across, over both: a shallow trough read as a cylinder, the edges about
  // a quarter darker, and a soft paler midrib down the centre.
  float cyl = mix(0.75, 1.0, sqrt(max(0.0, 1.0 - x * x)));
  float rib = 1.0 + 0.12 * exp(-x * x / 0.02);
  c *= cyl * rib;
  // The sun-facing edge: a thin brighter rim where the light grazes through
  // the leaf's margin, strongest with bright sky behind.
  float rim = smoothstep(0.5, 0.92, vSunward);
  c += TRANS * rim * (0.08 + 0.34 * behind) * (0.04 + 0.96 * vTrans) * mix(0.5, 1.0, s);
  outColor = vec4(c * vA, vA);
}`;
