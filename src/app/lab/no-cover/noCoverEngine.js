import { createStage, clamp, damp } from "../_kit/stage";
import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./noCoverTakes";
import { LABEL, rng, handle, fingertip, drag, lift } from "./noCoverHandling";
import { decodeProgramme, cutLacquer, SR, SPT, TURN, WR, WAVE_W } from "./noCoverLathe";

// After Christian Marclay, Record Without a Cover (1985): a record sold with
// no sleeve, so the marks of handling become part of what it plays.
//
// The record is drawn in one full-screen pass at the true proportions of a
// 12-inch LP (302 mm across, 100 mm label), close enough that it runs off the
// frame. Its grooves are cut from a real programme (see noCoverLathe.js): a
// public-domain recording of Satie's first Gymnopedie, decoded with WebAudio
// and fed to a variable-pitch lathe, so loud passages spread the turns wide,
// quiet ones pack them tight, the silence between the two tracks is a band of
// flat vinyl and the run-out spirals down to the locked groove. A bake pass
// turns the spiral into a field fixed to the record, 4096 texels across: how
// much of each texel is groove wall, which way its walls tilt, and the slope
// of the groove where the waveform pushes it sideways, the part a texel
// resolves as a mean and the part it cannot as an energy. Each turn is
// displaced sideways by the waveform itself, by less than a texel.
//
// The light reads that field through one anisotropic lobe (Kajiya-Kay along
// the groove, Ward across it): a groove lights only where it runs across the
// half vector, a narrow fan through the centre that turns with the light. Where
// the music is quiet the groove barely wanders and the fan is a hard, clean
// streak; where it is loud the groove swings, the lobe tilts and spreads with
// it, and the fan breaks into a scattered shimmer; the band between the tracks
// is near-flat vinyl and stays dark. The pressing is a hair off centre and a
// little warped, so the fan sways.
//
// Damage is a height field fixed to the record, 4096 texels across. What is
// in it is not drawn: it comes from a simulation of handling (see
// noCoverHandling.js). The record is slid out of stacks, covered by others,
// wiped, held and set on the spindle a few hundred times, each a rigid motion
// against a patch of grit, and every grain's path through the motion is cut
// in. A drag goes through the same contact: the pointer is a fingertip with
// grit under it. Each cut is stamped with a profile: a trench in the middle,
// the displaced vinyl heaped into a continuous lip of burr either side, the
// walls chipped where a hard grain ploughed deep. A second target keeps the
// direction the grit travelled, weighted by how much of a texel the cut
// covers. The shader reads both prefiltered to the pixel, takes normals from
// the height and lights each cut with the same lobe as the grooves, along its
// own direction, so a scratch flares only where it lies across the light, and
// every family of arcs from one handling lights up as its own small fan. Where
// a cut runs, the groove is broken and its sheen stops.
//
// Spinning is a shutter's worth of rotation integrated per pixel: as many
// taps as the arc covers pixels, each offset by its own blue-noise jitter and
// weighted by a shutter that opens and closes, and the paper label is
// integrated in the same loop, so it smears with the vinyl. Each cut also
// leaves its angle in a ring of bins; spinning sweeps the stylus through the
// bins, and every bin with damage in it ticks or pops. Pressing and holding
// drops the stylus at the radius pressed: it plays the programme from that
// turn at the platter's own speed (eccentricity and all), and the scratches
// it meets in its ring tick and pop over the music they cut through.

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
  float ext = aCut.x * 4.2 + uTexel * 4.0;
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
uniform float uTexel;
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
  float depth = vCut.y, burrH = vCut.z, seed = vCut.w;
  // Nothing is narrower than the field can hold: a trench at least a texel
  // and a half across, a burr at least two, so neither breaks into single
  // texels that light up as grit.
  float hw = max(vCut.x, 0.75 * uTexel);
  float dist = length(pa - ba * h);
  float side = ba.x * pa.y - ba.y * pa.x > 0.0 ? 1.0 : -1.0;
  // Noise lives on the record, not on the segment, so a cut stays one
  // continuous thing across every segment it was drawn in.
  vec2 tp = vP * uSize * 0.5;
  float nA = vnoise(tp * 0.035 + seed * 13.1);
  float nB = vnoise(tp * 0.011 + seed * 5.7);
  // Chips: where a hard grain ploughs deep, the wall breaks away in bites.
  float chip = smoothstep(0.62, 0.92, vnoise(tp * 0.03 + side * 19.3 + seed * 7.0)) * smoothstep(0.35, 0.8, depth);
  float wl = 1.0 + 1.3 * chip;
  float dd = dist / (hw * wl);
  float trench = depth * (0.5 + 0.5 * nB) * (0.75 + 0.5 * nA) * max(0.0, 1.0 - dd * dd);
  // Burrs: the vinyl the grit pushed aside, heaped in a continuous lip each
  // side, swelling and thinning slowly along the cut.
  float bc = hw * wl * 1.3 + 0.5 * uTexel;
  float bs = max(0.5 * hw, 1.0 * uTexel);
  float swell = vnoise(tp * 0.018 + side * 41.0 + seed * 2.1);
  float burr = burrH * exp(-pow((dist - bc) / bs, 2.0)) * (0.55 + 0.45 * swell) * (0.8 + 0.4 * nA);
  float alpha = (1.0 - smoothstep(bc + 1.4 * bs, bc + 2.4 * bs, dist)) * clamp(0.3 + depth * 1.4, 0.0, 1.0);
  vec2 u = normalize(ba + vec2(1e-9, 0.0));
  float a2 = 2.0 * atan(u.y, u.x);
  oH = vec4(clamp(trench, 0.0, 1.0), clamp(burr, 0.0, 1.0), 0.0, alpha);
  // The direction is written only across the cut itself, so that once it is
  // filtered to a pixel its strength is the share of the pixel that is cut.
  float cover = 1.0 - smoothstep(0.7, 1.15, dd);
  oD = vec4(0.5 + 0.5 * cos(a2), 0.5 + 0.5 * sin(a2), 0.0, cover);
}`;


// --- the lathe's spiral, baked into the record-space groove field
const BAKE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSpiral;  // radius, half width; SPT a turn
uniform highp sampler2D uWave;    // displacement, slope, fine slope, modulated
uniform float uSize;
uniform int uTurns;
uniform float uLead;              // seconds of lead-in before the programme
uniform float uDur;               // programme length
uniform int uWaveN;
uniform float uLat;               // full-scale sideways swing, record units
uniform float uSmax;
uniform vec2 uEcc;
out vec4 o;
const int SPT = ${SPT};
const float TURN = ${TURN.toFixed(4)};
const float WR = ${WR.toFixed(2)};
const int WW = ${WAVE_W};
vec2 spiralAt(float f){
  f = clamp(f, 0.0, float(uTurns * SPT) - 1.001);
  float fi = floor(f);
  int i = int(fi);
  vec2 a = texelFetch(uSpiral, ivec2(i % SPT, i / SPT), 0).rg;
  vec2 b = texelFetch(uSpiral, ivec2((i + 1) % SPT, (i + 1) / SPT), 0).rg;
  return mix(a, b, f - fi);
}
vec4 waveAt(float t){
  if (t < 0.0 || t >= uDur) return vec4(0.0);
  float f = t * WR;
  int i = min(int(f), uWaveN - 2);
  vec4 a = texelFetch(uWave, ivec2(i % WW, i / WW), 0);
  vec4 b = texelFetch(uWave, ivec2((i + 1) % WW, (i + 1) / WW), 0);
  return mix(a, b, fract(f));
}
void main(){
  vec2 p = gl_FragCoord.xy / uSize * 2.0 - 1.0 - uEcc;
  float r = length(p);
  float tex = 2.0 / uSize;
  // The record turns clockwise on screen, so the stylus reads the groove
  // toward falling angle: the fraction of a turn grows as the angle falls.
  float u = fract(-atan(p.y, p.x) / 6.2831853);
  float r0 = spiralAt(u * float(SPT)).x;
  float rN = spiralAt((float(uTurns - 1) + u) * float(SPT)).x;
  if (r > r0 + 0.004 || r < rN - 0.004) { o = vec4(0.0, 0.5, 0.0, 0.5); return; }
  // Find the two turns either side of this texel: radius falls turn by turn.
  int lo = 0, hi = uTurns - 1;
  if (r >= r0) hi = 0;
  else if (r <= rN) lo = uTurns - 1;
  else for (int it = 0; it < 12; it++) {
    if (hi - lo <= 1) break;
    int mid = (lo + hi) / 2;
    if (spiralAt((float(mid) + u) * float(SPT)).x >= r) lo = mid; else hi = mid;
  }
  float cov = 0.0, sM = 0.0, sE = 0.0, tilt = 0.0;
  for (int j = 0; j < 2; j++) {
    int g = j == 0 ? lo : hi;
    if (j == 1 && hi == lo) break;
    float f = (float(g) + u) * float(SPT);
    vec2 sp = spiralAt(f);
    vec4 w = waveAt(f / float(SPT) * TURN - uLead);
    // The cut: displaced sideways by the waveform, a V of the lathe's width.
    float d = r - (sp.x + uLat * w.r * w.a);
    float hw = sp.y;
    float c = clamp((hw - abs(d)) / tex + 0.5, 0.0, 1.0);
    // Its slope along the groove: how fast it swings sideways for each unit
    // it runs forward, resolved, and the energy finer than a texel.
    float v = 6.2831853 * r / TURN;
    float s = uLat * w.g * w.a / v;
    float sf = uLat * w.b * w.a / v;
    cov += c;
    sM += c * s;
    sE += c * (s * s + sf * sf);
    // The walls: the outer one faces in, the inner one out.
    tilt += c * clamp(d / max(hw, tex), -1.0, 1.0);
  }
  // Slope mean and RMS are stored weighted by the groove's share of the
  // texel, so they average right through the mips and divide back out.
  float rmsS = cov > 0.0 ? sqrt(sE / cov) * min(cov, 1.0) : 0.0;
  cov = min(cov, 1.0);
  o = vec4(cov, 0.5 + 0.5 * clamp(sM / uSmax, -1.0, 1.0), clamp(rmsS / uSmax, 0.0, 1.0), 0.5 + 0.5 * clamp(tilt, -1.0, 1.0));
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uC; uniform float uR;
uniform float uA; uniform float uBlur; uniform vec3 uL; uniform vec2 uEcc;
uniform sampler2D uDmg; uniform sampler2D uDir; uniform sampler2D uLab;
uniform sampler2D uGroove;
uniform float uTex; uniform float uLod; uniform float uSmax;
out vec4 o;

const float LABEL = 0.331;   // 50 / 151
const float HOLE = 0.0238;   // 3.6 / 151
const int TAPS = 48;
const float WALL = 0.22;     // how far a groove wall's share tilts the normal
const float SIG = 0.05;      // groove slope spread that doubles the lobe
const float HB = 0.55;       // burr height, relative to trench depth
const float SLOPE = 1.25;    // height per texel to surface slope

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Interleaved gradient noise: a cheap blue-ish dither per pixel.
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
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

    float lab = 1.0 - smoothstep(LABEL - aa * 0.6, LABEL + aa * 0.6, r);
    float labWide = 1.0 - step(LABEL + 4.0 * aa, r);

    // The shutter: the arc this pixel sweeps while it is open, integrated with
    // a tap per pixel of travel, each tap jittered within its stratum by its
    // own blue-noise offset. Clean vinyl costs a tap two fetches, the groove
    // and the damage; only taps that land on damage pay for its normal.
    float arc = uBlur * r * uR * uDpr;
    int n = uBlur > 1e-4 ? int(clamp(ceil(arc / 1.4), 1.0, float(TAPS))) : 1;
    float bn = ign(gl_FragCoord.xy);
    // Taps further apart than a pixel would each find a hairline or miss it:
    // read the field filtered to the spacing of the taps instead.
    float spread = max(1.0, arc / float(n));
    float lod = uLod + log2(spread);
    float step_ = uTex * spread;
    float spec = 0.0, stress = 0.0, cavity = 0.0, scuff = 0.0, grooved = 0.0;
    vec3 paper = vec3(0.0);
    float wsum = 0.0;
    vec2 radial = dg / max(rg, 1e-4);
    for (int i = 0; i < TAPS; i++) {
      if (i >= n) break;
      float u = n == 1 ? 0.5 : (float(i) + fract(bn + float(i) * 0.6180339)) / float(n);
      float a = uA - uBlur * (u - 0.5);
      vec2 l = rot(q, -a);                      // record-local
      vec2 uv = l * 0.5 + 0.5;
      // The shutter opens and closes rather than snapping: taps near its ends
      // count for less, so a smeared scratch fades in and out, not a block.
      float w = n == 1 ? 1.0 : 0.2 + 0.8 * sin(3.14159265 * u);
      wsum += w;
      if (labWide > 0.0) paper += w * texture(uLab, l / LABEL * 0.5 + 0.5).rgb;

      // The groove, as the lathe cut it: its share of the pixel, the way its
      // walls lean, and how far the music swings it off its circle, as a mean
      // tilt of its direction and a spread around it.
      vec4 gf = textureLod(uGroove, uv, lod);
      float gcov = gf.r;
      // The swing is read a level coarser than the rings: what the eye takes
      // from it is the tilt of a few waves together and their spread, not the
      // sign of each one, which would tile the groove into cells.
      vec4 gw = textureLod(uGroove, uv, lod + 1.25);
      float ic = 1.0 / max(gw.r, 0.04);
      float gs = (gw.g * 2.0 - 1.0) * uSmax * ic;
      float grms = gw.b * uSmax * ic;
      float gvar = max(grms * grms - gs * gs, 0.0);
      float wT = sqrt(1.0 + gvar / (SIG * SIG));
      vec3 Ng = normalize(vec3(radial * (gf.a * 2.0 - 1.0) * WALL, 1.0));
      vec3 Tm = vec3(normalize(Tg + radial * gs), 0.0);
      grooved += w * gcov;

      // The damage: height from trench and burr, normal from its slope.
      vec2 s0 = textureLod(uDmg, uv, lod).rg;
      scuff += w * s0.r;
      if (s0.r + s0.g < 0.002) {
        vec3 T1 = normalize(Tm - Ng * dot(Tm, Ng));
        // A lobe spread wider is dimmer for it: the same light, scattered.
        spec += w * gcov * aniso(T1, cross(Ng, T1), Ng, Hw, wT, 2.5) / wT;
        continue;
      }
      // The field is read prefiltered to the pixel (a mip level picked from
      // the zoom), and its slope by central differences a pixel apart: a
      // hairline narrower than a pixel dims and widens to one, it does not
      // break into lit and unlit texels.
      vec2 e = vec2(step_, 0.0);
      vec2 sxp = textureLod(uDmg, uv + e.xy, lod).rg, sxm = textureLod(uDmg, uv - e.xy, lod).rg;
      vec2 syp = textureLod(uDmg, uv + e.yx, lod).rg, sym = textureLod(uDmg, uv - e.yx, lod).rg;
      float hx = (sxp.g - sxm.g) * HB - (sxp.r - sxm.r);
      float hy = (syp.g - sym.g) * HB - (syp.r - sym.r);
      vec2 grad = rot(vec2(hx, hy) * 0.5 * SLOPE, a);
      // The scratch has its own walls; the groove's lean only where the
      // groove survives.
      vec3 Nd = normalize(vec3(-grad, 1.0));
      vec3 N = normalize(vec3(-grad + Ng.xy / Ng.z, 1.0));
      float dmg = s0.r + s0.g;
      float brk = smoothstep(0.03, 0.22, dmg);

      // How much of this pixel is scratch, whatever its depth: the direction
      // field is written with the cut's coverage, so after the mip filter the
      // length of the averaged direction is the share of the pixel it covers.
      vec2 de = textureLod(uDir, uv, lod).rg * 2.0 - 1.0;
      float cov = smoothstep(0.02, 0.6, length(de));
      float ang = 0.5 * atan(de.y, de.x) + a;
      vec2 D = vec2(cos(ang), sin(ang));
      vec3 T3 = normalize(vec3(D, 0.0) - Nd * dot(vec3(D, 0.0), Nd));
      vec3 B3 = cross(Nd, T3);
      vec3 Tg3 = normalize(Tm - N * dot(Tm, N));

      // Two lobes. The groove's, on the tilted surface, where the groove
      // survives. And the scratch's own, along the line the grit travelled:
      // a hairline is a tiny cylinder, lit along its length only where it
      // crosses the light and free across it, so a family of arcs about one
      // centre lights up as its own small fan; a deep cut's walls are facets,
      // narrow across, so only the wall that faces the light catches it.
      float fg = aniso(Tg3, cross(N, Tg3), N, Hw, wT, 2.5) / wT;
      float fs = aniso(T3, B3, Nd, Hw, 1.9, mix(2.2, 0.34, brk));
      spec += w * (fg * gcov * (1.0 - max(brk, 0.6 * cov)) + fs * cov * (1.25 + 0.8 * s0.g));
      // Fresh-cut vinyl stress-whitens a little, and the floor of a deep
      // trench sits in its own shadow.
      stress += w * (s0.g * 0.8 + s0.r * 0.35) * (0.4 + 0.6 * max(dot(Nd, uL), 0.0));
      cavity += w * s0.r;
    }
    float fn = wsum;
    spec /= fn;
    stress /= fn; cavity /= fn; paper /= fn; scuff /= fn; grooved /= fn;

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
      // Spindle marks: where the spindle's tip dragged across the paper
      // hunting for the hole, it rubbed in a grey trail of grease and fibre.
      labc *= 1.0 - 0.55 * clamp(scuff * 1.6, 0.0, 1.0);
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
const BINS = 720;
const RINGS = 40; // the bins again by radius, so the stylus hears its own ring
const LAT = 0.0004; // full-scale sideways swing of the cut: 0.06 mm, under a texel
const SMAX = 0.35; // the steepest groove slope the field holds

// Should the programme not load, a stand-in the lathe can still cut: two
// short tracks of soft partials with a gap between.
function standIn() {
  const x = new Float32Array(Math.round(SR * 60));
  const r = rng(33);
  for (let k = 0; k < 40; k += 1) {
    const t0 = k * 1.45 + (k >= 20 ? 3.5 : 0);
    if (t0 > 58) break;
    const f = 196 * Math.pow(2, Math.floor(r() * 12) / 12);
    const amp = 0.05 + 0.25 * Math.pow(Math.sin((k / 20) * Math.PI), 2);
    const n0 = Math.round(t0 * SR);
    for (let i = 0; i < SR * 1.4 && n0 + i < x.length; i += 1) {
      const t = i / SR;
      x[n0 + i] += amp * Math.exp(-t * 2.2) * (Math.sin(6.2832 * f * t) + 0.3 * Math.sin(12.566 * f * t));
    }
  }
  return x;
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
  // The programme the grooves are cut from: fetched and decoded while the
  // rest is set up.
  const decoding = decodeProgramme("/lab/no-cover/gymnopedie.mp3").catch((err) => {
    console.warn("no-cover: programme did not load, cutting a stand-in", err);
    return null;
  });

  const prog = program(gl, VS, FS);
  const U = {};
  for (const n of ["uRes", "uDpr", "uC", "uR", "uA", "uBlur", "uL", "uEcc", "uDmg", "uDir", "uLab", "uGroove", "uTex", "uLod", "uSmax"]) U[n] = gl.getUniformLocation(prog, n);
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
  const LEVELS = Math.log2(S) + 1;
  const fieldTex = (format = gl.RG8) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, LEVELS, format, S, S);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
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
  const mips = () => {
    for (const t of [dmgTex, dirTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  };
  mips();

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
    mips();
    nInst = 0;
  };

  const labTex = makeTex(await drawLabel(512));

  // --- the groove field: the lathe's spiral, cut from the programme, baked
  // once into record space at the field's resolution.
  const ECC = [0.0035, -0.002];
  const decoded = await decoding;
  const lathe = cutLacquer(decoded ? decoded.getChannelData(0) : standIn());
  const programme = decoded;
  const grooveTex = fieldTex(gl.RGBA8);
  {
    const dataTex = (internal, format, w, h, data) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, data);
      return t;
    };
    const spiralTex = dataTex(gl.RG32F, gl.RG, SPT, lathe.turns, lathe.spiral);
    const waveTex = dataTex(gl.RGBA16F, gl.RGBA, WAVE_W, lathe.waveH, lathe.wave);
    const bake = program(gl, VS, BAKE_FS);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, grooveTex, 0);
    gl.viewport(0, 0, S, S);
    gl.useProgram(bake);
    const u = (n) => gl.getUniformLocation(bake, n);
    gl.uniform1f(u("uSize"), S);
    gl.uniform1i(u("uTurns"), lathe.turns);
    gl.uniform1f(u("uLead"), lathe.leadT);
    gl.uniform1f(u("uDur"), lathe.D);
    gl.uniform1i(u("uWaveN"), lathe.nw);
    gl.uniform1f(u("uLat"), LAT);
    gl.uniform1f(u("uSmax"), SMAX);
    gl.uniform2f(u("uEcc"), ECC[0], ECC[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, spiralTex);
    gl.uniform1i(u("uSpiral"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.uniform1i(u("uWave"), 1);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(spiralTex);
    gl.deleteTexture(waveTex);
    gl.deleteProgram(bake);
    gl.bindTexture(gl.TEXTURE_2D, grooveTex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // Damage by angle and ring on the record, for the stylus to find.
  const bins = new Float32Array(BINS * RINGS);

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
  let tip = null; // the fingertip on the record, with its grit
  let tipQ = null; // where it last was, on the table
  let tipA = 0; // and the record's angle then
  let tipS = 0; // its speed, smoothed
  let tipPress = 1;
  let tipMoved = 0;
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

  // Every segment any grain cuts lands here: into the field, and into the
  // bins by its angle on the record, for the stylus to find.
  const cutSeg = (x0, y0, x1, y1, hw, depth, burr, sd) => {
    pushSeg(x0, y0, x1, y1, hw, depth, burr, sd);
    const mx = x0 + x1;
    const my = y0 + y1;
    if (Math.hypot(mx, my) < LABEL * 2) return; // the spindle on the paper
    const th0 = Math.atan2(my, mx);
    const th = th0 < 0 ? th0 + TAU : th0;
    const bi = Math.floor((th / TAU) * BINS) % BINS;
    const ring = Math.min(RINGS - 1, Math.floor(Math.hypot(mx, my) * 0.5 * RINGS));
    const lp = Math.hypot(x1 - x0, y1 - y0) * 512; // in the old 1024-texel units the sound was tuned in
    const k = ring * BINS + bi;
    bins[k] = Math.min(2, bins[k] + lp * 0.27 * depth * depth);
    total += lp * Math.min(1, depth * 2);
  };

  // The seeded history: a few hundred handlings, simulated. The deep cuts go
  // in last, so the hairlines of later wipes do not paper over a gouge.
  if (still != null || embedded) {
    handle(1985, cutSeg);
    const order = Array.from({ length: nInst }, (_, i) => i).sort((i, j) => inst[i * 8 + 5] - inst[j * 8 + 5]);
    const sorted = new Float32Array(inst.length);
    order.forEach((i, k) => sorted.set(inst.subarray(i * 8, i * 8 + 8), k * 8));
    inst = sorted;
  }

  // --- input
  const onRecord = (x, y) => Math.hypot(x - C[0], y - C[1]) < R;
  const speedOf = (p) => Math.hypot(p.vx, p.vy);

  // A drag is a fingertip with grit under it, through the same contact as
  // the history: each grain's path is the finger's track carried into the
  // record's frame, which turns under it while it spins. Pressure and speed
  // set the load.
  const tableQ = (p) => [(p.x - C[0]) / R, (p.y - C[1]) / R];
  const advance = (p) => {
    const q = tableQ(p);
    const r = Math.hypot(q[0], q[1]);
    const rel = speedOf(p) + omega * r * R; // finger against vinyl, px/s
    tipS += (clamp(rel / 1400, 0, 1) - tipS) * 0.35;
    const load = (0.4 + 0.85 * tipS) * tipPress;
    drag(tip, tipQ, q, tipA, angle, load, cutSeg);
    tipQ = q;
    tipA = angle;
    tipMoved = performance.now();
  };

  stage.on("down", (p, e) => {
    if (!woke) {
      woke = true;
      sound.unlock();
    } else sound.unlock();
    mode = "pending";
    downAt = performance.now();
    downX = p.x;
    downY = p.y;
    tip = fingertip();
    tipQ = tableQ(p);
    tipA = angle;
    tipS = 0;
    // A pen says how hard it is pressed; a mouse or a finger cannot.
    tipPress = e?.pointerType === "pen" && e.pressure > 0 ? 0.5 + e.pressure : 1;
  });
  stage.on("move", (p, e) => {
    if (!p.down) {
      // The light leans toward the pointer, so the fan turns to meet it.
      if (onRecord(p.x, p.y) || Math.hypot(p.x - C[0], p.y - C[1]) < R * 2.2) lightTarget = Math.atan2(p.y - C[1], p.x - C[0]);
      return;
    }
    if (e?.pointerType === "pen" && e.pressure > 0) tipPress = 0.5 + e.pressure;
    if (mode === "pending" && Math.hypot(p.x - downX, p.y - downY) > 4) mode = "scratch";
    if (tip && (mode === "scratch" || mode === "hold")) advance(p);
  });
  stage.on("up", () => {
    mode = "idle";
    tip = null;
  });

  // --- sound per frame
  const ensureSurf = () => {
    if (surf || !sound.live) return;
    surf = sound.loop(surfBank);
  };
  // The programme under the stylus: where in it the stylus sits, and the
  // voice playing it, at the rate the platter turns the groove past.
  let stylusT = null;
  let voice = null;
  const dropStylus = (x, y) => {
    const r = clamp(Math.hypot(x - C[0], y - C[1]) / R, lathe.radiusAt(lathe.tEnd) + 0.002, 0.984);
    stylusT = lathe.timeAt(r);
    voice?.stop();
    voice = null;
  };
  const startVoice = (rate) => {
    const ctx = sound.ctx;
    if (!ctx || !programme || ctx.state !== "running") return;
    const src = ctx.createBufferSource();
    src.buffer = programme;
    src.playbackRate.value = Math.max(1e-4, rate);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 9000;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(db(-3), ctx.currentTime, 0.01);
    src.connect(lp);
    lp.connect(g);
    g.connect(sound.out);
    src.start(ctx.currentTime, stylusT);
    const v = {
      src,
      g,
      stop() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.015);
        src.stop(t + 0.1);
      },
    };
    src.onended = () => {
      g.disconnect();
      if (voice === v) voice = null;
    };
    voice = v;
  };
  // Eccentricity: the groove's centre is a hair off the spindle, so the
  // stylus sees its speed rise and fall once a turn.
  const eccR = Math.hypot(...ECC);
  const play = (dt, speed) => {
    if (stylusT == null) return;
    const rs = lathe.radiusAt(stylusT);
    const wow = 1 + (eccR / rs) * Math.sin(angle - lightAz + Math.atan2(ECC[1], ECC[0]));
    const rate = speed * wow;
    stylusT += rate * dt;
    const inProgramme = stylusT >= 0 && stylusT < lathe.D - 0.05;
    if (!voice && speed > 0.02 && inProgramme && mode === "hold" && sound.live) startVoice(rate);
    if (voice && sound.ctx) voice.src.playbackRate.setTargetAtTime(Math.max(1e-4, rate), sound.ctx.currentTime, 0.02);
    if (voice && (speed < 0.004 || !inProgramme)) {
      voice.stop();
      voice = null;
    }
  };

  let lastRel = null;
  const listen = (dt) => {
    const speed = omega / OMEGA;
    play(dt, speed);
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
    // Only the ring the stylus is riding: it hears the scratches that cross
    // its groove, not the ones elsewhere on the record.
    const rs = stylusT == null ? 0.7 : lathe.radiusAt(stylusT);
    const ring = Math.min(RINGS - 1, Math.floor(rs * RINGS)) * BINS;
    let hits = 0;
    for (let i = 0; i < Math.ceil(nb) && hits < 6; i += 1) {
      const bi = ((Math.floor(b0 - i) % BINS) + BINS) % BINS;
      const s = bins[ring + bi];
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
    if (mode === "pending" && now - downAt > 170) {
      mode = "hold";
      dropStylus(downX, downY);
    }
    // A finger held still while the record spins up is on the platter's
    // edge, not on the vinyl: it lifts, and touches down again when it moves.
    if (tip && mode === "hold" && now - tipMoved > 60) {
      lift(tip);
      tipQ = tableQ(stage.pointer);
      tipA = angle;
    }

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
    gl.uniform2f(U.uEcc, ECC[0], ECC[1]);
    gl.uniform1f(U.uSmax, SMAX);
    // One pixel of screen, in texels of the field: the mip level to read at,
    // and the step for the slope.
    const pxTex = S / (2 * R * stage.dpr);
    gl.uniform1f(U.uLod, Math.max(0, Math.log2(pxTex)));
    gl.uniform1f(U.uTex, Math.max(1, pxTex) / S);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dmgTex);
    gl.uniform1i(U.uDmg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, labTex);
    gl.uniform1i(U.uLab, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dirTex);
    gl.uniform1i(U.uDir, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, grooveTex);
    gl.uniform1i(U.uGroove, 3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return {
    destroy() {
      surf?.stop();
      voice?.stop();
      sound.destroy();
      [dmgTex, dirTex, grooveTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteFramebuffer(fbo);
      stage.destroy();
    },
  };
}
