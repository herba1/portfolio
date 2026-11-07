import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Tenki: lying under a wooden utility pole and looking up it, its wires
// crossing over you, and the weather changing overhead. Drag across and the
// sky becomes another real, recorded sky (five Poly Haven HDRIs, CC0: a clear
// low-sun sky, high cirrus, a mackerel sky of altocumulus, fair-weather
// cumulus, and building cumulus), and the pole, the crossarm and the cables are
// lit by that sky and no other:
//
//  - The photograph is taken apart offline (tools/depth/bakes/tenki): a sky
//    matte that keeps every wire (thin-structure trimap, then colour-line
//    unmixing between the local sky and the local cable colour, in linear
//    light), the foreground decontaminated of its old sky, MoGe-2 normals and
//    metric depth, and the photo's own light on the pole fitted as a function
//    of the normal so it can be divided out (albedo = I / S_orig).
//  - Each sky is rendered through the photo's lens (MoGe-2's focal length, the
//    pole's axis as the vertical) and reduced to light: SH9 irradiance of the
//    sky plus a sunlit ground, and the sun's direction, irradiance and angular
//    spread. The foreground is albedo x (SH9(n) + sun max(n.l, 0) x shadow),
//    with shadows marched through the depth map toward that sky's sun.
//  - Between two skies everything is a crossfade of light: the sky radiance,
//    the irradiance and both suns add with weights, in linear light, so the
//    terminator on the pole and the shadows of the cables fade across rather
//    than slide.
//
// Query: ?sky=0..4 holds the weather (fractions are mid-crossfade);
// ?still=1 skips the reveal; ?grain=0 for static grain.

const BASE = "/lab/tenki/";
const SKY_FILES = ["clear", "cirrus", "mackerel", "cumulus", "tower"];
const START = 3;
// Exposure: each sky is first exposed for its own sky (median at the photo's
// sky value); then the camera meets the pole half way, the way a negative is
// exposed for the whole frame. 0 = expose for the sky, 1 = for the pole.
const METER = 0.5;
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
// Print: 4:3, cropped a little into the photo so the frame can breathe.
const PRINT_ASPECT = 4 / 3;
const CROP = 0.965;

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
uniform sampler2D uFg;    // rgb: foreground (sRGB texture -> linear), a: coverage
uniform sampler2D uNd;    // rgb: camera normal * .5 + .5, a: log depth
uniform sampler2D uSky0;
uniform sampler2D uSky1;
uniform vec4 uCrop;       // photo uv (y down) = (x, 1 - y) * crop.xy + crop.zw
uniform vec2 uSize;       // photo px
uniform float uFx;
uniform float uMargin;
uniform vec2 uZ;          // zNear, zFar (m)
uniform mat3 uR;          // camera -> heading frame (y up)
uniform vec3 uUp;         // world up, camera space
uniform float uDrift;     // sky yaw drift (rad)
uniform vec3 uSH[9];      // combined irradiance, photo units
uniform vec3 uSunDir[2];  // camera space
uniform vec3 uSunE[2];    // photo units (weights folded in)
uniform float uSunSoft[2];
uniform vec2 uSkyK;       // sky gains (weights folded in)
uniform float uSHo[9];    // the photo's own light (luminance): sky part
uniform vec3 uSunO;       // and its sun, camera space
uniform float uSunOK;
uniform float uExpo;      // reveal exposure, linear factor
uniform float uLinearOut;


vec3 shEval(vec3 d) {
  float x = d.x, y = d.y, z = d.z;
  return uSH[0] * 0.282095
    + uSH[1] * (0.488603 * y) + uSH[2] * (0.488603 * z) + uSH[3] * (0.488603 * x)
    + uSH[4] * (1.092548 * x * y) + uSH[5] * (1.092548 * y * z)
    + uSH[6] * (0.315392 * (3.0 * y * y - 1.0))
    + uSH[7] * (1.092548 * x * z) + uSH[8] * (0.546274 * (x * x - z * z));
}

float shEvalO(vec3 d) {
  float x = d.x, y = d.y, z = d.z;
  return uSHo[0] * 0.282095
    + uSHo[1] * (0.488603 * y) + uSHo[2] * (0.488603 * z) + uSHo[3] * (0.488603 * x)
    + uSHo[4] * (1.092548 * x * y) + uSHo[5] * (1.092548 * y * z)
    + uSHo[6] * (0.315392 * (3.0 * y * y - 1.0))
    + uSHo[7] * (1.092548 * x * z) + uSHo[8] * (0.546274 * (x * x - z * z));
}

vec3 decodeSky(vec3 v) {
  vec3 p = min(pow(v, vec3(2.2)), vec3(0.996));
  return p / (1.0 - p);
}

// rotate v about axis k by angle a (Rodrigues)
vec3 rot(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

float depthAt(vec2 uv) {
  float l = texture(uNd, uv).a;
  return uZ.x * pow(uZ.y / uZ.x, l);
}

vec2 project(vec3 P) {
  return vec2(0.5 * uSize.x + uFx * P.x / -P.z, 0.5 * uSize.y - uFx * P.y / -P.z) / uSize;
}

// Sun visibility through the depth map: march toward the sun in camera space;
// a cable or the crossarm is in the way when the depth there is nearer than the
// ray and within a plausible thickness.
float sunVis(vec3 P, vec3 L, float soft, vec2 jit) {
  vec3 t1 = normalize(cross(L, vec3(0.0, 0.0, 1.0)));
  vec3 t2 = cross(L, t1);
  float vis = 0.0;
  for (int k = 0; k < 3; k++) {
    float ang = 6.2831853 * (float(k) / 3.0 + jit.x);
    vec3 Lk = normalize(L + (t1 * cos(ang) + t2 * sin(ang)) * soft);
    float occ = 0.0;
    float t = 0.03 + 0.02 * jit.y;
    for (int i = 0; i < 14; i++) {
      vec3 Q = P + Lk * t;
      if (Q.z > -0.05) break;
      vec2 uv = project(Q);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      vec4 f = texture(uFg, uv);
      float zq = depthAt(uv);
      float dz = -Q.z - zq;
      occ = max(occ, f.a * step(0.02 + 0.02 * t, dz) * step(dz, 0.6));
      t *= 1.32;
    }
    vis += 1.0 - occ;
  }
  return vis / 3.0;
}

void main() {
  vec2 pu = vec2(vUv.x, 1.0 - vUv.y) * uCrop.xy + uCrop.zw;
  vec2 px = pu * uSize;
  vec3 d = normalize(vec3((px.x - 0.5 * uSize.x) / uFx, -(px.y - 0.5 * uSize.y) / uFx, -1.0));

  // sky: the same lens, drifting slowly about the vertical
  vec3 ds = rot(d, uUp, uDrift);
  vec2 su = vec2(0.5) + vec2(ds.x / -ds.z, -ds.y / -ds.z) * uFx / uSize / uMargin;
  su = clamp(su, vec2(0.001), vec2(0.999));
  vec3 sky = decodeSky(texture(uSky0, su).rgb) * uSkyK.x + decodeSky(texture(uSky1, su).rgb) * uSkyK.y;

  vec4 f = texture(uFg, pu);
  vec3 col = sky;
  if (f.a > 0.002) {
    vec4 nd = texture(uNd, pu);
    vec3 n = normalize(nd.rgb * 2.0 - 1.0);
    float z = uZ.x * pow(uZ.y / uZ.x, nd.a);
    vec3 P = d * (z / -d.z);
    // the photo's own light, divided out (grey; the albedo keeps its colour)
    float So = max(shEvalO(uR * n) + uSunOK * max(dot(n, uSunO), 0.0), 1e-4);
    vec3 albedo = f.rgb / So; // the sRGB texture decodes to linear
    vec3 E = max(shEval(uR * n), vec3(0.0));
    vec2 jit = fract(px * vec2(0.0671, 0.0583) + vec2(0.31, 0.77) * fract(px.yx * 0.0137));
    for (int k = 0; k < 2; k++) {
      float e = dot(uSunE[k], vec3(0.2126, 0.7152, 0.0722));
      if (e <= 1e-6) continue;
      vec3 L = uSunDir[k];
      float s = uSunSoft[k];
      float ndl = clamp((dot(n, L) + s) / (1.0 + s), 0.0, 1.0);
      if (ndl <= 0.0) continue;
      float v = sunVis(P, L, 0.01 + s * 0.6, jit);
      E += uSunE[k] * ndl * v;
    }
    vec3 fgc = albedo * E;
    col = mix(sky, fgc, f.a);
  }
  col *= uExpo;
  if (uLinearOut < 0.5) col = pow(col / (1.0 + col), vec3(1.0 / 2.2));
  outColor = vec4(col, 1.0);
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

const RAW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 2.0;
  outColor = vec4(pow(c / (1.0 + c), vec3(1.0 / 2.2)), 1.0);
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

function imageTexture(gl, img, { srgb = false, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
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
const LUM = [0.2126, 0.7152, 0.0722];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// R maps camera -> heading; its transpose maps heading -> camera.
const tmul = (R, v) => [0, 1, 2].map((i) => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]);

export async function createTenki(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const skyQ = q.get("sky");
  const held = skyQ != null && skyQ !== "" && Number.isFinite(+skyQ);
  const still = held || q.get("still") === "1";
  const grainOn = q.get("grain") !== "0";
  const raw = q.get("raw") === "1";
  // ?hal= / ?bloom= / ?expo= tune the print while looking at a still
  const dev = {};
  for (const [k, key] of [["hal", "halation"], ["bloom", "bloom"], ["expo", "exposure"], ["blue", "blueDepth"], ["soft", "softness"], ["sat", "saturation"]]) if (q.get(k) != null) dev[key] = +q.get(k);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  stage.canvas.style.cursor = "grab";

  const [data, fgImg, ndImg, ...skyImgs] = await Promise.all([
    fetch(`${BASE}tenki.json`).then((r) => r.json()),
    loadImage(`${BASE}fg.webp`),
    loadImage(`${BASE}nd.webp`),
    ...SKY_FILES.map((n) => loadImage(`${BASE}sky-${n}.webp`)),
  ]);
  const fgTex = imageTexture(gl, fgImg, { srgb: true });
  const ndTex = imageTexture(gl, ndImg, { mips: false });
  const skyTex = skyImgs.map((img) => imageTexture(gl, img));
  const N = skyTex.length;

  // Per-sky light in photo units, and the camera's exposure for each sky.
  const R = data.R;
  const up = tmul(R, [0, 1, 0]);
  const skies = data.skies.map((s) => ({ ...s, ePoleL: dot3(s.ePole, LUM) }));
  const geo = Math.exp(skies.reduce((a, s) => a + Math.log(s.ePoleL), 0) / N);
  for (const s of skies) {
    s.expo = Math.pow(s.ePoleL / geo, -METER);
    s.sunCam = tmul(R, s.sun);
    s.soft = clamp(Math.sin((s.spread * Math.PI) / 180) * 3, 0, 0.35);
  }
  const sunO = tmul(R, data.orig.sun);
  const cal = data.fitMean / (skies.reduce((a, s) => a + s.ePoleL * s.expo, 0) / N);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const rawP = program(gl, VERT, RAW);
  const film = createFilm(gl, { width: 2, height: 2 });

  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2 };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      const narrow = W / H < 0.9;
      const side = narrow ? 16 : Math.max(24, W * 0.07);
      let w = W - side * 2;
      let h = w / PRINT_ASPECT;
      const hMax = H * (narrow ? 0.62 : 0.8);
      if (h > hMax) {
        h = hMax;
        w = h * PRINT_ASPECT;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // ---- the weather: one continuous position s in [0, N - 1]
  let s = held ? clamp(+skyQ, 0, N - 1) : START;
  let vel = 0; // skies per second
  let dragging = false;
  let last = null;
  const perSky = () => Math.max(120, L.w / (N - 1)) * 1.15; // px of drag per sky

  stage.on("down", (p) => {
    dragging = true;
    vel = 0;
    last = { x: p.x, t: performance.now() };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging || !last) return;
    const now = performance.now();
    let ds = (p.x - last.x) / perSky();
    // rubber band past the first and last sky
    if ((s <= 0 && ds < 0) || (s >= N - 1 && ds > 0)) ds *= 0.4;
    s += ds;
    const dt = Math.max(1, now - last.t) / 1000;
    vel += (ds / dt - vel) * Math.min(1, dt / 0.05);
    last = { x: p.x, t: now };
    dirty = true;
  });
  stage.on("up", () => {
    dragging = false;
    stage.canvas.style.cursor = "grab";
    if (last && performance.now() - last.t > 60) vel = 0;
    last = null;
  });
  host.tabIndex = embedded ? -1 : 0;
  let goal = null;
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const base = goal ?? Math.round(s);
    goal = clamp(base + (e.key === "ArrowRight" ? 1 : -1), 0, N - 1);
    dirty = true;
  };
  host.addEventListener("keydown", onKey);

  // uniforms for the light at position s
  const SH = new Float32Array(27);
  const sunDir = new Float32Array(6);
  const sunE = new Float32Array(6);
  const sunSoft = new Float32Array(2);
  const lightAt = (pos) => {
    const p = clamp(pos, 0, N - 1);
    const i0 = Math.min(N - 2, Math.floor(p));
    const w = p - i0;
    const a = skies[i0];
    const b = skies[i0 + 1];
    // one camera: exposure blends in stops; the light adds in linear units
    const expo = Math.exp((1 - w) * Math.log(a.expo) + w * Math.log(b.expo));
    const ka = (1 - w) * a.scale * expo * cal;
    const kb = w * b.scale * expo * cal;
    for (let i = 0; i < 9; i++)
      for (let c = 0; c < 3; c++) SH[i * 3 + c] = a.sh[i][c] * ka + b.sh[i][c] * kb;
    for (let c = 0; c < 3; c++) {
      sunDir[c] = a.sunCam[c];
      sunDir[3 + c] = b.sunCam[c];
      sunE[c] = a.sunE[c] * ka;
      sunE[3 + c] = b.sunE[c] * kb;
    }
    sunSoft[0] = a.soft;
    sunSoft[1] = b.soft;
    // sky: decoded x = L K (median .5); shown at the photo's sky median, times the exposure
    const g = (data.skyMed / 0.5) * expo;
    return { i0, skyK: [(1 - w) * g, w * g] };
  };

  let time = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    const [PW, PH] = data.size;
    const photoA = PW / PH;
    const pa = L.pw / L.ph;
    let sx;
    let sy;
    if (pa >= photoA) {
      sx = CROP;
      sy = (CROP * photoA) / pa;
    } else {
      sy = CROP;
      sx = (CROP * pa) / photoA;
    }
    const br = reduce || still ? [0, 0] : [Math.sin(time * ((2 * Math.PI) / 11)) * 0.0022, Math.sin(time * ((2 * Math.PI) / 13.7) + 1.1) * 0.0018];
    const ox = clamp(0.5 - sx / 2 + br[0], 0, 1 - sx);
    const oy = clamp(0.5 - sy / 2 + br[1], 0, 1 - sy);
    const drift = reduce || still ? 0 : (Math.sin((time * 2 * Math.PI) / 150) * 1.4 * Math.PI) / 180;

    const lt = lightAt(s);
    const u = scene.u;
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fgTex);
    gl.uniform1i(u.uFg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ndTex);
    gl.uniform1i(u.uNd, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, skyTex[lt.i0]);
    gl.uniform1i(u.uSky0, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, skyTex[lt.i0 + 1]);
    gl.uniform1i(u.uSky1, 3);
    gl.uniform4f(u.uCrop, sx, sy, ox, oy);
    gl.uniform2f(u.uSize, PW, PH);
    gl.uniform1f(u.uFx, data.fx);
    gl.uniform1f(u.uMargin, data.margin);
    gl.uniform2f(u.uZ, data.zNear, data.zFar);
    // GLSL mat3 is column-major: column j = R^T row j... uR * n must be R n.
    gl.uniformMatrix3fv(u.uR, false, new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]));
    gl.uniform3fv(u.uUp, up);
    gl.uniform1f(u.uDrift, drift);
    gl.uniform3fv(u.uSH, SH);
    gl.uniform3fv(u.uSunDir, sunDir);
    gl.uniform3fv(u.uSunE, sunE);
    gl.uniform1fv(u.uSunSoft, sunSoft);
    gl.uniform2f(u.uSkyK, lt.skyK[0], lt.skyK[1]);
    gl.uniform1fv(u.uSHo, data.orig.sh);
    gl.uniform3fv(u.uSunO, sunO);
    gl.uniform1f(u.uSunOK, data.orig.sunK);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.uniform1f(u.uLinearOut, floatOk && sceneT.ok ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (raw) {
      // ?raw=1: the scene with a plain x/(1+x) curve, no film (to check the light)
      gl.bindFramebuffer(gl.FRAMEBUFFER, filmT.fbo);
      gl.viewport(0, 0, L.pw, L.ph);
      gl.useProgram(rawP.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
      gl.uniform1i(rawP.u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        ...FILM,
        ...dev,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
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
  // Settling: a critically damped-ish spring (zeta ~ .85) to the nearest sky.
  const OMEGA = 7.5;
  const ZETA = 0.85;

  stage.onFrame((dt) => {
    if (!sceneT) return;
    time += dt;
    if (t0 < 0) t0 = time;
    const age = time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
      if (age < REVEAL + 0.1) dirty = true;
    }

    if (!dragging && !held) {
      if (goal == null && Math.abs(vel) > 0.05) {
        // carried by the throw, with friction
        s += vel * dt;
        vel *= Math.exp(-dt / 0.22);
        if (s < 0 || s > N - 1) vel *= Math.exp(-dt / 0.06);
        dirty = true;
      } else {
        const target = goal ?? clamp(Math.round(s), 0, N - 1);
        const x = s - target;
        if (Math.abs(x) > 1e-4 || Math.abs(vel) > 1e-4) {
          const acc = -OMEGA * OMEGA * x - 2 * ZETA * OMEGA * vel;
          vel += acc * dt;
          s += vel * dt;
          dirty = true;
        } else {
          s = target;
          vel = 0;
          goal = null;
        }
      }
    }

    if (!reduce && !still) {
      // the sky drifts, the frame breathes and the grain moves: at rest that
      // is a 24 fps film frame, not 60
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        if (grainOn) grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      for (const t of [fgTex, ndTex, ...skyTex]) gl.deleteTexture(t);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteProgram(rawP.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}

// The print: Superia-ish summer, developed from a linear render. The scene
// already sits on the photo's own exposure, so the curve is gentle; the sky's
// depth comes from the bake's polariser and blueDepth here.
const FILM = {
  headroom: 0,
  exposure: 0.35,
  whitePoint: 3.2,
  contrast: 1.12,
  shoulder: 0.94,
  blueDepth: 0.5,
  saturation: 1.12,
  halation: 0.16,
  halationThreshold: 0.85,
  halationLocal: 0,
  bloom: 0.12,
  softness: 0.45,
  toe: 0.05,
  grain: 0.32,
  vignette: 0.18,
};
