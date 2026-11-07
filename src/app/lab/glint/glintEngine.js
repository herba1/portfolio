import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import META from "./meta.json";

// Glint: the pointer is the sun, over a worm's-eye photograph of glass towers.
//
// The bake (tools/depth/bakes/glint) reads Davi Rezende's photograph as what it
// is made of:
//  - the camera: the vertical vanishing point and a 14 mm-equivalent focal
//    length, both measured from the towers' own straight lines;
//  - every visible face as a plane: its normal from the face's horizontal
//    lines, squared up until its floors come out level when the face is
//    rectified onto its own plane;
//  - the curtain-wall grid of each face, measured in that rectified frame:
//    glass vs frame, and every pane a slightly different mirror (a random
//    tilt and an air-pillowed bow);
//  - diffuse albedo for frames and walls (the photo divided by its own sky
//    and sun light), roughness, a sky matte and cloud density;
//  - the sky dome: the photograph unprojected onto a stereographic disc
//    round the zenith, so a wall reflects the real clouds and towers on the
//    other side of the street.
//
// Live, per pixel: the wall's diffuse light turns with the sun (Lambert sun +
// skylight, the same law the albedo was divided by); glass reflects the sun
// disc through its own pane's normal with Fresnel, as a mirror widened only by
// the pixel's footprint and the pane's roughness; the sky round the sun (the
// aureole) and the sunward edges of the cumulus brighten with it, in the sky
// itself and in every reflection of it. Where the sun is in open sky it is
// drawn as a disc with the veiling glare of a sun nobody can look at, and
// each wall's mirror image of it veils the glass round it the same way, a
// tenth as bright; behind a tower the sun is hidden by the tower. At the
// photographer's sun the frame hands back to the photograph's own pixels.
// Then developed through the shared film kit (summer), whose halation and
// diffusion give the glint its bloom.
//
// Query: ?sun=x,y holds the sun at that point of the print (0..1, y down);
// ?sun=photo holds it at the photographer's sun; ?still=1 skips the reveal
// and the idle drift; ?film=0 shows the frame before the film.

const BASE = "/lab/glint/";
const [PW, PH] = META.plate;
const F = META.f;
const [CX, CY] = META.c;
const UP = META.up;
const SUN0 = META.sun0;
const NF = META.faces.length;
const LUMA = [0.2126, 0.7152, 0.0722];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// plate pixel -> camera-space direction (x right, y down, z forward)
const dirOf = (px, py) => norm([(px - CX) / F, (py - CY) / F, 1]);
const pxOf = (d) => [CX + (F * d[0]) / d[2], CY + (F * d[1]) / d[2]];
const SUN0_PX = pxOf(SUN0);

// Face table: normals and how glassy each kind of wall is at normal incidence.
const F0 = { glass: 0.07, punched: 0.05, stone: 0.04 };
const FACE_N = new Float32Array(NF * 3);
const FACE_K = new Float32Array(NF * 2);
META.faces.forEach((fc, i) => {
  FACE_N.set(fc.normal, i * 3);
  // dark bronze glass of the 1960s tower reflects more than clear glass
  const f0 = fc.name.startsWith("dark") ? 0.1 : F0[fc.kind] ?? 0.05;
  FACE_K.set([f0, fc.cyl ? 1 : 0], i * 2);
});
// Mean diffuse light over the walls, for the photographer-style exposure.
const AREA_W = META.faces.map((fc) => (fc.kind === "glass" ? 0.4 : 1));
// The most light any big wall gets: a photographer exposes so the brightest
// sunlit stone still holds.
const BIG = META.faces.map((fc) => !["octagon-a", "octagon-c", "round", "dark-side", "brown-side", "tower-a"].includes(fc.name));
const peakLight = (s) => {
  let m = 1;
  META.faces.forEach((fc, i) => {
    if (BIG[i]) m = Math.max(m, 0.9 + 5 * Math.max(0, dot3(fc.normal, s)));
  });
  return m;
};
const meanLight = (s) => {
  let a = 0;
  let w = 0;
  META.faces.forEach((fc, i) => {
    a += AREA_W[i] * (1 + 5 * Math.max(0, dot3(fc.normal, s)));
    w += AREA_W[i];
  });
  return a / w;
};

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto;
uniform sampler2D uAlb;
uniform sampler2D uGeo;
uniform sampler2D uMat;
uniform sampler2D uEnv;
uniform sampler2D uEnvM;
uniform sampler2D uPatch;
uniform vec2 uPlate;
uniform float uF;
uniform vec2 uC;
uniform vec3 uUp;
uniform vec3 uEX;
uniform vec3 uEZ;
uniform vec3 uS;      // sun now
uniform vec3 uS0;     // photographer's sun
uniform float uPhotoW; // 1 at the photographer's sun
uniform vec4 uPatchR; // x, y, w, h (plate px)
uniform vec3 uFaceN[${NF}];
uniform vec2 uFaceK[${NF}];
uniform float uExpo;
uniform float uSunL;
uniform float uDebug;
uniform vec3 uGlintD[2]; // where the sun's mirror image sits in the two brightest walls
uniform float uGlintK[2]; // and how bright it is there, in suns

const float SUN_R = 0.0047;   // angular radius of the sun, rad
const vec3 SKY_C = vec3(0.80, 0.90, 1.08); // skylight on a wall: blue
const vec3 SUN_C = vec3(1.0, 0.93, 0.82);  // the sun: warm
// Radiance of the sky round the sun, in units of the clear sky, against the
// angle from it: the solar aureole (forward scattering by haze and droplets)
// is tens of times the sky a few degrees out and falls off fast.
float aureole(float g) {
  return 26.0 * exp(-g / 0.018) + 5.0 * exp(-g / 0.07) + 0.9 * exp(-g / 0.3);
}

vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// the dome: stereographic round up, on the street grid's two horizontals
vec2 envUv(vec3 d) {
  float y = dot(d, uUp);
  vec2 q = vec2(dot(d, uEX), dot(d, uEZ)) / (1.0 + max(y, 0.0));
  return q * 0.5 + 0.5;
}

// Sky light that follows the sun: the aureole (forward scattering by haze,
// steep near the disc) and the cumulus, whose sunward edges catch the light
// and whose thin margins glow when the sun is behind them.
float skyGain(vec3 d, vec3 s) {
  float g = acos(clamp(dot(d, s), -1.0, 1.0));
  vec2 uv = envUv(d);
  vec4 m = texture(uEnvM, uv);
  float c = m.g;
  // density a little way toward the sun, in the dome's own plane
  vec2 to = envUv(normalize(d + (s - d) * 0.06)) - uv;
  float lt = length(to);
  vec2 dir = lt > 1e-6 ? to / lt : vec2(0.0);
  // compare smoothed density (a few texels), so a contrail or a wisp does
  // not turn into a drawn line
  float cs = textureLod(uEnvM, uv, 2.5).g;
  float c2 = textureLod(uEnvM, uv + dir * 0.008, 2.5).g;
  float edge = clamp(cs - c2, -0.5, 0.5);
  float aure = 1.4 * exp(-g / 0.05) + 0.42 * exp(-g / 0.3);
  float lining = 2.2 * c * (1.0 - c) * exp(-g / 0.18);
  return 1.0 + aure * (1.0 - 0.5 * c) + 0.55 * edge * c + lining;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uPlate;
  vec2 t = px / uPlate;
  vec3 v = normalize(vec3((px - uC) / uF, 1.0));

  vec3 photo = texture(uPhoto, t).rgb;
  // the photographer's glare, cut out once the sun moves off
  vec2 pq = (px - uPatchR.xy) / uPatchR.zw;
  if (all(greaterThanEqual(pq, vec2(0.0))) && all(lessThan(pq, vec2(1.0)))) {
    vec2 pt = vec2(pq.x * 0.5, pq.y);
    vec3 fill = texture(uPatch, pt).rgb;
    float pm = texture(uPatch, pt + vec2(0.5, 0.0)).r;
    photo = mix(photo, fill, pm * (1.0 - uPhotoW));
  }
  vec3 base = s2l(photo);

  vec4 geo = texture(uGeo, t);
  int id = int(geo.r * 255.0 + 0.5);
  float rough = geo.g;
  float skyM = geo.b;
  vec4 mt = texture(uMat, t);
  float glass = mt.b;

  // ---- sky: the photograph, relit by where the sun is now
  float gNow = skyGain(v, uS);
  float g0 = skyGain(v, uS0);
  vec3 sky = base * clamp(gNow / g0, 0.35, 3.0);
  // the disc itself, where open sky shows it (behind a tower, the tower wins)
  float gs = acos(clamp(dot(v, uS), -1.0, 1.0));
  float pxa = 1.0 / uF;
  float disc = 1.0 - smoothstep(SUN_R - pxa, SUN_R + pxa, gs);
  float limb = 0.6 + 0.4 * sqrt(max(0.0, 1.0 - (gs * gs) / (SUN_R * SUN_R)));
  float away = 1.0 - uPhotoW;
  sky += vec3(1.0, 0.97, 0.92) * uSunL * 0.12 * disc * limb * away;
  sky += vec3(0.62, 0.7, 0.78) * 0.05 * (aureole(gs) - 0.9 * exp(-gs / 0.3)) * away;

  // ---- towers
  vec3 col = sky;
  if (id < 255 && skyM < 0.999) {
    vec3 n0 = uFaceN[id];
    vec2 k = uFaceK[id];
    if (k.y > 0.5) {
      vec3 vh = v - dot(v, uUp) * uUp;
      n0 = -normalize(vh);
    }
    vec3 tH = normalize(cross(n0, uUp));
    float LIM = radians(2.0);
    vec2 j = (mt.rg * 2.0 - 1.0) * LIM;
    vec3 n = normalize(n0 + j.x * uUp + j.y * tH);

    // diffuse: skylight + sun on the face, the law the albedo was divided by
    vec3 e = SKY_C + 5.0 * max(dot(n0, uS), 0.0) * SUN_C;
    vec3 e0 = SKY_C + 5.0 * max(dot(n0, uS0), 0.0) * SUN_C;
    vec3 alb = s2l(texture(uAlb, t).rgb) * 2.0;
    vec3 wall = alb * e;
    vec3 photoWall = base;
    // a wall pixel is the photo times the change of light (exact at the
    // photographer's sun, and free of the albedo's 8-bit steps there)
    wall = mix(wall, photoWall * (e / e0), 0.6);

    // specular: the photo already holds the reflected sky; add what the sun
    // changes in it, and the sun's own mirror image
    vec3 r = reflect(v, n);
    float cosI = clamp(-dot(v, n), 0.0, 1.0);
    float f0 = mix(0.04, k.x, glass);
    float fr = f0 + (1.0 - f0) * pow(1.0 - cosI, 5.0);
    vec2 envT = envUv(r);
    vec3 envC = s2l(texture(uEnv, envT).rgb);
    float envSky = texture(uEnvM, envT).r;
    float gr = skyGain(r, uS) / skyGain(r, uS0) - 1.0;
    vec3 dE = envC * envSky * clamp(gr, -0.6, 2.5);

    // the sun's image: a disc, widened by roughness and by how far the
    // reflected ray turns across this pixel (pane edges, distance)
    float sr = rough * rough * 0.6;
    float fp = length(fwidth(r)) * 0.6;
    float sig2 = SUN_R * SUN_R * 0.5 + sr * sr + fp * fp;
    float th = acos(clamp(dot(r, uS), -1.0, 1.0));
    float lobe = (SUN_R * SUN_R * 0.5 / sig2) * exp(-th * th / (2.0 * sig2));
    // the sun must be in front of the face to be seen in it
    float front = smoothstep(-0.02, 0.05, dot(n0, uS));
    vec3 glint = vec3(1.0, 0.96, 0.9) * uSunL * lobe * front;
    // and the bright sky round it, through the same pane: this is what
    // spreads one glint into a patchwork of lit panes
    float ga = th;
    float gg = sqrt(ga * ga + sr * sr);
    vec3 aur = vec3(0.62, 0.7, 0.78) * 0.12 * (60.0 * exp(-gg / 0.025) + 12.0 * exp(-gg / 0.08) + 1.5 * exp(-gg / 0.3)) * front;

    vec3 spec = fr * (dE + glint + aur);
    vec3 glassC = base + spec;
    vec3 frameC = wall + spec * 0.6;
    vec3 tower = mix(frameC, glassC, glass);
    col = mix(tower, sky, skyM);
    if (uDebug > 0.5 && uDebug < 1.5) col = vec3(lobe, glass, fr);
    if (uDebug > 2.5) col = vec3(mt.r, mt.g, glass * 0.3);
  }
  // veiling glare: a sun in open sky is too bright to look at. Its light
  // scatters in the air, the lens and the emulsion into a broad warm bloom
  // that washes the sky round it, lifts the cloud beside it and veils the
  // towers in front, all from where the disc is. A tower over the disc takes
  // it away (the sky matte at the sun, over a few disc radii, says how much
  // of the sun shows).
  if (uS.z > 0.05) {
    vec2 sp = uC + uF * uS.xy / uS.z;
    float vis = 0.0;
    for (int i = 0; i < 9; i++) {
      float a = float(i) * 2.39996;
      float rr = (i == 0 ? 0.0 : sqrt(float(i) / 8.0)) * SUN_R * uF * 2.5;
      vec2 q = (sp + rr * vec2(cos(a), sin(a))) / uPlate;
      float inP = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
      vis += inP * texture(uGeo, q).b;
    }
    vis = smoothstep(0.1, 0.9, vis / 9.0) * away;
    float veil = 7.0 * exp(-gs / 0.01) + 1.4 * exp(-gs / 0.045) + 0.32 * exp(-gs / 0.16) + 0.06 * exp(-gs / 0.5);
    col += vec3(1.0, 0.95, 0.86) * veil * vis;
  }
  // and the sun's mirror image in a curtain wall is a second sun, a tenth as
  // bright: it veils the panes and the sky round it the same way, so the
  // glint blooms instead of sitting in the glass as a pattern
  for (int k = 0; k < 2; k++) {
    float gk = acos(clamp(dot(v, uGlintD[k]), -1.0, 1.0));
    float gv = 2.2 * exp(-gk / 0.03) + 0.5 * exp(-gk / 0.08);
    col += vec3(1.0, 0.93, 0.82) * gv * uGlintK[k] * away;
  }
  if (uDebug > 1.5 && uDebug < 2.5) col = vec3(gNow / g0 * 0.5, texture(uEnvM, envUv(v)).g, texture(uEnvM, envUv(v)).r);
  outColor = vec4(col * uExpo, 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
uniform float uRaw;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  if (uRaw > 0.5) c = mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
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

function imageTexture(gl, img, { mips = false, nearest = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
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
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createGlint(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const sunQ = q.get("sun");
  let heldPx = null;
  if (sunQ === "photo") heldPx = SUN0_PX.slice();
  else if (sunQ) {
    const [a, b] = sunQ.split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) heldPx = [a * PW, b * PH];
  }
  const held = heldPx != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const debug = q.get("debug") ? +q.get("debug") : 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");

  const files = ["photo.webp", "albedo.webp", "geo.webp", "mat.webp", "env.webp", "envmask.webp", "patch.webp"];
  const imgs = await Promise.all(files.map((f) => loadImage(BASE + f)));
  // face ids and glass at a quarter of the plate, to find on the CPU where
  // the sun's mirror image lands in each wall
  const GQ = 4;
  const GW = Math.round(PW / GQ);
  const GH = Math.round(PH / GQ);
  const readSmall = (img) => {
    const c = document.createElement("canvas");
    c.width = GW;
    c.height = GH;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, GW, GH);
    return x.getImageData(0, 0, GW, GH).data;
  };
  const geoPx = readSmall(imgs[2]);
  const matPx = readSmall(imgs[3]);
  const T0 = {
    photo: imageTexture(gl, imgs[0], { mips: true }),
    alb: imageTexture(gl, imgs[1], { mips: true }),
    geo: imageTexture(gl, imgs[2], { nearest: true }),
    mat: imageTexture(gl, imgs[3], { nearest: true }),
    env: imageTexture(gl, imgs[4], { mips: true }),
    envm: imageTexture(gl, imgs[5], { mips: true }),
    patch: imageTexture(gl, imgs[6]),
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = { scene: program(gl, VERT, SCENE), blit: program(gl, VERT, BLIT) };
  const film = createFilm(gl, { width: 2, height: 2 });

  // The print: the whole 3:4 plate, as tall as the box allows.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  const T = { scene: null, film: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      const w = Math.min(W, H * ar);
      Object.assign(L, { w, h: w / ar });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = Math.min(W - side * 2, (H - 96) * ar);
      Object.assign(L, { w, h: w / ar });
    } else {
      const h = Math.min(H * 0.84, (W - 48) / ar);
      Object.assign(L, { w: h * ar, h });
    }
    L.x = Math.round(((W - L.w) / 2) * dpr) / dpr;
    L.y = Math.round(((H - L.h) / 2) * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph, floatOk);
    if (!T.scene.ok) {
      freeTarget(gl, T.scene);
      T.scene = target(gl, L.pw, L.ph, false);
    }
    T.film = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // ---- the sun: a goal in plate pixels, followed on a critically damped-ish
  // spring; idle, it drifts slowly along the arc a summer sun would take
  const toPlate = (p) => [((p.x - L.x) / L.w) * PW, ((p.y - L.y) / L.h) * PH];
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  // opening walk: from the photographer's sun round toward the lattice's
  // crown, where the street's walls catch it
  // (behind the lattice, where the bronze tower across the street catches it)
  const OPEN = [0.2 * PW, 0.3 * PH];
  let goal = held ? heldPx.slice() : SUN0_PX.slice();
  let sun = goal.slice();
  let vel = [0, 0];
  let touched = held;
  let rest = OPEN.slice();
  let lastHand = -1e9;

  stage.on("move", (p) => {
    if (held || !inPrint(p)) return;
    touched = true;
    goal = toPlate(p);
    lastHand = performance.now();
  });
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    touched = true;
    goal = toPlate(p);
    lastHand = performance.now();
  });

  let seed = 0;
  let grainClock = 0;
  let t0 = -1;
  let lastSunKey = "";

  // The two brightest mirror images of the sun: for each flat wall lit from
  // the front, the direction the sun is seen in it, and how much lit glass of
  // that wall is round that point (Fresnel x glass share).
  const glintD = new Float32Array(6);
  const glintK = new Float32Array(2);
  const findGlints = (s) => {
    const best = [];
    META.faces.forEach((fc, i) => {
      if (fc.cyl) return;
      const n = fc.normal;
      const c = dot3(n, s);
      if (c < 0.03) return;
      const d = [s[0] - 2 * c * n[0], s[1] - 2 * c * n[1], s[2] - 2 * c * n[2]];
      if (d[2] < 0.05) return;
      const [px, py] = pxOf(d);
      const gx = Math.round(px / GQ);
      const gy = Math.round(py / GQ);
      let sum = 0;
      let cnt = 0;
      for (let y = gy - 4; y <= gy + 4; y++) {
        for (let x = gx - 4; x <= gx + 4; x++) {
          cnt++;
          if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
          const o = (y * GW + x) * 4;
          if (geoPx[o] === i && geoPx[o + 2] < 128) sum += matPx[o + 2] / 255;
        }
      }
      if (!sum) return;
      const f0 = FACE_K[i * 2];
      const fr = f0 + (1 - f0) * Math.pow(1 - c, 5);
      best.push({ d, k: 4 * fr * (sum / cnt) });
    });
    best.sort((a, b) => b.k - a.k);
    for (let k = 0; k < 2; k++) {
      const g = best[k];
      glintD.set(g ? g.d : [0, 0, -1], k * 3);
      glintK[k] = g ? g.k : 0;
    }
  };

  const draw = (expoStops, fade) => {
    const s = dirOf(sun[0], sun[1]);
    const ang = Math.acos(clamp(dot3(s, SUN0), -1, 1));
    const photoW = Math.exp(-((ang / 0.012) ** 2));
    // exposure follows the light half way, as a photographer would
    const pk = peakLight(SUN0) / peakLight(s);
    const expo = Math.pow(meanLight(SUN0) / meanLight(s), 0.5) * Math.pow(Math.min(1, pk), 0.7) * 2 ** expoStops;

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    const u = P.scene.u;
    gl.useProgram(P.scene.p);
    bindTex(0, T0.photo, u.uPhoto);
    bindTex(1, T0.alb, u.uAlb);
    bindTex(2, T0.geo, u.uGeo);
    bindTex(3, T0.mat, u.uMat);
    bindTex(4, T0.env, u.uEnv);
    bindTex(5, T0.envm, u.uEnvM);
    bindTex(6, T0.patch, u.uPatch);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1f(u.uF, F);
    gl.uniform2f(u.uC, CX, CY);
    gl.uniform3fv(u.uUp, UP);
    gl.uniform3fv(u.uEX, META.ex);
    gl.uniform3fv(u.uEZ, META.ez);
    gl.uniform3fv(u.uS, s);
    gl.uniform3fv(u.uS0, SUN0);
    gl.uniform1f(u.uPhotoW, photoW);
    gl.uniform4fv(u.uPatchR, META.patch);
    gl.uniform3fv(u.uFaceN, FACE_N);
    gl.uniform2fv(u.uFaceK, FACE_K);
    gl.uniform1f(u.uExpo, expo);
    gl.uniform1f(u.uSunL, 1200);
    gl.uniform1f(u.uDebug, debug);
    findGlints(s);
    gl.uniform3fv(u.uGlintD, glintD);
    gl.uniform1fv(u.uGlintK, glintK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const linear = floatOk && T.scene.ok;
    if (!raw && !debug) {
      film.render(
        T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          // The scan already carries its grade; the film adds the optics.
          headroom: linear ? 0 : 1.2,
          contrast: 1.06,
          toe: 0.012,
          saturation: 1.04,
          blueDepth: 0.45,
          shadowTint: [0.97, 1, 1.03],
          highlightTint: [0.99, 1, 1.01],
          whitePoint: 1.18,
          shoulder: 0.92,
          halation: 0.7,
          halationThreshold: 1.1,
          bloom: 0.24,
          softness: 0.45,
          vignette: 0.18,
          grain: 0.3,
          input: linear ? "linear" : "srgb",
          grainSeed: seed,
        },
        T.film.fbo,
      );
      gl.bindVertexArray(vao);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(P.blit.p);
    bindTex(0, raw || debug ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform1f(P.blit.u.uRaw, (raw || debug) && linear ? 1 : 0);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up two stops over, an airy white-blue, and
  // settles; then the sun walks off the photographer's spot to show it can.
  const REVEAL = 2.0;
  const WALK_AT = 0.8;
  const WALK = 2.2;
  let lastNow = 0;
  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now();
    lastNow = now;
    if (t0 < 0) t0 = now / 1000;
    const age = still ? 99 : now / 1000 - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.0 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held) {
      if (!touched) {
        const k = reduce ? 0 : expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
        goal = [SUN0_PX[0] + (OPEN[0] - SUN0_PX[0]) * k, SUN0_PX[1] + (OPEN[1] - SUN0_PX[1]) * k];
        if (k >= 1) rest = OPEN.slice();
      } else if (!stage.pointer.inside && !stage.pointer.down && now - lastHand > 2500) {
        rest = goal.slice();
      }
      // idle: a slow drift along the sun's arc, ~1% of the frame per second
      const idle = (!touched && age > WALK_AT + WALK) || (touched && !stage.pointer.inside && now - lastHand > 2500);
      if (idle && !reduce && !still) {
        const tt = now / 1000;
        goal = [rest[0] + 70 * Math.sin(tt / 6.5), rest[1] + 40 * Math.sin(tt / 9.1 + 0.7)];
      }
    }
    let moving = false;
    if (held) sun = goal.slice();
    else {
      // spring: damping ratio 0.85, ~0.35 s to settle
      const w = 14;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        for (let a = 0; a < 2; a++) {
          const acc = w * w * (goal[a] - sun[a]) - 2 * z * w * vel[a];
          vel[a] += acc * h;
          sun[a] += vel[a] * h;
        }
      }
      moving = Math.hypot(goal[0] - sun[0], goal[1] - sun[1]) > 0.05 || Math.hypot(vel[0], vel[1]) > 0.05;
    }

    let tick = false;
    if (!still && !reduce) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    const key = `${sun[0].toFixed(2)},${sun[1].toFixed(2)}`;
    if (!dirty && !moving && !tick && !revealing && key === lastSunKey) return;
    lastSunKey = key;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      Object.values(T0).forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
