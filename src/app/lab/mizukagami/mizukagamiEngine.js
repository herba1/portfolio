import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Mizukagami: a summer street in Kyoto, flooded with still water you raise by
// hand, 0 to 35 cm. Mizukagami ("water mirror") is what the flooded rice
// paddies of early summer do: the water goes still and holds the sky.
//
// The photograph is measured, not guessed. MoGe-2 gives every pixel a
// position in metres; a RANSAC fit finds the road plane (the lens stood
// 1.40 m above it, level, the frame shifted up), and the road's own height is
// modelled: 0 on the carriageway with a few cm of real-world undulation,
// +15 cm on the pavements and islands, the bridge ramp rising beyond 60 m.
// The frame continues below the photo onto the road in front of the lens
// (CC0 asphalt laid on that plane) so the water has room to hold the sky.
//
// Two passes per level:
//  - reflect: for every pixel under the horizon, the view ray meets the water
//    plane at W, mirrors about the plane's normal, and is marched through the
//    point map in screen space (inverse depth linear along the path, 96
//    steps, then bisection). Solid things stop it; thin things (poles, lamp
//    standards, people) stop it only within their thickness, and behind them
//    it meets the LaMa-filled background; wires are a smooth surface of known
//    height that the ray crosses once. A ray that escapes reads the filled
//    sky in its own direction.
//  - compose: water wherever the surface is below the level. Fresnel for
//    n = 1.333 by the angle of view; the bottom seen through the refracted
//    ray, darkened wet and lost to Beer-Lambert extinction and in-scatter by
//    its path through the water; ripples (only while the level is moving) tip
//    the normal and move the mirror image, and blur it where they are finer
//    than a pixel. Above the water, a wet band wicks a few cm up every surface
//    and dries slowly after the water goes down, and a thin bright meniscus
//    lies along every waterline.
// Then the shared film kit develops it.
//
// Query: ?level=0..1 holds the water (0..35 cm), glass-still, no reveal;
// with ?ripple=0..1 it holds that much stirring at a frozen instant.

const BASE = "/lab/mizukagami/";
const LEVEL_MAX = 0.35;
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform vec4 uView;      // plate px: x0, y0 (top), w, h
uniform vec2 uPlate;     // plate size, px
uniform vec2 uPhoto;     // photo size, px (the top of the plate)
uniform vec3 uN;         // road normal, camera space (GL axes)
uniform float uCamH;     // lens height above the road, m
uniform float uF;        // focal length, px
uniform vec2 uC;         // principal point, px (y down)
uniform float uLevel;    // water surface above the road, m
uniform vec2 uDRange;    // log2 range code
uniform vec2 uHRange;    // height code

vec2 platePx(vec2 uv) { return vec2(uView.x + uv.x * uView.z, uView.y + (1.0 - uv.y) * uView.w); }
vec3 rayDir(vec2 p) { return normalize(vec3((p.x - uC.x) / uF, -(p.y - uC.y) / uF, -1.0)); }
vec2 projectP(vec3 P) { return vec2(uC.x + uF * P.x / -P.z, uC.y - uF * P.y / -P.z); }
float axial(vec2 p) { return length(vec3((p.x - uC.x) / uF, (p.y - uC.y) / uF, 1.0)); }
float decodeRange(float code) { return exp2(mix(uDRange.x, uDRange.y, code)); }
`;

// ---------------------------------------------------------------- reflect
const REFLECT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlateTex;
uniform sampler2D uClean;
uniform sampler2D uAux;
uniform sampler2D uAux2;
uniform float uDebug;
${COMMON}

const int STEPS = 96;
const vec3 WIRE = vec3(0.03, 0.034, 0.04);

// scene range at a plate pixel: x = range (m, 1e9 for sky), y = flag (b)
vec2 sceneAt(vec2 s) {
  ivec2 q = ivec2(clamp(s, vec2(0.0), uPlate - 1.0));
  vec4 a = texelFetch(uAux, q, 0);
  float g = a.g * 255.0;
  if (g > 254.5) return vec2(1e9, a.b);
  return vec2(decodeRange(g / 254.0), a.b);
}
vec3 plateAt(vec2 s) { return textureLod(uPlateTex, s / uPlate, 0.0).rgb; }
vec3 cleanAt(vec2 s) {
  vec2 q = clamp(s, vec2(0.5), uPhoto - 0.5);
  return textureLod(uClean, q / uPhoto, 0.0).rgb;
}
vec2 aux2At(vec2 s) {
  vec2 a = textureLod(uAux2, clamp(s / uPlate, 0.0, 1.0), 0.0).gr; // back, wire
  return vec2(exp2(mix(uDRange.x, uDRange.y, a.x)), exp2(mix(uDRange.x, uDRange.y, a.y)));
}

void main() {
  vec2 p = platePx(vUv);
  vec3 d = rayDir(p);
  float nd = dot(uN, d);
  if (nd > -2e-4) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float tW = (uLevel - uCamH) / nd;
  vec3 Wp = d * tW;
  vec3 r = reflect(d, uN);
  vec2 s0 = p;
  vec2 s1 = vec2(uC.x + uF * r.x / max(-r.z, 1e-4), uC.y - uF * r.y / max(-r.z, 1e-4));
  float z0 = -Wp.z;

  vec3 col = vec3(0.0);
  bool hit = false;
  float wireA = 0.0;
  bool crossed = false;
  float prevU = 0.0;
  float prevW = -1.0; // ray depth minus the wire surface's, at the last step
  float du = 1.0 / float(STEPS);
  for (int i = 1; i < STEPS; i++) {
    float u = float(i) * du;
    vec2 s = mix(s0, s1, u);
    if (s.y < 0.0 || s.x < 0.0 || s.x > uPlate.x) break;
    float zr = z0 / (1.0 - u);
    float dz = zr * zr / z0 * du;
    float ax = axial(s);
    vec2 sc = sceneAt(s);
    vec2 a2 = aux2At(s);
    // wires: a smooth surface of known height, crossed once on the way up
    float sw = zr - a2.y / ax;
    if (!crossed && sw >= 0.0) {
      crossed = true;
      // exact crossing: z(u) = z0 / (1 - u) meets the sheet; a few fixed-point
      // steps, since the sheet's range varies smoothly along the path
      float uc = mix(prevU, u, clamp(-prevW / max(sw - prevW, 1e-4), 0.0, 1.0));
      for (int j = 0; j < 4; j++) {
        vec2 sj = mix(s0, s1, uc);
        uc = clamp(1.0 - z0 / (aux2At(sj).y / axial(sj)), prevU, u);
      }
      vec2 sx = mix(s0, s1, uc);
      if (texelFetch(uAux, ivec2(sx), 0).g * 255.0 > 254.5) {
        // a wire is 1-3 px: take the strongest of the pixel and its vertical neighbours
        float a0 = textureLod(uAux, sx / uPlate, 0.0).b;
        float a1 = textureLod(uAux, (sx + vec2(0.0, 0.7)) / uPlate, 0.0).b;
        float a2 = textureLod(uAux, (sx - vec2(0.0, 0.7)) / uPlate, 0.0).b;
        wireA = max(a0, 0.8 * max(a1, a2));
      }
    }
    prevW = sw;
    if (sc.x < 1e8) {
      float zs = sc.x / ax;
      bool thin = sc.y > 0.75;
      float zp = z0 / (1.0 - prevU);
      // Crossed this surface's depth during the step: a hit, at the exact
      // crossing (inverse depth is linear along the path). A solid thing is
      // also hit when the ray is found already behind it (it came in from
      // the side); a thin one never is: the ray went behind it.
      bool cross = zp <= zs && zr >= zs;
      bool take = false;
      vec2 sh = s;
      if (cross) {
        // the exact crossing must land on this same surface
        sh = mix(s0, s1, clamp(1.0 - z0 / zs, prevU, u));
        vec2 ch = sceneAt(sh);
        take = ch.x < 1e8 && abs(ch.x / axial(sh) - zs) < 0.12 * zs;
        if (!take) sh = s;
      }
      if (!take && !thin && zr >= zs) take = true;
      if (take) {
        col = plateAt(sh);
        if (uDebug > 0.5) col = thin ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0) * fract(log2(zs));
        hit = true;
        break;
      }
      if (thin && zr > zs) {
        // behind a pole: the filled background is there
        float zb = a2.x / ax;
        if (zr >= zb) {
          col = cleanAt(s);
          if (uDebug > 0.5) col = vec3(0.0, 0.0, 1.0);
          hit = true;
          break;
        }
      }
    }
    prevU = u;
  }
  if (!hit) col = uDebug > 0.5 ? vec3(0.1) : cleanAt(s1);
  if (wireA > 0.0) col = mix(col, uDebug > 0.5 ? vec3(1.0, 0.0, 1.0) : WIRE * (0.6 + 0.4 * col), clamp(wireA, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- compose
const COMPOSE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlateTex;
uniform sampler2D uAux;
uniform sampler2D uRefl;
uniform float uTime;
uniform float uRipple;   // 0..1
uniform float uWetLine;  // highest recent level, m
uniform float uExpo;
uniform vec3 uSigma;     // extinction per metre
uniform vec3 uMurk;      // in-scattered colour of the water body
uniform vec3 uSkyCol;    // sky near the horizon (for the meniscus)
${COMMON}

float heightAt(vec2 p) {
  float c = texture(uAux, p / uPlate).r;
  return c > 0.999 ? 1e3 : mix(uHRange.x, uHRange.y, c * 255.0 / 254.0);
}
float flagAt(vec2 p) { return texture(uAux, p / uPlate).b; }
bool skyAt(vec2 p) { return texelFetch(uAux, ivec2(clamp(p, vec2(0.0), uPlate - 1.0)), 0).g * 255.0 > 254.5; }

float fresnel(float ci) {
  float n = 1.333;
  float st2 = (1.0 - ci * ci) / (n * n);
  if (st2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - st2);
  float rs = (ci - n * ct) / (ci + n * ct);
  float rp = (n * ci - ct) / (n * ci + ct);
  return 0.5 * (rs * rs + rp * rp);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Ripple slope (d height / dx, dz) on the water plane, metres, and the share
// of the slope energy that is finer than a pixel here.
vec3 ripple(vec2 q, float fp) {
  vec2 g = vec2(0.0);
  float lost = 0.0;
  // wavelength (m), direction (rad), amplitude (slope), speed (m/s)
  const int K = 6;
  vec4 W[K] = vec4[K](
    vec4(0.42, 0.35, 0.010, 0.81),
    vec4(0.27, -0.55, 0.009, 0.65),
    vec4(0.19, 1.25, 0.008, 0.55),
    vec4(0.13, 2.30, 0.006, 0.45),
    vec4(0.09, -1.90, 0.005, 0.38),
    vec4(0.62, 2.85, 0.007, 0.98)
  );
  for (int k = 0; k < K; k++) {
    vec4 w = W[k];
    vec2 dir = vec2(cos(w.y), sin(w.y));
    float kk = 6.2831853 / w.x;
    float ph = kk * dot(q, dir) - kk * w.w * uTime + float(k) * 1.7;
    float vis = smoothstep(0.55, 0.18, fp / w.x);
    g += dir * cos(ph) * w.z * 0.15 * vis;
    lost += w.z * 0.15 * (1.0 - vis);
  }
  return vec3(g * uRipple, lost * uRipple);
}

vec3 wetten(vec3 c, float k) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 s = mix(vec3(l), c, 1.0 + 0.3 * k);
  return max(s, 0.0) * (1.0 - 0.42 * k);
}

void main() {
  vec2 p = platePx(vUv);
  vec3 base = texture(uPlateTex, p / uPlate).rgb;
  float h = heightAt(p);
  float flag = flagAt(p);
  bool sky = skyAt(p);
  bool groundPx = !sky && flag > 0.3 && flag < 0.7;
  float hw = fwidth(min(h, 1.0));
  vec3 col = base;

  vec3 d = rayDir(p);
  float nd = dot(uN, d);
  float depthW = uLevel - h;

  // above the water: wet where it has been, and the wick band at the line
  if (!sky && h < 50.0) {
    float above = h - uLevel;
    float n1 = vnoise(p * vec2(0.09, 0.03));
    float wick = groundPx ? 0.004 : (0.018 + 0.03 * n1);
    float band = uLevel > 0.002 ? 1.0 - smoothstep(0.0, wick, above) : 0.0;
    float mem = 1.0 - smoothstep(uWetLine - 0.004, uWetLine + 0.002, h);
    mem *= uWetLine > 0.003 ? 1.0 : 0.0;
    float wet = max(band, 0.75 * mem) * step(0.0, above);
    col = wetten(col, wet);
    // meniscus: a bright hairline where the water climbs a surface
    if (!groundPx && uLevel > 0.002) {
      float mw = max(0.005, 1.2 * hw);
      float m = smoothstep(mw, 0.0, above) * step(0.0, above);
      col = mix(col, uSkyCol * 0.85, 0.45 * m);
    }
  }

  if (!sky && uLevel > 0.0005 && depthW > 0.0 && nd < -2e-4) {
    float tW = (uLevel - uCamH) / nd;
    vec3 Wp = d * tW;
    vec2 q = vec2(Wp.x, Wp.z);
    float fp = length(fwidth(q));
    vec3 rp = ripple(q, fp);
    vec3 nw = normalize(uN + vec3(-rp.x, 0.0, -rp.y));
    float ci = clamp(-dot(d, nw), 0.0, 1.0);
    float F = fresnel(ci);

    // mirror image: the flat-water pixel whose reflection points where ours does
    vec3 r1 = reflect(d, nw);
    vec3 back = reflect(r1, uN);
    vec2 pm = p;
    if (back.z < -1e-4) pm = projectP(back);
    pm.y = max(pm.y, uC.y + 1.0);
    vec2 ruv = vec2((pm.x - uView.x) / uView.z, 1.0 - (pm.y - uView.y) / uView.w);
    float lod = log2(1.0 + rp.z * 400.0);
    vec3 refl = textureLod(uRefl, clamp(ruv, vec2(0.0), vec2(1.0)), lod).rgb;

    // the bottom, through the refracted ray
    vec3 T = refract(d, nw, 1.0 / 1.333);
    float ct = max(-dot(T, uN), 0.05);
    float path = depthW / ct;
    vec3 B = Wp + T * path;
    vec2 pb = B.z < -1e-3 ? projectP(B) : p;
    vec3 bot = base;
    if (heightAt(pb) < uLevel) bot = texture(uPlateTex, pb / uPlate).rgb;
    bot = wetten(bot, 1.0);
    vec3 ext = exp(-uSigma * (path + depthW * 1.15));
    vec3 trans = bot * ext + uMurk * (1.0 - exp(-uSigma * 0.8 * path));
    vec3 water = F * refl + (1.0 - F) * trans;
    // the shoreline: a feather one pixel wide in height
    float a = smoothstep(0.0, max(0.0015, 1.5 * hw), depthW);
    col = mix(col, water, a);
  }
  // The scan's sky sits at a teal 189 degrees; Superia would have printed
  // it cyan-cobalt. Only clear blue is moved (toward ~204 degrees), so cloud,
  // grey and warm surfaces, and the same blue in the water, stay consistent.
  float skyness = smoothstep(0.3, 0.75, (col.b - col.r) / (col.b + 1e-4)) * step(col.r, col.g);
  col *= vec3(1.0, 1.0 - 0.26 * skyness, 1.0 + 0.05 * skyness);
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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, { srgb = false, mips = false } = {}) {
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

function target(gl, w, h, float, mips = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, ok, mips };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export async function createMizukagami(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const levelQ = q.get("level");
  const held = levelQ != null && levelQ !== "" && Number.isFinite(+levelQ);
  const still = held || q.get("still") === "1";
  const debug = q.get("debug") === "1";
  const rippleQ = Number.isFinite(+q.get("ripple")) ? clamp(+(q.get("ripple") || 0), 0, 1) : 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [scene, plateImg, cleanImg, auxImg, aux2Img] = await Promise.all([
    fetch(BASE + "scene.json").then((r) => r.json()),
    loadImage(BASE + "plate.webp"),
    loadImage(BASE + "clean.webp"),
    loadImage(BASE + "aux.png"),
    loadImage(BASE + "aux2.png"),
  ]);
  const plate = imageTexture(gl, plateImg, { srgb: true, mips: true });
  const clean = imageTexture(gl, cleanImg, { srgb: true, mips: true });
  const aux = imageTexture(gl, auxImg);
  const aux2 = imageTexture(gl, aux2Img);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const reflectP = program(gl, VERT, REFLECT);
  const composeP = program(gl, VERT, COMPOSE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  const [PW, PH] = scene.plate;
  const [, PHOTO_H] = scene.photo;
  const HORIZON = scene.c[1];
  // The sky colour just above the horizon, for the meniscus (linear).
  const SKY = [0x9f, 0xc4, 0xcf].map((v) => srgbToLinear(v / 255));

  // Layout, in css px of the box, and the window onto the plate.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  const V = { x: 0, y: 0, w: PW, h: PH };
  let sceneT = null;
  let reflT = null; // full resolution: the still mirror
  let reflH = null; // half: while the level is moving
  let reflCur = null;
  let filmT = null;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    let aspect;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
      aspect = W / H;
    } else if (W / H < 0.9) {
      aspect = 4 / 5;
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w / aspect;
      if (h > H * 0.76) {
        h = H * 0.76;
        w = h * aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      aspect = 4 / 3;
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.78 * aspect);
      const h = w / aspect;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    // The window: full plate height below the top band of sky, cropped
    // sideways for narrow prints (centred a little left, on the poles).
    const vh = 2250;
    const vw = Math.min(PW, vh * aspect);
    const vx = clamp(PW * 0.49 - vw / 2, 0, PW - vw);
    Object.assign(V, { x: vx, y: PH - vh, w: vw, h: vh });
    if (vw >= PW - 1 && vh * aspect > PW) {
      // wider than the plate: crop height instead
      const h2 = PW / aspect;
      Object.assign(V, { x: 0, y: PH - h2, w: PW, h: h2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    for (const t of [sceneT, reflT, reflH, filmT]) freeTarget(gl, t);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    const mk = (w, h) => {
      const t = target(gl, w, h, floatOk, true);
      if (t.ok) return t;
      freeTarget(gl, t);
      return target(gl, w, h, false, true);
    };
    reflT = mk(L.rw, L.rh);
    reflH = mk(Math.max(2, L.rw >> 1), Math.max(2, L.rh >> 1));
    reflCur = null;
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
    reflDirty = true;
    dirty = true;
  };

  // ---------------------------------------------------------------- state
  // The level (m) follows a target on a spring; the drag sets the target
  // 1:1, release carries the hand's velocity, the ends rubber-band.
  let level = held ? clamp(+levelQ, 0, 1) * LEVEL_MAX : 0;
  let vel = 0;
  let goal = level;
  let wetLine = level;
  let ripple = held ? rippleQ : 0;
  let dragging = false;
  let drag0 = null;
  let touched = held;
  let reflDirty = true;
  let dirty = true;
  let reflLevel = -1;
  let moving = false;
  let restFor = 0;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  const span = () => Math.max(120, L.h * 0.8);
  const rubber = (v) => {
    if (v < 0) return -LEVEL_MAX * 0.12 * (1 - Math.exp(v / (LEVEL_MAX * 0.12) * 0.35 * 3));
    if (v > LEVEL_MAX) return LEVEL_MAX + LEVEL_MAX * 0.12 * (1 - Math.exp(-(v - LEVEL_MAX) / (LEVEL_MAX * 0.12) * 0.35 * 3));
    return v;
  };
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    dragging = true;
    touched = true;
    drag0 = { y: p.y, level: goal };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging) {
      stage.canvas.style.cursor = !held && inPrint(p) ? "grab" : "";
      return;
    }
    goal = rubber(drag0.level + ((drag0.y - p.y) / span()) * LEVEL_MAX);
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    stage.canvas.style.cursor = inPrint(p) ? "grab" : "";
    // carry the hand's speed for ~220 ms, then settle inside the range
    const v = (-p.vy / span()) * LEVEL_MAX;
    goal = clamp(goal + v * 0.22, 0, LEVEL_MAX);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (held) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === "ArrowUp") goal = clamp(goal + step, 0, LEVEL_MAX);
    else if (e.key === "ArrowDown") goal = clamp(goal - step, 0, LEVEL_MAX);
    else return;
    e.preventDefault();
    touched = true;
  };
  host.addEventListener("keydown", onKey);

  let time = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;
  let grainDirty = true;

  const common = (u) => {
    gl.uniform4f(u.uView, V.x, V.y, V.w, V.h);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform2f(u.uPhoto, PW, PHOTO_H);
    gl.uniform3fv(u.uN, scene.up);
    gl.uniform1f(u.uCamH, scene.camH);
    gl.uniform1f(u.uF, scene.f);
    gl.uniform2f(u.uC, scene.c[0], HORIZON);
    gl.uniform1f(u.uLevel, level);
    gl.uniform2f(u.uDRange, Math.log2(scene.depth[0]), Math.log2(scene.depth[1]));
    gl.uniform2f(u.uHRange, scene.height[0], scene.height[1]);
  };
  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  const drawScene = (expoStops) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    // while the water moves, the mirror is traced at half resolution (the
    // ripples blur it anyway); once it rests for a moment, at full
    const want = moving ? reflH : reflT;
    if (reflDirty || (want !== reflCur && !moving)) {
      const T = want;
      gl.useProgram(reflectP.p);
      const u = reflectP.u;
      common(u);
      bindTex(0, plate, u.uPlateTex);
      bindTex(1, clean, u.uClean);
      bindTex(2, aux, u.uAux);
      bindTex(3, aux2, u.uAux2);
      gl.uniform1f(u.uDebug, debug ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.viewport(0, 0, T.w, T.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      reflDirty = false;
      reflLevel = level;
      reflCur = T;
    }
    gl.useProgram(composeP.p);
    const u = composeP.u;
    common(u);
    bindTex(0, plate, u.uPlateTex);
    bindTex(1, aux, u.uAux);
    bindTex(2, reflCur.tex, u.uRefl);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uRipple, ripple);
    gl.uniform1f(u.uWetLine, wetLine);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.uniform3f(u.uSigma, 3.6, 4.1, 5.6);
    gl.uniform3f(u.uMurk, 0.035, 0.04, 0.03);
    gl.uniform3fv(u.uSkyCol, SKY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const develop = (fade) => {
    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        // the scan already carries its grade; the film adds the optics
        contrast: 1.1,
        toe: 0.02,
        saturation: 1.06,
        blueDepth: 0.6,
        whitePoint: 1.22,
        vignette: 0.22,
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

  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // Reveal: the print comes up overexposed and settles while the water
  // creeps in across the road to a few centimetres, showing it can rise.
  const REVEAL = 2.0;
  const HINT = 0.085;
  let slow = 0;
  let lastNow = 0;
  let lastExpo = -1;
  let lastFade = -1;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    time = still ? 1.3 : time + dt;
    if (t0 < 0) t0 = time;
    const age = still ? 99 : time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
      if (!touched && age > REVEAL * 0.7) goal = HINT;
    }

    if (!held) {
      const prev = level;
      // spring: ζ 0.86, ω 2π·1.15 Hz while the hand holds it, softer after
      const w = 2 * Math.PI * (dragging ? 2.2 : 1.15);
      const z = 0.86;
      const h = Math.min(dt, 1 / 30);
      const acc = w * w * (goal - level) - 2 * z * w * vel;
      vel += acc * h;
      level += vel * h;
      if (Math.abs(goal - level) < 1e-5 && Math.abs(vel) < 1e-5) {
        level = goal;
        vel = 0;
      }
      const lv = Math.max(0, level);
      const rate = Math.abs(lv - Math.max(0, prev)) / Math.max(dt, 1e-3);
      // ripples are stirred by the water moving and die out to glass
      ripple = reduce ? 0 : clamp(ripple * Math.exp(-dt / 0.9) + rate * 5.5 * dt * 6, 0, 1);
      if (ripple < 0.002) ripple = 0;
      // wet surfaces dry slowly once the water drops
      wetLine = lv > wetLine ? lv : wetLine + (lv - wetLine) * (1 - Math.exp(-dt / 9));
      const changing = Math.abs(lv - reflLevel) > 2e-5;
      restFor = changing || dragging ? 0 : restFor + dt;
      const wasMoving = moving;
      moving = restFor < 0.15;
      if (changing) reflDirty = true;
      if (wasMoving && !moving) dirty = true; // trace the still mirror sharp
      if (lv !== Math.max(0, prev) || ripple > 0 || Math.abs(wetLine - lv) > 1e-4) dirty = true;
    }

    if (!reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        grainDirty = true;
      }
    }
    if (expo !== lastExpo || fade !== lastFade) dirty = true;
    if (!dirty && !grainDirty) return;
    if (dirty) {
      const keep = level;
      level = Math.max(0, level);
      drawScene(expo);
      level = keep;
    }
    develop(fade);
    dirty = false;
    grainDirty = false;
    lastExpo = expo;
    lastFade = fade;
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      for (const t of [sceneT, reflT, reflH, filmT]) freeTarget(gl, t);
      for (const t of [plate, clean, aux, aux2]) gl.deleteTexture(t);
      for (const pr of [reflectP, composeP, blit]) gl.deleteProgram(pr.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
