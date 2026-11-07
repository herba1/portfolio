import { createStage } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";
import { createSound } from "@/lib/sound/engine";
import { takes } from "./shutterTakes";

// Shutter. A locked-off time-lapse from the foot of a tower, looking almost
// straight up its glass into summer cumulus. Press and hold and the shutter
// opens on bulb: the frame integrates the recorded light for as long as you
// hold, so the clouds smear into silk along their real wind while the tower,
// which never moved, stays sharp. Let go and the long exposure stays on the
// print until the next press.
//
// The integral is real. Offline (tools/depth/bakes/shutter/bake.py) the
// graded, looped plate is cut into blocks of 8 frames and each block's
// linear-light mean is baked (a time pyramid at block resolution), with the
// tower filled out of it from its own sky. Any open
// interval [a, a + T] is then a weighted sum of the blocks it covers, with
// partial weights at its ends: a prefix-sum query, done here in one pass at
// block resolution into a half-float target. The opening of an exposure is
// integrated live instead: from the frame the shutter opened on, every frame
// the viewfinder video decodes is added (by the time it covers) to a running
// mean at video resolution, so a short exposure is exactly what you saw,
// smearing frame by frame, and the blocks take over past the first second.
//
// Exposure is normalised by its length: an ND filter that follows the
// shutter, so brightness holds and only time grows, and nothing blows out.
//
// Sharpness: the moving layers are low resolution (sky is smooth, and smeared
// sky smoother). A still plate at full resolution (the mean of the whole loop)
// carries a stillness matte in alpha. Under the matte the print is the tower:
// for the live part of an exposure the live mean's light with the still's own
// fine detail added back at the matching blur (so the glass still shows its
// passing reflections in the viewfinder), for the blocks' part the still
// itself. Outside it the print is sky alone; the blocks carry no tower, so no
// low-resolution tower light can bleed into the smeared sky as a glow. No
// sharpening anywhere: the edge is the matte's, a pixel or two wide.
//
// Presented full-bleed: the plate covers the box (cropped at its long side),
// as a print would be trimmed to the frame.
//
// Develop: _kit/film.js, summer preset (halation, Pro-Mist bloom, colour
// bleed, curve, 24 fps grain).

const BASE = "/lab/shutter/";
const TAU = 1; // frames: the opening frame's share of a still (?open); each frame already carries its own interval
const LIVE_CAP = 24; // frames integrated live before the blocks take over
const AT = 96; // the plate frame a ?open still starts on, unless ?at= (seconds)

// Hold seconds -> exposure length in plate frames. Accelerating, like
// turning a shutter dial while you wait: a breath is a few minutes of real
// sky, six seconds is nearly the whole loop (one plate frame is several
// seconds of wind here, the cloud crossing ~1% of the frame per frame).
const framesFor = (h, N) => N * Math.min(1, (60 * h + 20 * h * h) / 1200);

// The print, by exposure length. A single frame carries the whole contrast
// of sunlit cumulus against cobalt and is metered for the cloud tops. An
// average over minutes of sky is flatter: cloud and blue meet in a pale silk
// that a straight print leaves grey-blue. So the long exposure is printed
// down a little and richer, as a printer would print a long exposure: the
// meter falls, saturation and the film's blue deepening rise, and the ramp
// the bake put in (deeper toward the zenith) comes back through the silk.
// k: 0 for a single frame, ~0.5 at a 2 s hold, ~0.9 for the whole loop.
const longness = (T, N) => 1 - Math.exp(-T / (N * 0.3));
const METER_SHORT = -0.4;
const METER_LONG = -0.75;

// The summer develop, eased for this plate. The bake already deepens the sky
// toward the zenith, so the film's own blue deepening is cut, or the top of
// the frame goes navy. Halation is judged from the surround and kept low: at
// full strength its red layer rings every white edge against cobalt (the
// tower's frame, every cloud) in magenta, which reads as an electronic fringe.
const LOOK = { ...FILM_DEFAULTS, ...FILM_PRESETS.summer, blueDepth: 0.4, halation: 0.14, halationLocal: 1, halationColor: [1, 0.42, 0.18] };
const develop = (T, N) => {
  const k = longness(T, N);
  return {
    ...LOOK,
    exposure: METER_SHORT + (METER_LONG - METER_SHORT) * k,
    saturation: LOOK.saturation + 0.45 * k,
    blueDepth: LOOK.blueDepth + 0.5 * k,
  };
};

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `
vec3 lin(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;

// The open interval as a weighted sum of baked block means (linear light).
const EXPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uA2;
uniform vec4 uBlk[64];   // atlas, column, row, weight
uniform int uCount;
uniform vec2 uSize;      // block size in px
uniform vec2 uGrid;      // atlas columns, rows
out vec4 o;
${COMMON}
void main(){
  vec2 p = gl_FragCoord.xy / uSize;
  p.y = 1.0 - p.y; // atlases are uploaded top row first
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 b = uBlk[i];
    vec2 uv = (b.yz + p) / uGrid;
    vec3 c = b.x < 0.5 ? texture(uA0, uv).rgb : (b.x < 1.5 ? texture(uA1, uv).rgb : texture(uA2, uv).rgb);
    acc += lin(c) * b.w;
  }
  o = vec4(acc, 1.0);
}`;

// The live part of an exposure: a running mean of decoded viewfinder frames,
// stored top row first like the images.
const ACC_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uVideo;
uniform vec2 uSize;
uniform float uK;          // new frame's share of the mean
out vec4 o;
${COMMON}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 v = lin(texture(uVideo, uv).rgb);
  o = vec4(mix(texture(uPrev, uv).rgb, v, uK), 1.0);
}`;

// The print before development: live part + blocks, with the still world's
// detail restored.
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uStill;  // sRGB mean of the still plate, stillness matte in a
uniform sampler2D uFrame;  // the live mean (linear), or the viewfinder (sRGB)
uniform float uFrameLin;
uniform sampler2D uExp;    // linear block integral (GL orientation)
uniform vec2 uSize;
uniform vec4 uCover;       // plate uv = uv * xy + zw (full-bleed crop)
uniform float uWB;         // blocks' share of the exposure
uniform vec2 uLod;         // still lod at display, at frame res
out vec4 o;
${COMMON}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize * uCover.xy + uCover.zw;
  vec2 iuv = vec2(uv.x, 1.0 - uv.y);
  vec3 f = texture(uFrame, iuv).rgb;
  if (uFrameLin < 0.5) f = lin(f);
  vec3 e = texture(uExp, uv).rgb;
  vec3 sky = enc(mix(f, e, uWB));
  vec4 s = textureLod(uStill, iuv, uLod.x);
  vec3 dF = s.rgb - textureLod(uStill, iuv, uLod.y).rgb;
  vec3 tower = mix(clamp(enc(f) + dF, 0.0, 1.0), s.rgb, uWB);
  o = vec4(mix(sky, tower, s.a), 1.0);
}`;

// Print onto the page: the developed frame, and the last one fading out
// under it when a new exposure starts.
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uMix;        // 1 = all current
uniform vec4 uRect;
uniform float uZoom;       // the print giving under the finger, < 1 zooms in
out vec4 o;
void main(){
  vec2 uv = 0.5 + ((gl_FragCoord.xy - uRect.xy) / uRect.zw - 0.5) * uZoom;
  vec3 c = texture(uCur, uv).rgb;
  if (uMix < 1.0) c = mix(texture(uPrev, uv).rgb, c, uMix);
  o = vec4(c, 1.0);
}`;

function compile(gl, vs, fs) {
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

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function texture(gl, src, { mips = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
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
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function makeVideo() {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "");
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  for (const [src, type] of [
    [`${BASE}plate.webm`, 'video/webm; codecs="vp9"'],
    [`${BASE}plate.mp4`, 'video/mp4; codecs="avc1.640028"'],
  ]) {
    if (v.canPlayType(type)) {
      v.src = src;
      break;
    }
  }
  if (!v.src) v.src = `${BASE}plate.mp4`;
  return v;
}

const once = (el, ev) => new Promise((res) => el.addEventListener(ev, res, { once: true }));

function createShutterSound() {
  const sound = createSound({ level: -4, room: 0.1, on: true });
  if (!sound.ctx) return null;
  const open = sound.bank(takes.open.render, takes.open);
  const close = sound.bank(takes.close.render, takes.close);
  return {
    open() {
      sound.unlock();
      if (sound.live) sound.play(open, { gain: -7 + (Math.random() * 2 - 1), rate: 0.98 + Math.random() * 0.04 });
    },
    close(seconds) {
      if (!sound.live) return;
      // A longer exposure lets the curtain spring wind a touch further.
      sound.play(close, { gain: -6 + Math.min(1.5, seconds * 0.3) + (Math.random() * 2 - 1), rate: 0.98 + Math.random() * 0.04 });
    },
    destroy() {
      sound.destroy();
    },
  };
}

export async function createShutter(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixedOpen = params.has("open") ? Math.max(0, parseFloat(params.get("open")) || 0) : null;
  const still = fixedOpen != null || params.has("still");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const meta = await (await fetch(`${BASE}bake.json`)).json();
  const N = meta.frames;
  const B = meta.block;
  const NB = meta.blocks;
  const FPS = meta.fps;
  const [GX, GY] = meta.atlas;
  const [BW, BH] = meta.blockSize;
  const [, , SW, SH] = meta.crop;
  const [VW] = meta.video;
  const atStart = params.has("at") ? (((parseFloat(params.get("at")) || 0) * FPS) % N + N) % N : AT;

  const video = makeVideo();
  const [stillImg, ...atlasImgs] = await Promise.all([bitmap(`${BASE}still.webp`), ...meta.atlases.map((a) => bitmap(BASE + a))]);
  if (video.readyState < 2) await Promise.race([once(video, "loadeddata"), once(video, "error")]);

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "button");
  canvas.setAttribute("aria-label", "Shutter, press and hold to expose");
  canvas.setAttribute("aria-pressed", "false");
  canvas.style.outline = "none";
  const half = !!gl.getExtension("EXT_color_buffer_float");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    expose: compile(gl, VS, EXPOSE_FS),
    acc: compile(gl, VS, ACC_FS),
    compose: compile(gl, VS, COMPOSE_FS),
    blit: compile(gl, VS, BLIT_FS),
  };
  const stillTex = texture(gl, stillImg, { mips: true });
  const atlasTex = atlasImgs.map((img) => texture(gl, img));
  stillImg.close?.();
  atlasImgs.forEach((i) => i.close?.());
  const liveTex = texture(gl, null);
  const pressTex = texture(gl, null);
  let liveReady = false;
  const exp = target(gl, BW, BH, half) || target(gl, BW, BH, false);
  const VH = meta.video[1];
  let acc = [0, 1].map(() => target(gl, VW, VH, half) || target(gl, VW, VH, false));

  const uploadVideo = (tex) => {
    if (video.readyState < 2) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    return true;
  };

  // The print: full-bleed. The plate covers the box, cropped at its long side.
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  const cover = [1, 1, 0, 0];
  let film = null;
  let comp = null;
  let dev = [null, null]; // developed frames: current, previous
  const layout = (w, h, dpr) => {
    rect.w = Math.max(1, Math.round(w));
    rect.h = Math.max(1, Math.round(h));
    rect.x = 0;
    rect.y = 0;
    const box = rect.w / rect.h;
    const plate = SW / SH;
    cover[0] = box < plate ? box / plate : 1;
    cover[1] = box < plate ? 1 : plate / box;
    cover[2] = (1 - cover[0]) / 2;
    cover[3] = (1 - cover[1]) / 2;
    const dw = Math.round(rect.w * dpr);
    const dh = Math.round(rect.h * dpr);
    freeTarget(gl, comp);
    dev.forEach((d) => freeTarget(gl, d));
    comp = target(gl, dw, dh, false);
    dev = [target(gl, dw, dh, false), target(gl, dw, dh, false)];
    if (!film) film = createFilm(gl, { width: dw, height: dh });
    else film.resize(dw, dh);
  };

  // Exposure state, in plate frames.
  const shot = { a: atStart, T: 0, hold: 0, t0: 0, open: false, any: fixedOpen != null, L: 0, last: 0, live: false };
  let fade = 1; // 0..1 cross-fade from the previous print
  let press = { s: 1, v: 0, target: 1 };
  let dirty = true;
  let expDirty = true;
  let seed = 3;
  let grainT = 0;
  let reveal = still || reduced ? null : { t: 0, dur: 2.0, from: 2.5 };
  let exposureEV = reveal ? reveal.from : 0;

  // Blocks covering [p, q] (frames, may run past the loop end), merged by
  // index, weights normalised to the blocks' share.
  const blockList = new Float32Array(64 * 4);
  let blockCount = 0;
  const computeBlocks = (p, q) => {
    const w = new Float32Array(NB);
    const len = Math.max(1e-6, q - p);
    for (let j = Math.floor(p / B); j * B < q; j++) {
      const lo = Math.max(p, j * B);
      const hi = Math.min(q, (j + 1) * B);
      if (hi > lo) w[((j % NB) + NB) % NB] += (hi - lo) / len;
    }
    blockCount = 0;
    const per = GX * GY;
    for (let k = 0; k < NB && blockCount < 64; k++) {
      if (w[k] <= 0) continue;
      const a = Math.floor(k / per);
      const r = k % per;
      blockList.set([a, r % GX, Math.floor(r / GX), w[k]], blockCount * 4);
      blockCount++;
    }
  };

  const draw = () => {
    if (!comp || !film) return;
    const dpr = stage.dpr;
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);

    // 1. The block integral, only when the interval changed.
    const T = shot.T;
    const L = shot.L;
    const wB = T > L ? (T - L) / T : 0;
    if (expDirty && wB > 0) {
      computeBlocks(shot.a + L, shot.a + T);
      const u = P.expose.u;
      gl.useProgram(P.expose.p);
      atlasTex.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform1i(u.uA0, 0);
      gl.uniform1i(u.uA1, Math.min(1, atlasTex.length - 1));
      gl.uniform1i(u.uA2, Math.min(2, atlasTex.length - 1));
      gl.uniform4fv(u.uBlk, blockList);
      gl.uniform1i(u.uCount, blockCount);
      gl.uniform2f(u.uSize, BW, BH);
      gl.uniform2f(u.uGrid, GX, GY);
      gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fbo);
      gl.viewport(0, 0, BW, BH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      expDirty = false;
    }

    // 2. Compose the latent image.
    const u = P.compose.u;
    gl.useProgram(P.compose.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stillTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shot.any ? acc[0].tex : liveTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, exp.tex);
    gl.uniform1i(u.uStill, 0);
    gl.uniform1i(u.uFrame, 1);
    gl.uniform1i(u.uExp, 2);
    gl.uniform2f(u.uSize, comp.w, comp.h);
    gl.uniform4fv(u.uCover, cover);
    gl.uniform1f(u.uWB, wB);
    gl.uniform1f(u.uFrameLin, shot.any ? 1 : 0);
    const lodD = Math.max(0, Math.log2((SW * cover[0]) / comp.w));
    gl.uniform2f(u.uLod, lodD, Math.max(lodD, Math.log2(SW / VW)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fbo);
    gl.viewport(0, 0, comp.w, comp.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Develop.
    const look = develop(T, N);
    film.render(comp.tex, { ...look, exposure: exposureEV + look.exposure, grainSeed: seed }, dev[0].fbo);

    // 4. Print onto the paper.
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const cw = canvas.width;
    const ch = canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pw = Math.round(rect.w * dpr);
    const ph = Math.round(rect.h * dpr);
    const px = Math.round(rect.x * dpr);
    const py = ch - Math.round(rect.y * dpr) - ph;
    gl.viewport(px, py, pw, ph);
    const b = P.blit.u;
    gl.useProgram(P.blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dev[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dev[1].tex);
    gl.uniform1i(b.uCur, 0);
    gl.uniform1i(b.uPrev, 1);
    gl.uniform1f(b.uMix, fade);
    gl.uniform4f(b.uRect, px, py, pw, ph);
    gl.uniform1f(b.uZoom, press.s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Keep the last developed print to fade out under a new exposure.
  const keepPrint = () => {
    dev = [dev[1], dev[0]];
    fade = 0;
  };

  // Add the frame in `src` to the live mean with weight w (frames).
  const accumulate = (src, w) => {
    const k = w / (shot.L + w);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.useProgram(P.acc.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, acc[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(P.acc.u.uPrev, 0);
    gl.uniform1i(P.acc.u.uVideo, 1);
    gl.uniform2f(P.acc.u.uSize, VW, VH);
    gl.uniform1f(P.acc.u.uK, k);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc[1].fbo);
    gl.viewport(0, 0, VW, VH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    acc = [acc[1], acc[0]];
    shot.L += w;
  };

  const inside = (p, slop = 12) => p.x > rect.x - slop && p.x < rect.x + rect.w + slop && p.y > rect.y - slop && p.y < rect.y + rect.h + slop;

  let sound = null;
  const openShutter = () => {
    if (shot.open || still) return;
    if (!sound) sound = createShutterSound();
    sound?.open();
    reveal = null;
    exposureEV = 0;
    if (shot.any) keepPrint();
    uploadVideo(pressTex);
    shot.a = ((video.currentTime * FPS) % N + N) % N;
    shot.last = video.currentTime;
    shot.T = 0;
    shot.hold = 0;
    shot.t0 = performance.now();
    shot.L = 0;
    shot.live = true;
    accumulate(pressTex, 1);
    shot.open = true;
    shot.any = true;
    expDirty = true;
    press.target = 0.994;
    canvas.setAttribute("aria-pressed", "true");
    dirty = true;
  };
  const closeShutter = () => {
    if (!shot.open) return;
    shot.open = false;
    sound?.close(shot.hold);
    press.target = 1;
    canvas.setAttribute("aria-pressed", "false");
    dirty = true;
  };

  stage.on("down", (p) => {
    if (inside(p)) openShutter();
  });
  stage.on("up", () => closeShutter());
  const onKeyDown = (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      openShutter();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      closeShutter();
    }
  };
  const onBlur = () => closeShutter();
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", onBlur);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  stage.onResize((w, h, dpr) => {
    layout(w, h, dpr);
    dirty = true;
  });

  // Video frames: upload each new one while the viewfinder shows it.
  let lastVideoTime = -1;
  const pumpVideo = () => {
    if (video.readyState < 2) return;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      if (!shot.any) {
        uploadVideo(liveTex);
        liveReady = true;
        dirty = true;
      } else if (shot.open && shot.live) {
        // The frames the video has moved on since the last one, wrapping at
        // the loop; a dropped frame just carries more weight. A long stall
        // (a slow device, a background tab) ends the live part there, and
        // the blocks take the rest of the interval from that point.
        let w = (video.currentTime - shot.last) * FPS;
        if (w < 0) w += N;
        shot.last = video.currentTime;
        if (w > 6) shot.live = false;
        else if (w > 0.25) {
          uploadVideo(liveTex);
          accumulate(liveTex, Math.min(w, LIVE_CAP - shot.L));
          if (shot.L >= LIVE_CAP) shot.live = false;
          expDirty = true;
          dirty = true;
        }
      }
    }
  };

  if (still) {
    // A held exposure (or the viewfinder) at a fixed moment: seek, capture,
    // render once.
    video.pause();
    video.currentTime = atStart / FPS;
    await Promise.race([once(video, "seeked"), new Promise((r) => setTimeout(r, 4000))]);
    uploadVideo(pressTex);
    uploadVideo(liveTex);
    liveReady = true;
    shot.L = 0;
    accumulate(pressTex, TAU);
    shot.a = atStart;
    shot.T = fixedOpen != null ? framesFor(fixedOpen, N) : 0;
    shot.hold = fixedOpen ?? 0;
    expDirty = true;
  } else {
    if (!reduced) video.play().catch(() => {});
    else {
      video.currentTime = atStart / FPS;
      await Promise.race([once(video, "seeked"), new Promise((r) => setTimeout(r, 3000))]);
    }
  }

  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

  stage.onFrame((dt) => {
    if (!still) pumpVideo();
    if (shot.open) {
      // Wall-clock time, not frame time: a slow frame must not shorten the
      // exposure the finger asked for.
      shot.hold = (performance.now() - shot.t0) / 1000;
      const T = framesFor(shot.hold, N);
      if (T !== shot.T) {
        shot.T = T;
        expDirty = true;
        dirty = true;
      }
    }
    if (reveal) {
      // Opens overexposed, a white-blue field, and the sky deepens into
      // cobalt as the eye adjusts.
      reveal.t += dt;
      const k = easeOutExpo(Math.min(1, reveal.t / reveal.dur));
      exposureEV = reveal.from * (1 - k);
      if (reveal.t >= reveal.dur) {
        reveal = null;
        exposureEV = 0;
      }
      dirty = true;
    }
    if (fade < 1) {
      fade = Math.min(1, fade + dt / 0.22);
      dirty = true;
    }
    // The print gives under the finger: a stiff spring, damping 0.85.
    if (press.s !== press.target || press.v !== 0) {
      const w = 38;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -2 * z * w * press.v - w * w * (press.s - press.target);
        press.v += a * h;
        press.s += press.v * h;
      }
      if (Math.abs(press.s - press.target) < 1e-5 && Math.abs(press.v) < 1e-4) {
        press.s = press.target;
        press.v = 0;
      }
      dirty = true;
    }
    // Grain at 24 fps, like a projected strip.
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty && (liveReady || shot.any)) {
      dirty = false;
      draw();
    }
  });
  void embedded;

  return {
    destroy() {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
      video.pause();
      video.removeAttribute("src");
      video.load();
      sound?.destroy();
      film?.destroy();
      freeTarget(gl, comp);
      dev.forEach((d) => freeTarget(gl, d));
      freeTarget(gl, exp);
      acc.forEach((t) => freeTarget(gl, t));
      [stillTex, liveTex, pressTex, ...atlasTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}

