import { createStage, clamp, damp } from "../_kit/stage";

// After Lance Wyman's Mexico 68: a heavy word whose outline is echoed outward
// in parallel lines, as wide as the gaps between them, until type and pattern
// are one field.
//
// The word is set in Geist 700, glyph by glyph with every gap between letters
// exactly two line periods, and each glyph is turned into a signed distance
// field on the CPU (Felzenszwalb's exact transform, seeded from the canvas's
// own anti-aliasing the way Mapbox's TinySDF does, so edges keep their
// sub-pixel position). The lines are level sets of the glyph fields'
// smooth union, drawn in a shader with derivative-width anti-aliasing at
// device resolution.
//
// Counters stay paper. Each glyph is closed by a disc of 1.5 periods; the
// paper that closing encloses is counter. A counter that opens through an
// aperture (the c, the e's mouth, the h's arch) is cleared, and so is any
// part of an enclosed one too tight for a ring, so the e's eye is paper while
// the o keeps a whole ring. Outside the letters the rings follow the closed
// glyph, so a line crosses a mouth instead of diving into it as a slit.
//
// The first few echoes hug the letters; past them the field anneals onto one
// stadium fitted to the word, so the creases between letters die out within
// a few rings and the outer bands are clean concentric lines to the frame.
//
// Every press drops a source that stays. A source is a dot whose rings run
// at their own period, finer the more sources already crowd the spot, and it
// blooms on the press by pushing a few rings of its own out into the field.
// All sources and the word are unioned in ring space: each field is divided
// by its own period first, so ring n of one meets ring n of the next on the
// crease between them however fine either is. A fine source wins only a
// bounded patch around itself (an Apollonius disc), so the picture builds up
// out of the presses as patches of crowded line, nested where presses pile up
// and bunching into chevrons where patches meet.
//
// The union is a true min, rounded over a narrow band at the creases, and it
// cannot reach the letters: inside the word's own first rings only the word
// draws, and a source that comes closer is flattened onto contours parallel
// to the letter instead of cutting into it. The pointer carries the next
// source before it is dropped.
//
// ?x=&y= (0..1 of the box) hold the pointer's dot; ?n= replays that many
// presses (a fixed sequence, the last one at x, y); ?t= (0..1) holds the last
// press mid-bloom.

const WORD = "echo";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const INK = [0x14 / 255, 0x13 / 255, 0x12 / 255];
// Sources kept; the oldest lets go when a press would exceed it.
const MAX_SOURCES = 20;
// Shader slots: the kept sources, one letting go, and the pointer's.
const SLOTS = MAX_SOURCES + 2;
const BLOOM_MS = 1700;
const RETIRE_MS = 1400;
// A first source's period, against the word's; each source already near the
// spot makes the next one finer by FINER, down to MIN_PERIOD.
const FIRST_PERIOD = 0.5;
const FINER = 0.66;
const MIN_PERIOD = 0.2;
// Rings a source pushes out when it blooms, before the crowd adds more.
const BLOOM_RINGS = 4;
// Inradius, in periods, a counter needs to keep its rings.
const RING_ROOM = 1.5;
// Radius, in periods, of the closing the rings outside a letter follow: wide
// enough that a line crossing a mouth runs nearly straight.
const BRIDGE = 3;
// Periods out from the letters over which the rings let go of the word and
// settle onto one stadium: rings inside the first hug the type exactly,
// rings past the second are clean concentric bands.
const ANNEAL = [3, 9];
// Presses replayed by ?n=, as fractions of the box: two clusters, so the
// replay shows patches nesting as well as meeting.
const SCRIPT = [
  [0.14, 0.26],
  [0.2, 0.19],
  [0.86, 0.22],
  [0.8, 0.77],
  [0.87, 0.67],
  [0.24, 0.8],
  [0.17, 0.31],
  [0.5, 0.14],
];

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform highp sampler2D uSdf;
uniform highp sampler2D uEdge;   // counter paper, exact letter union
uniform ivec2 uTexSize;
uniform float uGrid;       // field texels per css px
uniform vec2 uRes;         // device px
uniform float uDpr;
uniform float uP;          // line period, css px (line = gap = P/2)
uniform vec4 uSrc[${SLOTS}];  // xy css px, period css px, rings pushed out
uniform int uSrcN;
uniform float uK;          // crease rounding, in rings
uniform float uKg;         // smooth-union width between letters, css px
uniform float uHug;        // how steeply a source is flattened near a letter
uniform float uReveal;     // css px of field drawn so far (intro)
uniform vec4 uBox;         // far-field stadium: centre, half size (css px)
uniform vec2 uAnneal;      // css px: the word's field lets go over [x, y]
uniform vec3 uInk;
uniform vec3 uPaper;
out vec4 o;

// Polynomial smooth minimum (Quilez): a crease between two sources is
// rounded over a band k wide instead of meeting at a sharp mitre.
float smin(float a, float b, float k){
  if (k < 1e-3) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// One glyph per channel, bilinear by hand (float textures are not filterable
// everywhere).
vec4 glyphs(vec2 p){
  vec2 u = p * uGrid - 0.5;
  vec2 f = fract(u);
  ivec2 i = ivec2(floor(u));
  ivec2 m = uTexSize - 1;
  vec4 a = texelFetch(uSdf, clamp(i, ivec2(0), m), 0);
  vec4 b = texelFetch(uSdf, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 c = texelFetch(uSdf, clamp(i + ivec2(0, 1), ivec2(0), m), 0);
  vec4 d = texelFetch(uSdf, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The glyphs smoothly unioned over a band k wide. Letters sit two periods
// apart, wider than uKg, so the union never moves a letter's own edge.
float join(vec4 g, float k){
  return smin(smin(smin(g.x, g.y, k), g.z, k), g.w, k);
}

// x: signed distance into the counter paper no ring may cross; y: the
// letters' own exact field, which draws their edges. Both css px.
vec2 edgeField(vec2 p){
  vec2 u = p * uGrid - 0.5;
  vec2 f = fract(u);
  ivec2 i = ivec2(floor(u));
  ivec2 m = uTexSize - 1;
  vec2 a = texelFetch(uEdge, clamp(i, ivec2(0), m), 0).rg;
  vec2 b = texelFetch(uEdge, clamp(i + ivec2(1, 0), ivec2(0), m), 0).rg;
  vec2 c = texelFetch(uEdge, clamp(i + ivec2(0, 1), ivec2(0), m), 0).rg;
  vec2 d = texelFetch(uEdge, clamp(i + ivec2(1, 1), ivec2(0), m), 0).rg;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Signed distance to the stadium fitted to the word's field where the
// anneal begins, offset so the two agree there.
float stadium(vec2 p){
  vec2 q = abs(p - uBox.xy) - uBox.zw + uBox.w;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uBox.w + uAnneal.x;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  // Anneal: close in, the rings follow the letters; a few echoes out they
  // settle onto the stadium, so the creases between letters die out instead
  // of running straight to the frame.
  float dw = join(glyphs(p), uKg);
  float d = mix(dw, stadium(p), smoothstep(uAnneal.x, uAnneal.y, dw));
  vec2 e = edgeField(p);
  float cz = e.x;
  float fl = e.y;

  // Everything below is in rings: a field divided by its own period, so
  // ring n of every source is the level set n of its phase.
  float pw = d / uP;
  // The word's first black ring ends at 1, its next paper ring is centred
  // on 1.25; nothing but the word draws inside that, and the creases only
  // round off a ring or two further out.
  float k = uK * smoothstep(1.25, 3.0, pw);
  float ps = 1e5;
  float hard = 1e5;
  float coreAt = 0.0;  // the core's edge, in rings, of the nearest source
  float coreP = uP;
  for (int i = 0; i < ${SLOTS}; i++) {
    if (i >= uSrcN) break;
    vec4 s = uSrc[i];
    float r0 = s.z * 0.55;
    float psi = (length(p - s.xy) - r0) / s.z - s.w;
    ps = smin(ps, psi, k);
    if (psi < hard) {
      hard = psi;
      coreAt = -s.w;
      coreP = s.z;
    }
  }
  // Near a letter a source may not go below C: where it would, it is laid
  // onto contours of the word's own field, falling away outward, so its
  // rings bend round the letter's first ring instead of cutting into it.
  float C = 1.25 - uHug * (pw - 1.25);
  float f = smin(pw, max(ps, C), k);
  float g = f * uP;

  float fw = max(fwidth(g), 1e-4);
  float fe = max(fwidth(fl), 1e-4);
  // A source's core: its phase below the level its rings start from. Where
  // the word holds the field the phase never gets there, so a dot pressed
  // against a letter loses its core rather than melting into it.
  float core = hard > f + 0.5 ? 1e5 : (f - coreAt) * coreP;
  float fc = max(fwidth(f) * coreP, 1e-4);
  float ink;
  if (fl <= 0.0) {
    ink = 1.0;
  } else {
    // Ring n occupies g in [nP + P/2, nP + P); during the intro each ring
    // swells to full width in turn as the reveal passes it.
    float n = floor(g / uP);
    float grow = clamp((uReveal - n * uP) / (uP * 2.5), 0.0, 1.0);
    grow = 1.0 - pow(1.0 - grow, 3.0);
    float half_ = uP * 0.25 * grow;
    float dist = abs(g - (n + 0.75) * uP);
    // A counter too tight for a ring stays paper: a line running into one
    // ends at its edge in a round cap instead of being sliced off.
    dist = length(vec2(dist, max(cz + half_, 0.0)));
    // Box-filtered coverage; a line thinner than a pixel covers only its own
    // width, so an unborn ring is nothing rather than a grey hairline.
    ink = min(clamp((half_ - dist) / fw + 0.5, 0.0, 1.0), 2.0 * half_ / fw);
    // Below the word's first ring only a source's rings may draw: a word
    // ring there would sit in the cleared paper of a counter.
    if (n < 0.0) ink *= clamp((d - uP * 0.5) / fe + 0.5, 0.0, 1.0);
    ink = max(ink, clamp(0.5 - core / fc, 0.0, 1.0));
  }
  // Letter edge, anti-aliased on the unshifted field.
  ink = max(ink, clamp(0.5 - fl / fe, 0.0, 1.0));
  o = vec4(mix(uPaper, uInk, ink), 1.0);
}`;

// ---- signed distance field (after mapbox/tiny-sdf) ----

const INF = 1e20;

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt(grid, w, h, f, v, z, x0 = 0, x1 = w) {
  // Columns outside [x0, x1) hold no seed, so their vertical pass would leave
  // them untouched; skip it.
  for (let x = x0; x < x1; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

// Three box passes each way, a near-Gaussian of sigma ~ r, edges clamped.
function boxPass(src, dst, count, stride, lines, lineStride, r) {
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStride;
    const last = o + (count - 1) * stride;
    let acc = src[o] * (r + 1);
    for (let j = 1; j <= r; j++) acc += src[o + Math.min(j, count - 1) * stride];
    for (let j = 0; j < count; j++) {
      dst[o + j * stride] = acc * inv;
      const add = j + r + 1 < count ? o + (j + r + 1) * stride : last;
      const sub = j - r >= 0 ? o + (j - r) * stride : o;
      acc += src[add] - src[sub];
    }
  }
}

function blur(a, tmp, w, h, r) {
  for (let p = 0; p < 3; p++) {
    boxPass(a, tmp, w, 1, h, w, r);
    boxPass(tmp, a, h, w, w, 1, r);
  }
}

// Distance in texels from every texel of an lw x lh box to the nearest texel
// where `seed` holds (1e10 when none does).
function distTo(seed, lw, lh, f, v, z) {
  const g = new Float32Array(lw * lh);
  for (let i = 0; i < g.length; i++) g[i] = seed(i) ? 0 : INF;
  edt(g, lw, lh, f, v, z);
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i]);
  return g;
}

// Distance in texels from a shape given as per-texel coverage: to its edge
// from outside (side 1) or from inside (side -1), 0 on the other side. Seeded
// from partial coverage as TinySDF does, so the edge keeps its sub-texel
// position.
function edgeDist(cov, side, lw, lh, f, v, z) {
  const g = new Float32Array(lw * lh);
  for (let i = 0; i < g.length; i++) {
    const a = side > 0 ? cov[i] : 1 - cov[i];
    const o = Math.max(0, 0.5 - a);
    g[i] = a >= 1 ? 0 : a <= 0 ? INF : o * o;
  }
  edt(g, lw, lh, f, v, z);
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i]);
  return g;
}

// Morphological closing of a glyph by a disc of radius r texels: dilate the
// ink by r, then erode the dilation by r. `d` is the glyph's field in
// texels; the result is the closed shape's coverage.
function closing(d, lw, lh, r, f, v, z) {
  const n = lw * lh;
  const cov = new Float32Array(n);
  for (let i = 0; i < n; i++) cov[i] = clamp(r - d[i] + 0.5, 0, 1);
  const inDil = edgeDist(cov, -1, lw, lh, f, v, z);
  for (let i = 0; i < n; i++) cov[i] = clamp(inDil[i] - r + 0.5, 0, 1);
  return cov;
}

// A glyph's counters, kept as paper. `d` is the glyph's signed distance (css
// px) over the box. Returns `clear`, the signed distance (css px, positive
// inside) of the counter paper too narrow to hold a ring, or null when there
// is none, and `ring`, the field the rings follow: outside the letter, the
// distance to the glyph closed by a disc of radius rb, so a line passes
// across a mouth instead of diving into it.
//
// Counters are the paper the glyph encloses once its ink is closed by a disc
// of radius rc: the e's eye and aperture, the c's aperture and bowl, the
// inside of the o, the h's arch. A counter that opens through an aperture is
// cleared whole. Of an enclosed one, whatever a disc of radius rt cannot
// reach is cleared; a counter roomy enough for that disc keeps whole
// white-black-white rings.
function counterClear(d, lw, lh, grid, period, rc, rb, rt, f, v, z) {
  const n = lw * lh;
  const dt = new Float32Array(n);
  for (let i = 0; i < n; i++) dt[i] = d[i] * grid;
  const closedC = closing(dt, lw, lh, rc * grid, f, v, z);
  const toBridged = edgeDist(rb === rc ? closedC : closing(dt, lw, lh, rb * grid, f, v, z), 1, lw, lh, f, v, z);
  // Flood the paper from the box's border, once past the closed glyph and
  // once past the ink alone. Paper the first cannot reach is counter; counter
  // the second does reach opens through an aperture.
  const stack = new Int32Array(n);
  const flood = (wall) => {
    const reach = new Uint8Array(n);
    let sp = 0;
    const push = (i) => {
      if (!reach[i] && !wall(i)) {
        reach[i] = 1;
        stack[sp++] = i;
      }
    };
    for (let x = 0; x < lw; x++) {
      push(x);
      push((lh - 1) * lw + x);
    }
    for (let y = 0; y < lh; y++) {
      push(y * lw);
      push(y * lw + lw - 1);
    }
    while (sp > 0) {
      const i = stack[--sp];
      const y = (i / lw) | 0;
      const x = i - y * lw;
      if (x > 0) push(i - 1);
      if (x < lw - 1) push(i + 1);
      if (y > 0) push(i - lw);
      if (y < lh - 1) push(i + lw);
    }
    return reach;
  };
  const outside = flood((i) => closedC[i] >= 0.5);
  const open = flood((i) => d[i] <= 0);
  const counter = new Uint8Array(n);
  const enclosed = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    counter[i] = d[i] > 0 && !outside[i] ? 1 : 0;
    enclosed[i] = counter[i] && !open[i] ? 1 : 0;
    any ||= counter[i] === 1;
  }
  // Rings: the closed glyph's field outside it, the letter's own inside an
  // enclosed counter. Where the two agree to within a texel, the letter's is
  // kept outright, and from 2.5 to 3.5 periods out the bridge lets go, so
  // the field meets the letter's own again before the box's edge.
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (d[i] <= 0 || enclosed[i]) {
      ring[i] = d[i];
      continue;
    }
    const t = clamp(dt[i] - toBridged[i] - 0.5, 0, 1);
    const u = clamp(3.5 - d[i] / period, 0, 1);
    ring[i] = d[i] - ((dt[i] - toBridged[i]) / grid) * t * t * (3 - 2 * t) * u * u * (3 - 2 * u);
  }
  if (!any) return { clear: null, ring };
  // An open counter (the c's bowl, the e's aperture, the h's arch) is
  // cleared whole: a ring that ran into it could only leave again through
  // the aperture, so it would never close and reads as a slit or needle.
  // An enclosed one keeps the texels a disc of radius rt fits over.
  const inr = distTo((i) => !enclosed[i], lw, lh, f, v, z);
  const fits = distTo((i) => inr[i] > rt * grid, lw, lh, f, v, z);
  const clear = new Uint8Array(n);
  for (let i = 0; i < n; i++) clear[i] = counter[i] && !(enclosed[i] && fits[i] <= rt * grid) ? 1 : 0;
  const toIn = distTo((i) => clear[i], lw, lh, f, v, z);
  const toEdge = distTo((i) => !clear[i], lw, lh, f, v, z);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = (clear[i] ? toEdge[i] - 0.5 : 0.5 - toIn[i]) / grid;
  return { clear: sd, ring };
}

function layout(w, h) {
  // The word fills a little over half the box, centred on its x-height.
  const font = Math.min((w * 0.62) / 2.6, h * 0.46);
  const period = Math.max(6, Math.round(font * 0.074));
  return { font, period };
}

// One glyph's ink, drawn alone, as left and right edge profiles per row
// (sub-pixel, TinySDF's convention: a pixel of coverage a puts the edge
// 1 - a in from its outer side), relative to the glyph's pen origin.
function profile(ctx, ch) {
  ctx.font = ctx.canvas.dataset.font;
  const m = ctx.measureText(ch);
  const left = Math.ceil(m.actualBoundingBoxLeft) + 2;
  const asc = Math.ceil(m.actualBoundingBoxAscent) + 2;
  const gw = left + Math.ceil(m.actualBoundingBoxRight) + 2;
  const gh = asc + Math.ceil(m.actualBoundingBoxDescent) + 2;
  ctx.canvas.width = Math.max(gw, ctx.canvas.width);
  ctx.canvas.height = Math.max(gh, ctx.canvas.height);
  ctx.font = ctx.canvas.dataset.font;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillText(ch, left, asc);
  const img = ctx.getImageData(0, 0, gw, gh).data;
  const rows = [];
  for (let y = 0; y < gh; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < gw; x++) {
      if (img[(y * gw + x) * 4 + 3] > 0) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l < 0) continue;
    const al = img[(y * gw + l) * 4 + 3] / 255;
    const ar = img[(y * gw + r) * 4 + 3] / 255;
    rows.push({ y: y - asc, l: l + 1 - al - left, r: r + ar - left });
  }
  return { rows, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}

// Nearest-ink distance between glyph a and glyph b set `off` to its right.
// Exact while every row of b lies right of every row of a it is nearest to,
// which holds for any pair that is not kerned into each other.
function gapAt(a, b, off) {
  let best = Infinity;
  for (const ra of a.rows) {
    for (const rb of b.rows) {
      const dx = Math.max(0, rb.l + off - ra.r);
      const dy = rb.y - ra.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function buildField(w, h, grid, family) {
  const W = Math.max(2, Math.round(w * grid));
  const H = Math.max(2, Math.round(h * grid));
  const { font, period } = layout(w, h);
  const px = font * grid;
  const fontCss = `700 ${px}px ${family}`;

  // Glyph by glyph, no tracking: this is a distance field, not running text.
  // Each neighbour is moved until the nearest ink of the pair is exactly two
  // periods apart, so the gap holds a white ring, the two letters' first
  // black rings meeting in one crease, and a white ring.
  const mc = document.createElement("canvas");
  mc.dataset.font = fontCss;
  const mctx = mc.getContext("2d", { willReadFrequently: true });
  const glyphs = [...WORD].map((ch) => ({ ch, ...profile(mctx, ch) }));
  const target = 2 * period * grid;
  const pens = [0];
  for (let i = 1; i < glyphs.length; i++) {
    const a = glyphs[i - 1];
    const b = glyphs[i];
    const aR = Math.max(...a.rows.map((r) => r.r));
    const bL = Math.min(...b.rows.map((r) => r.l));
    // Bracket: lo has the bounding boxes touching (gap <= target), hi
    // separates them by the whole target (gap >= target).
    let lo = aR - bL - target;
    let hi = aR - bL + target;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (gapAt(a, b, mid) < target) lo = mid;
      else hi = mid;
    }
    pens.push(pens[i - 1] + (lo + hi) / 2);
  }
  const inkL = glyphs[0].rows.reduce((m, r) => Math.min(m, r.l), Infinity);
  const last = glyphs.length - 1;
  const inkR = pens[last] + glyphs[last].rows.reduce((m, r) => Math.max(m, r.r), -Infinity);
  const asc = Math.max(...glyphs.map((g) => g.asc));
  const desc = Math.max(...glyphs.map((g) => g.desc));
  const x0 = (W - (inkR - inkL)) / 2 - inkL;
  const y0 = H / 2 + (asc - desc) / 2;

  // One exact distance field per glyph, packed one glyph per channel; the
  // shader joins them with a smooth minimum so the creases between letters
  // are rounded instead of the faceted medial axis of a single hard-min EDT.
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.font = fontCss;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";

  const n = W * H;
  const out = new Float32Array(n * 4).fill(1e5);
  const outer = new Float32Array(n);
  const len = Math.max(W, H);
  const f = new Float32Array(len);
  const v = new Uint16Array(len);
  const z = new Float32Array(len + 1);
  const soft = new Float32Array(n);
  const tmp = new Float32Array(n);
  const blurR = Math.max(1, Math.round(period * grid * 0.45));
  // Counter clearing: closing radius, and the inradius a counter needs to
  // keep its rings.
  const rc = period * 1.5;
  const rb = period * BRIDGE;
  const rt = period * RING_ROOM;
  // Second texture: counter paper's signed distance, and the glyphs' exact
  // union, which draws the letter edges while the rings follow `out`.
  const edge = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    edge[i * 2] = -1e5;
    edge[i * 2 + 1] = 1e5;
  }
  glyphs.forEach((g, gi) => {
    const ch = gi % 4;
    ctx.clearRect(0, 0, W, H);
    const gx = x0 + pens[gi];
    ctx.fillText(g.ch, gx, y0);
    const bx0 = Math.max(0, Math.floor(gx + Math.min(...g.rows.map((r) => r.l))) - 2);
    const bx1 = Math.min(W, Math.ceil(gx + Math.max(...g.rows.map((r) => r.r))) + 3);
    const by0 = Math.max(0, Math.floor(y0 - g.asc) - 2);
    const by1 = Math.min(H, Math.ceil(y0 + g.desc) + 3);
    const img = ctx.getImageData(0, 0, W, H).data;
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    const inner = new Float32Array(bw * bh);
    outer.fill(INF);
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const i = y * W + x;
        const j = (y - by0) * bw + (x - bx0);
        const a = img[i * 4 + 3] / 255;
        if (a >= 1) {
          outer[i] = 0;
          inner[j] = INF;
        } else if (a <= 0) {
          inner[j] = 0;
        } else {
          const o = Math.max(0, 0.5 - a);
          const ii = Math.max(0, a - 0.5);
          outer[i] = o * o;
          inner[j] = ii * ii;
        }
      }
    }
    edt(outer, W, H, f, v, z, bx0, bx1);
    edt(inner, bw, bh, f, v, z);
    for (let i = 0; i < n; i++) {
      const y = (i / W) | 0;
      const x = i - y * W;
      let d = Math.sqrt(outer[i]);
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) d -= Math.sqrt(inner[(y - by0) * bw + (x - bx0)]);
      outer[i] = d / grid;
    }
    // A glyph's own creases (an aperture closing, a counter's spine) are
    // sharp ridges in its field, and a ring crossing one tapers to a needle.
    // Away from the letter, the rings follow a blurred copy of the field, so
    // ridges round off; at the letter the exact field holds the edge.
    // Counters, in a box padded past the closing's reach.
    const pad = Math.ceil((Math.max(rc, rb) + period) * grid) + 2;
    const lx0 = Math.max(0, bx0 - pad);
    const ly0 = Math.max(0, by0 - pad);
    const lw = Math.min(W, bx1 + pad) - lx0;
    const lh = Math.min(H, by1 + pad) - ly0;
    const local = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) local[y * lw + x] = outer[(y + ly0) * W + x + lx0];
    for (let i = 0; i < n; i++) edge[i * 2 + 1] = Math.min(edge[i * 2 + 1], outer[i]);
    const { clear, ring } = counterClear(local, lw, lh, grid, period, rc, rb, rt, f, v, z);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const i = (y + ly0) * W + x + lx0;
        const j = y * lw + x;
        outer[i] = ring[j];
        if (clear) edge[i * 2] = Math.max(edge[i * 2], clear[j]);
      }
    }
    soft.set(outer);
    blur(soft, tmp, W, H, blurR);
    for (let i = 0; i < n; i++) {
      const d = outer[i];
      const t = clamp((d - period * 0.25) / period, 0, 1);
      const k = i * 4 + ch;
      out[k] = Math.min(out[k], d + (soft[i] - d) * t * t * (3 - 2 * t));
    }
  });
  return { data: out, edge, W, H, box: fitStadium(out, W, H, grid, period, x0, y0, inkL, inkR, asc, desc) };
}

// The far field's stadium: fitted, least squares, to the word's field across
// the contour where the anneal begins, so the blend starts from rings that
// already agree and the bands it settles on are centred on the word's mass.
// Returns centre and half size, css px, of the stadium that contour offsets.
function fitStadium(out, W, H, grid, period, x0, y0, inkL, inkR, asc, desc) {
  const sm = (a, b) => {
    const k = period;
    const t = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - t * t * k * 0.25;
  };
  const at = ANNEAL[0] * period;
  const band = 0.75 / grid;
  const px = [];
  const py = [];
  const pt = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const t = sm(sm(sm(out[k], out[k + 1]), out[k + 2]), out[k + 3]) - at;
      if (Math.abs(t) < band) {
        px.push((x + 0.5) / grid);
        py.push((y + 0.5) / grid);
        pt.push(t);
      }
    }
  }
  const b = [(x0 + (inkL + inkR) / 2) / grid, (y0 + (desc - asc) / 2) / grid, (inkR - inkL) / 2 / grid, (asc + desc) / 2 / grid];
  if (!pt.length) return b;
  const loss = ([cx, cy, bx, by]) => {
    let e = 0;
    for (let i = 0; i < pt.length; i++) {
      const qx = Math.abs(px[i] - cx) - bx + by;
      const qy = Math.abs(py[i] - cy);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - by;
      e += (sd - pt[i]) ** 2;
    }
    return e;
  };
  let best = loss(b);
  for (let step = period; step > period / 64; step /= 2) {
    for (let moved = true, n = 0; moved && n < 40; n++) {
      moved = false;
      for (let j = 0; j < 4; j++) {
        for (const s of [step, -step]) {
          const c = b.slice();
          c[j] += s;
          if (c[3] < period || c[2] < c[3]) continue;
          const e = loss(c);
          if (e < best) {
            best = e;
            b[j] = c[j];
            moved = true;
          }
        }
      }
    }
  }
  return b;
}

async function loadFamily() {
  const family = "RadiatingGeist";
  try {
    if (![...document.fonts].some((ff) => ff.family === family)) {
      const face = new FontFace(family, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
      await face.load();
      document.fonts.add(face);
    }
    await document.fonts.load(`700 100px ${family}`);
    return family;
  } catch {
    return "sans-serif";
  }
}

const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

// How many kept sources already crowd a spot (css px), each counted by how
// near it sits, out to a few periods.
function crowdAt(sources, x, y, w, h, period) {
  const r = period * 6;
  let c = 0;
  for (const s of sources) {
    if (s.retire >= 0) continue;
    const d = Math.hypot(s.fx * w - x, s.fy * h - y) / r;
    c += Math.exp(-d * d);
  }
  return c;
}

// The source a press at (x, y) would drop: finer, and pushing out more rings,
// the more sources it lands among. Positions are kept as fractions of the
// box and periods as fractions of the word's, so a resize keeps the picture.
function nextSource(sources, x, y, w, h, period) {
  const c = crowdAt(sources, x, y, w, h, period);
  return {
    fx: x / w,
    fy: y / h,
    pr: Math.max(MIN_PERIOD, FIRST_PERIOD * Math.pow(FINER, c)),
    rings: BLOOM_RINGS + Math.round(c * 3),
  };
}

export async function createRadiating(host, { embedded = false } = {}) {
  const family = await loadFamily();
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const params = new URLSearchParams(embedded ? "" : window.location.search);
  const hold = {
    x: params.has("x") ? clamp(+params.get("x"), 0, 1) : null,
    y: params.has("y") ? clamp(+params.get("y"), 0, 1) : null,
    t: params.has("t") ? clamp(+params.get("t"), 0, 1) : null,
    n: params.has("n") ? clamp(Math.round(+params.get("n")) || 0, 0, MAX_SOURCES) : null,
  };
  const held = hold.x != null || hold.t != null || hold.n != null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const name of ["uSdf", "uEdge", "uTexSize", "uGrid", "uRes", "uDpr", "uP", "uSrc", "uSrcN", "uK", "uKg", "uHug", "uReveal", "uBox", "uAnneal", "uInk", "uPaper"]) U[name] = gl.getUniformLocation(prog, name);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tex = makeTex();
  const edgeTex = makeTex();

  let sdf = null;
  let grid = 1;
  let period = 12;
  let w = 1;
  let h = 1;

  // The dot: position follows the pointer on an ease-out; presence (0..1)
  // grows its field out of nothing and lets it sink back when the hand goes.
  // It is the next source, carried before it is dropped.
  const dot = { x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: 0, placed: false };
  // Dropped sources: { fx, fy, pr, rings, t0, retire }.
  const sources = [];
  let revealStart = -1;
  let dirty = true;

  const drop = (x, y, t0) => {
    const s = { ...nextSource(sources, x, y, w, h, period), t0, retire: -1 };
    const kept = sources.filter((q) => q.retire < 0);
    if (kept.length >= MAX_SOURCES) kept[0].retire = t0;
    sources.push(s);
    return s;
  };

  // The word is not the hand's to paint: over a letter, its first rings or a
  // counter the dot sinks away and a press drops nothing.
  const blocked = (x, y) => {
    if (!sdf) return true;
    const i = clamp(Math.floor(y * grid), 0, sdf.H - 1) * sdf.W + clamp(Math.floor(x * grid), 0, sdf.W - 1);
    return sdf.edge[i * 2 + 1] < period * 2 || sdf.edge[i * 2] > 0;
  };
  const rebuild = () => {
    w = stage.width;
    h = stage.height;
    grid = Math.min(2, Math.sqrt(2.6e6 / (w * h)));
    ({ period } = layout(w, h));
    sdf = buildField(w, h, grid, family);
    // The intro starts once there is a field to show, under the canvas fade.
    if (revealStart < 0) revealStart = performance.now() + 120;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sdf.W, sdf.H, 0, gl.RGBA, gl.FLOAT, sdf.data);
    gl.bindTexture(gl.TEXTURE_2D, edgeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sdf.W, sdf.H, 0, gl.RG, gl.FLOAT, sdf.edge);
    if (held) {
      dot.x = dot.tx = (hold.x ?? 0.72) * w;
      dot.y = dot.ty = (hold.y ?? 0.7) * h;
      dot.a = dot.ta = blocked(dot.x, dot.y) ? 0 : 1;
      dot.placed = true;
      // Replay: the scripted presses, the last at the held dot, all fully
      // bloomed but the last, which ?t= holds.
      sources.length = 0;
      const n = hold.n ?? (hold.t != null ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        const [fx, fy] = last && hold.x != null ? [hold.x, hold.y ?? 0.7] : SCRIPT[i % SCRIPT.length];
        if (blocked(fx * w, fy * h)) continue;
        const s = drop(fx * w, fy * h, 0);
        s.hold = last && hold.t != null ? hold.t : 1;
      }
    }
    dirty = true;
  };
  stage.onResize(rebuild);

  const follow = (pt) => {
    dot.tx = pt.x;
    dot.ty = pt.y;
    dot.ta = 1;
    if (!dot.placed || dot.a < 0.02) {
      dot.x = pt.x;
      dot.y = pt.y;
      dot.placed = true;
    }
  };
  stage.on("move", follow);
  stage.on("down", (pt) => {
    follow(pt);
    if (held || blocked(pt.x, pt.y)) return;
    drop(pt.x, pt.y, performance.now());
    dirty = true;
  });
  stage.on("up", (pt, e) => {
    if (e.pointerType !== "mouse") dot.ta = 0;
  });

  const srcData = new Float32Array(SLOTS * 4);

  stage.onFrame((dt) => {
    if (!sdf || stage.width !== w || stage.height !== h) return;
    const now = performance.now();
    const diag = Math.hypot(w, h);

    if (!held) {
      if ((!stage.pointer.inside && !stage.pointer.down) || blocked(dot.tx, dot.ty)) dot.ta = 0;
      const px = dot.x;
      const py = dot.y;
      const pa = dot.a;
      dot.x = damp(dot.x, dot.tx, 14, dt);
      dot.y = damp(dot.y, dot.ty, 14, dt);
      dot.a = damp(dot.a, dot.ta, dot.ta > dot.a ? 5 : 3.2, dt);
      if (Math.abs(dot.a - dot.ta) < 1e-4) dot.a = dot.ta;
      if (Math.abs(px - dot.x) + Math.abs(py - dot.y) + Math.abs(pa - dot.a) > 1e-3) dirty = true;
    }

    // Sources: a press blooms out of the dot it was (rings 0) to its own
    // count; one letting go sinks back past everything, then is forgotten.
    srcData.fill(0);
    let count = 0;
    for (let i = sources.length - 1; i >= 0; i--) {
      if (sources[i].retire >= 0 && now - sources[i].retire > RETIRE_MS) sources.splice(i, 1);
    }
    for (const s of sources) {
      const p = s.pr * period;
      let rings = s.rings * (s.hold ?? easeOut((now - s.t0) / BLOOM_MS));
      if (s.hold == null && now - s.t0 < BLOOM_MS) dirty = true;
      if (s.retire >= 0) {
        rings -= ((diag + period * 4) / p) * easeOut((now - s.retire) / RETIRE_MS);
        dirty = true;
      }
      srcData.set([s.fx * w, s.fy * h, p, rings], count * 4);
      count++;
    }
    // The pointer's dot, last: far away its field is pushed past everything,
    // so it grows outward from the dot as presence rises.
    if (dot.a > 1e-3) {
      const next = nextSource(sources, dot.x, dot.y, w, h, period);
      const p = next.pr * period;
      srcData.set([dot.x, dot.y, p, -((1 - dot.a) * (diag + period * 4)) / p], count * 4);
      count++;
    }

    // Intro: the rings swell out of the word one after another.
    const introMs = 1900;
    const it = held ? 1 : clamp((now - revealStart) / introMs, 0, 1);
    const reveal = it >= 1 ? 1e6 : (diag * 0.75) * (1 - Math.pow(1 - it, 2.2));
    if (it < 1) dirty = true;
    else if (revealStart > 0) {
      revealStart = 0;
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uSdf, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, edgeTex);
    gl.uniform1i(U.uEdge, 1);
    gl.uniform2i(U.uTexSize, sdf.W, sdf.H);
    gl.uniform1f(U.uGrid, grid);
    gl.uniform2f(U.uRes, stage.canvas.width, stage.canvas.height);
    gl.uniform1f(U.uDpr, stage.canvas.width / w);
    gl.uniform1f(U.uP, period);
    gl.uniform4fv(U.uSrc, srcData);
    gl.uniform1i(U.uSrcN, count);
    gl.uniform1f(U.uK, 0.9);
    gl.uniform1f(U.uKg, period);
    gl.uniform1f(U.uHug, 4);
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform4fv(U.uBox, sdf.box);
    gl.uniform2f(U.uAnneal, ANNEAL[0] * period, ANNEAL[1] * period);
    gl.uniform3fv(U.uInk, INK);
    gl.uniform3fv(U.uPaper, PAPER);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return {
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteTexture(edgeTex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      stage.destroy();
    },
  };
}
