import { createStage, clamp } from "../_kit/stage";
import { albumById, loadCover } from "../_kit/covers";

// Flip sequins. Every sequin is one instanced, cupped disc with a hole in
// the middle, lying shingled on a scrap of fabric. Brushing across a sequin
// turns it over about the axis at right angles to the stroke, through a real
// rotation, so its normal sweeps through the room's lights on the way. One
// side is matte pewter; the other is a coloured mirror whose tint is the
// album cover at that sequin's place on the swatch.

const VS = `#version 300 es
layout(location=0) in vec2 aLocal;
layout(location=1) in vec4 aPos;    // x, y, z, seed
layout(location=2) in vec2 aTilt;   // rest tilt: the way and how far its normal leans
layout(location=3) in vec3 aColor;  // linear cover colour
layout(location=4) in vec3 aFlip;   // phi, axis.x, axis.y
uniform vec2 uRes; uniform float uR; uniform float uCup;
uniform vec4 uRip[4];               // x, y, age, amplitude
out vec3 vW; out vec3 vN; out vec3 vC; out float vRho; out vec2 vCenter; out float vFace; out float vLift;

vec3 rot(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }

void main(){
  vec2 l = aLocal;
  float rho2 = dot(l, l);
  vec3 p = vec3(l * uR, uCup * uR * rho2);
  vec3 n = normalize(vec3(-2.0 * uCup * l, 1.0));
  vec3 f = vec3(0.0, 0.0, 1.0);

  // The flip, about an axis in the fabric's plane.
  vec3 k = vec3(aFlip.y, aFlip.z, 0.0);
  float phi = aFlip.x;
  p = rot(p, k, phi); n = rot(n, k, phi); f = rot(f, k, phi);

  // Rest tilt plus any ripple passing through.
  vec2 slope = aTilt;
  float rl = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    vec2 dv = aPos.xy - r.xy;
    float d = length(dv) + 1e-3;
    float front = d - 360.0 * r.z;
    float g = exp(-front * front / (2.0 * 26.0 * 26.0));
    float a = r.w * exp(-r.z * 2.4) * smoothstep(0.0, 0.06, r.z);
    slope += dv / d * (-front / 26.0) * g * a * 0.42;
    rl += g * a;
  }
  float sl = length(slope);
  if (sl > 1e-5) {
    vec3 tk = vec3(-slope.y, slope.x, 0.0) / sl;
    p = rot(p, tk, sl); n = rot(n, tk, sl); f = rot(f, tk, sl);
  }

  float lift = abs(sin(phi)) * uR * 0.95 + rl * uR * 0.5;
  vec3 w = aPos.xyz + p + vec3(0.0, 0.0, lift);
  vW = w; vN = n; vC = aColor; vRho = sqrt(rho2); vCenter = aPos.xy; vFace = f.z;
  vLift = clamp(lift / (uR * 0.4), 0.0, 1.0);
  gl_Position = vec4(w.x / uRes.x * 2.0 - 1.0, 1.0 - w.y / uRes.y * 2.0, -w.z / 400.0, 1.0);
}`;

const ENV = `
uniform float uTime;
// The room: a warm ceiling, a big softbox up and to the left, a small one
// nearly overhead, a cool window strip to the right, and the dark of
// whoever is looking straight down at the table.
float rectLight(vec3 d, vec3 c, vec2 hs, float soft){
  float a = dot(d, c);
  if (a <= 0.0) return 0.0;
  vec3 t1 = normalize(cross(c, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(t1, c);
  vec2 q = vec2(dot(d, t1), dot(d, t2)) / a;
  vec2 e = smoothstep(hs + soft, hs - soft, abs(q));
  return e.x * e.y;
}
vec3 env(vec3 d){
  d = normalize(d);
  float up = d.z;
  vec3 c = vec3(0.93, 0.9, 0.85) * (0.2 + 0.85 * smoothstep(-0.1, 1.0, up));
  float drift = sin(uTime * 0.21) * 0.025;
  c += vec3(1.0, 0.96, 0.9) * 7.0 * rectLight(d, normalize(vec3(-0.5 + drift, -0.55, 0.67)), vec2(0.34, 0.24), 0.05);
  c += vec3(1.0, 0.98, 0.95) * 5.0 * rectLight(d, normalize(vec3(-0.17 + drift, -0.2, 0.965)), vec2(0.1, 0.07), 0.03);
  c += vec3(0.85, 0.92, 1.0) * 2.2 * rectLight(d, normalize(vec3(0.72, 0.08, 0.69)), vec2(0.07, 0.42), 0.04);
  c *= 1.0 - 0.3 * smoothstep(0.993, 0.9992, up);
  return c;
}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
`;

const FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vRho; in vec2 vCenter; in float vFace; in float vLift;
uniform vec3 uEye; uniform float uR; uniform vec2 uNb0; uniform vec2 uNb1; uniform float uExposure;
out vec4 o;
${ENV}
void main(){
  bool front = vFace > 0.0;
  vec3 N = normalize(front ? vN : -vN);
  vec3 V = normalize(uEye - vW);
  vec3 R = reflect(-V, N);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - NoV, 5.0);
  vec3 key = normalize(vec3(-0.5, -0.55, 0.67));
  vec3 col;
  if (front) {
    // Matte pewter: diffuse from the room, a broad satin sheen.
    vec3 alb = vec3(0.12, 0.117, 0.11);
    float irr = 0.42 + 0.38 * N.z + 1.25 * max(dot(N, key), 0.0);
    float sheen = pow(max(dot(R, key), 0.0), 6.0) * 0.55 + pow(max(dot(R, normalize(vec3(-0.17, -0.2, 0.965))), 0.0), 40.0) * 0.4;
    col = alb * irr + vec3(0.95, 0.93, 0.9) * sheen * (0.25 + 0.75 * fr) * 0.6 + env(R) * 0.03;
  } else {
    // Coloured mirror: the cover tint over a metal that sees the room.
    vec3 e = env(R);
    vec3 F = mix(vC, vec3(1.0), fr);
    col = e * F * 1.25 + e * 0.035 + vC * 0.06;
  }
  // The pressed rim and the punched hole catch a little less light.
  col *= mix(1.0, 0.72, smoothstep(0.84, 1.0, vRho));
  col *= mix(0.55, 1.0, smoothstep(0.16, 0.26, vRho));
  // Contact shadow from the two sequins lying over this one's top.
  float d0 = length(vW.xy - (vCenter + uNb0) - vec2(0.5, 1.2)) - uR;
  float d1 = length(vW.xy - (vCenter + uNb1) - vec2(0.5, 1.2)) - uR;
  float sh = smoothstep(0.0, uR * 0.55, min(d0, d1));
  col *= mix(1.0, mix(0.55, 1.0, sh), 1.0 - vLift);
  vec3 m = aces(col * uExposure);
  o = vec4(pow(m, vec3(1.0 / 2.2)), 1.0);
}`;

const BG_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.999, 1.0); }`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes; uniform vec4 uRect; uniform float uDpr;
out vec4 o;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 c = (uRect.xy + uRect.zw) * 0.5;
  vec2 b = (uRect.zw - uRect.xy) * 0.5;
  vec3 ground = vec3(0.949, 0.941, 0.922);
  // Grain in the ground so it reads as paper, not a fill.
  ground += (hash(floor(p * uDpr)) - 0.5) * 0.006;
  float dSh = sdBox(p - c - vec2(0.0, 5.0), b, 3.0);
  float shadow = 0.07 * (1.0 - smoothstep(-14.0, 26.0, dSh)) + 0.08 * (1.0 - smoothstep(-1.0, 3.0, sdBox(p - c - vec2(0.0, 1.0), b, 2.0)));
  vec3 col = ground * (1.0 - shadow);
  float d = sdBox(p - c, b, 2.0);
  // The backing: a dark net, visible at the edge and through the holes.
  vec2 q = p * 1.6;
  float weave = 0.5 + 0.25 * sin(q.x) * sin(q.y + 1.0);
  vec3 fabric = vec3(0.36, 0.35, 0.33) * (0.75 + 0.5 * weave);
  col = mix(col, fabric, 1.0 - smoothstep(-0.5, 0.5, d));
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

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A cupped annulus: rings from the hole to the rim.
function discMesh(seg = 28, rings = [0.17, 0.45, 0.75, 1]) {
  const v = [];
  const pt = (r, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(rings[k], i), b = pt(rings[k], i + 1), c = pt(rings[k + 1], i), d = pt(rings[k + 1], i + 1);
      v.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  return new Float32Array(v);
}

const PI = Math.PI;
// Brush right or down to show the mirrors; left or up to wipe them.
const NAP = [0.86, 0.51];

export async function createSequin(host, { embedded = false } = {}) {
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const params = new URLSearchParams(location.search);
  const albumId = albumById(params.get("album") || "") ? params.get("album") : "abbey-road";
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  // Cover pixels, sampled once per sequin.
  let coverPx = null;
  const COVER_N = 192;
  try {
    const img = await loadCover(albumId);
    const cv = document.createElement("canvas");
    cv.width = cv.height = COVER_N;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, COVER_N, COVER_N);
    coverPx = cx.getImageData(0, 0, COVER_N, COVER_N).data;
  } catch {
    coverPx = null;
  }
  const lin = (c) => Math.pow(c / 255, 2.2);
  const sampleCover = (u, v, rad) => {
    if (!coverPx) return [0.6, 0.6, 0.62];
    let r = 0, g = 0, b = 0, n = 0;
    const R = Math.max(1, Math.round(rad * COVER_N));
    const cx = Math.round(u * (COVER_N - 1)), cy = Math.round(v * (COVER_N - 1));
    for (let j = -R; j <= R; j += Math.max(1, R >> 1)) {
      for (let i = -R; i <= R; i += Math.max(1, R >> 1)) {
        if (i * i + j * j > R * R) continue;
        const x = clamp(cx + i, 0, COVER_N - 1), y = clamp(cy + j, 0, COVER_N - 1);
        const o = (y * COVER_N + x) * 4;
        r += lin(coverPx[o]); g += lin(coverPx[o + 1]); b += lin(coverPx[o + 2]); n++;
      }
    }
    r /= n; g /= n; b /= n;
    // A mirror tint reads darker than paper; lift it and keep its hue.
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = 1.15;
    const f = (c) => clamp((l + (c - l) * sat) * 0.88 + 0.03, 0, 1);
    return [f(r), f(g), f(b)];
  };

  const prog = program(gl, VS, FS);
  const U = uniforms(gl, prog, ["uRes", "uR", "uCup", "uRip", "uEye", "uNb0", "uNb1", "uExposure", "uTime"]);
  const bgProg = program(gl, BG_VS, BG_FS);
  const UB = uniforms(gl, bgProg, ["uRes", "uRect", "uDpr"]);

  const mesh = discMesh();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const meshBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const staticBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
  const STRIDE = 9 * 4;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 24);
  gl.vertexAttribDivisor(3, 1);
  const flipBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const bgVao = gl.createVertexArray();
  gl.bindVertexArray(bgVao);
  const full = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Layout and per-sequin state.
  let N = 0;
  let D = 11; // diameter
  let SY = 6;
  let rect = [0, 0, 1, 1];
  let brushR = 30;
  let px, py, seed, phi, vel, target, rest, ax, ay, delay, flips;

  const build = (W, H) => {
    const side = Math.round(Math.min(W * 0.36, H * 0.52, 440));
    D = clamp(side / 42, 7, 11);
    SY = D * 0.56;
    const cols = Math.max(4, Math.floor(side / D));
    const rows = Math.max(4, Math.floor((side - D) / SY) + 1);
    const fw = cols * D, fh = (rows - 1) * SY + D;
    const x0 = Math.round((W - fw) / 2), y0 = Math.round((H - fh) / 2);
    const pad = D * 0.14;
    rect = [x0 - pad, y0 - pad, x0 + fw + pad, y0 + fh + pad];
    brushR = Math.max(D * 2.2, side * 0.065);

    const list = [];
    for (let r = 0; r < rows; r++) {
      const odd = r & 1;
      const n = odd ? cols - 1 : cols;
      for (let c = 0; c < n; c++) list.push([x0 + D / 2 + c * D + (odd ? D / 2 : 0), y0 + D / 2 + r * SY, r]);
    }
    N = list.length;
    const rand = rng(7);
    const data = new Float32Array(N * 9);
    px = new Float32Array(N); py = new Float32Array(N); seed = new Float32Array(N);
    phi = new Float32Array(N); vel = new Float32Array(N); target = new Float32Array(N); rest = new Float32Array(N);
    ax = new Float32Array(N); ay = new Float32Array(N); delay = new Float32Array(N);
    flips = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const [x, y, r] = list[i];
      const s = rand();
      px[i] = x; py[i] = y; seed[i] = s;
      // Shingled: higher rows lie over lower ones, and lean down onto them.
      const z = (rows - r) * 1.7;
      const a = rand() * PI * 2;
      const m = Math.pow(rand(), 1.4) * 0.17;
      const tx = Math.cos(a) * m, ty = Math.sin(a) * m + 0.05;
      const [cr, cg, cb] = sampleCover((x - x0) / fw, (y - y0) / fh, (D * 0.45) / fw);
      data.set([x, y, z, s, tx, ty, cr, cg, cb], i * 9);
      ax[i] = 1; ay[i] = 0;
      flips[i * 3 + 1] = 1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
    gl.bufferData(gl.ARRAY_BUFFER, flips, gl.DYNAMIC_DRAW);
    dirty = true;
    if (still != null) runScript(still);
  };

  let dirty = true;
  let active = new Set();

  // A stroke from (x0,y0) to (x1,y1) over the sequins it passes.
  const brush = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const mx = dx / len, my = dy / len;
    const want = mx * NAP[0] + my * NAP[1] > 0 ? 1 : 0;
    const R = brushR;
    const minX = Math.min(x0, x1) - R, maxX = Math.max(x0, x1) + R;
    const minY = Math.min(y0, y1) - R, maxY = Math.max(y0, y1) + R;
    for (let i = 0; i < N; i++) {
      const x = px[i], y = py[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const t = clamp(((x - x0) * dx + (y - y0) * dy) / (len * len), 0, 1);
      const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
      // The brush's edge is ragged, the way fingertips are.
      if (d > R * (0.72 + 0.28 * seed[i])) continue;
      const face = Math.round(target[i] / PI) & 1;
      if (face === want) {
        // Already showing that side: it only rustles.
        if (Math.abs(vel[i]) < 2 && Math.abs(phi[i] - target[i]) < 0.05) {
          ax[i] = -my; ay[i] = mx;
          vel[i] += 2.2 * (0.5 + seed[i]);
          active.add(i);
        }
        continue;
      }
      const moving = Math.abs(phi[i] - rest[i]) > 0.02;
      if (moving && Math.abs(target[i] - rest[i]) > 1) {
        // Caught mid-turn by a stroke the other way: it falls back.
        target[i] = rest[i];
      } else {
        // Turns over toward the stroke: its normal tips the way the brush goes.
        ax[i] = -my; ay[i] = mx;
        target[i] = rest[i] + PI;
        delay[i] = seed[i] * 0.03;
        vel[i] += 3;
      }
      active.add(i);
    }
  };

  const K = 420, C = 24;
  const step = (dt) => {
    if (!active.size) return;
    for (const i of active) {
      if (delay[i] > 0) {
        delay[i] -= dt;
        continue;
      }
      const tg = target[i];
      const before = phi[i] - tg;
      vel[i] += (-K * before - C * vel[i]) * dt;
      phi[i] += vel[i] * dt;
      const after = phi[i] - tg;
      // It lands on the fabric rather than swinging through it.
      if (before * after < 0 && Math.abs(vel[i]) > 1.5) {
        phi[i] = tg - after * 0.2;
        vel[i] = -vel[i] * 0.22;
      }
      if (Math.abs(phi[i] - tg) < 0.002 && Math.abs(vel[i]) < 0.05) {
        let r = tg % (PI * 2);
        if (r < 0) r += PI * 2;
        phi[i] = r; target[i] = r; rest[i] = r; vel[i] = 0;
        active.delete(i);
      }
      flips[i * 3] = phi[i];
      flips[i * 3 + 1] = ax[i];
      flips[i * 3 + 2] = ay[i];
    }
    dirty = true;
  };

  // A still for ?t=: four strokes left to right, the last one stopped where t says.
  function runScript(t) {
    const [l, top, r, bot] = rect;
    const passes = 4;
    const h = bot - top;
    const segs = [];
    for (let k = 0; k < passes; k++) {
      const y = top + h * ((k + 0.5) / passes);
      segs.push([l - 30, y - 6, r + 30, y + 10]);
    }
    const saved = brushR;
    brushR = (h / passes) * 0.62;
    const total = segs.reduce((s, g) => s + Math.hypot(g[2] - g[0], g[3] - g[1]), 0);
    let left = total * t;
    const speed = 1100;
    const dt = 1 / 240;
    for (const g of segs) {
      const L = Math.hypot(g[2] - g[0], g[3] - g[1]);
      const go = Math.min(L, left);
      let s = 0;
      while (s < go) {
        const s1 = Math.min(go, s + speed * dt);
        const a = s / L, b = s1 / L;
        brush(g[0] + (g[2] - g[0]) * a, g[1] + (g[3] - g[1]) * a, g[0] + (g[2] - g[0]) * b, g[1] + (g[3] - g[1]) * b);
        step(dt);
        s = s1;
      }
      left -= go;
      if (left <= 0) break;
      // Lift the hand and let everything settle before the next stroke.
      for (let k = 0; k < 120; k++) step(dt);
    }
    brushR = saved;
    frozen = true;
  }
  let frozen = false;

  stage.onResize((w, h) => build(w, h));

  // Taps send a ripple.
  const ripples = [];
  let downAt = null;
  stage.on("down", (p) => (downAt = { x: p.x, y: p.y, t: performance.now() }));
  stage.on("up", (p) => {
    if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 6 && performance.now() - downAt.t < 400) {
      ripples.push({ x: p.x, y: p.y, age: 0 });
      if (ripples.length > 4) ripples.shift();
    }
    downAt = null;
  });

  let last = null;
  const ripData = new Float32Array(16);
  stage.onFrame((dt, time) => {
    const W = stage.width, H = stage.height;
    const p = stage.pointer;
    if (!frozen) {
      if (p.inside || p.down) {
        if (last) {
          const sp = Math.hypot(p.x - last[0], p.y - last[1]) / Math.max(dt, 1e-3);
          if (sp > 90) brush(last[0], last[1], p.x, p.y);
        }
        last = [p.x, p.y];
      } else last = null;
      const sub = 3;
      for (let k = 0; k < sub; k++) step(dt / sub);
      for (const r of ripples) r.age += dt;
      while (ripples.length && ripples[0].age > 3) ripples.shift();
    }
    ripData.fill(0);
    ripples.forEach((r, i) => ripData.set([r.x, r.y, r.age, 1], i * 4));

    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, flipBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flips);
      dirty = false;
    }

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(0.949, 0.941, 0.922, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(bgProg);
    gl.bindVertexArray(bgVao);
    gl.uniform2f(UB.uRes, W, H);
    gl.uniform4f(UB.uRect, ...rect);
    gl.uniform1f(UB.uDpr, stage.dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uR, D / 2);
    gl.uniform1f(U.uCup, 0.12);
    gl.uniform4fv(U.uRip, ripData);
    gl.uniform3f(U.uEye, W / 2, H / 2 + H * 0.15, 1500);
    gl.uniform2f(U.uNb0, -D / 2, -SY);
    gl.uniform2f(U.uNb1, D / 2, -SY);
    gl.uniform1f(U.uExposure, 1.15);
    gl.uniform1f(U.uTime, frozen ? 0 : time);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.length / 2, N);
    gl.bindVertexArray(null);
    void embedded;
  });

  return { destroy: () => stage.destroy() };
}
