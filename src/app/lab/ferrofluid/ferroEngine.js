import { createStage, damp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// Black ferrofluid lying on a sleeve. One fragment shader: the pool is a
// metaball field that leans toward a lagging magnet; inside it, spikes sit on
// a hex lattice and rise with the local field (the normal-field
// instability), bending toward the magnet. The surface is a black mirror:
// a studio softbox and the sleeve beneath show in its reflections.

const ORDER = ["abbey-road", "revolver", "let-it-be", "sgt-pepper", "help", "rubber-soul"];

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes; uniform float uScale; uniform vec2 uCover0; uniform float uCoverSize;
uniform vec2 uPool; uniform vec2 uMag; uniform vec2 uTrail; uniform float uField; uniform float uHover; uniform float uTime;
uniform sampler2D uTex; uniform float uSharp;
out vec4 o;

vec2 hexNearest(vec2 p, float s){
  // Two offset rectangular lattices; take the nearer centre.
  vec2 r = vec2(1.0, 1.7320508) * s;
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? p - a : p - b;
}

float fieldAt(vec2 p){
  float d = length(p - uMag);
  float t = length(p - uTrail);
  return uField * (exp(-d * d / (uScale * uScale * 0.018)) * 0.85 + exp(-t * t / (uScale * uScale * 0.03)) * 0.35);
}

float pool(vec2 p){
  vec2 q = p - uPool;
  // A real puddle is never a circle.
  float ang = atan(q.y, q.x);
  float wob = 1.0 + uSharp * (0.08 * sin(ang * 3.0 + 1.3) + 0.05 * sin(ang * 5.0 - 0.4));
  float a = exp(-dot(q, q) / (uScale * uScale * 0.026 * wob * wob));
  vec2 m = p - uMag;
  float b = (uField * 0.75 + uHover * 0.35) * exp(-dot(m, m) / (uScale * uScale * 0.012));
  vec2 tr = p - uTrail;
  float c = uField * 0.4 * exp(-dot(tr, tr) / (uScale * uScale * 0.01));
  return a + b + c;
}

float height(vec2 p){
  float f = pool(p);
  float body = smoothstep(0.42, 0.95, f) * 0.5 + smoothstep(0.42, 0.5, f) * 0.25;
  float s = uScale * mix(0.042, 0.03, uSharp);
  vec2 c = hexNearest(p, s);
  float a = fieldAt(c) * smoothstep(0.5, 0.75, pool(c));
  // Spikes lean toward the magnet.
  vec2 lean = normalize(uMag - c + 0.0001) * a * s * 0.22;
  float d = length(p - c - lean) / (s * 0.56);
  float spike = a * pow(max(0.0, 1.0 - d), mix(1.7, 1.12, uSharp)) * mix(2.6, 4.6, uSharp);
  float mound = fieldAt(p) * 0.55 * smoothstep(0.45, 0.8, f);
  return body + mound + spike;
}

vec3 env(vec3 r){
  // A softbox above and to the left, a warm bounce card, a dim room.
  vec3 col = vec3(0.03, 0.03, 0.035) + vec3(0.06, 0.05, 0.045) * smoothstep(-0.2, 0.8, r.y);
  float box = smoothstep(0.82, 0.9, dot(r, normalize(vec3(-0.45, 0.62, 0.65))));
  col += vec3(1.25, 1.22, 1.18) * box;
  float strip = smoothstep(0.93, 0.97, dot(r, normalize(vec3(0.75, 0.25, 0.6))));
  col += vec3(0.9, 0.6, 0.35) * strip * 0.7;
  return col;
}

void main(){
  vec2 p = vUv * uRes; p.y = uRes.y - p.y;
  // The sleeve under it all.
  vec2 cuv = (p - uCover0) / uCoverSize;
  vec3 paper = mix(vec3(0.09, 0.085, 0.08), vec3(0.012, 0.011, 0.01), uSharp);
  bool onCover = all(greaterThanEqual(cuv, vec2(0.0))) && all(lessThanEqual(cuv, vec2(1.0)));
  vec3 base = onCover ? pow(texture(uTex, cuv).rgb, vec3(2.2)) * 0.9 : paper;
  float f = pool(p);
  // Shadow and stain at the pool's edge.
  float shadow = smoothstep(0.2, 0.46, pool(p + vec2(-uScale * 0.012, -uScale * 0.018)));
  base *= 1.0 - 0.55 * shadow;
  vec3 col = base;
  float inside = smoothstep(0.43, 0.47, f);
  if (inside > 0.0) {
    float e = uScale * 0.0022;
    float h = height(p);
    float hx = height(p + vec2(e, 0.0));
    float hy = height(p + vec2(0.0, e));
    float hs = uScale * 0.03;
    vec3 n = normalize(vec3(-(hx - h) / e * hs, (hy - h) / e * hs, 1.0));
    vec3 v = vec3(0.0, 0.0, 1.0);
    vec3 r = reflect(-v, n);
    float fres = 0.05 + 0.95 * pow(1.0 - max(0.0, dot(n, v)), 4.0);
    vec3 refl = env(r);
    // The sleeve reflected in the fluid near the floor.
    vec2 ruv = cuv + r.xy * vec2(1.0, -1.0) * 0.25;
    vec3 sleeve = pow(texture(uTex, clamp(ruv, 0.0, 1.0)).rgb, vec3(2.2));
    refl += sleeve * 0.22 * smoothstep(0.2, 0.9, 1.0 - r.z);
    vec3 fluid = vec3(0.006, 0.006, 0.008) + refl * (0.12 + fres * 0.9);
    col = mix(base, fluid, inside);
  }
  col = col / (1.0 + col * 0.25);
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export async function createFerro(host) {
  const stage = createStage(host, { webgl: true, dpr: 1.25 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const V = new URLSearchParams(location.search).get("v") || "";
  const names = ["uSharp", "uRes", "uScale", "uCover0", "uCoverSize", "uPool", "uMag", "uTrail", "uField", "uHover", "uTime", "uTex"];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  const setCover = async (id) => {
    const img = await loadCover(id);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  };
  let coverIdx = 0;
  await setCover(ORDER[0]);

  // Physics in css px: the magnet lags the hand on a spring; the pool lags
  // the magnet; the field strength wobbles as it rises and falls.
  const mag = { x: 0, y: 0, vx: 0, vy: 0 };
  const trail = { x: 0, y: 0 };
  const poolC = { x: 0, y: 0 };
  let field = 0;
  let fieldV = 0;
  let hover = 0;
  let scale = 600;
  let cover = { x: 0, y: 0, s: 0 };
  stage.onResize((w, h) => {
    scale = Math.min(w, h);
    const s = Math.min(w * 0.7, h * 0.8);
    cover = { x: (w - s) / 2, y: (h - s) / 2, s };
    mag.x = trail.x = poolC.x = w / 2;
    mag.y = trail.y = poolC.y = h / 2;
  });

  let downAt = 0;
  stage.on("down", () => {
    downAt = performance.now();
    fieldV += 1.5;
  });
  stage.on("up", () => {
    if (performance.now() - downAt < 200) fieldV += 2.2; // a tap: a pulse
  });

  let auto = 0;
  stage.onFrame((dt, t) => {
    const p = stage.pointer;
    const W = stage.width;
    const H = stage.height;
    const idle = stage.idleFor() > 5000;
    let tx = p.inside || p.down ? p.x : W / 2;
    let ty = p.inside || p.down ? p.y : H / 2;
    let want = p.down ? 1 : 0;
    if (idle) {
      // On its own the magnet wanders under the sleeve and pulses.
      auto += dt;
      tx = W / 2 + Math.sin(auto * 0.7) * cover.s * 0.22;
      ty = H / 2 + Math.sin(auto * 1.1 + 1) * cover.s * 0.16;
      want = 0.55 + 0.45 * Math.max(0, Math.sin(auto * 0.9));
    }
    // Magnet spring (underdamped: it overshoots a touch).
    const k = 90;
    const c = 13;
    mag.vx += ((tx - mag.x) * k - mag.vx * c) * dt;
    mag.vy += ((ty - mag.y) * k - mag.vy * c) * dt;
    mag.x += mag.vx * dt;
    mag.y += mag.vy * dt;
    trail.x = damp(trail.x, mag.x, 5, dt);
    trail.y = damp(trail.y, mag.y, 5, dt);
    // The pool creeps after a strong magnet, and back to the middle.
    const pull = field * 0.9 + hover * 0.25;
    poolC.x = damp(poolC.x, W / 2 + (mag.x - W / 2) * pull * 0.85, 1.6, dt);
    poolC.y = damp(poolC.y, H / 2 + (mag.y - H / 2) * pull * 0.85, 1.6, dt);
    // Field strength: a spring toward `want`, with wobble.
    fieldV += ((want - field) * 60 - fieldV * 7) * dt;
    field = Math.max(0, field + fieldV * dt);
    hover = damp(hover, p.inside && !idle ? 1 : idle ? 0.6 : 0, 4, dt);

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uSharp, V.includes("a") ? 1 : 0);
    gl.uniform2f(u.uCover0, cover.x, cover.y);
    gl.uniform1f(u.uCoverSize, cover.s);
    gl.uniform2f(u.uPool, poolC.x, poolC.y);
    gl.uniform2f(u.uMag, mag.x, mag.y);
    gl.uniform2f(u.uTrail, trail.x, trail.y);
    gl.uniform1f(u.uField, field);
    gl.uniform1f(u.uHover, hover);
    gl.uniform1f(u.uTime, t);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    void coverIdx;
  });

  return { destroy: () => stage.destroy() };
}
