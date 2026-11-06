import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";

// Blue Hour. One real dusk street (Poly Haven's Modern Evening Street, an HDR
// panorama) seen from the kerb looking up, split offline into three layers of
// linear light: the ambient city with every lamp switched off, the sky matte
// with its cloud texture, and the emitters themselves, each lamp and lit room
// on its own index. Drag across and the twenty minutes after sunset run:
// the skylight falls about three and a half stops while the sky deepens from
// pale peach-cyan to cobalt, the camera opens up as a photographer would, and
// the lights come on in the order a street does: the sodium lamps on their
// photocells first, slow to warm from pink to amber, then the cool LED
// downlights, then the rooms upstairs as people reach for the switch, each
// striking with a short flicker. All of it is developed through _kit/film
// with its dusk preset easing into night, so the lamps bloom and halate the
// way they would on CineStill.

const AMB_STOPS = 4.0; // skylight lost over the span
const EXPO_STOPS = 1.7; // exposure the camera gives back
const LO = -10;
const HI = 3;
const ELO = -9;
const EHI = 14;

// The view the plate was rendered with (stereographic, see experiment.json),
// so every sky pixel knows its elevation and bearing.
const VIEW = { yaw: 118, pitch: -60, hfov: 112, k: 2 };
const SUN_AZ = 168; // degrees, the bearing the sun went down on

// Lights, from the offline split (index = value in aux.b). kind: street
// (sodium, on a photocell), led, warm (warm-white LED) or window (a room).
const LIGHTS = [
  { kind: "street", x: 479, y: 1266, chroma: [0.505, 0.351, 0.144] },
  { kind: "street", x: 1313, y: 1150, chroma: [0.455, 0.375, 0.169] },
  { kind: "street", x: 1336, y: 1301, chroma: [0.47, 0.351, 0.18] },
  { kind: "window", x: 362, y: 1386 },
  { kind: "led", x: 1145, y: 1541 },
  { kind: "window", x: 74, y: 1248 },
  { kind: "warm", x: 783, y: 1701 },
  { kind: "led", x: 775, y: 1653 },
  { kind: "window", x: 7, y: 1226 },
  { kind: "window", x: 158, y: 1301 },
  { kind: "window", x: 502, y: 1401 },
  { kind: "led", x: 666, y: 1652 },
  { kind: "warm", x: 864, y: 1492 },
  { kind: "warm", x: 927, y: 1586 },
  { kind: "window", x: 278, y: 1348 },
  { kind: "warm", x: 1386, y: 1562 },
  { kind: "led", x: 1318, y: 1517 },
  { kind: "led", x: 1103, y: 1604 },
  { kind: "led", x: 723, y: 1619 },
  { kind: "led", x: 1351, y: 1504 },
  { kind: "warm", x: 935, y: 1709 },
  { kind: "led", x: 1437, y: 1468 },
  { kind: "led", x: 886, y: 1606 },
  { kind: "led", x: 684, y: 1692 },
  { kind: "window", x: 6, y: 1398 },
  { kind: "warm", x: 653, y: 1705 },
];
const MAX_LIGHTS = 32;
const STREET_GAIN = 0.4; // the plate's lamps were metered for a darker sky
const WARMUP = 0.16; // of the span (~3 min) for a sodium lamp to reach full

// A fixed, believable schedule: photocells trip within a few minutes of each
// other, street level next, rooms last and in no particular order.
function schedule() {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const street = LIGHTS.map((l, i) => ({ l, i })).filter((o) => o.l.kind === "street");
  const ground = LIGHTS.map((l, i) => ({ l, i })).filter((o) => o.l.kind === "led" || o.l.kind === "warm");
  const rooms = LIGHTS.map((l, i) => ({ l, i })).filter((o) => o.l.kind === "window");
  const on = new Array(LIGHTS.length).fill(2);
  [0.08, 0.13, 0.18].forEach((t, j) => (on[street[j].i] = t));
  // lowest first: the kerb before the lobby, the lobby before the floors
  ground.sort((a, b) => b.l.y - a.l.y);
  ground.forEach((o, j) => (on[o.i] = 0.27 + (j / ground.length) * 0.18 + rnd() * 0.03));
  rooms.sort(() => rnd() - 0.5);
  rooms.forEach((o, j) => (on[o.i] = 0.44 + (j / rooms.length) * 0.44 + rnd() * 0.03));
  return on;
}

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const DECODE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRange; uniform float uZeroIsNone;
out vec4 o;
void main(){
  vec3 c = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 v = exp2(c * (uRange.y - uRange.x) + uRange.x);
  if (uZeroIsNone > 0.5) {
    // 0 = no emitter; 1..255 map onto the log range
    vec3 cc = (c * 255.0 - 1.0) / 254.0;
    v = exp2(cc * (uRange.y - uRange.x) + uRange.x) * step(0.5 / 255.0, c);
  }
  o = vec4(v, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D uAmb;     // linear ambient (lights off), mipmapped
uniform sampler2D uEmit;    // linear emitters, mipmapped
uniform sampler2D uAux;     // r sky matte, g cloud log-ratio, b light index
uniform vec2 uSize;         // target size in px
uniform vec2 uTexSize;
uniform mat3 uRot;          // camera to world
uniform float uF;           // stereographic focal length in plate px
uniform vec2 uSun;          // sun bearing on the horizon (x,z)
uniform float uS;           // eased time 0..1
uniform float uAmbK;        // skylight scale
uniform float uExpo;        // camera exposure
uniform vec3 uWB;           // skylight colour on the facades
uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHorSun; uniform vec3 uHorAnti;
uniform float uSkyLum;
uniform float uCloudK;
uniform vec3 uCloudTint;
uniform float uCloudW;
uniform float uGlow;        // sun-side brightening
uniform float uLod;         // mip level: sharp, only as soft as the print needs
uniform float uB[${MAX_LIGHTS}];
uniform vec3 uTint[${MAX_LIGHTS}];
out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main(){
  vec2 p = gl_FragCoord.xy / uSize;
  vec2 uv = vec2(p.x, 1.0 - p.y);
  vec3 amb = textureLod(uAmb, uv, uLod).rgb;
  vec3 em = textureLod(uEmit, uv, uLod).rgb;
  vec4 ax = texture(uAux, uv);
  float a = ax.r;
  float lr = (ax.g - 0.5) / 0.3;
  int id = int(texelFetch(uAux, ivec2(uv * uTexSize), 0).b * 255.0 + 0.5);

  // View direction of this plate pixel (stereographic), for the sky gradient.
  vec2 q = (uv * uTexSize - 0.5 * uTexSize);
  float r = length(q) + 1e-6;
  float th = 2.0 * atan(r / (2.0 * uF));
  vec3 dc = vec3(q / r * sin(th), cos(th));
  vec3 d = uRot * dc;
  float elev = asin(clamp(-d.y, -1.0, 1.0));
  float e = clamp(elev / 1.5708, 0.0, 1.0);
  vec2 hz = normalize(vec2(d.x, d.z) + 1e-5);
  float facing = 0.5 + 0.5 * dot(hz, uSun);

  // Twilight sky: deepest at the zenith, paler and warmer towards the sun's
  // side of the horizon. Colours are linear, luminance 1.
  float g = pow(1.0 - e, 1.6);
  vec3 hor = mix(uHorAnti, uHorSun, smoothstep(0.2, 1.0, facing));
  vec3 col = mix(uZen, uMid, smoothstep(0.0, 0.5, g));
  col = mix(col, hor, smoothstep(0.3, 0.8, g));
  float lum = uSkyLum * (1.0 + uGlow * g * g * facing);
  // Cloud: the plate's own texture, as a luminance ratio; the denser parts
  // catch the last warm light, later the city's glow.
  float w = smoothstep(-0.1, 0.5, lr);
  vec3 sky = col * lum * exp2(lr * uCloudK);
  sky = mix(sky, vec3(dot(sky, LUMA)) * uCloudTint, w * uCloudW);

  vec3 fg = amb * uAmbK * uWB;
  if (id > 0) {
    int k = id - 1;
    fg += em * uB[k] * uTint[k];
  }
  vec3 c = mix(fg, sky * uAmbK, a);
  o = vec4(c * uExpo, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uRect;
out vec4 o;
void main(){
  vec2 p = (gl_FragCoord.xy - uRect.xy) / uRect.zw;
  o = vec4(texture(uTex, p).rgb, 1.0);
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

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, img, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, internal, type, format) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h };
}

function rotation(yaw, pitch, roll) {
  const r = (roll * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const t = (yaw * Math.PI) / 180;
  const Rz = [
    [Math.cos(r), -Math.sin(r), 0],
    [Math.sin(r), Math.cos(r), 0],
    [0, 0, 1],
  ];
  const Rx = [
    [1, 0, 0],
    [0, Math.cos(p), Math.sin(p)],
    [0, -Math.sin(p), Math.cos(p)],
  ];
  const Ry = [
    [Math.cos(t), 0, Math.sin(t)],
    [0, 1, 0],
    [-Math.sin(t), 0, Math.cos(t)],
  ];
  const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
  const M = mul(mul(Ry, Rx), Rz);
  // column-major for GLSL
  return new Float32Array([M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]);
}

// sRGB hex -> linear rgb at luminance 1
function lin(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  return l.map((c) => c / y);
}
const mix3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// The sky at sunset (pale peach at the horizon under a cyan zenith) and at
// +20 minutes (cobalt overhead, a cleaner, lighter blue low down).
const SKY0 = { zen: lin("#a2c6dc"), mid: lin("#d0d7d4"), horSun: lin("#f2c29c"), horAnti: lin("#dcc8bf"), lum: 0.92, cloudK: 1.0, cloudTint: [1.22, 0.97, 0.82], cloudW: 0.55, glow: 0.55 };
const SKY1 = { zen: lin("#06428a"), mid: lin("#0f5aa6"), horSun: lin("#4a8cc2"), horAnti: lin("#1460a8"), lum: 0.32, cloudK: 0.8, cloudTint: [1.02, 1.0, 0.98], cloudW: 0.3, glow: 1.4 };

function lerpParams(a, b, k) {
  const out = {};
  for (const key of Object.keys(b)) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(vb)) out[key] = mix3(va, vb, k);
    else if (typeof vb === "number") out[key] = va + (vb - va) * k;
    else out[key] = vb;
  }
  return out;
}

export async function createBlueHour(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixed = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const still = fixed != null || params.has("still");

  const [ambImg, emitImg, auxImg] = await Promise.all([bitmap("/lab/blue-hour/ambient.webp"), bitmap("/lab/blue-hour/lights.png"), bitmap("/lab/blue-hour/aux.png")]);

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no float targets");
  gl.getExtension("OES_texture_float_linear");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Minutes after sunset");
  canvas.setAttribute("aria-valuemin", "0");
  canvas.setAttribute("aria-valuemax", "20");
  canvas.style.outline = "none";

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Decode the log-encoded plates once into mipmapped half-float radiance.
  const decode = compile(gl, VS, DECODE_FS);
  const decodeTo = (img, range, zeroIsNone) => {
    const src = upload(gl, img, gl.NEAREST);
    const w = img.width;
    const h = img.height;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.useProgram(decode.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(decode.u.uTex, 0);
    gl.uniform2f(decode.u.uRange, range[0], range[1]);
    gl.uniform1f(decode.u.uZeroIsNone, zeroIsNone ? 1 : 0);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(src);
    return t;
  };
  const ambTex = decodeTo(ambImg, [LO, HI], false);
  const emitTex = decodeTo(emitImg, [ELO, EHI], true);
  const auxTex = upload(gl, auxImg, gl.LINEAR);
  gl.deleteProgram(decode.p);
  const texW = auxImg.width;
  const texH = auxImg.height;
  ambImg.close?.();
  emitImg.close?.();
  auxImg.close?.();

  const scene = compile(gl, VS, SCENE_FS);
  const blit = compile(gl, VS, BLIT_FS);
  const film = createFilm(gl, { width: 2, height: 2 });

  const rot = rotation(VIEW.yaw, VIEW.pitch, 0);
  const fPlate = texW / 2 / (VIEW.k * Math.tan((VIEW.hfov * Math.PI) / 180 / 2 / VIEW.k));
  const sunA = (SUN_AZ * Math.PI) / 180;
  const sunDir = [Math.sin(sunA), Math.cos(sunA)];
  const onAt = schedule();
  const strikes = new Array(LIGHTS.length).fill(-1); // real time a strike began

  // The print: 4:5, as large as the box allows with room around it.
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  const layout = (w, h, dpr) => {
    const gutter = Math.max(16, w * 0.06);
    let ph = Math.min(h * 0.84, 1100);
    let pw = (ph * texW) / texH;
    if (pw > w - gutter * 2) {
      pw = w - gutter * 2;
      ph = (pw * texH) / texW;
    }
    rect.w = Math.round(pw);
    rect.h = Math.round(ph);
    rect.x = Math.round((w - rect.w) / 2);
    rect.y = Math.round((h - rect.h) / 2);
    const dw = Math.round(rect.w * dpr);
    const dh = Math.round(rect.h * dpr);
    for (const t of [sceneT, filmT]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    sceneT = target(gl, dw, dh, gl.RGBA16F, gl.HALF_FLOAT, gl.RGBA);
    filmT = target(gl, dw, dh, gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA);
    film.resize(dw, dh);
  };

  // Time: shown value, velocity, target. Starts at sunset and walks a little
  // way in by itself so the first lamps catch, then hands over.
  const st = { v: fixed ?? 0, vel: 0, target: fixed ?? 0 };
  let reveal = fixed == null && !reduced ? { t: 0, dur: 2.6, to: 0.3 } : null;
  if (fixed == null && reduced) st.v = st.target = 0.3;
  let exposureLift = reveal ? 2.2 : 0; // opens overexposed, settles
  let drag = null;
  let dirty = true;
  let grainT = 0;
  let seed = 5;
  let now = 0;

  const inside = (p, slop = 24) => p.x > rect.x - slop && p.x < rect.x + rect.w + slop && p.y > rect.y - slop && p.y < rect.y + rect.h + slop;
  const band = (v) => {
    // rubber band past the ends
    if (v > 1) return 1 + (1 - 1 / ((v - 1) * 2.4 + 1)) / 2.4 * 0.35;
    if (v < 0) return -(1 - 1 / (-v * 2.4 + 1)) / 2.4 * 0.35;
    return v;
  };

  stage.on("down", (p) => {
    if (!inside(p)) return;
    reveal = null;
    exposureLift = Math.min(exposureLift, 0.0001);
    drag = { x: p.x, from: clamp(st.target, 0, 1), raw: st.target };
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      drag.raw = drag.from + (p.x - drag.x) / (rect.w * 1.1);
      st.target = band(drag.raw);
      dirty = true;
    } else canvas.style.cursor = inside(p, 0) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = inside(p, 0) ? "grab" : "";
    // carry the hand a little way (friction ~220 ms), then settle in range
    const v = p.vx / (rect.w * 1.1);
    st.target = clamp(clamp(st.target, 0, 1) + clamp(v, -3, 3) * 0.22, 0, 1);
    dirty = true;
  });
  const onWheel = (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    e.preventDefault();
    reveal = null;
    exposureLift = Math.min(exposureLift, 0.0001);
    st.target = clamp(st.target + dx * 0.0012, 0, 1);
    dirty = true;
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    reveal = null;
    exposureLift = Math.min(exposureLift, 0.0001);
    st.target = clamp(Math.round(st.target * 20 + step) / 20, 0, 1); // a minute a press
    dirty = true;
  };
  canvas.addEventListener("keydown", onKey);

  stage.onResize((w, h, dpr) => {
    layout(w, h, dpr);
    dirty = true;
  });

  // Per-light brightness and tint at time t (plus a strike flicker in real
  // time when a light has just crossed its switch-on).
  const B = new Float32Array(MAX_LIGHTS);
  const TINT = new Float32Array(MAX_LIGHTS * 3).fill(1);
  let lastT = st.v;
  const strikeCurve = (kind, dt) => {
    if (dt < 0) return 1;
    if (kind === "window") {
      // a fluorescent tube: two or three stutters, then steady
      const k = [
        [0, 0.05, 0.8],
        [0.05, 0.17, 0.05],
        [0.17, 0.21, 0.6],
        [0.21, 0.38, 0.1],
        [0.38, 0.52, 0.85],
      ];
      for (const [a, b, v] of k) if (dt >= a && dt < b) return v;
      return dt < 0.7 ? 0.85 + 0.15 * ((dt - 0.52) / 0.18) : 1;
    }
    // an LED driver: one blink, then on
    if (dt < 0.04) return 0.9;
    if (dt < 0.1) return 0.08;
    if (dt < 0.22) return 0.7 + 0.3 * ((dt - 0.1) / 0.12);
    return 1;
  };
  const lights = (t) => {
    for (let i = 0; i < LIGHTS.length; i++) {
      const L = LIGHTS[i];
      const t0 = onAt[i];
      let b = 0;
      let tint = [1, 1, 1];
      if (L.kind === "street") {
        // High-pressure sodium: a dim pink strike, then the sodium takes
        // over and it climbs to amber over a few minutes.
        const p = clamp((t - t0) / WARMUP, 0, 1);
        b = t > t0 ? (0.035 + 0.965 * p ** 1.7) * STREET_GAIN : 0;
        b *= smooth(t0, t0 + 0.006, t);
        tint = mix3([0.82, 0.6, 1.9], [1, 1, 1], smooth(0, 0.7, p));
      } else {
        b = smooth(t0, t0 + 0.004, t);
        if (!still && strikes[i] >= 0) b *= strikeCurve(L.kind, now - strikes[i]);
      }
      B[i] = b;
      TINT[i * 3] = tint[0];
      TINT[i * 3 + 1] = tint[1];
      TINT[i * 3 + 2] = tint[2];
    }
  };
  const checkStrikes = (t) => {
    if (still || reduced) return;
    for (let i = 0; i < LIGHTS.length; i++) {
      if (LIGHTS[i].kind === "street") continue;
      if (lastT < onAt[i] && t >= onAt[i]) strikes[i] = now;
      if (t < onAt[i]) strikes[i] = -1;
    }
    lastT = t;
  };
  const striking = () => strikes.some((s) => s >= 0 && now - s < 0.75);

  const draw = () => {
    const t = clamp(st.v, 0, 1);
    const s = smooth(0, 1, t);
    lights(t);
    const sky = lerpParams(SKY0, SKY1, s);
    const fp = lerpParams({ ...FILM_DEFAULTS, ...FILM_PRESETS.dusk }, { ...FILM_DEFAULTS, ...FILM_PRESETS.night }, smooth(0.05, 0.95, t));
    const ambK = 2 ** (-AMB_STOPS * t);
    const expo = 0.62 * 2 ** (EXPO_STOPS * t + exposureLift);
    const wb = mix3([1.07, 1.0, 0.92], [0.82, 0.95, 1.22], s);

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, sceneT.w, sceneT.h);
    gl.useProgram(scene.p);
    const u = scene.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ambTex);
    gl.uniform1i(u.uAmb, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emitTex);
    gl.uniform1i(u.uEmit, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, auxTex);
    gl.uniform1i(u.uAux, 2);
    gl.uniform2f(u.uSize, sceneT.w, sceneT.h);
    gl.uniform2f(u.uTexSize, texW, texH);
    gl.uniformMatrix3fv(u.uRot, false, rot);
    gl.uniform1f(u.uF, fPlate);
    gl.uniform2f(u.uSun, sunDir[0], sunDir[1]);
    gl.uniform1f(u.uS, s);
    gl.uniform1f(u.uAmbK, ambK);
    gl.uniform1f(u.uExpo, expo);
    gl.uniform3fv(u.uWB, wb);
    gl.uniform3fv(u.uZen, sky.zen);
    gl.uniform3fv(u.uMid, sky.mid);
    gl.uniform3fv(u.uHorSun, sky.horSun);
    gl.uniform3fv(u.uHorAnti, sky.horAnti);
    gl.uniform1f(u.uSkyLum, sky.lum * 1.25);
    gl.uniform1f(u.uCloudK, sky.cloudK);
    gl.uniform3fv(u.uCloudTint, sky.cloudTint);
    gl.uniform1f(u.uCloudW, sky.cloudW);
    gl.uniform1f(u.uGlow, sky.glow);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(texH / sceneT.h) - 0.7));
    gl.uniform1fv(u.uB, B);
    gl.uniform3fv(u.uTint, TINT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...fp,
        input: "linear",
        grainSeed: seed,
        grain: fp.grain * 0.55,
        vignette: fp.vignette * 0.7,
        softness: 0.32,
        bloom: fp.bloom * 0.55,
        halation: fp.halation * 0.38,
      },
      filmT.fbo,
    );

    const dpr = stage.dpr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const x = Math.round(rect.x * dpr);
    const y = canvas.height - Math.round(rect.y * dpr) - filmT.h;
    gl.viewport(x, y, filmT.w, filmT.h);
    gl.useProgram(blit.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform4f(blit.u.uRect, x, y, filmT.w, filmT.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const min = Math.round(t * 20);
    canvas.setAttribute("aria-valuenow", String(min));
    canvas.setAttribute("aria-valuetext", `${min} minutes after sunset`);
  };

  const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));

  stage.onFrame((dt, time) => {
    now = time;
    if (reveal) {
      reveal.t += dt;
      const k = easeOutExpo(Math.min(1, reveal.t / reveal.dur));
      st.target = reveal.to * k;
      exposureLift = 2.2 * (1 - easeOutExpo(Math.min(1, reveal.t / 2.0)));
      if (reveal.t >= reveal.dur) {
        reveal = null;
        exposureLift = 0;
      }
      dirty = true;
    }
    // The shown time follows its target on a spring (damping 0.86): firm
    // under the hand, a soft settle after a throw.
    const w = drag ? 22 : 10;
    const z = 0.86;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -2 * z * w * st.vel - w * w * (st.v - st.target);
      st.vel += a * h;
      st.v += st.vel * h;
    }
    if (Math.abs(st.v - st.target) < 1e-5 && Math.abs(st.vel) < 1e-4) {
      if (st.v !== st.target) dirty = true;
      st.v = st.target;
      st.vel = 0;
    } else dirty = true;
    checkStrikes(clamp(st.v, 0, 1));
    if (striking()) dirty = true;
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty && sceneT) {
      dirty = false;
      draw();
    }
  });
  void embedded;

  return {
    destroy() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      for (const t of [ambTex, emitTex, auxTex]) gl.deleteTexture(t);
      for (const t of [sceneT, filmT]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      film.destroy();
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
