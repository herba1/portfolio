import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createPluckSound } from "./pluck";
import { NODES, createWorld, locate, offsetAt, sampleY } from "./strings";

// Catenary: the overhead wires of a Japanese railway mast, photographed from
// underneath against summer cumulus, are real strings.
//
// Offline (tools/depth/bakes/catenary), six wires were found
// in the 6000 x 4000 photograph, each fitted as a catenary in image space
// from its insulator to where it leaves the frame (sub-pixel ridge, robust
// least squares, 0.05-0.4 px rms), and painted out of the plate: the low
// frequencies are bridged across the band from its two banks, the grain and
// cloud detail are borrowed from a parallel strip just outside. Each wire's
// optical profile was measured against that clean plate: width (along the
// span, perspective), blur and opacity (regressed on the depth map, so the
// far end softens with distance), and a shade across the cable (it is a lit
// cylinder: a sky-blue rim, a dark core, a glint). Recomposited at rest the
// wires land within 2-3 levels of the photograph at display size.
//
// Here each wire is a damped string of 97 nodes over its whole span (the far
// support is off frame): c = 2 L f1, a Kelvin-Voigt term that kills the high
// modes first, and both ends fixed, so a pluck splits into two pulses that
// run out, reflect at the insulators upside down and ring down into the low
// modes. The supports are not rigid: each structure (the mast, the far pole)
// is a stiff damped mass the wires pull on, so a hard pluck shows faintly in
// the neighbours. A slow, zero-mean breeze keeps them alive at rest. The
// wires are drawn analytically (erf of a blurred box, the measured shade) in
// linear light at device resolution, then the frame is developed through the
// shared film kit (summer).
//
// Query: ?still=1 (no breeze), ?pluck=<wire 0-5>&t=<seconds after release>
// [&at=<0..1 along the visible run>&amp=<0..1>], ?pull=<wire> holds the pull.
// Any numeric FILM key (exposure, whitePoint, ...) and warmTop override the grade.

const ASSET = "/lab/catenary/";
const WIDTH_TRIM = 0.6; // image px
const FOCUS = [0.85, 0.5]; // where a narrow screen crops toward: the feeder, the far pole


const FILM = {
  ...FILM_PRESETS.summer,
  exposure: 0,
  input: "linear",
  // A plate that is already a soft film scan: less extra veil. The sunlit
  // cloud is printed up to just under paper white (about 0.96, nothing at
  // 255) so it glows; the shoulder still rolls it off instead of clipping.
  bloom: 0.2,
  softness: 0.4,
  halation: 0.32,
  whitePoint: 1.1,
  contrast: 1.25,
  blueDepth: 0.85,
  saturation: 1.06,
  grain: 0.38,
  vignette: 0.2,
};
// Warm cast on the sunlit cloud tops (see PLATE): red up 0.8x this, blue
// down by it, eased in over the shoulder, so the brightest cloud rolls off
// warm-neutral instead of grey. The sky and its cobalt depth are untouched.
const WARM_TOP = 0.16;

const VERT_FULL = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const PLATE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPlate;
uniform vec2 uRes;   // device px
uniform vec3 uMap;   // ox, oy, k (device px per image px)
uniform vec2 uImg;   // image px
uniform vec3 uTopTint; // linear multiplier on the sunlit cloud
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = (p - uMap.xy) / uMap.z / uImg;
  vec3 c = texture(uPlate, uv).rgb;
  // Sunlit cloud tops: bright and near neutral. They take a warm cast on the
  // shoulder so they glow instead of reading grey; blue sky (chroma) and the
  // shade side of the cloud (luminance) are left as shot.
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float chroma = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-4);
  float top = smoothstep(0.45, 0.92, y) * (1.0 - smoothstep(0.3, 0.5, chroma));
  outColor = vec4(c * mix(vec3(1.0), uTopTint, top), 1.0);
}`;

// One strip per wire. Positions arrive in device px (top-left origin); the
// across offset carries the analytic profile.
const WIRE_V = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aAcross;
layout(location = 2) in vec4 aProf;   // half width, blur, opacity, hand-off
layout(location = 3) in vec2 aRest;   // image px of the resting wire here
uniform vec2 uRes;
out float vD;
out vec4 vProf;
out vec2 vRest;
void main() {
  vD = aAcross;
  vProf = aProf;
  vRest = aRest;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const WIRE_F = `#version 300 es
precision highp float;
in float vD;
in vec4 vProf;
in vec2 vRest;
out vec4 outColor;
uniform vec3 uShade[25];
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec4 uRiderBox;   // image px; zero size when none
uniform vec2 uRiderAt;    // atlas px of the box's corner
float erf_(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
void main() {
  float hw = vProf.x;
  // Optical blur plus the pixel's own footprint.
  float sig = sqrt(vProf.y * vProf.y + 0.085);
  float k = 0.70710678 / sig;
  float a = vProf.z * 0.5 * (erf_((vD + hw) * k) - erf_((vD - hw) * k));
  // Near its insulator the photograph keeps its own wire; the live one takes
  // over along a ramp so the sum stays exactly the photograph.
  float r = vProf.w;
  a = r * a / max(1.0 - a + r * a, 1e-4);
  // Where an insulator rides the wire, the insulator sprite carries it.
  if (uRiderBox.z > uRiderBox.x) {
    vec2 q = vRest - uRiderBox.xy;
    if (q.x >= 0.0 && q.y >= 0.0 && vRest.x <= uRiderBox.z && vRest.y <= uRiderBox.w) {
      a *= 1.0 - texture(uAtlas, (uRiderAt + q) / uAtlasSize).a;
    }
  }
  float u = clamp((vD / max(hw, 0.25) + 1.25) / 2.5 * 25.0 - 0.5, 0.0, 24.0);
  int i0 = int(floor(u));
  int i1 = min(i0 + 1, 24);
  vec3 col = mix(uShade[i0], uShade[i1], fract(u));
  outColor = vec4(col, a);
}`;

const RIDER_V = `#version 300 es
layout(location = 0) in vec2 aPos;    // device px
layout(location = 1) in vec2 aUv;     // atlas uv
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const RIDER_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAtlas;
void main() { outColor = texture(uAtlas, vUv); }`;

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function compile(gl, vs, fs, attribs = ["aPos"]) {
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
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
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

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, bm, { mips = true } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, bm.width, bm.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return tex;
}

export async function createCatenary(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : d;
  };
  const pluckQ = q.get("pluck") ?? q.get("pull");
  const holdPull = q.get("pull") != null;
  const held = pluckQ != null || q.get("still") != null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const warmTop = num("warmTop", WARM_TOP);
  const topTint = [1 + 0.8 * warmTop, 1, 1 - warmTop];
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) {
    if (typeof FILM[key] === "number") film0[key] = num(key, FILM[key]);
  }

  // The colour field the frame opens from: the sky, overexposed.
  host.style.background = "#dfe8ef";

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [meta, plateBm, atlasBm] = await Promise.all([
    fetch(`${ASSET}wires.json`).then((r) => r.json()),
    bitmap(`${ASSET}plate.webp`),
    bitmap(`${ASSET}riders.png`),
  ]);
  const [IW, IH] = meta.image;
  const plateTex = upload(gl, plateBm);
  const atlasTex = upload(gl, atlasBm);
  plateBm.close?.();
  atlasBm.close?.();

  const world = createWorld(meta.wires);
  const { wires, groups } = world;

  const sound = createPluckSound();

  // ---- GL
  const plateP = compile(gl, VERT_FULL, PLATE);
  const wireP = compile(gl, WIRE_V, WIRE_F, ["aPos", "aAcross", "aProf", "aRest"]);
  const riderP = compile(gl, RIDER_V, RIDER_F, ["aPos", "aUv"]);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const SUB = 4; // render samples per node segment
  const STRIDE = 9;
  const maxVerts = (NODES * SUB + 2) * 2;
  const wireBuf = gl.createBuffer();
  const wireData = new Float32Array(maxVerts * STRIDE);
  const wireVao = gl.createVertexArray();
  gl.bindVertexArray(wireVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wireData.byteLength, gl.DYNAMIC_DRAW);
  const F = 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * F, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, STRIDE * F, 2 * F);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * F, 3 * F);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE * F, 7 * F);

  const riderBuf = gl.createBuffer();
  const riderData = new Float32Array(6 * 4);
  const riderVao = gl.createVertexArray();
  gl.bindVertexArray(riderVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, riderBuf);
  gl.bufferData(gl.ARRAY_BUFFER, riderData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  let sceneTex = null;
  let sceneFbo = null;
  let lastKey = "";
  let map = { ox: 0, oy: 0, k: 1 };
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
    sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    sceneFbo = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    }
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(w, h);
    // Cover the box with the photograph, cropping toward the mast.
    const k = Math.max(w / IW, h / IH);
    map = { ox: (w - IW * k) * FOCUS[0], oy: (h - IH * k) * FOCUS[1], k };
    lastKey = "";
  };
  stage.onResize(build);

  // css px -> image px
  const toImage = (x, y) => {
    const d = stage.dpr;
    return [(x * d - map.ox) / map.k, (y * d - map.oy) / map.k];
  };
  // A reach measured on a 1280 px box, in image px for this box.
  const reachOf = (w) => (w.tune.reach * stage.dpr * clamp(stage.width / 1280, 0.6, 1.4)) / map.k;

  // ---- physics
  const STEP = 1 / 720;
  let wind = 0; // 0..1 breeze strength (fades in after the reveal)
  const step = (h) => world.step(h, { wind, k: map.k });

  // ---- interaction
  let hoverWire = null;
  const catchRadius = () => (5 * stage.dpr) / map.k;

  const release = (w, speed = 0) => {
    const cg = w.caught;
    if (!cg) return;
    w.caught = null;
    // How far the string was drawn, in device px: the sound follows it.
    const drawn = Math.abs(sampleY(w, cg.j)) * map.k;
    sound.pluck({ wire: w.index, drawn, at: cg.j / w.N, f1: w.tune.f1, speed });
  };

  const track = (p, isDown) => {
    const [x, y] = toImage(p.x, p.y);
    for (const w of wires) {
      const hit = locate(w, x, y);
      if (!hit) continue;
      const jMin = 0.6;
      const inRun = hit.j > jMin && hit.j < w.jExit - 0.3;
      if (w.caught) {
        // Slide along with the hand; let go past the reach.
        w.caught.j = clamp(hit.j, jMin, w.jExit - 0.3);
        const off = offsetAt(w, w.caught.j, x, y);
        const reach = reachOf(w);
        if (Math.abs(off) > reach || !inRun) {
          w.caught.target = clamp(off, -reach, reach);
          release(w, Math.hypot(p.vx, p.vy));
          // The hand is now past the wire: only coming back crosses it.
          w.prevSide = off;
        } else w.caught.target = off;
        continue;
      }
      if (!p.down || !inRun) {
        w.prevSide = hit.side;
        continue;
      }
      const crossed = w.prevSide != null && Math.sign(w.prevSide) !== Math.sign(hit.side) && hit.dist < reachOf(w) * 3;
      if ((isDown && hit.dist < catchRadius()) || crossed) {
        w.caught = { j: hit.j, target: offsetAt(w, hit.j, x, y) };
        sound.wake();
      }
      w.prevSide = hit.side;
    }
  };

  stage.on("down", (p) => {
    for (const w of wires) w.prevSide = null;
    track(p, true);
    // Seed sides so the first move can register a crossing.
    const [x, y] = toImage(p.x, p.y);
    for (const w of wires) {
      const hit = locate(w, x, y);
      if (hit && !w.caught) w.prevSide = hit.side;
    }
  });
  stage.on("move", (p) => track(p, false));
  stage.on("up", (p) => {
    for (const w of wires) if (w.caught) release(w, Math.hypot(p.vx, p.vy));
  });

  // ---- still: a pluck held at a moment
  const still = held;
  if (pluckQ != null) {
    const w = wires[clamp(Math.round(+pluckQ) || 0, 0, wires.length - 1)];
    const at = num("at", 0.42);
    const amp = clamp(num("amp", 1), 0, 1.5);
    const tAfter = holdPull ? 0 : num("t", 0.18);
    const settle = () => {
      const jc = clamp(at * w.jExit, 1, w.N - 1);
      const A = reachOf(w) * amp;
      for (let j = 0; j <= w.N; j++) w.y[j] = j <= jc ? (A * j) / jc : (A * (w.N - j)) / (w.N - jc);
      w.v.fill(0);
      let t = 0;
      while (t < tAfter) {
        step(STEP);
        t += STEP;
      }
    };
    stage.onResize(() => settle());
  }

  // ---- render
  const drawScene = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(plateP.p);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(plateP.u.uPlate, 0);
    gl.uniform2f(plateP.u.uRes, W, H);
    gl.uniform3f(plateP.u.uMap, map.ox, map.oy, map.k);
    gl.uniform2f(plateP.u.uImg, IW, IH);
    gl.uniform3fv(plateP.u.uTopTint, topTint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const k = map.k;
    for (const w of wires) {
      // Strip over the visible run (plus a little past the frame edge).
      let n = 0;
      const jEnd = w.jExit;
      const ho = w.def.handoff;
      for (let js = 0; js <= jEnd * SUB; js++) {
        const j = js / SUB;
        const i = Math.min(w.N - 1, Math.floor(j));
        const t = j - i;
        const rx = w.px[i] + (w.px[i + 1] - w.px[i]) * t;
        const ry = w.py[i] + (w.py[i + 1] - w.py[i]) * t;
        let nxx = w.nx[i] + (w.nx[i + 1] - w.nx[i]) * t;
        let nyy = w.ny[i] + (w.ny[i + 1] - w.ny[i]) * t;
        const nl = Math.hypot(nxx, nyy) || 1;
        nxx /= nl;
        nyy /= nl;
        const yy = sampleY(w, j);
        const s = j * w.ds;
        // Fitted widths read ~0.6 px wide of the photograph at display size.
        const hw = ((w.knot(w.def.w, s) - WIDTH_TRIM) / 2) * k;
        const sig = w.knot(w.def.sig, s) * k;
        const o = w.knot(w.def.o, s);
        const r = ho[1] > ho[0] ? clamp((s - ho[0]) / (ho[1] - ho[0]), 0, 1) : 1;
        const ext = hw + 3 * sig + 2;
        const cx = map.ox + (rx + nxx * yy) * k;
        const cy = map.oy + (ry + nyy * yy) * k;
        for (const sgn of [-1, 1]) {
          const b = n * STRIDE;
          wireData[b] = cx + nxx * ext * sgn;
          wireData[b + 1] = cy + nyy * ext * sgn;
          wireData[b + 2] = ext * sgn;
          wireData[b + 3] = hw;
          wireData[b + 4] = sig;
          wireData[b + 5] = o;
          wireData[b + 6] = r;
          wireData[b + 7] = rx + (nxx * ext * sgn) / k;
          wireData[b + 8] = ry + (nyy * ext * sgn) / k;
          n++;
        }
      }
      gl.useProgram(wireP.p);
      gl.uniform2f(wireP.u.uRes, W, H);
      gl.uniform3fv(wireP.u.uShade, w.shade);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(wireP.u.uAtlas, 0);
      gl.uniform2f(wireP.u.uAtlasSize, meta.atlas[0], meta.atlas[1]);
      const rd = w.def.riders[0];
      if (rd) {
        gl.uniform4f(wireP.u.uRiderBox, rd.box[0], rd.box[1], rd.box[2], rd.box[3]);
        gl.uniform2f(wireP.u.uRiderAt, rd.atlas[0], rd.atlas[1]);
      } else gl.uniform4f(wireP.u.uRiderBox, 0, 0, 0, 0);
      gl.bindVertexArray(wireVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, wireData, 0, n * STRIDE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, n);

      // Insulators that ride the wire move with it.
      for (const r of w.def.riders) {
        const jc = r.sc / w.ds;
        const yy = sampleY(w, jc);
        const i = Math.floor(jc);
        const dx = w.nx[i] * yy;
        const dy = w.ny[i] * yy;
        const [x0, y0, x1, y1] = r.box;
        const [ax, ay, aw, ah] = r.atlas;
        const corners = [
          [x0, y0, ax, ay],
          [x1, y0, ax + aw, ay],
          [x0, y1, ax, ay + ah],
          [x1, y1, ax + aw, ay + ah],
        ];
        const order = [0, 1, 2, 2, 1, 3];
        order.forEach((ci, m) => {
          const c = corners[ci];
          riderData[m * 4] = map.ox + (c[0] + dx) * k;
          riderData[m * 4 + 1] = map.oy + (c[1] + dy) * k;
          riderData[m * 4 + 2] = c[2] / meta.atlas[0];
          riderData[m * 4 + 3] = c[3] / meta.atlas[1];
        });
        gl.useProgram(riderP.p);
        gl.uniform2f(riderP.u.uRes, W, H);
        gl.uniform1i(riderP.u.uAtlas, 0);
        gl.bindVertexArray(riderVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, riderBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, riderData);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  let born = performance.now();
  let acc = 0;
  let lastGrain = -1;
  const frame = (dt, t) => {
    const age = (performance.now() - born) / 1000;
    if (!still) {
      // Breeze comes up once the frame has settled.
      wind = reduced ? 0 : damp(wind, age > 1.6 ? 1 : 0, 0.7, dt);
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    // Cursor: a grab hand only over a live wire.
    const p = stage.pointer;
    if (p.inside && !p.down) {
      const [x, y] = toImage(p.x, p.y);
      let near = null;
      for (const w of wires) {
        const hit = locate(w, x, y);
        if (hit && hit.dist < catchRadius() * 1.4 && hit.j > 0.6 && hit.j < w.jExit - 0.3) near = w;
      }
      if (near !== hoverWire) {
        hoverWire = near;
        stage.canvas.style.cursor = near ? "grab" : "";
      }
    } else if (p.down) {
      const any = wires.some((w) => w.caught);
      const cur = any ? "grabbing" : "";
      if (stage.canvas.style.cursor !== cur) stage.canvas.style.cursor = cur;
    }

    const expT = still || reduced ? 1 : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + 2.5 * (1 - expT);
    let key = `${exposure.toFixed(4)}`;
    for (const w of wires) key += `|${w.y[Math.round(w.N / 3)].toFixed(3)}|${w.y[Math.round(w.N / 2)].toFixed(3)}`;
    const tick = still ? 0 : Math.floor(t * 24);
    if (key !== lastKey || tick !== lastGrain) {
      drawScene();
      film.render(sceneTex, { ...film0, exposure, grainSeed: tick * 7.31 });
      lastKey = key;
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!sceneTex) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      sound.destroy();
      film.destroy();
      if (sceneTex) gl.deleteTexture(sceneTex);
      if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
      gl.deleteTexture(plateTex);
      gl.deleteTexture(atlasTex);
      for (const b of [quad, wireBuf, riderBuf]) gl.deleteBuffer(b);
      for (const v of [quadVao, wireVao, riderVao]) gl.deleteVertexArray(v);
      for (const pr of [plateP, wireP, riderP]) gl.deleteProgram(pr.p);
      stage.destroy();
    },
  };
}
