import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm } from "../_kit/film";

// Concourse: Ryoji Iwata's photograph of the Shibuya scramble, seen from
// above. Drag (or scroll) and the city's lights go out: the asphalt, the
// zebra stripes and every shadow drop to black, and what is left is the
// people, each standing on their own slab of the real road, lit from beneath
// like a lightbox and lifted a little off the ground.
//
// tools/depth/bakes/concourse found every person (YOLOv10), cut each one with
// SAM 2.1 on their own crop, fitted the road plane to a MoGe-2 point map,
// measured each person's feet on it and cut their tile: the footprint of the
// body dropped straight down onto the road, squared to the zebra stripes,
// with people walking together sharing one tile. It also painted the people
// out of the road (LaMa), so the world that dims behind them holds no ghosts.
//
// Everything is drawn in the photographer's own camera. Each person is a
// card hinged at their feet, every pixel of it on its own camera ray, so from
// the lens they are exactly the photograph; swing round and the card turns
// on its feet to face you, leaning a little, so they stand up out of their
// tile instead of lying flat. Tiles are real slabs (top, four sides) that rise on
// their own springs; the light under them spills onto the dark road, and
// film.js blooms it. A few are lit warm red.
//
// Query: ?split=0..1&yaw=deg&pitch=deg&hover=tile holds a still.

const ASSET = "/lab/concourse/";
const FOCUS_Y = 0.6; // the window's centre, as a fraction of the photo's height
const MAX_YAW = 16;
const MAX_PITCH = 9;
const THICK = 0.07; // slab thickness, m
const LIFT = [0.22, 0.62]; // per-tile lift range at full split, m
const DOLLY = 0.8; // the camera backs off along the window's centre ray, as a share of its distance
const WHITE = [1.0, 0.94, 0.86];
const RED = [1.0, 0.07, 0.03];
const RED_TILES = [9, 17, 22];
const LEAN_MAX = (26 * Math.PI) / 180; // how far back a person's card may lean
const LEAN_FOLLOW = 0.55; // share of the camera's climb the lean follows
const TOP_MAX = 2.1; // a card is never taller than this, m

const FILM = {
  exposure: 0,
  headroom: 0,
  halation: 0,
  halationThreshold: 0.85,
  halationColor: [1, 0.22, 0.08],
  bloom: 0.05,
  softness: 0.25,
  contrast: 1.04,
  shoulder: 0.97,
  whitePoint: 1.12,
  toe: 0.008,
  toeColor: [1, 1, 1],
  shadowTint: [1, 1, 1],
  highlightTint: [1, 1, 1],
  saturation: 1.0,
  blueDepth: 0,
  warmth: 0,
  grain: 0.18,
  vignette: 0,
  input: "linear",
};

// ------------------------------------------------------------------ shaders
const COMMON = `
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uN;     // floor normal (up, toward the camera)
uniform float uD;    // floor: dot(n, X) + d = 0
uniform vec3 uK;     // f, cx, cy of the photograph (export px)
vec2 photoPx(vec3 X) { return vec2(uK.x * X.x / X.z + uK.y, uK.x * X.y / X.z + uK.z); }
float heightOf(vec3 X) { return dot(uN, X) + uD; }
`;

const FLOOR_VS = `#version 300 es
layout(location=0) in vec2 aPos;
${COMMON}
uniform vec3 uC[4];
out vec3 vRest;
void main() {
  vec3 X = mix(mix(uC[0], uC[1], aPos.x), mix(uC[3], uC[2], aPos.x), aPos.y);
  vRest = X;
  gl_Position = uProj * uView * vec4(X, 1.0);
}`;

const FLOOR_FS = `#version 300 es
precision highp float;
${COMMON}
in vec3 vRest;
uniform sampler2D uFloor;
uniform vec2 uPhoto;
uniform float uLights;
out vec4 o;
void main() {
  vec2 uv = photoPx(vRest) / uPhoto;
  vec3 c = texture(uFloor, uv).rgb;
  o = vec4(c * uLights, 1.0);
}`;

// Light leaking out from under a lifted slab onto the road. The slab's
// underside is a panel of the tile's own emission, a gap's height above the
// road: the road right under its rim takes almost all of it, and it falls off
// with the inverse square of the distance out from the rim, measured against
// that height, so a slab barely off the ground throws a tight bright line and
// one held high throws a wide, faint pool. What it lights is the real road
// (the painted-out photograph), so the asphalt grain and the stripes show up
// in the pool and nowhere else.
const GLOW_VS = `#version 300 es
layout(location=0) in vec2 aPos;
${COMMON}
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec4 uRect;  // tile in floor axes (u0, v0, u1, v1), m
uniform float uPad;
out vec2 vUv;
out vec3 vRest;
void main() {
  vec2 lo = uRect.xy - uPad, hi = uRect.zw + uPad;
  vec2 uv = mix(lo, hi, aPos);
  vUv = uv;
  vec3 X = uE1 * uv.x + uE2 * uv.y;
  X -= uN * (dot(uN, X) + uD);
  vRest = X;
  gl_Position = uProj * uView * vec4(X, 1.0);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
in vec3 vRest;
uniform sampler2D uFloor;
uniform vec2 uPhoto;
uniform vec4 uRect;
uniform vec3 uLight;  // the panel's colour
uniform float uEmit;  // the panel's emission (glow, hover)
uniform float uH;     // height of the slab's underside above the road, m
uniform float uPad;
uniform float uAmp;
out vec4 o;
void main() {
  vec2 c = (uRect.xy + uRect.zw) * 0.5, h = (uRect.zw - uRect.xy) * 0.5;
  vec2 q = abs(vUv - c) - h;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  // irradiance from a lit rim a height H up: H^2 / (H^2 + x^2), cubed for
  // the cosines at both ends. Under the slab the road is in the slab's own
  // shade, so from an angle a lifted slab shows a dark footprint ringed by
  // the light that got out round its edge.
  // the light leaves through the gap at a grazing angle, so the pool is a
  // fraction of the gap wide, not the gap itself
  float H = 0.04 + 0.22 * max(uH, 0.0);
  float x = max(sd, 0.0);
  float k = H * H / (H * H + x * x);
  float g = k * k * k * exp(min(sd, 0.0) / (0.06 + 0.3 * H));
  // the gap the light escapes through: none while the slab sits on the road
  g *= smoothstep(0.0, 0.12, uH);
  g *= 1.0 - smoothstep(uPad * 0.55, uPad, sd); // true black before the quad ends
  vec3 albedo = texture(uFloor, photoPx(vRest) / uPhoto).rgb;
  // asphalt is dark: a little of the light comes back off its sheen as well
  vec3 lit = uLight * uEmit * g * uAmp * (albedo + 0.04);
  o = vec4(lit, 0.0);
}`;

// The slab: a unit box whose top is the tile's own patch of road.
const SLAB_VS = `#version 300 es
layout(location=0) in vec3 aPos;   // 0..1 box
layout(location=1) in float aFace; // 0 top, 1 side, 2 bottom
${COMMON}
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec4 uRect;
uniform float uLift;
uniform float uThick;
out vec3 vRest;
out float vFace;
out float vZ;
out vec2 vUv;
void main() {
  vec2 uv = mix(uRect.xy, uRect.zw, aPos.xy);
  vec3 X = uE1 * uv.x + uE2 * uv.y;
  X -= uN * (dot(uN, X) + uD);
  vRest = X;
  vUv = aPos.xy;
  vZ = aPos.z;
  vFace = aFace;
  vec3 P = X + uN * (uLift - (1.0 - aPos.z) * uThick);
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;

const SLAB_FS = `#version 300 es
precision highp float;
${COMMON}
in vec3 vRest;
in float vFace;
in float vZ;
in vec2 vUv;
uniform sampler2D uFloor;
uniform vec2 uPhoto;
uniform vec3 uLight;
uniform float uGlow;   // 0 the photograph .. 1 lit
uniform float uEmit;   // the panel's emission (glow, hover)
uniform float uRed;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  if (vFace < 0.5) {
    vec2 uv = photoPx(vRest) / uPhoto;
    vec3 a = texture(uFloor, uv).rgb;
    // A lightbox: a diffuser lit evenly from inside. The road's tone is
    // compressed almost flat (a fifteenth power keeps about 15% of the
    // asphalt's grain and the stripes' contrast) ...
    float l = luma(a);
    float detail = pow(clamp(l / 0.34, 0.2, 3.0), 0.15);
    // ... and the only real dark on it is the person's own shadow, read
    // from a softened copy of the road (sunlit asphalt sits near 0.3, a
    // shadow under 0.05) and laid on as a soft multiply
    float ls = luma(texture(uFloor, uv, 3.0).rgb);
    float shade = 1.0 - smoothstep(0.035, 0.17, ls);
    detail = mix(detail, 1.0, shade); // the grain inside a shadow is the shadow's
    float shadow = mix(1.0, 0.42, shade);
    // brightest in the middle of the panel, easing off towards its frame
    vec2 r = (vUv - 0.5) * 2.0;
    float d2 = dot(r * r, vec2(0.5)) + 0.5 * max(r.x * r.x, r.y * r.y);
    float grad = 1.06 - 0.24 * d2;
    float frame = smoothstep(0.0, 0.035, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    grad *= 0.8 + 0.2 * frame;
    // white panels are a warm paper white; a red gel runs hot in the middle,
    // where the light through it is strongest
    vec3 Lt = uRed > 0.5 ? mix(vec3(1.1, 0.035, 0.018), vec3(1.45, 0.15, 0.07), smoothstep(0.8, 0.0, d2)) : uLight * 1.5;
    vec3 panel = Lt * uEmit * detail * shadow * grad;
    // the road goes to the panel as the lights go out
    float lb = smoothstep(0.08, 0.8, uGlow);
    o = vec4(mix(a, panel, lb), 1.0);
  } else if (vFace < 1.5) {
    // the edge of the acrylic glows with the light inside it
    float t = mix(0.35, 1.0, vZ);
    o = vec4(uLight * uEmit * 0.55 * t * (uRed > 0.5 ? 2.2 : 1.0), 1.0);
  } else {
    o = vec4(0.0, 0.0, 0.0, 1.0);
  }
}`;

// A person is a card hinged at their feet. At rest each pixel of the matte
// sits on its own camera ray, so from the photographer's lens they are
// exactly the photograph: the part of the matte below the feet lies on the
// tile (shoes and the ground they touch), the rest sits on a card standing
// upright on the feet, leaning back (away from the lens) only if that is what
// it takes to bring a figure seen from high above down to a person's height.
// Live, the card keeps those coordinates and turns about the vertical through
// the feet to face wherever the camera now is, and leans back by part of how
// far the camera has climbed (capped), so it is never seen edge-on and a
// steeper view foreshortens it instead of flattening it to a sliver.
const PERSON_VS = `#version 300 es
layout(location=0) in vec2 aPos;
${COMMON}
uniform vec4 uRect;   // matte rect in photo px
uniform vec3 uFeet;   // on the floor
uniform vec3 uR0;     // rest card: across (horizontal)
uniform vec3 uG0;     //            away from the lens (horizontal)
uniform vec3 uU0;     //            up the card
uniform vec3 uR;      // live card
uniform vec3 uG;
uniform vec3 uU;
uniform float uTop;   // the card's height cap, m
uniform float uLift;
out vec2 vQ;
out float vH;
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aPos);
  vQ = p - uRect.xy;
  vec3 d = vec3((p.x - uK.y) / uK.x, (p.y - uK.z) / uK.x, 1.0);
  vec3 nc = cross(uR0, uU0);
  vec3 rel = d * (dot(uFeet, nc) / dot(d, nc)) - uFeet;
  float a = dot(rel, uR0), b = dot(rel, uU0);
  vec3 base = uFeet + uN * (uLift + 0.002);
  vec3 P;
  if (b < 0.0) {
    // below the hinge: the ray reaches the road first
    rel = d * (-uD / dot(uN, d)) - uFeet;
    a = dot(rel, uR0);
    P = base + uR * a + uG * dot(rel, uG0);
    vH = 0.0;
  } else {
    b = min(b, uTop);
    P = base + uR * a + uU * b;
    vH = b * dot(uU, uN);
  }
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;

const PERSON_FS = `#version 300 es
precision highp float;
${COMMON}
in vec2 vQ;
in float vH;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec4 uRect;
uniform vec2 uAt;
uniform vec3 uLight;
uniform float uGlow;
uniform float uEmit;  // their panel's emission
uniform float uRed;
uniform float uDim;
out vec4 o;
void main() {
  vec2 q = vQ;
  vec2 sz = uRect.zw - uRect.xy;
  if (q.x < 0.0 || q.y < 0.0 || q.x > sz.x || q.y > sz.y) discard;
  vec4 c = texture(uAtlas, (q + uAt) / uAtlasSize);
  // choke the matte's outer tenth: that rim is part road (often a white
  // stripe), which reads as a halo once the road is gone
  c.a = clamp((c.a - 0.22) / 0.78, 0.0, 1.0);
  if (c.a < 0.004) discard;
  // Up-light from the panel under their feet: strongest at the shoes, gone
  // by the waist; a red gel reaches further and washes them in its colour.
  // The street's daylight goes out with the lights, so above it they settle.
  float reach = uRed > 0.5 ? 0.7 : 0.34;
  float f = exp(-vH / reach);
  vec3 day = c.rgb * mix(1.0, 0.68 + 0.32 * f, uGlow);
  vec3 up = uLight * uEmit * f;
  // the light wraps round their outline (trouser seams, shoe edges, hems):
  // a rim wherever the matte thins out within a few pixels
  vec2 at = (q + uAt) / uAtlasSize, px = 3.0 / uAtlasSize;
  float m = min(min(texture(uAtlas, at + vec2(px.x, 0.0)).a, texture(uAtlas, at - vec2(px.x, 0.0)).a),
                min(texture(uAtlas, at + vec2(0.0, px.y)).a, texture(uAtlas, at - vec2(0.0, px.y)).a));
  float rim = 1.0 - smoothstep(0.3, 0.95, m);
  float red = uRed > 0.5 ? 1.0 : 0.0;
  vec3 lit = day * (1.0 + up * mix(1.6, 3.0, red)) + up * (mix(0.12, 0.7, red) + rim * mix(0.7, 2.4, red));
  o = vec4(lit * c.a * uDim, c.a);
}`;

// ------------------------------------------------------------------ math
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scl(a, 1 / Math.hypot(a[0], a[1], a[2]));

// Rodrigues rotation matrix (rows) about unit axis k by angle a.
function rot(k, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const [x, y, z] = k;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const app3 = (A, v) => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];

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
function rubber(v, lim, k = 0.35) {
  const a = Math.abs(v);
  return a <= lim ? v : Math.sign(v) * (lim + (a - lim) * k);
}
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

export async function createConcourse(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qSplit = num("split");
  const held = qSplit != null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = "#000";
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "grab";
  const halfFloat = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");

  const [S, floorBm, atlasBm] = await Promise.all([
    fetch(`${ASSET}scene.json`).then((r) => r.json()),
    loadBitmap(`${ASSET}floor.webp`),
    loadBitmap(`${ASSET}people.webp`),
  ]);
  const N = S.n;
  const D = S.d;
  const E1 = S.e1;
  const E2 = S.e2;
  const [PW, PH] = S.photo;
  const F = S.f;

  // The atlas's alpha, for picking the person under the pointer.
  const ac = document.createElement("canvas");
  ac.width = atlasBm.width;
  ac.height = atlasBm.height;
  const actx = ac.getContext("2d", { willReadFrequently: true });
  actx.drawImage(atlasBm, 0, 0);
  const atlasPx = actx.getImageData(0, 0, ac.width, ac.height).data;

  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    bm.close?.();
    return t;
  };
  const floorTex = upload(floorBm);
  const atlasTex = upload(atlasBm);

  const progFloor = compile(gl, FLOOR_VS, FLOOR_FS);
  const progGlow = compile(gl, GLOW_VS, GLOW_FS);
  const progSlab = compile(gl, SLAB_VS, SLAB_FS);
  const progPerson = compile(gl, PERSON_VS, PERSON_FS);

  // ---- geometry
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // slab: top, four sides, bottom as triangles; (x, y, z, face)
  const box = [];
  const face = (a, b, c, d, f) => box.push(...a, f, ...b, f, ...c, f, ...a, f, ...c, f, ...d, f);
  // sides first, top last (it wins the depth tie while the slab is still
  // flat on the road); the bottom is never seen from above
  face([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], 1);
  face([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], 1);
  face([1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], 1);
  face([0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], 1);
  face([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], 0);
  const slabVao = gl.createVertexArray();
  gl.bindVertexArray(slabVao);
  const slabBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, slabBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(box), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);

  // person: a grid over the matte rect, each vertex placed on its own ray
  const GX = 14, GY = 30;
  const gv = [];
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) gv.push(i / GX, j / GY);
  const gi = [];
  for (let j = 0; j < GY; j++)
    for (let i = 0; i < GX; i++) {
      const a = j * (GX + 1) + i;
      gi.push(a, a + 1, a + GX + 2, a, a + GX + 2, a + GX + 1);
    }
  const gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  const gridBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gv), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const gridIdx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(gi), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // ---- the world in the photographer's camera (OpenCV axes, metres)
  const rayOf = (px, py) => [(px - S.cx) / F, (py - S.cy) / F, 1];
  const onFloor = (px, py, h = 0) => {
    const r = rayOf(px, py);
    return scl(r, (h - D) / dot(N, r));
  };
  const corners = [onFloor(0, 0), onFloor(PW, 0), onFloor(PW, PH), onFloor(0, PH)];
  const tiles = S.tiles.map((t, k) => ({
    r: t.r,
    people: t.people,
    red: RED_TILES.includes(k),
    lift: spring(0),
    hover: spring(0),
    maxLift: LIFT[0] + (LIFT[1] - LIFT[0]) * hash(k + 3),
    omega: 11 + 6 * hash(k + 11),
    centre: (() => {
      const u = (t.r[0] + t.r[2]) / 2, v = (t.r[1] + t.r[3]) / 2;
      const X = add(scl(E1, u), scl(E2, v));
      return sub(X, scl(N, dot(N, X) + D));
    })(),
  }));
  // Each person's card at rest: across and away are horizontal, measured from
  // the lens to the feet; it leans back away from the lens only as far as it
  // takes to bring the top of the matte down to a person's height.
  const cardAxes = (G, lean) => {
    const R = norm(cross(N, G));
    const U = add(scl(N, Math.cos(lean)), scl(G, Math.sin(lean)));
    return { R, G, U };
  };
  const horiz = (v) => norm(sub(v, scl(N, dot(N, v))));
  const elev = (v) => Math.asin(clamp(-dot(norm(v), N), -1, 1));
  const restHeight = (p, ax) => {
    const d = rayOf((p.rect[0] + p.rect[2]) / 2, p.rect[1]);
    const nc = cross(ax.R, ax.U);
    return dot(sub(scl(d, dot(p.feet, nc) / dot(d, nc)), p.feet), ax.U);
  };
  const people = S.people.map((p) => {
    const G0 = horiz(p.feet);
    const want = clamp(p.head, 1.45, 1.85);
    let lean = 0;
    while (lean < LEAN_MAX && restHeight(p, cardAxes(G0, lean)) > want) lean += Math.PI / 360;
    lean = Math.min(lean, LEAN_MAX);
    const rest = cardAxes(G0, lean);
    // a little headroom: the matte's top corners sit a touch above its top centre
    const top = Math.min(TOP_MAX, Math.max(restHeight(p, rest), 0.2) + 0.08);
    return { ...p, rest, lean, top, e0: elev(p.feet), live: rest };
  });
  // The live card: turned about the vertical through the feet to face the
  // camera, leaning by part of the camera's climb.
  const liveCard = (p, C) => {
    const v = sub(p.feet, C);
    const lean = clamp(p.lean + LEAN_FOLLOW * (elev(v) - p.e0), 0, LEAN_MAX);
    return cardAxes(horiz(v), lean);
  };

  // ---- targets
  let sceneT = null;
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const build = () => {
    if (sceneT) {
      gl.deleteTexture(sceneT.tex);
      gl.deleteRenderbuffer(sceneT.depth);
      gl.deleteFramebuffer(sceneT.fbo);
    }
    const w = stage.canvas.width, h = stage.canvas.height;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, halfFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    sceneT = { tex, depth, fbo };
    film.resize(w, h);
    dirty = true;
  };
  let dirty = true;
  stage.onResize(build);

  // ---- camera
  // The window of the photograph that covers the box at rest.
  // Where the lit tiles are, in the photograph: as the street goes dark the
  // camera drifts to centre them.
  const tileCentre = (() => {
    let x = 0, y = 0, w = 0;
    for (const T of tiles) {
      const k = T.people.length;
      x += ((F * T.centre[0]) / T.centre[2] + S.cx) * k;
      y += ((F * T.centre[1]) / T.centre[2] + S.cy) * k;
      w += k;
    }
    return [x / w, y / w];
  })();
  const windowOf = (s = 0) => {
    const A = stage.width / stage.height;
    let ww = PW, wh = PW / A;
    if (wh > PH) {
      wh = PH;
      ww = PH * A;
    }
    // only once the street is mostly dark, so its edges never show
    const k = 0.75 * smooth(0.25, 1, s);
    const wcx = PW / 2 + (tileCentre[0] - PW / 2) * k;
    const wcy0 = clamp(FOCUS_Y * PH, wh / 2, PH - wh / 2);
    const wcy = wcy0 + (tileCentre[1] - wcy0) * k;
    return { ww, wh, wcx, wcy };
  };
  const camera = (s, yawDeg, pitchDeg) => {
    const Wn = windowOf(s);
    const pivotRay = rayOf(Wn.wcx, Wn.wcy);
    const pivot = onFloor(Wn.wcx, Wn.wcy);
    const dist = Math.hypot(...pivot);
    const fwd = norm(pivot);
    // yaw round the vertical through the pivot, pitch round the horizontal
    // axis across the view
    const side = norm(cross(N, fwd));
    const R = mul3(rot(side, (-pitchDeg * Math.PI) / 180), rot(N, (-yawDeg * Math.PI) / 180));
    const back = DOLLY * smooth(0.25, 1, s) * dist;
    // view: X' = R (X - pivot) + pivot + fwd * back
    const t = add(sub(pivot, app3(R, pivot)), scl(fwd, back));
    const view = new Float32Array([
      R[0][0], R[1][0], R[2][0], 0,
      R[0][1], R[1][1], R[2][1], 0,
      R[0][2], R[1][2], R[2][2], 0,
      t[0], t[1], t[2], 1,
    ]);
    const near = dist * 0.2, far = dist * 3;
    const ax = F / (Wn.ww / 2), ay = F / (Wn.wh / 2);
    const bx = (S.cx - Wn.wcx) / (Wn.ww / 2), by = (S.cy - Wn.wcy) / (Wn.wh / 2);
    const A = (far + near) / (far - near), B = (-2 * far * near) / (far - near);
    // rows: [ax 0 bx 0] [0 -ay -by 0] [0 0 A B] [0 0 1 0]; column-major
    const proj = new Float32Array([ax, 0, 0, 0, 0, -ay, 0, 0, bx, -by, A, 1, 0, 0, B, 0]);
    void pivotRay;
    // the camera's centre in the photographer's frame
    const C = scl(app3([[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]], t), -1);
    return { view, proj, R, t, C, Wn };
  };
  // world -> css px of the box
  const toScreen = (cam, X) => {
    const Y = add(app3(cam.R, X), cam.t);
    const px = (F * Y[0]) / Y[2] + S.cx;
    const py = (F * Y[1]) / Y[2] + S.cy;
    return [((px - cam.Wn.wcx) / cam.Wn.ww + 0.5) * stage.width, ((py - cam.Wn.wcy) / cam.Wn.wh + 0.5) * stage.height, Y[2]];
  };
  // PERSON_VS, for picking
  const personPoint = (p, px, py, lift) => {
    const d = rayOf(px, py);
    const { R: R0, G: G0, U: U0 } = p.rest;
    const L = p.live;
    const nc = cross(R0, U0);
    let rel = sub(scl(d, dot(p.feet, nc) / dot(d, nc)), p.feet);
    const b = dot(rel, U0);
    const base = add(p.feet, scl(N, lift + 0.002));
    if (b < 0) {
      rel = sub(scl(d, -D / dot(N, d)), p.feet);
      return add(base, add(scl(L.R, dot(rel, R0)), scl(L.G, dot(rel, G0))));
    }
    return add(base, add(scl(L.R, dot(rel, R0)), scl(L.U, Math.min(b, p.top))));
  };

  // ---- state
  const split = spring(held ? clamp(qSplit, 0, 1) : 0);
  const yaw = spring(held ? num("yaw") ?? 0 : 0);
  const pitch = spring(held ? num("pitch") ?? 0 : 0);
  const heldHover = num("hover");
  let lights = held ? 1 - smooth(0, 0.35, qSplit) : 1;
  let grab = null;
  let wheel = null;
  let touched = held;
  let born = performance.now();
  let hoverTile = -1;
  let lastKey = "";
  let lastGrain = -1;

  // Which tile is under the pointer: a person's matte first (front to back),
  // then the slab tops.
  const pick = (mx, my, cam) => {
    const order = people
      .map((p, i) => ({ i, z: toScreen(cam, p.feet)[2] }))
      .sort((a, b) => a.z - b.z);
    for (const { i } of order) {
      const p = people[i];
      if (!tiles[p.tile]) continue;
      const lift = tiles[p.tile].lift.x;
      const [x0, y0, x1, y1] = p.rect;
      // a coarse 4x8 inverse lookup over the person's grid
      let best = null;
      for (let j = 0; j < 8 && !best; j++)
        for (let k = 0; k < 4 && !best; k++) {
          const u0 = k / 4, u1 = (k + 1) / 4, v0 = j / 8, v1 = (j + 1) / 8;
          const P = [
            [u0, v0],
            [u1, v0],
            [u1, v1],
            [u0, v1],
          ].map(([u, v]) => toScreen(cam, personPoint(p, x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, lift)));
          if (inQuad(mx, my, P)) {
            const [fu, fv] = invBilinear(mx, my, P);
            const u = u0 + (u1 - u0) * fu, v = v0 + (v1 - v0) * fv;
            const ax = Math.floor(p.at[0] + u * (x1 - x0)), ay = Math.floor(p.at[1] + v * (y1 - y0));
            if (ax >= 0 && ay >= 0 && ax < ac.width && ay < ac.height && atlasPx[(ay * ac.width + ax) * 4 + 3] > 100) best = true;
            else best = false;
          }
        }
      if (best) return p.tile;
    }
    for (let k = 0; k < tiles.length; k++) {
      const T = tiles[k];
      const [u0, v0, u1, v1] = T.r;
      const P = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ].map(([u, v]) => {
        const X = add(scl(E1, u), scl(E2, v));
        return toScreen(cam, add(sub(X, scl(N, dot(N, X) + D)), scl(N, T.lift.x)));
      });
      if (inQuad(mx, my, P)) return k;
    }
    return -1;
  };

  const degPerPx = () => (2 * MAX_YAW) / Math.max(320, stage.width * 0.8);
  stage.on("down", (p) => {
    touched = true;
    grab = { x: p.x, y: p.y, s0: split.x, y0: yaw.x, p0: pitch.x };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("up", (p) => {
    if (!grab) return;
    grab = null;
    stage.canvas.style.cursor = "grab";
    yaw.v += p.vx * degPerPx() * 0.2;
    pitch.v -= p.vy * degPerPx() * 0.2;
  });
  const onWheel = (e) => {
    if (held) return;
    e.preventDefault();
    touched = true;
    const k = e.deltaMode === 1 ? 16 : 1;
    if (!wheel) wheel = { s: split.x, yaw: yaw.x, t: 0 };
    wheel.s = clamp(wheel.s + Math.abs(e.deltaY * k) / 500, 0, 1);
    wheel.yaw = rubber(wheel.yaw + (e.deltaX * k) * 0.04 + Math.sign(e.deltaY) * 0.25, MAX_YAW);
    wheel.t = performance.now();
  };
  // Full page only: on the index a wheel over the tile must scroll the page.
  if (!embedded) stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  // A panel's light: one number drives its face, the light under it and the
  // up-light on whoever stands on it.
  const emitOf = (T, glow) => glow * (1 + 0.55 * T.hover.x);

  const draw = (s, yawDeg, pitchDeg, glow) => {
    const cam = camera(s, yawDeg, pitchDeg);
    const w = stage.canvas.width, h = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    const common = (P) => {
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, cam.view);
      gl.uniformMatrix4fv(P.u.uProj, false, cam.proj);
      gl.uniform3f(P.u.uN, N[0], N[1], N[2]);
      gl.uniform1f(P.u.uD, D);
      gl.uniform3f(P.u.uK, F, S.cx, S.cy);
    };

    // the road, dimming
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    if (lights > 0.001) {
      common(progFloor);
      gl.uniform3fv(progFloor.u.uC, new Float32Array(corners.flat()));
      gl.uniform2f(progFloor.u.uPhoto, PW, PH);
      gl.uniform1f(progFloor.u.uLights, lights);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, floorTex);
      gl.uniform1i(progFloor.u.uFloor, 0);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // light spilling from under the slabs
    if (glow > 0.001) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      common(progGlow);
      gl.uniform3f(progGlow.u.uE1, E1[0], E1[1], E1[2]);
      gl.uniform3f(progGlow.u.uE2, E2[0], E2[1], E2[2]);
      gl.uniform1f(progGlow.u.uPad, 0.7);
      gl.uniform2f(progGlow.u.uPhoto, PW, PH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, floorTex);
      gl.uniform1i(progGlow.u.uFloor, 0);
      gl.bindVertexArray(quadVao);
      tiles.forEach((T) => {
        const L = T.red ? RED : WHITE;
        const H = T.lift.x - clamp(T.lift.x * 0.5, 0, THICK);
        if (H < 0.002) return;
        gl.uniform4f(progGlow.u.uRect, T.r[0], T.r[1], T.r[2], T.r[3]);
        gl.uniform3f(progGlow.u.uLight, L[0], L[1], L[2]);
        gl.uniform1f(progGlow.u.uEmit, emitOf(T, glow));
        gl.uniform1f(progGlow.u.uH, H);
        gl.uniform1f(progGlow.u.uAmp, T.red ? 1.15 : 0.32);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
      gl.disable(gl.BLEND);
    }

    // slabs
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    common(progSlab);
    gl.uniform3f(progSlab.u.uE1, E1[0], E1[1], E1[2]);
    gl.uniform3f(progSlab.u.uE2, E2[0], E2[1], E2[2]);
    gl.uniform2f(progSlab.u.uPhoto, PW, PH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    gl.uniform1i(progSlab.u.uFloor, 0);
    gl.bindVertexArray(slabVao);
    tiles.forEach((T) => {
      const L = T.red ? RED : WHITE;
      gl.uniform4f(progSlab.u.uRect, T.r[0], T.r[1], T.r[2], T.r[3]);
      gl.uniform1f(progSlab.u.uLift, T.lift.x);
      gl.uniform1f(progSlab.u.uThick, clamp(T.lift.x * 0.5, 0, THICK));
      gl.uniform3f(progSlab.u.uLight, L[0], L[1], L[2]);
      gl.uniform1f(progSlab.u.uGlow, glow);
      gl.uniform1f(progSlab.u.uEmit, emitOf(T, glow));
      gl.uniform1f(progSlab.u.uRed, T.red ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 30);
    });

    // people, far to near, premultiplied over
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    common(progPerson);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(progPerson.u.uAtlas, 0);
    gl.uniform2f(progPerson.u.uAtlasSize, S.atlas[0], S.atlas[1]);
    gl.bindVertexArray(gridVao);
    const order = people.map((p, i) => ({ i, z: toScreen(cam, p.feet)[2] })).sort((a, b) => b.z - a.z);
    for (const { i } of order) {
      const p = people[i];
      // a figure cut by the frame belongs to the street and goes dark with it
      const T = tiles[p.tile];
      if (!T && lights < 0.001) continue;
      const L = T?.red ? RED : WHITE;
      gl.uniform4f(progPerson.u.uRect, p.rect[0], p.rect[1], p.rect[2], p.rect[3]);
      gl.uniform2f(progPerson.u.uAt, p.at[0], p.at[1]);
      gl.uniform3f(progPerson.u.uFeet, p.feet[0], p.feet[1], p.feet[2]);
      p.live = liveCard(p, cam.C);
      for (const [k, v] of [
        ["uR0", p.rest.R],
        ["uG0", p.rest.G],
        ["uU0", p.rest.U],
        ["uR", p.live.R],
        ["uG", p.live.G],
        ["uU", p.live.U],
      ])
        gl.uniform3f(progPerson.u[k], v[0], v[1], v[2]);
      gl.uniform1f(progPerson.u.uTop, p.top);
      gl.uniform1f(progPerson.u.uLift, T ? T.lift.x : 0);
      gl.uniform3f(progPerson.u.uLight, L[0], L[1], L[2]);
      gl.uniform1f(progPerson.u.uGlow, T ? glow : 0);
      gl.uniform1f(progPerson.u.uEmit, T ? emitOf(T, glow) : 0);
      gl.uniform1f(progPerson.u.uRed, T?.red ? 1 : 0);
      gl.uniform1f(progPerson.u.uDim, T ? 1 : lights);
      gl.drawElements(gl.TRIANGLES, gi.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    return cam;
  };

  let cam = null;
  const frame = (dt, t) => {
    if (!sceneT) return;
    const now = performance.now();
    const p = stage.pointer;
    const age = (now - born) / 1000;

    // A first hint: the lights dip once and come back.
    if (!touched && !reduced && !held) {
      const hint = age > 1.4 && age < 2.5;
      split.to = hint ? 0.55 : 0;
      yaw.to = hint ? 5 : 0;
      if (age > 3.6) touched = true;
    }
    if (wheel && now - wheel.t > 260) wheel = null;
    if (grab) {
      const dx = p.x - grab.x;
      const dy = p.y - grab.y;
      const dist = Math.hypot(dx, dy);
      split.to = clamp(grab.s0 + (1 - grab.s0) * (1 - Math.exp(-dist / (stage.width * 0.16))), 0, 1);
      yaw.to = rubber(grab.y0 + dx * degPerPx(), MAX_YAW);
      pitch.to = rubber(grab.p0 - dy * degPerPx() * 0.6, MAX_PITCH);
      stepSpring(split, 24, 1, dt);
      stepSpring(yaw, 22, 1, dt);
      stepSpring(pitch, 22, 1, dt);
    } else if (wheel) {
      split.to = wheel.s;
      yaw.to = wheel.yaw;
      stepSpring(split, 20, 1, dt);
      stepSpring(yaw, 16, 1, dt);
      stepSpring(pitch, 9, 0.86, dt);
    } else if (!held) {
      if (touched) {
        split.to = 0;
        yaw.to = 0;
        pitch.to = 0;
      }
      stepSpring(split, 8.5, 0.82, dt);
      stepSpring(yaw, 8, 0.86, dt);
      stepSpring(pitch, 8, 0.86, dt);
    }
    const s = clamp(split.x, 0, 1.06);

    // The lights: a filament cooling, quick to drop and slower to come back.
    if (!held) {
      const want = 1 - smooth(0.0, 0.3, Math.max(split.to * 0.85, s));
      lights = damp(lights, want, want < lights ? 9 : 5, dt);
    }
    const glow = clamp(1 - lights, 0, 1);

    // every slab on its own spring
    for (const T of tiles) {
      T.lift.to = s * (T.maxLift + 0.14 * T.hover.x);
      if (held) T.lift.x = T.lift.to;
      else stepSpring(T.lift, T.omega, 0.72, dt);
      // a slab coming home lands on the road; it does not sink through it
      if (T.lift.x < 0) {
        T.lift.x = 0;
        T.lift.v = 0;
      }
    }

    // hover
    const live = !held && p.inside && glow > 0.25 && cam;
    hoverTile = held ? heldHover ?? -1 : live ? pick(p.x, p.y, cam) : -1;
    tiles.forEach((T, k) => {
      T.hover.to = k === hoverTile ? 1 : 0;
      if (held) T.hover.x = T.hover.to;
      else stepSpring(T.hover, 18, 0.9, dt);
    });
    if (!grab) stage.canvas.style.cursor = hoverTile >= 0 ? "pointer" : "grab";

    const yawDeg = yaw.x;
    const pitchDeg = pitch.x;
    const key = [s, yawDeg, pitchDeg, lights, ...tiles.map((T) => T.lift.x + T.hover.x * 7)].map((v) => v.toFixed(4)).join("|");
    if (key !== lastKey || dirty) {
      cam = draw(s, yawDeg, pitchDeg, glow);
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // Film at 24 fps while the lights are out; the photograph itself holds still.
    const tick = reduced || held || glow < 0.01 ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain) {
      film.render(sceneT.tex, {
        ...FILM,
        // the spill under each slab carries the light now; the lens only
        // softens it
        bloom: FILM.bloom + 0.16 * glow,
        halation: 0.32 * glow,
        headroom: 0,
        grain: FILM.grain + 0.12 * glow,
        grainSeed: tick * 7.31,
      });
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

  return {
    destroy() {
      stage.canvas.removeEventListener("wheel", onWheel);
      film.destroy();
      if (sceneT) {
        gl.deleteTexture(sceneT.tex);
        gl.deleteRenderbuffer(sceneT.depth);
        gl.deleteFramebuffer(sceneT.fbo);
      }
      gl.deleteTexture(floorTex);
      gl.deleteTexture(atlasTex);
      for (const b of [quadBuf, slabBuf, gridBuf, gridIdx]) gl.deleteBuffer(b);
      for (const v of [quadVao, slabVao, gridVao]) gl.deleteVertexArray(v);
      for (const P of [progFloor, progGlow, progSlab, progPerson]) gl.deleteProgram(P.p);
      stage.destroy();
    },
  };
}

function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function inQuad(x, y, P) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// (u, v) of a point inside a quad P0..P3 (bilinear), by a few Newton steps.
function invBilinear(x, y, P) {
  let u = 0.5, v = 0.5;
  for (let it = 0; it < 6; it++) {
    const px = (1 - u) * (1 - v) * P[0][0] + u * (1 - v) * P[1][0] + u * v * P[2][0] + (1 - u) * v * P[3][0];
    const py = (1 - u) * (1 - v) * P[0][1] + u * (1 - v) * P[1][1] + u * v * P[2][1] + (1 - u) * v * P[3][1];
    const dxu = (1 - v) * (P[1][0] - P[0][0]) + v * (P[2][0] - P[3][0]);
    const dyu = (1 - v) * (P[1][1] - P[0][1]) + v * (P[2][1] - P[3][1]);
    const dxv = (1 - u) * (P[3][0] - P[0][0]) + u * (P[2][0] - P[1][0]);
    const dyv = (1 - u) * (P[3][1] - P[0][1]) + u * (P[2][1] - P[1][1]);
    const det = dxu * dyv - dxv * dyu || 1e-9;
    const ex = x - px, ey = y - py;
    u += (ex * dyv - ey * dxv) / det;
    v += (ey * dxu - ex * dyu) / det;
  }
  return [clamp(u, 0, 1), clamp(v, 0, 1)];
}
