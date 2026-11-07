import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { GW, GH, CX, CY, CELL, MW, MH, LO0, LO1, HI, JUMP, U0, DW, DH, fwd, demoMask, bake } from "./sortCore";

// Sort: a real pixel sort, after Kim Asendorf's ASDF Pixel Sort (2010), run
// on the GPU over a summer photograph of a Japanese level crossing.
//
// Sort lines. Pixels are not sorted along image rows but along a curl: a
// family of parallel curves that run left to right along the bottom of the
// frame, turn up round a centre C as concentric arcs, and come back over the
// top heading left, the way the grass in the reference rides up a ramp. The
// curl is parameterised by arc length u and radius r (an equal-area map, one
// texel per pixel), so every sort line is one row of a "domain" texture and
// the sort itself is plain row sorting.
//
// Spans (ASDF). A span may only start at grass (a few green pixels in a row):
// a position on a row belongs to a span when it lies within reach of the last
// grass before it on its line, the brush mask m there is on, and its
// luminance lies inside [lo(m), hi]. The reach is short: a span ends once it
// has run 15% of its line's reach through anything that is not vegetation,
// so it bridges a gap (the road, a wall, a strip of sky) but never trails a
// long tail of sky. Reach and lo both follow m, so brushing longer or harder
// lets a span run further past the grass and lets darker pixels join. A span breaks only at a true silhouette: the
// outline of a pole, a sign or a cabinet in the photo's depth map (Depth
// Anything V2), or a step in depth between neighbours. So the curl's lines
// carry runs of green up into the sky as one wave, and never smear a pole.
//
// The sort. Odd-even transposition sort in WebGL2 fragment passes over a
// R16UI permutation texture: each texel holds the home index of the pixel
// now sitting there. Every pass compares disjoint neighbour pairs (odd pairs,
// then even pairs). Inside a span the pair is ordered by the home pixel's
// sort key, luminance pulled down by greenness, smallest first (ties by home
// index): the greens stay rooted where the span starts and fill the line as
// one body up the curl, and the sky and wall highlights are pushed out to the
// crest as pale tips. Everywhere else the pair is ordered by home index, which
// is the identity, so any pixel outside a span flows back home one position
// per pass. Erasing the mask (a long press) therefore un-sorts by the same
// network: the darkest pixels leave their spans first and every pixel slides
// back to where it came from.
//
// The resting wave is the same sort run to completion on the CPU at load
// (identical keys and tie-break, so it is a fixed point of the GPU network):
// a few hundred thousand comparisons once instead of ~1500 full passes.
//
// Display. The photo goes through film.js (summer, light) once per resize.
// The sort grid is the print's own 2400x1600, so a sort line is one device
// pixel tall at full size and every sorted run lands as a hard 1 px strip;
// a pixel still at home shows the developed print untouched.
//
// Query: ?mask=demo|none &amount=0..1 holds the resting wave at that amount.

const ASSET = "/lab/sort/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const PASSES = 12; // odd-even passes per frame
const BUDGET = 4000; // passes to keep running after the last mask change
const SG = GW / 1200; // grid px per layout unit

const FILM = {
  ...FILM_PRESETS.summer,
  headroom: 0.8,
  halation: 0.2,
  bloom: 0.14,
  softness: 0.32,
  contrast: 1.14,
  saturation: 1.08,
  blueDepth: 0.7,
  grain: 0.24,
  vignette: 0.08,
  flipY: true,
};

const GLSL_MAP = `
const float PI = 3.14159265358979;
uniform vec2 uC;
uniform float uU0;
vec2 curlFwd(vec2 p) {
  vec2 d = p - uC;
  if (d.x < 0.0) return d.y >= 0.0 ? d : vec2(PI * -d.y - d.x, -d.y);
  float r = length(d);
  return vec2(r * atan(d.x, d.y), r);
}
vec2 curlInv(float u, float r) {
  if (u < 0.0) return uC + vec2(u, r);
  float arc = PI * r;
  if (u <= arc) {
    float th = u / max(r, 1e-6);
    return uC + r * vec2(sin(th), cos(th));
  }
  return uC + vec2(-(u - arc), -r);
}
`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const PASS_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uState;
uniform sampler2D uField;   // lum hi, lum lo, depth (255 = silhouette), reach (0 = off the photo)
uniform usampler2D uKey;    // R16UI sort key of the pixel at home on each texel: greenest and darkest first
uniform sampler2D uMask;    // R8, one texel per mask cell, LINEAR
uniform int uPhase;
uniform float uLo0;
uniform float uLo1;
uniform float uHi;
uniform float uJump;
uniform float uCell;
uniform ivec2 uActive;      // [x0, x1): pairs reaching outside never swap
${GLSL_MAP}
out uvec4 o;

float lum(vec4 f) { return (floor(f.r * 255.0 + 0.5) * 256.0 + floor(f.g * 255.0 + 0.5)) / 65535.0; }
float maskAt(int i, int j) {
  vec2 p = curlInv(uU0 + float(i) + 0.5, float(j) + 0.5);
  return texture(uMask, p / (uCell * vec2(textureSize(uMask, 0)))).r;
}
bool inSpan(vec4 f, float m) {
  float a = floor(f.a * 255.0 + 0.5);
  if (a < 0.5 || f.b > 0.999 || m < 0.5 / 255.0) return false;
  if ((a - 1.0) / 253.0 > m) return false; // out of reach of the grass
  float l = lum(f);
  return l >= mix(uLo0, uLo1, m) && l <= uHi;
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int W = textureSize(uState, 0).x;
  int left = ((q.x + uPhase) & 1) == 0 ? q.x : q.x - 1;
  int right = left + 1;
  uint self = texelFetch(uState, q, 0).r;
  if (left < max(0, uActive.x) || right >= min(W, uActive.y)) { o = uvec4(self, 0u, 0u, 0u); return; }
  uint a = texelFetch(uState, ivec2(left, q.y), 0).r;
  uint b = texelFetch(uState, ivec2(right, q.y), 0).r;
  vec4 fl = texelFetch(uField, ivec2(left, q.y), 0);
  vec4 fr = texelFetch(uField, ivec2(right, q.y), 0);
  float dl = floor(fl.b * 255.0 + 0.5);
  float dr = floor(fr.b * 255.0 + 0.5);
  bool open = abs(dl - dr) < uJump
    && inSpan(fl, maskAt(left, q.y)) && inSpan(fr, maskAt(right, q.y));
  bool sw;
  if (open) {
    uint ka = texelFetch(uKey, ivec2(int(a), q.y), 0).r;
    uint kb = texelFetch(uKey, ivec2(int(b), q.y), 0).r;
    sw = ka > kb || (ka == kb && a > b);
  } else {
    sw = a > b;
  }
  uint v = q.x == left ? (sw ? b : a) : (sw ? a : b);
  o = uvec4(v, 0u, 0u, 0u);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uState;
uniform sampler2D uFilm;    // the developed print, print-sized, GL orientation
uniform vec4 uPrint;        // x, y, w, h in device px, top-left origin
uniform float uCanvasH;
uniform vec3 uPaper;
uniform vec2 uGrid;
${GLSL_MAP}
out vec4 o;
void main() {
  vec2 d = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 l = (d - uPrint.xy) / uPrint.zw;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThanEqual(l, vec2(1.0)))) { o = vec4(uPaper, 1.0); return; }
  ivec2 fs = textureSize(uFilm, 0);
  ivec2 fp = ivec2(d - uPrint.xy);
  vec3 col = texelFetch(uFilm, ivec2(fp.x, fs.y - 1 - fp.y), 0).rgb;
  vec2 p = l * uGrid;
  vec2 ur = curlFwd(p);
  ivec2 ds = textureSize(uState, 0);
  ivec2 t = ivec2(floor(ur.x - uU0), floor(ur.y));
  if (t.x >= 0 && t.y >= 0 && t.x < ds.x && t.y < ds.y) {
    uint h = texelFetch(uState, t, 0).r;
    if (int(h) != t.x) {
      vec2 ph = curlInv(uU0 + float(h) + 0.5, float(t.y) + 0.5);
      ivec2 hp = clamp(ivec2(floor(ph / uGrid * vec2(fs))), ivec2(0), fs - 1);
      col = texelFetch(uFilm, ivec2(hp.x, fs.y - 1 - hp.y), 0).rgb;
    }
  }
  o = vec4(col, 1.0);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function pixels(bm, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export async function createSort(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qMask = q.get("mask");
  const amount = clamp(num("amount") ?? 1, 0, 1);
  const passes = clamp(Math.round(num("passes") ?? PASSES), 2, 64) & ~1;
  const held = qMask != null || num("amount") != null;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "crosshair";

  const [photoBm, depthBm] = await Promise.all([loadBitmap(`${ASSET}photo.webp`), loadBitmap(`${ASSET}depth.png`)]);
  // ---- mask
  const mask = qMask === "none" ? new Float32Array(MW * MH) : demoMask(amount);
  const mask8 = new Uint8Array(MW * MH);
  const syncMask8 = () => {
    for (let i = 0; i < mask.length; i++) mask8[i] = Math.round(clamp(mask[i], 0, 1) * 255);
  };
  syncMask8();

  const { field, key, state } = bake(pixels(photoBm, GW, GH), pixels(depthBm, GW, GH), mask8, qMask !== "none");
  depthBm.close?.();

  // ---- GL resources
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const tex = (internal, format, type, w, h, data, filter = gl.NEAREST) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const fieldTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, DW, DH, field);
  const keyTex = tex(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, DW, DH, key);
  const maskTex = tex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, MW, MH, mask8, gl.LINEAR);
  const stateTex = [0, 1].map(() => tex(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, DW, DH, state));
  const stateFbo = stateTex.map((t) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let cur = 0;

  const photoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photoTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, photoBm);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  photoBm.close?.();

  const pass = compile(gl, QUAD_VS, PASS_FS);
  const show = compile(gl, QUAD_VS, SHOW_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---- layout and the developed print
  let L = null;
  let filmT = null;
  let film = null;
  let dirty = true;
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    const narrow = W < 700;
    const margin = Math.max(20, Math.min(W, H) * (narrow ? 0.05 : 0.09));
    const printW = Math.min(W - margin * 2, (H - margin * 2) * (GW / GH));
    const pw = Math.round(printW * dpr);
    const ph = Math.round((printW * GH * dpr) / GW);
    const px = Math.round((W * dpr - pw) / 2);
    const py = Math.round((H * dpr - ph) / 2);
    return { W, H, dpr, pw, ph, px, py };
  };
  const build = () => {
    L = layout();
    if (filmT) {
      gl.deleteTexture(filmT.tex);
      gl.deleteFramebuffer(filmT.fbo);
    }
    const t = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, L.pw, L.ph, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    filmT = { tex: t, fbo };
    if (!film) film = createFilm(gl, { width: L.pw, height: L.ph });
    film.resize(L.pw, L.ph);
    film.render(photoTex, FILM, fbo);
    dirty = true;
  };
  stage.onResize(build);

  // ---- the sort network
  // The active rect: the domain bbox of every mask cell that has ever been on.
  // It only grows, so both ping-pong textures always agree outside it.
  const active = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const everOn = new Uint8Array(MW * MH);
  const raw = { x0: 0, x1: 0, y0: 0, y1: 0, empty: true };
  const growActive = () => {
    let { x0, x1, y0, y1, empty } = raw;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] <= 0 || everOn[i]) continue;
      everOn[i] = 1;
      const cx = (i % MW) * CELL;
      const cy = Math.floor(i / MW) * CELL;
      for (const [x, y] of [[cx, cy], [cx + CELL, cy], [cx, cy + CELL], [cx + CELL, cy + CELL], [cx + CELL / 2, cy + CELL / 2]]) {
        const [uu, r] = fwd(x, y);
        const tx = uu - U0;
        if (empty) {
          x0 = x1 = tx;
          y0 = y1 = r;
          empty = false;
        }
        x0 = Math.min(x0, tx);
        x1 = Math.max(x1, tx);
        y0 = Math.min(y0, r);
        y1 = Math.max(y1, r);
      }
    }
    if (empty) return;
    Object.assign(raw, { x0, x1, y0, y1, empty });
    const M = CELL + 4;
    active.x0 = clamp(Math.floor((x0 - M) / 2) * 2, 0, DW);
    active.x1 = clamp(Math.ceil((x1 + M) / 2) * 2, 0, DW);
    active.y0 = clamp(Math.floor(y0 - M), 0, DH);
    active.y1 = clamp(Math.ceil(y1 + M), 0, DH);
  };
  growActive();
  let budget = 0;
  let phase = 0;
  let load = passes; // odd-even passes this frame, adapted to frame time
  const runPasses = (n) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    if (active.x1 <= active.x0) return;
    // Only the part of the domain that has ever held a span can change.
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(active.x0, active.y0, active.x1 - active.x0, active.y1 - active.y0);
    gl.useProgram(pass.p);
    const u = pass.u;
    gl.uniform2f(u.uC, CX, CY);
    gl.uniform1f(u.uU0, U0);
    gl.uniform1f(u.uLo0, LO0);
    gl.uniform1f(u.uLo1, LO1);
    gl.uniform1f(u.uHi, HI);
    gl.uniform1f(u.uJump, JUMP);
    gl.uniform1f(u.uCell, CELL);
    gl.uniform2i(u.uActive, active.x0, active.x1);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uField, 1);
    gl.uniform1i(u.uMask, 2);
    gl.uniform1i(u.uKey, 3);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, keyTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.viewport(0, 0, DW, DH);
    for (let k = 0; k < n; k++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[1 - cur]);
      gl.uniform1i(u.uPhase, phase);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      cur = 1 - cur;
      phase = 1 - phase;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  const present = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.useProgram(show.p);
    const u = show.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uFilm, 1);
    gl.uniform2f(u.uC, CX, CY);
    gl.uniform1f(u.uU0, U0);
    gl.uniform4f(u.uPrint, L.px, L.py, L.pw, L.ph);
    gl.uniform1f(u.uCanvasH, stage.canvas.height);
    gl.uniform3f(u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform2f(u.uGrid, GW, GH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  // ---- input: brush to sort, long press to let everything flow home
  const toGrid = (x, y) => [((x * L.dpr - L.px) / L.pw) * GW, ((y * L.dpr - L.py) / L.ph) * GH];
  let press = null; // { x, y, t, moved, pressure }
  let unsort = null; // { gx, gy, t0 }
  let maskDirty = false;
  stage.on("down", (p, e) => {
    press = { x: p.x, y: p.y, t: performance.now(), moved: false, pressure: e.pressure > 0 ? e.pressure : 0.5 };
    unsort = null;
  });
  stage.on("move", (p, e) => {
    if (!press) return;
    if (e.pressure > 0) press.pressure = e.pressure;
    if (Math.hypot(p.x - press.x, p.y - press.y) > 6) press.moved = true;
  });
  stage.on("up", () => {
    press = null;
    unsort = null;
  });

  // Every mask cell's place on the curl, so a stroke can paint along the
  // sort lines rather than as a disc.
  const cellU = new Float32Array(MW * MH);
  const cellR = new Float32Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const [uu, r] = fwd(((i % MW) + 0.5) * CELL, (Math.floor(i / MW) + 0.5) * CELL);
    cellU[i] = uu;
    cellR[i] = r;
  }
  // The brush: a comet laid along the sort lines through the pointer, a short
  // head upstream and a long tail downstream, so the span it opens runs on
  // from the grass under the hand out over whatever lies further up the curl.
  const brush = (gx, gy, radius, tail, fn) => {
    const [u0, r0] = fwd(gx, gy);
    for (let i = 0; i < mask.length; i++) {
      const a = (cellR[i] - r0) / radius;
      if (a <= -1 || a >= 1) continue;
      const du = cellU[i] - u0;
      const b = du < 0 ? -du / radius : du / tail;
      const d = Math.hypot(a, b);
      if (d >= 1) continue;
      const w = 1 - d * d;
      const v = fn(mask[i], w * w);
      if (v !== mask[i]) {
        mask[i] = v;
        maskDirty = true;
      }
    }
  };

  const frame = (dt) => {
    if (!L) return;
    const now = performance.now();
    if (press && L) {
      const [gx, gy] = toGrid(stage.pointer.x, stage.pointer.y);
      const age = (now - press.t) / 1000;
      if (!press.moved && age > 0.42) {
        if (!unsort) unsort = { gx, gy, t0: now };
        const ua = (now - unsort.t0) / 1000;
        // The erased disc grows from the press point; inside it the mask
        // drains, so the darkest pixels leave their spans first.
        const R = (40 + 1500 * (1 - Math.exp(-ua * 0.8))) * SG;
        for (let i = 0; i < mask.length; i++) {
          const cx = ((i % MW) + 0.5) * CELL;
          const cy = (Math.floor(i / MW) + 0.5) * CELL;
          if (mask[i] > 0 && Math.hypot(cx - unsort.gx, cy - unsort.gy) < R) {
            mask[i] = Math.max(0, mask[i] - dt * 1.6);
            maskDirty = true;
          }
        }
      } else if (press.moved || age < 0.42) {
        // Dwell and pressure both feed the mask: reach grows, lo(m) falls,
        // spans lengthen; a held press lets the tail run on up the curl.
        const rate = (1.6 + 4 * press.pressure) * (press.moved ? 1 : 0.35);
        const tail = (260 + 520 * Math.min(1, age / 2.5)) * SG;
        brush(gx, gy, 90 * SG, tail, (m, w) => Math.min(1, m + dt * rate * w));
      }
    }
    if (maskDirty) {
      syncMask8();
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MW, MH, gl.RED, gl.UNSIGNED_BYTE, mask8);
      maskDirty = false;
      growActive();
      budget = BUDGET;
    }
    if (budget > 0) {
      // The grid is the full print, so a slow GPU sheds passes rather than
      // frames: the sort runs slower but the brush stays under the hand.
      load = dt > 0.04 ? Math.max(2, load - 2) : dt < 0.022 ? Math.min(passes, load + 2) : load;
      // Un-sorting runs at half rate so the flow home stays legible.
      const n = unsort ? Math.max(2, (load >> 2) << 1) : load;
      runPasses(n);
      budget -= n;
      dirty = true;
    }
    if (dirty) {
      present();
      dirty = false;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1 && !L) build();
  if (L) present();
  void embedded;
  void held;

  return {
    destroy() {
      film?.destroy();
      if (filmT) {
        gl.deleteTexture(filmT.tex);
        gl.deleteFramebuffer(filmT.fbo);
      }
      for (const t of [...stateTex, fieldTex, keyTex, maskTex, photoTex]) gl.deleteTexture(t);
      for (const f of stateFbo) gl.deleteFramebuffer(f);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(pass.p);
      gl.deleteProgram(show.p);
      stage.destroy();
    },
  };
}
