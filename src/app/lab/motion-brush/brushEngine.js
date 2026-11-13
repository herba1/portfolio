import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createField, GW, GH } from "./field";
import { WIRE_Y, WIRE_VIS } from "./wires";

// Motion brush: a still photograph (a cumulus tower over Hirano, Osaka, cut
// by a fan of power lines) that moves only where you paint it.
//
// After Holynski et al., "Animating Pictures with Eulerian Motion Fields"
// (CVPR 2021): the motion is one static velocity field M(x). A frame at loop
// time t gathers the photograph through the flow integrated backward for t
// (where each pixel came from) and through the flow integrated forward for
// N - t (where it will be one loop later), and blends the two with weight
// t / N. Both ends of the loop are the photograph itself, so the loop never
// resets, and because each branch follows the streamlines (RK2, not a
// straight offset) a curved stroke carries the cloud round the curve instead
// of smearing it. The two branches are blended with a variance-preserving
// operator (Neyret 2003; Heitz & Neyret 2018) about a shared low-pass mean,
// so the moving cloud keeps its grain instead of going soft mid-loop. The
// blend is occlusion-aware: a branch whose source lies in the other layer
// (cloud vs sky, baked into layers.png b), or that stalled, loses its weight,
// and where the branches disagree the blend narrows to one of them, so a
// diverging flow never leaves a double exposure. Open sky and the band along
// the cloud's silhouette are held still, so the outline (and the dark pockets
// of sky inside it) stays put while the cloud's texture drifts.
//
// The photograph is taken apart offline: the 26 wires are found as tracked
// centrelines, matted (I = P + (1 - a) B, P their premultiplied colour, B the
// sky painted in behind them along each strip), and the buildings are cut
// from a Depth Anything V2 map snapped to the photo with a guided filter. A
// stroke on the sky moves the sky layer only, so the cloud slides behind
// wires that stay put. A stroke drawn along a wire (or flicked off one) makes
// that wire sway instead: an oscillation in its own frequency, periodic, so
// it loops without any blend. Buildings never move.
//
// Query: ?strokes=demo|none, ?t=seconds since the demo was painted (holds the
// clock), ?trace=0..1 holds the demo's brush trace drawn to that fraction,
// ?wire=0..25 sets that wire swaying.

const BASE = "/lab/motion-brush/";
const PW = 1536;
const PH = 2048;
const LOOP = 6; // seconds: one Eulerian loop
const WIRE_LOOP = 12; // seconds: wires sway at 4, 5 or 6 cycles per this
const VMAX = 0.02 * PW; // plate px/s for the fastest stroke
const S0 = 520; // css px/s of pointer speed for 63% of VMAX
const AMAX = 9; // plate px of wire sway for a fast stroke
const K = WIRE_Y.length;
const NS = WIRE_Y[0].length;
const VIEW = [0.022, 0.022, 0.956, 0.956];

// The pre-painted stroke: a slow drift right and a little up along the lean
// of the tower, through the wires. Plate uv and seconds.
const DEMO = [
  [0.2, 0.67, 0.0],
  [0.27, 0.645, 0.16],
  [0.34, 0.622, 0.33],
  [0.41, 0.603, 0.5],
  [0.48, 0.585, 0.68],
  [0.55, 0.569, 0.86],
  [0.62, 0.556, 1.05],
  [0.68, 0.546, 1.22],
];
const DEMO_SPEED = 330; // css px/s equivalent

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;   // sky layer: wires painted out, roofs filled
uniform sampler2D uLow;     // the same, Gaussian sigma 12 px
uniform sampler2D uPhoto;   // the photograph
uniform sampler2D uWire;    // premultiplied wire colour P
uniform sampler2D uLayers;  // r wire alpha, g building alpha, b cloud (vs sky)
uniform sampler2D uField;   // vx, vy (plate px/s), cos, sin of paint phase
uniform sampler2D uWGeo;    // ${NS} x ${K}: r wire centre y / PH
uniform sampler2D uWAmp;    // ${NS} x ${K}: r sway amplitude px, g phase
uniform vec4 uView;
uniform float uTime;
uniform float uWTime;
uniform float uEnv;
uniform float uExpo;
uniform float uSway;        // 0 while no wire is swaying

const vec2 PLATE = vec2(${PW}.0, ${PH}.0);
const float N = ${LOOP}.0;
const float TAU = 6.2831853;

vec2 vel(vec2 q) {
  return texture(uField, q / PLATE).rg * uEnv;
}
vec3 dec(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = (uView.xy + uv * uView.zw) * PLATE;
  vec2 pu = p / PLATE;

  // --- sky: two branches of the Eulerian flow, symmetric about the photo ---
  vec3 sky;
  // the plate's mip level, taken here in uniform control flow: inside the
  // branch below, neighbouring pixels can take the other path, and implicit
  // derivatives there pick a blurred mip along the seam
  vec2 dp = max(abs(dFdx(p)), abs(dFdy(p)));
  float lod = max(0.0, log2(max(dp.x, dp.y)));
  vec4 f = texture(uField, pu);
  if (dot(f.rg, f.rg) * uEnv * uEnv < 1e-4) {
    sky = texture(uPlate, pu).rgb;
  } else {
    float ph = atan(f.a, f.b) / TAU;
    float tau = fract(uTime / N - ph) * N;
    const int STEPS = 8;
    vec2 q1 = p;
    float h1 = tau / float(STEPS);
    vec2 q2 = p;
    float h2 = (N - tau) / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      vec2 k1 = vel(q1);
      q1 -= h1 * vel(q1 - 0.5 * h1 * k1);
      vec2 k2 = vel(q2);
      q2 += h2 * vel(q2 + 0.5 * h2 * k2);
    }
    // a smoothstep in place of Holynski's linear t/N: each branch hands over
    // sooner near its own end, where it has drifted furthest from the other
    float w = smoothstep(0.18, 0.86, tau / N);
    vec2 u1 = q1 / PLATE, u2 = q2 / PLATE;
    vec3 a = textureLod(uPlate, u1, lod).rgb, b = textureLod(uPlate, u2, lod).rgb;
    vec3 ma = textureLod(uLow, u1, 0.0).rgb, mb = textureLod(uLow, u2, 0.0).rgb;
    vec3 sp = textureLod(uPlate, pu, lod).rgb;

    // --- occlusion-aware blend ---
    // A plain symmetric blend averages two warped copies, and where the flow
    // diverges (a stroke's flank, the cloud/sky edge) those copies hold
    // different things, so the result is a double exposure: a milky ghost of
    // cloud over a dark pocket of sky. Instead each branch is weighted by how
    // far it can be trusted at this pixel:
    //  - layer: its source pixel must lie in the same layer (sky or cloud,
    //    layers.b) as this pixel in the photograph, so a silhouette is never
    //    carried across another layer;
    //  - stall: it must have travelled about as far as the flow here says, or
    //    it has run into the still band at a layer edge and is smearing.
    // Where the two branches disagree (their luma, or the field's divergence),
    // the blend narrows towards whichever branch is trusted, so the pixel is
    // one sample, never two halves. Where neither is, the photograph holds.
    // At either end of the loop the arriving branch sits on the pixel itself
    // and has full trust, so the loop still starts and ends on the photograph.
    float cp = textureLod(uLayers, pu, 2.0).b;
    float ka = 1.0 - smoothstep(0.2, 0.6, abs(textureLod(uLayers, u1, 2.0).b - cp));
    float kb = 1.0 - smoothstep(0.2, 0.6, abs(textureLod(uLayers, u2, 2.0).b - cp));
    float sv = length(vel(p));
    ka *= smoothstep(0.25, 0.6, (length(q1 - p) + 6.0) / (tau * sv + 6.0));
    kb *= smoothstep(0.25, 0.6, (length(q2 - p) + 6.0) / ((N - tau) * sv + 6.0));
    // divergence of the field (1/s) times the loop: the fraction by which a
    // patch grows or shrinks over one loop
    vec2 e = 1.0 / vec2(${GW}.0, ${GH}.0);
    float div = (texture(uField, pu + vec2(e.x, 0.0)).r - texture(uField, pu - vec2(e.x, 0.0)).r) / (2.0 * PLATE.x * e.x)
              + (texture(uField, pu + vec2(0.0, e.y)).g - texture(uField, pu - vec2(0.0, e.y)).g) / (2.0 * PLATE.y * e.y);
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    float dis = max(abs(dot(ma - mb, LW)), 0.6 * abs(dot(a - b, LW)));
    float conflict = max(smoothstep(0.02, 0.07, dis), smoothstep(0.3, 0.9, abs(div) * uEnv * N));
    float wa0 = (1.0 - w) * ka, wb0 = w * kb;
    float wb = wb0 / max(wa0 + wb0, 1e-4);
    if (wa0 + wb0 < 1e-4) wb = w;
    wb = mix(wb, smoothstep(0.3, 0.7, wb), conflict);
    // Variance-preserving blend about the low-pass mean: the detail of two
    // decorrelated samples, averaged, loses contrast by sqrt(w^2+(1-w)^2);
    // give it back, in proportion to how decorrelated they are.
    float dc = smoothstep(2.0, 30.0, length(q1 - q2));
    float g = mix(1.0, inversesqrt(wb * wb + (1.0 - wb) * (1.0 - wb)), dc);
    sky = mix(ma, mb, wb) + ((1.0 - wb) * (a - ma) + wb * (b - mb)) * g;
    // neither branch trusted: the photograph stays put
    float hold = (1.0 - ka) * (1.0 - kb);
    sky = mix(sky, sp, hold);
  }

  // --- wires: each sways on its own, periodic in the loop ---
  vec3 col = sky;
  float u = pu.x;
  float su = clamp(u, 0.0, 1.0) * ${NS - 1}.0;
  float tx = (su + 0.5) / ${NS}.0;
  float aw = 0.0;
  vec3 P = vec3(0.0);
  if (uSway < 0.5) {
    aw = texture(uLayers, pu).r;
    P = texture(uWire, pu).rgb;
  } else {
    vec2 disp = vec2(0.0);
    float ws = 0.0;
    for (int k = 0; k < ${K}; k++) {
      float ty = (float(k) + 0.5) / ${K}.0;
      float yk = texture(uWGeo, vec2(tx, ty)).r * PLATE.y;
      float d = p.y - yk;
      if (abs(d) > 46.0) continue;
      vec2 am = texture(uWAmp, vec2(tx, ty)).rg;
      if (am.r < 0.02) { ws += exp(-d * d / 200.0); continue; }
      float yk2 = texture(uWGeo, vec2(tx + 1.0 / ${NS}.0, ty)).r * PLATE.y;
      float sl = (yk2 - yk) / (PLATE.x / ${NS - 1}.0);
      vec2 n = normalize(vec2(-sl, 1.0));
      float fr = 4.0 + mod(float(k), 3.0);
      float om = TAU * fr / ${WIRE_LOOP}.0;
      float s = sin(om * uWTime + am.g - u * 5.0) + 0.28 * sin(2.0 * om * uWTime + 1.7 * am.g - u * 9.0);
      float wk = exp(-d * d / 200.0);
      disp += n * am.r * s * wk;
      ws += wk;
    }
    disp /= max(ws, 1e-3);
    vec2 q = (p - disp) / PLATE;
    aw = texture(uLayers, q).r;
    P = texture(uWire, q).rgb;
  }
  col = P + (1.0 - aw) * col;

  // --- buildings: never move ---
  float ab = texture(uLayers, pu).g;
  col = mix(col, texture(uPhoto, pu).rgb, ab);

  outColor = vec4(dec(col) * uExpo, 1.0);
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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

function imageTexture(gl, img, { mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function floatTexture(gl, w, h, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, ok };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// Wire centreline at plate x (px), in plate px.
function wireY(k, x) {
  const s = clamp(x / PW, 0, 1) * (NS - 1);
  const i = Math.min(NS - 2, Math.floor(s));
  const f = s - i;
  return (WIRE_Y[k][i] * (1 - f) + WIRE_Y[k][i + 1] * f) * PH;
}
function wireVisible(k, x) {
  const i = Math.round(clamp(x / PW, 0, 1) * (NS - 1));
  return WIRE_VIS[k][i] === "1";
}

// Where the field is held still, on its grid: open sky, and the band where a
// cell straddles the cloud/sky silhouette (layers.b), with half that one cell
// out. Only cloud moves, inside its own outline; a dark pocket of sky stays
// put, so it is never carried across, or under, the cloud beside it.
function edgeBand(layers) {
  const S = 4; // samples per cell side
  const c = document.createElement("canvas");
  c.width = GW * S;
  c.height = GH * S;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(layers, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const edge = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      let lo = 255;
      let hi = 0;
      let sum = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const v = d[((gy * S + j) * c.width + gx * S + i) * 4 + 2];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          sum += v;
        }
      const t = clamp((hi - lo) / 255 / 0.5 - 0.4, 0, 1);
      const sky = 1 - easeInOut((sum / (S * S * 255) - 0.3) / 0.4);
      edge[gy * GW + gx] = Math.max(t * t * (3 - 2 * t), sky);
    }
  const band = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      let m = edge[gy * GW + gx];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          m = Math.max(m, 0.5 * edge[ny * GW + nx]);
        }
      band[gy * GW + gx] = m;
    }
  return band;
}

export async function createMotionBrush(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const tQ = num("t");
  const traceQ = num("trace");
  const strokesQ = q.get("strokes");
  const wireQ = num("wire");
  const frozen = tQ != null;
  const still = frozen || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  // the brush trace: a 2D canvas over the print
  const trace = document.createElement("canvas");
  trace.className = "mb-trace";
  host.appendChild(trace);
  const tctx = trace.getContext("2d");

  const names = ["plate.webp", "low.webp", "photo.webp", "wire.png", "layers.png", "guide.png"];
  const imgs = await Promise.all(names.map((n) => loadImage(BASE + n)));
  const tex = {
    plate: imageTexture(gl, imgs[0]),
    low: imageTexture(gl, imgs[1], { mips: false }),
    photo: imageTexture(gl, imgs[2]),
    wire: imageTexture(gl, imgs[3]),
    layers: imageTexture(gl, imgs[4]),
  };
  const gc = document.createElement("canvas");
  gc.width = GW;
  gc.height = GH;
  const g2 = gc.getContext("2d", { willReadFrequently: true });
  g2.drawImage(imgs[5], 0, 0);
  const field = createField(g2.getImageData(0, 0, GW, GH).data, PW, PH, LOOP, edgeBand(imgs[4]));

  tex.field = floatTexture(gl, GW, GH, new Float32Array(GW * GH * 4));
  const geo = new Float32Array(NS * K * 4);
  for (let k = 0; k < K; k++) for (let i = 0; i < NS; i++) geo[(k * NS + i) * 4] = WIRE_Y[k][i];
  tex.wgeo = floatTexture(gl, NS, K, geo);
  const amp = new Float32Array(NS * K * 4);
  tex.wamp = floatTexture(gl, NS, K, amp);
  // the field texture holds velocities in px/s and phases; the geometry wants
  // full precision at 1/4000 of the plate
  gl.bindTexture(gl.TEXTURE_2D, tex.wgeo);
  if (gl.getExtension("OES_texture_float_linear")) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, NS, K, 0, gl.RGBA, gl.FLOAT, geo);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout: a 3:4 print on the paper ---
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    const aspect = 0.75;
    if (embedded) {
      // fill the tile, cropped to its shape, centred a little low on the cloud
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      const side = W < 600 ? Math.max(16, Math.round(W * 0.06)) : Math.max(24, W * 0.07);
      let h = H * (W < 600 ? 0.74 : 0.8);
      let w = h * aspect;
      if (w > W - side * 2) {
        w = W - side * 2;
        h = w / aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - (W < 600 ? 8 : 4) });
    }
    // view inside the plate
    const a = L.w / L.h;
    let vw = VIEW[2];
    let vh = (vw * (PW / PH)) / a;
    if (vh > VIEW[3]) {
      vh = VIEW[3];
      vw = (vh * a) / (PW / PH);
    }
    L.view = [0.5 - vw / 2, clamp(0.56 - vh / 2, VIEW[1], 1 - VIEW[1] - vh), vw, vh];
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
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
    trace.width = Math.round(W * dpr);
    trace.height = Math.round(H * dpr);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const toPlate = (x, y) => [
    (L.view[0] + ((x - L.x) / L.w) * L.view[2]) * PW,
    (L.view[1] + ((y - L.y) / L.h) * L.view[3]) * PH,
  ];
  const toBox = (px, py) => [L.x + ((px / PW - L.view[0]) / L.view[2]) * L.w, L.y + ((py / PH - L.view[1]) / L.view[3]) * L.h];
  const cssPerPlate = () => L.w / (L.view[2] * PW);
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;

  // --- state ---
  let clock = tQ != null ? tQ : 0; // the loop clock, s
  let wclock = clock; // the wires' clock
  const strokes = []; // { kind, samples, field, born, env, fading }
  const wireStrokes = []; // { k, x0, x1, amp, env, born }
  let fieldDirty = false;
  let ampDirty = false;
  let clearing = null; // clock time a clear began

  // speed (css px/s) -> image velocity (plate px/s)
  const toVel = (dx, dy, speed) => {
    const l = Math.hypot(dx, dy) || 1;
    const v = VMAX * (1 - Math.exp(-speed / S0));
    return [(dx / l) * v, (dy / l) * v];
  };

  // nearest wire to a plate point: [k, perpendicular distance in plate px]
  const nearestWire = (px, py) => {
    let best = -1;
    let bd = 1e9;
    for (let k = 0; k < K; k++) {
      if (!wireVisible(k, px)) continue;
      const y = wireY(k, px);
      const sl = (wireY(k, px + 8) - wireY(k, px - 8)) / 16;
      const d = Math.abs(py - y) / Math.sqrt(1 + sl * sl);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return [best, bd];
  };

  // A stroke in the making: raw pointer points (plate px, clock s), resampled
  // to samples every ~0.6 cell with a smoothed velocity.
  const SPACING = (PW / GW) * 0.6;
  const addPoint = (st, px, py, t) => {
    const pts = st.pts;
    const last = pts[pts.length - 1];
    pts.push({ x: px, y: py, t });
    if (!last) return;
    // velocity over the last ~90 ms of pointer travel
    let j = pts.length - 1;
    while (j > 0 && t - pts[j - 1].t < 0.09) j--;
    const a = pts[Math.max(0, j - 1)];
    const dt = Math.max(1e-3, t - a.t);
    const dxp = px - a.x;
    const dyp = py - a.y;
    const speed = (Math.hypot(dxp, dyp) * cssPerPlate()) / dt;
    st.speed = st.speed == null ? speed : st.speed + (speed - st.speed) * 0.35;
    const [vx, vy] = toVel(dxp, dyp, st.speed);
    st.vx = st.vx == null ? vx : st.vx + (vx - st.vx) * 0.4;
    st.vy = st.vy == null ? vy : st.vy + (vy - st.vy) * 0.4;
    // lay samples along the segment
    let ax = st.lastSample ? st.lastSample.x : last.x;
    let ay = st.lastSample ? st.lastSample.y : last.y;
    let d = Math.hypot(px - ax, py - ay);
    while (d >= SPACING) {
      ax += ((px - ax) / d) * SPACING;
      ay += ((py - ay) / d) * SPACING;
      const s = { x: ax, y: ay, vx: st.vx, vy: st.vy, t };
      st.samples.push(s);
      st.lastSample = s;
      d = Math.hypot(px - ax, py - ay);
    }
  };

  // Which material did this stroke paint? Wire if it runs along one wire, or
  // is a quick short flick off one; sky otherwise.
  const classify = (st) => {
    const pts = st.pts;
    if (pts.length < 2) return { kind: "none" };
    const tol = 7 / cssPerPlate();
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const lenCss = len * cssPerPlate();
    const dur = pts[pts.length - 1].t - pts[0].t;
    const [k0, d0] = nearestWire(pts[0].x, pts[0].y);
    // along a wire
    const hits = new Map();
    for (const p of pts) {
      const [k, d] = nearestWire(p.x, p.y);
      if (k >= 0 && d < tol) hits.set(k, (hits.get(k) || 0) + 1);
    }
    let bestK = -1;
    let bestN = 0;
    hits.forEach((n, k) => {
      if (n > bestN) {
        bestN = n;
        bestK = k;
      }
    });
    if (bestK >= 0 && bestN >= pts.length * 0.7 && lenCss > 30) {
      const xs = pts.map((p) => p.x);
      return { kind: "wire", k: bestK, x0: Math.min(...xs), x1: Math.max(...xs), speed: (lenCss / Math.max(dur, 0.05)) * 0.8 };
    }
    if (k0 >= 0 && d0 < tol && lenCss < 90 && dur < 0.4) {
      return { kind: "wire", k: k0, x0: pts[0].x - 30, x1: pts[0].x + 30, speed: lenCss / Math.max(dur, 0.05) };
    }
    return { kind: "sky" };
  };

  const commitWire = (c, born) => {
    wireStrokes.push({ k: c.k, x0: c.x0, x1: c.x1, amp: AMAX * (1 - Math.exp(-c.speed / S0)), born, env: 0 });
    ampDirty = true;
  };

  const solveLive = (st) => {
    st.field = field.solveStroke(st.samples);
    fieldDirty = true;
  };

  const beginStroke = (px, py, t) => {
    const st = { kind: "sky", pts: [], samples: [], field: null, born: t, env: 0, solvedAt: -1 };
    addPoint(st, px, py, t);
    strokes.push(st);
    return st;
  };
  const endStroke = (st, t) => {
    const c = classify(st);
    if (c.kind === "wire") {
      strokes.splice(strokes.indexOf(st), 1);
      commitWire(c, t);
      fieldDirty = true;
    } else if (c.kind === "none" || st.samples.length === 0) {
      strokes.splice(strokes.indexOf(st), 1);
      fieldDirty = true;
    } else solveLive(st);
  };

  // --- the brush trace (css px of the box) ---
  const tracePts = []; // { x, y, born }
  let traceEnd = -1; // performance time the stroke ended
  let traceShown = false;
  const drawTrace = (now, frac = 1, held = false) => {
    const dpr = stage.dpr;
    if (traceShown) {
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, trace.width, trace.height);
      traceShown = false;
    }
    if (tracePts.length < 2) return false;
    traceShown = true;
    const n = Math.max(2, Math.round(tracePts.length * frac));
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.lineCap = "butt";
    tctx.lineJoin = "round";
    tctx.lineWidth = 2;
    tctx.shadowColor = "rgba(255, 252, 246, 0.5)";
    tctx.shadowBlur = 4 * dpr;
    let alive = false;
    for (let i = 1; i < n; i++) {
      const a = tracePts[i - 1];
      const b = tracePts[i];
      // each bit of the trace fades on its own after it is laid (a held still
      // fades it along its length instead), and all of it once the hand lifts
      const age = held ? (n - i) * 0.035 : (now - b.born) / 1000;
      let o = 0.34 * Math.exp(-age / 0.8);
      if (traceEnd > 0) o *= Math.exp(-((now - traceEnd) / 1000) / 0.35);
      if (o < 0.004) continue;
      alive = true;
      tctx.strokeStyle = `rgba(255, 252, 246, ${o.toFixed(3)})`;
      tctx.beginPath();
      tctx.moveTo(a.x, a.y);
      tctx.lineTo(b.x, b.y);
      tctx.stroke();
    }
    return alive;
  };

  // --- input ---
  let press = null; // { x, y, t0, moved, timer }
  const LONG = 560;
  const clearAll = () => {
    if (!strokes.length && !wireStrokes.length) return;
    clearing = clock;
    dirty = true;
  };
  stage.on("down", (p) => {
    if (!inPrint(p) || frozen) return;
    if (demo && !demo.done) {
      demo.done = true; // the viewer takes over; keep what it painted
      if (demo.st) endStroke(demo.st, clock);
    }
    const [px, py] = toPlate(p.x, p.y);
    press = { x: p.x, y: p.y, t0: performance.now(), moved: false, st: null, px, py };
    press.timer = setTimeout(() => {
      if (press && !press.moved) {
        clearAll();
        press = null;
      }
    }, LONG);
  });
  stage.on("move", (p) => {
    if (!press) return;
    const now = performance.now();
    if (!press.moved) {
      if (Math.hypot(p.x - press.x, p.y - press.y) < 5) return;
      press.moved = true;
      clearTimeout(press.timer);
      if (clearing != null) return;
      press.st = beginStroke(press.px, press.py, clock);
      tracePts.length = 0;
      traceEnd = -1;
      tracePts.push({ x: press.x, y: press.y, born: now });
    }
    if (!press.st) return;
    const x = clamp(p.x, L.x, L.x + L.w);
    const y = clamp(p.y, L.y, L.y + L.h);
    const [px, py] = toPlate(x, y);
    addPoint(press.st, px, py, clock);
    tracePts.push({ x, y, born: now });
    if (now - (press.st.solvedAt || 0) > 70) {
      press.st.solvedAt = now;
      solveLive(press.st);
    }
  });
  stage.on("up", () => {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.st) {
      endStroke(press.st, clock);
      traceEnd = performance.now();
    }
    press = null;
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      clearAll();
    }
  };
  host.addEventListener("keydown", onKey);

  // --- the pre-painted stroke ---
  let demo = null;
  const demoSamples = (upTo) => {
    // walk the polyline as if drawn at DEMO_SPEED, to time upTo (s)
    const st = { kind: "sky", pts: [], samples: [], field: null, born: 0, env: 0 };
    for (let i = 0; i < DEMO.length; i++) {
      const [u, v, t] = DEMO[i];
      if (t > upTo) {
        if (i > 0) {
          const [u0, v0, t0] = DEMO[i - 1];
          const f = (upTo - t0) / (t - t0);
          st.pts.push({ x: (u0 + (u - u0) * f) * PW, y: (v0 + (v - v0) * f) * PH, t: upTo });
        }
        break;
      }
      st.pts.push({ x: u * PW, y: v * PH, t });
    }
    // samples with the demo's speed
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1];
      const b = st.pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.round(d / SPACING));
      const [vx, vy] = toVel(b.x - a.x, b.y - a.y, DEMO_SPEED);
      for (let j = 0; j < n; j++) {
        const f = j / n;
        st.samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, vx, vy, t: a.t + (b.t - a.t) * f });
      }
    }
    return st;
  };
  const showDemo = strokesQ !== "none" && !(reduce && !still);
  if (showDemo) {
    if (frozen || strokesQ === "demo" || still) {
      // painted at time 0, the clock held at ?t
      const st = demoSamples(99);
      st.field = field.solveStroke(st.samples);
      st.env = 1;
      st.born = -10;
      strokes.push(st);
      fieldDirty = true;
      if (traceQ != null) {
        for (const p of st.samples) {
          const [x, y] = toBox(p.x, p.y);
          tracePts.push({ x, y, born: 0 });
        }
      }
    } else demo = { start: 1.1, st: null, done: false };
  }
  if (wireQ != null && wireQ >= 0 && wireQ < K) {
    wireStrokes.push({ k: wireQ | 0, x0: PW * 0.35, x1: PW * 0.65, amp: AMAX, born: -10, env: 1 });
    ampDirty = true;
  }

  // --- drawing ---
  const uploadField = () => {
    const data = field.compose(strokes);
    gl.bindTexture(gl.TEXTURE_2D, tex.field);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RGBA, gl.FLOAT, data);
  };
  const uploadAmp = (envAll) => {
    amp.fill(0);
    for (const w of wireStrokes) {
      const a = w.amp * w.env * envAll;
      if (a <= 0) continue;
      const R = PW * 0.16;
      for (let k = 0; k < K; k++) {
        // neighbours in the bundle catch a little of it
        const dy = Math.abs(wireY(k, (w.x0 + w.x1) / 2) - wireY(w.k, (w.x0 + w.x1) / 2));
        const share = k === w.k ? 1 : Math.exp(-(dy * dy) / (2 * 34 * 34)) * 0.55;
        if (share < 0.02) continue;
        for (let i = 0; i < NS; i++) {
          const x = (i / (NS - 1)) * PW;
          const g = x < w.x0 ? (w.x0 - x) / R : x > w.x1 ? (x - w.x1) / R : 0;
          const o = (k * NS + i) * 4;
          amp[o] += a * share * Math.exp(-g * g);
          amp[o + 1] = (k * 2.39996) % 6.2832; // golden-angle phases, so no two wires swing together
        }
      }
    }
    for (let i = 0; i < NS * K; i++) amp[i * 4] = Math.min(amp[i * 4], AMAX * 1.4);
    gl.bindTexture(gl.TEXTURE_2D, tex.wamp);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NS, K, gl.RGBA, gl.FLOAT, amp);
  };

  let envAll = 1;
  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const u = scene.u;
    gl.useProgram(scene.p);
    const units = ["plate", "low", "photo", "wire", "layers", "field", "wgeo", "wamp"];
    const uni = ["uPlate", "uLow", "uPhoto", "uWire", "uLayers", "uField", "uWGeo", "uWAmp"];
    units.forEach((k, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex[k]);
      gl.uniform1i(u[uni[i]], i);
    });
    gl.uniform4f(u.uView, ...L.view);
    gl.uniform1f(u.uTime, clock);
    gl.uniform1f(u.uWTime, wclock % WIRE_LOOP);
    gl.uniform1f(u.uEnv, envAll);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.uniform1f(u.uSway, wireStrokes.length ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        halation: 0.28,
        halationThreshold: 0.82,
        bloom: 0.2,
        softness: 0.5,
        contrast: 1.12,
        whitePoint: 1.22,
        toe: 0.07,
        toeColor: [0.72, 1, 1.22],
        blueDepth: 0.35,
        saturation: 1.04,
        vignette: 0.2,
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

  const REVEAL = 2.0;
  let slow = 0;
  let lastNow = 0;
  let wall = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;
  let traceAlive = false;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!frozen) {
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
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!frozen) {
      clock += dt;
      wclock += dt;
    }

    // the demo hand
    if (demo && !demo.done && age >= demo.start) {
      const ta = age - demo.start;
      const st = demoSamples(ta);
      if (!demo.st) {
        demo.st = st;
        demo.st.born = clock;
        strokes.push(demo.st);
        tracePts.length = 0;
        traceEnd = -1;
      }
      // re-time: samples carry the clock they were painted at
      const off = clock - ta;
      demo.st.samples = st.samples.map((s) => ({ ...s, t: s.t + off }));
      demo.st.pts = st.pts;
      // the hand's tip, as a pointer would report it
      const tip = st.pts[st.pts.length - 1];
      if (tip) {
        const [x, y] = toBox(tip.x, tip.y);
        tracePts.push({ x, y, born: now });
      }
      if (now - (demo.st.solvedAt || 0) > 70) {
        demo.st.solvedAt = now;
        solveLive(demo.st);
      }
      if (ta > DEMO[DEMO.length - 1][2]) {
        demo.done = true;
        solveLive(demo.st);
        traceEnd = now;
      }
    }

    // envelopes: each stroke eases in; a clear eases everything out
    let ramping = false;
    for (const s of strokes) {
      const e = easeOutCubic((clock - s.born) / 0.6);
      if (Math.abs(e - s.env) > 1e-4) {
        s.env = e;
        ramping = true;
      }
    }
    for (const w of wireStrokes) {
      const e = easeOutCubic((clock - w.born) / 0.5);
      if (Math.abs(e - w.env) > 1e-4) {
        w.env = e;
        ramping = true;
        ampDirty = true;
      }
    }
    if (clearing != null) {
      envAll = 1 - easeInOut((clock - clearing) / 0.9);
      ampDirty = true;
      if (envAll <= 0) {
        strokes.length = 0;
        wireStrokes.length = 0;
        clearing = null;
        envAll = 1;
        fieldDirty = true;
        if (demo) demo.done = true;
      }
    }
    if (ramping) fieldDirty = true;
    if (fieldDirty) {
      fieldDirty = false;
      uploadField();
      dirty = true;
    }
    if (ampDirty) {
      ampDirty = false;
      uploadAmp(clearing != null ? envAll : 1);
      dirty = true;
    }

    if (!reduce && !frozen) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    // the trace
    if (traceQ != null) {
      if (!traceAlive) {
        tracePts.forEach((p) => (p.born = now));
        traceAlive = true;
      }
      tracePts.forEach((p) => (p.born = now));
      drawTrace(now, clamp(traceQ, 0, 1), true);
    } else if (tracePts.length) {
      if (!drawTrace(now) && traceEnd > 0) tracePts.length = 0;
    }

    const moving = !frozen && (strokes.length > 0 || wireStrokes.length > 0 || age < REVEAL + 0.2);
    if (!dirty && !moving) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      if (press) clearTimeout(press.timer);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      trace.remove();
      stage.destroy();
    },
  };
}
