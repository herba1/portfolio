import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Denchuka (無電柱化): Japan's slow programme of putting the overhead lines
// underground, run forward through one Kyoto street.
//
// The bake (tools/depth/bakes/denchuka) takes Richard Tao's photograph apart
// element by element: 41 wires (the sky matte's sub-pixel alpha, carried on
// below the skyline by ridge tracking, and a second pass for the faint far
// ones), the crossarms, transformers and insulators of eight poles, and the
// poles themselves (SAM 2.1 plus a fitted cylinder). The clean plates: no
// wires; no wires or hardware; nothing overhead at all. Against the sky they
// are a membrane of the sky round each hole; below it, LaMa; the bare shafts
// are the poles straightened and interpolated along their own length. So every
// in-between state is two neighbouring clean plates that agree everywhere but
// under the element. The pole that carries the left signal keeps standing for
// it, stripped, as an undergrounded street's signal poles do.
//
// Live: drag sideways through the years. Each element has its year. A wire
// loses its tension and sags, then falls out of the frame under gravity
// (motion-blurred over the frame interval); the hardware is lowered down its
// pole and into the ground; then the poles themselves go down along their own
// axes, far ones first, the big wooden one on the corner last. Pulled back,
// everything returns the way it went. A moving piece is drawn from its own
// plate, unmixed against the plate behind it (photo = a x object + (1 - a) x
// plate), so it carries none of the street with it, and it passes behind the
// signals and road signs that stand in front of it.
//
// The scan came with a teal film-preset sky. It is regraded live, through the
// sky matte (sky.png: the photo's matte plus every hole the plates fill with
// sky, times whatever still stands in front), to a summer cobalt that deepens
// toward the top edge, with skylight-blue shade and warm sunlit tops on the
// cloud; the film then adds only its optics.
//
// Query: ?year=0..1 holds the years (elements caught mid-motion, as a still);
// ?film=0 shows the plates before the film.

const BASE = "/lab/denchuka/";
const PW = 2400;
const PH = 1600;
const MAX_W = 24;
const MAX_P = 8;
// plate row of the hills: the sky grade is palest here and deepest at the top edge
const SKYLINE = 1060;

// seconds each kind of element takes to go
const DUR = { wire: 0.95, hw: 1.25, pole: 1.9 };
// the still: how much of the year axis one element's motion spans
const STILL_SPAN = { wire: 0.035, hw: 0.04, pole: 0.05 };
// a falling wire is blurred over at most one 24 fps frame of its fall, sampled
// at most a pixel apart (3 px at the longest)
const FRAME = 1 / 24;
const WIRE_SAMPLES = 32;
// the travel (plate px) over which a falling wire's streak halves
const WIRE_FADE = 24;
// a wire's thickness (plate px) for its swept coverage
const WIRE_THICK = "3.0";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMP = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uP0;
uniform sampler2D uP1;
uniform sampler2D uP2;
uniform sampler2D uP3;
uniform highp sampler2D uIds;
uniform sampler2D uAlpha;
uniform sampler2D uSky;           // the sky with everything overhead gone (1 = sky)
uniform highp sampler2D uState;   // x: wire id, row 0 wires / 1 hardware / 2 poles: 1 = in place
uniform vec2 uPlate;
uniform int uNW;
uniform vec4 uW[${MAX_W}];        // xa, xb, sag, fall
uniform vec4 uW2[${MAX_W}];       // id, y0, y1, lead
uniform vec4 uW3[${MAX_W}];       // sag, fall at the previous frame (motion blur)
uniform int uNP;
uniform vec4 uPo[${MAX_P}];       // id, k, c, offset
uniform vec4 uPo2[${MAX_P}];      // top, base, previous offset, 0
uniform int uNH;
uniform vec4 uHw[${MAX_P}];       // id, k, c, offset
uniform vec4 uHw2[${MAX_P}];      // hwTop, base, previous offset, hwBottom

ivec4 ids(ivec2 p) {
  vec3 v = texelFetch(uIds, clamp(p, ivec2(0), ivec2(uPlate) - 1), 0).rgb * 255.0 + 0.5;
  int w = int(v.r);
  int g = int(v.g);
  int b = int(v.b);
  return ivec4(w, g / 16, g - (g / 16) * 16, b);
}
bool rest(int row, int id) {
  return texelFetch(uState, ivec2(id, row), 0).r > 0.5;
}
vec3 plate(int s, vec2 px, int rk) {
  vec2 uv = px / uPlate;
  if (s == 0 || rk == 0 || s < rk) return texture(uP0, uv).rgb;
  if (s == 1) return texture(uP1, uv).rgb;
  if (s == 2) return texture(uP2, uv).rgb;
  return texture(uP3, uv).rgb;
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-6)), d / (q.x + 1e-6), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// The scan's sky is a teal film preset (hue ~189, the same pale value from the
// hills to the top edge). A summer sky is cobalt and deepens toward the
// zenith: the clear blue is turned to ~207 and, going up the frame, gains
// saturation and loses value, left pale over the hills. The cloud is lit from
// high right: its shadow sides take the blue of the sky that lights them, its
// sunlit tops go warm-neutral.
vec3 skyGrade(vec3 c, float y) {
  vec3 h = rgb2hsv(c);
  float deg = h.x * 360.0;
  float zen = smoothstep(0.0, 1.0, clamp(1.0 - y / ${SKYLINE}.0, 0.0, 1.0));
  // clear sky: the teal band, turned
  float band = smoothstep(150.0, 168.0, deg) * (1.0 - smoothstep(232.0, 248.0, deg));
  float blue = smoothstep(0.1, 0.3, h.y) * band;
  float hue = mix(deg, 211.0 + (deg - 189.0) * 0.4, band);
  float sat = clamp(h.y * mix(1.0, 1.1, zen) + 0.03 * zen, 0.0, 1.0);
  float val = h.z * mix(1.0, 0.84, zen * zen);
  vec3 sky = hsv2rgb(vec3(hue / 360.0, sat, val));
  // cloud: shade sides to skylight blue, sunlit tops to warm white
  // more range, and the low cloud lit by the haze round it
  float v = clamp(0.84 + (h.z - 0.84) * 1.6 + 0.03 * (1.0 - zen), 0.0, 1.0);
  float shade = smoothstep(0.93, 0.74, h.z);
  float top = smoothstep(0.87, 0.96, h.z);
  vec3 shadeC = hsv2rgb(vec3(212.0 / 360.0, 0.07 + 0.1 * shade, v));
  vec3 sunC = hsv2rgb(vec3(38.0 / 360.0, 0.075, v));
  vec3 cloud = mix(shadeC, sunC, top);
  return mix(cloud, sky, blue);
}
// interleaved gradient noise: a per-pixel offset whose neighbours differ, so
// leftover sampling steps read as fine grain
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
// the object alone: photo = a * object + (1 - a) * behind
vec3 unmix(vec3 withIt, vec3 behind, float a) {
  return clamp((withIt - (1.0 - a) * behind) / max(a, 0.2), 0.0, 1.0);
}

void main() {
  vec2 pp = vec2(vUv.x, 1.0 - vUv.y) * uPlate;
  ivec2 ip = ivec2(floor(pp));
  ivec4 e = ids(ip);
  int rk = e.w / 64;
  bool front = (e.w / 32) % 2 == 1;

  int s = 3;
  if (e.z > 0 && rest(2, e.z)) s = 2;
  if (e.y > 0 && rest(1, e.y)) s = 1;
  if (e.x > 0 && rest(0, e.x)) s = 0;
  vec3 col = plate(s, pp, rk);
  // how much of what stands in front of the sky is still there
  vec3 al0 = texelFetch(uAlpha, ip, 0).rgb;
  float cov = 0.0;
  if (e.x > 0 && s == 0) cov = max(cov, al0.r);
  if (e.y > 0 && rest(1, e.y)) cov = max(cov, al0.g);
  if (e.z > 0 && rest(2, e.z)) cov = max(cov, al0.b);

  // poles going down their own axes, into the ground
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNP) break;
    vec4 a = uPo[j];
    vec4 b = uPo2[j];
    float ax = a.y * pp.y + a.z;
    if (abs(pp.x - ax) > 24.0 || pp.y > b.y || front) continue;
    vec2 dir = normalize(vec2(a.y, 1.0));
    vec2 src = pp - dir * a.w;
    if (src.y < b.x - 2.0) continue;
    ivec4 se = ids(ivec2(floor(src)));
    if (se.z != int(a.x + 0.5)) continue;
    float al = texelFetch(uAlpha, ivec2(floor(src)), 0).b;
    int srk = se.w / 64;
    vec3 obj = unmix(plate(2, src, srk), plate(3, src, srk), al);
    col = mix(col, obj, al);
    cov += (1.0 - cov) * al;
  }

  // crossarms, transformers and insulators lowered down the pole
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNH) break;
    vec4 a = uHw[j];
    vec4 b = uHw2[j];
    float ax = a.y * pp.y + a.z;
    if (abs(pp.x - ax) > 170.0 || pp.y > b.y || front) continue;
    vec2 dir = normalize(vec2(a.y, 1.0));
    vec2 src = pp - dir * a.w;
    if (src.y < b.x - 2.0 || src.y > b.w + 2.0) continue;
    ivec4 se = ids(ivec2(floor(src)));
    if (se.y != int(a.x + 0.5)) continue;
    float al = texelFetch(uAlpha, ivec2(floor(src)), 0).g;
    int srk = se.w / 64;
    vec3 obj = unmix(plate(1, src, srk), plate(2, src, srk), al);
    col = mix(col, obj, al);
    cov += (1.0 - cov) * al;
  }

  // wires: slack, then the fall, blurred over the frame interval. The sweep
  // is sampled at most 1 px apart (3 px at the longest), each pixel's samples
  // shifted by its own noise, so what steps are left dither into grain, not
  // copies. Falling, a pixel takes how much wire crossed it over the frame
  // (the coverage summed along the travel, in px of wire), weighted toward
  // the end of the frame: the wire where it is now, with a tail up the way
  // it came that thins out (a smear, not a stack of see-through wires), the
  // whole of it fainter the faster it goes.
  for (int j = 0; j < ${MAX_W}; j++) {
    if (j >= uNW) break;
    vec4 a = uW[j];
    vec4 b = uW2[j];
    vec4 c = uW3[j];
    float u = clamp((pp.x - a.x) / (a.y - a.x), 0.0, 1.0);
    float bow = 4.0 * u * (1.0 - u);
    float lead = b.w > 0.5 ? mix(1.0, 0.72, u) : mix(0.72, 1.0, u);
    float dy1 = a.z * bow + a.w * lead;
    float dy0 = c.x * bow + c.y * lead;
    if (pp.y - min(dy0, dy1) < b.y - 2.0 || pp.y - max(dy0, dy1) > b.z + 2.0) continue;
    int id = int(b.x + 0.5);
    float travel = abs(dy1 - dy0);
    float n = clamp(ceil(travel), 1.0, ${WIRE_SAMPLES}.0);
    float jit = ign(vec2(ip) + vec2(float(id) * 5.588, float(id) * 3.137));
    // at a crawl (the slack) every instant counts the same; falling, the tail
    float comet = smoothstep(2.0, 16.0, travel);
    vec3 accC = vec3(0.0);
    float accW = 0.0;
    float peak = 0.0;
    float swept = 0.0;
    for (int t = 0; t < ${WIRE_SAMPLES}; t++) {
      if (float(t) >= n) break;
      float f = (float(t) + jit) / n;
      vec2 src = vec2(pp.x, pp.y - mix(dy0, dy1, f));
      ivec2 si = ivec2(floor(src));
      ivec4 se = ids(si);
      if (se.x != id) continue;
      float al = texelFetch(uAlpha, si, 0).r;
      float k = al * mix(1.0, f * f, comet);
      if (k <= 0.0) continue;
      int srk = se.w / 64;
      accC += unmix(plate(0, src, srk), plate(1, src, srk), al) * k * k;
      accW += k * k;
      peak = max(peak, k);
      swept += k;
    }
    if (peak <= 0.0) continue;
    // px of wire that went over this pixel, against a wire's own thickness
    float sweptA = min(1.0, swept * (travel / n) / ${WIRE_THICK});
    float A = mix(peak, sweptA, comet) / (1.0 + travel / ${WIRE_FADE}.0);
    col = mix(col, accC / accW, A);
    cov += (1.0 - cov) * A;
  }

  float skyW = texture(uSky, pp / uPlate).r * (1.0 - cov);
  if (skyW > 0.002) col = mix(col, skyGrade(col, pp.y), skyW);

  outColor = vec4(col, 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function texParams(gl, mips, nearest = false) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function imageTexture(gl, img, nearest = false) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  texParams(gl, false, nearest);
  return t;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  texParams(gl, false);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const num = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

// A wire's state at progress a (0 in place, 1 gone): first the tension goes
// and it bows, then it drops under gravity, one end a little ahead.
function wireShape(w, a) {
  const span = w.xb - w.xa;
  const slackMax = clamp(0.028 * span, 8, 64);
  const S0 = 0.32;
  if (a <= S0) {
    const k = a / S0;
    return [slackMax * (1 - (1 - k) * (1 - k)), 0];
  }
  const t = (a - S0) / (1 - S0);
  return [slackMax, (PH - w.y0 + 160) * t * t];
}

export async function createDenchuka(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const yearQ = num(q, "year");
  const held = yearQ != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [els, ...imgs] = await Promise.all([
    fetch(BASE + "elements.json").then((r) => r.json()),
    ...["p0.webp", "p1.webp", "p2.webp", "p3.webp", "ids.png", "alpha.png", "sky.png"].map((f) => loadImage(BASE + f)),
  ]);
  const plates = imgs.slice(0, 4).map((im) => imageTexture(gl, im));
  const idsTex = imageTexture(gl, imgs[4], true);
  const alphaTex = imageTexture(gl, imgs[5], true);
  const skyTex = imageTexture(gl, imgs[6]);

  // Element table.
  const wires = els.wires.map((w) => ({ ...w, a: 0, prev: 0, kind: "wire" }));
  const poles = els.poles.map((p) => ({ ...p, a: 0, prev: 0, ha: 0, hprev: 0 }));
  const maxWire = wires.reduce((m, w) => Math.max(m, w.id), 0);

  // State texture: rows wires / hardware / poles, 1 = in place.
  const SW = 256;
  const stateData = new Uint8Array(SW * 3 * 4);
  const stateTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, stateTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SW, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, stateData);
  texParams(gl, false, true);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = { comp: program(gl, VERT, COMP), blit: program(gl, VERT, BLIT) };
  const film = createFilm(gl, { width: 2, height: 2 });

  const L = { x: 0, y: 0, w: 1, h: 1 };
  const T = { scene: null, film: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = W - side * 2;
      Object.assign(L, { w, h: w / ar, x: side, y: (H - w / ar) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.78 * ar);
      Object.assign(L, { w, h: w / ar, x: (W - w) / 2, y: (H - w / ar) / 2 - 12 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph);
    T.film = target(gl, L.pw, L.ph);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // The years: the drag sets a goal; what you see follows on a spring.
  let goal = held ? clamp(yearQ, 0, 1) : 0;
  let year = goal;
  let yearV = 0;
  let goalV = 0;
  let dragging = false;
  let dragX = 0;
  let dragGoal = 0;
  let touched = held;
  let seed = 0;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (!inPrint(p)) return;
    dragging = true;
    touched = true;
    dragX = p.x;
    dragGoal = goal;
    goalV = 0;
    host.dataset.dragging = "";
  });
  stage.on("move", (p) => {
    if (!dragging) return;
    let g = dragGoal + (p.x - dragX) / L.w;
    const band = (o) => 0.06 * (1 - Math.exp((-0.4 * o) / 0.06));
    if (g < 0) g = -band(-g);
    if (g > 1) g = 1 + band(g - 1);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp(p.vx / L.w, -2.5, 2.5);
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 0.1 : 0.025), 0, 1);
  };
  host.addEventListener("keydown", onKey);

  // Each element runs its own clock toward where the year says it should be.
  const step = (dt) => {
    let moving = false;
    const adv = (cur, target, dur) => {
      if (still) return target;
      if (reduce) return target >= 0.5 ? 1 : 0;
      const d = dt / dur;
      return target > cur ? Math.min(target, cur + d) : Math.max(target, cur - d);
    };
    const span = (y0, sp) => clamp((year - y0) / sp, 0, 1);
    for (const w of wires) {
      w.prev = w.a;
      const target = still ? span(w.year, STILL_SPAN.wire) : year >= w.year ? 1 : 0;
      w.a = adv(w.a, target, DUR.wire);
      if (w.a !== w.prev) moving = true;
    }
    for (const p of poles) {
      p.hprev = p.ha;
      p.prev = p.a;
      const th = still ? span(p.hwYear, STILL_SPAN.hw) : year >= p.hwYear ? 1 : 0;
      const tp = still ? span(p.year, STILL_SPAN.pole) : year >= p.year ? 1 : 0;
      p.ha = adv(p.ha, th, DUR.hw);
      p.a = adv(p.a, tp, DUR.pole);
      if (p.ha !== p.hprev || p.a !== p.prev) moving = true;
    }
    return moving;
  };

  const uW = new Float32Array(MAX_W * 4);
  const uW2 = new Float32Array(MAX_W * 4);
  const uW3 = new Float32Array(MAX_W * 4);
  const uPo = new Float32Array(MAX_P * 4);
  const uPo2 = new Float32Array(MAX_P * 4);
  const uHw = new Float32Array(MAX_P * 4);
  const uHw2 = new Float32Array(MAX_P * 4);

  const draw = (expoStops, fade) => {
    // state rows
    stateData.fill(0);
    for (const w of wires) if (w.a <= 0) stateData[w.id * 4] = 255;
    for (const p of poles) {
      if (p.ha <= 0) stateData[(SW + p.id) * 4] = 255;
      if (p.a <= 0) stateData[(2 * SW + p.id) * 4] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SW, 3, gl.RGBA, gl.UNSIGNED_BYTE, stateData);

    let nw = 0;
    for (const w of wires) {
      if (w.a <= 0 || w.a >= 1 || nw >= MAX_W) continue;
      const [s1, f1] = wireShape(w, w.a);
      // where it was a frame ago: the last drawn frame, but never more than a
      // 24 fps frame of travel (a slow frame would smear it across the sky);
      // the still takes exactly that frame
      const da = FRAME / DUR.wire;
      const back = still ? Math.max(0, w.a - da) : clamp(w.prev, w.a - da, w.a + da);
      const [s0, f0] = wireShape(w, back);
      uW.set([w.xa, w.xb, s1, f1], nw * 4);
      uW2.set([w.id, w.y0, w.y1, w.id % 2], nw * 4);
      uW3.set([s0, f0, 0, 0], nw * 4);
      nw++;
    }
    let np = 0;
    let nh = 0;
    for (const p of poles) {
      if (p.a > 0 && p.a < 1 && np < MAX_P) {
        const travel = p.base - p.top + 6;
        uPo.set([p.id, p.k, p.c, easeInOut(p.a) * travel], np * 4);
        uPo2.set([p.top, p.base, easeInOut(p.prev) * travel, 0], np * 4);
        np++;
      }
      if (p.ha > 0 && p.ha < 1 && nh < MAX_P) {
        const travel = p.base - p.hwTop + 6;
        uHw.set([p.id, p.k, p.c, easeInOut(p.ha) * travel], nh * 4);
        uHw2.set([p.hwTop, p.base, easeInOut(p.hprev) * travel, p.hwBottom], nh * 4);
        nh++;
      }
    }

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    const u = P.comp.u;
    gl.useProgram(P.comp.p);
    plates.forEach((t, i) => bindTex(i, t, u[`uP${i}`]));
    bindTex(4, idsTex, u.uIds);
    bindTex(5, alphaTex, u.uAlpha);
    bindTex(6, stateTex, u.uState);
    bindTex(7, skyTex, u.uSky);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1i(u.uNW, nw);
    gl.uniform4fv(u.uW, uW);
    gl.uniform4fv(u.uW2, uW2);
    gl.uniform4fv(u.uW3, uW3);
    gl.uniform1i(u.uNP, np);
    gl.uniform4fv(u.uPo, uPo);
    gl.uniform4fv(u.uPo2, uPo2);
    gl.uniform1i(u.uNH, nh);
    gl.uniform4fv(u.uHw, uHw);
    gl.uniform4fv(u.uHw2, uHw2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!raw) {
      film.render(
        T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          // The scan already carries its grade; the film adds the optics.
          exposure: expoStops,
          contrast: 1.14,
          toe: 0.0,
          saturation: 1.1,
          blueDepth: 0.45,
          shadowTint: [0.97, 1, 1.03],
          highlightTint: [0.99, 1, 1.01],
          vignette: 0.22,
          // the sunlit cloud is brighter against a deeper blue now: keep the
          // red fringe off its edge
          halation: 0.22,
          halationThreshold: 0.96,
          whitePoint: 1.25,
          grainSeed: seed,
        },
        T.film.fbo,
      );
      gl.bindVertexArray(vao);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(P.blit.p);
    bindTex(0, raw ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up over-exposed, a white-blue summer glare, and
  // settles; then, untouched, the first years run on by themselves and the
  // lowest wires come down, to show the street can be scrubbed.
  const REVEAL = 2.0;
  const WALK_AT = 2.2;
  const WALK = 3.2;
  const WALK_TO = 0.13;
  let t0 = -1;
  let grainClock = 0;

  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now() / 1000;
    if (t0 < 0) t0 = now;
    const age = still ? 99 : now - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 1.6 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held && !touched) {
      const k = reduce ? 0 : easeInOut(clamp((age - WALK_AT) / WALK, 0, 1));
      goal = WALK_TO * k;
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-4) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > 1) goal += (1 - goal) * (1 - Math.exp(-dt * 14));
    }
    let springing = false;
    if (held) year = goal;
    else {
      // spring, damping ratio 0.86
      const w = 11;
      const z = 0.86;
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = w * w * (goal - year) - 2 * z * w * yearV;
        yearV += a * h;
        year += yearV * h;
      }
      springing = Math.abs(goal - year) > 1e-4 || Math.abs(yearV) > 1e-4;
      if (!springing) {
        year = goal;
        yearV = 0;
      }
    }
    const moving = step(dt);

    let tick = false;
    if (!reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    if (!dirty && !moving && !tick && !revealing) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      [...plates, idsTex, alphaTex, skyTex, stateTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
