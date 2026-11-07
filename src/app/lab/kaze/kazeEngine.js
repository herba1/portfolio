import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createWind, GX, GY, GY0 } from "./wind";

// Kaze: a highland meadow in July (Kirigamine, Nagano), and the wind is yours.
//
// Brush across the grass and the stroke becomes a gust: a small stable-fluids
// velocity field (wind.js) carries it out across the field, slowing and
// narrowing with distance, and the grass lies over under it and springs back.
// What makes wind on grass visible from far away is not the bending itself but
// honami, the bright waves where bent blades turn their glossy faces to the
// sky. Here that is an anisotropic (Kajiya-Kay) sheen on each blade's tangent:
// the canopy normal from MoGe-2 tilted by the local bend, lit by the sun and
// seen from the camera, applied as the change from the blade at rest, so the
// still meadow is exactly the photograph.
//
// The motion is drawn with two-phase flow maps (Vlachos 2010): fine gust
// streaks in the grass and the cumulus behind are advected by their velocity
// fields in two copies half a period apart and cross-faded, so nothing smears
// or seams however long it runs. The clouds drift by distance (overhead ones
// fastest, the ones on the skyline barely), and lean a little after your gusts.
//
// Query: ?gust=demo throws a scripted gust; ?t=seconds runs the wind that long
// at a fixed step and holds it (a still); ?breeze=0..2 scales the idle air;
// ?still=1 skips the reveal; ?debug=bend shows the bend field.

const PLATE = "/lab/kaze/plate.webp";
const SKY = "/lab/kaze/sky.webp";
const AUX = "/lab/kaze/aux.png";
const NRM = "/lab/kaze/normal.webp";
const SKY_H = 0.64; // the sky plate covers the top 64% of the frame
const ASPECT = 1.5;

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
uniform sampler2D uPlate;
uniform sampler2D uSky;
uniform sampler2D uAux;
uniform sampler2D uNrm;
uniform sampler2D uWind;   // GX x GY: bend.xz, wind.xz (m/s)
uniform float uTime;
uniform float uCloudT;     // cloud flow clock
uniform vec2 uCloudV;      // cloud drift at the zenith side, uv / s
uniform float uExpo;
uniform float uLod;
uniform float uRW;      // render width, px
uniform float uDebug;
uniform vec4 uView;      // the part of the image on screen: x0, y0, w, h (uv)
uniform vec2 uDir;       // smoothed mean wind direction (streak orientation)

const vec2 GRID = vec2(${GX}.0, ${GY}.0);
const float GY0 = ${GY0.toFixed(3)};
const float SKY_H = ${SKY_H.toFixed(3)};

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// Cubic B-spline sample of the wind grid from four bilinear taps, so the
// 96x40 field has no visible cells or creases in the sheen.
vec4 windAt(vec2 uv) {
  vec2 g = vec2(uv.x, (uv.y - GY0) / (1.0 - GY0)) * GRID - 0.5;
  vec2 i = floor(g);
  vec2 f = g - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / s0 + 0.5) / GRID;
  vec2 h1 = (i + 1.0 + w3 / s1 + 0.5) / GRID;
  return (texture(uWind, vec2(h0.x, h0.y)) * s0.x + texture(uWind, vec2(h1.x, h0.y)) * s1.x) * s0.y
       + (texture(uWind, vec2(h0.x, h1.y)) * s0.x + texture(uWind, vec2(h1.x, h1.y)) * s1.x) * s1.y;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
// Gust bands on the ground: the canopy's mixing-layer eddies roll over it as
// waves across the wind, ~3.4 m apart, wandering in phase and broken into
// finite crests.
float streaks(vec2 P, vec2 dir) {
  vec2 q = vec2(dot(P, dir), dot(P, vec2(-dir.y, dir.x)));
  float ph = q.x / 3.4 + 1.7 * vnoise(q * vec2(1.0 / 6.0, 1.0 / 9.0));
  float band = 0.5 + 0.5 * sin(6.2831853 * ph);
  band *= band;
  float env = smoothstep(0.25, 0.75, vnoise(q * vec2(1.0 / 7.0, 1.0 / 13.0) + 5.3));
  return clamp(band * (0.35 + 0.65 * env) + 0.15 * env, 0.0, 1.0);
}

// Kajiya-Kay sheen of a blade with tangent T.
float sheen(vec3 T, vec3 H, float e) {
  float th = dot(T, H);
  return pow(max(1.0 - th * th, 0.0), e * 0.5);
}

void main() {
  vec2 uv = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;
  vec4 aux = texture(uAux, uv);
  float p = aux.r;        // perspective scale, 1 at the nearest grass
  float skyM = aux.g;
  float comp = aux.b;     // how freely it moves (grass 1, trees ~0.1)

  vec3 col;
  float bendMag = 0.0;

  // ---- ground ----
  vec3 ground = vec3(0.0);
  if (skyM < 0.999) {
    vec4 W = uv.y > GY0 ? windAt(uv) : vec4(0.0);
    vec2 b = W.xy;        // bend: across, into the field
    vec2 w = W.zw;        // wind, m/s
    float pc = max(p, 0.03);
    float ws = length(w);
    // Streaks are oriented by the mean wind, not the local one: rotating a
    // pattern by a direction that varies in space tears it.
    vec2 wd = uDir;

    // Ground position (m): across, and distance.
    vec2 P = vec2((uv.x - 0.5) * ${GX}.0 / (5.6 * pc), 8.0 / pc);
    // Two-phase flow map: the streak pattern rides the wind; two copies half
    // a period apart, each reset while its weight is zero.
    const float PER = 1.6;
    float t0 = fract(uTime / PER);
    float t1 = fract(uTime / PER + 0.5);
    float n0 = streaks(P - w * (t0 * PER), wd);
    float n1 = streaks(P + vec2(31.7, 11.3) - w * (t1 * PER), wd);
    float wt = abs(1.0 - 2.0 * t0);
    float n = mix(n1, n0, wt);
    // Fade the streaks out where a band would be under ~5 px.
    float px = 1.6 * 5.6 * pc / ${GX}.0 * uRW;
    float detail = smoothstep(4.0, 12.0, px) * smoothstep(0.4, 2.5, ws);
    float g = mix(1.0, 0.2 + 1.7 * n, detail);
    vec2 bf = b * g * comp;
    bendMag = length(bf);

    // Displacement: tips go downwind and, lying over, drop a little.
    vec2 d = vec2(bf.x * 0.0085 * pc, (-bf.y * 0.003 + 0.004 * dot(bf, bf)) * pow(pc, 1.5));
    d *= smoothstep(0.0, 0.25, 1.0 - skyM);
    ground = toLin(textureLod(uPlate, uv - d, uLod).rgb);

    // Honami. A blade is a thin glossy ribbon; Kajiya-Kay gives its sheen
    // from the tangent alone. At rest the tangent stands up the canopy (the
    // vertical, eased toward the MoGe-2 canopy normal on the slopes); a gust
    // tilts it along the bend. The light it reflects is the sky dome, so the
    // lobe sits between the view and the zenith: blades laid away from you
    // turn their faces to the sky and flash pale, blades blown toward you go
    // dark, sideways ones in between.
    vec3 N = normalize(texture(uNrm, uv).rgb * 2.0 - 1.0);
    vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.35));
    vec3 Vv = normalize(vec3((0.5 - uv.x) * 2.15, (uv.y - 0.5) * 1.43, 1.0));
    vec3 L = normalize(vec3(0.18, 1.0, -0.12));
    vec3 Hh = normalize(Vv + L);
    vec3 bend3 = vec3(bf.x, 0.0, -bf.y);
    vec3 T = normalize(up + bend3 * 1.2);
    float s1 = sheen(T, Hh, 3.0);
    float s0 = sheen(up, Hh, 3.0);
    // plus the plain fact that a lying canopy shows more lit blade and less
    // shadow between
    float ds = clamp((0.9 * (s1 - s0) + 0.35 * max(length(bf) - 0.3, 0.0)) * comp, -0.4, 0.9);
    // The faces turned up are waxy and take the sky: brighter, and paler (a
    // little silver-yellow) rather than whiter.
    float lum = dot(ground, vec3(0.2126, 0.7152, 0.0722));
    ground *= 1.0 + 1.45 * ds;
    ground = mix(ground, lum * (1.0 + 0.6 * ds) * vec3(0.98, 1.07, 0.82), 0.3 * clamp(ds * 1.6, 0.0, 1.0));
  }

  // ---- sky ----
  vec3 sky = vec3(0.0);
  if (skyM > 0.001) {
    // Overhead cloud is nearest and crosses fastest; the skyline barely moves.
    float k = pow(clamp((0.62 - uv.y) / 0.62, 0.0, 1.0), 1.3);
    vec2 v = uCloudV * (0.06 + 0.94 * k);
    const float CP = 18.0;
    float c0 = fract(uCloudT / CP);
    float c1 = fract(uCloudT / CP + 0.5);
    vec2 su = vec2(1.0, 1.0 / SKY_H);
    vec3 a0 = textureLod(uSky, (uv - v * (c0 * CP)) * su, uLod).rgb;
    vec3 a1 = textureLod(uSky, (uv - v * (c1 * CP)) * su, uLod).rgb;
    float cw = abs(1.0 - 2.0 * c0);
    sky = toLin(mix(a1, a0, cw));
    // Grade toward the natsu sky: the clear blue deepens to cobalt toward the
    // zenith and loses its green; cloud (neutral) is left alone.
    float blue = smoothstep(0.03, 0.22, sky.b - sky.r);
    float zen = smoothstep(0.66, 0.0, uv.y);
    sky = mix(sky, sky * mix(vec3(0.6, 0.8, 1.0), vec3(0.22, 0.46, 0.9), zen), blue);
  }

  // The meadow's greens, a touch quieter and cooler, the way Superia keeps
  // them under a deep sky.
  float gl = dot(ground, vec3(0.2126, 0.7152, 0.0722));
  ground = mix(vec3(gl), ground, 0.84) * vec3(0.95, 1.0, 1.05);
  col = mix(ground, sky, skyM);
  if (uDebug > 0.5) col = mix(col, vec3(1.0, 0.2, 0.1), clamp(bendMag, 0.0, 1.0) * (1.0 - skyM));
  outColor = vec4(col * uExpo, 1.0);
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, mips) {
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

// Perspective scale per wind cell, read from aux.png's red channel (ground
// only; sky cells get 0).
function gridPerspective(img) {
  const c = document.createElement("canvas");
  c.width = GX * 4;
  c.height = GY * 4;
  const x = c.getContext("2d", { willReadFrequently: true });
  const sy = img.height * GY0;
  x.drawImage(img, 0, sy, img.width, img.height - sy, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(GX * GY);
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      let s = 0;
      let n = 0;
      for (let b = 0; b < 4; b++) {
        for (let a = 0; a < 4; a++) {
          const o = ((j * 4 + b) * c.width + i * 4 + a) * 4;
          if (d[o + 1] < 128) {
            s += d[o] / 255;
            n++;
          }
        }
      }
      out[j * GX + i] = n ? s / n : 0;
    }
  }
  return out;
}

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// The scripted gust for ?gust=demo: a quick sweep up from the near grass,
// left to right and away, 0.2-0.75 s.
const DEMO = { t0: 0.2, t1: 0.75, from: [0.16, 0.98], to: [0.66, 0.72] };
const demoAt = (t) => {
  const u = clamp((t - DEMO.t0) / (DEMO.t1 - DEMO.t0), 0, 1);
  const e = u * u * (3 - 2 * u);
  const x = DEMO.from[0] + (DEMO.to[0] - DEMO.from[0]) * e;
  const y = DEMO.from[1] + (DEMO.to[1] - DEMO.from[1]) * e - Math.sin(e * Math.PI) * 0.035;
  return [x, y];
};

export async function createKaze(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const timeQ = q.get("t");
  const frozen = timeQ != null && timeQ !== "" && Number.isFinite(+timeQ);
  const still = frozen || q.get("still") === "1";
  const demo = q.get("gust") === "demo";
  const breezeQ = q.get("breeze");
  const debug = q.get("debug") === "bend" ? 1 : 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [plateImg, skyImg, auxImg, nrmImg] = await Promise.all([loadImage(PLATE), loadImage(SKY), loadImage(AUX), loadImage(NRM)]);
  const plate = imageTexture(gl, plateImg, true);
  const skyTex = imageTexture(gl, skyImg, true);
  const aux = imageTexture(gl, auxImg, false);
  const nrm = imageTexture(gl, nrmImg, false);

  const wind = createWind(gridPerspective(auxImg));
  const breeze = reduce ? 0 : breezeQ != null && Number.isFinite(+breezeQ) ? clamp(+breezeQ, 0, 2) : 1;
  wind.setBreeze(breeze);

  const windTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, windTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, GX, GY, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uploadWind = () => {
    gl.bindTexture(gl.TEXTURE_2D, windTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GX, GY, gl.RGBA, gl.FLOAT, wind.pack());
  };

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

  // Layout, css px of the box: a 3:2 print, or full bleed when embedded.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = W - side * 2;
      const h = w / ASPECT;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.76 * ASPECT);
      const h = w / ASPECT;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
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
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The print may be letterboxed inside the box: pointer -> image uv. When
  // embedded the 3:2 image covers the box.
  const toUv = (px, py) => {
    const fx = (px - L.x) / L.w;
    const fy = (py - L.y) / L.h;
    if (!embedded) return [fx, fy];
    const a = L.w / L.h;
    if (a > ASPECT) return [fx, 0.5 + (fy - 0.5) * (ASPECT / a)];
    return [0.5 + (fx - 0.5) * (a / ASPECT), fy];
  };

  // Brushing: every move over the print is a stroke; a held drag blows
  // harder than a passing hover.
  let last = null;
  let lastT = 0;
  const brush = (ptr) => {
    const now = performance.now();
    const [u, v] = toUv(ptr.x, ptr.y);
    const inside = u >= -0.02 && u <= 1.02 && v >= -0.02 && v <= 1.02;
    if (!inside) {
      last = null;
      return;
    }
    if (last && now - lastT < 120) {
      const dt = Math.max(0.008, (now - lastT) / 1000);
      const vx = (u - last[0]) / dt;
      const vy = (v - last[1]) / dt;
      wind.stroke(last[0], last[1], u, v, vx, vy, ptr.down ? 1 : 0.55);
    }
    last = [u, v];
    lastT = now;
  };
  stage.on("down", (p) => {
    last = null;
    brush(p);
  });
  stage.on("move", brush);
  stage.on("up", () => {
    last = null;
  });

  let cloudT = 0;
  let grainClock = 0;
  let grainSeed = 0;
  let cloudLean = 0;
  const STEP = 1 / 60;

  const advance = (dt, t) => {
    // the scripted gust
    if (demo && t >= DEMO.t0 && t - dt <= DEMO.t1 + 0.02) {
      const a = demoAt(t - dt);
      const b = demoAt(t);
      wind.stroke(a[0], a[1], b[0], b[1], (b[0] - a[0]) / dt, (b[1] - a[1]) / dt, 1);
    }
    wind.step(dt);
    // the clouds lean a little after the gusts, a long way behind
    cloudLean += (wind.gustMean - cloudLean) * (1 - Math.exp(-dt / 4));
    cloudT += dt;
  };

  let simT = 0;
  if (frozen) {
    const T = clamp(+timeQ, 0, 60);
    while (simT < T - 1e-6) {
      simT += STEP;
      advance(STEP, simT);
    }
    grainSeed = 7;
  }
  uploadWind();

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const u = scene.u;
    gl.useProgram(scene.p);
    const texs = [plate, skyTex, aux, nrm, windTex];
    const names = ["uPlate", "uSky", "uAux", "uNrm", "uWind"];
    texs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[names[i]], i);
    });
    gl.uniform1f(u.uTime, simT);
    gl.uniform1f(u.uCloudT, cloudT);
    // ~1% of the frame per 10 s overhead, plus the gusts' lean
    const lean = reduce ? 0 : 0.00012 * cloudLean;
    gl.uniform2f(u.uCloudV, reduce ? 0 : 0.0009 + lean, 0.00008);
    gl.uniform1f(u.uExpo, 1.18 * 2 ** expoStops);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(2400 / L.rw)));
    gl.uniform1f(u.uDebug, debug);
    gl.uniform1f(u.uRW, L.rw);
    // cover-crop the 3:2 image into the box (only differs when embedded)
    const a = L.w / L.h;
    if (a > ASPECT) gl.uniform4f(u.uView, 0, 0.5 - ASPECT / a / 2, 1, ASPECT / a);
    else gl.uniform4f(u.uView, 0.5 - a / ASPECT / 2, 0, a / ASPECT, 1);
    gl.uniform2f(u.uDir, wind.dir[0], wind.dir[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        saturation: 1.0,
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

  // Reveal: the print comes up overexposed, airy white-blue, and the sky
  // deepens into cobalt over two seconds as the eye adjusts.
  const REVEAL = 2.0;
  let age = 0;
  let acc = 0;
  let slow = 0;
  let lastNow = 0;
  let drawnFrozen = false;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (frozen) {
      if (drawnFrozen) return;
      drawnFrozen = true;
      draw(0, 1);
      return;
    }
    // Weak device: render the scene smaller and let the blit scale it.
    const r = Math.min(real, 0.25);
    slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
    if (slow > 1.2 && scale > 0.5) {
      scale = scale > 0.8 ? 0.75 : 0.5;
      slow = 0;
      if (lastBox) layout(...lastBox);
    }

    age += dt;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) {
      acc -= STEP;
      simT += STEP;
      advance(STEP, simT);
      n++;
    }
    if (n === 4) acc = 0;
    uploadWind();

    if (!reduce) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      [plate, skyTex, aux, nrm, windTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
