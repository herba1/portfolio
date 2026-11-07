import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Moment: half a second of a man jumping over a GoPro on the ground, between
// two shutter presses, made into a place you can scrub through.
//
// Only two frames of the clip are shipped (frames 78 and 90, 0.5 s apart).
// Everything between them is synthesised here, 3D Moments style, from what
// was baked offline (tools/depth/bakes/moment):
//   - a clean plate: the sky behind the jumper is real sky, taken from the
//     frames in which he was elsewhere, split into an opaque sky layer and a
//     matted near layer (tree, post, wires, box, hotel) with its own depth;
//   - the jumper at each shutter press, matted (SAM 2.1), with his depth
//     (MoGe-2 relief, scaled by how much nearer he got) and his real motion
//     to the other press (DIS optical flow chained through the eleven frames
//     between them, so a wrist travelling 200 px is tracked 15 px at a time).
//
// Each frame of the jumper is a dense mesh. At time t the first is carried
// forward t of the way along its flow and the second back (1 - t) of the
// way along its own, each in its own buffer with a depth test (a hand in
// front of the chest stays in front). Each mesh vertex also knows how far
// to trust its own warp: whether its flow, followed all the way, lands on
// the other frame's body, and whether the other frame's flow from there
// comes back to it (forward-backward consistency), and how far the warp
// stretches it. The two buffers are then composited by coverage, not
// cross-faded by t: the jumper's matte is the union of the two warped
// mattes, each believed where its warp is trusted, so a limb only one
// frame covers is there at full strength instead of half there over the
// sky; colour inside it is weighted by each frame's own warped alpha and
// trust (and by t). Because both have been moved to the same place, the
// blend never shows two of him: it is the motion, not a dissolve. The
// mattes were pulled in 2.5 px at the bake, so only his own pixels travel,
// and the one soft pixel left at the edge is the only place he meets the
// plate.
//
// While time moves the camera moves too: a small orbit round a point two
// metres out (where he is), a few degrees, every layer reprojected through
// its own depth (pinhole, f = 1063 px from MoGe). The sky only turns; the
// tree and the box slide against it; he swings against all of it. The
// camera trails the time on a softer spring, so it drifts after the hand.
//
// Still params: ?t=0..1 time between the presses, ?cam=-1..1 orbit.

const BASE = "/lab/moment/";
const ZOOM = 1.075; // crop: the room the orbit turns in
// The print: a 4:5 upright crop of the 3:2 plate, round the jumper, the way
// a worm's-eye frame wants to be (sky above, the hotel and the tree only as
// edges). Plate px: x0, y0, width, height.
const VIEW = [362, 0, 852, 1066];
const ORBIT_X = 0.075; // m of camera travel either side
const ORBIT_Y = 0.028;
const PIVOT = 2.0; // m: the camera keeps looking at this distance
const SKY_GRID = 48;
// Summer film, with the halation kept to a thin warm ring (a GoPro frame
// has dark leaves and birds against white cloud everywhere, and the default
// amount turns every one of them orange) and less scan softness, so the
// leaves keep their drawing.
const FILM = { ...FILM_PRESETS.summer, halation: 0.2, halationLocal: 1, softness: 0.35, whitePoint: 1.45 };
const NEAR_STEP = 8; // plate px per near-layer cell
const SUBJ_STEP = 4; // plate px per jumper cell

const PROJECT = `
uniform vec2 uSize;     // plate px
uniform vec4 uView;     // the print's crop of the plate, px (x0, y0, w, h)
uniform float uF;
uniform vec2 uC;
uniform vec3 uRx;       // camera axes (rows of R^T)
uniform vec3 uRy;
uniform vec3 uRz;
uniform vec3 uCam;      // camera position, m
uniform vec4 uFrame;    // frame rect, device px, top left origin
uniform vec2 uRes;      // target size, device px
uniform float uZoom;
// p: plate px, d: disparity 1/m (0 = sky). Homogeneous: X = ray / d.
vec4 project(vec2 p, float d, float zOrder) {
  vec3 ray = vec3((p - uC) / uF, 1.0) - uCam * d;
  vec3 q = vec3(dot(uRx, ray), dot(uRy, ray), dot(uRz, ray));
  vec2 pp = q.xy / q.z * uF + uC;
  vec2 s = ((pp - uView.xy) / uView.zw - 0.5) * uZoom + 0.5;
  vec2 px = uFrame.xy + s * uFrame.zw;
  vec2 c = px / uRes * 2.0 - 1.0;
  return vec4(c.x, -c.y, zOrder, 1.0);
}
`;

const LAYER_VERT = `#version 300 es
precision highp float;
in vec2 aGrid;
uniform sampler2D uDepth;
uniform float uDMax;
uniform float uUseDepth;
out vec2 vUv;
${PROJECT}
void main() {
  // the mesh runs 6 % past the photo on every side, its edge pixels
  // stretched (clamped), so no layer ever pulls in from the frame edge
  vec2 uv = mix(vec2(-0.06), vec2(1.06), aGrid);
  vUv = uv;
  float d = uUseDepth > 0.5 ? textureLod(uDepth, uv, 0.0).r * uDMax : 0.0;
  gl_Position = project(uv * uSize, d, 0.0);
}`;

const LAYER_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv); // premultiplied
}`;

// One shutter frame of the jumper, carried along its flow by w of the way.
// Where the flow pulls the mesh open (a shin the other frame hides behind
// a shoe), the few pixels this frame has there are stretched thin; such
// fragments carry little weight, so the other frame, which saw that part
// whole, gives the colour (3D Moments' splat weights, by local stretch).
const SUBJ_VERT = `#version 300 es
precision highp float;
in vec2 aGrid;
uniform sampler2D uMotion;  // rg flow to the other frame, b disparity
uniform sampler2D uMotionO; // the other frame's flow back to this one
uniform sampler2D uTexO;    // the other frame (its alpha is its matte)
uniform vec4 uRect;         // jumper rect, plate px (x0, y0, x1, y1)
uniform float uRange;
uniform float uDMax;
uniform float uW;           // share of the flow travelled
uniform float uDScale;      // disparity factor at this time
out vec2 vUv;
out float vTrust;
out float vConf;
${PROJECT}
vec2 flowAt(vec2 uv) {
  return (textureLod(uMotion, uv, 0.0).rg * 255.0 - 128.0) / 127.0 * uRange;
}
vec2 flowBack(vec2 uv) {
  return (textureLod(uMotionO, uv, 0.0).rg * 255.0 - 128.0) / 127.0 * uRange;
}
void main() {
  vUv = aGrid;
  vec3 m = textureLod(uMotion, aGrid, 0.0).rgb;
  vec2 flow = (m.rg * 255.0 - 128.0) / 127.0 * uRange;
  float d = m.b * uDMax * uDScale;
  vec2 p = mix(uRect.xy, uRect.zw, aGrid) + flow * uW;
  // local area change of the warp, over two motion texels
  vec2 tx = 2.0 / vec2(textureSize(uMotion, 0));
  vec2 span = tx * (uRect.zw - uRect.xy);
  vec2 dx = (flowAt(aGrid + vec2(tx.x, 0.0)) - flowAt(aGrid - vec2(tx.x, 0.0))) / (2.0 * span.x);
  vec2 dy = (flowAt(aGrid + vec2(0.0, tx.y)) - flowAt(aGrid - vec2(0.0, tx.y))) / (2.0 * span.y);
  float det = (1.0 + uW * dx.x) * (1.0 + uW * dy.y) - uW * dx.y * uW * dy.x;
  // a fold (the warp turning a cell inside out, det < 0: the edge of a
  // foot overtaking itself) is no more to be trusted than a tear
  float k = det > 0.0 ? clamp(1.0 / det, 0.0, 1.0) * smoothstep(0.0, 0.25, det) : 0.0;
  // and a sliver: a cell drawn out one way and squeezed the other keeps
  // its area (det near 1) but prints as a needle off a shoe's edge. Its
  // shape, over one texel either side, from the warp's singular values.
  vec2 t1 = tx * 0.5;
  vec2 s1 = span * 0.5;
  vec2 ex = (flowAt(aGrid + vec2(t1.x, 0.0)) - flowAt(aGrid - vec2(t1.x, 0.0))) / (2.0 * s1.x);
  vec2 ey = (flowAt(aGrid + vec2(0.0, t1.y)) - flowAt(aGrid - vec2(0.0, t1.y))) / (2.0 * s1.y);
  float ja = 1.0 + uW * ex.x, jb = uW * ey.x, jc = uW * ex.y, jd = 1.0 + uW * ey.y;
  float q1 = ja * ja + jb * jb + jc * jc + jd * jd;
  float q2 = sqrt(max(pow(ja * ja + jb * jb - jc * jc - jd * jd, 2.0) + 4.0 * pow(ja * jc + jb * jd, 2.0), 0.0));
  float sMax = sqrt(0.5 * (q1 + q2));
  float sMin = sqrt(max(0.5 * (q1 - q2), 1e-6));
  float shape = (1.0 - smoothstep(1.35, 2.0, sMax)) * (1.0 - smoothstep(1.8, 3.0, sMax / sMin));
  // flow confidence: followed all the way, this point must land on the
  // other frame's body, and that frame's flow must bring it back here
  vec2 size = uRect.zw - uRect.xy;
  vec2 uvO = aGrid + flow / size;
  vec2 inside = step(vec2(0.0), uvO) * step(uvO, vec2(1.0));
  float onBody = smoothstep(0.05, 0.5, textureLod(uTexO, uvO, 1.0).a) * inside.x * inside.y;
  float err = length(flow + flowBack(uvO));
  float agree = exp(-err * err / (2.0 * 18.0 * 18.0));
  float conf = onBody * agree;
  vTrust = max(k * k * k * mix(0.3, 1.0, conf), 0.02);
  vConf = conf * smoothstep(0.3, 0.7, k) * shape;
  // nearer wins the depth test
  gl_Position = project(p, d, 1.0 - d);
}`;

const SUBJ_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vTrust;
in float vConf;
uniform sampler2D uTex;
layout(location = 0) out vec4 outColor;  // premultiplied
layout(location = 1) out vec4 outCover;  // r coverage, g flow confidence, b colour trust
void main() {
  vec4 c = texture(uTex, vUv);
  if (c.a < 0.004) discard;
  outColor = c;
  outCover = vec4(c.a, vConf, vTrust, 1.0);
  // the soft edge of a nearer limb loses the depth test to solid body
  // behind it (the rim of a hand over the chest), so no half-covered pixel
  // ever opens a seam inside him; where nothing is behind it still lands
  gl_FragDepth = min(gl_FragCoord.z + (1.0 - c.a) * 0.5, 0.9999);
}`;

const QUAD_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The bidirectional composite: both frames already sit where the jumper is
// at t. His matte is the union of the two warped mattes, not their t-mix:
// wherever one frame covers him and the other does not (the gap between
// the legs closing, a sole one frame sees edge-on), the covered one wins at
// full opacity, so no limb turns to glass over the sky. Each frame's
// coverage is believed fully near its own end of the half second and,
// towards the other end, only as far as its flow is trusted, so a finger
// the flow lost (stretched into streaks, or carried off the other frame's
// body) drops out and the frame that saw it whole draws it. The two ends
// stay exactly the shutter frames.
const BLEND_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uCA;
uniform sampler2D uCB;
uniform float uT;
out vec4 outColor;
void main() {
  vec4 a = texture(uA, vUv);   // premultiplied
  vec4 b = texture(uB, vUv);
  vec3 qa = texture(uCA, vUv).rgb; // warped coverage, flow confidence, colour trust
  vec3 qb = texture(uCB, vUv).rgb;
  float ta = 1.0 - uT;
  float tb = uT;
  float ka = mix(smoothstep(0.2, 0.5, qa.g), 1.0, smoothstep(0.2, 0.7, ta)) * smoothstep(0.0, 0.08, ta);
  float kb = mix(smoothstep(0.2, 0.5, qb.g), 1.0, smoothstep(0.2, 0.7, tb)) * smoothstep(0.0, 0.08, tb);
  // where both frames cover him he is simply there (a dark shirt gives the
  // flow little to hold, and two doubtful frames that agree are not two
  // ghosts); only what one frame alone covers is held to its trust
  float alpha = max(min(qa.r, qb.r), max(qa.r * ka, qb.r * kb));
  // colour: each frame by its own warped alpha and trust, then by t; a
  // pixel only one frame covers takes that frame's colour whole
  float sa = ta * qa.b;
  float sb = tb * qb.b;
  float wa = sa * a.a;
  float wb = sb * b.a;
  vec3 col = wa + wb > 1e-5 ? (sa * a.rgb + sb * b.rgb) / (wa + wb)
    : (a.a + b.a > 1e-5 ? (a.rgb + b.rgb) / (a.a + b.a) : vec3(0.0));
  outColor = vec4(col * alpha, alpha);
}`;

function compile(gl, vs, fs, attrib = "aGrid") {
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
  gl.bindAttribLocation(p, 0, attrib);
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function texture(gl, img, { premultiply = true, mips = false, raw = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, raw ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function grid(gl, nx, ny) {
  const verts = new Float32Array((nx + 1) * (ny + 1) * 2);
  for (let y = 0, k = 0; y <= ny; y++) for (let x = 0; x <= nx; x++, k += 2) (verts[k] = x / nx), (verts[k + 1] = y / ny);
  const idx = new Uint32Array(nx * ny * 6);
  for (let y = 0, k = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = y * (nx + 1) + x;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, free: () => (gl.deleteBuffer(vb), gl.deleteBuffer(ib), gl.deleteVertexArray(vao)) };
}

// Apple's rubber band: resistance grows with the overshoot.
const rubber = (x, c = 0.55) => (Math.sign(x) * (1 - 1 / (Math.abs(x) * c + 1))) / c;

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export async function createMoment(host, { embedded = false } = {}) {
  const q = new URLSearchParams(location.search);
  const num = (k) => {
    const v = q.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const tQ = num("t");
  const camQ = num("cam");
  const still = tQ != null || camQ != null;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  stage.canvas.style.cursor = "grab";

  const scene = await fetch(`${BASE}scene.json`).then((r) => r.json());
  const [imSky, imNear, imDepth, imA, imB, imMA, imMB] = await Promise.all(
    ["sky.webp", "near.webp", "depth.png", "a.webp", "b.webp", "ma.png", "mb.png"].map((n) => loadImage(BASE + n)),
  );
  const tex = {
    sky: texture(gl, imSky, { mips: true }),
    near: texture(gl, imNear, { mips: true }),
    depth: texture(gl, imDepth, { premultiply: false, raw: true }),
    a: texture(gl, imA, { mips: true }),
    b: texture(gl, imB, { mips: true }),
    ma: texture(gl, imMA, { premultiply: false, raw: true }),
    mb: texture(gl, imMB, { premultiply: false, raw: true }),
  };

  const [PW, PH] = scene.size;
  const rect = scene.subject.rect;
  const S = scene.subject.scale; // how much nearer he is at B than at A

  const progLayer = compile(gl, LAYER_VERT, LAYER_FRAG);
  const progSubj = compile(gl, SUBJ_VERT, SUBJ_FRAG);
  const progBlend = compile(gl, QUAD_VERT, BLEND_FRAG, "aPos");
  const film = createFilm(gl, { width: 2, height: 2 });

  const gSky = grid(gl, SKY_GRID, Math.round((SKY_GRID * PH) / PW));
  const gNear = grid(gl, Math.round(PW / NEAR_STEP), Math.round(PH / NEAR_STEP));
  const gSubj = grid(gl, Math.round((rect[2] - rect[0]) / SUBJ_STEP), Math.round((rect[3] - rect[1]) / SUBJ_STEP));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---- targets: the scene, and one buffer per shutter frame (with depth)
  const targets = {};
  // Jumper buffers: premultiplied colour (half float where the GPU renders
  // to it, so a soft edge keeps its colour when it is unpremultiplied) and,
  // beside it, coverage, flow confidence and colour trust.
  const halfOk = !!gl.getExtension("EXT_color_buffer_float");
  const colorTex = (w, h, half) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const makeTarget = (w, h, subject) => {
    const half = subject && halfOk;
    const t = colorTex(w, h, half);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    let rb = null;
    let cover = null;
    if (subject) {
      cover = colorTex(w, h, false);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, cover, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, cover, fbo, rb };
  };
  const freeTargets = () => {
    for (const k of Object.keys(targets)) {
      const t = targets[k];
      gl.deleteTexture(t.tex);
      if (t.cover) gl.deleteTexture(t.cover);
      gl.deleteFramebuffer(t.fbo);
      if (t.rb) gl.deleteRenderbuffer(t.rb);
      delete targets[k];
    }
  };

  let dirty = true;
  const box = { w: 1, h: 1, dpr: 1, pw: 1, ph: 1 };
  const frame = { x: 0, y: 0, w: 1, h: 1 };
  stage.onResize((w, h, dpr) => {
    Object.assign(box, { w, h, dpr, pw: Math.round(w * dpr), ph: Math.round(h * dpr) });
    // a large print, centred, on black
    const a = VIEW[2] / VIEW[3];
    const narrow = w < 640;
    const fw = Math.min(narrow ? w - 32 : w * 0.9, h * (narrow ? 0.9 : 0.84) * a);
    const fh = fw / a;
    Object.assign(frame, { w: fw, h: fh, x: (w - fw) / 2, y: (h - fh) / 2 });
    freeTargets();
    targets.scene = makeTarget(box.pw, box.ph, false);
    targets.a = makeTarget(box.pw, box.ph, true);
    targets.b = makeTarget(box.pw, box.ph, true);
    film.resize(box.pw, box.ph);
    dirty = true;
  });

  // ---- state
  let t = still ? clamp(tQ ?? 0.5, 0, 1) : 0;
  let tVel = 0;
  let tTarget = t;
  let springing = false;
  let drag = null;
  let cam = still ? clamp(camQ ?? (t - 0.5) * 2, -1, 1) : -1;
  let camVel = 0;
  let exposureAge = still ? 1e9 : 0;
  let intro = still || reduce ? null : { age: 0 };
  let grainT = 0;
  let grainSeed = 1;
  let time = 0;

  // ---- input: drag across the frame scrubs the half second, 1:1
  const span = () => Math.max(frame.w * 1.1, 340);
  stage.on("down", (p) => {
    intro = null;
    drag = { x0: p.x, t0: t };
    springing = false;
    tVel = 0;
    stage.canvas.style.cursor = "grabbing";
    dirty = true;
  });
  stage.on("move", () => {
    if (!drag) return;
    const raw = drag.t0 + (stage.pointer.x - drag.x0) / span();
    const c = clamp(raw, 0, 1);
    t = c + rubber(raw - c) * 0.35;
    dirty = true;
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    stage.canvas.style.cursor = "grab";
    // carry the release velocity with friction (tau 220 ms), then settle
    tVel = p.vx / span();
    tTarget = clamp(t + tVel * 0.22, 0, 1);
    springing = true;
    dirty = true;
  });
  const onKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") tTarget = clamp(Math.round((tTarget + 0.125) * 8) / 8, 0, 1);
    else if (e.key === "ArrowLeft") tTarget = clamp(Math.round((tTarget - 0.125) * 8) / 8, 0, 1);
    else return;
    intro = null;
    springing = true;
    e.preventDefault();
  };
  if (!embedded && !still) window.addEventListener("keydown", onKey);

  // ---- camera: an orbit round a point PIVOT metres out
  const camera = (c, breathX, breathY) => {
    const cx = c * ORBIT_X + breathX;
    // a shallow arc: the camera rises a little through the middle of its travel
    const cy = -ORBIT_Y * (1 - c * c) + ORBIT_Y * 0.5 + breathY;
    const C = [cx, cy, 0];
    const f = norm([-cx, -cy, PIVOT]);
    const r = norm(cross([0, 1, 0], f));
    const d = cross(f, r);
    return { C, r, d, f };
  };

  const setProjection = (u, cm, w, h) => {
    gl.uniform2f(u.uSize, PW, PH);
    gl.uniform4f(u.uView, VIEW[0], VIEW[1], VIEW[2], VIEW[3]);
    gl.uniform1f(u.uF, scene.f);
    gl.uniform2f(u.uC, scene.c[0], scene.c[1]);
    gl.uniform3fv(u.uRx, cm.r);
    gl.uniform3fv(u.uRy, cm.d);
    gl.uniform3fv(u.uRz, cm.f);
    gl.uniform3fv(u.uCam, cm.C);
    const dpr = box.dpr;
    gl.uniform4f(u.uFrame, frame.x * dpr, frame.y * dpr, frame.w * dpr, frame.h * dpr);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uZoom, ZOOM);
  };

  const render = () => {
    if (!targets.scene) return;
    const { pw, ph } = box;
    const breath = reduce || still ? [0, 0] : [0.006 * Math.sin((time * 2 * Math.PI) / 11), 0.004 * Math.sin((time * 2 * Math.PI) / 13.7 + 1.3)];
    const cm = camera(cam, breath[0], breath[1]);
    const tt = clamp(t, 0, 1);

    // 1. the jumper, each shutter frame in its own buffer. Only the part of
    // the screen he can reach is touched (his rect, grown by his flow and
    // the orbit), which keeps the two extra passes cheap.
    const m = scene.subject.flowRange + 90;
    const toScreen = (px, py) => [
      frame.x + (((px - VIEW[0]) / VIEW[2] - 0.5) * ZOOM + 0.5) * frame.w,
      frame.y + (((py - VIEW[1]) / VIEW[3] - 0.5) * ZOOM + 0.5) * frame.h,
    ];
    const [sx0, sy0] = toScreen(rect[0] - m, rect[1] - m);
    const [sx1, sy1] = toScreen(rect[2] + m, rect[3] + m);
    const dpr = box.dpr;
    const cx0 = clamp(Math.floor(Math.max(sx0, frame.x) * dpr), 0, pw);
    const cx1 = clamp(Math.ceil(Math.min(sx1, frame.x + frame.w) * dpr), 0, pw);
    const cy0 = clamp(Math.floor(Math.max(sy0, frame.y) * dpr), 0, ph);
    const cy1 = clamp(Math.ceil(Math.min(sy1, frame.y + frame.h) * dpr), 0, ph);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(cx0, ph - cy1, Math.max(0, cx1 - cx0), Math.max(0, cy1 - cy0));
    gl.useProgram(progSubj.p);
    gl.bindVertexArray(gSubj.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    setProjection(progSubj.u, cm, pw, ph);
    gl.uniform4f(progSubj.u.uRect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform1f(progSubj.u.uRange, scene.subject.flowRange);
    gl.uniform1f(progSubj.u.uDMax, scene.dmax);
    gl.uniform1i(progSubj.u.uTex, 0);
    gl.uniform1i(progSubj.u.uMotion, 1);
    gl.uniform1i(progSubj.u.uMotionO, 2);
    gl.uniform1i(progSubj.u.uTexO, 3);
    for (const k of ["a", "b"]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[k].fbo);
      gl.viewport(0, 0, pw, ph);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[k]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, k === "a" ? tex.ma : tex.mb);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, k === "a" ? tex.mb : tex.ma);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, k === "a" ? tex.b : tex.a);
      // raw t: past either end the motion carries on a little (rubber band)
      gl.uniform1f(progSubj.u.uW, k === "a" ? t : 1 - t);
      gl.uniform1f(progSubj.u.uDScale, k === "a" ? 1 + (S - 1) * tt : 1 / S + (1 - 1 / S) * tt);
      gl.drawElements(gl.TRIANGLES, gSubj.count, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);

    // 2. sky, then the near layer, into the scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.fbo);
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progLayer.p);
    setProjection(progLayer.u, cm, pw, ph);
    gl.uniform1i(progLayer.u.uTex, 0);
    gl.uniform1i(progLayer.u.uDepth, 1);
    gl.uniform1f(progLayer.u.uDMax, scene.dmax);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.depth);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.sky);
    gl.uniform1f(progLayer.u.uUseDepth, 0);
    gl.bindVertexArray(gSky.vao);
    gl.drawElements(gl.TRIANGLES, gSky.count, gl.UNSIGNED_INT, 0);
    gl.bindTexture(gl.TEXTURE_2D, tex.near);
    gl.uniform1f(progLayer.u.uUseDepth, 1);
    gl.bindVertexArray(gNear.vao);
    gl.drawElements(gl.TRIANGLES, gNear.count, gl.UNSIGNED_INT, 0);

    // 3. the jumper over it: one matte (the trusted union), colour blended inside it
    gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(progBlend.p);
    gl.bindVertexArray(quadVao);
    for (const [unit, t2] of [targets.a.tex, targets.b.tex, targets.a.cover, targets.b.cover].entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t2);
    }
    gl.uniform1i(progBlend.u.uA, 0);
    gl.uniform1i(progBlend.u.uB, 1);
    gl.uniform1i(progBlend.u.uCA, 2);
    gl.uniform1i(progBlend.u.uCB, 3);
    gl.uniform1f(progBlend.u.uT, tt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);

    // 4. develop: opens overexposed and settles as the eye adjusts
    const k = clamp(exposureAge / (reduce ? 0.3 : 2.1), 0, 1);
    const ease = 1 - Math.pow(1 - k, 4);
    const exposure = 0.12 + (reduce ? 0 : 2.4 * (1 - ease));
    film.render(targets.scene.tex, { ...FILM, exposure, grainSeed });

    // the ground round the print stays clean black
    const fx0 = Math.round(frame.x * dpr);
    const fy0 = Math.round(frame.y * dpr);
    const fx1 = Math.round((frame.x + frame.w) * dpr);
    const fy1 = Math.round((frame.y + frame.h) * dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    for (const [x, y, w, h] of [
      [0, 0, pw, fy0],
      [0, fy1, pw, ph - fy1],
      [0, fy0, fx0, fy1 - fy0],
      [fx1, fy0, pw - fx1, fy1 - fy0],
    ]) {
      if (w <= 0 || h <= 0) continue;
      gl.scissor(x, ph - y - h, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
  };

  // ---- frame loop
  const OMEGA = (2 * Math.PI) / 0.55; // time spring
  const ZETA = 0.86;
  const CAM_OMEGA = (2 * Math.PI) / 1.1; // the camera trails, softer
  const CAM_ZETA = 0.9;
  stage.onFrame((dt) => {
    let active = !!drag;
    if (!still) time += dt;

    // reveal: the half second plays once, slowly, from the first press to
    // just short of the middle, and hands over
    if (intro) {
      intro.age += dt;
      if (intro.age > 0.5) {
        const k = clamp((intro.age - 0.5) / 2.2, 0, 1);
        t = 0.42 * (1 - Math.pow(1 - k, 3));
        if (k >= 1) intro = null;
      }
      active = true;
    }

    if (springing && !drag) {
      const n = 4;
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const acc = -OMEGA * OMEGA * (t - tTarget) - 2 * ZETA * OMEGA * tVel;
        tVel += acc * h;
        t += tVel * h;
      }
      if (Math.abs(t - tTarget) < 1e-4 && Math.abs(tVel) < 1e-3) {
        t = tTarget;
        tVel = 0;
        springing = false;
      }
      active = true;
    }

    if (!still) {
      const camTarget = (clamp(t, 0, 1) - 0.5) * 2;
      const n = 4;
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const acc = -CAM_OMEGA * CAM_OMEGA * (cam - camTarget) - 2 * CAM_ZETA * CAM_OMEGA * camVel;
        camVel += acc * h;
        cam += camVel * h;
      }
      if (Math.abs(cam - camTarget) > 1e-4 || Math.abs(camVel) > 1e-4) active = true;
      if (!reduce) active = true; // breathing
    }

    if (exposureAge < 3) {
      exposureAge += dt;
      active = true;
    }

    // grain at 24 fps
    if (!still) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        active = true;
      }
    }

    if (active || dirty) {
      render();
      dirty = false;
    }
  });

  return {
    destroy() {
      if (!embedded && !still) window.removeEventListener("keydown", onKey);
      film.destroy();
      freeTargets();
      for (const k of Object.keys(tex)) gl.deleteTexture(tex[k]);
      gSky.free();
      gNear.free();
      gSubj.free();
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(quadVao);
      for (const p of [progLayer, progSubj, progBlend]) gl.deleteProgram(p.p);
      stage.destroy();
    },
  };
}
