import { createStage, clamp, damp } from "../_kit/stage";
import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./noCoverTakes";

// After Christian Marclay, Record Without a Cover (1985): a record sold with
// no sleeve, so the marks of handling become part of what it plays.
//
// The record is drawn in one full-screen pass, analytically, at the true
// proportions of a 12-inch LP (302 mm across, 100 mm label, grooves from
// 146 mm in to 60 mm), close enough that it runs off the frame. The grooves
// are far finer than a pixel, so they are not drawn as lines: they are a
// tangent field. Each point of vinyl reflects light along the groove's circle
// (an anisotropic lobe, Kajiya-Kay in the tangent, Ward across it), so the
// record lights up only where the groove runs across the half vector: a
// narrow fan through the centre that points at the light and turns with it.
// Band gaps between tracks are smooth vinyl and break the fan into rings.
// The pressing is a hair off centre and a little warped, so the fan sways.
//
// Damage is a height field fixed to the record, 4096 texels across. Every
// drag is stamped into it as a cut with a profile: a trench in the middle,
// the displaced vinyl heaped into a broken bead of burr either side, chips
// bitten out of the walls, all deeper the faster the hand moves. A second
// target keeps the direction the grit travelled. The shader takes normals
// from the height and lights the cut with the same lobe as the grooves, with
// the cut's direction as its tangent, so a scratch flares only when it lies
// across the light and goes dark as the record or the light turns on. Where
// a cut runs, the groove is broken and its sheen stops.
//
// Spinning is a shutter's worth of rotation integrated per pixel: as many
// taps as the arc covers pixels, each offset by its own blue-noise jitter,
// and the paper label is integrated in the same loop, so it smears with the
// vinyl. Each cut also leaves its angle in a ring of bins; spinning sweeps
// the stylus through the bins, and every bin with damage in it ticks or pops.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

// --- one cut segment, stamped into the damage field
const STAMP_VS = `#version 300 es
layout(location=0) in vec4 aSeg;   // from, to (record-local, -1..1)
layout(location=1) in vec4 aCut;   // half width, depth, burr, seed
uniform float uTexel;              // one texel in record units
out vec2 vP;
flat out vec4 vSeg;
flat out vec4 vCut;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw;
  vec2 d = b - a;
  float L = length(d);
  vec2 u = L > 1e-7 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float ext = aCut.x * 4.2 + uTexel * 2.0;
  float sx = float(gl_VertexID & 1);
  float sy = float((gl_VertexID >> 1) & 1);
  // Segments abut end to end (a texel of overlap), with no round caps: caps
  // would leave a ring of burr at every joint.
  vec2 p = mix(a - u * uTexel, b + u * uTexel, sx) + n * ext * (sy * 2.0 - 1.0);
  vP = p; vSeg = aSeg; vCut = aCut;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const STAMP_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec4 vCut;
uniform float uSize;
layout(location=0) out vec4 oH;    // trench depth, burr height
layout(location=1) out vec4 oD;    // direction of travel, doubled angle
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main(){
  vec2 a = vSeg.xy, ba = vSeg.zw - a, pa = vP - a;
  float h = dot(pa, ba) / max(dot(ba, ba), 1e-12);
  float hw = vCut.x, depth = vCut.y, burrH = vCut.z, seed = vCut.w;
  float d = length(pa - ba * h) / hw;
  float side = ba.x * pa.y - ba.y * pa.x > 0.0 ? 1.0 : -1.0;
  // Noise lives on the record, not on the segment, so a cut stays one
  // continuous thing across every segment it was drawn in.
  vec2 tp = vP * uSize * 0.5;
  float nA = vnoise(tp * 0.035 + seed * 13.1);
  float nB = vnoise(tp * 0.011 + seed * 5.7);
  // Chips: the wall breaks away to one side in bites.
  float chip = smoothstep(0.62, 0.92, vnoise(tp * 0.045 + side * 19.3 + seed * 7.0));
  float wl = 1.0 + 1.3 * chip;
  float dd = d / wl;
  float trench = depth * (0.5 + 0.5 * nB) * (0.75 + 0.5 * nA) * max(0.0, 1.0 - dd * dd);
  // Flakes knocked out beside the cut.
  float pit = smoothstep(0.8, 0.93, vnoise(tp * 0.13 + seed * 3.3)) * exp(-pow((d - 1.9) / 0.8, 2.0)) * depth * 0.7;
  trench = max(trench, pit);
  // Burrs: the vinyl the grit pushed aside, heaped in a lip each side and
  // broken into beads.
  float bead = smoothstep(0.15, 0.5, vnoise(tp * 0.05 + side * 41.0 + seed * 2.1));
  float burr = burrH * exp(-pow((d - 1.7 * wl) / (0.5 + 0.3 * wl), 2.0)) * (0.15 + 0.85 * bead) * (0.75 + 0.5 * nA);
  float alpha = (1.0 - smoothstep(2.6, 3.6, d)) * clamp(0.3 + depth * 1.4, 0.0, 1.0);
  vec2 u = normalize(ba + vec2(1e-9, 0.0));
  float a2 = 2.0 * atan(u.y, u.x);
  oH = vec4(clamp(trench, 0.0, 1.0), clamp(burr, 0.0, 1.0), 0.0, alpha);
  oD = vec4(0.5 + 0.5 * cos(a2), 0.5 + 0.5 * sin(a2), 0.0, alpha);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uC; uniform float uR;
uniform float uA; uniform float uBlur; uniform vec3 uL; uniform vec2 uEcc;
uniform sampler2D uDmg; uniform sampler2D uDir; uniform sampler2D uLab;
uniform float uTex;
out vec4 o;

const float LABEL = 0.331;   // 50 / 151
const float HOLE = 0.0238;   // 3.6 / 151
const float G_OUT = 0.966;   // first groove
const float G_IN = 0.40;     // last music groove
const int TAPS = 48;
const float HB = 0.55;       // burr height, relative to trench depth
const float SLOPE = 1.25;    // height per texel to surface slope

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Interleaved gradient noise: a cheap blue-ish dither per pixel.
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float ampAt(vec2 l){
  vec2 lg = l - uEcc;
  float rl = length(lg);
  vec2 ring = lg / max(rl, 1e-4);
  return 0.62 + 0.55 * noise(vec2(rl * 110.0, 0.0) + ring * 3.2) * noise(vec2(rl * 31.0, 7.0) + ring * 1.6);
}

// Where each track ends: a smooth band a millimetre wide.
float gaps(float r, float aa){
  float g = 0.0;
  g += 1.0 - smoothstep(0.0035, 0.0035 + aa, abs(r - 0.872));
  g += 1.0 - smoothstep(0.0030, 0.0030 + aa, abs(r - 0.771));
  g += 1.0 - smoothstep(0.0040, 0.0040 + aa, abs(r - 0.668));
  g += 1.0 - smoothstep(0.0030, 0.0030 + aa, abs(r - 0.583));
  g += 1.0 - smoothstep(0.0035, 0.0035 + aa, abs(r - 0.489));
  return clamp(g, 0.0, 1.0);
}

// The one reflectance for grooves and cuts alike: a tangent-aligned lobe.
// Narrow along the tangent (it lights where the tangent crosses the half
// vector), wide across it, and divided through by the normal component so a
// tilted wall moves the lobe with it.
float aniso(vec3 T, vec3 B, vec3 N, vec3 H, float wT, float wB){
  float ht = dot(T, H), hb = dot(B, H);
  float hn = max(dot(N, H), 0.08);
  float across = hb * hb / (wB * wB);
  float k = 1.0 / (hn * hn);
  float w1 = 0.026 * wT, w2 = 0.085 * wT, w3 = 0.3 * wT;
  return 0.8 * exp(-(ht * ht / (w1 * w1) + across) * k)
       + 0.13 * exp(-(ht * ht / (w2 * w2) + across) * k)
       + 0.012 * exp(-(ht * ht / (w3 * w3) + across) * k);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr; // css px, y down
  vec2 q = (px - uC) / uR;
  float r = length(q);
  float aa = 1.0 / (uR * uDpr);
  vec2 Lxy = normalize(uL.xy);

  // The table: warm white, with the record's shadow on it. A tight contact
  // line where the edge sits, and a soft penumbra thrown away from the light.
  vec3 ground = pow(vec3(0.949, 0.941, 0.922), vec3(2.2));
  float dC = length(q + Lxy * 0.004) - 1.0;
  float dS = length(q + Lxy * 0.045) - 1.0;
  float contact = 1.0 - smoothstep(-0.004, 0.022, dC);
  float soft = 1.0 - smoothstep(-0.10, 0.20, dS);
  vec3 table = ground * (1.0 - 0.5 * contact) * (1.0 - 0.16 * soft);

  float disc = smoothstep(1.0 + aa * 0.6, 1.0 - aa * 0.6, r);
  float hole = 1.0 - smoothstep(HOLE - aa * 0.6, HOLE + aa * 0.6, r);

  vec3 col = table;
  if (disc > 0.0) {
    vec3 V = normalize(vec3(-q, 5.0));
    vec3 H = normalize(uL + V);
    float theta = atan(q.y, q.x);

    // Warp: the record is not quite flat, so the half vector it sees tips a
    // little, twice a turn, carried round with the record.
    float thL = theta - uA;
    vec2 tilt = rot(vec2(cos(2.0 * thL), sin(2.0 * thL)) * 0.010 * r, uA);
    vec3 Hw = normalize(vec3(H.xy + tilt, H.z));

    vec2 gc = rot(uEcc, uA);
    vec2 dg = q - gc;
    float rg = length(dg);
    vec2 Tg = vec2(-dg.y, dg.x) / max(rg, 1e-4);

    // Fine striations in the groove field: the land between turns catches
    // the light unevenly, ring by ring.
    float stri = 0.72 + 0.28 * n1(rg * 900.0) * (0.6 + 0.4 * n1(rg * 260.0 + 3.0));
    float grooved = smoothstep(G_IN - aa, G_IN + aa, rg) * (1.0 - smoothstep(G_OUT - aa, G_OUT + aa, rg));
    grooved *= 1.0 - gaps(rg, aa);
    // The run-out: a few turns of lead-out spiral on smooth vinyl, and the
    // locked groove at the end.
    float runout = 0.0;
    for (int k = 0; k < 4; k++) {
      float rr = G_IN - 0.012 - float(k) * 0.011;
      runout += 1.0 - smoothstep(0.0012, 0.0012 + aa, abs(rg - rr));
    }
    runout += 1.0 - smoothstep(0.0012, 0.0012 + aa, abs(rg - 0.352));

    float lab = 1.0 - smoothstep(LABEL - aa * 0.6, LABEL + aa * 0.6, r);
    float labWide = 1.0 - step(LABEL + 4.0 * aa, r);

    // How hard the music drives the groove changes along the spiral: the
    // sheen is mottled by it, and the mottling is what streams. It varies
    // smoothly round the record, so its average over the shutter's arc is
    // taken exactly enough by Simpson's rule: three samples, not a tap each.
    float amp = (ampAt(rot(q, -uA + 0.5 * uBlur)) + 4.0 * ampAt(rot(q, -uA)) + ampAt(rot(q, -uA - 0.5 * uBlur))) / 6.0;

    // Undamaged vinyl under the fan: the same lobe, with a flat normal.
    vec3 N0 = vec3(0.0, 0.0, 1.0);
    vec3 T0 = vec3(Tg, 0.0);
    float f0 = aniso(T0, cross(N0, T0), N0, Hw, 1.0, 2.5);
    float base = grooved * stri * amp + runout * 0.8;

    // The shutter: the arc this pixel sweeps while it is open, integrated with
    // a tap per pixel of travel, each tap jittered within its stratum by its
    // own blue-noise offset. Clean vinyl costs a tap one fetch; only taps that
    // land on damage pay for its normal and its lobe.
    float arc = uBlur * r * uR * uDpr;
    int n = uBlur > 1e-4 ? int(clamp(ceil(arc / 1.4), 1.0, float(TAPS))) : 1;
    float bn = ign(gl_FragCoord.xy);
    float dspec = 0.0, stress = 0.0, cavity = 0.0;
    vec3 paper = vec3(0.0);
    for (int i = 0; i < TAPS; i++) {
      if (i >= n) break;
      float u = n == 1 ? 0.5 : (float(i) + fract(bn + float(i) * 0.6180339)) / float(n);
      float a = uA - uBlur * (u - 0.5);
      vec2 l = rot(q, -a);                      // record-local
      vec2 uv = l * 0.5 + 0.5;
      if (labWide > 0.0) paper += texture(uLab, l / LABEL * 0.5 + 0.5).rgb;

      // The damage: height from trench and burr, normal from its slope.
      vec2 s0 = texture(uDmg, uv).rg;
      if (s0.r + s0.g < 0.002) continue;
      vec2 sx = texture(uDmg, uv + vec2(uTex, 0.0)).rg;
      vec2 sy = texture(uDmg, uv + vec2(0.0, uTex)).rg;
      float h0 = s0.g * HB - s0.r, hx = sx.g * HB - sx.r, hy = sy.g * HB - sy.r;
      vec2 grad = rot(vec2(hx - h0, hy - h0) * SLOPE, a);
      vec3 N = normalize(vec3(-grad, 1.0));
      float dmg = s0.r + s0.g;
      float brk = smoothstep(0.03, 0.22, dmg);

      // The tangent: the groove's circle, or where the groove is broken, the
      // line the grit travelled.
      vec2 de = texture(uDir, uv).rg * 2.0 - 1.0;
      float dm = smoothstep(0.05, 0.45, length(de));
      float ang = 0.5 * atan(de.y, de.x) + a;
      vec2 D = vec2(cos(ang), sin(ang));
      D *= dot(D, Tg) < 0.0 ? -1.0 : 1.0;
      float m = brk * dm;
      vec2 Tt = normalize(mix(Tg, D, m) + vec2(1e-5, 0.0));
      vec3 T3 = normalize(vec3(Tt, 0.0) - N * dot(vec3(Tt, 0.0), N));
      vec3 B3 = cross(N, T3);

      // Grooves are fibres: wide across. A cut's walls are facets: narrower
      // across, so only the wall that faces the light catches it. What this
      // tap adds is its difference from clean vinyl.
      float f = aniso(T3, B3, N, Hw, mix(1.0, 1.6, m), mix(2.5, 0.34, brk));
      float wall = brk * (1.5 + 0.8 * s0.g);
      dspec += f * (base * (1.0 - brk) + wall) - f0 * base;
      // Fresh-cut vinyl stress-whitens a little, and the floor of a deep
      // trench sits in its own shadow.
      stress += (s0.g * 0.8 + s0.r * 0.35) * (0.4 + 0.6 * max(dot(N, uL), 0.0));
      cavity += s0.r;
    }
    float fn = float(n);
    float spec = max(0.0, f0 * base + dspec / fn);
    stress /= fn; cavity /= fn; paper /= fn;

    // Black vinyl: almost no diffuse, a faint coherent reflection of the
    // room where it is smooth, a little more scatter where it is grooved.
    float flat_ = 1.0 - grooved;
    float roomRefl = 0.0015 + 0.006 * smoothstep(-0.6, 1.0, dot(q, Lxy));
    vec3 vinyl = vec3(0.0042) + vec3(0.0022) * grooved + vec3(roomRefl) * flat_;
    vinyl *= 1.0 - 0.6 * clamp(cavity, 0.0, 1.0);
    vinyl += vec3(1.0, 0.985, 0.96) * spec * 0.95;
    vinyl += vec3(0.9, 0.9, 0.88) * stress * 0.007;

    // The rim: a raised bead and a rounded edge that catch the light on its
    // side and go dark on the other.
    float facing = dot(q / max(r, 1e-4), Lxy);
    float bead = exp(-pow((r - 0.983) / 0.006, 2.0));
    vinyl += vec3(0.16) * bead * pow(max(0.0, facing), 6.0);
    vinyl += vec3(0.02) * bead * pow(max(0.0, -facing), 4.0);
    float edge = smoothstep(1.0 - 3.0 * aa, 1.0 - 0.6 * aa, r) * (1.0 - smoothstep(1.0 - 0.6 * aa, 1.0, r));
    vinyl += vec3(0.32) * edge * pow(max(0.0, facing), 2.0);

    // The label: plain paper, matte, a step proud of the vinyl, turning (and
    // smearing) with it.
    if (lab > 0.0) {
      vec3 pc = pow(paper, vec3(2.2));
      float light = 0.86 + 0.06 * dot(q, Lxy) / LABEL * 0.3;
      vec3 labc = pc * light;
      // The edge of the paper: a hairline of shadow away from the light.
      float rim = exp(-pow((r - (LABEL - 0.002)) / 0.003, 2.0));
      labc *= 1.0 - 0.35 * rim * max(0.0, -facing);
      // The spindle hole is punched through: its wall throws a crescent of
      // shade on the paper away from the light, and catches it on the far side.
      float rh = r / HOLE;
      float wallLit = exp(-pow((rh - 1.0) / 0.09, 2.0));
      labc *= 1.0 - 0.28 * exp(-pow((rh - 1.12) / 0.16, 2.0)) * max(0.0, -dot(q / max(r, 1e-5), Lxy));
      labc += vec3(0.05) * wallLit * max(0.0, dot(q / max(r, 1e-5), Lxy));
      vinyl = mix(vinyl, labc, lab);
    }

    // Through the hole: the table, in the record's shadow, darker on the side
    // the light comes from where the hole's wall hides it.
    float hs = smoothstep(-1.0, 1.0, dot(q / HOLE, Lxy) * 1.4);
    vec3 through = ground * mix(0.62, 0.3, hs) * (1.0 - 0.35 * smoothstep(0.55, 1.0, r / HOLE));
    vinyl = mix(vinyl, through, hole);
    col = mix(table, vinyl, disc);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy * 0.37 + 0.5) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const TAU = Math.PI * 2;
const RPM = 100 / 3;
const OMEGA = (RPM / 60) * TAU; // rad/s at 33 1/3
const LABEL = 0.331;
const BINS = 720;
const HAIR = 0.0009; // half width of a hairline cut, in record radii

// A deterministic generator for the seeded stills.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function drawLabel(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;
  g.fillStyle = "#ebe7dd";
  g.fillRect(0, 0, size, size);
  // Paper: a faint tooth.
  const img = g.getImageData(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (r() - 0.5) * 5;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  const css = getComputedStyle(document.body);
  const sans = css.getPropertyValue("--font-sans").trim() || css.fontFamily;
  try {
    await document.fonts.ready;
  } catch {}
  g.fillStyle = "#2b2926";
  g.strokeStyle = "rgba(43,41,38,0.85)";
  g.lineWidth = size * 0.0028;
  g.beginPath();
  g.arc(mid, mid, size * 0.455, 0, TAU);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `560 ${Math.round(size * 0.052)}px ${sans}`;
  g.fillText("A", mid, size * 0.27);
  return c;
}

export async function createNoCover(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const prog = program(gl, VS, FS);
  const U = {};
  for (const n of ["uRes", "uDpr", "uC", "uR", "uA", "uBlur", "uL", "uEcc", "uDmg", "uDir", "uLab", "uTex"]) U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeTex = (src) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // --- the damage field, in record space: height (trench, burr) and the
  // direction each cut travelled, two RG8 targets written together.
  const S = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const fieldTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, S, S);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const dmgTex = fieldTex();
  const dirTex = fieldTex();
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dmgTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dirTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
  gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 0, 0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const stampProg = program(gl, STAMP_VS, STAMP_FS);
  const uStampTexel = gl.getUniformLocation(stampProg, "uTexel");
  const uStampSize = gl.getUniformLocation(stampProg, "uSize");
  const stampVao = gl.createVertexArray();
  gl.bindVertexArray(stampVao);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);

  // Segments waiting to be cut into the field, eight floats each.
  let inst = new Float32Array(8 * 2048);
  let nInst = 0;
  const pushSeg = (x0, y0, x1, y1, hw, depth, burr, sd) => {
    if ((nInst + 1) * 8 > inst.length) {
      const next = new Float32Array(inst.length * 2);
      next.set(inst);
      inst = next;
    }
    inst.set([x0, y0, x1, y1, hw, depth, burr, sd], nInst * 8);
    nInst += 1;
  };
  const flush = () => {
    if (!nInst) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, S, S);
    gl.useProgram(stampProg);
    gl.uniform1f(uStampTexel, 2 / S);
    gl.uniform1f(uStampSize, S);
    gl.bindVertexArray(stampVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, nInst * 8), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nInst);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    nInst = 0;
  };

  const labTex = makeTex(await drawLabel(512));

  // Damage by angle on the record, for the stylus to find.
  const bins = new Float32Array(BINS);

  // --- sound
  const sound = createSound({ level: -5, room: 0.06 });
  const tickBank = sound.bank(takes.tick.render, takes.tick);
  const popBank = sound.bank(takes.pop.render, takes.pop);
  const surfBank = sound.bank(takes.surface.render, takes.surface);
  let surf = null;
  let woke = false;

  // --- state
  let angle = 0.6; // record angle, clockwise on screen
  let omega = 0;
  let lightAz = -2.2; // toward upper left
  let lightTarget = lightAz;
  let mode = "idle"; // idle | pending | scratch | hold
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let stroke = null;
  let total = 0; // how much damage there is, for the bed
  let C = [0, 0];
  let R = 100;

  const toLocal = (x, y) => {
    const qx = (x - C[0]) / R;
    const qy = (y - C[1]) / R;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    return [c * qx - s * qy, s * qx + c * qy];
  };

  // One cut: a few grains of grit side by side, each its own trench with its
  // own depth and width. `force` fixes the pressure (for the seeded history);
  // otherwise it follows the speed of the hand.
  const newStroke = (rand = Math.random, { force = null, depth = 1, width = 1, grit = 0 } = {}) => {
    const lines = [];
    const k = 1 + Math.floor(rand() * (grit || 3));
    for (let i = 0; i < k; i += 1) {
      lines.push({
        off: i === 0 ? 0 : (rand() - 0.5) * 0.014 * width,
        depth: depth * (i === 0 ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.45),
        w: width * (i === 0 ? 1 + rand() * 0.4 : 0.6 + rand() * 0.4),
        seed: rand() * 100,
        tail: null,
      });
    }
    return { lines, last: null, len: 0, rand, force, s: null };
  };

  const lift = (st) => {
    st.last = null;
    for (const line of st.lines) line.tail = null;
  };

  const cut = (st, lx, ly, speed = 700) => {
    const r = Math.hypot(lx, ly);
    const onVinyl = r > LABEL + 0.006 && r < 0.992;
    if (!onVinyl) {
      lift(st);
      return;
    }
    const p = [lx, ly];
    if (!st.last) {
      st.last = p;
      return;
    }
    const dx = p[0] - st.last[0];
    const dy = p[1] - st.last[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.0025) return;
    const ux = dx / len;
    const uy = dy / len;
    // Pressure: a fast drag bites deeper and wider than a slow one.
    const s = st.force ?? clamp(speed / 1400, 0, 1);
    st.s = st.s == null ? s : st.s + (s - st.s) * 0.35;
    const press = st.force ?? 0.4 + 0.85 * st.s;
    const ramp = Math.min(1, (st.len + len) / 0.05); // a cut starts light
    for (const line of st.lines) {
      const ox = -uy * line.off;
      const oy = ux * line.off;
      const from = line.tail || [st.last[0] + ox, st.last[1] + oy];
      const to = [p[0] + ox + (st.rand() - 0.5) * 0.0005, p[1] + oy + (st.rand() - 0.5) * 0.0005];
      const depth = Math.min(1, line.depth * ramp * press);
      const hw = HAIR * line.w * (0.75 + 0.5 * Math.min(1, press));
      pushSeg(from[0], from[1], to[0], to[1], hw, depth, Math.min(1, 0.15 + depth * 0.8), line.seed);
      line.tail = to;
    }
    // Into the bins, by the angle of the middle of the segment.
    const th0 = Math.atan2(st.last[1] + p[1], st.last[0] + p[0]);
    const th = th0 < 0 ? th0 + TAU : th0;
    const bi = Math.floor((th / TAU) * BINS) % BINS;
    const lp = len * 512; // in the old 1024-texel units the sound was tuned in
    bins[bi] = Math.min(2, bins[bi] + lp * 0.035 * st.lines[0].depth * press);
    total += lp;
    st.len += len;
    st.last = p;
  };

  // A walk across the record: a heading that bends and wanders.
  const walk = (st, x, y, d, L, bend, wob = 0, skip = 0) => {
    const steps = Math.max(2, Math.ceil(L / 0.004));
    let cx = x;
    let cy = y;
    let dd = d;
    for (let i = 0; i <= steps; i += 1) {
      if (skip && st.rand() < skip) lift(st);
      else cut(st, cx, cy);
      cx += Math.cos(dd) * (L / steps);
      cy += Math.sin(dd) * (L / steps);
      dd += bend / steps + (st.rand() - 0.5) * wob;
    }
    lift(st);
  };

  // The seeded history: a record handled for years with nothing to keep it.
  // Wiped with a sleeve-less cloth, slid across other records, picked up by
  // the edge, and once or twice skated by a dropped stylus.
  const seed = () => {
    const rand = rng(1985);
    // Wipes: swirls of fine hairlines round a centre that is not the record's.
    for (let w = 0; w < 4; w += 1) {
      const cx = (rand() - 0.5) * 0.7;
      const cy = (rand() - 0.5) * 0.7;
      const rho0 = 0.4 + rand() * 0.45;
      for (let k = 0; k < 30; k += 1) {
        const st = newStroke(rand, { force: 0.5 + rand() * 0.5, depth: 0.22 + rand() * 0.3, width: 0.8, grit: 1 });
        const rho = rho0 + (rand() - 0.5) * 0.45;
        const ph = rand() * TAU;
        const span = 0.25 + rand() * 0.8;
        walk(st, cx + Math.cos(ph) * rho, cy + Math.sin(ph) * rho, ph + Math.PI / 2, rho * span, span, 0.004);
      }
    }
    // Slides: bundles of parallel scuffs from lying on other records.
    for (let b = 0; b < 7; b += 1) {
      const th = rand() * TAU;
      const off = (rand() - 0.5) * 1.3;
      const nx = -Math.sin(th);
      const ny = Math.cos(th);
      const count = 3 + Math.floor(rand() * 8);
      const t0 = -1 + rand() * 0.8;
      const L = 0.5 + rand() * 1.1;
      const bend = (rand() - 0.5) * 0.15;
      let o = off;
      for (let k = 0; k < count; k += 1) {
        o += 0.003 + rand() * 0.012;
        const st = newStroke(rand, { force: 0.6 + rand() * 0.4, depth: 0.35 + rand() * 0.45, width: 0.9, grit: 1 });
        const s0 = t0 + (rand() - 0.5) * 0.15;
        walk(st, Math.cos(th) * s0 + nx * o, Math.sin(th) * s0 + ny * o, th, L * (0.7 + rand() * 0.3), bend, 0.002);
      }
    }
    // Handling: short hooks near the rim where fingers hold it.
    for (let k = 0; k < 70; k += 1) {
      const ph = rand() * TAU;
      const r0 = 0.78 + rand() * 0.2;
      const st = newStroke(rand, { force: 0.6 + rand() * 0.5, depth: 0.5 + rand() * 0.5, width: 1 + rand() * 0.5 });
      walk(st, Math.cos(ph) * r0, Math.sin(ph) * r0, ph + Math.PI / 2 + (rand() - 0.5) * 1.6, 0.03 + rand() * 0.11, (rand() - 0.5) * 2.4, 0.03);
    }
    // Scuffs: short marks anywhere.
    for (let k = 0; k < 110; k += 1) {
      const ph = rand() * TAU;
      const r0 = 0.36 + rand() * 0.6;
      const st = newStroke(rand, { force: 0.5 + rand() * 0.6, depth: 0.3 + rand() * 0.5, width: 0.8 + rand() * 0.6 });
      walk(st, Math.cos(ph) * r0, Math.sin(ph) * r0, rand() * TAU, 0.01 + rand() * 0.07, (rand() - 0.5) * 1.5, 0.02);
    }
    // Skates: a dropped stylus swings in on the tonearm's arc, bouncing.
    for (let k = 0; k < 3; k += 1) {
      const pa = rand() * TAU;
      const pr = 1.25 + rand() * 0.2;
      const px = Math.cos(pa) * pr;
      const py = Math.sin(pa) * pr;
      const arm = pr - 0.02 + rand() * 0.06;
      const st = newStroke(rand, { force: 1, depth: 1, width: 1.8 + rand() * 0.6, grit: 1 });
      st.lines.push({ off: 0.0035, depth: 0.45, w: 0.8, seed: rand() * 100, tail: null });
      const a0 = pa + Math.PI - 0.55 - rand() * 0.2;
      const span = 0.45 + rand() * 0.25;
      const steps = Math.ceil((arm * span) / 0.004);
      for (let i = 0; i <= steps; i += 1) {
        const a = a0 + (span * i) / steps;
        if (rand() < 0.03) lift(st);
        else cut(st, px + Math.cos(a) * arm, py + Math.sin(a) * arm);
      }
      lift(st);
    }
  };
  if (still != null || embedded) seed();

  // --- input
  const onRecord = (x, y) => Math.hypot(x - C[0], y - C[1]) < R;
  const speedOf = (p) => Math.hypot(p.vx, p.vy);

  stage.on("down", (p) => {
    if (!woke) {
      woke = true;
      sound.unlock();
    } else sound.unlock();
    mode = "pending";
    downAt = performance.now();
    downX = p.x;
    downY = p.y;
    stroke = newStroke();
    if (onRecord(p.x, p.y)) cut(stroke, ...toLocal(p.x, p.y), 0);
  });
  stage.on("move", (p) => {
    if (!p.down) {
      // The light leans toward the pointer, so the fan turns to meet it.
      if (onRecord(p.x, p.y) || Math.hypot(p.x - C[0], p.y - C[1]) < R * 2.2) lightTarget = Math.atan2(p.y - C[1], p.x - C[0]);
      return;
    }
    if (mode === "pending" && Math.hypot(p.x - downX, p.y - downY) > 4) mode = "scratch";
    if (mode === "scratch" || mode === "hold") cut(stroke, ...toLocal(p.x, p.y), speedOf(p));
  });
  stage.on("up", () => {
    mode = "idle";
    stroke = null;
  });

  // --- sound per frame
  const ensureSurf = () => {
    if (surf || !sound.live) return;
    surf = sound.loop(surfBank);
  };
  let lastRel = null;
  const listen = (dt) => {
    const speed = omega / OMEGA;
    if (speed > 0.02) ensureSurf();
    if (surf && sound.ctx) {
      const t = sound.ctx.currentTime;
      const bed = clamp(speed, 0, 1.2) * (0.5 + Math.min(0.5, total / 12000));
      surf.gain.setTargetAtTime(db(-24) * bed, t, 0.05);
      surf.rate.setTargetAtTime(Math.max(0.001, speed), t, 0.05);
    }
    // The stylus sits where the fan points at the light. Sweep it through
    // the bins this frame covered, in record space.
    let rel = (lightAz - angle) % TAU;
    if (rel < 0) rel += TAU;
    if (lastRel == null || speed < 0.05 || !sound.live) {
      lastRel = rel;
      return;
    }
    let sweep = lastRel - rel; // the record turns clockwise, so rel falls
    if (sweep < 0) sweep += TAU;
    if (sweep > Math.PI) {
      lastRel = rel;
      return;
    }
    const b0 = (lastRel / TAU) * BINS;
    const nb = (sweep / TAU) * BINS;
    let hits = 0;
    for (let i = 0; i < Math.ceil(nb) && hits < 6; i += 1) {
      const bi = ((Math.floor(b0 - i) % BINS) + BINS) % BINS;
      const s = bins[bi];
      if (s < 0.02) continue;
      hits += 1;
      const at = (i / Math.max(1, nb)) * dt;
      const rate = 0.55 + 0.45 * Math.min(1.1, speed);
      const level = 20 * Math.log10(Math.min(1, s)) - 6 + 12 * Math.log10(Math.max(0.05, speed));
      if (s > 0.6 && Math.random() < 0.7) sound.play(popBank, { gain: level - 2, rate, at, pan: 0.15 });
      else sound.play(tickBank, { gain: level, rate: rate * (0.9 + Math.random() * 0.2), at, pan: 0.15 });
    }
    lastRel = rel;
  };

  stage.onResize((w, h) => {
    // Close enough to read the damage: the record runs off the frame, the
    // fan crosses it edge to edge, the label sits a little off centre.
    const m = Math.min(w, h);
    R = Math.round(m * 0.7);
    C = [w * 0.5 + (w > h ? m * 0.08 : 0), h * 0.5 + (w > h ? 0 : m * 0.1)];
  });

  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    const now = performance.now();
    if (mode === "pending" && now - downAt > 170) mode = "hold";

    // Torque up while held, coast down when let go.
    const target = mode === "hold" ? OMEGA : 0;
    omega = damp(omega, target, target > omega ? 1.9 : 0.75, dt);
    if (omega < 0.002 && target === 0) omega = 0;
    let blur = omega / 60; // a 1/60 s shutter
    if (still != null) {
      omega = OMEGA * still;
      blur = (OMEGA * still) / 60;
    }
    angle += omega * dt;

    // Light: follows a hovering pointer, drifts slowly back when left alone.
    let dl = lightTarget - lightAz;
    dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    lightAz = damp(lightAz, lightAz + dl, 3.2, dt);
    if (!stage.pointer.down && stage.idleFor() > 5000) lightTarget += dt * 0.05;

    listen(dt);
    flush();

    const el = 0.92; // ~53 degrees up
    const L = [Math.cos(lightAz) * Math.cos(el), Math.sin(lightAz) * Math.cos(el), Math.sin(el)];

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uDpr, stage.dpr);
    gl.uniform2f(U.uC, C[0], C[1]);
    gl.uniform1f(U.uR, R);
    gl.uniform1f(U.uA, angle);
    gl.uniform1f(U.uBlur, blur);
    gl.uniform3f(U.uL, L[0], L[1], L[2]);
    gl.uniform2f(U.uEcc, 0.0035, -0.002);
    gl.uniform1f(U.uTex, 1 / S);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dmgTex);
    gl.uniform1i(U.uDmg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, labTex);
    gl.uniform1i(U.uLab, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dirTex);
    gl.uniform1i(U.uDir, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return {
    destroy() {
      surf?.stop();
      sound.destroy();
      [dmgTex, dirTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteFramebuffer(fbo);
      stage.destroy();
    },
  };
}
