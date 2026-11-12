import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createModal } from "./modal";

// Poke: a still frame of a tree against a summer sky that you can pull.
//
// Image-space modal bases (Abe Davis, Justin G. Chen and Fredo Durand,
// "Image-Space Modal Bases for Plausible Manipulation of Objects in Video",
// SIGGRAPH Asia 2015; the method behind Interactive Dynamic Video). Twenty-six
// seconds of a locked-off clip of the tree moving in the wind were taken apart
// offline (tools/depth/bakes/poke): dense optical flow from one reference
// frame to every other, a spectral decomposition of all that motion at once
// (frequency domain decomposition), and the twelve strongest spatially
// coherent resonances kept as complex 2D displacement fields with their own
// measured frequency (0.36 to 1.27 Hz) and damping ratio (6 to 29%).
//
// Live, the reference frame is warped by the sum of those modes. Grab any
// part of the picture and it follows the hand through a stiff spring; every
// other part of the tree answers through the modes it shares with that spot,
// with its own lag. Let go and each mode rings down at its own frequency and
// damping. The modes are weighted toward the slow, crown-wide ones, so a pull
// swings the whole crown. The tree is a matted layer over the sky behind it
// (filled and regraded offline), cut into Voronoi patches that each move
// rigidly, so leaves translate instead of smearing and a branch that swings
// away uncovers sky.
//
// The modes are also the image. Over the photograph, a halftone of comets
// draws the displacement field itself: each one's dot is where that bit of
// tree is now, and its hairline trail runs back to where it sat in the still
// frame. Each comet is tinted by where that point is in its swing relative
// to the pull (with it, leading, against, lagging), so even a frozen frame
// shows the measured vibration structure of the real tree. The frame is
// developed with the shared film kit (summer).
//
// Query: ?poke=x,y,amp[,deg] holds a pull at print uv (x, y) by amp (a
// fraction of the print's width, toward deg, default 180 = left); add
// &t=seconds for the moment that long after letting go. ?still=1 stops the
// breeze.

const BASE = "/lab/poke/";
const ASPECT = 1.5; // the print, 3:2
const VIEW_H = 0.95; // share of the plate's height the print shows
const VIEW_X = 0.985; // right edge of the print in the plate (the tree runs off it)
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const LMAX = 240; // plate px: how far the pointer can lead the grabbed point (soft)
const DMAX = 260; // plate px: the most any part of the crown may travel under a hold
const HAND = 48; // plate px: radius of the patch of crown a hand takes hold of
const TILT = 2; // modal mass tilt toward the slow, crown-wide modes (see modal.js)
const BREEZE = 0.45; // idle forcing, in units of each mode's static response
const CELL = 34; // plate px: spacing of the rigid patches the tree is cut into
const PATCH_BLUR = 80; // plate px: radius each patch's motion is averaged over
const STEP = 14; // target px at DPR 2: spacing of the strokes
const INK = 0.72;
const STROKE_GAIN = 0.4; // stroke length per unit displacement, before the cap // how far the photograph steps back under the strokes
const REVEAL = 1.8;
const SHUTTER = 1 / 30; // s, for motion blur

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const sceneFrag = (K) => `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTree;          // RGBA: decontaminated tree colour, matte
uniform sampler2D uSky;           // the sky behind it, filled and regraded
uniform sampler2DArray uModes;    // ${K} layers: re x, re y, im x, im y (0..1 = -1..1)
uniform highp sampler2D uSiteA;   // per patch: site x, y and displacement x, y (plate px)
uniform highp sampler2D uSiteB;   // per patch: travel while the shutter is open (plate px)
uniform highp sampler2D uOwner;   // which patch owns each spot of the still frame (rg = i, j)
uniform ivec2 uSites;             // patch grid
uniform float uCell;              // patch spacing, plate px
uniform vec2 uQ[${K}];            // modal coordinates times each layer's scale
uniform vec4 uView;               // print window in plate uv
uniform vec2 uPlate;
uniform float uExpo;
uniform float uInk;               // how far the photograph steps back under the strokes

vec2 field(vec2 uv) {
  vec2 d = vec2(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(uv, float(i))) * 2.0 - 1.0;
    d += m.xy * uQ[i].x - m.zw * uQ[i].y;
  }
  return d / uPlate;
}

ivec2 owner(vec2 q) {
  ivec2 sz = textureSize(uOwner, 0);
  ivec2 t = clamp(ivec2(q / uPlate * vec2(sz)), ivec2(0), sz - 1);
  return ivec2(texelFetch(uOwner, t, 0).rg * 255.0 + 0.5);
}

void main() {
  vec2 uv = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;
  vec2 p = uv * uPlate;
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  // The tree is cut into Voronoi patches (about a leaf clump each) that move
  // rigidly, each by the modal displacement at its own site, so a leaf
  // translates instead of stretching. Where patches part, sky shows through;
  // where they meet, the one that moved further passes in front.
  // First guess at where the material drawn here came from (the inverse of
  // the smooth field, two fixed-point steps), then the patches around it.
  vec2 d = field(uv);
  vec2 s0 = p - field(uv - d) * uPlate;
  ivec2 c0 = ivec2(floor(s0 / uCell));
  vec4 acc = vec4(0.0);
  float cover = 0.0;
  float wsum = 0.0;
  // open sky with no tree within a patch or two: nothing to gather
  bool near = textureLod(uTree, s0 / uPlate, 6.5).a > 0.002;
  if (near) for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 cj = c0 + ivec2(i, j);
      if (any(lessThan(cj, ivec2(0))) || any(greaterThanEqual(cj, uSites))) continue;
      vec4 A = texelFetch(uSiteA, cj, 0);
      vec2 q = p - A.zw;
      // this patch draws here only if the material it would bring here is
      // its own in the still frame
      if (owner(q) != cj) continue;
      float own = 1.0;
      float pri = own * exp(min(length(A.zw), 400.0) / 40.0);
      vec2 src = q / uPlate;
      vec2 sh = texelFetch(uSiteB, cj, 0).xy / uPlate;
      vec4 t = vec4(0.0);
      if (dot(sh, sh) * uPlate.x * uPlate.x < 0.25) {
        t = textureGrad(uTree, src, gx, gy);
        t.rgb *= t.a;
      } else {
        // a film shutter: the patch is integrated along its own travel
        for (int k = 0; k < 5; k++) {
          vec4 s = textureGrad(uTree, src - sh * (float(k) / 4.0 - 0.5), gx, gy);
          t += vec4(s.rgb * s.a, s.a);
        }
        t /= 5.0;
      }
      acc += t * pri;
      cover += own;
      wsum += pri;
    }
  vec4 tree = wsum > 0.0 ? acc / wsum : vec4(0.0);
  // a seam no patch claims is filled by the continuous warp, so it reads as
  // a thin stretch between clumps instead of a crack of sky
  float cv = min(cover, 1.0);
  if (near && cv < 0.999) {
    vec4 f = textureGrad(uTree, (s0 / uPlate), gx, gy);
    tree = tree * cv + vec4(f.rgb * f.a, f.a) * (1.0 - cv);
  }
  vec3 tc = tree.a > 1e-4 ? tree.rgb / tree.a : vec3(0.0);
  // the photograph steps back into a ground for the strokes: darker, less
  // saturated, the full ink kept for the strokes drawn over it
  float l = dot(tc, vec3(0.2126, 0.7152, 0.0722));
  vec3 ground = mix(tc, vec3(l) * vec3(0.78, 0.92, 0.86), 0.45) * 0.5;
  tc = mix(tc, ground, uInk);
  vec3 sky = texture(uSky, uv).rgb;
  vec3 col = mix(sky, tc, tree.a);
  outColor = vec4(col * uExpo, 1.0);
}`;

// The mode-visualising pass. A halftone laid on the photograph at rest: one
// comet per cell, its dot where that bit of tree is now and a hairline trail
// back to where it sat in the still frame, so the strokes are the
// displacement field itself (at a fraction of true scale, eased into a cap).
// Its tint is the phase of that point's swing along the hand's pull: the
// analytic signal sum_i phi_i (q_i - i v_i / omega_i), whose real part is the
// displacement. Warm white swings with the hand, violet against it, and the
// vermilion and cyan between are the parts that lead and lag it. At rest the
// comets shrink to dots, sized by the leaves' own light.
const strokeVert = (K) => `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 aPos;
uniform sampler2DArray uModes;
uniform sampler2D uTree;
uniform vec2 uQ[${K}];
uniform vec2 uW[${K}];  // velocities over omega, times each layer's scale
uniform vec4 uView;
uniform vec2 uPlate;
uniform vec2 uRes;      // target px
uniform float uStep;    // stroke spacing, target px
uniform int uCols;
uniform vec2 uRef;      // reference direction for the phase
uniform float uRadius;  // largest dot radius, target px
uniform float uLod;
uniform float uGain;    // stroke length per unit displacement
uniform float uCap;     // longest stroke, target px
out vec2 vLocal;
out float vLen;
out float vR;
out vec4 vCol;
uniform float uHair;    // trail half-width, target px

vec3 phaseInk(float th) {
  // in phase with the hand: warm white; leading: vermilion; anti-phase:
  // violet; lagging: cyan
  vec3 c0 = vec3(1.0, 0.93, 0.74);
  vec3 c1 = vec3(1.0, 0.36, 0.2);
  vec3 c2 = vec3(0.7, 0.48, 1.0);
  vec3 c3 = vec3(0.3, 0.92, 1.0);
  float t = mod(th / 6.2831853 + 1.0, 1.0) * 4.0;
  float f = smoothstep(0.0, 1.0, fract(t));
  int k = int(floor(t));
  if (k == 0) return mix(c0, c1, f);
  if (k == 1) return mix(c1, c2, f);
  if (k == 2) return mix(c2, c3, f);
  return mix(c3, c0, f);
}

void main() {
  int id = gl_InstanceID;
  int iy = id / uCols;
  int ix = id - iy * uCols;
  vec2 cell = (vec2(float(ix) + ((iy & 1) == 1 ? 0.0 : 0.5), float(iy) * 0.866 + 0.5)) * uStep;
  vec2 pv = cell / uRes;
  vec2 uv = uView.xy + pv * uView.zw;
  vec4 t = textureLod(uTree, uv, uLod);
  vec2 zr = vec2(0.0);
  vec2 zi = vec2(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(uv, float(i))) * 2.0 - 1.0;
    // the displacement, and the quarter-cycle on from it (each oscillator's
    // velocity over its own omega): together the analytic signal of the
    // point's motion, whose angle is where in its swing the point is
    zr += m.xy * uQ[i].x - m.zw * uQ[i].y;
    zi -= m.xy * uW[i].x - m.zw * uW[i].y;
  }
  float k = uRes.x / (uView.z * uPlate.x);  // plate px -> target px
  vec2 D = zr * k;
  // length: a third of true scale, eased into at most uCap so a hard pull
  // still reads as a field of separate strokes
  float len0 = length(D) * uGain;
  float len = uCap * (1.0 - exp(-len0 / uCap));
  float lum = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
  float cov = smoothstep(0.35, 0.8, t.a);
  float r = uRadius * clamp(sqrt(lum * 2.2), 0.3, 1.0) * cov;
  if (r < 0.15) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 dir = len0 > 1e-3 ? normalize(D) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float e = max(r, uHair) + 1.0;
  vec2 a = vec2(aPos.x > 0.0 ? len + e : -e, aPos.y * e);
  vec2 px = cell + dir * a.x + nrm * a.y;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
  vLocal = a;
  vLen = len;
  vR = r;
  float th = atan(dot(zi, uRef), dot(zr, uRef));
  // how hard the point is swinging: the analytic amplitude, so a point
  // passing fast through its rest pose is still lit by its phase
  float live = smoothstep(2.0, 40.0, length(vec4(zr, zi)));
  vec3 ink = mix(vec3(0.93, 0.95, 0.88), phaseInk(th), live);
  vCol = vec4(ink, mix(0.55, 0.9, live));
}`;

const STROKE_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vR;
in vec4 vCol;
out vec4 outColor;
uniform float uHair;
void main() {
  // a comet: the halftone dot where the leaf is now, and a hairline trail
  // back to where it sat in the still frame
  float ax = max(0.0, max(-vLocal.x, vLocal.x - vLen));
  float trail = length(vec2(ax, vLocal.y)) - uHair * smoothstep(0.0, 4.0, vLen);
  float head = length(vLocal - vec2(vLen, 0.0)) - vR;
  float dist = min(trail, head);
  float a = clamp(0.5 - dist, 0.0, 1.0) * vCol.a;
  outColor = vec4(vCol.rgb * a, a);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
}`;

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

function program(gl, vs, fs) {
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
    gl.deleteShader(s);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// the mode atlas (K tiles stacked vertically) as a texture array, and its
// exact bytes read back for the CPU side
function modeArray(gl, bmp, gw, gh, K) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, gw, gh, K, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const layers = [];
  for (let i = 0; i < K; i++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, i);
    const px = new Uint8Array(gw * gh * 4);
    gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    layers.push(px);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return { tex: t, layers };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

// a seeded generator, so a still is the same every time
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createPoke(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const pokeQ = (q.get("poke") || "").split(",").map(Number).filter(Number.isFinite);
  const tQ = q.get("t") != null && q.get("t") !== "" && Number.isFinite(+q.get("t")) ? +q.get("t") : null;
  const posed = pokeQ.length >= 3;
  const still = posed || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [meta, treeBmp, skyBmp, modesBmp] = await Promise.all([
    fetch(BASE + "modes.json").then((r) => r.json()),
    loadBitmap(BASE + "tree.webp"),
    loadBitmap(BASE + "sky.webp"),
    loadBitmap(BASE + "modes.png"),
  ]);
  const K = meta.modes.length;
  const [gw, gh] = meta.grid;
  const [PW, PH] = meta.plate;
  const tex = { tree: imageTexture(gl, treeBmp), sky: imageTexture(gl, skyBmp) };
  const ma = modeArray(gl, modesBmp, gw, gh, K);
  tex.modes = ma.tex;
  treeBmp.close?.();
  skyBmp.close?.();
  modesBmp.close?.();
  const modal = createModal(meta, ma.layers, { tilt: TILT });

  // the rigid patches: jittered sites on a grid over the plate; their
  // displacement and shutter travel are evaluated on the CPU every frame
  const SX = Math.ceil(PW / CELL);
  const SY = Math.ceil(PH / CELL);
  const siteXY = new Float32Array(SX * SY * 2);
  {
    const jr = mulberry(11);
    for (let j = 0; j < SY; j++)
      for (let i = 0; i < SX; i++) {
        const o = (j * SX + i) * 2;
        siteXY[o] = (i + 0.5 + (jr() - 0.5) * 0.7) * CELL;
        siteXY[o + 1] = (j + 0.5 + (jr() - 0.5) * 0.7) * CELL;
      }
  }
  const siteShapes = [];
  // a patch moves rigidly by the mean of the modal field around it, so
  // neighbouring patches differ only by the field's broad swing
  for (let n = 0; n < SX * SY; n++) siteShapes.push(modal.meanShape(siteXY[n * 2], siteXY[n * 2 + 1], PATCH_BLUR));
  const siteA = new Float32Array(SX * SY * 4);
  const siteB = new Float32Array(SX * SY * 4);
  const floatTexture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, SX, SY, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // the patches themselves: the owner of every spot of the still frame (half
  // plate resolution), the nearest site among the jittered grid around it
  {
    const OW = PW >> 1;
    const OH = PH >> 1;
    const own = new Uint8Array(OW * OH * 4);
    for (let y = 0; y < OH; y++)
      for (let x = 0; x < OW; x++) {
        const px = (x + 0.5) * 2;
        const py = (y + 0.5) * 2;
        const ci = Math.floor(px / CELL);
        const cj = Math.floor(py / CELL);
        let best = 1e18;
        let bi = ci;
        let bj = cj;
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) {
            const i = ci + a;
            const j = cj + b;
            if (i < 0 || j < 0 || i >= SX || j >= SY) continue;
            const o = (j * SX + i) * 2;
            const d = (siteXY[o] - px) ** 2 + (siteXY[o + 1] - py) ** 2;
            if (d < best) {
              best = d;
              bi = i;
              bj = j;
            }
          }
        const o = (y * OW + x) * 4;
        own[o] = bi;
        own[o + 1] = bj;
        own[o + 3] = 255;
      }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, OW, OH, 0, gl.RGBA, gl.UNSIGNED_BYTE, own);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex.owner = t;
  }
  tex.siteA = floatTexture();
  tex.siteB = floatTexture();
  const updateSites = () => {
    for (let n = 0; n < SX * SY; n++) {
      const a = siteShapes[n];
      const [dx, dy] = modal.disp(a, modal.q);
      const [vx, vy] = modal.disp(a, modal.v);
      siteA[n * 4] = siteXY[n * 2];
      siteA[n * 4 + 1] = siteXY[n * 2 + 1];
      siteA[n * 4 + 2] = dx;
      siteA[n * 4 + 3] = dy;
      siteB[n * 4] = vx * SHUTTER;
      siteB[n * 4 + 1] = vy * SHUTTER;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex.siteA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SX, SY, gl.RGBA, gl.FLOAT, siteA);
    gl.bindTexture(gl.TEXTURE_2D, tex.siteB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SX, SY, gl.RGBA, gl.FLOAT, siteB);
  };
  // the reference direction the strokes' phase is read against: the last pull
  const ref = [-1, 0];

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const scene = program(gl, VERT, sceneFrag(K));
  const strokes = program(gl, strokeVert(K), STROKE_FRAG);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const strokeVao = gl.createVertexArray();
  gl.bindVertexArray(strokeVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout: a 3:2 print on the paper; the print is a window on the plate ---
  const L = { x: 0, y: 0, w: 1, h: 1, view: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      // a phone gets a 4:5 print: the crown against the sky, the way it is held
      const aspect = W < 600 ? 0.8 : ASPECT;
      const side = W < 600 ? 16 : Math.max(24, W * 0.07);
      let h = H * (W < 600 ? 0.7 : 0.78);
      let w = h * aspect;
      if (w > W - side * 2) {
        w = W - side * 2;
        h = w / aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - (W < 600 ? 8 : 4) });
    }
    // window in the plate: full print height of VIEW_H, anchored at the right
    const a = L.w / L.h;
    let vh = VIEW_H;
    let vw = (vh * a * PH) / PW;
    if (vw > 0.97) {
      vw = 0.97;
      vh = (vw * PW) / (a * PH);
    }
    L.view = [VIEW_X - vw, 0.5 - vh / 2, vw, vh];
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.rw, L.rh);
    filmT = target(gl, L.rw, L.rh);
    film.resize(L.rw, L.rh);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const toPlate = (x, y) => [
    (L.view[0] + ((x - L.x) / L.w) * L.view[2]) * PW,
    (L.view[1] + ((y - L.y) / L.h) * L.view[3]) * PH,
  ];
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  const grabbable = (px, py) => modal.complianceAt(px, py) > 0.06;

  // --- the hand ---
  let held = null; // { x0, y0, dx0, dy0 }
  const rubber = (dx, dy, lmax) => {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return [0, 0];
    const s = (lmax * (1 - Math.exp(-l / lmax))) / l;
    return [dx * s, dy * s];
  };
  const pull = (held, px, py) => {
    const [ox, oy] = rubber(px - held.px0, py - held.py0, held.lmax);
    modal.setTarget(held.dx0 + ox, held.dy0 + oy);
    const l = Math.hypot(ox, oy);
    if (l > 4) {
      ref[0] = ox / l;
      ref[1] = oy / l;
    }
  };

  stage.on("down", (p) => {
    if (posed || !inPrint(p)) return;
    const [px, py] = toPlate(p.x, p.y);
    if (!grabbable(px, py)) return;
    const h = modal.grab(px, py, { dmax: DMAX, radius: HAND });
    // stiffer spots travel less: the limit scales with the spot's compliance
    held = { px0: px, py0: py, dx0: h.tx, dy0: h.ty, lmax: Math.min(LMAX, h.reach) };
    host.dataset.grab = "held";
    dirty = true;
  });
  stage.on("move", (p) => {
    const [px, py] = toPlate(p.x, p.y);
    if (held) {
      pull(held, px, py);
      dirty = true;
    } else if (!posed) {
      host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
    }
  });
  stage.on("up", (p) => {
    if (!held) return;
    held = null;
    modal.release();
    const [px, py] = toPlate(p.x, p.y);
    host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
  });

  // --- a posed still: pull, hold until it settles, let go, run t seconds ---
  let posedDone = false;
  const runPose = () => {
    posedDone = true;
    const [ux, uy, amp, deg = 180] = pokeQ;
    const [px, py] = [(L.view[0] + ux * L.view[2]) * PW, (L.view[1] + uy * L.view[3]) * PH];
    const h = modal.grab(px, py, { dmax: DMAX, radius: HAND });
    const tx0 = h.tx;
    const ty0 = h.ty;
    const len = amp * L.view[2] * PW;
    const r = (deg * Math.PI) / 180;
    const lmax = Math.min(LMAX, h.reach);
    const [ox, oy] = rubber(Math.cos(r) * len, -Math.sin(r) * len, lmax);
    ref[0] = Math.cos(r);
    ref[1] = -Math.sin(r);
    const steps = 240;
    for (let i = 0; i < steps; i++) {
      // ease the pull in over the first second, as a hand would
      const e = Math.min(1, (i / 60) * 1.0);
      const k = 1 - Math.pow(1 - e, 3);
      modal.setTarget(tx0 + ox * k, ty0 + oy * k);
      modal.step(1 / 60);
    }
    if (tQ != null && tQ >= 0) {
      modal.release();
      const n = Math.round(tQ * 120);
      for (let i = 0; i < n; i++) modal.step(1 / 120);
    }
  };

  // --- draw ---
  const uQ = new Float32Array(K * 2);
  const uW = new Float32Array(K * 2);
  let grainSeed = 0;
  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(scene.p);
    const u = scene.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tree);
    gl.uniform1i(u.uTree, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.sky);
    gl.uniform1i(u.uSky, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.modes);
    gl.uniform1i(u.uModes, 2);
    updateSites();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tex.siteA);
    gl.uniform1i(u.uSiteA, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, tex.siteB);
    gl.uniform1i(u.uSiteB, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, tex.owner);
    gl.uniform1i(u.uOwner, 5);
    gl.uniform2i(u.uSites, SX, SY);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform1f(u.uInk, INK);
    for (let i = 0; i < K; i++) {
      uQ[i * 2] = modal.q[i * 2] * modal.scale[i];
      uQ[i * 2 + 1] = modal.q[i * 2 + 1] * modal.scale[i];
    }
    gl.uniform2fv(u.uQ, uQ);
    gl.uniform4f(u.uView, ...L.view);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // the strokes, over the photograph, before the film
    const stepPx = STEP * (L.rw / Math.max(1, L.pw)) * (stage.dpr / 2);
    const cols = Math.ceil(L.rw / stepPx) + 1;
    const rows = Math.ceil(L.rh / (stepPx * 0.866)) + 1;
    const su = strokes.u;
    gl.useProgram(strokes.p);
    gl.bindVertexArray(strokeVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tree);
    gl.uniform1i(su.uTree, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.modes);
    gl.uniform1i(su.uModes, 2);
    for (let i = 0; i < K; i++) {
      uW[i * 2] = (modal.v[i * 2] * modal.scale[i]) / modal.omega[i];
      uW[i * 2 + 1] = (modal.v[i * 2 + 1] * modal.scale[i]) / modal.omega[i];
    }
    gl.uniform2fv(su.uQ, uQ);
    gl.uniform2fv(su.uW, uW);
    gl.uniform4f(su.uView, ...L.view);
    gl.uniform2f(su.uPlate, PW, PH);
    gl.uniform2f(su.uRes, L.rw, L.rh);
    gl.uniform1f(su.uStep, stepPx);
    gl.uniform1i(su.uCols, cols);
    gl.uniform2f(su.uRef, ref[0], ref[1]);
    gl.uniform1f(su.uRadius, stepPx * 0.3);
    gl.uniform1f(su.uHair, Math.max(0.6, stepPx * 0.06));
    gl.uniform1f(su.uGain, STROKE_GAIN);
    gl.uniform1f(su.uCap, stepPx * 2.6);
    gl.uniform1f(su.uLod, Math.log2(Math.max(1, (stepPx * L.view[2] * PW) / L.rw)));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
    gl.disable(gl.BLEND);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        halation: 0.3,
        halationThreshold: 0.85,
        bloom: 0.22,
        softness: 0.5,
        contrast: 1.14,
        whitePoint: 1.25,
        toe: 0.06,
        blueDepth: 0.6,
        saturation: 0.97,
        warmth: 0.08,
        vignette: 0.22,
        grain: 0.3,
        grainSeed,
      },
      filmT.fbo,
    );

    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let wall = 0;
  let t0 = -1;
  let grainClock = 0;
  let slow = 0;
  let lastNow = 0;
  const rand = mulberry(7);
  const breezeOn = !still && !reduce;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    if (posed && !posedDone) runPose();
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      // drop the render scale on a slow machine
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    wall += dt;
    if (t0 < 0) t0 = wall;
    const age = still ? 99 : wall - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let moving = false;
    if (!posed) {
      modal.step(dt, { breezeAmp: breezeOn ? BREEZE : 0, rand });
      if (!breezeOn && held == null && modal.restless() < 0.02) {
        if (modal.restless() > 0) {
          modal.reset();
          dirty = true;
        }
      } else moving = true;
    }
    if (!reduce && !still && moving) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    if (!dirty && !moving && age > REVEAL + 0.2) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteProgram(strokes.p);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(corner);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(strokeVao);
      stage.destroy();
    },
  };
}
