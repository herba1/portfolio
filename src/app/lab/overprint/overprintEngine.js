import { createStage, clamp, damp } from "../_kit/stage";

// After Max Huber's Monza posters: process inks are transparent, so where two
// plates print on top of each other the paper sees both filters at once. Each
// ink here is a transmittance per channel, and a stack of inks is their
// product (Beer-Lambert, so density is an exponent, not a mix). Draw order
// can't matter, exactly as on a press.

const FAMILY = "OverprintGeist";
const DIGITS = ["5", "0", "8"];
const CELL_H = 1100;

const VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAtlas; uniform sampler2D uPaper;
uniform vec2 uRes; uniform float uDpr;
uniform vec4 uRect[3];   // atlas uv rect per numeral
uniform vec4 uBody[3];   // cx, cy, height, aspect (css px)
uniform vec4 uMove[3];   // signed speed (px/s, smoothed), stretch, lean, tail length
uniform vec3 uInk[3];    // linear transmittance at full density
uniform float uSeed[3];
out vec4 o;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + 13.7; a *= 0.5; } return s; }

// Coverage of numeral i at a css-pixel point, sharpened back to a crisp edge
// after the atlas is magnified.
float glyph(int i, vec2 px, float sharp){
  vec4 b = uBody[i]; vec4 m = uMove[i];
  vec2 d = px - b.xy;
  d.x += m.z * d.y;            // lean into the direction of travel
  d.x /= m.y;                  // speed stretch
  vec2 q = vec2(d.x / (b.z * b.w), d.y / b.z) + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  vec4 r = uRect[i];
  // Explicit level: derivatives are undefined past the early return above,
  // which would pull a blurry mip at the cell's edge.
  float lod = max(0.0, log2(r.w * float(textureSize(uAtlas, 0).y) / (b.z * uDpr)));
  float a = textureLod(uAtlas, r.xy + q * r.zw, lod).r;
  return clamp((a - 0.5) * sharp + 0.5, 0.0, 1.0);
}

void main(){
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes; // css px, y down
  vec2 dev = px * uDpr;
  vec4 stock = texture(uPaper, vUv);
  float grainP = stock.a;

  // Ink lands a hair irregular at the edge, not on a vector line.
  vec2 jit = (vec2(noise(px / 1.7), noise(px / 1.7 + 9.3)) - 0.5) * 0.9;

  vec3 col = stock.rgb;
  for (int i = 0; i < 3; i++) {
    vec4 b = uBody[i]; vec4 m = uMove[i];
    float L = m.w;
    float dir = sign(m.x);
    // Skip pixels nowhere near this plate (glyph box, lean and tail).
    float halfW = b.z * b.w * m.y * 0.5 + abs(m.z) * b.z * 0.5;
    float lead = px.x - b.x;
    float behind = -lead * dir;
    if (abs(px.y - b.y) > b.z * 0.5 || lead * dir > halfW || behind > halfW + L) continue;

    float sharp = max(1.0, b.z * uDpr / ${CELL_H.toFixed(1)} * 1.6);
    vec2 p = px + jit;
    float c = glyph(i, p, sharp);
    // Speed drag: the plate smears back along its path. Taps reach behind
    // the numeral; each one is fainter, and paper tooth breaks the faint
    // ink up like a dry roller rather than a digital gradient.
    if (L > 1.0 && c < 0.99 && behind > -halfW) {
      float grain = fract(grainP + uSeed[i] * 0.618);
      // Each pixel's taps start at a different offset, so the gaps between
      // taps turn into grain instead of stepped ghost copies.
      float off = hash(dev + uSeed[i]);
      for (int k = 1; k <= 16; k++) {
        float s = (float(k) - off) / 16.0;
        float t = glyph(i, p + vec2(dir * L * s * s, 0.0), sharp);
        float fade = pow(1.0 - s, 1.6);
        float dry = smoothstep(grain - 0.25, grain + 0.25, fade * 1.05);
        c = max(c, t * fade * mix(1.0, dry, 0.8));
      }
    }
    if (c <= 0.0) continue;
    // Density: the ink film is never perfectly even across a plate. Mottle
    // rides with the numeral, tooth stays with the paper.
    vec2 lp = (px - b.xy) / b.z;
    float mottle = noise(lp * 6.0 + uSeed[i]) * 0.65 + noise(lp * 15.0 + uSeed[i] * 2.0) * 0.35;
    float dens = 0.9 + 0.14 * mottle - 0.08 * grainP;
    col *= pow(uInk[i], vec3(c * dens));
  }

  col = pow(col, vec3(1.0 / 2.2));
  col += (hash(dev * 0.37 + 0.5) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

// The stock, baked once per size: an uncoated warm white with cloud and
// fibre, and its tooth in alpha for the ink to catch on.
const PAPER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes; uniform float uDpr;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + 13.7; a *= 0.5; } return s; }
void main(){
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 dev = px * uDpr;
  float cloud = fbm(px / 90.0);
  float fibre = fbm(vec2(px.x / 2.2, px.y / 9.0) + 40.0);
  float tooth = hash(floor(dev / 1.3));
  vec3 paper = vec3(0.905, 0.885, 0.845) * (0.985 + 0.02 * cloud) * (0.99 + 0.016 * fibre) * (0.994 + 0.012 * tooth);
  o = vec4(paper, clamp(tooth * 0.5 + fibre * 0.6 - 0.05, 0.0, 1.0));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

let fontPromise = null;
function loadFont() {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === "undefined") return (fontPromise = Promise.resolve(false));
  const face = new FontFace(FAMILY, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
  fontPromise = face
    .load()
    .then((f) => {
      document.fonts.add(f);
      return true;
    })
    .catch(() => false);
  return fontPromise;
}

// One tight cell per numeral, white on black.
function bakeAtlas() {
  const font = `800 ${CELL_H * 1.32}px ${FAMILY}, ui-sans-serif, sans-serif`;
  const m = document.createElement("canvas").getContext("2d");
  m.font = font;
  const pad = 24;
  const cells = DIGITS.map((d) => {
    const t = m.measureText(d);
    const w = Math.ceil(t.actualBoundingBoxLeft + t.actualBoundingBoxRight);
    const h = Math.ceil(t.actualBoundingBoxAscent + t.actualBoundingBoxDescent);
    return { d, t, w, h };
  });
  const H = Math.max(...cells.map((c) => c.h)) + pad * 2;
  const W = cells.reduce((s, c) => s + c.w + pad * 2, 0);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#fff";
  x.font = font;
  let ox = 0;
  const rects = cells.map((c) => {
    const cw = c.w + pad * 2;
    const ch = c.h + pad * 2;
    x.fillText(c.d, ox + pad + c.t.actualBoundingBoxLeft, (H - ch) / 2 + pad + c.t.actualBoundingBoxAscent);
    const r = { u: ox / W, v: (H - ch) / 2 / H, du: cw / W, dv: ch / H, aspect: cw / ch, ox, oy: (H - ch) / 2, cw, ch };
    ox += cw;
    return r;
  });
  const data = x.getImageData(0, 0, W, H).data;
  return { canvas: cv, rects, data, W, H };
}

const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
};

export async function createOverprint(host) {
  await loadFont();
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = Object.fromEntries(
    ["uAtlas", "uPaper", "uRes", "uDpr", "uRect", "uBody", "uMove", "uInk", "uSeed"].map((n) => [n, gl.getUniformLocation(prog, n)]),
  );

  const paperProg = gl.createProgram();
  gl.attachShader(paperProg, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(paperProg, compile(gl, gl.FRAGMENT_SHADER, PAPER_FS));
  gl.linkProgram(paperProg);
  if (!gl.getProgramParameter(paperProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(paperProg));
  let paperTex = null;
  let paperFbo = null;
  let paperDirty = true;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const atlas = bakeAtlas();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Process inks as filters: red (magenta + yellow), a cyan-leaning blue, and
  // a warm yellow, the three plates of a Huber poster.
  const INKS = [lin("#e2312a"), lin("#1f62b0"), lin("#f6cd24")];

  // Lanes: each numeral has its own height, line and cruising pace.
  const params = new URLSearchParams(window.location.search);
  const still = parseFloat(params.get("t"));
  const override = (params.get("v") || "").split(",").map(parseFloat);
  const startX = (params.get("x") || "").split(",").map(parseFloat);
  const LANES = [
    { size: 0.86, y: 0.5, base: 120, lean: 0.1 },
    { size: 0.66, y: 0.4, base: 210, lean: 0.14 },
    { size: 0.76, y: 0.6, base: 320, lean: 0.12 },
  ];
  const nums = LANES.map((l, i) => ({
    i,
    lane: l,
    x: 0,
    y: 0,
    yOff: 0,
    v: Number.isFinite(override[i]) ? override[i] : l.base,
    base: l.base,
    shown: Number.isFinite(override[i]) ? override[i] : l.base,
    held: false,
  }));

  let W = 1;
  let H = 1;
  let placed = false;
  let stillFrames = 0;
  const height = (n) => n.lane.size * Math.min(H * 0.98, W * 0.62);
  const width = (n) => height(n) * atlas.rects[n.i].aspect;
  const stretchOf = (v) => 1 + clamp(Math.abs(v) / 2600, 0, 0.42);
  const leanOf = (n, v) => Math.sign(v || 1) * (n.lane.lean + clamp(Math.abs(v) / 4000, 0, 0.18));
  const tailOf = (v) => clamp(Math.abs(v) * 0.16, 0, W * 0.5);
  const span = (n) => W + width(n) * stretchOf(n.shown) + tailOf(n.shown) + height(n) * 0.4;

  // Off one side, tail and all, and back in from the other.
  const wrap = (n) => {
    const half = (width(n) * stretchOf(n.shown)) / 2 + height(n) * 0.2;
    const tail = tailOf(n.shown);
    if (n.v > 0 && n.x - half - tail > W) n.x -= span(n);
    else if (n.v < 0 && n.x + half + tail < 0) n.x += span(n);
  };

  stage.onResize((w, h) => {
    W = w;
    H = h;
    paperDirty = true;
    stillFrames = 0;
    nums.forEach((n) => {
      n.y = h * n.lane.y + n.yOff;
      if (!placed) n.x = w * (Number.isFinite(startX[n.i]) ? startX[n.i] : [0.3, 0.52, 0.7][n.i]);
    });
    placed = true;
    if (Number.isFinite(still)) {
      // A still: let the race run for t seconds from the start line.
      for (const n of nums) {
        n.x += n.v * still;
        n.shown = n.v;
        for (let k = 0; k < 6; k++) wrap(n);
      }
    }
  });

  // Hit test against the glyph itself (no tail), topmost by depth of ink.
  const hit = (px, py) => {
    let best = null;
    for (const n of nums) {
      const h = height(n);
      const r = atlas.rects[n.i];
      let dx = px - n.x;
      const dy = py - n.y;
      dx += leanOf(n, n.shown) * dy;
      dx /= stretchOf(n.shown);
      const qx = dx / (h * r.aspect) + 0.5;
      const qy = dy / h + 0.5;
      if (qx < 0 || qx > 1 || qy < 0 || qy > 1) continue;
      const ax = Math.floor(r.ox + qx * r.cw);
      const ay = Math.floor(r.oy + qy * r.ch);
      let a = 0;
      // A little slop so the counters of a 0 or 8 still pick it up near the stroke.
      for (let oy = -30; oy <= 30; oy += 15)
        for (let ox = -30; ox <= 30; ox += 15) {
          const X = clamp(ax + ox, 0, atlas.W - 1);
          const Y = clamp(ay + oy, 0, atlas.H - 1);
          a = Math.max(a, atlas.data[(Y * atlas.W + X) * 4] / 255);
        }
      if (a > 0.3 && (!best || a > best.a || (a === best.a && Math.abs(n.v) > Math.abs(best.n.v)))) best = { n, a };
    }
    return best?.n || null;
  };

  let grab = null;
  stage.on("down", (p) => {
    const n = hit(p.x, p.y);
    if (!n) return;
    grab = { n, dx: n.x - p.x, dy: n.y - p.y, lastX: n.x };
    n.held = true;
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (grab) return;
    stage.canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!grab) return;
    const n = grab.n;
    // The throw sets the pace. Keep it, within what a press could print.
    const v = clamp(p.vx, -3200, 3200);
    n.v = Math.abs(v) < 24 ? Math.sign(n.v || 1) * 24 : v;
    n.base = clamp(Math.abs(n.v), 60, 900) * Math.sign(n.v);
    n.held = false;
    grab = null;
    stage.canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
  });

  const rect = new Float32Array(12);
  const body = new Float32Array(12);
  const move = new Float32Array(12);
  const ink = new Float32Array(9);
  INKS.forEach((c, i) => ink.set(c, i * 3));
  atlas.rects.forEach((r, i) => rect.set([r.u, r.v, r.du, r.dv], i * 4));
  const seeds = new Float32Array([3.1, 17.7, 41.3]);

  stage.onFrame((dt) => {
    const frozen = Number.isFinite(still);
    // A still draws a few frames and then holds, unless someone grabs.
    if (frozen && !grab && !paperDirty && stillFrames++ > 3) return;
    for (const n of nums) {
      if (n.held) {
        const p = stage.pointer;
        const tx = p.x + grab.dx;
        const ty = clamp(p.y + grab.dy, H * 0.2, H * 0.8);
        const nx = damp(n.x, tx, 28, dt);
        const vNow = (nx - n.x) / Math.max(dt, 1e-3);
        n.x = nx;
        n.yOff = damp(n.y, ty, 18, dt) - H * n.lane.y;
        n.v = damp(n.v, vNow, 14, dt);
      } else if (!frozen) {
        // A hard throw slowly settles to a fast cruise; it never stops racing.
        n.v = damp(n.v, n.base, 0.12, dt);
        n.x += n.v * dt;
        wrap(n);
      }
      n.y = H * n.lane.y + n.yOff;
      if (!frozen) n.shown = damp(n.shown, n.v, 9, dt);
      const i = n.i;
      body.set([n.x, n.y, height(n), atlas.rects[i].aspect], i * 4);
      move.set([n.shown || 0.001, stretchOf(n.shown), leanOf(n, n.shown), tailOf(n.shown)], i * 4);
    }

    const cw = stage.canvas.width;
    const ch = stage.canvas.height;
    gl.bindVertexArray(vao);
    if (paperDirty) {
      paperDirty = false;
      if (paperTex) gl.deleteTexture(paperTex);
      if (paperFbo) gl.deleteFramebuffer(paperFbo);
      paperTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, paperTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      paperFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, paperFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paperTex, 0);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(paperProg);
      gl.uniform2f(gl.getUniformLocation(paperProg, "uRes"), W, H);
      gl.uniform1f(gl.getUniformLocation(paperProg, "uDpr"), stage.dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, paperTex);
    gl.uniform1i(U.uPaper, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uAtlas, 0);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uDpr, stage.dpr);
    gl.uniform4fv(U.uRect, rect);
    gl.uniform4fv(U.uBody, body);
    gl.uniform4fv(U.uMove, move);
    gl.uniform3fv(U.uInk, ink);
    gl.uniform1fv(U.uSeed, seeds);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return { destroy: () => stage.destroy() };
}
