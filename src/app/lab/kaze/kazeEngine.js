import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createWind, GX, GY } from "./wind";
import { buildGrass, camera, GRASS_VERT, GRASS_FRAG } from "./grass";

// Kaze: lying in the long grass in July, looking up, and the wind is yours.
//
// You lie in the grass and look up: a wide stereographic lens 4 cm off the
// ground, the zenith just past the top of the frame, so every stalk grows up
// from below the bottom edge and runs in toward it, the nearest long, the
// field behind a low fringe (grass.js). Brush across it and the stroke becomes
// a gust: a small stable-fluids velocity field (wind.js) carries it on through
// the stalks, each one a damped spring that lies over under it and swings back
// with a little overshoot. The grass is geometry, drawn opaque with 4x MSAA:
// three culms with seed heads at your shoulder stand sharp and near-black
// against the sky, the rest sits a touch diffused behind them, and the only
// warm in it is the thin halation ring where a blade crosses the sun.
//
// The sky behind (sky.webp) is a real summer cumulus sky cut from an HDRI
// looking up into the dome, aimed so its sun sits on the photograph's
// (tools/depth/bakes/kaze/sky_hdri.py): sunlit warm-white domes, skylight-blue
// shaded flanks. It drifts with a two-phase flow map (Vlachos 2010), faster
// toward the zenith, and the clouds lean after your gusts.
//
// Query: ?gust=demo throws a scripted gust; ?t=seconds runs the wind that long
// at a fixed step and holds it (a still); ?breeze=0..2 scales the idle air;
// ?still=1 skips the reveal; ?debug=bend tints the grass by its bend.

const SKY = "/lab/kaze/sky.webp";
const ASPECT = 1.5;
// The sky's frame, in the image uv it and the wind grid share: from just under
// its top edge down through about two thirds of it, toward the left where the
// sun is. OVER is the margin kept all round for the drifting sky to be pulled
// in from; the crop window is cover-fitted to the box, held to its top edge.
const OVER = 0.02;
const CROP = { x0: OVER, y0: OVER, w: 1 - 2 * OVER, h: 0.68, ax: 0.05 };
// The sun's disc in the photograph (image uv): the centroid of its clipped
// pixels in sky.webp, about 0.031 image heights across in radius.
const SUN = [0.145, 0.2318];

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSky;    // the sky
uniform sampler2D uRest;   // the grass behind, half res, premultiplied linear
uniform sampler2D uNear;   // the anchors, full res, premultiplied linear
uniform float uCloudT;     // cloud flow clock
uniform vec2 uCloudV;      // cloud drift at the top of the frame, uv / s
uniform float uExpo;
uniform vec2 uSkyLod;      // the sky's own: x its sharp level, y uLod at its size (for the blurs)
uniform vec4 uView;        // the part of the image on screen: x0, y0, w, h (uv)

const vec2 SUN = vec2(${SUN[0].toFixed(4)}, ${SUN[1].toFixed(4)});

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

void main() {
  vec2 uv = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;

  // ---- the sky ----
  // Toward the zenith (the top of the frame) cloud is nearer overhead and
  // crosses faster; near the grass it barely moves.
  float k = 0.35 + 0.65 * pow(clamp(1.0 - uv.y, 0.0, 1.0), 1.2);
  vec2 v = uCloudV * k;
  const float CP = 18.0;
  float c0 = fract(uCloudT / CP);
  float c1 = fract(uCloudT / CP + 0.5);
  vec3 a0 = textureLod(uSky, uv - v * (c0 * CP), uSkyLod.x).rgb;
  vec3 a1 = textureLod(uSky, uv - v * (c1 * CP), uSkyLod.x).rgb;
  float cw = abs(1.0 - 2.0 * c0);
  vec3 sky = toLin(mix(a1, a0, cw));
  // ---- the sky's grade (the sky layer only; the grass is never touched) ----
  // Distance from the sun, in image heights. The sun stands still while the
  // clouds drift past it, so round it the sky is read where it was shot.
  vec2 sd = (uv - SUN) * vec2(${ASPECT.toFixed(2)}, 1.0);
  float r = length(sd);
  // Right at the sun the HDRI's core is clipped (sky_hdri.py holds it to the
  // brightest cloud); within a radius or two it is read softened, so the
  // clipped core melts into a smooth mound for the glow below to sit on,
  // and the cloud round it keeps its own texture.
  vec3 near = toLin(textureLod(uSky, uv, uSkyLod.y + 3.0).rgb);
  sky = mix(sky, near, exp(-r * r / (2.0 * 0.025 * 0.025)));
  // No local-contrast lift and no veil removal: the cumulus are real and
  // already modelled, and a lift against a wide blur rings every cloud edge
  // with a dark halo against the blue.
  // How much of a pixel is open blue sky rather than cloud: the blue's lead
  // over red, in linear light. Linear in the colour, so a cloud's edge, half
  // blue and half white, takes half the grade and no contour forms there.
  float blue = clamp((sky.b - sky.r) / 0.4, 0.0, 1.0);
  float Y = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  // The lit cloud is pale warm white: the bake already turns the sunlit
  // domes warm and the shaded flanks skylight blue; this only holds the
  // brightest tops off the blue the film adds.
  float lit = smoothstep(0.45, 0.85, Y) * (1.0 - blue);
  sky = mix(sky, Y * vec3(1.03, 1.0, 0.93), 0.25 * lit);
  // Midtone saturation, about a quarter more: the blue and the grey-blue of
  // the cloud shadows; the lit cloud tops above stay pale.
  float mid = smoothstep(0.015, 0.08, Y) * (1.0 - smoothstep(0.3, 0.65, Y));
  sky = max(vec3(Y) + (sky - vec3(Y)) * (1.0 + 0.25 * mid), vec3(0.0));
  // The zenith: straight up the sky is deepest. The HDRI already falls off
  // toward it; this only leans the top of the frame a little further, toward
  // a clean film blue rather than slate. Multiplied, so the sky's own
  // gradient runs on through it.
  float zen = 1.0 - smoothstep(0.02, 0.58, uv.y);
  zen *= zen;
  sky *= mix(vec3(1.0), vec3(0.72, 0.9, 1.0), 0.7 * zen * blue);
  // A print's white is not the sun's: the near-white of the lit cloud carries
  // on past paper white, into the shoulder, pale warm. Away from the sun only;
  // the sun's own light is the glow below.
  float hl = smoothstep(0.55, 1.0, max(sky.r, max(sky.g, sky.b)));
  sky *= 1.0 + vec3(0.2, 0.18, 0.14) * hl * hl * smoothstep(0.06, 0.2, r);
  // The sun: a small hot core and a smooth exponential roll-off, three
  // widths summed, warm white, added over the sky so the cloud texture runs
  // on through it, with no edge anywhere for a ring to form on.
  vec3 sunC = vec3(1.0, 0.9, 0.74);
  sky += sunC * (1.6 * exp(-r / 0.012) + 0.42 * exp(-r / 0.045) + 0.1 * exp(-r / 0.15));

  // ---- the grass, over it ----
  // Both layers are premultiplied coverage straight from the MSAA resolve:
  // a blade's edge is only ever the blade and the sky behind, never a matte.
  vec4 gr = texture(uRest, vUv);
  vec4 gn = texture(uNear, vUv);
  vec3 col = sky * (1.0 - gr.a) + gr.rgb;
  col = col * (1.0 - gn.a) + gn.rgb;
  float a = 1.0 - (1.0 - gr.a) * (1.0 - gn.a);
  // Halation, the only warm in the grass: where a dark blade crosses the sun,
  // the sun's light bounced back off the film base spills a few pixels in
  // over the dark edge of the blade as a thin red-orange ring (the coverage
  // here less the coverage a few pixels round: only the blade's rim), and
  // nowhere else. Round the sun the sky is clipped white anyway; the ring
  // shows on the dark side, as it does on film.
  float ab = 1.0 - (1.0 - textureLod(uRest, vUv, 1.0).a) * (1.0 - textureLod(uNear, vUv, 2.0).a);
  // (a sliver thinner than the ring is left alone: all rim, it would only
  // turn brown)
  float ring = clamp(a - ab, 0.0, 1.0) * smoothstep(0.55, 0.95, a);
  float sunK = exp(-r / 0.04);
  col += vec3(1.0, 0.36, 0.12) * 3.5 * ring * sunK;
  // The highlight shoulder's diffusion: only the light above the threshold
  // (the lit cloud tops, read from the drifting sky heavily blurred, so the
  // bloom goes with its cloud) spreads, warm, over the sky and never over the
  // blades in front of it, so they hold as crisp dark silhouettes. Nothing
  // below it is lifted. Round the sun it is the analytic glow above.
  vec3 h0 = textureLod(uSky, uv - v * (c0 * CP), uSkyLod.y + 5.0).rgb;
  vec3 h1 = textureLod(uSky, uv - v * (c1 * CP), uSkyLod.y + 5.0).rgb;
  float dif = smoothstep(0.5, 0.9, dot(toLin(mix(h1, h0, cw)), vec3(0.2126, 0.7152, 0.0722)));
  dif *= dif * 0.6 * smoothstep(0.08, 0.35, r);
  col += vec3(1.0, 0.8, 0.55) * 0.55 * dif * (1.0 - a);
  outColor = vec4(col * uExpo, 1.0);
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float, mips = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
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
  if (t.rb) gl.deleteRenderbuffer(t.rb);
  if (t.res) freeTarget(gl, t.res);
};

// A 4x multisampled layer for the grass, resolved into a mipmapped texture
// of the same format (the mips feed the halation ring).
function msaaTarget(gl, w, h, float) {
  const fmt = float ? gl.RGBA16F : gl.RGBA8;
  const max = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES);
  const samples = Math.min(4, (max && max[0]) || 0);
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const res = target(gl, w, h, float, true);
  return { rb, fbo, res, w, h, ok: ok && res.ok, tex: null };
}

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// The scripted gust for ?gust=demo: a quick sweep through the stalks, left
// to right and rising, 0.2-0.75 s (frame fractions, mapped through the view).
const DEMO = { t0: 0.2, t1: 0.75, from: [0.04, 0.7], to: [0.86, 0.36] };
const demoAt = (t) => {
  const u = clamp((t - DEMO.t0) / (DEMO.t1 - DEMO.t0), 0, 1);
  const e = u * u * (3 - 2 * u);
  const x = DEMO.from[0] + (DEMO.to[0] - DEMO.from[0]) * e;
  const y = DEMO.from[1] + (DEMO.to[1] - DEMO.from[1]) * e - Math.sin(e * Math.PI) * 0.035;
  return [x, y];
};

export async function createKaze(host) {
  const q = new URLSearchParams(window.location.search);
  const timeQ = q.get("t");
  const frozen = timeQ != null && timeQ !== "" && Number.isFinite(+timeQ);
  const still = frozen || q.get("still") === "1";
  const demo = q.get("gust") === "demo";
  const breezeQ = q.get("breeze");
  const debug = q.get("debug") === "bend" ? 1 : 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const skyImg = await loadImage(SKY);
  const skyTex = imageTexture(gl, skyImg, true);

  const wind = createWind();
  const breeze = reduce ? 0 : breezeQ != null && Number.isFinite(+breezeQ) ? clamp(+breezeQ, 0, 2) : 1;
  wind.setBreeze(breeze);

  const windTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, windTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, GX, GY, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uploadWind = () => {
    gl.bindTexture(gl.TEXTURE_2D, windTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GX, GY, gl.RGBA, gl.FLOAT, wind.pack());
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);

  // The grass: two layers of world-space ribbons (grass.js).
  const grassP = program(gl, GRASS_VERT, GRASS_FRAG);
  const grassGeo = buildGrass();
  const ATTRS = [
    ["aP", 3, 0],
    ["aS", 3, 3],
    ["aTip", 3, 6],
    ["aCol", 3, 9],
    ["aK", 3, 12],
  ];
  const layerVao = (geo) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
    for (const [name, size, off] of ATTRS) {
      const loc = gl.getAttribLocation(grassP.p, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 15 * 4, off * 4);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vb, ib, count: geo.count };
  };
  const layers = { near: layerVao(grassGeo.near), rest: layerVao(grassGeo.rest) };
  const film = createFilm(gl, { width: 2, height: 2 });

  // Layout: the photograph covers the box, full bleed, cropped to its aspect
  // (css px of the box).
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let nearT = null;
  let restT = null;
  let cam = camera(16, 10);
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    Object.assign(L, { x: 0, y: 0, w: W, h: H });
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    freeTarget(gl, nearT);
    freeTarget(gl, restT);
    cam = camera(W, H);
    // the anchors at full resolution, the rest at half (its diffusion)
    nearT = msaaTarget(gl, L.rw, L.rh, floatOk);
    if (!nearT.ok) {
      freeTarget(gl, nearT);
      nearT = msaaTarget(gl, L.rw, L.rh, false);
    }
    const hw = Math.max(2, Math.round(L.rw / 2));
    const hh = Math.max(2, Math.round(L.rh / 2));
    restT = msaaTarget(gl, hw, hh, floatOk);
    if (!restT.ok) {
      freeTarget(gl, restT);
      restT = msaaTarget(gl, hw, hh, false);
    }
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
  };
  // The part of the photograph on screen, in image uv: the crop window
  // cover-fitted to the box, held to its top edge (the zenith side) and
  // placed across it at CROP.ax.
  const view = () => {
    const a = L.w / L.h;
    const ca = (CROP.w * ASPECT) / CROP.h;
    if (a > ca) {
      const h = (CROP.w * ASPECT) / a;
      return [CROP.x0, CROP.y0, CROP.w, h];
    }
    const w = (CROP.h * a) / ASPECT;
    return [CROP.x0 + (CROP.w - w) * CROP.ax, CROP.y0, w, CROP.h];
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // pointer -> image uv
  const toUv = (px, py) => {
    const v = view();
    return [v[0] + ((px - L.x) / L.w) * v[2], v[1] + ((py - L.y) / L.h) * v[3]];
  };

  // Brushing: every move over the print is a stroke; a held drag blows
  // harder than a passing hover.
  let last = null;
  let lastT = 0;
  const brush = (ptr) => {
    const now = performance.now();
    const [u, v] = toUv(ptr.x, ptr.y);
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    if (!inside) {
      last = null;
      return;
    }
    if (last && now - lastT < 120) {
      const dt = Math.max(0.008, (now - lastT) / 1000);
      const vx = (u - last[0]) / dt;
      const vy = (v - last[1]) / dt;
      wind.stroke(last[0], last[1], u, v, vx, vy, ptr.down ? 1 : 0.55);
    }
    last = [u, v];
    lastT = now;
  };
  stage.on("down", (p) => {
    last = null;
    brush(p);
  });
  stage.on("move", brush);
  stage.on("up", () => {
    last = null;
  });

  let cloudT = 0;
  let grainClock = 0;
  let grainSeed = 0;
  let cloudLean = 0;
  const STEP = 1 / 60;

  const advance = (dt, t) => {
    // the scripted gust
    if (demo && t >= DEMO.t0 && t - dt <= DEMO.t1 + 0.02) {
      const v = view();
      const img = (p) => [v[0] + p[0] * v[2], v[1] + p[1] * v[3]];
      const a = img(demoAt(t - dt));
      const b = img(demoAt(t));
      wind.stroke(a[0], a[1], b[0], b[1], (b[0] - a[0]) / dt, (b[1] - a[1]) / dt, 1);
    }
    wind.step(dt);
    // the clouds lean a little after the gusts, a long way behind
    cloudLean += (wind.gustMean - cloudLean) * (1 - Math.exp(-dt / 4));
    cloudT += dt;
  };

  let simT = 0;
  if (frozen) {
    const T = clamp(+timeQ, 0, 60);
    while (simT < T - 1e-6) {
      simT += STEP;
      advance(STEP, simT);
    }
    grainSeed = 7;
  }
  uploadWind();

  // One grass layer into its MSAA target, premultiplied over clear, then
  // resolved and mipmapped.
  const drawGrass = (layer, T) => {
    const u = grassP.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, T.w, T.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(grassP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, windTex);
    gl.uniform1i(u.uWind, 0);
    gl.uniform3fv(u.uCam, cam.pos);
    gl.uniform3fv(u.uR, cam.r);
    gl.uniform3fv(u.uU, cam.u);
    gl.uniform3fv(u.uF, cam.f);
    gl.uniform2fv(u.uK, cam.k);
    gl.uniform2f(u.uRes, T.w, T.h);
    const v = view();
    gl.uniform4f(u.uView, v[0], v[1], v[2], v[3]);
    gl.uniform1f(u.uTime, simT);
    gl.uniform1f(u.uDebug, debug);
    gl.uniform2f(u.uSun, ((SUN[0] - v[0]) / v[2]) * 2 - 1, 1 - ((SUN[1] - v[1]) / v[3]) * 2);
    gl.uniform1f(u.uAspect, L.w / L.h);
    gl.bindVertexArray(layer.vao);
    gl.drawElements(gl.TRIANGLES, layer.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.res.fbo);
    gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, T.w, T.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, T.res.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  const draw = (expoStops, fade) => {
    gl.disable(gl.SCISSOR_TEST);
    drawGrass(layers.rest, restT);
    drawGrass(layers.near, nearT);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const u = scene.u;
    gl.useProgram(scene.p);
    const texs = [skyTex, restT.res.tex, nearT.res.tex];
    const names = ["uSky", "uRest", "uNear"];
    texs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[names[i]], i);
    });
    gl.uniform1f(u.uCloudT, cloudT);
    // ~1% of the frame per 10 s overhead, plus the gusts' lean: a strong
    // gust run across the grass sets the clouds going visibly faster its way
    // for a while after
    const lean = reduce ? 0 : clamp(0.00045 * cloudLean, -0.0009, 0.0009);
    gl.uniform2f(u.uCloudV, reduce ? 0 : 0.0009 + lean, reduce ? 0 : -0.00006);
    gl.uniform1f(u.uExpo, 1.0 * 2 ** expoStops);
    // the sky is baked finer than the old 2400 px plate its frame is
    // measured against (sky_hdri.py), for the magnified crop on a wide screen
    const skyK = Math.log2(skyImg.naturalWidth / 2400);
    gl.uniform2f(u.uSkyLod, Math.max(0, Math.log2((skyImg.naturalWidth * view()[2]) / L.rw)), Math.max(0, Math.log2((2400 * view()[2]) / L.rw)) + skyK);
    const v = view();
    gl.uniform4f(u.uView, v[0], v[1], v[2], v[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        // No global veil: the diffusion is the scene's own thresholded
        // highlight shoulder (the lit cloud tops), so the blacks stay down and the grass
        // keeps its colour. A little optical softness and dye-cloud bleed.
        // The stock's own halation only answers the sun itself (the lit
        // cloud tops stay under its threshold, so no warm creeps onto the
        // blades crossing them); the thin ring where a blade crosses the sun
        // is drawn in the scene. The sky's depth is in the bake, so the stock's blue deepening is
        // kept light.
        bloom: 0,
        softness: 0.45,
        halation: 0.3,
        halationThreshold: 1.6,
        halationColor: [1, 0.32, 0.12],
        halationLocal: 0.4,
        contrast: 1.14,
        toe: 0.022,
        blueDepth: 0.25,
        saturation: 1.1,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        grainSeed,
      },
      filmT.fbo,
    );

    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up overexposed, airy white-blue, and the sky
  // deepens into cobalt over two seconds as the eye adjusts.
  const REVEAL = 2.0;
  let age = 0;
  let acc = 0;
  let slow = 0;
  let lastNow = 0;
  let drawnFrozen = false;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (frozen) {
      if (drawnFrozen) return;
      drawnFrozen = true;
      draw(0, 1);
      return;
    }
    // Weak device: render the scene smaller and let the blit scale it.
    const r = Math.min(real, 0.25);
    slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
    if (slow > 1.2 && scale > 0.5) {
      scale = scale > 0.8 ? 0.75 : 0.5;
      slow = 0;
      if (lastBox) layout(...lastBox);
    }

    age += dt;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) {
      acc -= STEP;
      simT += STEP;
      advance(STEP, simT);
      n++;
    }
    if (n === 4) acc = 0;
    uploadWind();

    if (!reduce) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      freeTarget(gl, nearT);
      freeTarget(gl, restT);
      [skyTex, windTex].forEach((t) => gl.deleteTexture(t));
      for (const l of Object.values(layers)) {
        gl.deleteVertexArray(l.vao);
        gl.deleteBuffer(l.vb);
        gl.deleteBuffer(l.ib);
      }
      gl.deleteProgram(grassP.p);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
