import { createStage, clamp, damp } from "../_kit/stage";

// Dapples on a wall are pinhole images of the sun: every gap between the
// leaves projects the sun's disc, sized by its distance to the wall. So the
// light here is drawn as exactly that: one instanced quad per leaf gap, each
// rendering the sun's current shape (disc, limb darkening, the moon's bite)
// as an ellipse foreshortened by the sun's angle, added into a float light
// buffer. A second pass lights a plaster wall with it.

const LIGHT_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aGap;   // x, y, radius, brightness
layout(location=2) in vec2 aMore;  // blur, phase
uniform vec2 uRes; uniform float uTime; uniform vec2 uAxis; uniform float uRot; uniform float uWind;
out vec2 vQ; out float vB; out float vBlur;
void main(){
  float ph = aMore.y;
  float r = aGap.z;
  // Leaves move: each gap drifts a little and opens and closes.
  vec2 sway = vec2(sin(uTime * 0.8 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.25,
                   cos(uTime * 0.7 + ph * 1.3) * 0.35) * r * 0.14 * uWind;
  vec2 q = aCorner * 1.9;               // in sun radii, room for the corona
  float c = cos(uRot), s = sin(uRot);
  vec2 e = q * uAxis * r;
  vec2 p = aGap.xy + sway + vec2(c * e.x - s * e.y, s * e.x + c * e.y);
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  vQ = q;
  vB = aGap.w * (0.86 + 0.14 * sin(uTime * 1.2 + ph * 3.1)) * mix(1.0, 0.92 + 0.08 * sin(uTime * 3.7 + ph * 5.0), uWind);
  vBlur = aMore.x;
}`;

const LIGHT_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vB; in float vBlur;
uniform vec2 uMoon; uniform float uMoonR; uniform float uTotal;
out vec4 o;
void main(){
  float d = length(vQ);
  float s = vBlur;
  // The sun: a disc, darker toward its limb.
  float mu = sqrt(max(0.0, 1.0 - min(1.0, d * d)));
  float limb = 1.0 - 0.5 * (1.0 - mu) - 0.15 * (1.0 - mu * mu);
  // What is left of it, as one shape: inside the sun and outside the moon.
  // The gap's blur softens that shape as a whole, so a thin crescent stays a
  // crescent instead of growing a ghost ring where the moon covers the limb.
  float dm = length(vQ - uMoon);
  float sd = max(d - 1.0, uMoonR - dm);
  float light = smoothstep(s, -s, sd) * mix(1.0, limb, 0.8);
  // Corona: only visible when the disc is gone.
  float corona = exp(-pow(max(0.0, d - 1.0) / 0.32, 1.2)) * smoothstep(0.9, 1.05, d) * 0.06;
  light += corona * uTotal;
  o = vec4(vec3(light * vB), 1.0);
}`;

const COMP_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uLight; uniform vec2 uRes; uniform float uDpr; uniform float uScale;
uniform float uUncov; uniform float uTotal; uniform float uGain;

out vec4 o;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

vec3 filmic(vec3 x){
  // ACES fit (Narkowicz).
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes; // css px, y down
  vec3 L = texture(uLight, vUv).rgb * uGain;
  // Plaster: broad trowel variation, fine grit, and a relief the low sun rakes.
  vec2 w = px / uScale;
  float broad = fbm(w * 3.0);
  float trowel = fbm(vec2(w.x * 7.0 + w.y * 2.0, w.y * 2.5));
  float grit = hash(floor(px * uDpr / 1.4));
  vec3 albedo = vec3(0.86, 0.835, 0.79) * (0.95 + 0.05 * broad) * (0.985 + 0.03 * trowel);
  albedo *= 0.985 + 0.03 * grit;
  float e = 1.5 / uScale;
  float h0 = fbm(w * 60.0) * 0.6 + trowel * 0.4;
  float hx = fbm((w + vec2(e, 0.0)) * 60.0) * 0.6 + fbm(vec2((w.x + e) * 7.0 + w.y * 2.0, w.y * 2.5)) * 0.4;
  float hy = fbm((w + vec2(0.0, e)) * 60.0) * 0.6 + fbm(vec2(w.x * 7.0 + (w.y + e) * 2.0, (w.y + e) * 2.5)) * 0.4;
  vec2 grad = vec2(hx - h0, hy - h0) / e;
  // Sun from the upper left, low: relief shows only where it lands.
  float rake = clamp(1.0 + dot(grad, vec2(-0.7, -0.7)) * 0.012, 0.6, 1.4);

  // Skylight in the shade: cool, falling off down the wall, fading as the
  // eclipse deepens and turning blue at totality.
  float sky = 0.3 * mix(0.94, 1.06, vUv.y) * (0.97 + 0.06 * broad);
  vec3 skyCol = mix(vec3(0.95, 0.93, 0.9), vec3(0.3, 0.38, 0.62), uTotal);
  float dim = mix(0.05, 1.0, pow(uUncov, 0.6));
  vec3 sunCol = vec3(1.0, 0.86, 0.66);
  vec3 col = albedo * (skyCol * sky * dim + L * sunCol * rake * 1.25);

  // The eye adapts: the shade stays the same paper-white until the light is
  // nearly gone, so the dapples keep their brightness and only change shape.
  col *= 1.0 / max(dim, 0.16);
  col = filmic(col * 1.5);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash(px * 0.37 + 0.5) - 0.5) / 255.0; // dither
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const uniforms = (gl, p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));

// Fraction of a unit disc left uncovered by a disc of radius k at distance d.
function uncovered(d, k) {
  if (d >= 1 + k) return 1;
  if (d <= k - 1) return 0;
  if (d <= 1 - k) return 1 - k * k;
  const a = Math.acos(clamp((d * d + 1 - k * k) / (2 * d), -1, 1));
  const b = Math.acos(clamp((d * d + k * k - 1) / (2 * d * k), -1, 1));
  const overlap = a + k * k * b - 0.5 * Math.sqrt(Math.max(0, (-d + 1 + k) * (d + 1 - k) * (d - 1 + k) * (d + 1 + k)));
  return clamp(1 - overlap / Math.PI, 0, 1);
}

// Deterministic random for a stable canopy.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function vnoise(x, y) {
  const h = (i, j) => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
const fbm2 = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5, y * 2.1 + 9) * 0.3 + vnoise(x * 4.3 + 11, y * 4.3 + 3) * 0.15;

export async function createEclipse(host, { embedded = false } = {}) {
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");

  const lightProg = program(gl, LIGHT_VS, LIGHT_FS);
  const compProg = program(gl, COMP_VS, COMP_FS);
  const uL = uniforms(gl, lightProg, ["uRes", "uTime", "uAxis", "uRot", "uWind", "uMoon", "uMoonR", "uTotal"]);
  const uC = uniforms(gl, compProg, ["uLight", "uRes", "uDpr", "uScale", "uUncov", "uTotal", "uGain"]);

  // Geometry: a unit quad, instanced per gap.
  const lightVao = gl.createVertexArray();
  gl.bindVertexArray(lightVao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
  gl.vertexAttribDivisor(2, 1);

  const compVao = gl.createVertexArray();
  gl.bindVertexArray(compVao);
  const full = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let fbo = null;
  let tex = null;
  let gaps = 0;
  let scale = 800;
  const gain = floatOk ? 1 : 4;

  const build = (w, h) => {
    scale = Math.min(w, h);
    // Light buffer.
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, floatOk ? gl.RGBA16F : gl.RGBA8, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // The canopy: gaps fall in clusters where the leaves thin, with a
    // minimum spacing, sized by how far each gap is from the wall.
    const rand = rng(1966);
    const base = scale * 0.02;
    const pts = [];
    // Where the canopy is: a field that fills the right of the wall and
    // thins out to the left, leaving the rest in plain shade.
    const field = (x, y) => {
      const u = x / w;
      const v = y / h;
      const n = fbm2((x / scale) * 1.8 + 3.1, (y / scale) * 1.8 + 1.7);
      return clamp((u - 0.36) * 1.5 + (n - 0.5) * 1.6 - Math.max(0, v - 0.85) * 2, 0, 1);
    };
    const add = (x, y, far, gap) => {
      const r = base * far;
      const bright = clamp((gap * 0.8) / (far * far), 0.12, 1.4);
      const blur = clamp(0.04 + gap * 0.07 + far * 0.03 + rand() * 0.04, 0.04, 0.18);
      pts.push([x, y, r, bright, blur, rand() * Math.PI * 2]);
    };
    const target = Math.round(clamp(((w * h) / (scale * scale)) * 420, 300, 1100));
    for (let t = 0; t < 20000 && pts.length < target; t++) {
      const x = rand() * w * 1.05;
      const y = rand() * h * 1.05 - h * 0.025;
      const f = field(x, y);
      if (rand() > f * f) continue;
      const far = 0.55 + Math.pow(rand(), 1.6) * 1.5; // the gap's distance from the wall
      const gap = 0.2 + Math.pow(rand(), 1.4) * 1.0; // how open it is
      let near = false;
      for (const p of pts) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < (Math.max(base * far, p[2]) * 0.9) ** 2) {
        near = true;
        break;
      }
      // In the thin of the canopy gaps stand apart; where it opens they
      // crowd and their images run together.
      if (near && rand() > f * f * 0.9) continue;
      // A wider opening is several gaps side by side: their images overlap
      // into one bright patch with a scalloped edge.
      if (rand() < 0.12) {
        const k = 2 + Math.floor(rand() * 4);
        for (let i = 0; i < k; i++) {
          const a = rand() * Math.PI * 2;
          const s = base * far * (0.3 + rand() * 0.7);
          add(x + Math.cos(a) * s, y + Math.sin(a) * s * 1.3, far * (0.9 + rand() * 0.2), gap);
        }
      } else add(x, y, far, gap);
    }
    gaps = pts.length;
    const data = new Float32Array(gaps * 6);
    pts.forEach((p, i) => data.set(p, i * 6));
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  };
  stage.onResize((w, h) => build(w, h));

  // The moon: offset from the sun in sun radii. A drag moves it; let go and
  // it keeps the hand's speed against a little friction.
  const MOON_R = 1.03;
  const moon = { x: -2.4, y: 0.12, vx: 0 };
  let dragFrom = null;
  stage.on("down", (p) => {
    dragFrom = { x: p.x, mx: moon.x };
    moon.vx = 0;
  });
  stage.on("up", (p) => {
    if (!dragFrom) return;
    moon.vx = (p.vx / (scale * 0.55)) * 2.2;
    dragFrom = null;
  });

  let autoT = 0;
  let wind = 1;

  stage.onFrame((dt, t) => {
    const W = stage.width;
    const H = stage.height;
    const p = stage.pointer;
    if (p.down && dragFrom) {
      // Across about half the screen is one full eclipse.
      moon.x = dragFrom.mx + ((p.x - dragFrom.x) / (scale * 0.55)) * 2.2;
    } else {
      moon.vx *= Math.exp(-2.2 * dt);
      moon.x += moon.vx * dt;
      if (stage.idleFor() > 6000) {
        // On its own: an eclipse passes, slowly, then the sun comes back.
        autoT += dt;
        const cycle = 22;
        const u = (autoT % cycle) / cycle;
        const want = u < 0.8 ? -2.6 + (u / 0.8) * 5.2 : 2.6 + ((u - 0.8) / 0.2) * -5.2;
        moon.x = u < 0.8 ? damp(moon.x, want, 3, dt) : want < -2.4 ? -2.6 : 2.7;
      } else autoT = ((moon.x + 2.6) / 5.2) * 0.8 * 22;
    }
    moon.x = clamp(moon.x, -3.2, 3.2);
    const d = Math.hypot(moon.x, moon.y);
    const unc = uncovered(d, MOON_R);
    const total = clamp(1 - unc / 0.004, 0, 1);
    // The air goes still as the light goes.
    wind = damp(wind, 0.35 + 0.65 * Math.pow(unc, 0.5), 2, dt);

    // Pass 1: light.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(lightProg);
    gl.bindVertexArray(lightVao);
    gl.uniform2f(uL.uRes, W, H);
    gl.uniform1f(uL.uTime, t);
    // A high sun on a vertical wall: images stretched down, tipped a little.
    gl.uniform2f(uL.uAxis, 1.0, 1.32);
    gl.uniform1f(uL.uRot, -0.18);
    gl.uniform1f(uL.uWind, wind);
    // Pinhole images are inverted: the bite appears on the opposite side.
    gl.uniform2f(uL.uMoon, -moon.x, -moon.y);
    gl.uniform1f(uL.uMoonR, MOON_R);
    gl.uniform1f(uL.uTotal, total);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, gaps);
    gl.disable(gl.BLEND);

    // Pass 2: the wall.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(compProg);
    gl.bindVertexArray(compVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uC.uLight, 0);
    gl.uniform2f(uC.uRes, W, H);
    gl.uniform1f(uC.uDpr, stage.dpr);
    gl.uniform1f(uC.uScale, scale);
    gl.uniform1f(uC.uUncov, unc);
    gl.uniform1f(uC.uTotal, total);
    gl.uniform1f(uC.uGain, gain);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    void embedded;
  });

  return { destroy: () => stage.destroy() };
}
