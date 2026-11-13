import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm } from "../_kit/film";

// Look Up: stand in a street of towers and tilt your head back.
//
// The street is one 360 capture (Poly Haven's Canary Wharf, CC0). Its own
// sky is a flat haze, so above the towers a second capture is laid in
// through the street's sky matte: Poly Haven's Kloofendal 48d partly cloudy
// pure sky (CC0), fair-weather cumulus with sunlit tops and skylit bases,
// its open blue redrawn as one cobalt ramp by elevation. Graded offline
// (tools/depth/bakes/look-up) and stored as a cubemap. Every pixel is a ray:
// its angle from the centre of the frame comes from one radial family,
//
//   r = f k tan(theta / k)
//
// k = 1 is an ordinary rectilinear lens, k = 2 is stereographic. As the
// camera pitches up the field of view widens (70 -> 140 degrees) and k eases
// from 1 to 2, so straight towers bend into spokes round the zenith the way
// they do in a fisheye shot from the pavement. It is exact from the one
// image: no depth, nothing faked.
//
// Query: ?pitch=0..1 holds the tilt (0 eye level, 1 straight up), ?yaw=deg.

const ASSET = "/lab/look-up/";
const FACES = ["px", "nx", "py", "ny", "pz", "nz"];
const ENC = 1.35; // the faces store scene light / 1.35, sRGB-encoded

const YAW0 = 20; // faces the curved tower; the warm accent is the sunlit stone (see grade.py)
const FOV0 = 70;
const FOV1 = 140;
const AUTO_TILT = 0.14; // ~12.6 degrees: shows that it can look up

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform samplerCube uSky;
uniform vec2 uRes;      // device px
uniform float uR;       // half the longer side, device px
uniform float uHalf;    // half field angle across uR, radians
uniform float uK;       // 1 rectilinear .. 2 stereographic
uniform vec2 uPY;       // pitch, yaw (radians)
uniform float uGain;

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uRes;
  float r = length(p);
  float f = uR / (uK * tan(uHalf / uK));
  float th = uK * atan(r / (f * uK));
  vec2 d2 = r > 1e-4 ? p / r : vec2(0.0);
  vec3 d = vec3(sin(th) * d2, cos(th));     // x right, y up, z ahead
  float cp = cos(uPY.x), sp = sin(uPY.x);
  vec3 e = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(uPY.y), sy = sin(uPY.y);
  vec3 w = vec3(e.x * cy + e.z * sy, e.y, -e.x * sy + e.z * cy);
  vec3 c = texture(uSky, w).rgb * uGain;
  outColor = vec4(c, 1.0);
}`;

const FILM = {
  input: "linear",
  headroom: 0,
  exposure: 0,
  whitePoint: 1.55,
  contrast: 1.18,
  shoulder: 0.95,
  halation: 0.22,
  halationThreshold: 0.95,
  bloom: 0.1,
  softness: 0.22,
  saturation: 1.08,
  blueDepth: 0.6,
  // Neutral highlights: the bake already rolls the cloud tops off
  // warm-neutral, and the kit's cool default would cancel that.
  highlightTint: [1.0, 1.0, 0.99],
  grain: 0.32,
  vignette: 0.22,
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadFace(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

// A damped spring on one value; zeta < 1 settles with the faintest overshoot.
function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  // Semi-implicit Euler in small steps: stable at any frame time.
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

export async function createLookUp(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const qp = q.get("pitch");
  const held = qp != null && qp !== "" && Number.isFinite(+qp);
  const qy = q.get("yaw");
  // Any numeric film parameter can be overridden from the query for stills.
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) {
    const v = q.get(key);
    if (typeof FILM[key] === "number" && v != null && v !== "" && Number.isFinite(+v)) film0[key] = +v;
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // The colour field the sky opens from.
  host.style.background = "#dfe8ef";

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const bitmaps = await Promise.all(FACES.map((f) => loadFace(`${ASSET}${f}.webp`)));

  const cube = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
  const N = bitmaps[0].width;
  const levels = Math.floor(Math.log2(N)) + 1;
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl.SRGB8_ALPHA8, N, N);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  bitmaps.forEach((bm, i) => {
    gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    bm.close?.();
  });
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_CUBE_MAP, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const scene = compile(gl, VERT, SCENE);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });

  // The developed frame starts life as scene light in a half-float target.
  let tex = null;
  let fbo = null;
  let enc = 1;
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      // No float targets: keep the light in sRGB8 and let film decode it.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      if (!fbo) fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      enc = 1 / ENC;
    } else enc = 1;
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(w, h);
    dirty = true;
  };
  let dirty = true;
  stage.onResize(build);

  // ---- state
  // tilt: 0 eye level .. 1 straight up. yaw in degrees.
  const startTilt = held ? clamp(+qp, 0, 1) : 0;
  const tilt = spring(startTilt);
  const yaw = spring(qy != null && Number.isFinite(+qy) ? +qy : YAW0);
  const hover = { x: 0, y: 0 }; // small parallax, degrees
  const tiltOmega = { held: 38, free: 11 };
  let grab = null;
  let born = performance.now();
  let introDone = held || reduced;
  if (reduced && !held) tilt.x = tilt.to = AUTO_TILT;
  let exposureFrom = held ? 0 : 2.5; // stops over, settling to 0
  let lastKey = "";
  let lastGrain = -1;
  let breathe = 0; // 0..1, fades in when idle

  const fovOf = (s) => FOV0 + (FOV1 - FOV0) * Math.pow(clamp(s, 0, 1), 1.35);
  const kOf = (s) => 1 + smooth(0.32, 0.96, s);

  const dragScale = () => stage.height * 0.85;
  stage.on("down", (p) => {
    introDone = true;
    grab = { y: p.y, x: p.x, t0: tilt.x, y0: yaw.x };
    requestOrientation();
  });
  stage.on("up", (p) => {
    if (!grab) return;
    grab = null;
    // Carry the hand's speed a little further, then settle inside the range.
    const vt = -p.vy / dragScale();
    tilt.to = clamp(tilt.to + vt * 0.22, 0, 1);
    tilt.v = vt * 0.6;
    const degPerPx = fovOf(tilt.x) / Math.max(stage.width, stage.height);
    yaw.to = yaw.to - p.vx * degPerPx * 0.22;
  });

  // Phones: a hand-held tilt of the device gives a couple of degrees of
  // parallax, low-passed.
  const orient = { b: null, g: null, x: 0, y: 0 };
  const onOrient = (e) => {
    if (e.beta == null) return;
    if (orient.b == null) {
      orient.b = e.beta;
      orient.g = e.gamma;
    }
    orient.x = clamp((e.gamma - orient.g) * 0.12, -2, 2);
    orient.y = clamp((e.beta - orient.b) * 0.12, -2, 2);
  };
  let orientOn = false;
  function requestOrientation() {
    if (orientOn || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orientOn = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  const renderScene = (s, pitchDeg, yawDeg) => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(scene.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
    gl.uniform1i(scene.u.uSky, 0);
    gl.uniform2f(scene.u.uRes, w, h);
    gl.uniform1f(scene.u.uR, 0.5 * Math.max(w, h));
    gl.uniform1f(scene.u.uHalf, ((fovOf(s) / 2) * Math.PI) / 180);
    gl.uniform1f(scene.u.uK, kOf(s));
    gl.uniform2f(scene.u.uPY, (pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180);
    gl.uniform1f(scene.u.uGain, ENC * enc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  const frame = (dt, t) => {
    const now = performance.now();
    const p = stage.pointer;
    const age = (now - born) / 1000;

    // Intro: open overexposed and tilt up a little, then hand over.
    if (!introDone) {
      const u = clamp((age - 0.35) / 1.6, 0, 1);
      tilt.x = tilt.to = AUTO_TILT * expoOut(u);
      tilt.v = 0;
      if (u >= 1) introDone = true;
    }
    const expT = reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + exposureFrom * (1 - expT);

    if (grab) {
      // Past the ends the street resists, like a held rubber band.
      let want = grab.t0 - (p.y - grab.y) / dragScale();
      if (want > 1) want = 1 + (want - 1) * 0.35;
      if (want < 0) want = want * 0.35;
      tilt.to = want;
      const degPerPx = fovOf(tilt.x) / Math.max(stage.width, stage.height);
      yaw.to = grab.y0 - (p.x - grab.x) * degPerPx;
      stepSpring(tilt, tiltOmega.held, 1, dt);
      stepSpring(yaw, tiltOmega.held, 1, dt);
    } else {
      if (introDone) tilt.to = clamp(tilt.to, 0, 1);
      if (introDone) stepSpring(tilt, tiltOmega.free, 0.86, dt);
      stepSpring(yaw, tiltOmega.free, 0.86, dt);
    }

    // Hover: the view leans a degree or two toward the pointer.
    const hx = !grab && p.inside && !reduced ? ((p.x / stage.width) - 0.5) * 3 : 0;
    const hy = !grab && p.inside && !reduced ? ((p.y / stage.height) - 0.5) * -2 : 0;
    hover.x = damp(hover.x, hx + orient.x, 1 / 0.33, dt);
    hover.y = damp(hover.y, hy - orient.y, 1 / 0.33, dt);

    // Breathing: half a degree on a slow Lissajous once the hand is away.
    const idle = !grab && stage.idleFor() > 1500 && introDone && !held && !reduced;
    breathe = damp(breathe, idle ? 1 : 0, 0.8, dt);
    const bp = breathe * 0.45 * Math.sin((t * 2 * Math.PI) / 11.3);
    const by = breathe * 0.55 * Math.sin((t * 2 * Math.PI) / 13.7 + 1.2);

    const s = tilt.x;
    // Past straight up is not allowed; the rubber band shows as resistance.
    const pitchDeg = clamp(90 * s + hover.y + bp, -10, 90);
    const yawDeg = yaw.x + hover.x + by;
    const key = `${s.toFixed(5)}|${pitchDeg.toFixed(4)}|${yawDeg.toFixed(4)}`;
    if (key !== lastKey || dirty) {
      renderScene(s, pitchDeg, yawDeg);
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // Film at 24 fps: the grain moves at the rate film did.
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || exposure > 1e-3) {
      film.render(tex, { ...film0, exposure: exposure + (enc < 1 ? Math.log2(ENC) : 0), grainSeed: tick * 7.31 });
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  // Warm every program up before the reveal: one full frame now.
  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!tex) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      gl.deleteTexture(cube);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(scene.p);
      stage.destroy();
    },
  };
}
