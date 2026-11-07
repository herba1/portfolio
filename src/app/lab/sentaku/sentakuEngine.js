import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";
import { createCloth, project, PX, ROPE } from "./cloth";

// Sentaku (laundry): a washing line seen from underneath against a cobalt
// sky, the sun behind a sheer polka-dot dress. Every garment was cut out of
// the photograph (SAM 2.1, guided-filter mattes, colour unmixed against the
// plate), the sky behind them filled (LaMa, with the sun under the dress
// modelled back in from the glow around it), and each one hangs here as
// cloth on its pegs (cloth.js). The pointer is the wind: how fast it crosses
// the frame sets the gust, which way sets where it comes from, and the gust
// runs down the line from that side. Left alone, a breeze breathes.
//
// Light: each vertex is lit by the sun behind the line and the sky, from the
// cloth's own normal now against its normal at rest, so the frame at rest is
// the photograph and a fold that turns to the sun brightens. The dress is
// see-through: the bake split it into its fabric and a share of whatever is
// behind it, so the sun shows through it wherever the sun really is.
//
// Query: ?gust=0..1 holds a steady gust (with ?dir=-1|1 and ?t=seconds of it,
// default 2.4), simulated deterministically and frozen, for stills.
// ?still=1 is the photograph with no wind. Numeric FILM keys override the grade.

const ASSET = "/lab/sentaku/";
const PAPER = [0xf2, 0xf0, 0xeb];
const GUST_MAX = 3.6; // m/s, a full swipe
const BREEZE = 0.95; // m/s, the idle air at its strongest
const FRONT = 3.2; // m/s, how fast a gust runs along the line
const SUN = (() => {
  const s = [-0.08, 0.86, 0.5];
  const l = Math.hypot(...s);
  return s.map((v) => v / l);
})();

const FILM = {
  ...FILM_DEFAULTS,
  ...FILM_PRESETS.summer,
  exposure: 0.15,
  toe: 0.08, // the natsu scan's lifted cyan black
  // a photograph already: less veil than a render, the sun kept off paper white
  bloom: 0.16,
  bloomThreshold: 0.5,
  softness: 0.4,
  halation: 0.38,
  halationThreshold: 0.75,
  whitePoint: 1.25,
  contrast: 1.15,
  saturation: 1.04,
  blueDepth: 0, // the photograph's sky is already deep at the top
  grain: 0.32,
  vignette: 0.18,
  highlightTint: [1, 1, 1],
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

const VERT_FULL = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SRGB = `
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`;

const PLATE_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPlate;
${SRGB}
void main() { o = vec4(encode(texture(uPlate, vec2(vUv.x, 1.0 - vUv.y)).rgb), 1.0); }`;

const BLIT_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

// Cloth and rope: drawn where they are now, textured from where they were.
const CLOTH_V = `#version 300 es
in vec2 aPos;
in vec2 aRest;
in vec2 aShade;
uniform vec2 uSize;
out vec2 vRest;
out vec2 vPos;
out vec2 vShade;
void main() {
  vRest = aRest;
  vPos = aPos;
  vShade = aShade;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const CLOTH_F = `#version 300 es
precision highp float;
in vec2 vRest;
in vec2 vPos;
in vec2 vShade;
out vec4 o;
uniform sampler2D uLayers;
uniform sampler2D uIds;
uniform sampler2D uBlur;
uniform vec2 uSize;
uniform float uId;
uniform vec3 uTau;
${SRGB}
void main() {
  // cloth that was outside the photograph has no pixels: it stays unseen
  if (vRest.x < 0.5 || vRest.y < 0.5 || vRest.x > uSize.x - 0.5 || vRest.y > uSize.y - 0.5) discard;
  ivec2 ip = clamp(ivec2(vRest), ivec2(0), ivec2(uSize) - 1);
  float id = texelFetch(uIds, ip, 0).r * 255.0;
  if (abs(id - uId) > 0.5) discard;
  vec4 L = texture(uLayers, vRest / uSize);
  if (L.a < 0.002) discard;
  vec3 B = texture(uBlur, clamp(vPos / uSize, 0.0, 1.0)).rgb;
  vec3 col = L.rgb * vShade.x + uTau * vShade.y * B;
  o = vec4(encode(col) * L.a, L.a);
}`;

function compile(gl, vs, fs, attribs) {
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, bm, { srgb = true, nearest = false, mips = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, bm.width, bm.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export async function createSentaku(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : d;
  };
  const holdGust = q.get("gust") != null ? clamp(num("gust", 0.7), 0, 1) : null;
  const still = q.get("still") != null;
  const rawView = q.get("raw") != null; // the scene before the film, for checking
  const held = holdGust != null || still;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) if (typeof FILM[key] === "number") film0[key] = num(key, FILM[key]);

  host.style.background = `rgb(${PAPER.join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [meta, plateBm, layersBm, idsBm, blurBm] = await Promise.all([
    fetch(`${ASSET}meta.json`).then((r) => r.json()),
    bitmap(`${ASSET}plate.webp`),
    bitmap(`${ASSET}layers.webp`),
    bitmap(`${ASSET}ids.png`),
    bitmap(`${ASSET}plate-blur.webp`),
  ]);
  const [IW, IH] = meta.size;
  const ASPECT = IW / IH;
  const plateTex = upload(gl, plateBm, { mips: true });
  const layersTex = upload(gl, layersBm, { mips: true });
  const idsTex = upload(gl, idsBm, { srgb: false, nearest: true });
  const blurTex = upload(gl, blurBm);
  for (const b of [plateBm, layersBm, idsBm, blurBm]) b.close?.();

  const cloth = createCloth(meta);
  cloth.settle(2.5);
  const { N, rest, x, x0, nrm, nrm0, gid, garments } = cloth;
  const ropeY = (u) => meta.rope.poly[0] * u * u + meta.rope.poly[1] * u + meta.rope.poly[2];

  // ---- GL
  const plateP = compile(gl, VERT_FULL, PLATE_F, ["aPos"]);
  const blitP = compile(gl, VERT_FULL, BLIT_F, ["aPos"]);
  const clothP = compile(gl, CLOTH_V, CLOTH_F, ["aPos", "aRest", "aShade"]);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // cloth: one dynamic buffer [pos.xy, rest.xy, shade.xy] per vertex
  const ROPE_STEP = 12;
  const ropeU0 = -48;
  const ropeN = Math.ceil((IW + 96) / ROPE_STEP) + 1;
  const NV = N + ropeN * 2;
  const vdata = new Float32Array(NV * 6);
  for (let k = 0; k < N; k++) {
    vdata[k * 6 + 2] = rest[k * 2];
    vdata[k * 6 + 3] = rest[k * 2 + 1];
    vdata[k * 6 + 4] = 1;
    vdata[k * 6 + 5] = 1;
  }
  const ropeRest = [];
  for (let i = 0; i < ropeN; i++) {
    const u = ropeU0 + i * ROPE_STEP;
    const y = ropeY(u);
    for (const [s, dv] of [
      [0, -16],
      [1, 32],
    ]) {
      const k = N + i * 2 + s;
      vdata[k * 6 + 2] = u;
      vdata[k * 6 + 3] = y + dv;
      vdata[k * 6 + 4] = 1;
      vdata[k * 6 + 5] = 0;
      ropeRest.push(u);
    }
  }
  const idx = [];
  const ranges = [];
  for (const gm of garments) {
    const start = idx.length;
    for (let t = 0; t < cloth.nT; t++) {
      const a = cloth.tris[t * 4] | 0;
      if (gid[a] !== gm.id) continue;
      idx.push(a, cloth.tris[t * 4 + 1] | 0, cloth.tris[t * 4 + 2] | 0);
    }
    ranges.push({ id: gm.id, start, count: idx.length - start, tau: gm.tau, sheer: Math.max(...gm.tau) > 0 });
  }
  {
    const start = idx.length;
    for (let i = 0; i < ropeN - 1; i++) {
      const a = N + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    ranges.push({ id: 6, start, count: idx.length - start, tau: [0, 0, 0], sheer: false });
  }
  const vbuf = gl.createBuffer();
  const ibuf = gl.createBuffer();
  const clothVao = gl.createVertexArray();
  gl.bindVertexArray(clothVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, vdata.byteLength, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 2, gl.FLOAT, false, 24, i * 8);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // per-garment light: ambient sky, sun reflected off the front, sun through
  const lightOf = (gm) => (Math.max(...gm.tau) > 0 ? { ka: 0.35, kr: 0.5, kt: 1.0 } : { ka: 0.6, kr: 0.95, kt: 0.3 });
  const lightById = new Map(garments.map((g) => [g.id, lightOf(g)]));
  const lit = (L, nx, ny, nz) => {
    const ns = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
    return L.ka * (0.62 + 0.38 * ny) + L.kr * Math.max(0, ns) + L.kt * Math.max(0, -ns);
  };
  const CAM = cloth.CAM;

  // ---- the wind
  const HIST = 240;
  const histA = new Float32Array(HIST);
  const histD = new Float32Array(HIST);
  let histI = 0;
  let simT = 0;
  let gustA = 0;
  let gustDir = 1;
  let breezeOn = held ? 1 : 0;
  const Xmax = IW / PX;
  const windFn = (X, Y, t, out, o) => {
    // the breeze, travelling down the line
    const tb = simT - X / FRONT;
    let b = 0.5 + 0.3 * Math.sin(0.37 * tb) + 0.22 * Math.sin(0.83 * tb + 1.3) + 0.12 * Math.sin(1.9 * tb + 0.4);
    b = Math.max(0.08, b) * BREEZE * breezeOn * (reduced ? 0.4 : 1) * (still ? 0 : 1);
    const bx = 0.32 * Math.sin(0.11 * simT + 0.6);
    // the gust, as it was when its front left the near end
    const dirNow = histD[(histI - 1 + HIST) % HIST] || 1;
    const delay = dirNow >= 0 ? X / FRONT : (Xmax - X) / FRONT;
    const back = Math.min(HIST - 1, Math.round(delay * 60));
    const hi = (histI - 1 - back + HIST * 2) % HIST;
    const A = histA[hi] * GUST_MAX;
    const D = histD[hi] || 1;
    // turbulence: eddies carried along with the air
    const tt = simT * (1.6 + 0.5 * A);
    const amp = 0.28 * b + 0.32 * A;
    const e1 = Math.sin(3.1 * X + 1.7 * Y - 2.3 * tt + 0.7) * Math.sin(2.3 * Y - 1.3 * X + 1.9 * tt);
    const e2 = Math.sin(2.7 * X - 2.1 * Y + 2.9 * tt + 2.1) * Math.sin(1.1 * Y + 3.3 * X - 1.4 * tt + 0.3);
    const e3 = Math.sin(4.3 * X + 2.9 * Y - 3.7 * tt + 1.1);
    out[o] = b * bx + A * 0.62 * D + amp * e2;
    out[o + 1] = A * 0.06 + amp * 0.5 * e3;
    out[o + 2] = b + A * 0.78 + amp * e1;
    void t;
  };
  const pushGust = (A, D) => {
    histA[histI] = A;
    histD[histI] = D;
    histI = (histI + 1) % HIST;
  };

  // ---- layout: one print, centred on the paper
  let scene = null;
  let developed = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  const film = createFilm(gl, { width: 1, height: 1 });
  const build = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    const d = stage.dpr;
    const side = Math.max(16 * d, W * 0.06);
    let h = Math.min(H * 0.86, (W - 2 * side) / ASPECT);
    let w = Math.round(h * ASPECT);
    h = Math.round(h);
    w = Math.max(2, w);
    h = Math.max(2, h);
    rect = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    for (const t of [scene, developed]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    scene = target(gl, w, h);
    developed = target(gl, w, h);
    film.resize(w, h);
    dirty = true;
  };
  let dirty = true;

  // ---- per frame: positions, light, draw
  const disp = [0, 0, 0];
  const cu = IW / 2;
  const cv = IH / 2;
  const writeVerts = () => {
    cloth.computeNormals();
    for (let k = 0; k < N; k++) {
      const i = k * 3;
      project(rest[k * 2], rest[k * 2 + 1], x[i] - x0[i], x[i + 1] - x0[i + 1], x[i + 2] - x0[i + 2], cu, cv, vdata, k * 6);
      const L = lightById.get(gid[k]);
      const g = lit(L, nrm[i], nrm[i + 1], nrm[i + 2]) / lit(L, nrm0[i], nrm0[i + 1], nrm0[i + 2]);
      vdata[k * 6 + 4] = clamp(g, 0.5, 1.8);
      const c = Math.abs(nrm[i] * CAM[0] + nrm[i + 1] * CAM[1] + nrm[i + 2] * CAM[2]);
      const c0 = Math.abs(nrm0[i] * CAM[0] + nrm0[i + 1] * CAM[1] + nrm0[i + 2] * CAM[2]);
      vdata[k * 6 + 5] = clamp(Math.pow(c / Math.max(0.05, c0), 0.6), 0.3, 1.4);
    }
    for (let i = 0; i < ropeN * 2; i++) {
      const k = N + i;
      const u = vdata[k * 6 + 2];
      const v = vdata[k * 6 + 3];
      cloth.ropeDisp((u - ROPE.left) / (ROPE.right - ROPE.left), disp);
      project(u, v, disp[0], disp[1], disp[2], cu, cv, vdata, k * 6);
    }
    void ropeRest;
  };

  const drawScene = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(plateP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(plateP.u.uPlate, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(clothP.p);
    gl.uniform2f(clothP.u.uSize, IW, IH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layersTex);
    gl.uniform1i(clothP.u.uLayers, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, idsTex);
    gl.uniform1i(clothP.u.uIds, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.uniform1i(clothP.u.uBlur, 2);
    gl.bindVertexArray(clothVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vdata);
    for (const r of ranges) {
      gl.uniform1f(clothP.u.uId, r.id);
      gl.uniform3f(clothP.u.uTau, r.tau[0], r.tau[1], r.tau[2]);
      gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_INT, r.start * 4);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  let born = performance.now();
  let tick = 0;
  const render = (exposure = film0.exposure) => {
    if (!scene) build();
    writeVerts();
    drawScene();
    if (!rawView) film.render(scene.tex, { ...film0, exposure, grainSeed: tick * 7.31 }, developed.fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(rect.x, stage.canvas.height - rect.y - rect.h, rect.w, rect.h);
    gl.useProgram(blitP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawView ? scene.tex : developed.tex);
    gl.uniform1i(blitP.u.uTex, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    dirty = false;
  };

  stage.onResize(() => {
    build();
    if (held) render();
  });

  // A held gust: run it from rest, deterministically, and keep that frame.
  if (holdGust != null) {
    const dir = num("dir", 1) >= 0 ? 1 : -1;
    const T = clamp(num("t", 2.4), 0, 20);
    for (let i = 0; i < Math.round(T * 60); i++) {
      pushGust(holdGust, dir);
      cloth.step(1 / 60, windFn);
      simT += 1 / 60;
    }
  }

  let acc = 0;
  const STEP = 1 / 60;
  const frame = (dt, t) => {
    const age = (performance.now() - born) / 1000;
    if (!held) {
      const p = stage.pointer;
      const W = Math.max(320, stage.width);
      const g = clamp(Math.abs(p.vx) / (1.4 * W), 0, 1);
      if (g > 0.06) gustDir = p.vx >= 0 ? 1 : -1;
      gustA = g > gustA ? damp(gustA, g, 10, dt) : damp(gustA, g, 0.7, dt);
      breezeOn = damp(breezeOn, age > 1.2 ? 1 : 0, 0.9, dt);
      acc = Math.min(acc + dt, STEP * 4);
      while (acc >= STEP) {
        pushGust(gustA, gustDir);
        cloth.step(STEP, windFn);
        simT += STEP;
        acc -= STEP;
      }
    }
    const reveal = held || reduced ? 1 : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + 2.5 * (1 - reveal);
    const nextTick = held ? 0 : Math.floor(t * 24);
    if (!held || dirty || reveal < 1 || nextTick !== tick) {
      tick = nextTick;
      if (held && !dirty) return;
      render(exposure);
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) render(held ? film0.exposure : film0.exposure + 2.5);
  born = performance.now();
  void embedded;

  return {
    destroy() {
      film.destroy();
      for (const t of [scene, developed]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const t of [plateTex, layersTex, idsTex, blurTex]) gl.deleteTexture(t);
      for (const b of [quad, vbuf, ibuf]) gl.deleteBuffer(b);
      for (const v of [quadVao, clothVao]) gl.deleteVertexArray(v);
      for (const pr of [plateP, blitP, clothP]) gl.deleteProgram(pr.p);
      stage.destroy();
    },
  };
}
