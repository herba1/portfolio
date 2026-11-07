import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createWind, GX, GY, GY0 } from "./wind";

// Kaze: lying in the long grass in July, looking up, and the wind is yours.
//
// The photograph is taken from inside the grass: the camera at blade height,
// pitched up, tall brome and seed heads standing against a summer sky with
// sunlit cumulus. Brush across it and the stroke becomes a gust: a small
// stable-fluids velocity field (wind.js) carries it on through the stalks,
// each one a damped spring that lies over under it and swings back with a
// little overshoot. What you see is the bend itself: the grass is its own
// layer, unmixed from the sky in the bake (plate.webp, coverage in aux.webp),
// and every pixel of it is displaced by the local bend times its lever, how
// far it sits from the roots below the frame and how freely it stands (a lone
// seed head swings, the dense mat at the bottom barely moves). Since the base
// of a stalk hardly moves and its tip moves most, a smooth displacement field
// reads as stalks bending, not sliding, and they cross the clouds as they go.
//
// The sky behind (sky.webp, the photograph where it is surely sky and filled
// behind the grass) drifts with a two-phase flow map (Vlachos 2010), faster
// toward the zenith, and the clouds lean after your gusts.
//
// Query: ?gust=demo throws a scripted gust; ?t=seconds runs the wind that long
// at a fixed step and holds it (a still); ?breeze=0..2 scales the idle air;
// ?still=1 skips the reveal; ?debug=bend shows the bend field.

const PLATE = "/lab/kaze/plate.webp";
const SKY = "/lab/kaze/sky.webp";
const AUX = "/lab/kaze/aux.webp";
const ASPECT = 1.5;
// The frame shows the middle of the photograph: a margin all round that the
// bent stalks and the drifting sky can be pulled in from.
const OVER = 0.035;

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
uniform sampler2D uPlate;  // the grass, sky unmixed out of it
uniform sampler2D uSky;    // the sky behind it
uniform sampler2D uAux;    // r coverage, g lever, b highlight diffusion (sqrt)
uniform sampler2D uWind;   // GX x GY: bend.xy, wind.xy (m/s)
uniform float uTime;
uniform float uCloudT;     // cloud flow clock
uniform vec2 uCloudV;      // cloud drift at the top of the frame, uv / s
uniform float uExpo;
uniform float uLod;
uniform float uDebug;
uniform vec4 uView;        // the part of the image on screen: x0, y0, w, h (uv)

const vec2 GRID = vec2(${GX}.0, ${GY}.0);
const float GY0 = ${GY0.toFixed(3)};

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// Cubic B-spline sample of the wind grid from four bilinear taps, so the
// 96x64 field has no visible cells or creases in the bend.
vec4 windAt(vec2 uv) {
  vec2 g = vec2(uv.x, (uv.y - GY0) / (1.0 - GY0)) * GRID - 0.5;
  vec2 i = floor(g);
  vec2 f = g - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / s0 + 0.5) / GRID;
  vec2 h1 = (i + 1.0 + w3 / s1 + 0.5) / GRID;
  return (texture(uWind, vec2(h0.x, h0.y)) * s0.x + texture(uWind, vec2(h1.x, h0.y)) * s1.x) * s0.y
       + (texture(uWind, vec2(h0.x, h1.y)) * s0.x + texture(uWind, vec2(h1.x, h1.y)) * s1.x) * s1.y;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 uv = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;

  // ---- the stalks ----
  vec4 W = windAt(uv);
  vec2 b = W.xy;          // bend: across (+ right), and up-wind / lifting (+)
  float ws = length(W.zw);
  float lever = textureLod(uAux, uv, 0.0).g;
  // Flutter: the thin leaves and seed heads quiver in the stronger air, a
  // slow travelling ripple along the stalks rather than per-pixel noise.
  float fl = vnoise(uv * vec2(14.0, 7.0) + vec2(-uTime * (0.6 + 0.12 * ws), uTime * 0.21)) - 0.5;
  float flAmt = smoothstep(1.5, 9.0, ws);
  // A stalk bends about its root, below the frame: the tip goes downwind and,
  // as it lies over, comes down a little; air from below lifts it.
  vec2 d = vec2(b.x * 0.065 + fl * 0.007 * flAmt, 0.02 * dot(b, b) - 0.012 * b.y) * lever;
  vec2 gu = uv - d;
  float a = textureLod(uAux, gu, uLod).r;
  vec3 grass = toLin(textureLod(uPlate, gu, uLod).rgb);
  // Blades turned by the gust show their lit undersides a touch more.
  grass *= 1.0 + 0.18 * clamp(abs(b.x) * lever, 0.0, 1.0);

  // ---- the sky ----
  // Toward the zenith (the top of the frame) cloud is nearer overhead and
  // crosses faster; near the grass it barely moves.
  float k = 0.35 + 0.65 * pow(clamp(1.0 - uv.y, 0.0, 1.0), 1.2);
  vec2 v = uCloudV * k;
  const float CP = 18.0;
  float c0 = fract(uCloudT / CP);
  float c1 = fract(uCloudT / CP + 0.5);
  vec3 a0 = textureLod(uSky, uv - v * (c0 * CP), uLod).rgb;
  vec3 a1 = textureLod(uSky, uv - v * (c1 * CP), uLod).rgb;
  float cw = abs(1.0 - 2.0 * c0);
  vec3 sky = toLin(mix(a1, a0, cw));
  // The sky's grade (cyan-cobalt, deeper toward the zenith; skylight blue in
  // the cloud shadows) is baked into sky.webp; only a last breath of depth
  // toward the zenith here.
  float zen = smoothstep(0.9, 0.0, uv.y);
  float blue = smoothstep(0.02, 0.15, sky.b - sky.r);
  sky *= mix(vec3(1.0), vec3(0.94, 0.97, 1.0), blue * zen);
  // A print's white is not the sun's: the near-white of the lit cloud and
  // the sun's disc carry on past paper white, into the shoulder, warm.
  float hl = smoothstep(0.6, 1.0, max(sky.r, max(sky.g, sky.b)));
  sky *= 1.0 + vec3(0.3, 0.27, 0.2) * hl * hl;

  // The grass a touch cooler, the way Superia keeps greens under a deep sky;
  // its colour is left whole, so the diffusion veil over it bleeds green.
  grass *= vec3(0.96, 1.0, 0.98);
  // Halation on the blades: a thin blade standing against lit cloud or the
  // sun takes a little of its light through the emulsion as a warm bleed;
  // the dense mat (high coverage all round) does not.
  float glow = smoothstep(0.5, 1.1, dot(textureLod(uSky, uv - v * (c0 * CP), uLod + 3.0).rgb, vec3(0.2126, 0.7152, 0.0722)));
  float thin = 1.0 - textureLod(uAux, gu, uLod + 2.5).r;
  grass += vec3(1.0, 0.5, 0.22) * 0.1 * glow * thin;
  vec3 col = mix(sky, grass, a);
  // ...and its edge, where blade and bright sky share the pixel, carries the
  // thin warm ring: the light bounced back off the base, just past the edge.
  float rim = clamp(4.0 * a * (1.0 - a), 0.0, 1.0);
  col += vec3(1.0, 0.42, 0.16) * 0.16 * glow * rim;
  // The highlight shoulder's diffusion: only the light above the threshold
  // (the sun, the lit cloud tops; baked, aux.b) spreads, warm, over the sky
  // and a little over the blades in front of it, so they hold as dark
  // silhouettes with the sun bleeding round them. Nothing below it is lifted.
  float dif = textureLod(uAux, uv, uLod).b;
  dif *= dif;
  col += vec3(1.0, 0.8, 0.55) * 0.55 * dif * mix(1.0, 0.35, a);
  if (uDebug > 0.5) col = mix(col, vec3(1.0, 0.2, 0.1), clamp(length(b) * lever * 1.5, 0.0, 1.0) * a);
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

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// The scripted gust for ?gust=demo: a quick sweep through the stalks, left
// to right and rising, 0.2-0.75 s.
const DEMO = { t0: 0.2, t1: 0.75, from: [0.06, 0.74], to: [0.8, 0.42] };
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

  const [plateImg, skyImg, auxImg] = await Promise.all([loadImage(PLATE), loadImage(SKY), loadImage(AUX)]);
  const plate = imageTexture(gl, plateImg, true);
  const skyTex = imageTexture(gl, skyImg, true);
  const aux = imageTexture(gl, auxImg, true);

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
  const film = createFilm(gl, { width: 2, height: 2 });

  // Layout: the photograph covers the box, full bleed, cropped to its aspect
  // (css px of the box).
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
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
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
  };
  // The part of the photograph on screen, in image uv: cover-crop to the
  // box, inside the overscan margin.
  const view = () => {
    const a = L.w / L.h;
    let v = a > ASPECT ? [0, 0.5 - ASPECT / a / 2, 1, ASPECT / a] : [0.5 - a / ASPECT / 2, 0, a / ASPECT, 1];
    const k = 1 - 2 * OVER;
    return [OVER + v[0] * k, OVER + v[1] * k, v[2] * k, v[3] * k];
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
      const a = demoAt(t - dt);
      const b = demoAt(t);
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

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const u = scene.u;
    gl.useProgram(scene.p);
    const texs = [plate, skyTex, aux, windTex];
    const names = ["uPlate", "uSky", "uAux", "uWind"];
    texs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[names[i]], i);
    });
    gl.uniform1f(u.uTime, simT);
    gl.uniform1f(u.uCloudT, cloudT);
    // ~1% of the frame per 10 s overhead, plus the gusts' lean: a strong
    // gust run across the grass sets the clouds going visibly faster its way
    // for a while after
    const lean = reduce ? 0 : clamp(0.00045 * cloudLean, -0.0009, 0.0009);
    gl.uniform2f(u.uCloudV, reduce ? 0 : 0.0009 + lean, reduce ? 0 : -0.00006);
    gl.uniform1f(u.uExpo, 1.0 * 2 ** expoStops);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2((2400 * view()[2]) / L.rw)));
    gl.uniform1f(u.uDebug, debug);
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
        // highlight shoulder (aux.b), so the blacks stay down and the grass
        // keeps its colour. A little optical softness and dye-cloud bleed,
        // and a halation threshold low enough that the cloud tops and the
        // sunlit edges of the blades against them take a thin warm ring.
        // The sky's depth is in the bake, so the stock's blue deepening is
        // kept light.
        bloom: 0,
        softness: 0.45,
        halation: 0.6,
        halationThreshold: 0.6,
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
      [plate, skyTex, aux, windTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
