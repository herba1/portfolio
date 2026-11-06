import { createStage, clamp } from "../_kit/stage";

// Overexpose. One linear HDR frame (a worm's-eye stereographic view of a Poly
// Haven HDRI, looking up through the pines; log-encoded so the radiance is
// real) developed live through a colour negative: per-layer H&D curves with a
// long shoulder, a fixed printer light, then a print paper curve. Drag up and the exposure rises to +3 stops.
// Because the negative's shoulder and the paper's toe compress instead of
// clipping, the frame goes airy and pastel, the cobalt thins to powder blue
// and the cumulus keep their shape; nothing reaches 255.
//
// The optics (Pro-Mist diffusion and base-reflection halation) are linear in
// exposure, so they are baked once, offline, from the same radiance and
// shipped beside it. They get stronger as you overexpose only because the
// curve lifts the shadows they land on out of the toe, as on real film.
//
// The grade is written inside this piece rather than through _kit/film.js:
// film.js develops with one display curve for all channels, and this piece is
// about the negative + print pair itself. The parameter names (exposure,
// halation, halationColor, bloom, grain, grainSeed) match film.js.

const LO = -8.5; // log2 radiance range of the shipped encoding (see experiment.json)
const HI = 2.5;
const MIN_EV = -1;
const MAX_EV = 3;
const STOP = 0.225; // fraction of the print's height that is one stop of drag

export const FILM = {
  exposure: 0,
  norm: 1.0, // scene radiance to film exposure at 0 EV (metered for the sky)
  negGamma: [0.6, 0.62, 0.66], // density per log10 H, red / green / blue layers
  negShoulder: [2.1, 2.3, 2.4], // density each layer saturates towards
  negToe: -4.5, // stops below grey where the toe sits
  shoulderP: 1.4, // shoulder knee; lower is longer
  printComp: 0.15, // how much of the overexposure the printer light takes back
  paperGamma: 3.6,
  paperDmin: [0.042, 0.044, 0.052], // paper white, a touch warm: never 255
  paperDmax: [1.9, 1.8, 1.75], // the scanned black, lifted and cyan
  printGrey: 0.25,
  saturation: 1.15,
  blueDepth: 1.5,
  blueHue: [0.86, 0.93, 1.0],
  hiDesat: 0.45,
  hiWarm: 0.025,
  bloom: 0.08,
  halation: 0.15,
  halationColor: [1.0, 0.3, 0.08],
  grain: 0.03,
  grainSeed: 0,
};

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const DECODE_FS = `#version 300 es
precision highp float;
uniform sampler2D uLog; uniform vec2 uSize;
out vec4 o;
void main(){
  vec3 c = texelFetch(uLog, ivec2(gl_FragCoord.xy), 0).rgb;
  o = vec4(exp2(c * ${(HI - LO).toFixed(4)} + ${LO.toFixed(4)}), 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;   // linear radiance (or log-encoded when uLogIn)
uniform sampler2D uOptics;  // left half: diffusion, right half: halation source
uniform float uLogIn;
uniform vec4 uRect;         // square in device px: x, y, size, size
uniform float uExp;         // norm * 2^ev
uniform vec3 uGamma; uniform vec3 uShoulder; uniform float uToe; uniform float uShP;
uniform vec3 uGref;         // negative density of the printer-light grey
uniform vec3 uPk; uniform vec3 uPx0; uniform vec3 uDmin; uniform vec3 uDmax;
uniform float uSat; uniform float uBlueSat; uniform vec3 uBlueHue; uniform float uHiDesat; uniform float uHiWarm;
uniform float uBloom; uniform float uHal; uniform vec3 uHalColor;
uniform float uGrain; uniform float uSeed; uniform float uGrainPx;
out vec4 o;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const mat3 XT = mat3(0.92, 0.04, 0.01,  0.07, 0.90, 0.07,  0.01, 0.06, 0.92); // layer cross-talk (columns)

vec3 dec(vec3 c){ return exp2(c * ${(HI - LO).toFixed(4)} + ${LO.toFixed(4)}); }
vec3 softplus(vec3 x){ const float k = 1.2; return log(1.0 + exp(-abs(x * k))) / k + max(x, 0.0); }
vec3 negD(vec3 stops){
  vec3 lin = uGamma * 0.30103 * softplus(stops - uToe);
  return lin / pow(1.0 + pow(lin / uShoulder, vec3(uShP)), vec3(1.0 / uShP));
}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 p = (gl_FragCoord.xy - uRect.xy) / uRect.zw;
  vec2 uv = vec2(p.x, 1.0 - p.y); // textures are uploaded top row first
  vec3 L = texture(uScene, uv).rgb;
  if (uLogIn > 0.5) L = dec(L);
  float hx = clamp(uv.x, 0.002, 0.998) * 0.5;
  vec3 D = dec(texture(uOptics, vec2(hx, uv.y)).rgb);
  float Yb = dec(texture(uOptics, vec2(hx + 0.5, uv.y)).rgb).g;

  // Pro-Mist: a fixed share of all light lands spread out.
  L = mix(L, D, uBloom);
  // Halation: light bounced off the base comes back through the red layer,
  // landing just outside bright areas (a ring, not a fill).
  L += uHalColor * max(Yb - dot(L, LUMA), 0.0) * uHal;

  // Negative: each layer on its own H&D curve.
  vec3 H = XT * L * uExp;
  vec3 d = negD(log2(max(H, 1e-6) / 0.18));
  // Print: fixed printer light, then the paper's own S-curve.
  vec3 lp = -(d - uGref);
  vec3 dens = uDmin + (uDmax - uDmin) / (1.0 + exp(-(uPk * lp + uPx0)));
  vec3 c = pow(vec3(10.0), -dens);

  // Scan: summer sky leans cobalt, colour sits in the midtones and bleaches
  // (a little warm) in the highlights. Saturation is a power on the channel
  // ratios, so no channel is ever pushed through zero.
  float blue = clamp((c.b - c.r) / (c.b + 1e-4), 0.0, 1.0);
  c *= 1.0 + (uBlueHue - 1.0) * blue * blue;
  float y = dot(c, LUMA);
  float hi = clamp((y - 0.45) / 0.4, 0.0, 1.0);
  float s = uSat * (1.0 - uHiDesat * hi) * (1.0 + (uBlueSat - 1.0) * blue);
  vec3 r = max(c, 1e-5) / max(y, 1e-5);
  c = y * pow(r, vec3(s));
  c *= y / max(dot(c, LUMA), 1e-6);
  c *= 1.0 + uHiWarm * hi * vec3(1.0, 0.3, -0.6);
  vec3 outc = srgb(c);

  // Grain after the curve, strongest in the mids; dither last.
  vec2 gp = gl_FragCoord.xy / uGrainPx + uSeed * vec2(17.13, 31.71);
  float g = vnoise(gp) * 0.65 + vnoise(gp * 2.13 + 7.7) * 0.35 - 0.5;
  vec3 gc = vec3(vnoise(gp + 41.0), vnoise(gp + 83.0), vnoise(gp + 127.0)) - 0.5;
  float ly = dot(outc, LUMA);
  outc += (vec3(g) + gc * 0.25) * uGrain * 4.0 * ly * (1.0 - ly) * 2.0;
  outc += (hash(gl_FragCoord.xy + uSeed) + hash(gl_FragCoord.yx + 3.1 + uSeed) - 1.0) / 255.0;
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // Data, not a picture: no colour management, no premultiply.
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
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

// The negative's density at a given exposure (stops from grey), per layer.
function negD(stops, c, F) {
  const x = stops - F.negToe;
  const sp = Math.log1p(Math.exp(-Math.abs(x * 1.2))) / 1.2 + Math.max(x, 0);
  const lin = F.negGamma[c] * 0.30103 * sp;
  return lin / (1 + (lin / F.negShoulder[c]) ** F.shoulderP) ** (1 / F.shoulderP);
}

// Rubber band past the ends of the dial.
const rubber = (v, lo, hi) => {
  const band = (x) => (1 - 1 / (x * 0.45 + 1)) / 0.45 * 0.35;
  if (v > hi) return hi + band(v - hi);
  if (v < lo) return lo - band(lo - v);
  return v;
};
const unrubber = (v, lo, hi) => {
  const inv = (y) => {
    const t = (y / 0.35) * 0.45;
    return t >= 0.999 ? 1e3 : 1 / (1 - t) / 0.45 - 1 / 0.45;
  };
  if (v > hi) return hi + inv(v - hi);
  if (v < lo) return lo - inv(lo - v);
  return v;
};

export async function createOverexpose(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixed = params.has("ev") ? clamp(parseFloat(params.get("ev")) || 0, MIN_EV, MAX_EV) : null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const still = fixed != null || params.has("still");

  const [sceneImg, opticsImg] = await Promise.all([bitmap("/lab/overexpose/scene.webp"), bitmap("/lab/overexpose/optics.png")]);

  // Warm white paper around the print, whatever the site theme.
  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Exposure");
  canvas.setAttribute("aria-valuemin", String(MIN_EV));
  canvas.setAttribute("aria-valuemax", String(MAX_EV));
  canvas.style.outline = "none";

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const prog = compile(gl, VS, FS);
  const logTex = upload(gl, sceneImg, false);
  const opticsTex = upload(gl, opticsImg, false);

  // Decode the radiance once into a half-float texture so the minified print
  // averages light, not logarithms. Without a renderable float format, sample
  // the log texture directly.
  let sceneTex = logTex;
  let logIn = 1;
  if (gl.getExtension("EXT_color_buffer_float")) {
    const w = sceneImg.width;
    const h = sceneImg.height;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      const dprog = compile(gl, VS, DECODE_FS);
      gl.useProgram(dprog.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, logTex);
      gl.uniform1i(dprog.u.uLog, 0);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.deleteProgram(dprog.p);
      sceneTex = t;
      logIn = 0;
    } else gl.deleteTexture(t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  }
  sceneImg.close?.();
  opticsImg.close?.();

  // Paper constants: grey lands on printGrey, slope paperGamma at the middle.
  const F = FILM;
  const pk = [0, 1, 2].map((c) => (4 * F.paperGamma) / (F.paperDmax[c] - F.paperDmin[c]));
  const px0 = [0, 1, 2].map((c) => {
    const t0 = (-Math.log10(F.printGrey) - F.paperDmin[c]) / (F.paperDmax[c] - F.paperDmin[c]);
    return Math.log(t0 / (1 - t0));
  });

  // The print: a square, as large as the box allows with room around it.
  const rect = { x: 0, y: 0, s: 1 };
  const layout = (w, h) => {
    const gutter = Math.max(16, w * 0.06);
    const s = Math.floor(Math.min(w - gutter * 2, h * 0.8, 1400));
    rect.s = s;
    rect.x = Math.round((w - s) / 2);
    rect.y = Math.round((h - s) / 2);
  };

  // Exposure: the value shown, its velocity, and where it is heading.
  const ev = { v: fixed ?? (reduced ? 0 : MAX_EV), vel: 0, target: fixed ?? 0, mode: "spring" };
  let reveal = fixed == null && !reduced ? { t: 0, from: MAX_EV, to: 0, dur: 2.0 } : null;
  let drag = null;
  let dirty = true;
  let grainT = 0;
  let seed = 3;

  const snap = (x) => clamp(Math.round(x * 3) / 3, MIN_EV, MAX_EV); // a dial in thirds

  const inside = (p, slop = 24) => p.x > rect.x - slop && p.x < rect.x + rect.s + slop && p.y > rect.y - slop && p.y < rect.y + rect.s + slop;

  stage.on("down", (p) => {
    if (!inside(p)) return;
    reveal = null;
    drag = { y: p.y, raw: unrubber(ev.v, MIN_EV, MAX_EV) };
    ev.vel = 0;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      const raw = drag.raw + (drag.y - p.y) / (rect.s * STOP);
      ev.v = rubber(raw, MIN_EV, MAX_EV);
      ev.target = ev.v;
      dirty = true;
    } else canvas.style.cursor = inside(p, 0) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = inside(p, 0) ? "grab" : "";
    // Carry the hand's speed a little way, then settle into the nearest third.
    const vel = -p.vy / (rect.s * STOP);
    ev.vel = clamp(vel, -12, 12);
    ev.target = snap(ev.v + ev.vel * 0.22);
    dirty = true;
  });

  let wheelTimer = 0;
  const onWheel = (e) => {
    e.preventDefault();
    reveal = null;
    ev.target = clamp(ev.target - e.deltaY * 0.004, MIN_EV - 0.2, MAX_EV + 0.2);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      ev.target = snap(ev.target);
    }, 160);
    dirty = true;
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    reveal = null;
    ev.target = snap(ev.target + step / 3);
    dirty = true;
  };
  canvas.addEventListener("keydown", onKey);

  stage.onResize((w, h) => {
    layout(w, h);
    dirty = true;
  });

  const draw = () => {
    const dpr = stage.dpr;
    const cw = canvas.width;
    const ch = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const x = Math.round(rect.x * dpr);
    const s = Math.round(rect.s * dpr);
    const y = ch - Math.round(rect.y * dpr) - s;
    gl.viewport(x, y, s, s);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    const u = prog.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, opticsTex);
    gl.uniform1i(u.uOptics, 1);
    gl.uniform1f(u.uLogIn, logIn);
    gl.uniform4f(u.uRect, x, y, s, s);
    const e = ev.v;
    gl.uniform1f(u.uExp, F.norm * 2 ** e);
    gl.uniform3fv(u.uGamma, F.negGamma);
    gl.uniform3fv(u.uShoulder, F.negShoulder);
    gl.uniform1f(u.uToe, F.negToe);
    gl.uniform1f(u.uShP, F.shoulderP);
    // The printer light is set for a normal negative and only partly follows
    // the overexposure, which is what leaves the print light and airy.
    gl.uniform3f(u.uGref, negD(e * F.printComp, 0, F), negD(e * F.printComp, 1, F), negD(e * F.printComp, 2, F));
    gl.uniform3fv(u.uPk, pk);
    gl.uniform3fv(u.uPx0, px0);
    gl.uniform3fv(u.uDmin, F.paperDmin);
    gl.uniform3fv(u.uDmax, F.paperDmax);
    gl.uniform1f(u.uSat, F.saturation);
    gl.uniform1f(u.uBlueSat, F.blueDepth);
    gl.uniform3fv(u.uBlueHue, F.blueHue);
    gl.uniform1f(u.uHiDesat, F.hiDesat);
    gl.uniform1f(u.uHiWarm, F.hiWarm);
    gl.uniform1f(u.uBloom, F.bloom);
    gl.uniform1f(u.uHal, F.halation);
    gl.uniform3fv(u.uHalColor, F.halationColor);
    gl.uniform1f(u.uGrain, F.grain);
    gl.uniform1f(u.uSeed, seed);
    // Grain clumps sized to the print, about 1/1000 of its side.
    gl.uniform1f(u.uGrainPx, Math.max(1, s / 1000));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.setAttribute("aria-valuenow", e.toFixed(2));
    canvas.setAttribute("aria-valuetext", `${e >= 0 ? "+" : "−"}${Math.abs(Math.round(e * 3) / 3).toFixed(1)} stops`);
  };

  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

  stage.onFrame((dt) => {
    if (reveal) {
      // Opens overexposed, white-blue, and the sky deepens into cobalt as the
      // eye adjusts.
      reveal.t += dt;
      const k = easeOutExpo(Math.min(1, reveal.t / reveal.dur));
      ev.v = reveal.from + (reveal.to - reveal.from) * k;
      ev.vel = 0;
      if (reveal.t >= reveal.dur) reveal = null;
      dirty = true;
    } else if (!drag) {
      // Spring to the target: damping ratio 0.85, settles in about half a second.
      const w = 11;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -2 * z * w * ev.vel - w * w * (ev.v - ev.target);
        ev.vel += a * h;
        ev.v += ev.vel * h;
      }
      if (Math.abs(ev.v - ev.target) < 1e-4 && Math.abs(ev.vel) < 1e-3) {
        if (ev.v !== ev.target) dirty = true;
        ev.v = ev.target;
        ev.vel = 0;
      } else dirty = true;
    }
    // Grain moves at 24 fps, like a projected strip, never at 60.
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty) {
      dirty = false;
      draw();
    }
  });
  void embedded;

  return {
    destroy() {
      clearTimeout(wheelTimer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      gl.deleteTexture(logTex);
      if (sceneTex !== logTex) gl.deleteTexture(sceneTex);
      gl.deleteTexture(opticsTex);
      gl.deleteProgram(prog.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
