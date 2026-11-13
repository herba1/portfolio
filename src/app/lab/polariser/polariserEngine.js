import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Polariser: a circular polarising filter on a wide lens pointed almost
// straight up, between two Dublin quay buildings, into a March cumulus sky. Turning the ring turns the
// filter's transmission axis in the image plane, and every pixel answers it
// with real optics:
//
//  - Clear sky is Rayleigh-scattered light, polarised perpendicular to the
//    plane through the sun, the eye and the point looked at, with degree
//    P = Pmax sin²γ / (1 + cos²γ), γ the angle from the sun. Its E-vector is
//    projected into the frame per pixel, so a wide lens shows the uneven,
//    tilted dark band 90° from the sun that photographers know.
//  - Cumulus is Mie-scattered and unpolarised, so it holds while the blue
//    around it falls away.
//  - The glass curtain wall reflects with Fresnel s/p reflectances at its own
//    angle of incidence (each face has a measured normal), so its reflection
//    is partially polarised and fades on one face while the other holds.
//
// The plate is a fixed stereographic render of Poly Haven's docklands_01
// HDRI at 16k, its native maximum (linear, unclipped; sun at az 38°, alt
// 28.8°, found from its brightest point and checked against the time and
// place of capture), 2x2 supersampled to 3840x4800 so the print always
// downsamples it: a worm's-eye view 89° up, a degree off the zenith, rolled
// so the towers wrap the frame: the big apartment block leans in across the
// top left, the pointed tower from the left, the glass block from the bottom
// left, the red mast stands up from the foot of the print and a second glass
// block comes in from the bottom right, and the dark band 90° from the sun
// arcs across the open sky in the middle of that canyon. The roll keeps the
// quay's chevron hoarding off the print, so the mast is its only warm colour.
// Each pixel's view direction is rebuilt from the camera through the same
// projection, so γ is exact.
//
// Query: ?pol=0..1 holds the filter angle (0..180°); ?still=1 skips the
// reveal; ?grain=0 for static grain.

const PLATE = "/lab/polariser/plate.jpg";
const AUX = "/lab/polariser/aux.png";

// Camera the plate was rendered with (tools/depth/bakes/polariser/plate.py):
// stereographic, so a plane point p = 2 d⊥ / (1 + d·f), with the plate's
// horizontal edge at hfov / 2 from the axis. The 4:5 print crops 92% of it,
// a 140° horizontal field on the page.
const CAM = { yaw: 17, pitch: 89, roll: 119, hfov: 149.09834806856665, aspect: 4800 / 3840 };
// The print crops this share of the plate.
const CROP = 0.92;
// Mip bias on the plate and aux lookups. The print minifies the plate 1.6 to
// 3.3x, and plain trilinear filtering would blend in the next mip down, which
// is coarser than the print, so the towers would come out upscaled and soft.
// Biasing a level finer keeps every blended level at or above the print's own
// resolution; the mips are box-prefiltered, so the window grids do not alias.
const LOD_BIAS = -0.7;
const SUN = { lon: 38.12255859375, lat: 28.762207031249996 };
const GLASS_A = [-0.85284216, 0, 0.5221688];
const GLASS_B = [-0.54538212, 0, -0.83818754];
// Plate encoding: v = (x / (1 + x))^(1/2.2), x = L * K.
const K = 0.6;
// The filter angle that deepens this frame most (mean sky transmission is
// lowest there, tools/depth/bakes/polariser/hero.py); the hero still and the
// end of the reveal.
const HERO = 0.05;
// Effective maximum degree of polarisation. A clean Rayleigh sky reaches about
// 0.75, but a March cumulus sky is multiply scattered off bright cloud and a
// real circular polariser does not extinguish fully, so the band 90° from the
// sun deepens to cobalt rather than to navy.
const P_MAX = 0.55;
// Clear-sky dye (linear, per unit of the plate's blue) and the white balance
// that takes the 5400 K capture's cloud to warm-neutral. The zenith the plate
// now looks at is the darkest blue in the dome, so the dye is lifted to keep
// the deepest frame in cobalt; its green is held back a touch so the washed
// angle stays cerulean, not electric cyan.
const SKY_DYE = [0.03 * 2, 0.37 * 2, 2];
const WB = [1.1, 0.97, 0.97];
// The print: 0.9 stops over the plate's old exposure, then a log-logistic
// negative-to-print curve (contrast n, half-density exposure s, in plate units
// after that exposure) reaching paper white at 8 plate units. The half-density
// point sits high enough that cloud bodies land on the steep middle of the
// curve, not its shoulder, so their lobes keep their modelling and only the
// sunlit tops roll off.
const PRINT_STOPS = 0.9;
const PRINT_WHITE = 8;
const PRINT_CURVE = [2.0, 1.1];
// Cloud split tone, multipliers on the print (unit luminance): skylight blue
// in the shadowed underside (hue ~205), warm-neutral on the sunlit top.
const SHADE = [0.8, 1.0, 1.2];
const SHADE_DEPTH = 0.9;
const SUNLIT = [1.0, 0.965, 0.9];
const VIGNETTE = 0.28;

const rad = (d) => (d * Math.PI) / 180;
const lumNorm = (c) => {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => v / y);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function cameraBasis({ yaw, pitch, roll = 0 }) {
  const y = rad(yaw);
  const p = rad(pitch);
  const f = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
  const r0 = [Math.cos(y), 0, -Math.sin(y)];
  const u0 = cross(f, r0);
  // Roll turns right and up about the forward axis.
  const c = Math.cos(rad(roll));
  const s = Math.sin(rad(roll));
  const r = r0.map((v, i) => c * v + s * u0[i]);
  const u = u0.map((v, i) => -s * r0[i] + c * v);
  return { f, r, u };
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The scene in linear light, as it reached the film through the filter.
const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uAux;
uniform vec4 uCrop;      // plate uv = (x, 1 - y) * crop.xy + crop.zw
uniform vec3 uF, uR, uU; // camera basis
uniform float uX;        // 2 tan(hfov / 4): stereographic half-width
uniform float uAsp;      // plate h / w
uniform vec3 uSun;
uniform vec3 uNA, uNB;   // glass face normals
uniform float uPhi;      // filter transmission axis, image angle, y down
uniform float uPmax;
uniform float uExpo;
uniform float uLinearOut;
uniform vec3 uSkyDye;
uniform vec3 uWB;
uniform vec2 uPrint;     // print curve: contrast n, half-density exposure s
uniform float uVignette; // lens cos^4 falloff, before the emulsion
uniform float uPrintAsp; // print w / h
uniform vec3 uShade;     // cloud split tone: skylight-lit shadow, sunlit top
uniform vec3 uSunlit;
uniform float uLodBias;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Negative to print. Print density is a sigmoid in log exposure, so the
// print's transmission is a log-logistic of scene light: a toe that holds
// the quay's shadows, a steep middle where cloud bodies sit, and a short
// shoulder that rolls the sunlit tops to paper white at 8 plate units
// instead of clipping them.
vec3 printCurve(vec3 x) {
  vec3 xn = pow(max(x, 0.0), vec3(uPrint.x));
  float sn = pow(uPrint.y, uPrint.x);
  float wn = pow(${PRINT_WHITE.toFixed(1)}, uPrint.x);
  return min(xn / (xn + sn) * ((wn + sn) / wn), 1.0);
}
vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 decode(vec3 v) {
  vec3 y = pow(v, vec3(2.2));
  return y / max(1.0 - y, 0.004) * ${(1 / K).toFixed(6)};
}
// Stereographic projection of a direction to the image plane (y down).
vec2 project(vec3 d) {
  d = normalize(d);
  return 2.0 * vec2(dot(d, uR), -dot(d, uU)) / (1.0 + dot(d, uF));
}
// Image angle (y down) of a direction e tangent to the sphere at d, through
// the plate's own projection, so sky and glass E-vectors land true.
float imageAngle(vec3 d, vec3 e) {
  vec2 v = project(d + e * 0.02) - project(d);
  return atan(v.y, v.x);
}
// Degree of polarisation of light reflected off glass (n = 1.52) at
// incidence cos ci, and the image angle of its s (perpendicular) E-vector.
vec2 glass(vec3 d, vec3 n) {
  float ci = clamp(-dot(d, n), 0.0, 1.0);
  float si = sqrt(1.0 - ci * ci);
  float st = si / 1.52;
  float ct = sqrt(1.0 - st * st);
  float rs = (ci - 1.52 * ct) / (ci + 1.52 * ct);
  float rp = (ct - 1.52 * ci) / (ct + 1.52 * ci);
  float Rs = rs * rs, Rp = rp * rp;
  float P = (Rs - Rp) / max(Rs + Rp, 1e-5);
  return vec2(P, imageAngle(d, normalize(cross(d, n))));
}

void main() {
  vec2 puv = vec2(vUv.x, 1.0 - vUv.y) * uCrop.xy + uCrop.zw;
  vec3 C = decode(texture(uPlate, puv, uLodBias).rgb);
  vec3 aux = texture(uAux, puv, uLodBias).rgb;
  // Inverse stereographic: p on the plane, back to the unit sphere.
  vec2 s = puv * 2.0 - 1.0;
  vec2 p = vec2(s.x, -s.y * uAsp) * uX;
  float r2 = dot(p, p);
  vec3 d = normalize(4.0 * (p.x * uR + p.y * uU) + (4.0 - r2) * uF);

  // Sky: the clear-blue (Rayleigh) part of the pixel, unmixed from the
  // neutral (Mie, cloud) part by chroma, carries the polarisation.
  float cg = dot(d, uSun);
  float P = uPmax * (1.0 - cg * cg) / (1.0 + cg * cg);
  float psi = imageAngle(d, normalize(cross(uSun, d)));
  // The Rayleigh part is re-dyed toward the cobalt a Fuji negative gives a
  // clear sky; cloud and everything neutral keep their own colour.
  float A = clamp((0.85 * C.b - C.r) / 0.56, 0.0, C.b) * aux.r;
  vec3 Cout = C - A * vec3(0.29, 0.58, 1.0) + A * uSkyDye * (1.0 + P * cos(2.0 * (uPhi - psi)));

  // Glass: the reflected share of the pixel, partially s-polarised.
  vec2 ga = glass(d, uNA);
  vec2 gb = glass(d, uNB);
  float refl = 0.82;
  Cout += C * refl * aux.g * ga.x * cos(2.0 * (uPhi - ga.y));
  Cout += C * refl * aux.b * gb.x * cos(2.0 * (uPhi - gb.y));

  Cout = max(Cout, 0.0) * uExpo * uWB;
  // The lens's cos^4 falloff reaches the emulsion before the print curve, so
  // it compresses in the cloud tops the way it does on a real print.
  vec2 rv = (vUv - 0.5) * vec2(uPrintAsp, 1.0);
  float t2 = dot(rv, rv) / (0.25 * (uPrintAsp * uPrintAsp + 1.0)) * uVignette * uVignette;
  Cout /= (1.0 + t2) * (1.0 + t2);

  vec3 print = printCurve(Cout);
  // A saturated blue taken through a steep per-channel curve swings its hue:
  // blue reaches the shoulder while green is still on the straight line, so
  // a bright, washed sky would go electric cyan. Hold the clear sky's hue by
  // grading half its Rayleigh share on its brightest channel.
  float mc = max(Cout.r, max(Cout.g, Cout.b));
  vec3 held = Cout * (printCurve(vec3(mc)).r / max(mc, 1e-5));
  float rayleigh = clamp(A / max(C.b, 1e-4), 0.0, 1.0) * aux.r;
  print = mix(print, held, 0.5 * rayleigh);

  // Split tone the cumulus. A cloud's sunlit top is lit by the low sun; its
  // shadowed underside only by the open sky around it, so it goes blue-grey
  // (hue ~205) while the tops roll off warm. Only the neutral, non-Rayleigh
  // share of an open-sky pixel is cloud; the quay and the mast are left alone.
  // The gate opens across the cloud bodies' mid-tones, so the blue-grey reaches
  // up into the shaded flanks of each lobe rather than only the darkest base.
  float cloud = aux.r * clamp(1.0 - A / max(C.b, 1e-4), 0.0, 1.0);
  float lit = smoothstep(0.4, 0.85, dot(print, LUMA));
  print *= mix(vec3(1.0), mix(uShade, uSunlit, lit), cloud);
  // Paper white: the print's base never scans as a full 255.
  print = clamp(print, 0.0, 1.0) * 0.985;

  outColor = vec4(uLinearOut > 0.5 ? print : srgbEncode(print), 1.0);
}`;

// The developed print on paper.
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// The plate is 3840x4800; a GPU that caps textures below that gets it
// halved (or more) through a canvas rather than a failed upload.
function fitTexture(gl, img) {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= max) return img;
  let s = 1;
  while (Math.max(w, h) * s > max) s /= 2;
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fitTexture(gl, img));
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, ok };
}
const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

// Expo-out, the reveal curve.
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const wrapPi = (a) => {
  // Shortest signed difference for an axis (period π).
  a %= Math.PI;
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
};
const wrap2Pi = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createPolariser(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const polQ = q.get("pol");
  const held = polQ != null && polQ !== "" && Number.isFinite(+polQ);
  const still = held || q.get("still") === "1";
  const grainOn = q.get("grain") !== "0";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  stage.canvas.style.cursor = "grab";

  const [plateImg, auxImg] = await Promise.all([loadImage(PLATE), loadImage(AUX)]);
  const plate = imageTexture(gl, plateImg, true);
  const aux = imageTexture(gl, auxImg, true);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  const cam = cameraBasis(CAM);
  const sun = [Math.cos(rad(SUN.lat)) * Math.sin(rad(SUN.lon)), Math.sin(rad(SUN.lat)), Math.cos(rad(SUN.lat)) * Math.cos(rad(SUN.lon))];

  // The hairline index: the filter's axis as a diameter of a small ring,
  // under the print's right edge. It is the only mark on the page.
  const NS = "http://www.w3.org/2000/svg";
  const mark = document.createElementNS(NS, "svg");
  mark.setAttribute("class", "pol-mark");
  mark.setAttribute("viewBox", "-12 -12 24 24");
  mark.setAttribute("aria-hidden", "true");
  const ring = document.createElementNS(NS, "circle");
  ring.setAttribute("r", "9");
  const axis = document.createElementNS(NS, "line");
  axis.setAttribute("x1", "-9");
  axis.setAttribute("x2", "9");
  mark.append(ring, axis);
  host.appendChild(mark);

  // Layout, in css px of the box.
  const L = { x: 0, y: 0, w: 1, h: 1, cx: 0.5 };
  let sceneT = null;
  let filmT = null;
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      // A 4:5 print on every screen: looking straight up is a vertical
      // picture, the quay at its foot and the sky opening above.
      const side = W / H < 0.9 ? Math.max(16, Math.round(W * 0.06)) : Math.max(24, W * 0.07);
      let w = W - side * 2;
      let h = w * 1.25;
      const hMax = H * (W / H < 0.9 ? 0.74 : 0.84);
      if (h > hMax) {
        h = hMax;
        w = h / 1.25;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    // Snap to device pixels so the print edge is crisp.
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    mark.style.display = embedded ? "none" : "";
    mark.style.left = `${L.x + L.w - 20}px`;
    mark.style.top = `${L.y + L.h + 16}px`;
    dirty = true;
  };

  // State.
  // ?still=1 without ?pol shows the hero; the reveal starts from the washed angle.
  let phi = held ? clamp(+polQ, 0, 1) * Math.PI : HERO * Math.PI + (still ? 0 : Math.PI / 2);
  let omega = 0; // rad/s, carried after release
  let dragging = false;
  let touched = held;
  let dirty = true;
  let t0 = -1;
  let time = 0;
  let grainClock = 0;
  let grainSeed = 0;
  let last = null;

  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The gesture is the ring: angular motion about the print's centre, with
  // a horizontal fallback near the centre where the angle is undefined.
  const angleDelta = (a, b) => {
    const cx = L.x + L.w / 2;
    const cy = L.y + L.h / 2;
    const ax = a.x - cx;
    const ay = a.y - cy;
    const bx = b.x - cx;
    const by = b.y - cy;
    const r = Math.hypot(bx, by);
    const ang = wrap2Pi(Math.atan2(by, bx) - Math.atan2(ay, ax));
    const lin = ((b.x - a.x) / Math.max(1, L.w)) * Math.PI * 0.9;
    const w = clamp(r / (Math.min(L.w, L.h) * 0.3), 0, 1);
    return ang * w + lin * (1 - w);
  };
  stage.on("down", (p) => {
    dragging = true;
    touched = true;
    omega = 0;
    last = { x: p.x, y: p.y, t: performance.now() };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging || !last) return;
    const now = performance.now();
    const dphi = angleDelta(last, p);
    phi += dphi;
    const dt = Math.max(1, now - last.t) / 1000;
    omega += (dphi / dt - omega) * Math.min(1, dt / 0.05);
    last = { x: p.x, y: p.y, t: now };
    dirty = true;
  });
  stage.on("up", () => {
    dragging = false;
    stage.canvas.style.cursor = "grab";
    if (last && performance.now() - last.t > 60) omega = 0;
    last = null;
  });

  // Keyboard: the arrow keys turn the ring a few degrees.
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    touched = true;
    omega += (e.key === "ArrowRight" ? 1 : -1) * 2.2;
    dirty = true;
  };
  host.addEventListener("keydown", onKey);

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // Crop: cover-fit the print aspect into the 4:5 plate at 92%, a 140°
    // stereographic field across the print, with room left to breathe.
    const pa = L.pw / L.ph;
    const plateA = 1 / CAM.aspect;
    const m = CROP;
    let sx;
    let sy;
    if (pa >= plateA) {
      sx = m;
      sy = (m * plateA) / pa;
    } else {
      sy = m;
      sx = (m * pa) / plateA;
    }
    const cxp = 0.5;
    const b = reduce || still ? [0, 0] : [Math.sin(time * ((2 * Math.PI) / 11)) * 0.0028, Math.sin(time * ((2 * Math.PI) / 13.7) + 1.1) * 0.0022];
    const ox = clamp(cxp - sx / 2 + b[0], 0, 1 - sx);
    const oy = clamp(0.5 - sy / 2 + b[1], 0, 1 - sy);

    const u = scene.u;
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, aux);
    gl.uniform1i(u.uAux, 1);
    gl.uniform4f(u.uCrop, sx, sy, ox, oy);
    gl.uniform3fv(u.uF, cam.f);
    gl.uniform3fv(u.uR, cam.r);
    gl.uniform3fv(u.uU, cam.u);
    gl.uniform1f(u.uX, 2 * Math.tan(rad(CAM.hfov) / 4));
    gl.uniform1f(u.uAsp, CAM.aspect);
    gl.uniform3fv(u.uSun, sun);
    gl.uniform3fv(u.uNA, GLASS_A);
    gl.uniform3fv(u.uNB, GLASS_B);
    gl.uniform1f(u.uPhi, phi);
    gl.uniform1f(u.uPmax, P_MAX);
    gl.uniform1f(u.uExpo, 0.5 * 2 ** (PRINT_STOPS + expoStops));
    gl.uniform2fv(u.uPrint, PRINT_CURVE);
    gl.uniform1f(u.uVignette, VIGNETTE);
    gl.uniform1f(u.uPrintAsp, L.pw / L.ph);
    gl.uniform3fv(u.uShade, lumNorm(SHADE).map((v) => v * SHADE_DEPTH));
    gl.uniform3fv(u.uSunlit, SUNLIT);
    gl.uniform1f(u.uLodBias, LOD_BIAS);
    gl.uniform3fv(u.uSkyDye, SKY_DYE);
    gl.uniform3fv(u.uWB, WB);
    gl.uniform1f(u.uLinearOut, floatOk && sceneT.ok ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        // The scene pass hands over the finished print (display light, 0..1),
        // so the film's own curve is the identity: Lottes with contrast 1,
        // shoulder 1 and white at 1 is y = x. The film adds only what happens
        // in the emulsion and the scan: softness, Pro-Mist, halation, grain.
        // Pro-Mist is halved: on display light it would veil cloud with sky.
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        headroom: 0,
        exposure: 0,
        whitePoint: 1,
        contrast: 1,
        shoulder: 1,
        blueDepth: 0.25,
        highlightTint: [1, 0.99, 0.97],
        saturation: 1.12,
        halation: 0.32,
        halationThreshold: 0.8,
        bloom: 0.1,
        softness: 0.45,
        toe: 0.04,
        grain: 0.32,
        vignette: 0,
        grainSeed,
      },
      filmT.fbo,
    );

    // Paper, then the print.
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    axis.setAttribute("transform", `rotate(${((phi * 180) / Math.PI).toFixed(2)})`);
  };

  // Reveal: the print comes up overexposed, an airy white-blue, and settles
  // over two seconds while the ring turns from the washed angle into the
  // deepest one, the way the eye adjusts to a bright sky.
  const REVEAL = 2.0;
  const TURN = 2.4;
  const TURN_DELAY = 0.35;
  const phiFrom = phi;
  const phiTo = phiFrom + wrapPi(HERO * Math.PI - phiFrom);

  stage.onFrame((dt) => {
    if (!sceneT) return;
    time += dt;
    if (t0 < 0) t0 = time;
    const age = time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) {
        fade = clamp(age / 0.3, 0, 1);
        if (!touched) phi = phiTo;
      } else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
        if (!touched) phi = phiFrom + (phiTo - phiFrom) * expoOut(clamp((age - TURN_DELAY) / TURN, 0, 1));
      }
      if (age < Math.max(REVEAL, TURN + TURN_DELAY) + 0.1) dirty = true;
    }

    // Inertia after release (friction, tau ≈ 220 ms).
    if (!dragging && Math.abs(omega) > 1e-3) {
      phi += omega * dt;
      omega *= Math.exp(-dt / 0.22);
      dirty = true;
    } else if (!dragging) omega = 0;

    // Grain moves at 24 fps; the camera breathes with it.
    if (grainOn && !reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      mark.remove();
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      gl.deleteTexture(plate);
      gl.deleteTexture(aux);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
