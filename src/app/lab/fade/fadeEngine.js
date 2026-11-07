import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Fade: a Kyoto noodle shop in an autumn afternoon, and the thirty years of
// sun that come after it. Drag forward and every surface ages by the light it
// actually receives.
//
// The bake (tools/depth/bakes/fade) takes Pincalo's photograph apart:
//  - light.webp R: the annual solar dose per pixel. MoGe-2's metric point map
//    is marched toward 144 sun positions over a year at 35 N (12 days x 12
//    hours, clear-sky beam x Kyoto's sunshine fraction) plus the sky-view
//    factor x diffuse, normalised so an open south wall is 1. The eaves, the
//    lower roof and the awning carve the shade out of it.
//  - light.webp G: the photo's own illumination (sun term marched at its sun,
//    Nov 15 14:30, plus sky), calibrated on the sunlit sign and the shaded
//    menu, so albedo = photo / S.
//  - mat.webp: how each pixel ages (SAM masks): printed ink, wood, chalking
//    paint and fabric, and what is inert (sky, glass, fired tile, leaves).
//
// Live, per pixel, with e = years x dose x susceptibility:
//  - ink: albedo -> optical density per channel; the neutral part is carbon
//    black, the rest is cyan (absorbs red), magenta (green) and yellow (blue),
//    each fading exponentially, yellow and magenta about 4x faster than cyan,
//    so reds and yellows go first and old signs drift to cyan;
//  - wood: lignin breaks down and brown boards go silver grey;
//  - chalk: the binder erodes and TiO2 powders out, lifting matte paint and
//    fabric towards a pale flat white;
// then photo + S x (aged albedo - albedo), developed by the shared film kit.
//
// Query: ?years=0..30 holds the clock; ?still=1 skips the reveal; ?film=0
// shows the aged frame before the film; ?debug=dose shows the dose map.

const BASE = "/lab/fade/";
const PW = 1440;
const PH = 1800;
const YEARS = 30;
const OPEN_AT = 3.2;
// Fade rates per unit dose-year (1 = a year on an open south wall).
// Each surface first spends an induction dose (its UV absorbers and
// stabilisers are used up), so what stays in shade never really starts.
const K_INK = [0.03, 0.13, 0.16]; // cyan, magenta, yellow
const K_BLACK = 0.004;
const K_WOOD = 0.1;
const K_CHALK = 0.07;
const CHALK_MAX = 0.4;
const INDUCTION = 2.5;
// Chalking needs the film itself to erode: only well-exposed paint gets there.
const CHALK_INDUCTION = 7;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const AGE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform sampler2D uLight;
uniform float uYears;
uniform vec3 uKInk;
uniform float uKBlack;
uniform float uKWood;
uniform float uKChalk;
uniform float uChalkMax;
uniform float uInduction;
uniform float uChalkInduction;
uniform float uDebug;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float LN10 = 2.302585;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 lin = toLin(texture(uPlate, uv).rgb);
  vec4 m = texture(uMat, uv);
  vec3 L = texture(uLight, uv).rgb;
  float dose = L.r * 2.0;
  float S = max(L.g * L.g * 1.5, 0.02);
  if (uDebug > 0.5) {
    outColor = vec4(toSrgb(vec3(dose * 0.5) * vec3(1.0, 0.97, 0.9)), 1.0);
    return;
  }
  // effective dose after induction, with a soft knee (softplus)
  float e0 = uYears * dose * m.a;
  float e = uInduction * log(1.0 + exp(e0 / uInduction - 1.0)) - uInduction * log(1.0 + exp(-1.0));
  e = max(e, 0.0);

  // albedo and optical density per channel
  vec3 a = clamp(lin / S, 0.004, 1.0);
  vec3 dens = -log(a) / LN10;
  float k = min(min(dens.r, dens.g), dens.b) * 0.9;
  vec3 cmy = dens - k;
  // dye loss: each ink by its own rate; carbon black barely moves
  vec3 lost = cmy * (1.0 - exp(-uKInk * e)) + k * (1.0 - exp(-uKBlack * e));
  vec3 aInk = min(a * exp(lost * LN10), 1.0);

  // wood: lignin goes, cellulose stays: silver grey, a touch lighter
  float y = dot(a, LUMA);
  vec3 silver = vec3(y * 1.15 + 0.045) * vec3(1.01, 1.0, 0.97);
  vec3 aWood = mix(a, silver, 0.8 * (1.0 - exp(-uKWood * e)));

  vec3 aged = a + m.r * (aInk - a) + m.g * (aWood - a);
  // chalk: the binder erodes and the white pigment powders the surface
  float ec = max(e0 - uChalkInduction, 0.0);
  float c = m.b * uChalkMax * (1.0 - exp(-uKChalk * ec));
  vec3 chalkWhite = vec3(0.74, 0.745, 0.735);
  aged = mix(aged, max(aged, chalkWhite * (0.55 + 0.45 * dot(aged, LUMA) / 0.6)), c);
  aged = mix(aged, vec3(dot(aged, LUMA)), c * 0.35);

  vec3 outLin = max(lin + S * (aged - a), 0.0);
  outColor = vec4(toSrgb(outLin), 1.0);
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

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const num = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

export async function createFade(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const yearsQ = num(q, "years");
  const held = yearsQ != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const debugDose = q.get("debug") === "dose";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [plateImg, matImg, lightImg] = await Promise.all(["plate.webp", "mat.webp", "light.webp"].map((f) => loadImage(BASE + f)));
  const plate = imageTexture(gl, plateImg, true);
  const mat = imageTexture(gl, matImg, true);
  const light = imageTexture(gl, lightImg, false);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = { age: program(gl, VERT, AGE), blit: program(gl, VERT, BLIT) };
  const film = createFilm(gl, { width: 2, height: 2 });

  // The print: 4:5, alone on the paper, as large as the box allows.
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2 };
  const T = { scene: null, film: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      const h = H;
      const w = h * ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: 0 });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = Math.min(W - side * 2, H * 0.84 * ar);
      const h = w / ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    } else {
      const top = Math.max(24, H * 0.07);
      const h = Math.min(H - top * 2, (W - 48) / ar);
      const w = h * ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph);
    T.film = target(gl, L.pw, L.ph);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // The clock: a goal the hand sets 1:1, and the shown years following it on
  // a critically-damped-ish spring. Release carries the hand's velocity.
  let goal = held ? clamp(yearsQ, 0, YEARS) : 0;
  let years = goal;
  let yearsV = 0;
  let goalV = 0;
  let dragging = false;
  let dragX = 0;
  let dragGoal = 0;
  let touched = held;
  let seed = 0;
  const span = () => Math.max(L.w * 1.6, Math.min(stage.width * 0.7, 900));

  stage.on("down", (p) => {
    dragging = true;
    touched = true;
    dragX = p.x;
    dragGoal = goal;
    goalV = 0;
    host.dataset.dragging = "";
  });
  stage.on("move", (p) => {
    if (!dragging) return;
    let g = dragGoal + ((p.x - dragX) / span()) * YEARS;
    const band = (o) => 2.4 * (1 - Math.exp((-0.4 * o) / 2.4));
    if (g < 0) g = -band(-g);
    if (g > YEARS) g = YEARS + band(g - YEARS);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp((p.vx / span()) * YEARS, -60, 60);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 5 : 1), 0, YEARS);
  };
  host.addEventListener("keydown", onKey);

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);

    const u = P.age.u;
    gl.useProgram(P.age.p);
    bindTex(0, plate, u.uPlate);
    bindTex(1, mat, u.uMat);
    bindTex(2, light, u.uLight);
    gl.uniform1f(u.uYears, clamp(years, 0, YEARS + 2));
    gl.uniform3fv(u.uKInk, K_INK);
    gl.uniform1f(u.uKBlack, K_BLACK);
    gl.uniform1f(u.uKWood, K_WOOD);
    gl.uniform1f(u.uKChalk, K_CHALK);
    gl.uniform1f(u.uChalkMax, CHALK_MAX);
    gl.uniform1f(u.uInduction, INDUCTION);
    gl.uniform1f(u.uChalkInduction, CHALK_INDUCTION);
    gl.uniform1f(u.uDebug, debugDose ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!raw && !debugDose) {
      film.render(
        T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          exposure: 0.12 + expoStops,
          headroom: 0.6,
          halation: 0.22,
          bloom: 0.2,
          softness: 0.5,
          contrast: 1.06,
          toe: 0.035,
          saturation: 1.02,
          blueDepth: 0.4,
          shadowTint: [0.95, 1, 1.05],
          highlightTint: [1.0, 1, 0.99],
          vignette: 0.18,
          whitePoint: 1.2,
          grain: 0.32,
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
    bindTex(0, raw || debugDose ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print opens overexposed, an airy white-blue, and settles to
  // exposure; then the clock eases a few years forward to show it can move.
  const REVEAL = 2.0;
  const WALK_AT = 1.5;
  const WALK = 2.4;
  let t0 = -1;
  let grainClock = 0;

  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now() / 1000;
    if (t0 < 0) t0 = now;
    const age = still ? 99 : now - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held && !touched) {
      goal = reduce ? 0 : OPEN_AT * expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-3) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > YEARS) goal += (YEARS - goal) * (1 - Math.exp(-dt * 14));
    }

    let moving = false;
    if (held) years = goal;
    else {
      const w = 14;
      const z = 0.86;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (goal - years) - 2 * z * w * yearsV;
        yearsV += a * h;
        years += yearsV * h;
      }
      moving = Math.abs(goal - years) > 1e-3 || Math.abs(yearsV) > 1e-3;
      if (!moving) {
        years = goal;
        yearsV = 0;
      }
    }

    let tick = false;
    if (!reduce && !held) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    if (!dirty && !moving && !tick && !revealing) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      [plate, mat, light].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
