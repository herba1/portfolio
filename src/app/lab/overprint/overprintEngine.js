import { createStage, clamp, damp } from "../_kit/stage";

// After Max Huber's Monza posters: process inks are transparent, so where two
// plates print on top of each other the paper sees both filters at once. Each
// ink here is a transmittance per channel, and a stack of inks is their
// product (Beer-Lambert, so density is an exponent, not a mix). Draw order
// can't matter, exactly as on a press.
//
// Speed is printed the way Huber printed it: flat, hard-edged rules of the
// same ink, never a blur. Each numeral is cut into horizontal strips, and when
// it is thrown every strip runs out behind it as a rule of its own weight and
// length, heavy at the centre and hairline at the edges.

const FAMILY = "OverprintGeist";
const DIGITS = ["5", "0", "8"];
const CELL_H = 1100;
const STRIPES = 5;
const GAP = 0.06; // paper between rules, as a fraction of a strip
const HAIR = 0.14; // weight of the outermost rules against the centre one
// How far a plate's edge swells in and out, css px peak to peak.
const SWELL = 1.2;
// How far each strip's rule runs, as a share of the tail: a ragged edge.
const REACH = [0.72, 0.9, 1.0, 0.55, 0.8];
// The track runs on a shallow climb, the diagonal of the posters.
const ANGLE = -0.105;
// Only the fastest plate rules its pace at full length. Every slower plate
// prints a short hairline at this share of its own tail, so a sheet with all
// three running still reads as one race and not three piled-up inks.
const CALM_LEN = 0.3;

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
uniform vec4 uLift;   // elevation, track x where the rules stop, calm (0 leads, 1 hairline), track x of the figure
uniform vec3 uInk;    // linear transmittance at full density
uniform float uSeed;
out vec4 o;

const float N = ${STRIPES.toFixed(1)};
const float GAP = ${GAP.toFixed(3)};
const float HAIR = ${HAIR.toFixed(3)};
const float SWELL = ${SWELL.toFixed(2)};
const float REACH[5] = float[5](${REACH.map((r) => r.toFixed(2)).join(", ")});

float vhash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
}

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

  // The edge is a press edge: crisp, with only a slow swell where the slug
  // took a touch more ink. The swell rides with the plate (one undulation
  // every forty px or so); the paper adds no more than a hair of grain.
  vec2 sp = (tp - ctr) / 40.0 + uSeed * 31.0;
  vec2 swell = vec2(vnoise(sp), vnoise(sp + 17.3)) - 0.5;
  vec2 jit = swell * SWELL + (stock.ba - 0.5) * 0.2;

  vec2 d = tp + jit - ctr;
  d.x += m.z * d.y;            // lean into the direction of travel
  d.x /= m.y;                  // speed stretch
  float sharp = max(1.0, h * uDpr / ${CELL_H.toFixed(1)} * 1.6);
  float cov = glyph(d, h, sharp, 0.0);

  // Speed bands, graded the way Huber ruled them: a heavy rule out of the
  // middle of the numeral, thinning to hairlines at its top and bottom. Each
  // rule runs out behind its own strip of the silhouette to its own length,
  // so the ends recede raggedly instead of stopping on one cut line.
  if (L > h * 0.1) {
    float qy = d.y / h + 0.5;
    float s = floor(qy * N);
    if (s >= 0.0 && s < N) {
      vec4 st = texelFetch(uBands, ivec2(int(s), uI), 0); // back edge L, R, top, bottom (cell uv)
      float lo = max(st.z, (s + GAP) / N);
      float hi = min(st.w, (s + 1.0 - GAP) / N);
      if (lo < hi) {
        float xe = ((dir > 0.0 ? st.x : st.y) - 0.5) * h * b.w * m.y;
        float back = -dir * h * b.w * m.y * 0.5;
        float behind = (xe - d.x * m.y) * dir;
        float gap = h * 0.05;
        // Each numeral takes the stagger from a different place, so no two
        // plates carry the same edge.
        float len = L * REACH[int(mod(s + float(uI) * 2.0, N))] + (xe - back) * dir;
        // A rule draws out at a hairline and only reaches full weight once
        // it is about seven times longer than it is thick.
        float w = mix(1.0, HAIR, pow(abs(s - 2.0) / 2.0, 0.8));
        float hw = min(w * (hi - lo) * 0.5 * h, max(len - gap, 0.0) * 0.07);
        // A plate that is not leading the race rules only a hairline.
        hw = mix(hw, min(hw, max(0.9, h * 0.0032)), uLift.z);
        float dv = hw - abs(qy - (lo + hi) * 0.5) * h;
        // Square off at the edge of what this plate has printed, and never
        // past the figure itself: a rule only ever runs out behind it.
        float dh = min(min(behind - gap, len - behind), min((tp.x - uLift.y) * dir, (uLift.w - tp.x) * dir));
        if (hw * uDpr > 0.6) cov = max(cov, clamp(min(dv, dh) * uDpr + 0.5, 0.0, 1.0));
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
// fibre. r = brightness, g = tooth, ba = a fine grain the ink edge picks up.
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
    // ink / tall: the share of the cell the figure itself covers across and
    // up, for spacing and for sizing it to bleed off the sheet.
    const r = { u: ox / W, v: (H - ch) / 2 / H, du: cw / W, dv: ch / H, aspect: cw / ch, ink: c.w / cw, tall: c.h / ch, ox, oy: (H - ch) / 2, cw, ch };
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

  // ?t=seconds holds a still; ?v=a,b,c starts each numeral at that pace, as if
  // it had just been thrown; ?x= places a numeral as a fraction of the track;
  // ?lift=i,e holds numeral i up off the paper.
  const override = (params.get("v") || "").split(",").map(parseFloat);
  const startX = (params.get("x") || "").split(",").map(parseFloat);
  const liftQ = (params.get("lift") || "").split(",").map(parseFloat);
  const frozen = Number.isFinite(still);

  // The register grid, as fractions of the track's cross height. At rest the
  // three plates run as one lockup on the centre line (the climb of the track
  // already steps them up the sheet), each figure tucked over the one before
  // it by a share of its own width, so red prints over blue and blue over
  // yellow on every frame, not only on a lucky one. Sizes are relative: the
  // sheet sets the scale (see onResize).
  const GRID = [-0.2, -0.1, 0, 0.1, 0.2];
  const LANES = [
    { size: 1, y: 0, lean: 0.1 },
    { size: 0.93, y: 0, lean: 0.14 },
    { size: 0.97, y: 0, lean: 0.12 },
  ];
  const TUCK = 0.34;
  // The tallest figure's ink stands this share of the sheet's height, so the
  // lockup sits on open stock with paper above and below it to set its scale
  // against. It bleeds only along the track, the way it travels.
  const BLEED = 0.78;
  // ...and the whole lockup, 5-0-8 once, never takes more than this share of
  // the track, so a narrow sheet shrinks the figures before it crops them.
  const RUN = 0.8;
  // Where the lockup comes to rest: the share of the spare stock that opens
  // up behind it, on the side its rules run into.
  const BEHIND = 0.7;
  // The lockup cruises at one shared pace, and the sheet rides along with it:
  // the lockup holds its place on the stock, and only a plate that breaks
  // away from it moves across the sheet.
  const CRUISE = reduced ? 0 : 160;
  // Left alone, the sheet throws a plate itself every so often, one after
  // another, so the race is the sheet's resting condition: one fast plate
  // ruling its pace into open stock while the other two hold the lockup.
  const IDLE = 3.2;
  const SERVE = [0, 2, 1];
  const SERVE_V = [1900, 1500, 1700];
  // Pulled out of register, a plate falls back into its slot on a critically
  // damped spring: settled in about 600ms, with no bounce.
  const OMEGA = 8;
  const MAX_V = 3200;
  // A thrown plate races on at its own pace for as long as the throw lasts.
  const energyOf = (rv) => (reduced || frozen ? 0 : clamp(Math.abs(rv) / 1200, 0, 1.8));

  const axis = [Math.cos(ANGLE), Math.sin(ANGLE)];
  const nums = LANES.map((l, i) => {
    const thrown = Number.isFinite(override[i]);
    const rv = thrown ? override[i] - CRUISE : 0;
    return {
      i,
      lane: l,
      x: 0, // where it prints, along the track
      y: 0,
      yv: 0,
      off: 0, // how far out of register: its distance from its slot in the lockup
      rv, // its pace relative to the lockup
      free: thrown ? Math.max(energyOf(rv), frozen ? 1 : 0) : 0,
      engaged: !thrown, // whether it has started falling back in
      w: thrown ? 0 : 1, // how firmly the spring holds it, eased in
      ty: l.y,
      shown: CRUISE + rv,
      trail: 0, // how far it has run on this sheet since it was picked up
      calm: 0, // 0 while it leads the race and rules at full length, 1 for a hairline
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
  let idle = 0; // seconds the sheet has sat settled with no hand on it
  let served = 0;
  let P = 1; // one lap of the run: the lockup and the open stock after it
  let S = 1; // the sheet's scale: a size-1 figure's height, css px
  const slot = [0, 0, 0];
  let placed = false;
  let stillFrames = 0;
  const height = (n) => n.lane.size * S;
  const width = (n) => height(n) * atlas.rects[n.i].aspect;
  const inkWidth = (n) => width(n) * atlas.rects[n.i].ink;
  // Real type, never stretched: pace shows in the rules, not in the figure.
  const stretchOf = () => 1;
  const leanOf = (n, v) => Math.sign(v || 1) * (n.lane.lean + clamp(Math.abs(v) / 4000, 0, 0.16));
  // Rules only print once a plate has been thrown: at cruising pace a
  // numeral is a clean figure. Past that they grow with pace.
  const tailOf = (v) => clamp((Math.abs(v) - 400) * 1.1, 0, W * 0.75);
  const toTrack = (x, y) => {
    const cx = x - W / 2;
    const cy = y - H / 2;
    return [cx * axis[0] + cy * axis[1], -cx * axis[1] + cy * axis[0]];
  };
  const unit = () => Math.min(H, TH);
  // Into [c - P/2, c + P/2). The track is a printed run one sheet long: as
  // the lockup runs off the leading edge, the next impression of it comes in
  // over the trailing one, with open stock between the two.
  const lap = (u, c = 0) => u - c - P * Math.floor((u - c + P / 2) / P) + c;

  // One step of a plate that is not in the hand.
  const advance = (n, dt, cruise) => {
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      let target = n.lane.y * unit();
      if (n.free > 0) {
        // Still carrying the throw: its own pace, barely fading, on the
        // register line nearest where it was let go.
        n.free -= h;
        n.rv *= Math.exp(-0.35 * h);
        target = n.ty * unit();
      } else {
        if (!n.engaged) {
          // Out of energy. A plate a little ahead of its slot eases back into
          // it; one a long way ahead laps and catches the lockup up from
          // behind rather than running backwards down the track.
          n.off = lap(n.off, cruise > 0 ? -0.3 * P : 0);
          n.engaged = true;
          n.w = 0;
        }
        n.w = Math.min(1, n.w + h / 0.25);
        n.rv += (-n.w * OMEGA * OMEGA * n.off - 2 * OMEGA * Math.sqrt(n.w) * n.rv) * h;
        // Easing back it never outruns its own rules: below the pace where
        // they print, it reads as a plate sliding home, not a race backwards.
        if (cruise > 0) n.rv = Math.max(n.rv, -cruise - 400);
      }
      n.rv = clamp(n.rv, -MAX_V, MAX_V);
      n.off += n.rv * h;
      n.yv += (-OMEGA * OMEGA * (n.y - target) - 2 * OMEGA * n.yv) * h;
      n.y += n.yv * h;
    }
  };
  const settled = (n) => n.free > 0 || (Math.abs(n.off) < 0.05 && Math.abs(n.rv) < 0.05 && Math.abs(n.yv) < 0.05);

  stage.onResize((w, h) => {
    W = w;
    H = h;
    TW = w * Math.abs(axis[0]) + h * Math.abs(axis[1]);
    TH = w * Math.abs(axis[1]) + h * Math.abs(axis[0]);
    paperDirty = true;
    stillFrames = 0;
    // Scale: the tallest figure stands BLEED of the sheet, unless the lockup
    // would then take more than RUN of the track; then the run wins, so
    // 5-0-8 always reads whole once with stock around it.
    const ink1 = nums.map((n) => n.lane.size * atlas.rects[n.i].aspect * atlas.rects[n.i].ink);
    const span1 = ink1[0] + (ink1[1] + ink1[2]) * (1 - TUCK);
    const tall1 = Math.max(...nums.map((n) => n.lane.size * atlas.rects[n.i].tall));
    S = Math.min((BLEED * H) / tall1, (RUN * TW) / span1);
    // The lockup: each figure overprints the one before by TUCK of its own
    // width. One lap of the run is the track, so the next impression only
    // comes in over the trailing edge as this one leaves by the leading one.
    const [a, b, c] = nums.map(inkWidth);
    const span = a + (b + c) * (1 - TUCK);
    P = Math.max(TW, span / RUN);
    slot[0] = 0;
    slot[1] = a / 2 + b * (0.5 - TUCK);
    slot[2] = slot[1] + b / 2 + c * (0.5 - TUCK);
    // At rest it sits forward on the sheet, BEHIND of the spare stock open
    // at its back for the rules to run into. Spare is measured along the
    // centre line, where the sheet is narrower than the track's full reach.
    const spare = Math.max(0, W / Math.abs(axis[0]) - span);
    const mid = (slot[0] - a / 2 + slot[2] + c / 2) / 2 - spare * (BEHIND - 0.5);
    for (let k = 0; k < 3; k++) slot[k] -= mid;
    for (const n of nums) {
      if (!placed && Number.isFinite(startX[n.i])) n.off = TW * (startX[n.i] - 0.5) - slot[n.i];
      if (!n.held) n.y = (n.free > 0 ? n.ty : n.lane.y) * unit();
    }
    if (!placed && frozen) {
      // A still: let the race run for t seconds from the start line.
      const dt = 1 / 120;
      for (let t = 0; t < still; t += dt) {
        for (const n of nums) {
          // Hold the thrown plates' energy, so the still shows them racing.
          const f = n.free;
          advance(n, dt, CRUISE);
          if (f > 0) n.free = Math.max(n.free, 1e-3);
        }
      }
      // Caught mid-race: it has been printing its rules since it came in
      // over the edge behind it.
      for (const n of nums) {
        n.shown = CRUISE + n.rv;
        n.trail = 4 * P;
      }
    }
    for (const n of nums) n.x = lap(slot[n.i] + n.off);
    placed = true;
  });

  // Hit test against the glyph itself (no bands), topmost by depth of ink.
  const hit = (sx, sy) => {
    const [px, py] = toTrack(sx, sy);
    let best = null;
    for (const n of nums) {
      const h = height(n);
      const r = atlas.rects[n.i];
      let dx = lap(px - n.x);
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
    grab = { n, dx: -lap(px - n.x), dy: n.y - py };
    n.held = true;
    n.trail = 0;
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
    // The throw sets its pace, within what a press could print. It runs on
    // that while the throw lasts, then falls back into the lockup.
    const v = clamp(p.vx * axis[0] + p.vy * axis[1], -MAX_V, MAX_V);
    n.rv = v;
    n.free = energyOf(n.rv);
    n.engaged = false;
    // Meanwhile it rides the register line nearest where it was let go.
    const q = n.y / unit();
    n.ty = GRID.reduce((a, g) => (Math.abs(g - q) < Math.abs(a - q) ? g : a), GRID[0]);
    n.yv = 0;
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
    if (frozen && !grab && !paperDirty && stillFrames++ > 3 && nums.every((n) => settled(n) && Math.abs(n.e - n.lift) < 1e-3 && Math.abs(n.ev) < 1e-3)) return;
    // A still holds the lockup where it is; only a plate you move, and its
    // fall back into register, play out.
    const cruise = frozen ? 0 : CRUISE;
    if (!frozen && !reduced) {
      const calm = !grab && nums.every((n) => n.free <= 0 && Math.abs(n.off) < 1 && Math.abs(n.rv) < 5);
      idle = calm ? idle + dt : 0;
      if (idle > IDLE) {
        const n = nums[SERVE[served % 3]];
        n.rv = SERVE_V[served % 3];
        n.free = energyOf(n.rv);
        n.engaged = false;
        n.ty = n.lane.y;
        n.trail = 0;
        served++;
        idle = 0;
      }
    }
    for (const n of nums) {
      if (n.held) {
        const [px, py] = toTrack(stage.pointer.x, stage.pointer.y);
        const lim = unit() * 0.3;
        const nx = n.x + lap(px + grab.dx - n.x) * (1 - Math.exp(-30 * dt));
        const vNow = (nx - n.x) / Math.max(dt, 1e-3);
        // Out of register by however far the hand has pulled it.
        n.off += lap(nx - (slot[n.i] + n.off));
        n.rv = damp(n.rv, vNow, 14, dt);
        n.y = damp(n.y, clamp(py + grab.dy, -lim, lim), 30, dt);
        n.yv = 0;
      } else if (!frozen || n.free <= 0) {
        advance(n, dt, cruise);
      }
      const was = n.x;
      n.x = lap(slot[n.i] + n.off);
      n.trail = Math.min(n.trail + Math.abs(lap(n.x - was)), 4 * P);
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
      if (!frozen || n.held || n.free <= 0) n.shown = damp(n.shown, CRUISE + n.rv, 9, dt);
      const i = n.i;
      const e = n.e;
      body.set([n.x, n.y, height(n), atlas.rects[i].aspect], i * 4);
      move.set([n.shown || 0.001, stretchOf(n.shown), leanOf(n, n.shown), tailOf(n.shown)], i * 4);
      lift.set([e, 0, 0, n.calm], i * 4);
    }
    // Only the fastest plate rules its pace in full; the others drop to short
    // hairlines, easing over as the lead changes hands.
    let lead = -1;
    for (let i = 0; i < 3; i++) if (move[i * 4 + 3] > 0 && (lead < 0 || move[i * 4 + 3] > move[lead * 4 + 3])) lead = i;
    for (const n of nums) {
      const target = lead >= 0 && n.i !== lead ? 1 : 0;
      n.calm = frozen && !grab ? target : damp(n.calm, target, 10, dt);
      move[n.i * 4 + 3] *= 1 - (1 - CALM_LEN) * n.calm;
      lift[n.i * 4 + 3] = n.calm;
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
      const trail = nums[i].trail;
      // The run repeats every P, so the plate prints at every period that
      // shows. Rules are what the plate has printed on this sheet since it
      // last came in over the trailing edge, so only the impression at x
      // (already lapped onto the sheet) carries them. Its copies are the same
      // plate on its way out or on its way in: they print the figure and no
      // rules, or the rules of the one leaving would run out ahead of the one
      // coming in. The rules reach back no further than where it was picked
      // up, nor past the trailing edge, nor into its own copy one period
      // behind, so a plate never prints over itself.
      const reach = TW / 2 + halfW + L + pad;
      const k0 = Math.ceil((-reach - x) / P);
      const k1 = Math.floor((reach - x) / P);
      for (let k = k0; k <= k1; k++) {
        const cx = x + k * P;
        const own = P - halfW - h * 0.05;
        const clip = k !== 0 ? cx : v > 0 ? Math.max(-TW / 2, cx - trail, cx - own) : Math.min(TW / 2, cx + trail, cx + own);
        const back = v > 0 ? clamp(cx - halfW - clip, 0, L) : 0;
        const front = v > 0 ? 0 : clamp(clip - (cx + halfW), 0, L);
        const x0 = cx - halfW - back - 4;
        const x1 = cx + halfW + front + pad;
        if (x1 < -TW / 2 || x0 > TW / 2) continue;
        gl.uniform4f(U.uBox, x0, y - h / 2 - 4, x1, y + h / 2 + pad);
        gl.uniform4f(U.uBody, cx, y, h0, asp);
        gl.uniform1i(U.uI, i);
        gl.uniform4fv(U.uRect, rect.subarray(o, o + 4));
        gl.uniform4fv(U.uMove, move.subarray(o, o + 4));
        gl.uniform4f(U.uLift, e, clip, lift[o + 3], cx);
        gl.uniform3fv(U.uInk, ink.subarray(i * 3, i * 3 + 3));
        gl.uniform1f(U.uSeed, seeds[i]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  });

  return { destroy: () => stage.destroy() };
}
