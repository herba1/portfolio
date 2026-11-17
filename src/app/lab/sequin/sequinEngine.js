import { createStage, clamp } from "../_kit/stage";
import { albumById, loadCover } from "../_kit/covers";
import { FOILS, ditherFoils } from "./foil";

// Flip sequins. Every sequin is one instanced, cupped disc with a hole in
// the middle, lying shingled on a scrap of fabric. Brushing across a sequin
// turns it over about the axis at right angles to the stroke, through a real
// rotation, so its normal sweeps through the room's lights on the way. One
// side is near-black matte charcoal that knows nothing of the picture; the
// other is a mirror of coloured foil, one of a small bag of stock foils
// (foil.js), picked for each sequin by error diffusion over the cover, so
// the picture is a real sequin picture and not a photo cut into scales. The room is dark but for a few big sharp softboxes
// overhead and some small, very hot ones low around it. A settled mirror has
// no diffuse at all: it is dark tinted metal unless its lean points it at a
// box, and then it throws back a sharp image of the box in its own colour. Each mirror is coloured metal: what it
// throws back of a box is the box times its own tint, so a silver disc flares
// hot and white, a teal one flares cyan, and a black one only glows a
// dim, deep version of itself. The glitter is the picture's own silver.
// The cloth itself is draped, not flat: every sequin leans with the fold it
// lies on, so the light forms bands that follow the cloth, and the hand
// presses a dent into it that springs back once it passes.

const VS = `#version 300 es
layout(location=0) in vec2 aLocal;
layout(location=1) in vec4 aPos;    // x, y, z, seed
layout(location=2) in vec2 aTilt;   // rest lean: the drape's slope at its centre, plus its own small wobble
layout(location=3) in vec3 aColor;  // the sequin's foil, as linear F0
layout(location=4) in vec3 aFlip;   // phi, axis.x, axis.y
layout(location=5) in vec2 aShape;  // the press: which way the cup is deeper, and by how much
uniform vec2 uRes; uniform float uR; uniform float uCup; uniform float uZ;
uniform vec4 uRip[4];               // x, y, age, amplitude
// The hand's dent in the drape: a height grid over the swatch, in px.
uniform sampler2D uDent; uniform vec4 uRect; uniform vec2 uDentCell;
out vec3 vW; out vec3 vC; out vec2 vL; out vec2 vCenter; out float vFace; out float vLift;
flat out mat3 vB; flat out vec2 vShape;

vec3 rot(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }

void main(){
  vec2 l = aLocal;
  float rho2 = dot(l, l);
  // A pressed sequin is flat in the middle and curls up at the rim. No two
  // come off the press alike: the curl is an ellipse, deeper along one
  // axis, so each rim glint stretches its own way.
  float cs = cos(aShape.x), sn = sin(aShape.x);
  vec2 lr = vec2(cs * l.x + sn * l.y, -sn * l.x + cs * l.y);
  float q = (1.0 + aShape.y) * lr.x * lr.x + (1.0 - aShape.y) * lr.y * lr.y;
  vec3 p = vec3(l * uR, uCup * q * q * uR);
  // The disc's frame; the fragment shader rebuilds the cup normal in it
  // per pixel, so a highlight smaller than a triangle stays a clean shape.
  vec3 bx = vec3(1.0, 0.0, 0.0), by = vec3(0.0, 1.0, 0.0), f = vec3(0.0, 0.0, 1.0);

  // The flip, about an axis in the fabric's plane.
  vec3 k = vec3(aFlip.y, aFlip.z, 0.0);
  float phi = aFlip.x;
  p = rot(p, k, phi); bx = rot(bx, k, phi); by = rot(by, k, phi); f = rot(f, k, phi);

  // The drape's lean, the hand's dent, and any ripple passing through.
  // Neighbours share the fabric's slope, so they turn to the light together.
  vec2 duv = (aPos.xy - uRect.xy) / (uRect.zw - uRect.xy);
  vec2 te = 1.0 / vec2(textureSize(uDent, 0));
  float dh = textureLod(uDent, duv, 0.0).r;
  vec2 dg = vec2(
    textureLod(uDent, duv + vec2(te.x, 0.0), 0.0).r - textureLod(uDent, duv - vec2(te.x, 0.0), 0.0).r,
    textureLod(uDent, duv + vec2(0.0, te.y), 0.0).r - textureLod(uDent, duv - vec2(0.0, te.y), 0.0).r
  ) / (2.0 * uDentCell);
  vec2 slope = aTilt - dg;
  float rl = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    vec2 dv = aPos.xy - r.xy;
    float d = length(dv) + 1e-3;
    float front = d - 360.0 * r.z;
    float g = exp(-front * front / (2.0 * 26.0 * 26.0));
    float a = r.w * exp(-r.z * 2.4) * smoothstep(0.0, 0.06, r.z);
    slope += dv / d * (-front / 26.0) * g * a * 0.42;
    rl += g * a;
  }
  float sl = length(slope);
  if (sl > 1e-5) {
    vec3 tk = vec3(-slope.y, slope.x, 0.0) / sl;
    p = rot(p, tk, sl); bx = rot(bx, tk, sl); by = rot(by, tk, sl); f = rot(f, tk, sl);
  }

  float lift = abs(sin(phi)) * uR * 0.95 + rl * uR * 0.5;
  vec3 w = aPos.xyz + p + vec3(0.0, 0.0, lift + dh);
  vW = w; vC = aColor; vL = l; vCenter = aPos.xy; vFace = f.z;
  vB = mat3(bx, by, f); vShape = aShape;
  vLift = clamp(lift / (uR * 0.4), 0.0, 1.0);
  gl_Position = vec4(w.x / uRes.x * 2.0 - 1.0, 1.0 - w.y / uRes.y * 2.0, -w.z * uZ, 1.0);
}`;

const ENV = `
uniform float uTime;
// The room is dark. A dim warm ceiling, and a handful of small, very hot
// softboxes scattered around the sky at different bearings, so whichever
// way a sequin turns, its reflection crosses one of them on the way over.
float rectLight(vec3 d, vec3 c, vec2 hs, float soft){
  float a = dot(d, c);
  if (a <= 0.0) return 0.0;
  vec3 t1 = normalize(cross(c, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(t1, c);
  vec2 q = vec2(dot(d, t1), dot(d, t2)) / a;
  vec2 e = smoothstep(hs + soft, hs - soft, abs(q));
  return e.x * e.y;
}
// A box at bearing az (0 = screen right, 90 = screen down) and el radians off the zenith.
vec3 boxDir(float az, float el){ float a = radians(az); return vec3(cos(a) * sin(el), sin(a) * sin(el), cos(el)); }
// A panel low in the room, given by bearing and angle off the zenith.
float panel(vec3 d, float az, float el, vec2 hs, float soft){
  float e = acos(clamp(d.z, -1.0, 1.0));
  float da = abs(mod(atan(d.y, d.x) - radians(az) + 3.14159265, 6.2831853) - 3.14159265) * sin(e);
  return smoothstep(hs.x + soft, hs.x - soft, da) * smoothstep(hs.y + soft, hs.y - soft, abs(e - el));
}
// The softboxes a settled mirror sees: a few big, sharp-edged panels hung
// high over the table. A disc at rest reflects one only if its lean points
// its mirror straight at it, and a disc's lean is mostly the drape's slope
// under it, which it shares with its neighbours. So whole flanks of a fold
// catch a panel together and blaze in its colour, the flank beyond falls to
// dark metal, and the band's edge is ragged where each disc's own wobble
// tips it in or out. Each panel is hotter at its centre than at its rim,
// so how bright a disc burns says how squarely it leans into the box.
// widen > 1 is the same light as a matte surface sees it: blurred and dull.
float sbox(vec3 d, vec2 c, vec2 hs, float rot, float soft, float widen){
  if (d.z <= 0.05) return 0.0;
  vec2 q = d.xy / d.z - c;
  float cr = cos(rot), sr = sin(rot);
  q = vec2(cr * q.x + sr * q.y, -sr * q.x + cr * q.y);
  vec2 hw = hs * widen;
  float sf = soft * widen * widen;
  vec2 e = smoothstep(hw + sf, hw - sf, abs(q));
  vec2 n = q / hw;
  return e.x * e.y * (1.0 - 0.45 * clamp(dot(n, n), 0.0, 1.0));
}
vec3 panels(vec3 d, float widen){
  // Projected positions: x is screen right, y screen down, both as tan of
  // the angle off the zenith. A flat swatch's discs see roughly
  // x in [-0.22, 0.22], y in [-0.3, 0.14]; the drape swings that by 0.35.
  return vec3(1.0, 0.95, 0.88) * 1.0 * sbox(d, vec2(-0.14, -0.24), vec2(0.24, 0.1), 0.35, 0.006, widen)
       + vec3(1.0, 0.97, 0.93) * 0.9 * sbox(d, vec2(0.21, -0.02), vec2(0.07, 0.28), -0.25, 0.005, widen)
       + vec3(0.9, 0.95, 1.0) * 0.8 * sbox(d, vec2(-0.1, 0.16), vec2(0.26, 0.065), -0.2, 0.005, widen)
       + vec3(1.0, 0.96, 0.9) * 0.75 * sbox(d, vec2(-0.38, -0.02), vec2(0.06, 0.22), 0.15, 0.005, widen);
}
vec3 sky(vec3 d){
  float up = d.z;
  return vec3(0.93, 0.9, 0.85) * (0.022 + 0.07 * smoothstep(0.35, 1.0, up) * smoothstep(1.0, 0.9, up));
}
vec3 boxes(vec3 d){
  float dr = sin(uTime * 0.21) * 0.02;
  vec3 c = vec3(0.0);
  // Low enough in the sky that a turning mirror sweeps through one while it
  // is still visibly mid-turn, not only as it lands.
  c += vec3(1.0, 0.95, 0.88) * 24.0 * rectLight(d, boxDir(225.0 + dr * 40.0, 0.62), vec2(0.13, 0.09), 0.012);
  c += vec3(1.0, 0.97, 0.92) * 26.0 * rectLight(d, boxDir(180.0 + dr * 30.0, 0.7), vec2(0.09, 0.08), 0.01);
  c += vec3(1.0, 0.96, 0.9) * 24.0 * rectLight(d, boxDir(270.0, 0.66), vec2(0.1, 0.07), 0.01);
  c += vec3(0.86, 0.92, 1.0) * 16.0 * rectLight(d, boxDir(2.0, 0.75), vec2(0.035, 0.32), 0.008);
  c += vec3(1.0, 0.94, 0.86) * 20.0 * rectLight(d, boxDir(110.0, 0.45), vec2(0.06, 0.06), 0.008);
  // A ring of panels low around the room. A sequin at rest never leans far
  // enough to see them; one that is turning over sweeps its reflection
  // down through them on the way and fires.
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float az = fi * 45.0 + 12.0 * sin(fi * 2.3);
    c += mix(vec3(1.0, 0.95, 0.88), vec3(0.9, 0.95, 1.0), mod(fi, 2.0)) * 22.0 * panel(d, az, 1.36 + 0.04 * sin(fi * 1.7), vec2(0.26, 0.13), 0.012);
  }
  return c;
}
`;

// The softboxes as a mirror sees them, against the reflectance that clips to
// white: a disc whose tint is brighter than WHITE_F0 blows out, anything
// darker keeps its colour however hot the light. A glint mostly lives on the
// curled rim, which with the boxes' soft edges and the shingle shadow sees
// about 15 of a box's 24, so the knee is set for that.
const LIGHT = 0.3;
const WHITE_F0 = 0.6;
const KNEE = (15 * LIGHT * WHITE_F0).toFixed(3);

// Tone curve on brightness alone, so a hot cyan glint stays cyan instead of
// washing out channel by channel. Only light past the knee, which only the
// palest discs reach, runs to white.
const TONE = `
float aces1(float x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 aces3(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 tone(vec3 x){
  float L = max(dot(x, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  float T = aces1(L);
  vec3 h = x * (T / L);
  float m = max(h.r, max(h.g, h.b));
  h = min(h, vec3(1.0)) + (1.0 - min(h, vec3(1.0))) * clamp((m - 1.0) * 0.6, 0.0, 1.0);
  // A little of the per-channel curve back, so a mid green glints as green
  // metal rather than a lit sign.
  h = mix(h, aces3(x), 0.3);
  // Past the knee the flare runs to white, keeping a breath of its tint.
  return mix(h, vec3(max(T, m)), 0.88 * smoothstep(${KNEE} * 0.8, ${KNEE} * 1.15, L));
}
`;

const FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vC; in vec2 vL; in vec2 vCenter; in float vFace; in float vLift;
flat in mat3 vB; flat in vec2 vShape;
uniform vec3 uEye; uniform float uR; uniform float uCup; uniform vec2 uNb0; uniform vec2 uNb1; uniform float uExposure; uniform float uHdr; uniform float uSheen;
out vec4 o;
${ENV}
${TONE}
void main(){
  bool front = vFace > 0.0;
  float vRho = length(vL);
  float cs = cos(vShape.x), sn = sin(vShape.x);
  vec2 lr = vec2(cs * vL.x + sn * vL.y, -sn * vL.x + cs * vL.y);
  float q = (1.0 + vShape.y) * lr.x * lr.x + (1.0 - vShape.y) * lr.y * lr.y;
  vec2 g = 4.0 * uCup * q * vec2(1.0 + vShape.y, 1.0 - vShape.y) * lr;
  vec3 nl = normalize(vec3(-(cs * g.x - sn * g.y), -(sn * g.x + cs * g.y), 1.0));
  vec3 vN = vB * nl;
  vec3 N = normalize(front ? vN : -vN);
  vec3 V = normalize(uEye - vW);
  vec3 R = reflect(-V, N);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - NoV, 5.0);
  vec3 key = normalize(vec3(-0.5, -0.55, 0.67));
  vec3 col;
  if (front) {
    // Matte charcoal, near black and the same everywhere: it knows nothing
    // of the cover. Diffuse from the raking key, which leans a little on the
    // folds, and the softboxes as a dull satin smear, so a fold still shows
    // as a soft change in the black and never as a picture.
    vec3 alb = vec3(0.016, 0.0155, 0.015);
    float kd = max(dot(N, key), 0.0);
    float irr = 0.25 + 0.25 * N.z + 1.2 * kd * kd;
    float sheen = pow(max(dot(R, key), 0.0), 5.0) * 0.3;
    col = alb * irr + vec3(0.95, 0.93, 0.9) * sheen * (0.2 + 0.8 * fr) * 0.012
        + panels(R, 2.6) * 0.006 + boxes(R) * 0.0004;
  } else {
    // Coloured metal, and a mirror: no diffuse at all. F0 is the disc's
    // foil, and everything it reflects comes back multiplied by it. Most of
    // what a settled disc sees is the dark room, so most of the swatch is
    // dark tinted metal; where its lean points it into a softbox it throws
    // back a sharp, hot, foil-coloured image of the box. Only at true
    // grazing does Schlick lift it toward white.
    vec3 F = vC + (1.0 - vC) * fr;
    col = (sky(R) * 1.6 + panels(R, 1.0) * uSheen + boxes(R) * ${LIGHT}) * F;
  }
  // The pressed rim and the punched hole catch a little less light.
  col *= mix(1.0, 0.72, smoothstep(0.84, 1.0, vRho));
  col *= mix(0.55, 1.0, smoothstep(0.16, 0.26, vRho));
  // Contact shadow from the two sequins lying over this one's top.
  float d0 = length(vW.xy - (vCenter + uNb0) - vec2(0.5, 1.2)) - uR;
  float d1 = length(vW.xy - (vCenter + uNb1) - vec2(0.5, 1.2)) - uR;
  float sh = smoothstep(0.0, uR * 0.55, min(d0, d1));
  col *= mix(1.0, mix(0.55, 1.0, sh), 1.0 - vLift);
  if (uHdr > 0.5) { o = vec4(col, 1.0); return; }
  vec3 m = tone(col * uExposure);
  o = vec4(pow(m, vec3(1.0 / 2.2)), 1.0);
}`;

const BG_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.999, 1.0); }`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes; uniform vec4 uRect; uniform float uDpr; uniform float uHdr;
out vec4 o;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 c = (uRect.xy + uRect.zw) * 0.5;
  vec2 b = (uRect.zw - uRect.xy) * 0.5;
  vec3 ground = vec3(0.949, 0.941, 0.922);
  // Grain in the ground so it reads as paper, not a fill.
  ground += (hash(floor(p * uDpr)) - 0.5) * 0.006;
  float dSh = sdBox(p - c - vec2(0.0, 5.0), b, 3.0);
  float shadow = 0.07 * (1.0 - smoothstep(-14.0, 26.0, dSh)) + 0.08 * (1.0 - smoothstep(-1.0, 3.0, sdBox(p - c - vec2(0.0, 1.0), b, 2.0)));
  vec3 col = ground * (1.0 - shadow);
  float d = sdBox(p - c, b, 2.0);
  // The backing: a dark net, visible at the edge and through the holes.
  vec2 q = p * 1.6;
  float weave = 0.5 + 0.25 * sin(q.x) * sin(q.y + 1.0);
  vec3 fabric = vec3(0.16, 0.155, 0.15) * (0.75 + 0.5 * weave);
  col = mix(col, fabric, 1.0 - smoothstep(-0.5, 0.5, d));
  // In the HDR pass the ground is stored linear and marked (alpha 0) to skip the tone curve.
  o = uHdr > 0.5 ? vec4(pow(col, vec3(2.2)), 0.0) : vec4(col, 1.0);
}`;

// Post: the scene is drawn into a float target, the hottest light is pulled
// out, blurred at three scales and laid back over the tone-mapped frame.
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uExposure; uniform float uThresh;
out vec4 o;
// Keyed on luminance, at the white knee: only discs pale enough to blow out bloom.
vec3 tap(vec2 uv){ vec4 s = texture(uTex, uv); vec3 c = s.rgb * s.a * uExposure; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return c * max(l - uThresh, 0.0) / (l + 1e-4); }
void main(){
  vec2 h = uTexel * 0.5;
  o = vec4((tap(vUv + vec2(-h.x, -h.y)) + tap(vUv + vec2(h.x, -h.y)) + tap(vUv + vec2(-h.x, h.y)) + tap(vUv + vec2(h.x, h.y))) * 0.25, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel;
out vec4 o;
void main(){
  vec2 h = uTexel * 0.5;
  o = (texture(uTex, vUv + vec2(-h.x, -h.y)) + texture(uTex, vUv + vec2(h.x, -h.y)) + texture(uTex, vUv + vec2(-h.x, h.y)) + texture(uTex, vUv + vec2(h.x, h.y))) * 0.25;
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;
out vec4 o;
void main(){
  vec4 c = texture(uTex, vUv) * 0.227027;
  c += (texture(uTex, vUv + uDir * 1.3846154) + texture(uTex, vUv - uDir * 1.3846154)) * 0.3162162;
  c += (texture(uTex, vUv + uDir * 3.2307692) + texture(uTex, vUv - uDir * 3.2307692)) * 0.0702703;
  o = c;
}`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene; uniform sampler2D uB0; uniform sampler2D uB1; uniform sampler2D uB2;
uniform float uExposure; uniform float uBloom;
out vec4 o;
${TONE}
void main(){
  vec4 s = texture(uScene, vUv);
  vec3 lin = mix(s.rgb, tone(s.rgb * uExposure), s.a);
  vec3 b = texture(uB0, vUv).rgb * 0.55 + texture(uB1, vUv).rgb * 0.35 + texture(uB2, vUv).rgb * 0.3;
  b *= uBloom;
  lin += b / (1.0 + 0.35 * b);
  o = vec4(pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
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
const uniforms = (gl, p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A cupped annulus: rings from the hole to the rim.
function discMesh(seg = 24, rings = [0.17, 0.45, 0.75, 1]) {
  const v = [];
  const pt = (r, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(rings[k], i), b = pt(rings[k], i + 1), c = pt(rings[k + 1], i), d = pt(rings[k + 1], i + 1);
      v.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  return new Float32Array(v);
}

const PI = Math.PI;
// Brush right or down to show the mirrors; left or up to wipe them.
const NAP = [0.86, 0.51];

// The swatch doesn't lie flat. It is a scrap of cloth dropped on the table:
// a long soft fold across it, a smaller one in the lower corner, a bulge
// where it rucked up, a shallow trough, and the whole thing sagging toward
// the bottom left where it hangs a little off the edge. Height as a fraction
// of the swatch's width at (u, v), its fractions across and down.
const gauss = (x, w) => Math.exp((-x * x) / (2 * w * w));
const ridge = (u, v, cx, cy, ang, w, len, bow) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const t = (u - cx) * c + (v - cy) * s;
  const n = -(u - cx) * s + (v - cy) * c + bow * t * t;
  return gauss(n, w) * gauss(t, len);
};
function drape(u, v) {
  let h = 0;
  h += 0.022 * ridge(u, v, 0.42, 0.44, 0.62, 0.075, 0.45, 0.9);
  h += 0.018 * ridge(u, v, 0.72, 0.76, -1.05, 0.065, 0.24, -1.2);
  h += 0.018 * gauss(Math.hypot(u - 0.8, v - 0.18), 0.09);
  h -= 0.01 * ridge(u, v, 0.2, 0.78, 0.3, 0.08, 0.3, 0);
  const sx = 1 - u, sy = v;
  h -= 0.03 * (sx * sy) * (sx * sy);
  // Deep enough that a fold's two flanks lean well apart: a mirror doubles
  // its lean, so a flank turns a softbox's whole reflection on or off.
  return h * 1.3;
}

// The hand's dent: a coarse grid of heights over the swatch, each a damped
// spring pulled down under the fingertip and let go behind it.
const DENT_N = 64;
const DENT_K = 240, DENT_C = 11;

export async function createSequin(host, { embedded = false } = {}) {
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const params = new URLSearchParams(location.search);
  const albumId = albumById(params.get("album") || "") ? params.get("album") : "abbey-road";
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  // Cover pixels, sampled once per sequin.
  let coverPx = null;
  const COVER_N = 256;
  try {
    const img = await loadCover(albumId);
    const cv = document.createElement("canvas");
    cv.width = cv.height = COVER_N;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, COVER_N, COVER_N);
    coverPx = cx.getImageData(0, 0, COVER_N, COVER_N).data;
  } catch {
    coverPx = null;
  }
  const lin = (c) => Math.pow(c / 255, 2.2);
  // The cover as each sequin's patch of it would ask: its mean linear colour.
  // It is never the disc's colour, only what the foil dither aims at.
  const sampleCover = (u, v, rad) => {
    if (!coverPx) return [0.6, 0.6, 0.62];
    let r = 0, g = 0, b = 0, n = 0;
    const R = Math.max(1, Math.round(rad * COVER_N));
    const cx = Math.round(u * (COVER_N - 1)), cy = Math.round(v * (COVER_N - 1));
    for (let j = -R; j <= R; j += Math.max(1, R >> 1)) {
      for (let i = -R; i <= R; i += Math.max(1, R >> 1)) {
        if (i * i + j * j > R * R) continue;
        const x = clamp(cx + i, 0, COVER_N - 1), y = clamp(cy + j, 0, COVER_N - 1);
        const o = (y * COVER_N + x) * 4;
        r += lin(coverPx[o]); g += lin(coverPx[o + 1]); b += lin(coverPx[o + 2]); n++;
      }
    }
    return [r / n, g / n, b / n];
  };

  const prog = program(gl, VS, FS);
  const U = uniforms(gl, prog, ["uRes", "uR", "uCup", "uZ", "uRip", "uEye", "uNb0", "uNb1", "uExposure", "uTime", "uHdr", "uDent", "uRect", "uDentCell", "uSheen"]);

  const dentH = new Float32Array(DENT_N * DENT_N);
  const dentV = new Float32Array(DENT_N * DENT_N);
  const dentTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dentTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, DENT_N, DENT_N, 0, gl.RED, gl.FLOAT, dentH);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  let dentLive = false, dentDirty = true;
  const bgProg = program(gl, BG_VS, BG_FS);
  const UB = uniforms(gl, bgProg, ["uRes", "uRect", "uDpr", "uHdr"]);

  const mesh = discMesh();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const meshBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const staticBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
  const STRIDE = 11 * 4;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 24);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 2, gl.FLOAT, false, STRIDE, 36);
  gl.vertexAttribDivisor(5, 1);
  const flipBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const bgVao = gl.createVertexArray();
  gl.bindVertexArray(bgVao);
  const full = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Bloom needs a float target; without one the scene draws straight to the canvas.
  const hdr = !!gl.getExtension("EXT_color_buffer_float");
  let post = null;
  if (hdr) {
    const mk = (fs, names) => {
      const p = program(gl, QUAD_VS, fs);
      return { p, u: uniforms(gl, p, names) };
    };
    post = {
      bright: mk(BRIGHT_FS, ["uTex", "uTexel", "uExposure", "uThresh"]),
      down: mk(DOWN_FS, ["uTex", "uTexel"]),
      blur: mk(BLUR_FS, ["uTex", "uDir"]),
      comp: mk(COMP_FS, ["uScene", "uB0", "uB1", "uB2", "uExposure", "uBloom"]),
      w: 0, h: 0, res: [],
    };
  }
  const tex = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  };
  const freePost = () => {
    for (const r of post.res) {
      if (r.t) gl.deleteTexture(r.t);
      if (r.f) gl.deleteFramebuffer(r.f);
      if (r.rb) gl.deleteRenderbuffer(r.rb);
    }
    post.res = [];
  };
  const sizePost = (w, h) => {
    if (post.w === w && post.h === h) return;
    freePost();
    post.w = w; post.h = h;
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    const ms = { f: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.f);
    const crb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, crb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, crb);
    const drb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, drb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, drb);
    post.ms = ms;
    post.scene = tex(w, h);
    post.levels = [];
    for (let k = 1; k <= 3; k++) {
      const lw = Math.max(1, w >> k), lh = Math.max(1, h >> k);
      post.levels.push([tex(lw, lh), tex(lw, lh)]);
    }
    post.res.push(ms, { rb: crb }, { rb: drb }, post.scene, ...post.levels.flat());
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const quad = (fbo, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const bind = (unit, t) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  };
  const runBloom = () => {
    const { bright, down, blur, comp, scene, levels } = post;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(bgVao);
    // Bright pass, at half size.
    let [a, b] = levels[0];
    gl.useProgram(bright.p);
    bind(0, scene.t);
    gl.uniform1i(bright.u.uTex, 0);
    gl.uniform2f(bright.u.uTexel, 1 / scene.w, 1 / scene.h);
    gl.uniform1f(bright.u.uExposure, EXPOSURE);
    gl.uniform1f(bright.u.uThresh, KNEE * 0.9);
    quad(a.f, a.w, a.h);
    for (let k = 0; k < levels.length; k++) {
      [a, b] = levels[k];
      if (k > 0) {
        const src = levels[k - 1][0];
        gl.useProgram(down.p);
        bind(0, src.t);
        gl.uniform1i(down.u.uTex, 0);
        gl.uniform2f(down.u.uTexel, 1 / src.w, 1 / src.h);
        quad(a.f, a.w, a.h);
      }
      gl.useProgram(blur.p);
      gl.uniform1i(blur.u.uTex, 0);
      bind(0, a.t);
      gl.uniform2f(blur.u.uDir, 1 / a.w, 0);
      quad(b.f, b.w, b.h);
      bind(0, b.t);
      gl.uniform2f(blur.u.uDir, 0, 1 / a.h);
      quad(a.f, a.w, a.h);
    }
    gl.useProgram(comp.p);
    bind(0, scene.t);
    bind(1, levels[0][0].t);
    bind(2, levels[1][0].t);
    bind(3, levels[2][0].t);
    gl.uniform1i(comp.u.uScene, 0);
    gl.uniform1i(comp.u.uB0, 1);
    gl.uniform1i(comp.u.uB1, 2);
    gl.uniform1i(comp.u.uB2, 3);
    gl.uniform1f(comp.u.uExposure, EXPOSURE);
    gl.uniform1f(comp.u.uBloom, 0.42);
    quad(null, scene.w, scene.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  };
  const EXPOSURE = 1.0;
  // The overhead panels as a settled mirror sees them, against the hot boxes:
  // bright enough that a band reads as the picture lit, dim enough that only
  // pale discs bloom in it.
  const SHEEN = 3.4;

  // Layout and per-sequin state.
  let N = 0;
  let D = 18; // diameter
  let SY = 10;
  let zScale = 1 / 400;
  let rect = [0, 0, 1, 1];
  let brushR = 30;
  let px, py, seed, phi, vel, target, rest, ax, ay, delay, flips;

  const build = (W, H) => {
    // A big swatch, most of the height of the room, sewn with about eighty
    // sequins across: fine enough that four figures on a crossing resolve,
    // coarse enough that each disc's flash is still something you can see.
    const side = Math.round(Math.min(W * 0.92, H * 0.8, 900));
    D = clamp(side / 80, 5, 12);
    SY = D * 0.56;
    const cols = Math.max(4, Math.floor(side / D));
    const rows = Math.max(4, Math.floor((side - D) / SY) + 1);
    const fw = cols * D, fh = (rows - 1) * SY + D;
    const x0 = Math.round((W - fw) / 2), y0 = Math.round((H - fh) / 2);
    const pad = D * 0.14;
    rect = [x0 - pad, y0 - pad, x0 + fw + pad, y0 + fh + pad];
    brushR = Math.max(D * 2.2, side * 0.065);
    dentH.fill(0); dentV.fill(0); dentLive = false; dentDirty = true;

    const list = [];
    const lattice = [];
    for (let r = 0; r < rows; r++) {
      const odd = r & 1;
      const n = odd ? cols - 1 : cols;
      const row = [];
      for (let c = 0; c < n; c++) {
        row.push(list.length);
        list.push([x0 + D / 2 + c * D + (odd ? D / 2 : 0), y0 + D / 2 + r * SY, r]);
      }
      lattice.push(row);
    }
    N = list.length;
    zScale = 1 / (rows * D * 0.32 + D * 6);
    // Which foil each sequin is: error diffusion over the lattice, aiming at
    // the cover. The picture lives in which foils sit next to which.
    const foil = ditherFoils(lattice, list.length, (i) =>
      sampleCover((list[i][0] - x0) / fw, (list[i][1] - y0) / fh, (D * 0.45) / fw),
    );
    const rand = rng(7);
    const data = new Float32Array(N * 11);
    px = new Float32Array(N); py = new Float32Array(N); seed = new Float32Array(N);
    phi = new Float32Array(N); vel = new Float32Array(N); target = new Float32Array(N); rest = new Float32Array(N);
    ax = new Float32Array(N); ay = new Float32Array(N); delay = new Float32Array(N);
    flips = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const [x, y, r] = list[i];
      const s = rand();
      px[i] = x; py[i] = y; seed[i] = s;
      // Shingled: higher rows lie over lower ones, and lean down onto them.
      // Rows step up by enough that a tilted disc never cuts the one over it.
      const z = (rows - r) * D * 0.32;
      // Each lies on the cloth, so its lean is the drape's: the heightfield's
      // slope at its centre, which it shares with its neighbours. On top of
      // that, only a small wobble of its own on the thread, more along it
      // than across, and a hair of lean down onto the row below.
      const u = (x - x0) / fw, v = (y - y0) / fh, e = 0.004;
      const gx = (drape(u + e, v) - drape(u - e, v)) / (2 * e);
      const gy = ((drape(u, v + e) - drape(u, v - e)) / (2 * e)) * (fw / fh);
      const a = rand() * PI * 2;
      const m = 0.035 * (0.25 + 0.75 * rand());
      const across = 0.6 + 0.4 * rand();
      const tx = -gx + Math.cos(a) * m * across, ty = -gy + Math.sin(a) * m + 0.03;
      const zz = z + drape(u, v) * fw;
      // One foil, and no two sequins off the reel quite alike.
      const f0 = FOILS[foil[i]].f0, jit = 0.94 + 0.12 * ((s * 97.31) % 1);
      const cr = Math.min(1, f0[0] * jit), cg = Math.min(1, f0[1] * jit), cb = Math.min(1, f0[2] * jit);
      data.set([x, y, zz, s, tx, ty, cr, cg, cb, rand() * PI, (rand() * 2 - 1) * 0.4], i * 11);
      ax[i] = 1; ay[i] = 0;
      flips[i * 3 + 1] = 1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
    gl.bufferData(gl.ARRAY_BUFFER, flips, gl.DYNAMIC_DRAW);
    dirty = true;
    if (still != null) runScript(still);
  };

  let dirty = true;
  let active = new Set();

  // A stroke from (x0,y0) to (x1,y1) over the sequins it passes.
  const brush = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const mx = dx / len, my = dy / len;
    const want = mx * NAP[0] + my * NAP[1] > 0 ? 1 : 0;
    const R = brushR;
    const minX = Math.min(x0, x1) - R, maxX = Math.max(x0, x1) + R;
    const minY = Math.min(y0, y1) - R, maxY = Math.max(y0, y1) + R;
    for (let i = 0; i < N; i++) {
      const x = px[i], y = py[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const t = clamp(((x - x0) * dx + (y - y0) * dy) / (len * len), 0, 1);
      const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
      // The brush's edge is ragged, the way fingertips are.
      if (d > R * (0.72 + 0.28 * seed[i])) continue;
      const face = Math.round(target[i] / PI) & 1;
      if (face === want) {
        // Already showing that side: it only rustles.
        if (Math.abs(vel[i]) < 2 && Math.abs(phi[i] - target[i]) < 0.05) {
          ax[i] = -my; ay[i] = mx;
          vel[i] += 2.2 * (0.5 + seed[i]);
          active.add(i);
        }
        continue;
      }
      const moving = Math.abs(phi[i] - rest[i]) > 0.02;
      if (moving && Math.abs(target[i] - rest[i]) > 1) {
        // Caught mid-turn by a stroke the other way: it falls back.
        target[i] = rest[i];
      } else {
        // Turns over toward the stroke: its normal tips the way the brush goes.
        ax[i] = -my; ay[i] = mx;
        target[i] = rest[i] + PI;
        delay[i] = seed[i] * 0.03;
        vel[i] += 3;
      }
      active.add(i);
    }
  };

  // Press the cloth at (hx, hy) by `press` (0 lets it go) and let the
  // springs run for dt. The dent spreads about one and a half brush radii.
  const stepDent = (dt, hx, hy, press, R = brushR) => {
    if (!press && !dentLive) return;
    const [l, t, r, b] = rect;
    const cw = (r - l) / DENT_N, ch = (b - t) / DENT_N;
    const sig = R * 0.75;
    const depth = sig * 0.5 * press;
    const reach = sig * 3.2;
    let live = false, moved = 0;
    for (let j = 0; j < DENT_N; j++) {
      const y = t + (j + 0.5) * ch;
      const dy = y - hy;
      for (let i = 0; i < DENT_N; i++) {
        const k = j * DENT_N + i;
        let tgt = 0;
        if (press) {
          const dx = l + (i + 0.5) * cw - hx;
          if (Math.abs(dx) < reach && Math.abs(dy) < reach) tgt = -depth * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
        }
        const hk = dentH[k];
        if (!tgt && hk === 0 && dentV[k] === 0) continue;
        dentV[k] += (DENT_K * (tgt - hk) - DENT_C * dentV[k]) * dt;
        dentH[k] = hk + dentV[k] * dt;
        moved = Math.max(moved, Math.abs(dentV[k] * dt));
        if (Math.abs(dentH[k]) < 0.01 && Math.abs(dentV[k]) < 0.05 && !tgt) { dentH[k] = 0; dentV[k] = 0; }
        else live = true;
      }
    }
    dentLive = live;
    // A fingertip resting still leaves nothing to redraw once the cloth settles.
    if (moved > 1e-3 || !live) dentDirty = true;
  };

  const K = 420, C = 24;
  const step = (dt) => {
    if (!active.size) return;
    for (const i of active) {
      if (delay[i] > 0) {
        delay[i] -= dt;
        continue;
      }
      const tg = target[i];
      const before = phi[i] - tg;
      vel[i] += (-K * before - C * vel[i]) * dt;
      phi[i] += vel[i] * dt;
      const after = phi[i] - tg;
      // It lands on the fabric rather than swinging through it.
      if (before * after < 0 && Math.abs(vel[i]) > 1.5) {
        phi[i] = tg - after * 0.2;
        vel[i] = -vel[i] * 0.22;
      }
      if (Math.abs(phi[i] - tg) < 0.002 && Math.abs(vel[i]) < 0.05) {
        let r = tg % (PI * 2);
        if (r < 0) r += PI * 2;
        phi[i] = r; target[i] = r; rest[i] = r; vel[i] = 0;
        active.delete(i);
      }
      flips[i * 3] = phi[i];
      flips[i * 3 + 1] = ax[i];
      flips[i * 3 + 2] = ay[i];
    }
    dirty = true;
  };

  // A still for ?t=: four strokes left to right, the last one stopped where t says.
  function runScript(t) {
    const [l, top, r, bot] = rect;
    const passes = 4;
    const h = bot - top;
    const segs = [];
    for (let k = 0; k < passes; k++) {
      const y = top + h * ((k + 0.5) / passes);
      segs.push([l - 30, y - 6, r + 30, y + 10]);
    }
    const saved = brushR;
    brushR = (h / passes) * 0.62;
    const total = segs.reduce((s, g) => s + Math.hypot(g[2] - g[0], g[3] - g[1]), 0);
    let left = total * t;
    const speed = 1100;
    const dt = 1 / 240;
    for (const g of segs) {
      const L = Math.hypot(g[2] - g[0], g[3] - g[1]);
      const go = Math.min(L, left);
      let s = 0;
      while (s < go) {
        const s1 = Math.min(go, s + speed * dt);
        const a = s / L, b = s1 / L;
        const hx = g[0] + (g[2] - g[0]) * b, hy = g[1] + (g[3] - g[1]) * b;
        brush(g[0] + (g[2] - g[0]) * a, g[1] + (g[3] - g[1]) * a, hx, hy);
        step(dt);
        stepDent(dt, hx, hy, 1, saved);
        s = s1;
      }
      left -= go;
      if (left <= 0) break;
      // Lift the hand and let everything settle before the next stroke.
      for (let k = 0; k < 120; k++) {
        step(dt);
        stepDent(dt, 0, 0, 0, saved);
      }
    }
    brushR = saved;
    frozen = true;
  }
  let frozen = false;

  stage.onResize((w, h) => build(w, h));

  // Taps send a ripple.
  const ripples = [];
  let downAt = null;
  stage.on("down", (p) => (downAt = { x: p.x, y: p.y, t: performance.now() }));
  stage.on("up", (p) => {
    if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 6 && performance.now() - downAt.t < 400) {
      ripples.push({ x: p.x, y: p.y, age: 0 });
      if (ripples.length > 4) ripples.shift();
    }
    downAt = null;
  });

  let last = null;
  let stillFrames = 0, stillW = 0, stillH = 0, lastDraw = -1;
  const ripData = new Float32Array(16);
  stage.onFrame((dt, time) => {
    const W = stage.width, H = stage.height;
    const p = stage.pointer;
    if (!frozen) {
      if (p.inside || p.down) {
        if (last) {
          const sp = Math.hypot(p.x - last[0], p.y - last[1]) / Math.max(dt, 1e-3);
          if (sp > 90) brush(last[0], last[1], p.x, p.y);
        }
        last = [p.x, p.y];
      } else last = null;
      const sub = 3;
      // Hovering rests a fingertip on the cloth; dragging leans on it.
      const press = p.down ? 1 : p.inside ? 0.7 : 0;
      for (let k = 0; k < sub; k++) {
        step(dt / sub);
        stepDent(dt / sub, p.x, p.y, press);
      }
      for (const r of ripples) r.age += dt;
      while (ripples.length && ripples[0].age > 3) ripples.shift();
    }
    // A frozen still has nothing left to move: draw it twice and let it be.
    if (frozen) {
      if (stillFrames > 1 && W === stillW && H === stillH) return;
      if (W !== stillW || H !== stillH) stillFrames = 0;
      stillW = W; stillH = H; stillFrames++;
    }
    // At rest only the room's slow drift moves; ten frames a second is plenty
    // for that, and spares the bloom chain the other fifty.
    const idle = !frozen && !dirty && !dentDirty && !active.size && !ripples.length;
    if (idle && time - lastDraw < 0.1 && W === stillW && H === stillH) return;
    lastDraw = time;
    if (!frozen) { stillW = W; stillH = H; }
    ripData.fill(0);
    ripples.forEach((r, i) => ripData.set([r.x, r.y, r.age, 1], i * 4));

    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flips);
      dirty = false;
    }
    if (dentDirty) {
      gl.bindTexture(gl.TEXTURE_2D, dentTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DENT_N, DENT_N, gl.RED, gl.FLOAT, dentH);
      gl.bindTexture(gl.TEXTURE_2D, null);
      dentDirty = false;
    }

    const cw = stage.canvas.width, ch = stage.canvas.height;
    if (post) {
      sizePost(cw, ch);
      gl.bindFramebuffer(gl.FRAMEBUFFER, post.ms.f);
    }
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.949, 0.941, 0.922, post ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(bgProg);
    gl.bindVertexArray(bgVao);
    gl.uniform2f(UB.uRes, W, H);
    gl.uniform4f(UB.uRect, ...rect);
    gl.uniform1f(UB.uDpr, stage.dpr);
    gl.uniform1f(UB.uHdr, post ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uR, D / 2);
    gl.uniform1f(U.uCup, 0.02);
    gl.uniform1f(U.uZ, zScale);
    gl.uniform1f(U.uHdr, post ? 1 : 0);
    gl.uniform4fv(U.uRip, ripData);
    gl.uniform3f(U.uEye, W / 2, H / 2 + H * 0.15, 1500);
    gl.uniform2f(U.uNb0, -D / 2, -SY);
    gl.uniform2f(U.uNb1, D / 2, -SY);
    gl.uniform1f(U.uExposure, EXPOSURE);
    gl.uniform1f(U.uTime, frozen ? 0 : time);
    gl.uniform1f(U.uSheen, SHEEN);
    gl.uniform4f(U.uRect, ...rect);
    gl.uniform2f(U.uDentCell, (rect[2] - rect[0]) / DENT_N, (rect[3] - rect[1]) / DENT_N);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dentTex);
    gl.uniform1i(U.uDent, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.length / 2, N);
    gl.bindVertexArray(null);

    if (post) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.ms.f);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.scene.f);
      gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      runBloom();
    }
    void embedded;
  });

  return {
    destroy: () => {
      if (post) freePost();
      gl.deleteTexture(dentTex);
      stage.destroy();
    },
  };
}
