import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm } from "../_kit/film";

// Crossing: a summer photograph of a Japanese level crossing, taken from
// below, that comes apart into the planes it was made of, like a paper
// diorama or the 1937 Disney multiplane camera.
//
// The photo looks up past the crossbuck and lamp heads into the sky, the
// wires fanning up to the right. tools/depth/bakes/crossing cut it offline
// into seven planes at its depth discontinuities (sky; far houses; wires;
// barrier boom; the old house on the left; the signal; the camellia). Each is
// a cut-out with a colour-unmixed matte and continues behind the planes in
// front of it with inpainted texture, so a gap shows what was really there;
// the wires run on whole behind the post and lamps, and the sky is one
// opaque back card filled from a dilated matte, with no ghost of a wire.
//
// Every plane k sits at its own distance z_k from the camera and is scaled by
// z_k / f, so from the lens axis the stack projects back onto the photo
// exactly however far apart the planes are. Dragging (or tilting a phone)
// spreads them in z and swings the camera round a pivot inside the stack, so
// the separation becomes visible as real perspective: the planes slide past
// each other, the sky card stands far back, the signal floats forward, and
// each card throws a soft, skylight-blue shadow on the cards behind it,
// sharp near and wider as the gap grows. The lens focuses on the plane under
// the pointer with a disc-shaped (not Gaussian) circle of confusion per
// plane, CoC = A * |z - z_focus| / z, opening as the stack spreads. Release
// and it springs back flat. The frame then goes through film.js (summer).
//
// It is built as a tunnel book: a front mat of the page's paper, with the
// photo's rectangle cut out, stands at the nearest card's depth and throws a
// soft shadow in through the window. Every card that meets the frame was
// overscanned in the bake (the sky outpainted a quarter past each side, the
// town and house a sixth past the left and bottom, the wires carried on), and
// the swing is clamped so that the window never slides past any card's
// overscan: no card edge and no bare paper can show inside it.
//
// Query: ?split=0..1&yaw=deg&pitch=deg&focus=0..6 holds a still (the swing is
// clamped to the window like a live one).

const ASSET = "/lab/crossing/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
// What the film sees round the window. The page's paper is bright enough to
// fire the film's halation, and its red-orange halo laid over the blue sky
// at the card's edges read as a magenta fringe in the corners. The film gets
// a neutral grey there instead (below the halation threshold, no hue), so the
// only thing it brings into the edges is a little neutral veil; the page
// itself still shows the real paper (FINAL_FS).
const SURROUND = [0.78, 0.78, 0.78];
const PHOTO = [2048, 1356];
const MATTE = [512, 339];
// From layers.json (bake.py): each plane's crop rect in photo uv. Cards
// that meet the frame are overscanned past it, so their rects run past 0..1.
const PLANES = [
  { rect: [-0.25, -0.25, 1.25, 1.25], o: 0.66 }, // sky
  { rect: [-0.1499, 0.28171, 1.1499, 1.14971], o: 0.38 }, // far houses, trees
  { rect: [0.25879, 0.03466, 1.22021, 0.92625], o: 0.2 }, // wires
  { rect: [0.85742, 0.15708, 1.1499, 1.14971], o: 0.08 }, // barrier boom, mast
  { rect: [-0.1499, 0.44248, 0.51025, 1.14971], o: -0.06 }, // the old house
  { rect: [0.50732, 0.15192, 0.83545, 1.14971], o: -0.24 }, // the signal
  { rect: [0.01367, 0.83038, 0.37988, 1.10029], o: -0.42 }, // camellia
];
const N = PLANES.length;
// The front mat sits at the nearest plane's depth, and the camera swings
// round the middle of its window: the window holds still and the street
// slides behind it.
const MAT_K = N - 1;
const PIVOT_O = PLANES[MAT_K].o;
// Where each card must keep covering the window: the sides that meet the
// frame were overscanned by the bake (their rects run past 0..1), and the
// window may not slide past them. Sides that end inside the photo are cut-out
// silhouettes and may show.
const SAFE = PLANES.map(({ rect: r }) => [r[0] < 0.002 ? r[0] : -Infinity, r[1] < 0.002 ? r[1] : -Infinity, r[2] > 0.998 ? r[2] : Infinity, r[3] > 0.998 ? r[3] : Infinity]);
const MAT_RECT = [-1.5, -2.5, 2.5, 3.5]; // the paper sheet, in photo uv: past every edge of the screen
const SPREAD = 1.0; // plane offsets are o * SPREAD * print width at split 1
const FOVY = 30; // degrees
const MAX_YAW = 21;
const MAX_PITCH = 11;
const APERTURE = 15; // CoC in css px for a plane at |z - zf| / z = 1, at split 1
const LIGHT = normalize([0.18, 0.28, 1]); // toward the sun: up, right (the eave's shadow on the wall), toward us
const HAZE = [0.86, 0.93, 0.95];

const FILM = {
  exposure: 0,
  headroom: 0.9,
  halation: 0.22,
  halationThreshold: 0.92,
  bloom: 0.16,
  softness: 0.45,
  contrast: 1.16,
  saturation: 1.12,
  blueDepth: 0.25, // the bake paints the cobalt into the sky card; more here turns it cyan
  grain: 0.3,
  vignette: 0,
};

const PLANE_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect;     // quad extent in photo uv (x0, y0, x1, y1), y down
uniform vec3 uPlane;    // half width, half height (world px), distance
uniform mat3 uRot;      // orbit, applied about the pivot
uniform float uPivot;
uniform vec2 uProj;     // f / half viewport, per axis
uniform vec2 uShift;    // print centre in clip space
out vec2 vUv;
void main() {
  vec2 uv = mix(uRect.xy, uRect.zw, aPos);
  vec3 p = vec3((uv.x - 0.5) * 2.0 * uPlane.x, (0.5 - uv.y) * 2.0 * uPlane.y, -uPlane.z);
  vec3 c = vec3(0.0, 0.0, -uPivot);
  vec3 q = uRot * (p - c) + c;
  gl_Position = vec4(q.x * uProj.x + uShift.x * -q.z, q.y * uProj.y + uShift.y * -q.z, 0.0, -q.z);
  vUv = uv;
}`;

const PLANE_FS = `#version 300 es
precision highp float;
precision mediump sampler2DArray;
in vec2 vUv;
uniform sampler2D uTex;          // this plane, premultiplied, cropped
uniform vec4 uCrop;              // its crop rect in photo uv
uniform vec2 uTexSize;
uniform float uCoc;              // disc radius, device px
uniform float uOpacity;
uniform int uK;
uniform sampler2DArray uMattes;  // every plane's alpha, 512 wide
uniform float uZ[${N}];
uniform vec2 uHalf[${N}];
uniform vec3 uLight;
uniform float uShadow;
uniform float uPrintW;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform int uMat;                // 1: the front mat, paper with the window cut out
uniform vec3 uPaper;
uniform float uMatZ;
uniform vec2 uMatHalf;
out vec4 o;

vec4 tap(vec2 uv, float lod) {
  vec2 t = (uv - uCrop.xy) / (uCrop.zw - uCrop.xy);
  vec2 inside = step(vec2(0.0), t) * step(t, vec2(1.0));
  return textureLod(uTex, t, lod) * inside.x * inside.y;
}

void main() {
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  if (uMat == 1) {
    // Paper everywhere but the photo's rectangle, the cut edge antialiased.
    vec2 d = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-6));
    float a = 1.0 - clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
    o = vec4(uPaper * a, a);
    return;
  }
  vec4 c;
  if (uCoc < 0.6) {
    vec2 t = (vUv - uCrop.xy) / (uCrop.zw - uCrop.xy);
    vec2 inside = step(vec2(0.0), t) * step(t, vec2(1.0));
    c = texture(uTex, t) * inside.x * inside.y;
  } else {
    // A lens makes discs: gather over a uniform disc (golden-angle spiral),
    // bright points weighted up so they open into round bokeh. The mip only
    // fills the gaps between taps.
    vec2 texPerPx = vec2(length(dx), length(dy)) * uTexSize / (uCrop.zw - uCrop.xy);
    float lod = log2(max(1.0, uCoc * max(texPerPx.x, texPerPx.y) * 0.42));
    // nothing on this plane within the disc: skip the gather
    float cover = textureLod(uTex, (vUv - uCrop.xy) / (uCrop.zw - uCrop.xy), lod + 2.5).a;
    if (cover < 0.002) discard;
    const int TAPS = 20;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float r = sqrt((float(i) + 0.5) / float(TAPS)) * uCoc;
      float a = float(i) * 2.39996323;
      vec2 off = r * vec2(cos(a), sin(a));
      vec4 s = tap(vUv + dx * off.x + dy * off.y, lod);
      float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = 1.0 + 2.5 * smoothstep(0.82, 0.98, l);
      acc += s * w;
      wsum += w;
    }
    c = acc / wsum;
  }
  // Cards in front throw soft shadows on this one: walk toward the sun from
  // this point to each nearer plane and read its matte there, blurred by the
  // gap (a larger penumbra the further the shadow falls).
  if (uShadow > 0.0 && c.a > 0.0) {
    vec2 h = uHalf[uK];
    vec2 p = vec2((vUv.x - 0.5) * 2.0 * h.x, (0.5 - vUv.y) * 2.0 * h.y);
    float lit = 1.0;
    for (int j = 0; j < ${N}; j++) {
      if (j <= uK) continue;
      float gap = uZ[uK] - uZ[j];
      if (gap < 1.0) continue;
      vec2 q = p + uLight.xy * gap / uLight.z;
      vec2 hj = uHalf[j];
      vec2 uvj = vec2(q.x / (2.0 * hj.x) + 0.5, 0.5 - q.y / (2.0 * hj.y));
      // penumbra grows with the gap; the shadow also sits on this plane, so
      // it shares the plane's defocus
      float pen = gap * 0.045 * ${MATTE[0]}.0 / (2.0 * hj.x);
      float cocM = uCoc * length(dx) * ${MATTE[0]}.0;
      float w = max(1.0, max(pen, cocM));
      float lod = log2(w);
      float a = textureLod(uMattes, vec3(uvj, float(j)), lod + 0.5).r;
      // thin things (wires) blur away instead of veiling the card; past the
      // photo the matte holds its edge, as the overscanned cards run on
      a = smoothstep(0.18, 0.7, a);
      float g = gap / uPrintW; // gaps in print widths, so a phone matches a desktop
      lit *= 1.0 - a * smoothstep(0.0, 0.05, g) * exp(-g / 0.3);
    }
    // Sunlight blocked leaves skylight: shadows go blue, not black.
    vec3 shade = mix(vec3(0.64, 0.72, 0.84), vec3(1.0), lit);
    // The front mat throws its own shadow in through the window: a soft band
    // inside the edges that face the sun, wider the further back the card.
    // Paper-white sheets bounce light into it, so it is greyer and lighter.
    float mgap = uZ[uK] - uMatZ;
    if (mgap > 1.0) {
      vec2 q = p + uLight.xy * mgap / uLight.z;
      vec2 in2 = uMatHalf - abs(q);
      float din = min(in2.x, in2.y);
      float pen = max(1.5, mgap * 0.06);
      float g = mgap / uPrintW;
      float m = (1.0 - smoothstep(-pen, pen, din)) * smoothstep(0.0, 0.04, g) * (0.4 + 0.35 * exp(-g / 0.4));
      shade *= mix(vec3(1.0), vec3(0.74, 0.76, 0.79), m);
    }
    c.rgb *= mix(vec3(1.0), shade, uShadow);
  }
  // The air between the cards: farther planes take a little sky haze.
  c.rgb = mix(c.rgb, uHazeColor * c.a, uHaze);
  o = c * uOpacity;
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

// Paper where there is no card; the developed card where there is.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFilm;
uniform sampler2D uScene;
uniform vec3 uPaper;
out vec4 o;
void main() {
  float cov = texture(uScene, vUv).a;
  vec3 f = texture(uFilm, vUv).rgb;
  o = vec4(mix(uPaper, f, cov), 1.0);
}`;

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
// Past the end the hand meets resistance, like a held rubber band.
function rubber(v, lim, k = 0.35) {
  const a = Math.abs(v);
  return a <= lim ? v : Math.sign(v) * (lim + (a - lim) * k);
}

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

async function loadBitmap(src, premultiply) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: premultiply ? "premultiply" : "none" });
}

// Rotation that swings the camera: yaw about y, then pitch about x.
function rotation(yawDeg, pitchDeg) {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  // R = Rx(p) * Ry(y), column-major for GLSL
  // Ry = [cy 0 sy; 0 1 0; -sy 0 cy], Rx = [1 0 0; 0 cp -sp; 0 sp cp]
  const m = [
    [cy, 0, sy],
    [sp * sy, cp, -sp * cy],
    [-cp * sy, sp, cp * cy],
  ]; // rows
  return {
    rows: m,
    gl: new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]),
  };
}

export async function createCrossing(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qSplit = num("split");
  const held = qSplit != null;
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) if (num(key) != null) film0[key] = num(key);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "grab";

  const [photoBm, matteBm, ...planeBms] = await Promise.all([
    loadBitmap(`${ASSET}photo.webp`, false),
    loadBitmap(`${ASSET}mattes.png`, false),
    ...PLANES.map((_, k) => loadBitmap(`${ASSET}p${k}.webp`, true)),
  ]);

  // Matte pixels for picking the plane under the pointer.
  const mc = document.createElement("canvas");
  mc.width = matteBm.width;
  mc.height = matteBm.height;
  const mctx = mc.getContext("2d", { willReadFrequently: true });
  mctx.drawImage(matteBm, 0, 0);
  const mattePx = mctx.getImageData(0, 0, mc.width, mc.height).data;

  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const size = [bm.width, bm.height];
    bm.close?.();
    return { t, size };
  };
  const planeTex = planeBms.map(upload);
  const photoTex = upload(photoBm);

  const mattes = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, mattes);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, MATTE[0], MATTE[1], N, 0, gl.RED, gl.UNSIGNED_BYTE, toR8(mattePx, MATTE[0], MATTE[1] * N));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  matteBm.close?.();

  const plane = compile(gl, PLANE_VS, PLANE_FS);
  const fin = compile(gl, QUAD_VS, FINAL_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const target = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  const build = () => {
    for (const t of [sceneT, filmT]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    sceneT = target();
    filmT = target();
    film.resize(stage.canvas.width, stage.canvas.height);
    dirty = true;
  };
  stage.onResize(build);

  // ---- layout: the print at rest, and the lens that sees it 1:1
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const narrow = W < 700;
    const printW = Math.min(W * (narrow ? 0.7 : 0.6), H * (narrow ? 0.5 : 0.62) * (PHOTO[0] / PHOTO[1]));
    const printH = (printW * PHOTO[1]) / PHOTO[0];
    const f = H / 2 / Math.tan(((FOVY / 2) * Math.PI) / 180);
    return { W, H, printW, printH, f };
  };

  // ---- state
  const split = spring(held ? clamp(qSplit, 0, 1) : 0);
  const yaw = spring(held ? num("yaw") ?? 0 : 0);
  const pitch = spring(held ? num("pitch") ?? 0 : 0);
  const focusDefault = 5;
  const focusQ = num("focus");
  const focusK = { x: focusQ ?? focusDefault, to: focusQ ?? focusDefault };
  const hover = { x: 0, y: 0 };
  let grab = null;
  let touched = held;
  let born = performance.now();
  let lastKey = "";
  let lastGrain = -1;
  let breathe = 0;
  const swing = { yaw: 0, pitch: 0 }; // what is drawn, after the window's clamp

  const geometry = (s) => {
    const L = layout();
    const zs = PLANES.map((p) => L.f + s * SPREAD * p.o * L.printW);
    const pivot = L.f + s * SPREAD * PIVOT_O * L.printW;
    return { ...L, zs, pivot };
  };

  // Which plane is under the pointer (nearest first), by casting the ray back
  // through the swung camera into each plane's matte.
  const pick = (px, py) => {
    const G = geometry(split.x);
    const R = rotation(swing.yaw, swing.pitch).rows;
    const d = [px - G.W / 2, -(py - G.H / 2), -G.f];
    // inverse rotation (transpose) about the pivot
    const D = [0, 1, 2].map((i) => R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2]);
    const c = [0, 0, -G.pivot];
    const o0 = [0 - c[0], 0 - c[1], 0 - c[2]];
    const O = [0, 1, 2].map((i) => R[0][i] * o0[0] + R[1][i] * o0[1] + R[2][i] * o0[2] + c[i]);
    for (let k = N - 1; k >= 1; k--) {
      const z = -G.zs[k];
      if (Math.abs(D[2]) < 1e-6) continue;
      const t = (z - O[2]) / D[2];
      const x = O[0] + t * D[0];
      const y = O[1] + t * D[1];
      const sc = G.zs[k] / G.f;
      const u = x / (G.printW * sc) + 0.5;
      const v = 0.5 - y / (G.printH * sc);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const mx = Math.min(MATTE[0] - 1, Math.floor(u * MATTE[0]));
      const my = Math.min(MATTE[1] - 1, Math.floor(v * MATTE[1]));
      if (mattePx[((k * MATTE[1] + my) * MATTE[0] + mx) * 4] > 128) return k;
    }
    return 0;
  };

  // The largest share t of a swing (yaw, pitch) for which the mat's window,
  // seen from the swung camera, still falls inside every card's safe extent.
  // The window and each card are planar rectangles, so the four corners of
  // the window cast onto each card decide it. A defocused card's edge is soft
  // over its circle of confusion, so the margin keeps that clear too.
  const swingLimit = (G, yawDeg, pitchDeg, cocs) => {
    const zm = G.zs[MAT_K];
    const hmx = (G.printW / 2) * (zm / G.f);
    const hmy = (G.printH / 2) * (zm / G.f);
    const corners = [
      [-hmx, -hmy],
      [hmx, -hmy],
      [-hmx, hmy],
      [hmx, hmy],
    ];
    const fits = (t) => {
      const R = rotation(yawDeg * t, pitchDeg * t).rows;
      // the camera in the cards' frame: R^T (0 - c) + c, c = (0, 0, -pivot)
      const O = [R[2][0] * G.pivot, R[2][1] * G.pivot, R[2][2] * G.pivot - G.pivot];
      for (let k = 0; k < MAT_K; k++) {
        const S = SAFE[k];
        const zk = G.zs[k];
        const hx = (G.printW / 2) * (zk / G.f);
        const hy = (G.printH / 2) * (zk / G.f);
        const inset = 0.008 + cocs[k] / (stage.dpr * G.printW);
        for (const [px, py] of corners) {
          const tt = (-zk - O[2]) / (-zm - O[2]);
          const u = (O[0] + tt * (px - O[0])) / (2 * hx) + 0.5;
          const v = 0.5 - (O[1] + tt * (py - O[1])) / (2 * hy);
          if (u < S[0] + inset || v < S[1] + inset || u > S[2] - inset || v > S[3] - inset) return false;
        }
      }
      return true;
    };
    if (fits(1)) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      if (fits(m)) lo = m;
      else hi = m;
    }
    return lo;
  };

  const degPerPx = () => (2 * MAX_YAW) / Math.max(320, stage.width * 0.7);
  stage.on("down", (p) => {
    touched = true;
    grab = { x: p.x, y: p.y, s0: split.x, y0: yaw.x, p0: pitch.x };
    stage.canvas.style.cursor = "grabbing";
    requestOrientation();
  });
  stage.on("up", (p) => {
    if (!grab) return;
    grab = null;
    stage.canvas.style.cursor = "grab";
    // Let go and it closes back into one flat photograph, carrying a little
    // of the hand's speed into the swing.
    split.to = 0;
    yaw.v += p.vx * degPerPx() * 0.25;
    pitch.v -= p.vy * degPerPx() * 0.25;
    yaw.to = 0;
    pitch.to = 0;
  });

  // Phones: tilt the device and the stack opens with the tilt.
  const orient = { b: null, g: null, x: 0, y: 0, on: false };
  const onOrient = (e) => {
    if (e.beta == null) return;
    if (orient.b == null) {
      orient.b = e.beta;
      orient.g = e.gamma;
    }
    orient.x = damp(orient.x, clamp((e.gamma - orient.g) / 18, -1, 1), 8, 1 / 60);
    orient.y = damp(orient.y, clamp((e.beta - orient.b) / 18, -1, 1), 8, 1 / 60);
  };
  function requestOrientation() {
    if (orient.on || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orient.on = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  const drawScene = (s, yawDeg, pitchDeg, focusZ) => {
    const G = geometry(s);
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    const dpr = stage.dpr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(SURROUND[0], SURROUND[1], SURROUND[2], 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(plane.p);
    gl.bindVertexArray(vao);
    const U = plane.u;
    gl.uniformMatrix3fv(U.uRot, false, rotation(yawDeg, pitchDeg).gl);
    gl.uniform1f(U.uPivot, G.pivot);
    gl.uniform2f(U.uProj, G.f / (G.W / 2), G.f / (G.H / 2));
    gl.uniform2f(U.uShift, 0, 0);
    gl.uniform1fv(U.uZ, new Float32Array(G.zs));
    const halves = new Float32Array(N * 2);
    G.zs.forEach((z, k) => {
      halves[k * 2] = (G.printW / 2) * (z / G.f);
      halves[k * 2 + 1] = (G.printH / 2) * (z / G.f);
    });
    gl.uniform2fv(U.uHalf, halves);
    gl.uniform3f(U.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(U.uPrintW, G.printW);
    gl.uniform3f(U.uHazeColor, HAZE[0], HAZE[1], HAZE[2]);
    gl.uniform1i(U.uMat, 0);
    gl.uniform3f(U.uPaper, SURROUND[0], SURROUND[1], SURROUND[2]);
    gl.uniform1f(U.uMatZ, G.zs[MAT_K]);
    gl.uniform2f(U.uMatHalf, halves[MAT_K * 2], halves[MAT_K * 2 + 1]);
    gl.uniform1i(U.uTex, 0);
    gl.uniform1i(U.uMattes, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, mattes);
    gl.activeTexture(gl.TEXTURE0);
    const opened = clamp(s / 0.05, 0, 1);
    const shadow = (num("shadow") ?? 1.0) * Math.min(1, s * 1.6);
    const frontZ = G.zs[N - 1];
    for (let k = 0; k < N; k++) {
      if (opened <= 0) break; // flat: the photograph alone
      const P = PLANES[k];
      const z = G.zs[k];
      const coc = APERTURE * s * (Math.abs(z - focusZ) / z) * dpr;
      // the quad grows by the blur so a defocused edge is not cut
      const m = coc / dpr / G.printW;
      const r = P.rect;
      gl.uniform4f(U.uRect, r[0] - m, r[1] - m * 1.5, r[2] + m, r[3] + m * 1.5);
      gl.uniform4f(U.uCrop, r[0], r[1], r[2], r[3]);
      gl.uniform2f(U.uTexSize, planeTex[k].size[0], planeTex[k].size[1]);
      gl.uniform3f(U.uPlane, halves[k * 2], halves[k * 2 + 1], z);
      gl.uniform1f(U.uCoc, coc);
      gl.uniform1i(U.uK, k);
      gl.uniform1f(U.uShadow, shadow);
      gl.uniform1f(U.uHaze, clamp(((z - frontZ) / G.printW) * 0.09 * s, 0, 0.14));
      gl.uniform1f(U.uOpacity, 1);
      gl.bindTexture(gl.TEXTURE_2D, planeTex[k].t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // At rest the photograph itself lies on top, so flat is exact; it gives
    // way to the planes in the first few percent of the split.
    if (opened < 1) {
      gl.uniform4f(U.uRect, 0, 0, 1, 1);
      gl.uniform4f(U.uCrop, 0, 0, 1, 1);
      gl.uniform2f(U.uTexSize, photoTex.size[0], photoTex.size[1]);
      gl.uniform3f(U.uPlane, (G.printW / 2) * (G.pivot / G.f), (G.printH / 2) * (G.pivot / G.f), G.pivot);
      gl.uniform1f(U.uCoc, 0);
      gl.uniform1i(U.uK, N - 1);
      gl.uniform1f(U.uShadow, 0);
      gl.uniform1f(U.uHaze, 0);
      gl.uniform1f(U.uOpacity, 1 - opened);
      gl.bindTexture(gl.TEXTURE_2D, photoTex.t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // The front mat: a sheet of the page's own paper with the photo's
    // rectangle cut out of it, at the nearest card's depth. It only takes
    // coverage away, so the page shows through it untouched (FINAL_FS). The
    // colour round the window is left as the overscanned cards drew it, so
    // the film's bloom and halation see the sky carry on past the cut, as a
    // lens would: no paper or grey veil creeping in to desaturate the edges.
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(U.uMat, 1);
    gl.uniform4f(U.uRect, MAT_RECT[0], MAT_RECT[1], MAT_RECT[2], MAT_RECT[3]);
    gl.uniform3f(U.uPlane, halves[MAT_K * 2], halves[MAT_K * 2 + 1], G.zs[MAT_K]);
    gl.uniform1f(U.uOpacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1i(U.uMat, 0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  const present = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(fin.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(fin.u.uFilm, 0);
    gl.uniform1i(fin.u.uScene, 1);
    gl.uniform3f(fin.u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  const frame = (dt, t) => {
    if (!sceneT) return;
    const now = performance.now();
    const p = stage.pointer;
    const age = (now - born) / 1000;
    const L = layout();

    // Intro: the print develops out of an overexposed white-blue, then
    // parts a little and closes, to show it can.
    if (!touched && !reduced && !held) {
      const hint = age > 1.5 && age < 2.7;
      split.to = hint ? 0.34 : 0;
      yaw.to = hint ? 9 : 0;
      pitch.to = hint ? -3 : 0;
      if (age > 3.5) touched = true;
    }
    const expT = reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.0, 0, 1));
    const exposure = film0.exposure + (held ? 0 : 2.4 * (1 - expT));

    if (grab) {
      const dx = p.x - grab.x;
      const dy = p.y - grab.y;
      const dist = Math.hypot(dx, dy);
      split.to = clamp(grab.s0 + (1 - grab.s0) * (1 - Math.exp(-dist / (L.printW * 0.32))), 0, 1);
      yaw.to = rubber(grab.y0 + dx * degPerPx(), MAX_YAW);
      pitch.to = rubber(grab.p0 - dy * degPerPx(), MAX_PITCH);
      stepSpring(split, 26, 1, dt);
      stepSpring(yaw, 26, 1, dt);
      stepSpring(pitch, 26, 1, dt);
    } else if (!held) {
      if (orient.on && orient.b != null) {
        const m = Math.hypot(orient.x, orient.y);
        split.to = clamp(m * 1.2, 0, 1);
        yaw.to = orient.x * MAX_YAW;
        pitch.to = -orient.y * MAX_PITCH;
      }
      stepSpring(split, 9, 0.86, dt);
      stepSpring(yaw, 9, 0.86, dt);
      stepSpring(pitch, 9, 0.86, dt);
      split.x = Math.max(0, split.x);
    }

    // Hover: the flat print leans a degree toward the pointer.
    const live = !grab && p.inside && !reduced && !held;
    hover.x = damp(hover.x, live ? (p.x / L.W - 0.5) * 3 : 0, 1 / 0.35, dt);
    hover.y = damp(hover.y, live ? -(p.y / L.H - 0.5) * 2 : 0, 1 / 0.35, dt);
    const idle = !grab && stage.idleFor() > 1500 && touched && !held && !reduced;
    breathe = damp(breathe, idle ? 1 : 0, 0.8, dt);
    const by = breathe * 0.4 * Math.sin((t * 2 * Math.PI) / 12.1);
    const bp = breathe * 0.3 * Math.sin((t * 2 * Math.PI) / 9.7 + 1.1);

    // Focus follows the plane under the pointer (or the signal).
    if (!held && (grab || p.inside) && split.x > 0.04) focusK.to = pick(p.x, p.y);
    else if (!held && split.x < 0.02) focusK.to = focusDefault;
    focusK.x = damp(focusK.x, focusK.to, 1 / 0.28, dt);
    const s = clamp(split.x, 0, 1.08);
    const G = geometry(s);
    const fk = focusK.x;
    const k0 = Math.floor(clamp(fk, 0, N - 1));
    const k1 = Math.min(N - 1, k0 + 1);
    const focusZ = G.zs[k0] + (G.zs[k1] - G.zs[k0]) * (fk - k0);

    let yawDeg = yaw.x + hover.x + by;
    let pitchDeg = pitch.x + hover.y + bp;
    // The window: the swing stops where a card's overscan runs out, so no
    // card edge ever comes into it. A hand that pushes further is held at
    // the edge, as by the mat itself.
    const cocs = G.zs.map((z) => APERTURE * s * (Math.abs(z - focusZ) / z) * stage.dpr);
    const lim = swingLimit(G, yawDeg, pitchDeg, cocs);
    if (lim < 1) {
      yawDeg *= lim;
      pitchDeg *= lim;
      if (!held) {
        yaw.x = yawDeg - hover.x - by;
        pitch.x = pitchDeg - hover.y - bp;
        yaw.v = 0;
        pitch.v = 0;
      }
    }
    swing.yaw = yawDeg;
    swing.pitch = pitchDeg;
    const key = `${s.toFixed(5)}|${yawDeg.toFixed(4)}|${pitchDeg.toFixed(4)}|${focusZ.toFixed(2)}`;
    if (key !== lastKey || dirty) {
      drawScene(s, yawDeg, pitchDeg, focusZ);
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // Film at 24 fps: the grain moves at the rate film did.
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || exposure > 1e-3) {
      film.render(sceneT.tex, { ...film0, exposure, grainSeed: tick * 7.31 }, filmT.fbo);
      present();
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!sceneT) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      for (const t of [sceneT, filmT]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const t of planeTex) gl.deleteTexture(t.t);
      gl.deleteTexture(photoTex.t);
      gl.deleteTexture(mattes);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(plane.p);
      gl.deleteProgram(fin.p);
      stage.destroy();
    },
  };
}

function toR8(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = rgba[i * 4];
  return out;
}
