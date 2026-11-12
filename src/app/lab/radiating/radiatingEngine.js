import { createStage, clamp, damp } from "../_kit/stage";

// After Lance Wyman's Mexico 68: a heavy word whose outline is echoed outward
// in parallel lines, as wide as the gaps between them, until type and pattern
// are one field.
//
// The word is set in Geist 700, glyph by glyph with every gap between letters
// exactly two line periods, and each glyph is turned into a signed distance
// field on the CPU (Felzenszwalb's exact transform, seeded from the canvas's
// own anti-aliasing the way Mapbox's TinySDF does, so edges keep their
// sub-pixel position). The lines are level sets of the glyph fields'
// smooth union, drawn in a shader with derivative-width anti-aliasing at
// device resolution.
//
// The pointer is a second source: a dot whose own distance field is smoothly
// unioned with the word's, so its rings and the letters' rings meet in one
// continuous crease. A press sends a pulse outward: a front that carries every
// line exactly one period on as it passes, so the field it leaves behind is
// the one it found.
//
// ?x=&y= (0..1 of the box) hold the dot; ?t= (0..1) holds a pulse from it.

const WORD = "echo";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const INK = [0x14 / 255, 0x13 / 255, 0x12 / 255];
const MAX_PULSES = 4;
const PULSE_MS = 2600;

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform highp sampler2D uSdf;
uniform ivec2 uTexSize;
uniform float uGrid;       // field texels per css px
uniform vec2 uRes;         // device px
uniform float uDpr;
uniform float uP;          // line period, css px (line = gap = P/2)
uniform vec3 uDot;         // xy css px, radius
uniform float uK;          // smooth-union width with the dot, css px
uniform float uKg;         // smooth-union width between letters, css px
uniform vec4 uPulse[${MAX_PULSES}]; // xy origin, front radius, active
uniform float uFront;      // pulse front width, css px
uniform float uReveal;     // css px of field drawn so far (intro)
uniform vec3 uInk;
uniform vec3 uPaper;
out vec4 o;

// Polynomial smooth minimum (Quilez): a crease between two sources is
// rounded over a band k wide instead of meeting at a sharp mitre.
float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// One glyph per channel, bilinear by hand (float textures are not filterable
// everywhere), then smoothly unioned. Letters sit two periods apart, wider
// than uKg, so the union never moves a letter's own edge.
float field(vec2 p){
  vec2 u = p * uGrid - 0.5;
  vec2 f = fract(u);
  ivec2 i = ivec2(floor(u));
  ivec2 m = uTexSize - 1;
  vec4 a = texelFetch(uSdf, clamp(i, ivec2(0), m), 0);
  vec4 b = texelFetch(uSdf, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 c = texelFetch(uSdf, clamp(i + ivec2(0, 1), ivec2(0), m), 0);
  vec4 d = texelFetch(uSdf, clamp(i + ivec2(1, 1), ivec2(0), m), 0);
  vec4 g = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return smin(smin(smin(g.x, g.y, uKg), g.z, uKg), g.w, uKg);
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float d = field(p);
  float dc = length(p - uDot.xy) - uDot.z;
  float f = smin(d, dc, uK);

  // Pulses: behind each front the field is shifted by one whole period, so
  // the rings it passes move one line outward and land where they began.
  float g = f;
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    vec4 q = uPulse[i];
    if (q.w < 0.5) continue;
    float s = smoothstep(0.0, 1.0, (q.z - length(p - q.xy)) / uFront);
    g -= uP * s;
  }

  float fw = max(fwidth(g), 1e-4);
  float fe = max(fwidth(f), 1e-4);
  float ink;
  if (f <= 0.0) {
    ink = 1.0;
  } else {
    // Ring n occupies g in [nP + P/2, nP + P); during the intro each ring
    // swells to full width in turn as the reveal passes it.
    float n = floor(g / uP);
    float grow = clamp((uReveal - n * uP) / (uP * 2.5), 0.0, 1.0);
    grow = 1.0 - pow(1.0 - grow, 3.0);
    float half_ = uP * 0.25 * grow;
    float dist = abs(g - (n + 0.75) * uP);
    // Box-filtered coverage; a line thinner than a pixel covers only its own
    // width, so an unborn ring is nothing rather than a grey hairline.
    ink = min(clamp((half_ - dist) / fw + 0.5, 0.0, 1.0), 2.0 * half_ / fw);
    // A line the pulse brings in is born half a period off the letter, so the
    // letters never swell as the front passes them.
    if (n < 0.0) ink *= clamp((f - uP * 0.5) / fe + 0.5, 0.0, 1.0);
  }
  // Letter edge, anti-aliased on the unshifted field.
  ink = max(ink, clamp(0.5 - f / fe, 0.0, 1.0));
  o = vec4(mix(uPaper, uInk, ink), 1.0);
}`;

// ---- signed distance field (after mapbox/tiny-sdf) ----

const INF = 1e20;

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt(grid, w, h, f, v, z, x0 = 0, x1 = w) {
  // Columns outside [x0, x1) hold no seed, so their vertical pass would leave
  // them untouched; skip it.
  for (let x = x0; x < x1; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

// Three box passes each way, a near-Gaussian of sigma ~ r, edges clamped.
function boxPass(src, dst, count, stride, lines, lineStride, r) {
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStride;
    const last = o + (count - 1) * stride;
    let acc = src[o] * (r + 1);
    for (let j = 1; j <= r; j++) acc += src[o + Math.min(j, count - 1) * stride];
    for (let j = 0; j < count; j++) {
      dst[o + j * stride] = acc * inv;
      const add = j + r + 1 < count ? o + (j + r + 1) * stride : last;
      const sub = j - r >= 0 ? o + (j - r) * stride : o;
      acc += src[add] - src[sub];
    }
  }
}

function blur(a, tmp, w, h, r) {
  for (let p = 0; p < 3; p++) {
    boxPass(a, tmp, w, 1, h, w, r);
    boxPass(tmp, a, h, w, w, 1, r);
  }
}

function layout(w, h) {
  // The word fills a little over half the box, centred on its x-height.
  const font = Math.min((w * 0.62) / 2.6, h * 0.46);
  const period = Math.max(6, Math.round(font * 0.074));
  return { font, period };
}

// One glyph's ink, drawn alone, as left and right edge profiles per row
// (sub-pixel, TinySDF's convention: a pixel of coverage a puts the edge
// 1 - a in from its outer side), relative to the glyph's pen origin.
function profile(ctx, ch) {
  ctx.font = ctx.canvas.dataset.font;
  const m = ctx.measureText(ch);
  const left = Math.ceil(m.actualBoundingBoxLeft) + 2;
  const asc = Math.ceil(m.actualBoundingBoxAscent) + 2;
  const gw = left + Math.ceil(m.actualBoundingBoxRight) + 2;
  const gh = asc + Math.ceil(m.actualBoundingBoxDescent) + 2;
  ctx.canvas.width = Math.max(gw, ctx.canvas.width);
  ctx.canvas.height = Math.max(gh, ctx.canvas.height);
  ctx.font = ctx.canvas.dataset.font;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillText(ch, left, asc);
  const img = ctx.getImageData(0, 0, gw, gh).data;
  const rows = [];
  for (let y = 0; y < gh; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < gw; x++) {
      if (img[(y * gw + x) * 4 + 3] > 0) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l < 0) continue;
    const al = img[(y * gw + l) * 4 + 3] / 255;
    const ar = img[(y * gw + r) * 4 + 3] / 255;
    rows.push({ y: y - asc, l: l + 1 - al - left, r: r + ar - left });
  }
  return { rows, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}

// Nearest-ink distance between glyph a and glyph b set `off` to its right.
// Exact while every row of b lies right of every row of a it is nearest to,
// which holds for any pair that is not kerned into each other.
function gapAt(a, b, off) {
  let best = Infinity;
  for (const ra of a.rows) {
    for (const rb of b.rows) {
      const dx = Math.max(0, rb.l + off - ra.r);
      const dy = rb.y - ra.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function buildField(w, h, grid, family) {
  const W = Math.max(2, Math.round(w * grid));
  const H = Math.max(2, Math.round(h * grid));
  const { font, period } = layout(w, h);
  const px = font * grid;
  const fontCss = `700 ${px}px ${family}`;

  // Glyph by glyph, no tracking: this is a distance field, not running text.
  // Each neighbour is moved until the nearest ink of the pair is exactly two
  // periods apart, so the gap holds a white ring, the two letters' first
  // black rings meeting in one crease, and a white ring.
  const mc = document.createElement("canvas");
  mc.dataset.font = fontCss;
  const mctx = mc.getContext("2d", { willReadFrequently: true });
  const glyphs = [...WORD].map((ch) => ({ ch, ...profile(mctx, ch) }));
  const target = 2 * period * grid;
  const pens = [0];
  for (let i = 1; i < glyphs.length; i++) {
    const a = glyphs[i - 1];
    const b = glyphs[i];
    const aR = Math.max(...a.rows.map((r) => r.r));
    const bL = Math.min(...b.rows.map((r) => r.l));
    // Bracket: lo has the bounding boxes touching (gap <= target), hi
    // separates them by the whole target (gap >= target).
    let lo = aR - bL - target;
    let hi = aR - bL + target;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (gapAt(a, b, mid) < target) lo = mid;
      else hi = mid;
    }
    pens.push(pens[i - 1] + (lo + hi) / 2);
  }
  const inkL = glyphs[0].rows.reduce((m, r) => Math.min(m, r.l), Infinity);
  const last = glyphs.length - 1;
  const inkR = pens[last] + glyphs[last].rows.reduce((m, r) => Math.max(m, r.r), -Infinity);
  const asc = Math.max(...glyphs.map((g) => g.asc));
  const desc = Math.max(...glyphs.map((g) => g.desc));
  const x0 = (W - (inkR - inkL)) / 2 - inkL;
  const y0 = H / 2 + (asc - desc) / 2;

  // One exact distance field per glyph, packed one glyph per channel; the
  // shader joins them with a smooth minimum so the creases between letters
  // are rounded instead of the faceted medial axis of a single hard-min EDT.
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.font = fontCss;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";

  const n = W * H;
  const out = new Float32Array(n * 4).fill(1e5);
  const outer = new Float32Array(n);
  const len = Math.max(W, H);
  const f = new Float32Array(len);
  const v = new Uint16Array(len);
  const z = new Float32Array(len + 1);
  const soft = new Float32Array(n);
  const tmp = new Float32Array(n);
  const blurR = Math.max(1, Math.round(period * grid * 0.45));
  glyphs.forEach((g, gi) => {
    const ch = gi % 4;
    ctx.clearRect(0, 0, W, H);
    const gx = x0 + pens[gi];
    ctx.fillText(g.ch, gx, y0);
    const bx0 = Math.max(0, Math.floor(gx + Math.min(...g.rows.map((r) => r.l))) - 2);
    const bx1 = Math.min(W, Math.ceil(gx + Math.max(...g.rows.map((r) => r.r))) + 3);
    const by0 = Math.max(0, Math.floor(y0 - g.asc) - 2);
    const by1 = Math.min(H, Math.ceil(y0 + g.desc) + 3);
    const img = ctx.getImageData(0, 0, W, H).data;
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    const inner = new Float32Array(bw * bh);
    outer.fill(INF);
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const i = y * W + x;
        const j = (y - by0) * bw + (x - bx0);
        const a = img[i * 4 + 3] / 255;
        if (a >= 1) {
          outer[i] = 0;
          inner[j] = INF;
        } else if (a <= 0) {
          inner[j] = 0;
        } else {
          const o = Math.max(0, 0.5 - a);
          const ii = Math.max(0, a - 0.5);
          outer[i] = o * o;
          inner[j] = ii * ii;
        }
      }
    }
    edt(outer, W, H, f, v, z, bx0, bx1);
    edt(inner, bw, bh, f, v, z);
    for (let i = 0; i < n; i++) {
      const y = (i / W) | 0;
      const x = i - y * W;
      let d = Math.sqrt(outer[i]);
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) d -= Math.sqrt(inner[(y - by0) * bw + (x - bx0)]);
      outer[i] = d / grid;
    }
    // A glyph's own creases (an aperture closing, a counter's spine) are
    // sharp ridges in its field, and a ring crossing one tapers to a needle.
    // Away from the letter, the rings follow a blurred copy of the field, so
    // ridges round off; at the letter the exact field holds the edge.
    soft.set(outer);
    blur(soft, tmp, W, H, blurR);
    for (let i = 0; i < n; i++) {
      const d = outer[i];
      const t = clamp((d - period * 0.25) / period, 0, 1);
      const k = i * 4 + ch;
      out[k] = Math.min(out[k], d + (soft[i] - d) * t * t * (3 - 2 * t));
    }
  });
  return { data: out, W, H };
}

async function loadFamily() {
  const family = "RadiatingGeist";
  try {
    if (![...document.fonts].some((ff) => ff.family === family)) {
      const face = new FontFace(family, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
      await face.load();
      document.fonts.add(face);
    }
    await document.fonts.load(`700 100px ${family}`);
    return family;
  } catch {
    return "sans-serif";
  }
}

const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export async function createRadiating(host, { embedded = false } = {}) {
  const family = await loadFamily();
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const params = new URLSearchParams(embedded ? "" : window.location.search);
  const hold = {
    x: params.has("x") ? clamp(+params.get("x"), 0, 1) : null,
    y: params.has("y") ? clamp(+params.get("y"), 0, 1) : null,
    t: params.has("t") ? clamp(+params.get("t"), 0, 1) : null,
  };
  const held = hold.x != null || hold.t != null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const name of ["uSdf", "uTexSize", "uGrid", "uRes", "uDpr", "uP", "uDot", "uK", "uKg", "uPulse", "uFront", "uReveal", "uInk", "uPaper"]) U[name] = gl.getUniformLocation(prog, name);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let sdf = null;
  let grid = 1;
  let period = 12;
  let w = 1;
  let h = 1;

  // The dot: position follows the pointer on an ease-out; presence (0..1)
  // grows its field out of nothing and lets it sink back when the hand goes.
  const dot = { x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: 0, placed: false };
  const pulses = [];
  let revealStart = -1;
  let dirty = true;

  const rebuild = () => {
    w = stage.width;
    h = stage.height;
    grid = Math.min(2, Math.sqrt(2.6e6 / (w * h)));
    ({ period } = layout(w, h));
    sdf = buildField(w, h, grid, family);
    // The intro starts once there is a field to show, under the canvas fade.
    if (revealStart < 0) revealStart = performance.now() + 120;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sdf.W, sdf.H, 0, gl.RGBA, gl.FLOAT, sdf.data);
    if (held) {
      dot.x = dot.tx = (hold.x ?? 0.72) * w;
      dot.y = dot.ty = (hold.y ?? 0.7) * h;
      dot.a = dot.ta = 1;
      dot.placed = true;
    }
    dirty = true;
  };
  stage.onResize(rebuild);

  stage.on("move", (pt) => {
    dot.tx = pt.x;
    dot.ty = pt.y;
    dot.ta = 1;
    if (!dot.placed || dot.a < 0.02) {
      dot.x = pt.x;
      dot.y = pt.y;
      dot.placed = true;
    }
  });
  stage.on("down", (pt) => {
    dot.tx = pt.x;
    dot.ty = pt.y;
    dot.ta = 1;
    if (!dot.placed || dot.a < 0.02) {
      dot.x = pt.x;
      dot.y = pt.y;
      dot.placed = true;
    }
    if (pulses.length >= MAX_PULSES) pulses.shift();
    pulses.push({ x: pt.x, y: pt.y, t0: performance.now() });
  });
  stage.on("up", (pt, e) => {
    if (e.pointerType !== "mouse") dot.ta = 0;
  });

  const pulseData = new Float32Array(MAX_PULSES * 4);

  stage.onFrame((dt) => {
    if (!sdf || stage.width !== w || stage.height !== h) return;
    const now = performance.now();
    const diag = Math.hypot(w, h);
    const front = period * 2.5;

    if (!held) {
      if (!stage.pointer.inside && !stage.pointer.down) dot.ta = 0;
      const px = dot.x;
      const py = dot.y;
      const pa = dot.a;
      dot.x = damp(dot.x, dot.tx, 14, dt);
      dot.y = damp(dot.y, dot.ty, 14, dt);
      dot.a = damp(dot.a, dot.ta, dot.ta > dot.a ? 5 : 3.2, dt);
      if (Math.abs(dot.a - dot.ta) < 1e-4) dot.a = dot.ta;
      if (Math.abs(px - dot.x) + Math.abs(py - dot.y) + Math.abs(pa - dot.a) > 1e-3) dirty = true;
    }

    pulseData.fill(0);
    if (held && hold.t != null) {
      const R = (diag + front) * easeOut(hold.t);
      pulseData.set([dot.x, dot.y, R, 1], 0);
    } else {
      for (let i = pulses.length - 1; i >= 0; i--) if (now - pulses[i].t0 > PULSE_MS) pulses.splice(i, 1);
      pulses.forEach((q, i) => {
        // The front leaves fast and slows as it spreads: ease-out, no return.
        const reach = Math.max(Math.hypot(q.x, q.y), Math.hypot(w - q.x, q.y), Math.hypot(q.x, h - q.y), Math.hypot(w - q.x, h - q.y)) + front;
        const e = 1 - Math.pow(1 - (now - q.t0) / PULSE_MS, 2.4);
        pulseData.set([q.x, q.y, reach * e, 1], i * 4);
      });
      if (pulses.length) dirty = true;
    }

    // Intro: the rings swell out of the word one after another.
    const introMs = 1900;
    const it = held ? 1 : clamp((now - revealStart) / introMs, 0, 1);
    const reveal = it >= 1 ? 1e6 : (diag * 0.75) * (1 - Math.pow(1 - it, 2.2));
    if (it < 1) dirty = true;
    else if (revealStart > 0) {
      revealStart = 0;
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;

    // Presence: far away, the dot's field is pushed past everything, so it
    // grows outward from the dot as presence rises.
    const dotR = period * 0.55;
    const push = (1 - dot.a) * (diag + period * 4);

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uSdf, 0);
    gl.uniform2i(U.uTexSize, sdf.W, sdf.H);
    gl.uniform1f(U.uGrid, grid);
    gl.uniform2f(U.uRes, stage.canvas.width, stage.canvas.height);
    gl.uniform1f(U.uDpr, stage.canvas.width / w);
    gl.uniform1f(U.uP, period);
    gl.uniform3f(U.uDot, dot.x, dot.y, dotR - push);
    gl.uniform1f(U.uK, period * 2.2);
    gl.uniform1f(U.uKg, period);
    gl.uniform4fv(U.uPulse, pulseData);
    gl.uniform1f(U.uFront, front);
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform3fv(U.uInk, INK);
    gl.uniform3fv(U.uPaper, PAPER);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return {
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      stage.destroy();
    },
  };
}
