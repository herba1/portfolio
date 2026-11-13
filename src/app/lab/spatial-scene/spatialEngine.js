import { createStage, clamp } from "../_kit/stage";

// A worm's-eye photo of a wooden pole under summer cumulus, as a spatial
// scene you can look up through. bake.py split it offline into layers: the
// sky, inpainted behind the pole and wires, at infinity (the photo's own
// canvas, and round it a dome of the whole sky the photo never framed); and
// the pole with its wires and insulators, a mesh displaced by its own depth.
// The wires carry on past the photo's sides as lines in 3D, drawn
// analytically, so a wide view never sees them stop.
//
// Everything is drawn full-bleed through one camera. At rest it frames the
// photo edge to edge. Looking sideways turns it round the pole, so the wires
// and the cloud behind them slide apart. Looking up is the drastic move: the
// camera crouches in to the foot of the pole as it pitches up to about 73
// degrees, and the lens opens from the photo's rectilinear crop to a
// stereographic 116 degrees, r = 1/s tan(s theta) with s from 1 to 1/2. The
// pole's foot then flares off the bottom edge, its shaft converges on the
// zenith, and the frame fills with deep cobalt the photo never showed.

const BASE = "/lab/spatial-scene/";
const YAW = 6; // degrees at |x| = 1, an orbit round the pole
const PITCH_DOWN = 8; // degrees at y = -1, an orbit about the pole's foot
// Looking up, at y = 1: the pitch past the photo's own (pitch0, 55 degrees),
// the vertical field of view, and where the camera ends up, crouched in front
// of the anchor (along the ground towards where the photo was taken, and up
// the pole), in the scene's units (the anchor is ~1.2 from the photo's camera).
const PITCH_UP = 18;
const FOV_UP = 116;
const CROUCH = [0.15, 0];
const GRID_X = 160;
// The film finish: diffusion added back, halation strength (linear), grain
// amplitude (sRGB units, at mid grey).
const MIST = 0.09;
const HALATION = 0.3;
const GRAIN = 0.045;
const GRID_Y = 240;
// The near layer fades out over its outer 2 % at the sides, where the
// analytic wires take over.
const EDGE = 0.02;

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const LENS = `
uniform float uF; uniform float uS; uniform vec2 uHalf; uniform mat3 uM;
const float ASPECT = 0.75;
vec3 unproject(vec2 X){
  float r = length(X);
  float th = atan(r * uS) / uS;
  return r > 1e-6 ? vec3(X / r * sin(th), cos(th)) : vec3(0.0, 0.0, 1.0);
}
// The layers are drawn in linear light into a half-float target, so the film
// pass can scatter light the way glass and emulsion do. (Where half float
// can't be rendered to, an 8-bit target holds sqrt(linear) instead.)
uniform float uPack;
vec3 toLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 store(vec3 c){ return uPack > 0.5 ? sqrt(c) : c; }`;

const NEAR_VS = `#version 300 es
layout(location=0) in vec2 aUv;
uniform sampler2D uDepth; uniform vec3 uC;
${LENS}
out vec2 vUv;
out float vOk;
void main(){
  float d = texture(uDepth, aUv).r;
  // Inverse depth to distance along z, in the units the anchor uses.
  float z = 1.0 / max(d, 0.08);
  vec3 P = vec3((aUv.x - 0.5) * ASPECT, 0.5 - aUv.y, uF) * (z / uF);
  vec3 q = transpose(uM) * (P - uC); // into the camera
  float l = length(q.xy);
  float th = uS * atan(l, q.z);
  // past the lens's reach (behind the camera, at s = 1) the vertex is dropped
  vOk = th < 1.45 ? 1.0 : 0.0;
  vec2 X = l > 1e-6 ? q.xy / l * tan(min(th, 1.45)) / uS : vec2(0.0);
  gl_Position = vec4(X / uHalf, 0.0, 1.0);
  vUv = aUv;
}`;

const NEAR_FS = `#version 300 es
precision highp float;
in vec2 vUv; in float vOk; uniform sampler2D uCol;
${LENS}
out vec4 o;
void main(){
  if (vOk < 0.999) discard;
  float edge = smoothstep(0.0, ${EDGE}, vUv.x) * smoothstep(1.0, 1.0 - ${EDGE}, vUv.x);
  vec4 c = texture(uCol, vUv) * edge; // premultiplied on upload
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  o = vec4(store(toLinear(rgb)) * c.a, c.a);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(mix(uRect.xy, uRect.zw, aPos), 0.0, 1.0); }`;

// The sky at infinity: rotation only, looked up per pixel through the lens,
// in the photo's canvas where it reaches and in the dome everywhere else (the
// bake paints the canvas's outer reaches from the dome, so the two agree
// where they cross). Then the wires past the photo's sides, analytically:
// each is a half-line from the frame's edge outwards, seen from the camera as
// a great circle; a pixel's coverage is its angular distance from that circle
// against the wire's angular half-width there (its radius over its distance),
// antialiased over one pixel and faded with it once thinner than a pixel.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSky; uniform sampler2D uDome; uniform vec4 uCanvas;
uniform vec3 uEast; uniform vec3 uNorth; uniform vec3 uUp; uniform float uTz;
uniform vec3 uC; uniform vec4 uWp[6]; uniform vec4 uWd[6]; uniform vec3 uWire;
${LENS}
out vec4 o;
void main(){
  vec2 X = (vUv * 2.0 - 1.0) * uHalf;
  vec3 d = uM * unproject(X);
  // the dome: zenith-centred stereographic, north up
  vec2 hz = vec2(dot(d, uEast), dot(d, uNorth));
  float g = acos(clamp(dot(d, uUp), -1.0, 1.0));
  vec2 dir = hz / max(length(hz), 1e-6);
  vec3 c = texture(uDome, 0.5 + 0.5 * tan(min(g, 2.8) * 0.5) / uTz * vec2(dir.x, -dir.y)).rgb;
  // the canvas, on the photo's image plane, eased in from its edges
  vec2 p = uF * d.xy / max(d.z, 0.05);
  vec2 uv = vec2((p.x - uCanvas.x) / (uCanvas.z - uCanvas.x), (uCanvas.w - p.y) / (uCanvas.w - uCanvas.y));
  vec2 m = min(uv, 1.0 - uv);
  float w = smoothstep(0.0, 0.03, min(m.x, m.y)) * step(0.05, d.z);
  c = mix(c, texture(uSky, clamp(uv, 0.0, 1.0)).rgb, w);
  // Alpha carries the highlight mask (luma past ~0.75) for halation; the
  // near layer occludes it as it's drawn, and the mips blur it.
  float hl = smoothstep(0.68, 0.84, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  vec3 lin = toLinear(c);
  float cover = 0.0;
  for (int i = 0; i < 6; i++){
    vec3 D = uWd[i].xyz;
    vec3 r0 = uWp[i].xyz - uC;
    vec3 n0 = r0 - dot(r0, D) * D; // camera to the line, square to it
    float h = length(n0);
    n0 /= h;
    float rm = dot(d, n0);
    float sa = dot(d, cross(D, n0)); // sine of the offset from the wire
    float t = dot(r0 - d * (h / max(rm, 1e-4)), -D); // along the wire, out from the edge
    float hw = uWp[i].w * max(rm, 0.0) / h;
    float px = max(fwidth(sa), 1e-6);
    float a = clamp((max(hw, 0.5 * px) - abs(sa)) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / px);
    a *= step(0.0, rm) * smoothstep(-uWd[i].w, 0.0, t);
    cover = 1.0 - (1.0 - cover) * (1.0 - a);
  }
  lin = mix(lin, toLinear(uWire), cover);
  o = vec4(store(lin), hl * (1.0 - cover));
}`;

// The film finish: one shader, 1:1 with device pixels, run in two stages so
// that a still view costs only the grain. uStage 0 develops the linear frame
// (diffusion and halation, written out sRGB-encoded) whenever the camera
// moves; uStage 1 prints that (grade and grain) at 24 fps.
//  - Pro-Mist diffusion: a wide, low veil of the whole image (three mip
//    taps out to 1/16 res) added back, so cloud bleeds into the cobalt
//    and over the pole's edges.
//  - Halation: light from the highlights (luma > 0.75, carried in the
//    target's alpha) that went through the emulsion and came back off the
//    base through the red layer, a thin
//    warm ring on the dark side of bright edges only: a hairline round the
//    pole and wires where they cross cloud.
//  - The grade: blacks lifted a hair, shadows and sky midtones pulled to
//    cyan, highlights opened and rolled off from 0.9 towards a warm neutral
//    (#fff6ea) under paper white.
//  - Grain: monochrome, at 24 fps, 1.5-2 device px, strongest in midtones.
const FILM_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene; uniform vec2 uTexel; uniform float uPack; uniform float uFrame;
uniform float uMist; uniform float uHalation; uniform float uGrain; uniform float uStage;
out vec4 o;
vec3 fetch(vec2 uv, float lod){ vec3 c = textureLod(uScene, uv, lod).rgb; return uPack > 0.5 ? c * c : c; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toSrgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// Four rotated bilinear taps at one mip level: a soft, roughly Gaussian lobe
// rather than the mip's box.
vec3 lobe(vec2 uv, float lod){
  vec2 d = uTexel * exp2(lod);
  return 0.25 * (fetch(uv + d * vec2(0.9, 0.4), lod) + fetch(uv + d * vec2(-0.4, 0.9), lod)
               + fetch(uv + d * vec2(-0.9, -0.4), lod) + fetch(uv + d * vec2(0.4, -0.9), lod));
}
// n is the grain, added before the shoulder so the highlights hold it down
vec3 grade(vec3 c, float n){
  float l = luma(c);
  // what the phone held down at ~0.9 opens towards paper white, and its
  // brightest cloud bleaches to neutral rather than staying blue-grey
  float h = smoothstep(0.66, 0.95, l);
  c = mix(c, vec3(l), h * h * 0.45) * mix(1.0, 1.1, h);
  c = mix(vec3(0.035, 0.03, 0.04), vec3(1.0), c);
  // cyan in the shadows and through the sky's midtones
  float m = smoothstep(0.0, 0.3, l) * (1.0 - smoothstep(0.55, 0.85, l));
  c += m * vec3(-0.022, 0.004, 0.012);
  // grain, in the print's tones: strongest in the midtones
  c += n * (0.15 + 3.4 * l * (1.0 - l));
  // shoulder at 0.9, rolling off towards a warm neutral, never paper white
  vec3 over = max(c - 0.9, 0.0);
  c = min(c, 0.9 + over / (1.0 + over / 0.11));
  c *= mix(vec3(1.0), vec3(1.0, 0.965, 0.918), smoothstep(0.88, 0.955, luma(c)) * 0.9);
  return min(c, vec3(0.975));
}
float hash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
// Smooth value noise on a 1.75 px lattice, triangular values: film grain
// clumps rather than a pixel-sharp digital speckle.
float grain(vec2 px, float f){
  vec2 g = px / 1.75;
  vec2 i = floor(g);
  vec2 t = g - i;
  t = t * t * (3.0 - 2.0 * t);
  float v[4];
  for (int k = 0; k < 4; k++){
    vec3 q = vec3(i + vec2(k & 1, k >> 1), f);
    v[k] = hash(q) + hash(q + 17.13) - 1.0;
  }
  return mix(mix(v[0], v[1], t.x), mix(v[2], v[3], t.x), t.y);
}
void main(){
  if (uStage > 0.5){
    vec3 c = textureLod(uScene, vUv, 0.0).rgb;
    o = vec4(grade(c, grain(gl_FragCoord.xy, uFrame) * uGrain), 1.0);
    return;
  }
  vec3 lin = fetch(vUv, 0.0);
  // diffusion
  vec3 veil = 0.2 * fetch(vUv, 2.0) + 0.35 * fetch(vUv, 3.0) + 0.45 * lobe(vUv, 4.0);
  lin += uMist * (veil - 0.35 * lin);
  // halation: the highlight mask blurred ~3-6 px, kept only where the pixel
  // itself is dark and not highlight
  float self = textureLod(uScene, vUv, 0.0).a;
  float around = 0.0;
  for (int k = 0; k < 8; k++){
    float a = float(k) * 0.7853982 + 0.4;
    vec2 d = vec2(cos(a), sin(a)) * uTexel;
    around += (k & 1) == 0 ? textureLod(uScene, vUv + d * 2.0, 1.5).a : textureLod(uScene, vUv + d * 4.5, 2.5).a;
  }
  around /= 8.0;
  float ring = max(around - self, 0.0) * (1.0 - smoothstep(0.02, 0.35, luma(lin)));
  lin += ring * uHalation * vec3(1.0, 0.34, 0.1);
  o = vec4(toSrgb(lin), 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${src}`));
    im.src = src;
  });

// --- camera maths, in the photo's camera frame (x right, y up, z forward)
const rotation = (axis, a) => {
  const [x, y, z] = axis;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // row-major
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
};
const mul = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const columnMajor = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export async function createSpatial(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, alpha: false });
  const gl = stage.ctx;
  let images;
  let scene;
  try {
    [scene, ...images] = await Promise.all([
      fetch(BASE + "scene.json").then((r) => {
        if (!r.ok) throw new Error("could not load scene.json");
        return r.json();
      }),
      ...["sky.webp", "dome.webp", "near.webp", "depth.png"].map((n) => loadImage(BASE + n)),
    ]);
  } catch (e) {
    stage.destroy();
    throw e;
  }
  const [skyIm, domeIm, nearIm, depthIm] = images;
  const ASPECT = scene.aspect;
  const F = 0.5 / Math.tan(((scene.fovY / 2) * Math.PI) / 180);
  const p0 = (scene.pitch0 * Math.PI) / 180;
  // the world, seen from the photo's camera: up, north (level, towards where
  // the photo looks) and east
  const UP = [0, Math.cos(p0), Math.sin(p0)];
  const NORTH = [0, -Math.sin(p0), Math.cos(p0)];
  const [au, av, ad] = scene.anchor;
  const az = 1 / Math.max(ad, 0.08);
  const A = [(au - 0.5) * ASPECT * (az / F), (0.5 - av) * (az / F), az];
  // where the look up crouches to: in front of the anchor, along the ground
  // back towards the photo's camera, and up or down the pole
  const level = unit(A.map((v, i) => (dot(A, UP) * UP[i] - v)));
  const CROUCHED = A.map((v, i) => v + level[i] * CROUCH[0] + UP[i] * CROUCH[1]);
  const TZ = Math.tan((scene.dome.zmax * Math.PI) / 360);
  const wireP = new Float32Array(24);
  const wireD = new Float32Array(24);
  scene.wires.forEach((w, i) => {
    wireP.set([...w.p, w.r], i * 4);
    wireD.set([...w.d, w.fade], i * 4);
  });

  const texture = (im, { premultiply = false, mips = false } = {}) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tex = {
    sky: texture(skyIm, { mips: true }),
    dome: texture(domeIm, { mips: true }),
    near: texture(nearIm, { premultiply: true, mips: true }),
    depth: texture(depthIm),
  };

  const nearProg = compile(gl, NEAR_VS, NEAR_FS);
  const skyProg = compile(gl, QUAD_VS, SKY_FS);
  const filmProg = compile(gl, QUAD_VS, FILM_FS);

  // The layers render into a target the size of the canvas in device pixels,
  // with mips for the film pass's wide taps.
  const halfFloat = !!gl.getExtension("EXT_color_buffer_float");
  const pack = halfFloat ? 0 : 1;
  const film = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), dev: gl.createTexture(), devFbo: gl.createFramebuffer(), w: 0, h: 0 };
  const sizeTarget = (w, h) => {
    if (w === film.w && h === film.h) return;
    film.w = w;
    film.h = h;
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    // texStorage is immutable; a resize needs a fresh texture.
    gl.deleteTexture(film.tex);
    film.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, film.tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, halfFloat ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, film.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, film.tex, 0);
    // the developed frame, which the print stage reads 1:1
    gl.deleteTexture(film.dev);
    film.dev = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, film.dev);
    gl.texStorage2D(gl.TEXTURE_2D, 1, halfFloat ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, film.devFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, film.dev, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // The near layer's grid; each vertex is displaced by the layer's depth.
  const verts = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 2);
  for (let y = 0, i = 0; y <= GRID_Y; y++) for (let x = 0; x <= GRID_X; x++) {
    verts[i++] = x / GRID_X;
    verts[i++] = y / GRID_Y;
  }
  const idx = new Uint16Array(GRID_X * GRID_Y * 6);
  for (let y = 0, i = 0; y < GRID_Y; y++) for (let x = 0; x < GRID_X; x++) {
    const a = y * (GRID_X + 1) + x;
    const b = a + GRID_X + 1;
    idx.set([a, b, a + 1, a + 1, b, b + 1], i);
    i += 6;
  }
  const gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // --- camera: x yaws and y pitches (up is +); spring-follow the pointer,
  // settle when it leaves, drift when idle. ?x=&y= hold a view.
  const params = new URLSearchParams(location.search);
  const held = params.has("x") || params.has("y");
  const cam = { x: held ? clamp(+params.get("x") || 0, -1, 1) : 0, y: held ? clamp(+params.get("y") || 0, -1, 1) : 0, vx: 0, vy: 0 };
  const target = { x: cam.x, y: cam.y };
  let tilt = null; // device orientation target, where it needs no permission
  let tiltBase = null;
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = { b: e.beta, g: e.gamma };
    tilt = { x: clamp((e.gamma - tiltBase.g) / 18, -1, 1), y: clamp((e.beta - tiltBase.b) / 18, -1, 1) };
  };
  const orientable = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function";
  if (orientable && matchMedia("(pointer: coarse)").matches) window.addEventListener("deviceorientation", onOrient);

  let dirty = true;
  stage.onResize(() => {
    dirty = true;
  });

  let drift = held ? 0 : 1;
  let grainFrame = -1;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let time = 0;
  const drawn = { x: NaN, y: NaN };

  // The camera for a view (x, y). It returns the rotation M (camera to the
  // photo's camera frame), the camera's position C, the lens s, and the
  // half-extents of the frame on the lens's image plane (focal length 1).
  //  - x yaws: the camera orbits the pole's (world-vertical) axis through
  //    the anchor, so the pole holds and what's behind it slides.
  //  - y < 0 pitches down a little, orbiting the anchor, rectilinear.
  //  - y > 0 looks up: the camera crouches in towards the pole's foot and
  //    pitches up while the lens opens from the rest crop to FOV_UP,
  //    rectilinear to stereographic.
  const cameraFor = (x, y) => {
    const Ry = rotation(UP, (x * YAW * Math.PI) / 180);
    const aspect = stage.width / stage.height;
    // At rest the frame fills the photo edge to edge (with room for the yaw),
    // and never shows more of it than its height.
    const rest = Math.atan(Math.min(0.4 / aspect, 0.5));
    if (y <= 0) {
      const M = mul(Ry, rotation([1, 0, 0], (-y * PITCH_DOWN * Math.PI) / 180));
      const MA = apply(M, A);
      const h = Math.tan(rest);
      return { M, C: A.map((v, i) => v - MA[i]), s: 1, half: [h * aspect, h] };
    }
    const u = smooth(0, 1, y);
    const M = mul(Ry, rotation([1, 0, 0], (-u * PITCH_UP * Math.PI) / 180));
    const RA = apply(Ry, A);
    const RE = apply(Ry, CROUCHED.map((v, i) => v - A[i]));
    const w = smooth(0, 1, u);
    const C = A.map((v, i) => v - RA[i] * (1 - w) + RE[i] * w);
    const s = 1 - 0.5 * u;
    const phi = rest + ((FOV_UP * Math.PI) / 360 - rest) * u;
    const h = Math.tan(s * phi) / s;
    return { M, C, s, half: [h * aspect, h] };
  };

  const drawLayers = () => {
    const { M, C, s, half } = cameraFor(cam.x, cam.y);
    const Mc = columnMajor(M);
    const setLens = (prog) => {
      gl.uniform1f(prog.u.uF, F);
      gl.uniform1f(prog.u.uS, s);
      gl.uniform2f(prog.u.uHalf, half[0], half[1]);
      gl.uniformMatrix3fv(prog.u.uM, false, Mc);
      gl.uniform3f(prog.u.uC, C[0], C[1], C[2]);
      gl.uniform4f(prog.u.uRect, -1, -1, 1, 1);
      gl.uniform1f(prog.u.uPack, pack);
    };

    // the layers, in linear light, filling the target
    sizeTarget(gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, film.fbo);
    gl.viewport(0, 0, film.w, film.h);
    gl.disable(gl.SCISSOR_TEST);

    gl.disable(gl.BLEND);
    gl.useProgram(skyProg.p);
    setLens(skyProg);
    gl.uniform4f(skyProg.u.uCanvas, ...scene.canvas);
    gl.uniform3f(skyProg.u.uEast, 1, 0, 0);
    gl.uniform3f(skyProg.u.uNorth, ...NORTH);
    gl.uniform3f(skyProg.u.uUp, ...UP);
    gl.uniform1f(skyProg.u.uTz, TZ);
    gl.uniform4fv(skyProg.u["uWp[0]"], wireP);
    gl.uniform4fv(skyProg.u["uWd[0]"], wireD);
    gl.uniform3f(skyProg.u.uWire, ...scene.wireColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.sky);
    gl.uniform1i(skyProg.u.uSky, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.dome);
    gl.uniform1i(skyProg.u.uDome, 1);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    // colour: premultiplied over; alpha (the sky's highlight mask): occluded
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(nearProg.p);
    setLens(nearProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.depth);
    gl.uniform1i(nearProg.u.uDepth, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.near);
    gl.uniform1i(nearProg.u.uCol, 1);
    gl.bindVertexArray(gridVao);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, film.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // develop: diffusion and halation, into the developed frame
    gl.bindFramebuffer(gl.FRAMEBUFFER, film.devFbo);
    gl.disable(gl.BLEND);
    gl.useProgram(filmProg.p);
    gl.uniform4f(filmProg.u.uRect, -1, -1, 1, 1);
    gl.uniform1f(filmProg.u.uStage, 0);
    gl.uniform2f(filmProg.u.uTexel, 1 / film.w, 1 / film.h);
    gl.uniform1f(filmProg.u.uPack, pack);
    gl.uniform1f(filmProg.u.uMist, MIST);
    gl.uniform1f(filmProg.u.uHalation, HALATION);
    gl.uniform1i(filmProg.u.uScene, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };

  // Two speeds: the layers are drawn into the film target only when the
  // camera moves; the film pass runs every grain frame (24 fps) on top.
  const render = (layers) => {
    if (layers) drawLayers();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);

    // the developed frame, printed full-bleed
    gl.useProgram(filmProg.p);
    gl.uniform4f(filmProg.u.uRect, -1, -1, 1, 1);
    gl.uniform1f(filmProg.u.uStage, 1);
    gl.uniform1f(filmProg.u.uFrame, grainFrame % 997);
    gl.uniform1f(filmProg.u.uGrain, GRAIN);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, film.dev);
    gl.uniform1i(filmProg.u.uScene, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };


  stage.onFrame((dt, t) => {
    if (!held) {
      time += dt;
      const p = stage.pointer;
      const idle = stage.idleFor();
      let tx = 0;
      let ty = 0;
      if (tilt) {
        tx = tilt.x;
        ty = -tilt.y;
      } else if (p.inside) {
        tx = clamp(((p.x / stage.width) * 2 - 1) * 1.15, -1, 1);
        ty = clamp((1 - (p.y / stage.height) * 2) * 1.15, -1, 1);
      }
      // Idle drift: on load, and again after a while untouched. It leans
      // towards looking up, and fades in and out rather than taking over.
      const wantDrift = !tilt && !p.inside && idle > 3500 ? 1 : 0;
      drift += (wantDrift - drift) * (1 - Math.exp(-dt * (wantDrift ? 0.6 : 4)));
      tx += Math.sin(time * 0.42) * 0.8 * drift;
      ty += (0.25 + Math.sin(time * 0.29 + 0.8) * 0.6) * drift;
      const m = Math.hypot(tx, ty);
      if (m > 1) {
        tx /= m;
        ty /= m;
      }
      target.x = tx;
      target.y = ty;
      // Gentle, nearly critically damped spring.
      const k = 26;
      const c = 2 * Math.sqrt(k) * 0.92;
      const steps = Math.ceil(dt / (1 / 120));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        cam.vx += (k * (target.x - cam.x) - c * cam.vx) * h;
        cam.vy += (k * (target.y - cam.y) - c * cam.vy) * h;
        cam.x += cam.vx * h;
        cam.y += cam.vy * h;
      }
    }
    const moved = dirty || Math.abs(cam.x - drawn.x) > 2e-4 || Math.abs(cam.y - drawn.y) > 2e-4;
    // Grain is locked to 24 fps, and holds still for reduced motion.
    const frame = still.matches ? 0 : Math.floor(t * 24);
    if (moved || frame !== grainFrame) {
      grainFrame = frame;
      render(moved);
      drawn.x = cam.x;
      drawn.y = cam.y;
      dirty = false;
    }
  });

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      gl.deleteTexture(film.tex);
      gl.deleteFramebuffer(film.fbo);
      gl.deleteTexture(film.dev);
      gl.deleteFramebuffer(film.devFbo);
      stage.destroy();
    },
  };
}
