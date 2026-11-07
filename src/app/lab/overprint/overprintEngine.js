import { createStage, clamp, damp } from "../_kit/stage";

// After Max Huber's Monza posters: process inks are transparent, so where two
// plates print on top of each other the paper sees both filters at once. Each
// ink here is a transmittance per channel, and a stack of inks is their
// product (Beer-Lambert, so density is an exponent, not a mix). Draw order
// can't matter, exactly as on a press.
//
// Speed is printed the way Huber printed it: flat, hard-edged bands of the
// same ink, never a blur. Each numeral is cut into horizontal strips, and at
// speed every strip runs out behind it as a solid rule of its own length.

const FAMILY = "OverprintGeist";
const DIGITS = ["5", "0", "8"];
const CELL_H = 1100;
const STRIPES = 5;
const GAP = 0.06; // paper between rules, as a fraction of a strip
// The track runs on a shallow climb, the diagonal of the posters.
const ANGLE = -0.105;

const VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The stock pass: one fetch of the baked paper per pixel.
const STOCK_FS = `#version 300 es
precision highp float;
uniform sampler2D uPaper; uniform float uDpr;
out vec4 o;
const vec3 PAPER = vec3(0.905, 0.885, 0.845);
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec4 stock = texelFetch(uPaper, ivec2(gl_FragCoord.xy), 0);
  vec3 col = pow(PAPER * stock.r * 1.05, vec3(1.0 / 2.2));
  o = vec4(col + (hash(gl_FragCoord.xy * 0.37 + 0.5) - 0.5) / 255.0, 1.0);
}`;

// Each plate is its own quad, just big enough for the numeral and its bands,
// multiplied onto what is already printed. Gamma is a power, so
// a product of encoded transmittances is the encoding of the product: the
// press maths survives the blend unit exactly.
const PLATE_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec2 uRes; uniform vec2 uAxis; uniform vec4 uBox; // track-frame x0, y0, x1, y1
void main(){
  vec2 t = mix(uBox.xy, uBox.zw, aPos * 0.5 + 0.5);
  vec2 px = uRes * 0.5 + t.x * uAxis + t.y * vec2(-uAxis.y, uAxis.x);
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const PLATE_FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform sampler2D uPaper; uniform sampler2D uMottle;
uniform highp sampler2D uBands;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uAxis;
uniform int uI;
uniform vec4 uRect;   // atlas uv rect
uniform vec4 uBody;   // cx, cy (track frame), height, aspect
uniform vec4 uMove;   // signed speed, stretch, lean, band length
uniform vec4 uLift;   // elevation, unused x3
uniform vec3 uInk;    // linear transmittance at full density
uniform float uSeed;
out vec4 o;

const float N = ${STRIPES.toFixed(1)};
const float GAP = ${GAP.toFixed(3)};

// Coverage of the numeral in its own frame (d = offset from centre, css px),
// sharpened back to a crisp edge after the atlas is magnified.
float glyph(vec2 d, float h, float sharp, float bias){
  vec2 q = vec2(d.x / (h * uBody.w), d.y / h) + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  float lod = max(0.0, log2(uRect.w * float(textureSize(uAtlas, 0).y) / (h * uDpr))) + bias;
  float a = textureLod(uAtlas, uRect.xy + q * uRect.zw, lod).r;
  return clamp((a - 0.5) * sharp + 0.5, 0.0, 1.0);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr; // css px, y down
  vec4 stock = texelFetch(uPaper, ivec2(gl_FragCoord.xy), 0);
  float tooth = stock.g;
  // Ink lands a hair irregular at the edge, not on a vector line.
  vec2 jit = (stock.ba - 0.5) * 0.9;
  vec2 c = px - uRes * 0.5;
  vec2 tp = vec2(dot(c, uAxis), dot(c, vec2(-uAxis.y, uAxis.x)));

  vec4 b = uBody; vec4 m = uMove;
  float e = uLift.x;
  float el = max(e, 0.0);
  // Ink on paper casts no shadow. Picked up, a plate only grows a touch.
  float h = b.z * (1.0 + 0.025 * e);
  vec2 ctr = b.xy;
  float L = m.w;
  float dir = sign(m.x);

  vec2 d = tp + jit - ctr;
  d.x += m.z * d.y;            // lean into the direction of travel
  d.x /= m.y;                  // speed stretch
  float sharp = max(1.0, h * uDpr / ${CELL_H.toFixed(1)} * 1.6);
  float cov = glyph(d, h, sharp, 0.0);

  // Speed bands: the strip of the numeral this row belongs to, run out
  // behind its back edge as a flat rule. Every rule stops on the same
  // slanted line, so together they print as one band cut by paper.
  if (L > h * 0.08) {
    float qy = d.y / h + 0.5;
    float s = floor(qy * N);
    if (s >= 0.0 && s < N) {
      vec4 st = texelFetch(uBands, ivec2(int(s), uI), 0); // back edge L, R, top, bottom (cell uv)
      float top = max(st.z, (s + GAP) / N);
      float bot = min(st.w, (s + 1.0 - GAP) / N);
      if (top < bot) {
        float xe = ((dir > 0.0 ? st.x : st.y) - 0.5) * h * b.w * m.y;
        float back = -dir * h * b.w * m.y * 0.5;
        float behind = (xe - d.x * m.y) * dir;
        float len = L + (xe - back) * dir;
        float dv = min(qy - top, bot - qy) * h;
        float gap = h * 0.05;
        float dh = min(behind - gap, len - behind);
        cov = max(cov, clamp(min(dv, dh) * uDpr + 0.5, 0.0, 1.0));
      }
    }
  }
  // Density: the ink film is never perfectly even across a plate. Mottle
  // rides with the numeral, tooth stays with the paper.
  vec2 lp = (tp - ctr) / h;
  float mottle = texture(uMottle, lp * 0.9 + uSeed).r * 0.65 + texture(uMottle, lp * 2.3 + uSeed * 1.7).r * 0.35;
  // Held up off the stock, the plate stops catching its tooth.
  // Full density sits near 0.85, not 1: a solid that still lets the plates
  // under it through, so every overlap prints as a secondary, never a black.
  float dens = 0.78 + 0.12 * mottle - 0.07 * tooth * (1.0 - el);
  vec3 t = pow(uInk, vec3(cov * dens));
  o = vec4(pow(t, vec3(1.0 / 2.2)), 1.0);
}`;

// The stock, baked once per size: an uncoated warm white with cloud and
// fibre. r = brightness, g = tooth, ba = a small edge jitter field.
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
  float bright = (0.985 + 0.02 * cloud) * (0.99 + 0.016 * fibre) * (0.994 + 0.012 * tooth);
  o = vec4(bright / 1.05, clamp(tooth * 0.5 + fibre * 0.6 - 0.05, 0.0, 1.0), noise(px / 1.7), noise(px / 1.7 + 9.3));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, fs, vs = VS) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
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

// One tight cell per numeral, white on black, plus each strip's back edges.
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
  const x = cv.getContext("2d", { willReadFrequently: true });
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

  // Per strip: the outermost back edge on each side, and the rows the glyph
  // actually covers. A rule starts a little clear of the numeral, so it
  // follows its silhouette without ever filling a counter or a notch.
  const bands = new Float32Array(STRIPES * 3 * 4);
  rects.forEach((r, i) => {
    for (let s = 0; s < STRIPES; s++) {
      let left = 1;
      let right = 0;
      let top = 1;
      let bot = 0;
      const y0 = Math.floor(r.oy + (s / STRIPES) * r.ch);
      const y1 = Math.floor(r.oy + ((s + 1) / STRIPES) * r.ch);
      for (let y = y0; y < y1; y += 2) {
        let lo = -1;
        let hi = -1;
        for (let xx = r.ox; xx < r.ox + r.cw; xx++) {
          if (data[(y * W + xx) * 4] > 127) {
            if (lo < 0) lo = xx;
            hi = xx;
          }
        }
        if (lo < 0) continue;
        const v = (y - r.oy) / r.ch;
        top = Math.min(top, v);
        bot = Math.max(bot, v);
        left = Math.min(left, (lo - r.ox) / r.cw);
        right = Math.max(right, (hi - r.ox) / r.cw);
      }
      bands.set([left, right, top, bot], (i * STRIPES + s) * 4);
    }
  });
  return { canvas: cv, rects, data, W, H, bands };
}

// A small tiling field for ink mottle, so the shader samples instead of
// computing noise per pixel per plate.
function mottleData() {
  const n = 64;
  const out = new Uint8Array(n * n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n * n; k++) out[k] = Math.floor(rnd() * 255);
  return { n, out };
}

function softwareGL() {
  try {
    const g = document.createElement("canvas").getContext("webgl2");
    const ext = g?.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    g?.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(name || "");
  } catch {
    return false;
  }
}

const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
};

export async function createOverprint(host) {
  await loadFont();
  const params = new URLSearchParams(window.location.search);
  const still = parseFloat(params.get("t"));
  // A software rasteriser can't fill a DPR 2 canvas every frame; give it
  // DPR 1 while the race runs. Stills keep full resolution.
  const dpr = softwareGL() && !Number.isFinite(still) ? 1 : 2;
  const stage = createStage(host, { webgl: true, dpr, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const prog = program(gl, PLATE_FS, PLATE_VS);
  const U = Object.fromEntries(
    ["uAtlas", "uPaper", "uMottle", "uBands", "uRes", "uDpr", "uAxis", "uBox", "uI", "uRect", "uBody", "uMove", "uLift", "uInk", "uSeed"].map(
      (n) => [n, gl.getUniformLocation(prog, n)],
    ),
  );
  const stockProg = program(gl, STOCK_FS);
  const paperProg = program(gl, PAPER_FS);
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

  const texture = (setup) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    setup();
    return t;
  };
  const params2D = (min, mag, wrap) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };

  const atlas = bakeAtlas();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const tex = texture(() => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    params2D(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE);
  });
  const bandTex = texture(() => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, STRIPES, 3, 0, gl.RGBA, gl.FLOAT, atlas.bands);
    params2D(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE);
  });
  const md = mottleData();
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const mottleTex = texture(() => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, md.n, md.n, 0, gl.RED, gl.UNSIGNED_BYTE, md.out);
    params2D(gl.LINEAR, gl.LINEAR, gl.REPEAT);
  });

  // Process inks as filters: a red pulled toward magenta, a cyan-leaning
  // process blue that still passes some red light, and a warm yellow, the
  // three plates of a Huber poster. Tuned on the overlaps, not the solids:
  // red over blue prints aubergine, red over yellow vermilion, blue over
  // yellow green, and all three a warm brown-black.
  const INKS = [lin("#e0283f"), lin("#327cc4"), lin("#f6cd24")];
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ?t=seconds holds a still; ?lift=i,e holds numeral i up off the paper.
  const override = (params.get("v") || "").split(",").map(parseFloat);
  const startX = (params.get("x") || "").split(",").map(parseFloat);
  const liftQ = (params.get("lift") || "").split(",").map(parseFloat);

  // Lanes are fractions of the track's cross height; sizes of the short side.
  // Lanes sit on a register grid; a numeral thrown off its lane lands on the
  // nearest line.
  const GRID = [-0.2, -0.1, 0, 0.1, 0.2];
  const LANES = [
    { size: 0.5, y: 0.06, base: 110, lean: 0.1 },
    { size: 0.36, y: -0.13, base: 270, lean: 0.14 },
    { size: 0.42, y: 0.16, base: 390, lean: 0.12 },
  ];
  const axis = [Math.cos(ANGLE), Math.sin(ANGLE)];
  const nums = LANES.map((l, i) => {
    const v = Number.isFinite(override[i]) ? override[i] : reduced ? 0 : l.base;
    return {
      i,
      lane: l,
      x: 0,
      y: 0,
      ty: l.y,
      v,
      base: v,
      shown: v,
      held: false,
      e: liftQ[0] === i && Number.isFinite(liftQ[1]) ? liftQ[1] : 0,
      ev: 0,
      lift: liftQ[0] === i ? 1 : 0,
    };
  });

  let W = 1;
  let H = 1;
  let TW = 1; // track length across the box
  let TH = 1; // track cross height
  let placed = false;
  let stillFrames = 0;
  const short = () => Math.min(H, W * 0.62);
  const height = (n) => n.lane.size * short();
  const width = (n) => height(n) * atlas.rects[n.i].aspect;
  const stretchOf = (v) => 1 + clamp(Math.abs(v) / 3000, 0, 0.3);
  const leanOf = (n, v) => Math.sign(v || 1) * (n.lane.lean + clamp(Math.abs(v) / 4000, 0, 0.16));
  // Bands only appear once the plate is really moving, and grow with pace.
  const tailOf = (v) => clamp((Math.abs(v) - 150) * 1.1, 0, W * 0.75);
  const toTrack = (x, y) => {
    const cx = x - W / 2;
    const cy = y - H / 2;
    return [cx * axis[0] + cy * axis[1], -cx * axis[1] + cy * axis[0]];
  };

  const laneY = (n) => n.ty * Math.min(H, TH);

  // Off one end, bands and all, and back in at the other.
  const wrap = (n) => {
    const half = (width(n) * stretchOf(n.shown)) / 2 + height(n) * 0.25;
    const tail = tailOf(n.shown);
    const span = TW + half * 2 + tail;
    if (n.v > 0 && n.x - half - tail > TW / 2) n.x -= span;
    else if (n.v < 0 && n.x + half + tail < -TW / 2) n.x += span;
  };

  stage.onResize((w, h) => {
    W = w;
    H = h;
    TW = w * Math.abs(axis[0]) + h * Math.abs(axis[1]);
    TH = w * Math.abs(axis[1]) + h * Math.abs(axis[0]);
    paperDirty = true;
    stillFrames = 0;
    nums.forEach((n) => {
      if (!placed) n.x = TW * ((Number.isFinite(startX[n.i]) ? startX[n.i] : [0.375, 0.493, 0.647][n.i]) - 0.5);
      n.y = laneY(n);
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

  // Hit test against the glyph itself (no bands), topmost by depth of ink.
  const hit = (sx, sy) => {
    const [px, py] = toTrack(sx, sy);
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
      if (a > 0.3 && (!best || n.held || a > best.a)) best = { n, a };
    }
    return best?.n || null;
  };

  let grab = null;
  stage.on("down", (p) => {
    const n = hit(p.x, p.y);
    if (!n) return;
    const [px, py] = toTrack(p.x, p.y);
    grab = { n, dx: n.x - px, dy: n.y - py };
    n.held = true;
    n.lift = 1;
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (grab) return;
    stage.canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!grab) return;
    const n = grab.n;
    // The throw sets the pace, along the track, within what a press could print.
    const v = clamp(p.vx * axis[0] + p.vy * axis[1], -3200, 3200);
    const floor = reduced ? 0 : 60;
    n.v = Math.abs(v) < floor ? Math.sign(n.v || v || 1) * floor : v;
    n.base = reduced ? 0 : clamp(Math.abs(n.v), 90, 900) * Math.sign(n.v);
    // Lay it back down on the nearest register line.
    const q = n.y / Math.min(H, TH);
    n.ty = GRID.reduce((a, g) => (Math.abs(g - q) < Math.abs(a - q) ? g : a), GRID[0]);
    n.held = false;
    n.lift = 0;
    grab = null;
    stage.canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
  });

  const rect = new Float32Array(12);
  const body = new Float32Array(12);
  const move = new Float32Array(12);
  const lift = new Float32Array(12);
  const last = new Float32Array(36);
  const ink = new Float32Array(9);
  INKS.forEach((c, i) => ink.set(c, i * 3));
  atlas.rects.forEach((r, i) => rect.set([r.u, r.v, r.du, r.dv], i * 4));
  const seeds = new Float32Array([3.1, 17.7, 41.3]);

  stage.onFrame((dt) => {
    const frozen = Number.isFinite(still);
    if (frozen && !grab && !paperDirty && stillFrames++ > 3 && nums.every((n) => Math.abs(n.e - n.lift) < 1e-3 && Math.abs(n.ev) < 1e-3)) return;
    for (const n of nums) {
      if (n.held) {
        const [px, py] = toTrack(stage.pointer.x, stage.pointer.y);
        const lim = Math.min(H, TH) * 0.3;
        const nx = damp(n.x, px + grab.dx, 30, dt);
        const vNow = (nx - n.x) / Math.max(dt, 1e-3);
        n.x = nx;
        n.y = damp(n.y, clamp(py + grab.dy, -lim, lim), 30, dt);
        n.v = damp(n.v, vNow, 14, dt);
      } else {
        if (!frozen) {
          // A hard throw slowly settles to a fast cruise; it never stops racing.
          n.v = damp(n.v, n.base, 0.14, dt);
          n.x += n.v * dt;
          wrap(n);
        }
        n.y = damp(n.y, laneY(n), 7, dt);
      }
      // The plate is lifted on a spring, and lands with a touch of overshoot:
      // it presses home and settles back into register.
      const k = n.lift ? 520 : 380;
      const c = n.lift ? 2 * Math.sqrt(k) : 2 * Math.sqrt(k) * 0.55;
      // Substeps keep the spring stable when frames run long.
      const steps = Math.ceil(dt * 240);
      for (let s = 0; s < steps; s++) {
        n.ev += (k * (n.lift - n.e) - c * n.ev) * (dt / steps);
        n.e += n.ev * (dt / steps);
      }
      if (!frozen || n.held) n.shown = damp(n.shown, n.v, 9, dt);
      const i = n.i;
      const e = n.e;
      body.set([n.x, n.y, height(n), atlas.rects[i].aspect], i * 4);
      move.set([n.shown || 0.001, stretchOf(n.shown), leanOf(n, n.shown), tailOf(n.shown)], i * 4);
      lift.set([e, 0, 0, 0], i * 4);
    }

    // Render only on change.
    let changed = paperDirty;
    for (let k = 0; k < 12; k++) {
      if (Math.abs(last[k] - body[k]) > 0.01 || Math.abs(last[12 + k] - move[k]) > 0.01 || Math.abs(last[24 + k] - lift[k]) > 1e-4) changed = true;
      last[k] = body[k];
      last[12 + k] = move[k];
      last[24 + k] = lift[k];
    }
    if (!changed) return;

    const cw = stage.canvas.width;
    const ch = stage.canvas.height;
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    if (paperDirty) {
      paperDirty = false;
      if (paperTex) gl.deleteTexture(paperTex);
      if (paperFbo) gl.deleteFramebuffer(paperFbo);
      paperTex = texture(() => {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        params2D(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE);
      });
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
    const bind = (unit, t, u) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u, unit);
    };

    // The stock.
    gl.disable(gl.BLEND);
    gl.useProgram(stockProg);
    bind(1, paperTex, gl.getUniformLocation(stockProg, "uPaper"));
    gl.uniform1f(gl.getUniformLocation(stockProg, "uDpr"), stage.dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // The plates, multiplied on.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.useProgram(prog);
    bind(0, tex, U.uAtlas);
    bind(1, paperTex, U.uPaper);
    bind(2, mottleTex, U.uMottle);
    bind(3, bandTex, U.uBands);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uDpr, stage.dpr);
    gl.uniform2f(U.uAxis, axis[0], axis[1]);
    for (let i = 0; i < 3; i++) {
      const o = i * 4;
      const [x, y, h0, asp] = body.subarray(o, o + 4);
      const [v, st, ln, L] = move.subarray(o, o + 4);
      const e = lift[o];
      const h = h0 * (1 + 0.025 * Math.max(e, 0));
      const halfW = (h * asp * st) / 2 + (Math.abs(ln) * h) / 2 + 4;
      const pad = 4;
      const cx = x;
      const back = v > 0 ? L : 0;
      const front = v > 0 ? 0 : L;
      gl.uniform4f(U.uBox, cx - halfW - back - 4, y - h / 2 - 4, x + halfW + front + pad, y + h / 2 + pad);
      gl.uniform1i(U.uI, i);
      gl.uniform4fv(U.uRect, rect.subarray(o, o + 4));
      gl.uniform4fv(U.uBody, body.subarray(o, o + 4));
      gl.uniform4fv(U.uMove, move.subarray(o, o + 4));
      gl.uniform4fv(U.uLift, lift.subarray(o, o + 4));
      gl.uniform3fv(U.uInk, ink.subarray(i * 3, i * 3 + 3));
      gl.uniform1f(U.uSeed, seeds[i]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  });

  return { destroy: () => stage.destroy() };
}
