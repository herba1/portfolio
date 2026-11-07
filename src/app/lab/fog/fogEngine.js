import { createStage, clamp } from "../_kit/stage";

// Fog: a worm's-eye view up between the Canary Wharf towers into a summer
// cumulus sky, with real air applied per pixel through its real distance.
// Drag sets the visibility, from a clear 50 km day down to a 200 m haze.
//
// The plate is two Poly Haven HDRIs (CC0) rendered through the same
// stereographic rays: the towers from canary_wharf, the sky from docklands_01,
// graded to a cobalt zenith with unclipped cumulus. Depth Anything V2 gives
// relative inverse depth, edge-snapped and turned into metres offline (the
// glass corner ~30 m, the far tower down the street ~380 m); the sky sits at
// the far end through its matte. tools/depth/bakes/fog/ builds both.
//
//   visibility V   the control (Koschmieder: beta = 3.912 / V at 550 nm)
//   haze layer     density falls off with height, scale height HS, so the air
//                  along a ray climbing at elevation e to distance d is
//                  L = HS / sin e * (1 - exp(-d sin e / HS)): low rays to the
//                  far towers cross the most air, the zenith the least
//   extinction     per channel, Rayleigh-leaning (blue goes first):
//                  T = exp(-beta * K_RGB * L)
//   in-scatter     the air is lit by the sky, so its colour is the sky's own
//                  light, blurred wide (a normalised blur of the sky pixels
//                  only): far towers go blue, clouds dissolve into the field
//                  they sit in, and nothing ever turns grey
//   breath         the haze gathers a little thicker where the pointer rests,
//                  and banks of it drift slowly through the street

const COLOR_SRC = "/lab/fog/plate.webp";
const AUX_SRC = "/lab/fog/aux.png"; // r log distance, g sky matte, b elevation
const ASPECT = 3 / 2;
const D_MIN = 10;
const D_MAX = 4000;
const HS = 500; // haze scale height, metres
const V_CLEAR = 50000; // visibility at fog 0, metres
const V_THICK = 200; // visibility at fog 1
const K_RGB = [0.82, 1.0, 1.24];
const REST = 0.92; // arrival: a white-blue field of haze
const ROLL = 0.5; // it clears to here
const LEVELS = 6;
const DRIFT_FPS = 20;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Offscreen buffers store row 0 = top of the photograph, like the textures.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uAux;
uniform float uBeta;      // extinction at 550 nm, per metre (3.912 / V)
uniform vec3 uBreath;     // xy in print uv, z strength
uniform float uAspect;    // print w / h
uniform float uTime;

float distAt(vec4 aux) {
  return ${D_MIN.toFixed(1)} * exp(aux.r * ${Math.log(D_MAX / D_MIN).toFixed(5)});
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Optical depth along the ray through this pixel, per channel.
vec3 tauAt(vec2 uv, vec4 aux) {
  float d = distAt(aux);
  float s = max(sin(radians(aux.b * 90.0)), 0.06);
  // Air in a haze layer that thins with height.
  float L = ${HS.toFixed(1)} / s * (1.0 - exp(-d * s / ${HS.toFixed(1)}));
  // Banks of haze: low-frequency noise, advected sideways, living at depths.
  vec3 q = vec3(uv.x * uAspect * 1.4 - uTime * 0.012, uv.y * 1.2, log(d) * 0.4);
  float n = vnoise(q) * 0.64 + vnoise(q * 2.03 + vec3(uTime * 0.008, 0.0, 3.1)) * 0.36;
  float b = uBeta * mix(0.7, 1.3, n);
  // It gathers where the pointer rests.
  vec2 p = (uv - uBreath.xy) * vec2(uAspect, 1.0);
  b *= 1.0 + uBreath.z * exp(-dot(p, p) / 0.06);
  return b * L * vec3(${K_RGB.map((k) => k.toFixed(2)).join(", ")});
}
`;

// The sky's light, premultiplied by the sky matte, for a normalised blur:
// rgb = sky light (display-encoded, so an 8-bit fallback target holds it
// without banding) * matte, a = matte.
const AIR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAux;
uniform float uLod;
void main() {
  vec3 c = textureLod(uColor, vUv, uLod).rgb;
  float m = textureLod(uAux, vUv, 0.0).g;
  m = smoothstep(0.5, 1.0, m);
  outColor = vec4(c * m, m);
}`;

// 13-tap downsample (Jimenez, CoD: Advanced Warfare).
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel; // of the source
void main() {
  vec2 t = uTexel;
  vec4 a = texture(uSrc, vUv + t * vec2(-2, -2));
  vec4 b = texture(uSrc, vUv + t * vec2(0, -2));
  vec4 c = texture(uSrc, vUv + t * vec2(2, -2));
  vec4 d = texture(uSrc, vUv + t * vec2(-1, -1));
  vec4 e = texture(uSrc, vUv + t * vec2(1, -1));
  vec4 f = texture(uSrc, vUv + t * vec2(-2, 0));
  vec4 g = texture(uSrc, vUv);
  vec4 h = texture(uSrc, vUv + t * vec2(2, 0));
  vec4 i = texture(uSrc, vUv + t * vec2(-1, 1));
  vec4 j = texture(uSrc, vUv + t * vec2(1, 1));
  vec4 k = texture(uSrc, vUv + t * vec2(-2, 2));
  vec4 l = texture(uSrc, vUv + t * vec2(0, 2));
  vec4 m = texture(uSrc, vUv + t * vec2(2, 2));
  outColor = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
}`;

// Tent upsample of the coarser sum, plus this level's own share.
const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLevel;
uniform sampler2D uCoarse;
uniform vec2 uTexel; // of the coarse
uniform float uW;
void main() {
  vec2 t = uTexel;
  vec4 s = texture(uCoarse, vUv) * 4.0;
  s += (texture(uCoarse, vUv + t * vec2(-1, 0)) + texture(uCoarse, vUv + t * vec2(1, 0)) + texture(uCoarse, vUv + t * vec2(0, -1)) + texture(uCoarse, vUv + t * vec2(0, 1))) * 2.0;
  s += texture(uCoarse, vUv + t * vec2(-1, -1)) + texture(uCoarse, vUv + t * vec2(1, -1)) + texture(uCoarse, vUv + t * vec2(-1, 1)) + texture(uCoarse, vUv + t * vec2(1, 1));
  outColor = s / 16.0 + texture(uLevel, vUv) * uW;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAir;
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uSkyMean;  // display-encoded, the fallback where the blur saw no sky
uniform float uGrain;   // grain seed, stepped at 24 fps
${COMMON}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 shoulder(vec3 x) {
  vec3 k = vec3(0.62);
  vec3 over = max(x - k, 0.0);
  return min(x, k) + (0.92 - k) * (1.0 - exp(-over / (0.92 - k)));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = clamp((frag - uRect.xy) / uRect.zw, 0.0, 1.0);
  vec4 aux = texture(uAux, uv);
  vec3 T = exp(-tauAt(uv, aux));

  // Forward scatter softens what the air has nearly taken.
  float soft = (1.0 - T.g) * (1.0 - T.g);
  vec3 scene = pow(textureLod(uColor, uv, soft * 1.6).rgb, vec3(2.2));

  // The air is lit by the sky: its colour is the sky's own light nearby.
  vec4 a = texture(uAir, uv);
  vec3 air = pow((a.rgb + uSkyMean * 0.02) / (a.a + 0.02), vec3(2.2));
  // Thick haze scatters more often and lifts toward the brighter horizon.
  float thick = 1.0 - T.g;
  air *= 1.0 + 0.18 * thick;

  vec3 col = scene * T + air * (1.0 - T);
  col = shoulder(col);
  col = pow(col, vec3(1.0 / 2.2));
  // Film: a little toe, fine grain strongest in the midtones, then dither.
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.1);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += (hash(floor(frag / 1.25) + uGrain) - 0.5) * 0.045 * l * (1.0 - l);
  col += (hash(frag + 17.0) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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

function imageTexture(gl, img, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The mean (display-encoded) colour of the sky pixels, for where the blur sees none.
function skyMean(colorImg, auxImg) {
  const w = 48;
  const h = 32;
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const col = read(colorImg);
  const aux = read(auxImg);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const m = aux[i * 4 + 1] / 255;
    if (m < 0.9) continue;
    for (let k = 0; k < 3; k++) sum[k] += col[i * 4 + k] / 255;
    n++;
  }
  return n ? sum.map((s) => s / n) : [0.25, 0.45, 0.7];
}

// A critically damped spring: interruptible, lands without overshoot.
function spring(x) {
  return { x, v: 0, target: x };
}
function stepSpring(s, dt, k) {
  const c = 2 * Math.sqrt(k);
  const a = k * (s.target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return Math.abs(s.target - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}

export async function createFog(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [colorImg, auxImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(AUX_SRC)]);
  const colorTex = imageTexture(gl, colorImg, true);
  const auxTex = imageTexture(gl, auxImg, false);
  const skyLin = skyMean(colorImg, auxImg);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    air: compile(gl, VERT, AIR),
    down: compile(gl, VERT, DOWN),
    up: compile(gl, VERT, UP),
    composite: compile(gl, VERT, COMPOSITE),
  };

  const float = !!gl.getExtension("EXT_color_buffer_float");
  const target = (w, h) => {
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
    return { tex, fbo, w, h };
  };
  const free = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };

  // The sky's light, blurred wide once: the colour of the air. It depends on
  // the plate only, so its pyramid has a fixed size.
  const down = [];
  const up = [];
  {
    let bw = 600;
    let bh = 400;
    for (let i = 0; i < LEVELS; i++) {
      down.push(target(bw, bh));
      up.push(i === LEVELS - 1 ? null : target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
  }

  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let dirty = true;
  const params = new URLSearchParams(window.location.search);
  // Full bleed: the plate covers the box, held a little up and left of centre so the
  // towers' meeting point and the glass corner stay in view on tall screens.
  const layout = (w, h) => {
    const s = Math.max(w / ASPECT, h);
    const pw = s * ASPECT;
    const ph = s;
    rect = { x: (w - pw) * 0.45, y: (h - ph) * 0.42, w: pw, h: ph };
    dirty = true;
  };

  // --- state ---------------------------------------------------------------
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const qFog = params.get("fog");
  const held = qFog != null && Number.isFinite(+qFog);
  const qx = params.get("x");
  const qy = params.get("y");
  const fog = spring(held ? clamp(+qFog, 0, 1) : reduced ? ROLL : REST);
  const bx = spring(qx != null ? clamp(+qx, 0, 1) : 0.56);
  const by = spring(qy != null ? clamp(+qy, 0, 1) : 0.4);
  const breath = spring(held || qx != null ? 1 : 0.5);
  let time = Number.isFinite(+params.get("t")) && params.get("t") != null ? +params.get("t") : 0;
  let touched = held;
  let drag = null;
  let intro = !held && !reduced;
  let sinceDraw = 1;

  stage.onResize(layout);

  const toPrint = (p) => [(p.x - rect.x) / rect.w, (p.y - rect.y) / rect.h];
  const breatheAt = (p) => {
    const [u, v] = toPrint(p);
    bx.target = clamp(u, -0.1, 1.1);
    by.target = clamp(v, -0.1, 1.1);
    breath.target = 1;
  };

  stage.on("move", (p) => {
    touched = true;
    breatheAt(p);
    if (drag) {
      // Drag up to thicken the air (shorter visibility), down to clear it.
      fog.target = clamp(drag.f + ((drag.y - p.y) / Math.max(240, stage.height)) * 1.4, 0, 1);
    }
  });
  stage.on("down", (p) => {
    touched = true;
    intro = false;
    breatheAt(p);
    drag = { y: p.y, f: fog.target };
  });
  stage.on("up", () => {
    drag = null;
  });
  const onLeave = () => {
    breath.target = 0.5;
  };
  stage.canvas.addEventListener("pointerleave", onLeave);
  const onWheel = (e) => {
    e.preventDefault();
    touched = true;
    intro = false;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    fog.target = clamp(fog.target + dy / 900, 0, 1);
    breatheAt({ x: e.offsetX, y: e.offsetY });
  };
  if (!embedded) stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  // On arrival the haze lifts off the street, and the sky deepens into blue.
  const introTimer = intro
    ? window.setTimeout(() => {
        if (!touched) fog.target = ROLL;
      }, 350)
    : 0;

  // --- passes --------------------------------------------------------------
  const quadDraw = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    if (t) gl.viewport(0, 0, t.w, t.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  const chain = (weights) => {
    // Down the pyramid from level 0 (already written), then back up.
    gl.useProgram(P.down.p);
    gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < LEVELS; i++) {
      bind(0, down[i - 1].tex);
      gl.uniform2f(P.down.u.uTexel, 1 / down[i - 1].w, 1 / down[i - 1].h);
      quadDraw(down[i]);
    }
    gl.useProgram(P.up.p);
    gl.uniform1i(P.up.u.uLevel, 0);
    gl.uniform1i(P.up.u.uCoarse, 2);
    for (let i = LEVELS - 2; i >= 0; i--) {
      const coarse = i === LEVELS - 2 ? down[LEVELS - 1] : up[i + 1];
      bind(0, down[i].tex);
      bind(2, coarse.tex);
      gl.uniform2f(P.up.u.uTexel, 1 / coarse.w, 1 / coarse.h);
      gl.uniform1f(P.up.u.uW, weights[i]);
      quadDraw(up[i]);
    }
    return up[0];
  };

  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.useProgram(P.air.p);
  bind(0, colorTex);
  bind(1, auxTex);
  gl.uniform1i(P.air.u.uColor, 0);
  gl.uniform1i(P.air.u.uAux, 1);
  gl.uniform1f(P.air.u.uLod, Math.log2(colorImg.naturalHeight / down[0].h));
  quadDraw(down[0]);
  // Mostly wide: the air is lit by the whole sky, a little by the sky nearby.
  const air = chain([0.15, 0.25, 0.4, 0.6, 0.8]);

  const draw = () => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const vis = V_CLEAR * Math.pow(V_THICK / V_CLEAR, fog.x);
    const dpr = stage.dpr;
    gl.useProgram(P.composite.p);
    bind(0, colorTex);
    bind(1, auxTex);
    bind(2, air.tex);
    const cu = P.composite.u;
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uAux, 1);
    gl.uniform1i(cu.uAir, 2);
    gl.uniform1f(cu.uBeta, 3.912 / vis);
    gl.uniform3f(cu.uBreath, bx.x, by.x, breath.x * 0.9);
    gl.uniform1f(cu.uAspect, ASPECT);
    gl.uniform1f(cu.uTime, time);
    gl.uniform1f(cu.uGrain, reduced ? 0 : Math.floor(time * 24) % 64);
    gl.uniform3f(cu.uSkyMean, skyLin[0], skyLin[1], skyLin[2]);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    quadDraw(null);
  };

  const stillTime = params.get("t") != null || reduced;
  stage.onFrame((dt) => {
    // Arrival lifts slowly (about two seconds); the hand gets a quick spring.
    const k = drag ? 120 : intro ? 8 : 26;
    const moving = stepSpring(fog, dt, k) | stepSpring(bx, dt, 30) | stepSpring(by, dt, 30) | stepSpring(breath, dt, 10);
    if (intro && Math.abs(fog.x - ROLL) < 0.01) intro = false;
    sinceDraw += dt;
    if (!stillTime) time += dt;
    // The haze drifts on its own, drawn at a capped rate.
    const drift = !stillTime && sinceDraw >= 1 / DRIFT_FPS;
    if (!moving && !dirty && !drift) return;
    dirty = false;
    sinceDraw = 0;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(introTimer);
      stage.canvas.removeEventListener("pointerleave", onLeave);
      stage.canvas.removeEventListener("wheel", onWheel);
      [...down, ...up].forEach(free);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
