import { createStage, clamp, damp } from "../_kit/stage";
import { GLYPHS, ADVANCE } from "./radiateGlyphs";

// After Lance Wyman's Mexico 68 logotype: a heavy word whose outline is
// echoed outward in evenly spaced parallel lines.
//
// The lines are true offset curves. Pass 1 computes the exact signed
// distance from every device pixel to the glyph outlines (the baked
// quadratics themselves, solved analytically, not a raster), taking the
// union of the letters so their echoes meet in clean creases. Pass 2 draws
// the lines as level sets of that field, box-filtered analytically against
// each pixel's footprint, so they stay exact at any density and grey out
// instead of aliasing where they crowd.
//
// The field runs wall to wall: the word sits inside its own echoes out to
// every edge of the frame. The pointer is a magnet that changes the line
// period: inside its bell new offset curves open between the old ones, up
// to three to a period. Around it the field is laid over a copy of
// itself, scaled a few percent about the hand; both gratings are offset
// curves of the same letters, so they run near-parallel and their
// difference beats into broad moire contours that follow the letterforms
// and swim as the hand moves. A click sends a dense band out through the
// lines.

const DIST_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const DIST_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSegs;     // 2 texels per segment: (p0, c) (p1, kind, -)
uniform ivec2 uRange[8];           // per glyph: first segment, count
uniform int uGlyphs;
uniform vec2 uOrigin;              // css px of the word's em origin
uniform float uFont;               // css px per em
uniform float uDpr;
uniform float uH;                  // canvas height in device px
out vec4 o;

float dot2(vec2 v){ return dot(v, v); }

float sdLine(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  if (dot(ba, ba) < 1e-12) return dot2(pa);
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return dot2(pa - ba * h);
}

// Squared distance to a quadratic Bezier (after Inigo Quilez), each root
// polished with a Newton step so it holds up far from the curve.
vec2 bez(vec2 A, vec2 B, vec2 C, float t){ return mix(mix(A, B, t), mix(B, C, t), t); }
float polish(vec2 p, vec2 A, vec2 B, vec2 C, float t){
  vec2 d1 = 2.0 * (B - A), d2 = 2.0 * (A - 2.0 * B + C);
  vec2 q = bez(A, B, C, t) - p;
  vec2 dq = d1 + d2 * t;
  float f = dot(q, dq), df = dot(dq, dq) + dot(q, d2);
  if (abs(df) > 1e-12) t = clamp(t - f / df, 0.0, 1.0);
  return dot2(bez(A, B, C, t) - p);
}
float sdQuad(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return polish(pos, A, B, C, t);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v), n = sin(v) * 1.732050808;
  vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
  return min(polish(pos, A, B, C, t.x), polish(pos, A, B, C, t.y));
}

// Nonzero winding: every segment is monotonic in y, so a horizontal ray
// crosses it at most once.
int crossing(vec2 p, vec2 A, vec2 B, vec2 C, bool line){
  int dir = 0;
  if (A.y <= p.y && p.y < C.y) dir = 1;
  else if (C.y <= p.y && p.y < A.y) dir = -1;
  if (dir == 0) return 0;
  float t;
  float qa = A.y - 2.0 * B.y + C.y, qb = 2.0 * (B.y - A.y), qc = A.y - p.y;
  if (line || abs(qa) < 1e-9) t = -qc / qb;
  else {
    float disc = sqrt(max(qb * qb - 4.0 * qa * qc, 0.0));
    float r = -0.5 * (qb + (qb >= 0.0 ? disc : -disc));
    float t1 = r / qa, t2 = abs(r) > 1e-12 ? qc / r : t1;
    t = abs(t1 - 0.5) < abs(t2 - 0.5) ? t1 : t2;
  }
  t = clamp(t, 0.0, 1.0);
  float x = bez(A, B, C, t).x;
  return x > p.x ? dir : 0;
}

void main(){
  // Texel rows run with css y (row 0 at the top), so the draw pass can
  // fetch at css * dpr directly.
  vec2 css = gl_FragCoord.xy / uDpr;
  vec2 p = (css - uOrigin) / uFont;
  float best = 1e9;
  for (int g = 0; g < 8; g++) {
    if (g >= uGlyphs) break;
    int first = uRange[g].x, count = uRange[g].y;
    float d2 = 1e9;
    int wind = 0;
    for (int i = 0; i < 256; i++) {
      if (i >= count) break;
      int s = first + i;
      vec4 t0 = texelFetch(uSegs, ivec2(s * 2, 0), 0);
      vec4 t1 = texelFetch(uSegs, ivec2(s * 2 + 1, 0), 0);
      vec2 A = t0.xy, B = t0.zw, C = t1.xy;
      bool line = t1.z < 0.5 || dot2(A - 2.0 * B + C) < 1e-10;
      d2 = min(d2, line ? sdLine(p, A, C) : sdQuad(p, A, B, C));
      wind += crossing(p, A, B, C, line);
    }
    float sd = sqrt(d2) * (wind != 0 ? -1.0 : 1.0);
    best = min(best, sd);
  }
  o = vec4(best * uFont, 0.0, 0.0, 1.0);   // signed distance in css px
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uDist;
uniform vec2 uRes;        // css px
uniform float uDpr;
uniform float uH;
uniform float uP;         // line period at rest, css px
uniform float uN;         // rings in the field: enough to reach every edge
uniform vec3 uMag;        // magnet x, y (css px), strength
uniform float uSigma;
uniform float uM;         // how many extra lines per period the magnet packs in
uniform float uScale;     // the echo's scale around the hand at full pull
uniform float uSpread;    // the moire bell's width over the magnet's
uniform vec4 uPulse[4];   // radius, amplitude, -, -
out vec4 o;

float field(vec2 css){
  vec2 f = css * uDpr - 0.5;
  vec2 size = vec2(textureSize(uDist, 0));
  f = clamp(f, vec2(0.0), size - 1.001);
  ivec2 i = ivec2(floor(f));
  vec2 u = f - vec2(i);
  float a = texelFetch(uDist, i, 0).r, b = texelFetch(uDist, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uDist, i + ivec2(0, 1), 0).r, d = texelFetch(uDist, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Integral of ink along x (in periods): solid below 0, then gap and line,
// the line taking 'duty' of each period. Differencing it across the pixel
// is an exact box filter.
float ink(float x, float duty){
  if (x < 0.0) return x;
  float xc = min(x, uN);
  return floor(xc) * duty + max(0.0, fract(xc) - (1.0 - duty));
}
// erf to about 1e-4 (Winitzki), plenty for a phase.
float erf(float x){
  float x2 = x * x;
  float a = 0.147;
  return sign(x) * sqrt(1.0 - exp(-x2 * (1.27324 + a * x2) / (1.0 + a * x2)));
}
float cover(float x, float duty){
  float h = max(length(vec2(dFdx(x), dFdy(x))), 1e-4);
  return clamp((ink(x + h * 0.5, duty) - ink(x - h * 0.5, duty)) / h, 0.0, 1.0);
}

// The same box filter on an endless grating at half duty, for the echo,
// whose lines run on through the inside of its letters.
float inkOpen(float x){ return floor(x) * 0.5 + max(0.0, fract(x) - 0.5); }
float coverOpen(float x){
  float h = max(length(vec2(dFdx(x), dFdy(x))), 1e-4);
  return clamp((inkOpen(x + h * 0.5) - inkOpen(x - h * 0.5)) / h, 0.0, 1.0);
}

// The magnet changes the period, not the distance. It is a Gaussian
// bell on the pointer, split into its run along the field's normal
// (u = d - dm, dm the distance under the pointer) and across it (t), and
// the line density along the normal is raised to 1 + m·bell. Integrating
// that along u gives the phase:
//   F = d + m·exp(-t²/σ²)·σ·(√π/2)·(erf(u/σ) + erf(dm/σ))
// F(0) = 0, so the letters never move; dF/dd >= 1, so no line folds or
// runs back into them; and inside the bell up to m new lines open
// between every pair, so the period drops to a half, a third.
float phase(float d, float dm, vec2 v, float m){
  float u = max(d, 0.0) - dm;
  float t2 = max(dot(v, v) - u * u, 0.0);
  return d + m * exp(-t2 / (uSigma * uSigma)) * uSigma * 0.886227 * (erf(u / uSigma) + erf(dm / uSigma));
}
// Click waves: a band travelling out along the distance. Its phase term
// A·w·z·exp(-z²) adds no net lines, so the field behind it is untouched,
// but it packs the band 1 + A times denser and stretches its flanks
// into fat crests.
float pulse(float d, vec4 q){
  float w = uP * 2.4;
  float z = (d - q.x) / w;
  return q.y * w * z * exp(-z * z);
}

void main(){
  vec2 css = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) / uDpr;
  float d = field(css);


  vec2 v = css - uMag.xy;
  float m = uMag.z * uM;
  float dm = max(field(uMag.xy), 0.0);
  float F = phase(d, dm, v, m);

  // The echo: the type's own field again, scaled up around the hand,
  //   d2 = s·field(mag + (css - mag)/s),
  // so its lines are offset curves of the same letters, a touch larger,
  // centred on the pointer. It takes the same pull, so the two gratings
  // run near-parallel everywhere and only drift apart slowly, by about
  // (s - 1) lines for every line of distance from the hand. Where they
  // agree their difference is white, where they sit half a period apart
  // it closes to black: broad moire contours that follow the letterforms
  // and swim as the hand moves. Inside the echo's own letters the lines
  // carry on inward, so it shows only through the fringes.
  float s = 1.0 + (uScale - 1.0) * uMag.z;
  float d2 = s * field(uMag.xy + v / s);
  float F2 = phase(d2, dm * s, v, m);

  // Click waves run through both, so the fringes ride the band.
  for (int k = 0; k < 4; k++) {
    vec4 q = uPulse[k];
    if (q.y <= 0.0) continue;
    F += pulse(d, q);
    F2 += pulse(d2, q);
  }

  float cov = cover(d > 0.0 ? F / uP : d / uP, 0.5);
  float cov2 = coverOpen(F2 / uP);

  // Difference of the two (XOR on hard ink), held to a wide bell on the
  // hand by fading the result, never the lines. The letters stay solid.
  float moire = cov + cov2 - 2.0 * cov * cov2;
  float wide = exp(-dot(v, v) / (uSigma * uSigma * uSpread * uSpread));
  float w = smoothstep(0.03, 0.55, wide) * clamp(uMag.z * 1.6, 0.0, 1.0);
  // Right at the letters, and through their counters, the two gratings
  // cross instead of running together, so the first few echoes stay plain
  // and the word keeps its own clean outline.
  w *= smoothstep(uP * 1.0, uP * 4.0, d);
  float letter = clamp(0.5 - d * uDpr, 0.0, 1.0);
  float paper = 1.0 - max(mix(cov, moire, w), letter);
  o = vec4(vec3(paper), 1.0);
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

// The word's ink box in em, before tracking.
function bounds(track) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  GLYPHS.forEach((g, i) => {
    for (let k = 0; k < g.segs.length; k += 7) {
      for (let j = 0; j < 6; j += 2) {
        const x = g.segs[k + j] + g.x + i * track;
        const y = g.segs[k + j + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  });
  return { x0, y0, x1, y1 };
}

export async function createRadiate(host) {
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no float render targets");

  const distProg = program(gl, DIST_VS, DIST_FS);
  const drawProg = program(gl, DIST_VS, DRAW_FS);
  const uD = uniforms(gl, distProg, ["uSegs", "uGlyphs", "uOrigin", "uFont", "uDpr", "uH"]);
  const uRange = gl.getUniformLocation(distProg, "uRange");
  const uR = uniforms(gl, drawProg, ["uDist", "uRes", "uDpr", "uH", "uP", "uN", "uMag", "uSigma", "uM", "uScale", "uSpread"]);
  const uPulse = gl.getUniformLocation(drawProg, "uPulse");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const floatTex = (w, h, data, fmt = gl.R32F, ch = gl.RED) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, ch, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // The magnet packs up to MAG_M + 1 lines into each period. Its echo of
  // the field is ECHO times the size around the hand, so the two gratings
  // beat about once every 1 / (ECHO - 1) lines of distance from it, over
  // a bell SPREAD times the magnet's width.
  const MAG_M = 2;
  const ECHO = 1.045;
  const SPREAD = 1.5;

  let segTex = null;
  let distTex = null;
  let fbo = null;
  let built = 0;
  const L = { font: 200, period: 10, rings: 12, sigma: 160, reach: 1000, cx: 0, cy: 0 };

  const build = (W, H) => {
    // Type: tracking from the law, written in em at this size.
    const font = Math.max(64, Math.min((W * 0.4) / ADVANCE, H * 0.3));
    const track = (-0.043 * (font - 12)) / font;
    const b = bounds(track);
    const origin = [W / 2 - ((b.x0 + b.x1) / 2) * font, H / 2 - ((b.y0 + b.y1) / 2) * font];
    L.font = font;
    // Lines a little finer than the stems, as in Wyman's logotype.
    L.period = Math.max(6, Math.round(font * 0.06));
    L.sigma = Math.min(W, H) * 0.24;
    L.reach = Math.hypot(W, H);
    // The whole frame is the field: enough rings to reach the far corner,
    // even where the magnet packs them MAG_M + 1 times as dense.
    L.rings = Math.ceil((L.reach * (1 + MAG_M)) / L.period) + 4;
    L.cx = W / 2;
    L.cy = H / 2;

    // Segments, tracked into place.
    const n = GLYPHS.reduce((a, g) => a + g.segs.length / 7, 0);
    const data = new Float32Array(n * 8);
    const ranges = new Int32Array(16);
    let s = 0;
    GLYPHS.forEach((g, i) => {
      const dx = g.x + i * track;
      ranges[i * 2] = s;
      ranges[i * 2 + 1] = g.segs.length / 7;
      for (let k = 0; k < g.segs.length; k += 7, s++) {
        const o = s * 8;
        data[o] = g.segs[k] + dx;
        data[o + 1] = g.segs[k + 1];
        data[o + 2] = g.segs[k + 2] + dx;
        data[o + 3] = g.segs[k + 3];
        data[o + 4] = g.segs[k + 4] + dx;
        data[o + 5] = g.segs[k + 5];
        data[o + 6] = g.segs[k + 6];
      }
    });
    if (segTex) gl.deleteTexture(segTex);
    segTex = floatTex(n * 2, 1, data, gl.RGBA32F, gl.RGBA);

    const cw = stage.canvas.width;
    const ch = stage.canvas.height;
    if (distTex) gl.deleteTexture(distTex);
    if (fbo) gl.deleteFramebuffer(fbo);
    distTex = floatTex(cw, ch, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, distTex, 0);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(distProg);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, segTex);
    gl.uniform1i(uD.uSegs, 0);
    gl.uniform2iv(uRange, ranges);
    gl.uniform1i(uD.uGlyphs, GLYPHS.length);
    gl.uniform2f(uD.uOrigin, origin[0], origin[1]);
    gl.uniform1f(uD.uFont, font);
    gl.uniform1f(uD.uDpr, stage.dpr);
    gl.uniform1f(uD.uH, ch);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    built++;
  };
  stage.onResize((w, h) => build(w, h));

  // Still frames for review: ?mx=&my= hold the magnet (fractions of the
  // box), ?k= its strength, ?t= a click wave's progress.
  const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const hold = q.has("mx") ? { x: +q.get("mx"), y: +(q.get("my") ?? 0.5), k: +(q.get("k") ?? 1) } : null;
  const holdT = q.has("t") ? clamp(+q.get("t"), 0, 1) : null;

  // The magnet: a spring on the pointer, its pull easing in and out.
  const mag = { x: 0, y: 0, vx: 0, vy: 0, k: 0, placed: false };
  const PULL = 0.9;
  const pulses = [];
  const WAVE_S = 4;
  // At its peak a wave packs the band WAVE_A + 1 times as dense.
  const WAVE_A = 1.6;
  stage.on("down", (p) => {
    if (pulses.length >= 4) pulses.shift();
    pulses.push({ age: 0 });
    if (!mag.placed) Object.assign(mag, { x: p.x, y: p.y, placed: true });
  });

  let wander = 0;
  let lastKey = "";
  const pulseData = new Float32Array(16);

  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    const p = stage.pointer;
    let tx;
    let ty;
    let tk;
    if (hold) {
      tx = hold.x * W;
      ty = hold.y * H;
      tk = hold.k;
      Object.assign(mag, { x: tx, y: ty, k: tk, vx: 0, vy: 0 });
    } else if (p.inside && stage.idleFor() < 5000) {
      tx = p.x;
      ty = p.y;
      tk = PULL;
      if (!mag.placed) Object.assign(mag, { x: tx, y: ty, placed: true });
    } else {
      // Left alone, the magnet drifts slowly around the word.
      wander += dt * 0.11;
      tx = L.cx + Math.cos(wander * Math.PI * 2) * W * 0.3;
      ty = L.cy + Math.sin(wander * Math.PI * 4) * H * 0.17;
      tk = PULL * 0.7;
      if (!mag.placed) Object.assign(mag, { x: tx, y: ty, placed: true });
    }
    if (!hold) {
      // Critically damped spring: follows the hand, never overshoots far.
      const kS = 120;
      const c = 2 * Math.sqrt(kS) * 0.9;
      mag.vx += ((tx - mag.x) * kS - mag.vx * c) * dt;
      mag.vy += ((ty - mag.y) * kS - mag.vy * c) * dt;
      mag.x += mag.vx * dt;
      mag.y += mag.vy * dt;
      mag.k = damp(mag.k, tk, 4, dt);
    }

    // Waves: fast out of the letters, slowing as they leave.
    pulseData.fill(0);
    const list = holdT != null ? [{ age: holdT * WAVE_S }] : pulses;
    for (const w of pulses) w.age += dt;
    while (pulses.length && pulses[0].age > WAVE_S) pulses.shift();
    list.forEach((w, i) => {
      const u = clamp(w.age / WAVE_S, 0, 1);
      const r = L.reach * (1 - Math.pow(1 - u, 1.4)) - L.period;
      const amp = Math.pow(1 - u, 1.5) * clamp(u * 30, 0, 1);
      pulseData[i * 4] = r;
      pulseData[i * 4 + 1] = amp * WAVE_A;
    });

    // Nothing moved: keep the last frame.
    const key = `${mag.x.toFixed(2)},${mag.y.toFixed(2)},${mag.k.toFixed(4)},${pulseData.join(",")},${built}`;
    if (key === lastKey) return;
    lastKey = key;
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(drawProg);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, distTex);
    gl.uniform1i(uR.uDist, 0);
    gl.uniform2f(uR.uRes, W, H);
    gl.uniform1f(uR.uDpr, stage.dpr);
    gl.uniform1f(uR.uH, stage.canvas.height);
    gl.uniform1f(uR.uP, L.period);
    gl.uniform1f(uR.uN, L.rings);
    gl.uniform3f(uR.uMag, mag.x, mag.y, mag.k);
    gl.uniform1f(uR.uSigma, L.sigma);
    gl.uniform1f(uR.uM, MAG_M);
    gl.uniform1f(uR.uScale, ECHO);
    gl.uniform1f(uR.uSpread, SPREAD);
    gl.uniform4fv(uPulse, pulseData);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return { destroy: () => stage.destroy() };
}
