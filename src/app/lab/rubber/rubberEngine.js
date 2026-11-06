import { createStage, clamp, damp } from "../_kit/stage";
import { createSim } from "./rubberSim";
import { glyphField, sampleField, GLYPH_PX } from "./rubberGlyphs";

// A song title moulded in soft rubber, lying on a warm white table and shot
// from above. Each letter is a soft-body lattice (rubberSim) carrying its
// glyph's distance field; the renderer turns that field into a rubber slab
// with rounded edges whose thickness is rest area over current area, so
// wherever the rubber spreads it gets thinner and wherever it is pulled it
// thins too. Shadows and the contact darkening where letters touch come
// from a blurred height buffer of all the letters.

const TITLE = "Hello";
const WEIGHT = 800;
const SUB = 3; // render vertices per lattice cell edge
const R_EM = 0.065; // width of the rolled edge, em
const SLAB_EM = 0.12; // thickness of the rubber, em
const GAP = 0.03; // em between the nearest inks: set close enough to lean on each other
const ALBEDO = [1.0, 0.33, 0.07]; // sRGB, an orange rubber
const TABLE = [0.949, 0.941, 0.922]; // #f2f0eb

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec3 aT;
layout(location=3) in vec4 aM;
uniform vec2 uRes;
out vec2 vUv; out vec3 vT; out vec4 vM; out vec2 vPos;
void main(){
  vUv = aUv; vT = aT; vM = aM; vPos = aPos;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const HEIGHT = `
uniform sampler2D uSdf; uniform vec2 uTexel; uniform float uEm; uniform float uR; uniform float uSlab;
uniform vec4 uFinger; // x, y (css px), radius (css px), depth (0..1 of the slab)
in vec2 vPos;
// The fingertip's own dimple: thickness factor and its screen gradient.
vec3 dimple(){
  vec2 q = vPos - uFinger.xy;
  float r2 = dot(q, q) / (uFinger.z * uFinger.z);
  float g = exp(-r2 * 1.6);
  float f = 1.0 - uFinger.w * g;
  vec2 df = uFinger.w * g * 3.2 * q / (uFinger.z * uFinger.z);
  return vec3(f, df);
}
float sd(vec2 uv){ return texture(uSdf, uv).r; }
// A slab uSlab thick whose edge rolls over on a quarter ellipse uR wide.
float prof(float d){ float t = clamp(d / uR, 0.0, 1.0); return uSlab * sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t))); }
`;

const MASK_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vT; in vec4 vM;
${HEIGHT}
uniform float uParity;
out vec4 o;
void main(){
  float d = sd(vUv);
  float a = clamp(d / max(fwidth(d), 1e-5) + 0.5, 0.0, 1.0);
  float h = prof(d) * vT.x * dimple().x / uSlab;
  o = vec4(a * (1.0 - uParity), a * uParity, h * a, a);
}`;

const LETTER_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vT; in vec4 vM;
${HEIGHT}
uniform sampler2D uSmall; uniform sampler2D uLarge;
uniform vec2 uView; uniform float uParity; uniform vec3 uAlbedo; uniform vec2 uCast;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main(){
  float d = sd(vUv);
  float a = clamp(d / max(fwidth(d), 1e-5) + 0.5, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec2 e = uTexel * 2.0;
  float hx = (prof(sd(vUv + vec2(e.x, 0.0))) - prof(sd(vUv - vec2(e.x, 0.0)))) / (2.0 * e.x);
  float hy = (prof(sd(vUv + vec2(0.0, e.y))) - prof(sd(vUv - vec2(0.0, e.y)))) / (2.0 * e.y);
  // uv slope to screen slope (both css px), through the lattice's own Jacobian.
  vec2 gP = vec2(hx * vM.x + hy * vM.y, hx * vM.z + hy * vM.w) * uEm;
  float P = prof(d);
  vec3 dm = dimple();
  float T = vT.x * dm.x;
  vec2 gT = vT.yz * dm.x + vT.x * dm.yz;
  vec2 g = gP * T + P * uEm * gT;
  // Faint satin grain of moulded rubber.
  vec2 sp = gl_FragCoord.xy / uView * vec2(uView.x / uView.y, 1.0) * 900.0;
  g += (vec2(vnoise(sp), vnoise(sp + 31.7)) - 0.5) * 0.035;
  vec3 n = normalize(vec3(-g, 1.0));

  // A big softbox up and to the left, and the white room around it.
  vec3 L = normalize(vec3(-0.42, -0.58, 0.70));
  float diff = clamp((dot(n, L) + 0.25) / 1.25, 0.0, 1.0);
  float sky = 0.55 + 0.45 * n.z;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 9.0) * 0.075 + pow(max(dot(n, H), 0.0), 40.0) * 0.035;
  float rim = pow(1.0 - n.z, 2.5);

  vec2 uv = gl_FragCoord.xy / uView;
  vec4 s = texture(uSmall, uv);
  vec4 l = texture(uLarge, uv + uCast);
  float other = mix(s.g, s.r, uParity);
  float otherL = mix(l.g, l.r, uParity);
  // Where a neighbour presses close, the gap between them closes up dark; the
  // lower the rubber here, the deeper it sits in that shade.
  float low = 1.0 - clamp(P * T / uSlab, 0.0, 1.0);
  float occ = clamp(other * (0.55 + 0.6 * low), 0.0, 1.0) * 0.75;
  float shadowed = clamp(otherL * 1.2, 0.0, 1.0) * 0.35 * (0.4 + 0.6 * low);

  vec3 alb = uAlbedo;
  vec3 col = alb * (0.62 * diff + 0.48 * sky) * (1.0 - occ) * (1.0 - shadowed);
  col += alb * rim * 0.12 * (1.0 - occ);
  col += vec3(1.0, 0.97, 0.93) * spec * (1.0 - occ * 0.8);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, a);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uStep; out vec4 o;
void main(){
  vec4 s = vec4(0.0); float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i) / 3.0;
    float w = exp(-0.5 * x * x);
    s += texture(uSrc, vUv + uStep * float(i)) * w; wsum += w;
  }
  o = s / wsum;
}`;

const TABLE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSmall; uniform sampler2D uLarge; uniform vec3 uTable; uniform vec3 uAlbedo; uniform vec2 uCast;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main(){
  vec4 s = texture(uSmall, vUv);
  vec4 l = texture(uLarge, vUv + uCast);
  vec4 l0 = texture(uLarge, vUv);
  vec3 t = pow(uTable, vec3(2.2));
  // Soft shadow falling away from the light, contact dark right at the edge,
  // and a little of the rubber's colour bounced onto the table.
  float shadowed = clamp(l.b * 1.15, 0.0, 1.0);
  float contact = clamp(s.a * 1.3, 0.0, 1.0);
  float shade = (1.0 - 0.42 * shadowed) * (1.0 - 0.45 * contact) * (1.0 - 0.08 * l0.a);
  vec3 bounce = pow(uAlbedo, vec3(2.2)) * l0.a * 0.05;
  vec3 col = t * shade * mix(vec3(1.0), vec3(1.0, 0.96, 0.93), shadowed * 0.5) + bounce * (1.0 - shadowed * 0.5);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
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
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
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

// Catmull-Rom weights for parameter t in [0,1).
function cr(t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ];
}

export async function createRubber(host, { embedded = false, family = "sans-serif" } = {}) {
  try {
    await document.fonts.load(`${WEIGHT} 100px ${family}`, TITLE);
  } catch {
    /* fall back to whatever is there */
  }
  const glyphs = [...TITLE].map((ch) => glyphField(ch, family, WEIGHT));

  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const maskProg = program(gl, VS, MASK_FS);
  const letterProg = program(gl, VS, LETTER_FS);
  const blurProg = program(gl, QUAD_VS, BLUR_FS);
  const tableProg = program(gl, QUAD_VS, TABLE_FS);

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Distance fields as single-channel half floats.
  const sdfTex = glyphs.map((g) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, g.w, g.h, 0, gl.RED, gl.FLOAT, g.field);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  });

  const params = new URLSearchParams(location.search);
  const hold = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;
  const holdLetter = params.has("li") ? +params.get("li") : 1;
  const holdDx = +(params.get("dx") || 0);
  const holdDy = +(params.get("dy") || 0);

  let sim = null;
  let meshes = [];
  let em = 100;
  let W = 0, H = 0;
  let small = null, small2 = null, large = null, large2 = null, mask = null;
  let thick = null;
  let settled = 0;
  const finger = { li: -1, x: 0, y: 0, depth: 0 };

  function layout(w, h) {
    W = w;
    H = h;
    const S = GLYPH_PX;
    // Pen positions in em, tracked tight.
    // Space by the ink, not the advance: each pair sits GAP apart where they
    // come closest, so at rest nothing overlaps and a little push touches.
    const extent = (g, side) => {
      const out = new Map();
      for (let y = g.ink.y0; y < g.ink.y1; y++) {
        let e = side ? -Infinity : Infinity;
        for (let x = g.ink.x0; x < g.ink.x1; x++)
          if (g.field[y * g.w + x] > 0) e = side ? Math.max(e, x) : Math.min(e, x);
        if (Number.isFinite(e)) out.set(y - g.origin.y, (e - g.origin.x) / S);
      }
      return out;
    };
    const adv = glyphs.map((g, i) => {
      const nxt = glyphs[i + 1];
      if (!nxt) return g.advance / S;
      const a = extent(g, 1), b = extent(nxt, 0);
      let need = -Infinity;
      for (const [y, ra] of a) if (b.has(y)) need = Math.max(need, ra - b.get(y));
      return Number.isFinite(need) ? need + GAP : g.advance / S;
    });
    const first = glyphs[0], last = glyphs[glyphs.length - 1];
    // Optical width: from the first ink to the last ink.
    const firstL = (first.ink.x0 - first.origin.x) / S;
    const lastPen = adv.slice(0, -1).reduce((x, y) => x + y, 0);
    const inkW = lastPen + (last.ink.x1 - last.origin.x) / S - firstL;
    const capH = Math.max(...glyphs.map((g) => (g.origin.y - g.ink.y0) / S));
    em = Math.min((w * (embedded ? 0.7 : 0.66)) / inkW, (h * 0.5) / capH);
    const s = em / S;
    let pen = w / 2 - (inkW * em) / 2 - firstL * em;
    const base = h / 2 + (capH * em) / 2;

    sim = createSim({ em });
    const pad = 0.05 * S;
    const cellT = 0.085 * S;
    glyphs.forEach((g, i) => {
      const lx0 = g.ink.x0 - pad, lx1 = g.ink.x1 + pad;
      const ly0 = g.ink.y0 - pad, ly1 = g.ink.y1 + pad;
      const nx = Math.max(3, Math.round((lx1 - lx0) / cellT) + 1);
      const ny = Math.max(3, Math.round((ly1 - ly0) / cellT) + 1);
      const cxA = (lx1 - lx0) / (nx - 1), cyA = (ly1 - ly0) / (ny - 1);
      const inkL = [], inkR = [];
      for (let r = 0; r < ny; r++) {
        const ay = ly0 + r * cyA;
        let a = -1, b = -1;
        for (let x = Math.floor(lx0); x <= Math.ceil(lx1); x++) {
          if (sampleField(g, x, ay) > 0) {
            if (a < 0) a = x;
            b = x;
          }
        }
        inkL.push(a < 0 ? -1 : clamp((a - lx0) / cxA, 0, nx - 1.001));
        inkR.push(b < 0 ? -1 : clamp((b - lx0) / cxA, 0, nx - 1.001));
      }
      const toX = (ax) => pen + (ax - g.origin.x) * s;
      const toY = (ay) => base + (ay - g.origin.y) * s;
      sim.addLetter({ nx, ny, x0: toX(lx0), y0: toY(ly0), cx: cxA * s, cy: cyA * s, inkL, inkR });
      meshes.push({ g, i, nx, ny, lx0, ly0, cxA, cyA, toX, toY });
      pen += adv[i] * em;
    });
    sim.build();
    thick = new Float32Array(sim.count);

    // Render grids.
    meshes.forEach((m) => {
      const L = sim.letters[m.i];
      const RX = (m.nx - 1) * SUB + 1, RY = (m.ny - 1) * SUB + 1;
      const wx = [], wy = [];
      for (let k = 0; k < RX; k++) {
        const gx = k / SUB, c = Math.min(m.nx - 2, Math.floor(gx));
        wx.push({ c, w: cr(gx - c) });
      }
      for (let k = 0; k < RY; k++) {
        const gy = k / SUB, r = Math.min(m.ny - 2, Math.floor(gy));
        wy.push({ r, w: cr(gy - r) });
      }
      const idx = [];
      for (let j = 0; j < RY - 1; j++)
        for (let k = 0; k < RX - 1; k++) {
          const a = j * RX + k;
          idx.push(a, a + 1, a + RX, a + 1, a + RX + 1, a + RX);
        }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      const data = new Float32Array(RX * RY * 11);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const F = 4 * 11;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, F, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, F, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, F, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, F, 28);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      Object.assign(m, {
        L, RX, RY, wx, wy, vao, vb, data, count: idx.length,
        P: new Float32Array(RX * RY * 3),
        du: (m.cxA / SUB) / m.g.w, dv: (m.cyA / SUB) / m.g.h,
      });
    });
  }

  function updateMesh(m) {
    const { L, RX, RY, wx, wy, P, data } = m;
    const px = sim.px, py = sim.py;
    const nx = m.nx, ny = m.ny;
    for (let j = 0; j < RY; j++) {
      const { r, w: wv } = wy[j];
      for (let k = 0; k < RX; k++) {
        const { c, w: wu } = wx[k];
        let x = 0, y = 0, t = 0;
        for (let b = 0; b < 4; b++) {
          const rr = Math.min(ny - 1, Math.max(0, r - 1 + b));
          const wb = wv[b];
          const row = L.start + rr * nx;
          for (let a = 0; a < 4; a++) {
            const cc = Math.min(nx - 1, Math.max(0, c - 1 + a));
            const ww = wu[a] * wb;
            const id = row + cc;
            x += px[id] * ww; y += py[id] * ww; t += thick[id] * ww;
          }
        }
        const o = (j * RX + k) * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = t;
      }
    }
    for (let j = 0; j < RY; j++)
      for (let k = 0; k < RX; k++) {
        const o = (j * RX + k) * 3;
        const k0 = Math.max(0, k - 1), k1 = Math.min(RX - 1, k + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(RY - 1, j + 1);
        const a0 = (j * RX + k0) * 3, a1 = (j * RX + k1) * 3;
        const b0 = (j0 * RX + k) * 3, b1 = (j1 * RX + k) * 3;
        const su = k1 - k0, sv = j1 - j0;
        // d(screen)/d(grid) and its inverse.
        const xu = (P[a1] - P[a0]) / su, yu = (P[a1 + 1] - P[a0 + 1]) / su;
        const xv = (P[b1] - P[b0]) / sv, yv = (P[b1 + 1] - P[b0 + 1]) / sv;
        const tu = (P[a1 + 2] - P[a0 + 2]) / su, tv = (P[b1 + 2] - P[b0 + 2]) / sv;
        const det = xu * yv - xv * yu || 1e-6;
        const gux = yv / det, guy = -xv / det; // d grid-u / dx, dy
        const gvx = -yu / det, gvy = xu / det;
        const d = (j * RX + k) * 11;
        data[d] = P[o]; data[d + 1] = P[o + 1];
        data[d + 2] = (m.lx0 + (k / SUB) * m.cxA) / m.g.w;
        data[d + 3] = (m.ly0 + (j / SUB) * m.cyA) / m.g.h;
        data[d + 4] = P[o + 2];
        data[d + 5] = tu * gux + tv * gvx;
        data[d + 6] = tu * guy + tv * gvy;
        data[d + 7] = gux * m.du; // du/dx
        data[d + 8] = gvx * m.dv; // dv/dx
        data[d + 9] = guy * m.du; // du/dy
        data[d + 10] = gvy * m.dv; // dv/dy
      }
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  function makeTargets() {
    for (const t of [mask, small, small2, large, large2]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    const mw = Math.max(1, Math.round(W / 2)), mh = Math.max(1, Math.round(H / 2));
    mask = target(gl, mw, mh);
    small = target(gl, mw, mh);
    small2 = target(gl, mw, mh);
    const lw = Math.max(1, Math.round(W / 4)), lh = Math.max(1, Math.round(H / 4));
    large = target(gl, lw, lh);
    large2 = target(gl, lw, lh);
  }

  stage.onResize((w, h) => {
    if (Math.abs(w - W) < 1 && Math.abs(h - H) < 1 && sim) return;
    for (const m of meshes) gl.deleteVertexArray(m.vao);
    meshes = [];
    layout(w, h);
    makeTargets();
    settled = 0;
    if (hold != null) startHold();
  });

  // ---- touch ----
  let press = 0;
  let pressTarget = 0;
  let down = null;
  const pick = (x, y) => {
    let best = null;
    for (const m of meshes) {
      const L = m.L;
      let bi = -1, bd = Infinity;
      for (let i = L.start; i < L.start + L.count; i++) {
        const d = (sim.px[i] - x) ** 2 + (sim.py[i] - y) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      // Back into rest space by the nearest point's offset, then ask the field.
      const restX = sim.rx[bi] + (x - sim.px[bi]);
      const restY = sim.ry[bi] + (y - sim.py[bi]);
      const s = em / GLYPH_PX;
      const ax = m.lx0 + (restX - L.x0) / s;
      const ay = m.ly0 + (restY - L.y0) / s;
      const f = sampleField(m.g, ax, ay);
      if (f > -0.04 && (!best || f > best.f)) best = { m, f, restX, restY };
    }
    return best;
  };
  const grabAt = (li, restX, restY, x, y) => {
    sim.grab(li, restX, restY, 0.09 * em, 0.26 * em);
    down = { x, y };
    pressTarget = 1;
  };
  stage.on("down", (p) => {
    const hit = pick(p.x, p.y);
    if (!hit) return;
    grabAt(hit.m.i, hit.restX, hit.restY, p.x, p.y);
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!down) stage.canvas.style.cursor = pick(p.x, p.y) ? "grab" : "";
  });
  stage.on("up", () => {
    if (!down) return;
    down = null;
    pressTarget = 0;
    press = 0;
    sim.release();
    stage.canvas.style.cursor = "";
  });

  function startHold() {
    const m = meshes[clamp(holdLetter, 0, meshes.length - 1)];
    const L = m.L;
    // The middle of the letter's widest ink row.
    let bestR = 0, bestW = -1;
    for (let r = 0; r < L.ny; r++) {
      const w = L.inkR[r] - L.inkL[r];
      if (L.inkL[r] >= 0 && w > bestW && r > L.ny * 0.3 && r < L.ny * 0.75) { bestW = w; bestR = r; }
    }
    const i = L.start + bestR * L.nx + Math.round(L.nx / 2);
    grabAt(m.i, sim.rx[i], sim.ry[i], sim.px[i], sim.py[i]);
    down = null; // held by the URL, not the pointer
    press = hold;
    pressTarget = hold;
    for (let k = 0; k < 90; k++) {
      sim.setGrab(holdDx * em, holdDy * em, press * 0.7);
      sim.step(1 / 60);
    }
  }

  // ---- frame ----
  const draw = (prog, vao, n, indexed) => {
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    if (indexed) gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_SHORT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const blur = (src, tmp, dst, sigmaPx) => {
    gl.useProgram(blurProg.p);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blurProg.u.uSrc, 0);
    const stepX = sigmaPx / 3 / (W / dst.w); // in dst texels, per tap
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
    gl.viewport(0, 0, tmp.w, tmp.h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(blurProg.u.uStep, stepX / tmp.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(blurProg.u.uStep, 0, stepX / dst.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const letterUniforms = (prog, m) => {
    gl.uniform2f(prog.u.uRes, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sdfTex[m.i]);
    gl.uniform1i(prog.u.uSdf, 0);
    gl.uniform2f(prog.u.uTexel, 1 / m.g.w, 1 / m.g.h);
    gl.uniform1f(prog.u.uEm, em);
    gl.uniform1f(prog.u.uR, R_EM);
    gl.uniform1f(prog.u.uSlab, SLAB_EM);
    gl.uniform1f(prog.u.uParity, m.i % 2);
    const f = finger.li === m.i ? finger : null;
    gl.uniform4f(prog.u.uFinger, f ? f.x : -1e4, f ? f.y : -1e4, 0.17 * em, f ? f.depth : 0);
  };

  stage.onFrame((dt) => {
    if (!sim) return;
    if (down) {
      const p = stage.pointer;
      let dx = p.x - down.x, dy = p.y - down.y;
      const len = Math.hypot(dx, dy);
      // Rubber gives less the further it goes.
      const lim = 0.42 * em;
      if (len > 0) {
        const k = (lim * Math.tanh(len / lim)) / len;
        dx *= k; dy *= k;
      }
      press = damp(press, pressTarget, 16, dt);
      const p2 = press * 0.7 * Math.exp(-len / (0.16 * em));
      sim.setGrab(dx, dy, p2);
    } else if (hold != null && sim.grabbing) {
      sim.setGrab(holdDx * em, holdDy * em, hold * 0.7);
    }
    // The simulation sleeps once everything is still; drawing does not, as
    // the stage may clear the canvas on any resize.
    const e = sim.energy();
    if (down || sim.grabbing || e > 0.02 || settled < 3) {
      sim.step(dt);
      settled = e > 0.02 || down ? 0 : settled + 1;
    }

    sim.thickness(thick);
    // The fingertip rides the grabbed point: where the rubber is now.
    const gr = sim.grabbing;
    if (gr) {
      let k = 0;
      for (let q = 1; q < gr.w.length; q++) if (gr.w[q] > gr.w[k]) k = q;
      finger.li = gr.li;
      finger.x = sim.px[gr.idx[k]];
      finger.y = sim.py[gr.idx[k]];
      finger.depth = sim.pressAmount * 1.1;
    } else finger.depth = damp(finger.depth, 0, 30, dt);
    for (const m of meshes) updateMesh(m);

    // Heights of every letter, then blurred twice.
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
    gl.viewport(0, 0, mask.w, mask.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.useProgram(maskProg.p);
    for (const m of meshes) {
      letterUniforms(maskProg, m);
      draw(maskProg, m.vao, m.count, true);
    }
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    blur(mask, small2, small, 0.022 * em);
    blur(small, large2, large, 0.075 * em);

    // The light comes from up and left, so shadows fall down and right.
    const cast = [(0.42 * 0.08 * em) / W, (-0.58 * 0.08 * em) / H];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(tableProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, small.tex);
    gl.uniform1i(tableProg.u.uSmall, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, large.tex);
    gl.uniform1i(tableProg.u.uLarge, 1);
    gl.uniform3f(tableProg.u.uTable, ...TABLE);
    gl.uniform3f(tableProg.u.uAlbedo, ...ALBEDO);
    gl.uniform2f(tableProg.u.uCast, -cast[0], -cast[1]);
    draw(tableProg, quadVao, 3, false);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(letterProg.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, small.tex);
    gl.uniform1i(letterProg.u.uSmall, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, large.tex);
    gl.uniform1i(letterProg.u.uLarge, 2);
    gl.uniform2f(letterProg.u.uView, stage.canvas.width, stage.canvas.height);
    gl.uniform3f(letterProg.u.uAlbedo, ...ALBEDO.map((c) => c ** 2.2));
    gl.uniform2f(letterProg.u.uCast, -cast[0], -cast[1]);
    for (const m of meshes) {
      letterUniforms(letterProg, m);
      draw(letterProg, m.vao, m.count, true);
    }
    gl.disable(gl.BLEND);
  });

  return { destroy: () => stage.destroy() };
}
