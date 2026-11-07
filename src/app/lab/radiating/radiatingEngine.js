import { createStage, clamp, damp } from "../_kit/stage";

// After Lance Wyman's Mexico 68: a heavy word whose outline is echoed outward
// in parallel lines, as wide as the gaps between them, until type and pattern
// are one field.
//
// The word is set in Geist 700 on a canvas and turned into a signed distance
// field on the CPU (Felzenszwalb's exact transform, seeded from the canvas's
// own anti-aliasing the way Mapbox's TinySDF does, so edges keep their
// sub-pixel position). The lines are its level sets, drawn in a shader with
// derivative-width anti-aliasing at device resolution.
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
uniform float uK;          // smooth-union width, css px
uniform vec4 uPulse[${MAX_PULSES}]; // xy origin, front radius, active
uniform float uFront;      // pulse front width, css px
uniform float uReveal;     // css px of field drawn so far (intro)
uniform vec3 uInk;
uniform vec3 uPaper;
out vec4 o;

float field(vec2 p){
  vec2 u = p * uGrid - 0.5;
  vec2 f = fract(u);
  ivec2 i = ivec2(floor(u));
  ivec2 m = uTexSize - 1;
  float a = texelFetch(uSdf, clamp(i, ivec2(0), m), 0).r;
  float b = texelFetch(uSdf, clamp(i + ivec2(1, 0), ivec2(0), m), 0).r;
  float c = texelFetch(uSdf, clamp(i + ivec2(0, 1), ivec2(0), m), 0).r;
  float d = texelFetch(uSdf, clamp(i + ivec2(1, 1), ivec2(0), m), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Polynomial smooth minimum (Quilez): the crease between the two sources is
// rounded over a band uK wide instead of meeting at a sharp mitre.
float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
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

function edt(grid, w, h, f, v, z) {
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

function layout(w, h) {
  // The word fills a little over half the box, centred on its x-height.
  const font = Math.min((w * 0.62) / 2.25, h * 0.46);
  const period = Math.max(6, Math.round(font * 0.074));
  return { font, period };
}

function buildField(w, h, grid, family) {
  const W = Math.max(2, Math.round(w * grid));
  const H = Math.max(2, Math.round(h * grid));
  const { font } = layout(w, h);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const px = font * grid;
  ctx.font = `700 ${px}px ${family}`;
  ctx.fontKerning = "normal";
  // Tracking law: -0.043 x (size - 12) px, written per css px of type.
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.043 * (font - 12) * grid}px`;
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(WORD);
  const left = m.actualBoundingBoxLeft;
  const tw = m.actualBoundingBoxRight + left;
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  const x = (W - tw) / 2 + left;
  const y = H / 2 + (asc - desc) / 2;
  ctx.fillStyle = "#000";
  ctx.fillText(WORD, x, y);
  const img = ctx.getImageData(0, 0, W, H).data;

  const n = W * H;
  const outer = new Float32Array(n);
  const inner = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = img[i * 4 + 3] / 255;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const o = Math.max(0, 0.5 - a);
      const ii = Math.max(0, a - 0.5);
      outer[i] = o * o;
      inner[i] = ii * ii;
    }
  }
  const len = Math.max(W, H);
  const f = new Float32Array(len);
  const v = new Uint16Array(len);
  const z = new Float32Array(len + 1);
  edt(outer, W, H, f, v, z);
  edt(inner, W, H, f, v, z);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / grid;
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
  for (const name of ["uSdf", "uTexSize", "uGrid", "uRes", "uDpr", "uP", "uDot", "uK", "uPulse", "uFront", "uReveal", "uInk", "uPaper"]) U[name] = gl.getUniformLocation(prog, name);

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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sdf.W, sdf.H, 0, gl.RED, gl.FLOAT, sdf.data);
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
