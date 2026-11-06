import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Depth Clock: the iOS 16 Lock Screen depth effect, made literal.
//
// One Poly Haven capture (Roman stone pines from below, CC0) is split offline
// (bake.py, beside this file) into three planes:
//   sky.webp    the sky, its hidden part continued as a fitted smooth gradient
//   fg.webp     the trees, colour unmixed from the sky: P = a F + (1 - a) S,
//               so a is an exact matte down to single needles and F carries
//               no blue fringe when it passes over something brighter
//   depth.webp  the trees' disparity, carried past the matte and smoothed
// All three store scene-linear light / ENC, sRGB-encoded.
//
// The time is set in Geist on a plane between them. A camera translation
// moves each plane by its disparity (sky barely, the time a little, the
// crowns most), so the numerals sit in the air between the pines and the
// sky. The frame is then developed by the shared film kit (summer preset),
// so the numerals bloom the way the sky and cloud do.
//
// Query (stills): ?tilt=x,y (-1..1) holds the camera; ?time=HH:MM holds the
// clock. ?roll=0..1 holds a minute change part way through.

const ASSET = "/lab/depth-clock/";
const IMG_W = 3000;
const IMG_H = 3400;
const ENC = 2;

// Where the frame looks, as a share of the image (landscape boxes).
const ANCHOR = [0.5, 0.44];
// The numerals: centre of the figures and their em size, in image pixels.
const NUM = { cx: 1520, cy: 1250, size: 640 };

const SKY_D = 0.04; // the sky's disparity in the depth map
const NUM_D = 0.2; // the numerals' plane: in front of the sky, behind every tree
const FOCUS = 0.12; // the plane that holds still
const AMP = 0.035; // image widths of shift per unit disparity at full tilt
const ZOOM = 1 + 2 * AMP * 0.8; // overscan so no plane's edge ever shows

const FILM = {
  ...FILM_PRESETS.summer,
  input: "linear",
  headroom: 0,
  exposure: 0.35,
};

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uSky;
uniform sampler2D uFg;
uniform sampler2D uDepth;
uniform sampler2D uText;
uniform vec2 uRes;        // device px
uniform vec4 uCrop;       // image uv: x0, y0, w, h
uniform vec2 uCam;        // -1..1
uniform vec4 uTextRect;   // device px, top-left origin: x0, y0, w, h
uniform vec3 uPlane;      // amp, focus, numerals' disparity
uniform float uNumL;      // numerals' radiance
uniform float uEnc;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float ASPECT = ${(IMG_W / IMG_H).toFixed(6)};

vec2 shift(float d) {
  return uCam * (d - uPlane.y) * uPlane.x * vec2(1.0, ASPECT);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 s = p / uRes;
  vec2 b = uCrop.xy + s * uCrop.zw;

  // Sky, at infinity (well, nearly).
  vec2 uvS = b + shift(${SKY_D.toFixed(3)});
  vec3 col = texture(uSky, uvS).rgb * uEnc;

  // The numerals' plane.
  vec2 dn = shift(uPlane.z) / uCrop.zw * uRes;
  vec2 tp = (p + dn - uTextRect.xy) / uTextRect.zw;
  float ta = 0.0;
  if (all(greaterThanEqual(tp, vec2(0.0))) && all(lessThanEqual(tp, vec2(1.0)))) ta = texture(uText, tp).a;
  if (ta > 0.0) {
    // Lit by the scene: sky light where the sky is around them, plain
    // sunlight where the crowns are close.
    vec3 skyl = textureLod(uSky, uvS, 7.5).rgb;
    vec3 tint = skyl / max(max(skyl.r, max(skyl.g, skyl.b)), 1e-4);
    float near = textureLod(uFg, b + shift(0.4), 6.0).a;
    vec3 sun = vec3(1.0, 0.975, 0.94);
    vec3 cool = mix(vec3(1.0), tint, 0.22);
    cool.g = mix(cool.g, 1.0, 0.4); // toward cyan, never violet
    // Brighter where the sky behind is brighter (toward the sun), dimmer
    // toward the deep zenith: the figures share the scene's light.
    float lift = clamp(pow(dot(skyl, LUMA) / 0.14, 0.25), 0.88, 1.1);
    vec3 n = uNumL * lift * mix(cool, sun, smoothstep(0.1, 0.8, near));
    col = mix(col, n, ta);
  }

  // The trees: each pixel moves by its own disparity. Solve uv + shift(D(uv))
  // = target by fixed-point iteration; D is smooth, so four steps settle.
  vec2 u = b + shift(texture(uDepth, b).r);
  for (int i = 0; i < 4; i++) u = b + shift(texture(uDepth, u).r);
  vec4 fg = texture(uFg, u);
  col = mix(col, fg.rgb * uEnc, fg.a);

  outColor = vec4(col, 1.0);
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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeIn = (t) => t * t * t;
const num = (v, d) => (v != null && v !== "" && Number.isFinite(+v) ? +v : d);

// The visible time: hour as the locale writes it, no day period.
function readClock(date) {
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(date);
  const h = parts.find((x) => x.type === "hour")?.value ?? String(date.getHours());
  const m = parts.find((x) => x.type === "minute")?.value ?? String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export async function createDepthClock(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const tiltQ = (q.get("tilt") || "").split(",").map(Number);
  const held = tiltQ.length === 2 && tiltQ.every(Number.isFinite);
  const timeQ = /^\d{1,2}:\d{2}$/.test(q.get("time") || "") ? q.get("time") : null;
  const rollQ = q.get("roll") != null ? clamp(num(q.get("roll"), 0.5), 0, 1) : null;
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) {
    if (typeof FILM[key] === "number") film0[key] = num(q.get(key), FILM[key]);
  }
  const numQ = { cx: num(q.get("nx"), NUM.cx), cy: num(q.get("ny"), NUM.cy), size: num(q.get("ns"), NUM.size) };
  const numL = num(q.get("nl"), 0.85);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // The colour field the sky opens from.
  host.style.background = "#dbe5ee";

  const css = getComputedStyle(document.documentElement);
  const siteFamily = css.getPropertyValue("--font-geist-sans").trim() || "sans-serif";
  const weight = css.getPropertyValue("--font-weight-semibold").trim() || "600";
  // The canvas needs the face by name: register the site's own Geist binary
  // (the same file next/font serves) under a private family.
  let family = siteFamily;
  const fontsReady = (async () => {
    try {
      const face = new FontFace("DepthClockGeist", "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
      await Promise.race([face.load(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 2500))]);
      document.fonts.add(face);
      family = `DepthClockGeist, ${siteFamily}`;
    } catch (e) {
      console.warn("depth-clock: Geist not loaded", e);
    }
  })();

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [skyBm, fgBm, depthBm] = await Promise.all([loadBitmap(`${ASSET}sky.webp`), loadBitmap(`${ASSET}fg.webp`), loadBitmap(`${ASSET}depth.webp`), fontsReady]);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm, internal, mips) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = mips ? Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, internal, bm.width, bm.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso && mips) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    bm.close?.();
    return t;
  };
  const skyTex = upload(skyBm, gl.SRGB8_ALPHA8, true);
  const fgTex = upload(fgBm, gl.SRGB8_ALPHA8, true);
  const depthTex = upload(depthBm, gl.RGBA8, false);

  const textCanvas = document.createElement("canvas");
  const tctx = textCanvas.getContext("2d");
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const scene = compile(gl, VERT, SCENE);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });

  // ---- layout: which part of the image the box shows, where the time sits
  const lay = { crop: [0, 0, 1, 1], s: 1, text: [0, 0, 1, 1], fontPx: 100, figH: 70, pad: 20, cell: 60, colon: 30, track: 0, baseX: 0 };
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    const box = W / H;
    let cw, ch;
    if (IMG_W / IMG_H > box) {
      ch = IMG_H;
      cw = IMG_H * box;
    } else {
      cw = IMG_W;
      ch = IMG_W / box;
    }
    cw /= ZOOM;
    ch /= ZOOM;
    // Portrait boxes keep the numerals' band where landscape puts it.
    const ay = box >= 1 ? ANCHOR[1] * IMG_H : clamp(numQ.cy + ch * 0.18, ch / 2, IMG_H - ch / 2);
    const x0 = clamp(ANCHOR[0] * IMG_W - cw / 2, 0, IMG_W - cw);
    const y0 = clamp(ay - ch / 2, 0, IMG_H - ch);
    lay.crop = [x0 / IMG_W, y0 / IMG_H, cw / IMG_W, ch / IMG_H];
    const s = (W * dpr) / cw; // device px per image px
    lay.s = s;
    // Type: an em in image px, never wider than the crop allows.
    const emImg = Math.min(numQ.size, cw * 0.29);
    const fontCss = emImg * (s / dpr);
    lay.fontPx = fontCss * dpr;
    // Tracking law, in device px: -0.043 x (size - 12).
    lay.track = -0.043 * (fontCss - 12) * dpr;
    tctx.font = `${weight} ${lay.fontPx}px ${family}`;
    let cell = 0;
    for (let d = 0; d <= 9; d++) cell = Math.max(cell, tctx.measureText(String(d)).width);
    lay.cell = cell;
    lay.colon = tctx.measureText(":").width;
    lay.figH = tctx.measureText("0").actualBoundingBoxAscent;
    lay.pad = Math.ceil(lay.figH * 0.34);
    lay.cx = (numQ.cx - x0) * s;
    lay.cy = (Math.min(numQ.cy, y0 + ch * 0.6) - y0) * s;
    lastText = "";
  };

  const advance = (ch) => (ch === ":" ? lay.colon : lay.cell) + lay.track;
  const glyphs = (str) => {
    let w = 0;
    for (const c of str) w += advance(c);
    w -= lay.track;
    const out = [];
    let x = -w / 2;
    for (const c of str) {
      out.push({ c, x: x + (c === ":" ? lay.colon : lay.cell) / 2 });
      x += advance(c);
    }
    return { out, w };
  };

  // ---- the clock
  let shown = timeQ ?? readClock(new Date());
  let roll = null; // { from, to, t0 }
  if (rollQ != null) {
    const [h, m] = shown.split(":").map(Number);
    const prevM = (m + 59) % 60;
    const prevH = m === 0 ? (h + 23) % 24 : h;
    roll = { from: `${prevH}:${String(prevM).padStart(2, "0")}`, to: shown, t0: 0, held: rollQ };
  }
  let lastText = "";

  const ROLL_MS = 900;
  const drawText = (now) => {
    const W = Math.ceil(stage.width * stage.dpr);
    const span = glyphs("00:00").w + lay.cell;
    const tw = Math.ceil(Math.min(W, span + lay.pad * 2));
    const th = Math.ceil(lay.figH + lay.pad * 2);
    if (textCanvas.width !== tw || textCanvas.height !== th) {
      textCanvas.width = tw;
      textCanvas.height = th;
    }
    lay.text = [lay.cx - tw / 2, lay.cy - th / 2, tw, th];
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, tw, th);
    tctx.font = `${weight} ${lay.fontPx}px ${family}`;
    tctx.textAlign = "center";
    tctx.textBaseline = "alphabetic";
    tctx.fillStyle = "#fff";
    const base = th / 2 + lay.figH / 2;
    const mid = tw / 2;
    if (!roll) {
      for (const g of glyphs(shown).out) tctx.fillText(g.c, mid + g.x, base);
      return;
    }
    // A restrained roll: the old figure lifts a little and goes, the new one
    // rises into place out of a slight blur. Only changed figures move.
    const a = glyphs(roll.from).out;
    const b = glyphs(roll.to).out;
    const travel = lay.figH * 0.2;
    let k = 0;
    for (let i = 0; i < b.length; i++) {
      const g = b[i];
      const o = a[a.length - b.length + i];
      if (o && o.c === g.c && Math.abs(o.x - g.x) < 0.5) {
        tctx.globalAlpha = 1;
        tctx.filter = "none";
        tctx.fillText(g.c, mid + g.x, base);
        continue;
      }
      const delay = k++ * 70;
      const t = roll.held != null ? roll.held : clamp((now - roll.t0 - delay) / ROLL_MS, 0, 1);
      const tin = expoOut(t);
      const tout = clamp(t / 0.42, 0, 1);
      if (o) {
        tctx.globalAlpha = 1 - tout;
        tctx.filter = reduced ? "none" : `blur(${(lay.figH * 0.03 * tout).toFixed(2)}px)`;
        tctx.fillText(o.c, mid + o.x, base - (reduced ? 0 : travel * easeIn(tout)));
      }
      tctx.globalAlpha = clamp(t / 0.5, 0, 1);
      tctx.filter = reduced ? "none" : `blur(${(lay.figH * 0.03 * (1 - tin)).toFixed(2)}px)`;
      tctx.fillText(g.c, mid + g.x, base + (reduced ? 0 : travel * (1 - tin)));
    }
    // Figures that left (10:00 -> 9:59 never happens, 9:59 -> 10:00 does).
    for (let i = 0; i < a.length - b.length; i++) {
      const t = clamp((now - roll.t0) / ROLL_MS, 0, 1);
      tctx.globalAlpha = 1 - clamp(t / 0.42, 0, 1);
      tctx.fillText(a[i].c, mid + a[i].x, base);
    }
    tctx.globalAlpha = 1;
    tctx.filter = "none";
  };
  const uploadText = () => {
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  };

  // ---- render targets
  let tex = null;
  let fbo = null;
  let enc = 1;
  let dirty = true;
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    fbo = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      // No float targets: keep the light in sRGB8 / ENC and let film decode it.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      enc = 1 / ENC;
    } else enc = 1;
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(w, h);
    layout();
    dirty = true;
  };
  stage.onResize(build);

  // ---- camera: pointer, device tilt, breathing
  const cam = { x: 0, y: 0 };
  const intro = held || reduced ? null : { from: [0.55, -0.3] };
  if (held) {
    cam.x = clamp(tiltQ[0], -1, 1);
    cam.y = clamp(tiltQ[1], -1, 1);
  } else if (intro) {
    cam.x = intro.from[0];
    cam.y = intro.from[1];
  }
  let born = performance.now();
  let breathe = 0;

  const orient = { b: null, g: null, x: 0, y: 0, on: false };
  const onOrient = (e) => {
    if (e.beta == null) return;
    if (orient.b == null) {
      orient.b = e.beta;
      orient.g = e.gamma;
    }
    // About 12 degrees of tilt reaches the end of the travel.
    orient.x = clamp((e.gamma - orient.g) / 12, -1, 1);
    orient.y = clamp((e.beta - orient.b) / 12, -1, 1);
    orient.at = performance.now();
  };
  const requestOrientation = () => {
    if (orient.on || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orient.on = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  };
  if (typeof window.DeviceOrientationEvent?.requestPermission !== "function") requestOrientation();
  stage.on("down", requestOrientation);

  let lastKey = "";
  let lastGrain = -1;
  let lastMinute = -1;

  const renderScene = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(scene.p);
    gl.bindVertexArray(vao);
    const u = scene.u;
    [skyTex, fgTex, depthTex, textTex].forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    gl.uniform1i(u.uSky, 0);
    gl.uniform1i(u.uFg, 1);
    gl.uniform1i(u.uDepth, 2);
    gl.uniform1i(u.uText, 3);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform4fv(u.uCrop, lay.crop);
    gl.uniform2f(u.uCam, cam.x, cam.y);
    gl.uniform4fv(u.uTextRect, lay.text);
    gl.uniform3f(u.uPlane, AMP, FOCUS, NUM_D);
    gl.uniform1f(u.uNumL, numL);
    gl.uniform1f(u.uEnc, ENC * enc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  const frame = (dt, t) => {
    const now = performance.now();
    const age = (now - born) / 1000;
    const p = stage.pointer;

    // The clock. A minute change starts a roll.
    if (!timeQ) {
      const d = new Date();
      const minute = Math.floor(d.getTime() / 60000);
      if (minute !== lastMinute) {
        const next = readClock(d);
        if (lastMinute !== -1 && next !== shown) roll = { from: shown, to: next, t0: now };
        shown = next;
        lastMinute = minute;
      }
    }
    if (roll && roll.held == null && now - roll.t0 > ROLL_MS + 400) roll = null;
    const textKey = roll ? (roll.held != null ? `held${roll.held}` : `r${now}`) : shown;
    if (textKey !== lastText) {
      drawText(now);
      uploadText();
      lastText = textKey;
      dirty = true;
    }

    if (!held) {
      // Pointer: the camera follows the hand inside the box (tau ~ 0.33 s)
      // and drifts home over about 1.2 s when it leaves.
      let tx = 0;
      let ty = 0;
      let lambda = 1 / 0.4;
      if (p.inside || p.down) {
        tx = clamp((p.x / stage.width - 0.5) * 2, -1, 1);
        ty = clamp((p.y / stage.height - 0.5) * 2, -1, 1);
        lambda = 1 / 0.33;
      } else if (orient.b != null) {
        tx = orient.x;
        ty = orient.y;
        lambda = 1 / 0.3;
      }
      const idle = !(p.inside || p.down) && stage.idleFor() > 1500 && !reduced;
      breathe = damp(breathe, idle ? 1 : 0, 0.7, dt);
      tx += breathe * 0.16 * Math.sin((t * 2 * Math.PI) / 11.3);
      ty += breathe * 0.12 * Math.sin((t * 2 * Math.PI) / 13.7 + 1.2);
      if (intro && age < 2.4 && !(p.inside || p.down)) {
        const k = 1 - expoOut(clamp((age - 0.2) / 2.2, 0, 1));
        cam.x = intro.from[0] * k + tx * (1 - k);
        cam.y = intro.from[1] * k + ty * (1 - k);
      } else {
        cam.x = damp(cam.x, tx, lambda, dt);
        cam.y = damp(cam.y, ty, lambda, dt);
      }
    }

    const key = `${cam.x.toFixed(4)}|${cam.y.toFixed(4)}`;
    if (key !== lastKey || dirty) {
      renderScene();
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    const expT = held ? 1 : reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + 2.5 * (1 - expT) + (enc < 1 ? Math.log2(ENC) : 0);
    // Film at 24 fps: grain moves at the rate film did.
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || expT < 1) {
      film.render(tex, { ...film0, exposure, grainSeed: tick * 7.31 });
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  // Warm every program up before the reveal: one full frame now.
  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!tex) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      [skyTex, fgTex, depthTex, textTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(scene.p);
      stage.destroy();
    },
  };
}
