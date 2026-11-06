import { createStage, clamp } from "../_kit/stage";

// Fog: herb's Times Square photograph, a print on the warm ground, with real
// fog applied per pixel through its real distance.
//
// Depth Anything V2 gives relative inverse depth. It was edge-snapped to the
// photo with a guided filter and turned into metres offline (herb ~3.5 m, the
// taxi ~9 m, the One Times Square screens ~240 m, the sky at the horizon), then
// stored as log distance in 8 bits.
//
//   transmittance  T = exp(-tau),  tau = sigma(x) * distance
//   sigma          a base density (the control), breathed thicker around the
//                  pointer, and modulated by low-frequency noise drifting
//                  sideways through log-distance so fog banks sit at depths
//   in-scatter     the fog is lit by the city: its colour is a very wide blur
//                  of the scene's own light, so the air takes on the neon
//   halos          the emissive parts of the photo, each weighted by how much
//                  fog lies between it and the camera (1 - exp(-tau_light)),
//                  blurred through a pyramid; wider levels count for more as
//                  the fog thickens. The pyramid also carries the lights'
//                  distance, so a halo never paints over something nearer
//                  than the light that made it.

const COLOR_SRC = "/lab/fog/city.webp";
const DIST_SRC = "/lab/fog/distance.png";
const ASPECT = 3 / 4;
const GROUND = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const D_MIN = 0.8;
const D_MAX = 3000;
const SIGMA_MIN = 0.0016; // per metre, the lightest haze
const SIGMA_MAX = 0.075; // per metre, a wall of fog
const REST = 0.2; // haze on arrival
const ROLL = 0.6; // the fog rolls in to here
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
uniform sampler2D uDist;
uniform float uSigma;     // base density, per metre
uniform vec3 uBreath;     // xy in print uv, z strength
uniform float uAspect;    // print w / h
uniform float uTime;

float distAt(vec2 uv) {
  return ${D_MIN.toFixed(2)} * exp(texture(uDist, uv).r * ${Math.log(D_MAX / D_MIN).toFixed(5)});
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
// Optical depth along the ray through this pixel.
float tauAt(vec2 uv, float d) {
  float ld = log(d);
  // Fog banks: low-frequency noise, advected sideways, living at depths.
  vec3 q = vec3(uv.x * uAspect * 1.6 - uTime * 0.018, uv.y * 1.3, ld * 0.42);
  float n = vnoise(q) * 0.64 + vnoise(q * 2.03 + vec3(uTime * 0.011, 0.0, 3.1)) * 0.36;
  float s = uSigma * mix(0.5, 1.5, n);
  // Breath on the glass of the city: thickest where the pointer is.
  vec2 b = (uv - uBreath.xy) * vec2(uAspect, 1.0);
  s *= 1.0 + uBreath.z * exp(-dot(b, b) / 0.045);
  return s * d;
}
`;

// Emissive light, weighted by how much fog stands between it and the camera.
// rgb: scattered light, a: its luminance times log distance (to recover the
// light's distance after blurring).
const SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform float uLod;
${COMMON}
void main() {
  vec3 c = textureLod(uColor, vUv, uLod).rgb;
  float m = max(c.r, max(c.g, c.b));
  float e = smoothstep(0.42, 1.0, m);
  // Clipped neon carries more energy than the file shows.
  vec3 em = c * e * e * 1.8;
  float d = distAt(vUv);
  // Near lights glow too: a halo needs a little air, not a long way of it.
  float w = 1.0 - exp(-max(tauAt(vUv, d), uSigma * 22.0));
  em *= w;
  float l = dot(em, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(em, l * log(d));
}`;

// The scene's own light, for the colour of the fog.
const AMBIENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform float uLod;
void main() {
  vec3 c = textureLod(uColor, vUv, uLod).rgb;
  float m = max(c.r, max(c.g, c.b));
  c *= 1.0 + 1.2 * smoothstep(0.5, 1.0, m);
  outColor = vec4(c, 1.0);
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
uniform sampler2D uHalo;
uniform sampler2D uAmbient;
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uGround;
uniform float uHaloGain;
${COMMON}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 shoulder(vec3 x) {
  vec3 k = vec3(0.8);
  vec3 over = max(x - k, 0.0);
  return min(x, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(uGround, 1.0);
    return;
  }
  float d = distAt(uv);
  float tau = tauAt(uv, d);
  float T = exp(-tau);

  // Forward scatter softens what the fog has nearly taken.
  float soft = (1.0 - T) * (1.0 - T);
  vec3 scene = textureLod(uColor, uv, soft * 2.2).rgb;

  // The fog is lit by the city around it.
  vec3 amb = texture(uAmbient, uv).rgb;
  float al = dot(amb, vec3(0.2126, 0.7152, 0.0722));
  vec3 fogCol = mix(vec3(al), amb, 0.8) * 0.78 + vec3(0.02, 0.021, 0.024);

  // Halos: only where this pixel is at least about as far as the light.
  vec4 h = texture(uHalo, uv);
  float hl = max(dot(h.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  float lightD = exp(h.a / hl);
  float seen = smoothstep(0.35, 0.9, d / lightD);
  vec3 halo = h.rgb * uHaloGain * seen;

  vec3 col = scene * T + fogCol * (1.0 - T) + halo;
  col = shoulder(col);
  // A little film: lift the floor, cool the shadows a touch.
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.12);
  col += (hash(frag) - 0.5) * 1.6 / 255.0;
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

function imageTexture(gl, img, format, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (format === "r") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
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

  const [colorImg, distImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(DIST_SRC)]);
  const colorTex = imageTexture(gl, colorImg, "rgba", true);
  const distTex = imageTexture(gl, distImg, "r", false);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    source: compile(gl, VERT, SOURCE),
    ambient: compile(gl, VERT, AMBIENT),
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

  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let down = []; // pyramid levels
  let up = []; // upsample sums
  let ambient = null; // the city's light, very wide
  let ambientDirty = true;

  const params = new URLSearchParams(window.location.search);
  const layout = (w, h) => {
    const m = Math.max(24, Math.min(w, h) * 0.08);
    let ph = h - 2 * m;
    let pw = ph * ASPECT;
    if (pw > w - 2 * m) {
      pw = w - 2 * m;
      ph = pw / ASPECT;
    }
    rect = { x: Math.round((w - pw) / 2), y: Math.round((h - ph) / 2), w: Math.round(pw), h: Math.round(ph) };
    [...down, ...up].forEach(free);
    down = [];
    up = [];
    let bw = Math.max(16, Math.round(rect.w * 0.5));
    let bh = Math.max(16, Math.round(rect.h * 0.5));
    for (let i = 0; i < LEVELS; i++) {
      down.push(target(bw, bh));
      up.push(i === LEVELS - 1 ? null : target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
    if (!ambient) ambient = target(48, 64);
    ambientDirty = true;
    dirty = true;
  };

  // --- state ---------------------------------------------------------------
  const qFog = params.get("fog");
  const held = qFog != null && Number.isFinite(+qFog);
  const qx = params.get("x");
  const qy = params.get("y");
  const fog = spring(held ? clamp(+qFog, 0, 1) : REST);
  const bx = spring(qx != null ? clamp(+qx, 0, 1) : 0.56);
  const by = spring(qy != null ? clamp(+qy, 0, 1) : 0.4);
  const breath = spring(held || qx != null ? 1 : 0.6);
  let time = Number.isFinite(+params.get("t")) && params.get("t") != null ? +params.get("t") : 0;
  let dirty = true;
  let touched = held;
  let drag = null;
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
      // Drag up to roll the fog in, down to clear it.
      fog.target = clamp(drag.f + ((drag.y - p.y) / Math.max(240, stage.height)) * 1.4, 0, 1);
    }
  });
  stage.on("down", (p) => {
    touched = true;
    breatheAt(p);
    drag = { y: p.y, f: fog.target };
  });
  stage.on("up", () => {
    drag = null;
  });
  const onLeave = () => {
    breath.target = 0.6;
  };
  stage.canvas.addEventListener("pointerleave", onLeave);
  const onWheel = (e) => {
    e.preventDefault();
    touched = true;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    fog.target = clamp(fog.target + dy / 900, 0, 1);
    breatheAt({ x: e.offsetX, y: e.offsetY });
  };
  if (!embedded) stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  // On arrival the fog rolls in over the street.
  const intro = held
    ? 0
    : window.setTimeout(() => {
        if (!touched) fog.target = ROLL;
      }, 900);

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
  const common = (u, sigma) => {
    gl.uniform1i(u.uDist, 1);
    gl.uniform1f(u.uSigma, sigma);
    gl.uniform3f(u.uBreath, bx.x, by.x, breath.x * 1.5);
    gl.uniform1f(u.uAspect, ASPECT);
    gl.uniform1f(u.uTime, time);
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
      // The coarsest level enters at full weight; scale it via the others.
      gl.uniform1f(P.up.u.uW, weights[i]);
      quadDraw(up[i]);
    }
    return up[0];
  };

  const draw = () => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const sigma = SIGMA_MIN * Math.pow(SIGMA_MAX / SIGMA_MIN, fog.x);
    bind(1, distTex);

    if (ambientDirty) {
      // The city's own light, blurred very wide: the colour the fog takes.
      gl.useProgram(P.ambient.p);
      bind(0, colorTex);
      gl.uniform1i(P.ambient.u.uColor, 0);
      gl.uniform1f(P.ambient.u.uLod, Math.log2(colorImg.naturalHeight / down[0].h));
      quadDraw(down[0]);
      chain([0, 0, 0, 0.15, 0.3]);
      // Copy the result into its own small texture.
      gl.useProgram(P.down.p);
      bind(0, up[0].tex);
      gl.uniform1i(P.down.u.uSrc, 0);
      gl.uniform2f(P.down.u.uTexel, 1 / up[0].w, 1 / up[0].h);
      quadDraw(ambient);
      ambientDirty = false;
    }

    // Halos from the lights through the fog in front of them.
    gl.useProgram(P.source.p);
    bind(0, colorTex);
    gl.uniform1i(P.source.u.uColor, 0);
    gl.uniform1f(P.source.u.uLod, Math.log2(colorImg.naturalHeight / down[0].h));
    common(P.source.u, sigma);
    quadDraw(down[0]);
    // Thicker fog: the light spreads wider.
    const f = fog.x;
    const halo = chain([0.5 - 0.3 * f, 0.6 - 0.25 * f, 0.6, 0.55 + 0.3 * f, 0.5 + 0.5 * f]);

    const dpr = stage.dpr;
    gl.useProgram(P.composite.p);
    bind(0, colorTex);
    bind(2, halo.tex);
    bind(3, ambient.tex);
    const cu = P.composite.u;
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uHalo, 2);
    gl.uniform1i(cu.uAmbient, 3);
    common(cu, sigma);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(cu.uGround, GROUND[0], GROUND[1], GROUND[2]);
    gl.uniform1f(cu.uHaloGain, 0.16 + 0.12 * f);
    quadDraw(null);
  };

  const stillTime = params.get("t") != null;
  stage.onFrame((dt) => {
    const moving = stepSpring(fog, dt, drag ? 120 : 26) | stepSpring(bx, dt, 30) | stepSpring(by, dt, 30) | stepSpring(breath, dt, 10);
    sinceDraw += dt;
    if (!stillTime) time += dt;
    // The fog drifts on its own, drawn at a capped rate.
    const drift = !stillTime && sinceDraw >= 1 / DRIFT_FPS;
    if (!moving && !dirty && !drift) return;
    dirty = false;
    sinceDraw = 0;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(intro);
      stage.canvas.removeEventListener("pointerleave", onLeave);
      stage.canvas.removeEventListener("wheel", onWheel);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
