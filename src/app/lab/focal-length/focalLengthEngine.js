import { clamp, damp } from "../_kit/stage";
import { createFilm } from "../_kit/film";

// Focal Length: lie on the pavement between towers, look straight up, and
// turn the zoom ring from 24 mm to 10 mm.
//
// The plate is one 360 capture of Canary Wharf (Poly Haven, CC0) with a
// summer cumulus sky (Poly Haven, CC0) set in behind the towers, graded
// offline and stored as a zenith cap: an azimuthal equidistant map, theta
// from the zenith out to 95 degrees, plus a native-resolution inset of the
// centre 47.5 degrees, which holds the whole frame from 20 mm to 24 mm and
// the middle of it below that. Every pixel is a ray through one radial family,
//
//   r = f k tan(theta / k)
//
// with f the focal length itself (the frame's diagonal is full frame's
// 43.3 mm), so the centre of the picture is drawn at exactly the scale that
// lens would draw it. From 24 to 16 mm it is a plain rectilinear lens
// (k = 1): towers lean in from the edges and the corners stretch. Below
// 16 mm k eases toward stereographic, the way an ultra-wide is drawn when it
// stops pretending to be a pinhole: the corners stop stretching and start
// to bend, the field opens past what rectilinear can reach, and the towers
// close into spokes round the sky.
//
// The ring stops at 24 mm because that is as long as the capture resolves:
// the 16k plate holds about 45 px a degree, and a 24 mm frame at DPR 2 asks
// for about 30 at its centre (a 50 mm one asked for 65, so the clouds went
// soft and their shadows turned to grey blotches under magnification). At
// 24 mm the frame is still mostly cumulus, the towers only at the corners.
//
// Query: ?mm=10..24 holds a focal length.

const ASSET = "/lab/focal-length/";
const TM = 95; // degrees from the zenith covered by the outer cap
const RI = 0.5; // the inner inset covers rho <= 0.5 (47.5 degrees: the whole frame at 20 mm)
const ENC = 2.0; // the caps store scene light / 2, sRGB-encoded
const HALF_DIAG = 21.633; // mm, full frame

const MM_LONG = 24;
const MM_WIDE = 10;
const DETENTS = [24, 20, 16, 12, 10];
const MM_REST = 14; // where the reveal hands over
const LN = Math.log(MM_LONG / MM_WIDE);
const uOf = (mm) => Math.log(MM_LONG / mm) / LN; // 0 at 24 mm, 1 at 10 mm
const mmOf = (u) => MM_LONG / Math.exp(u * LN);
const DETENT_U = DETENTS.map(uOf);

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uOuter;
uniform sampler2D uInner;
uniform vec2 uRes;      // device px
uniform float uF;       // px, the lens constant for this k
uniform float uK;       // 1 rectilinear .. 2 stereographic
uniform vec3 uRot;      // small tilts about world x and z, roll about the zenith
uniform float uGain;
const float TM = ${((TM * Math.PI) / 180).toFixed(6)};
const float RI = ${RI.toFixed(4)};

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uRes;
  float r = length(p);
  float th = uK * atan(r / (uF * uK));
  vec2 d2 = r > 1e-4 ? p / r : vec2(0.0);
  // camera looks up the world's +y; screen right is +x, screen up is -z,
  // the plate's own up, so the picture is never mirrored (signage reads)
  vec3 w = vec3(sin(th) * d2.x, cos(th), -sin(th) * d2.y);
  float ca = cos(uRot.x), sa = sin(uRot.x);
  w = vec3(w.x, w.y * ca - w.z * sa, w.y * sa + w.z * ca);
  float cb = cos(uRot.y), sb = sin(uRot.y);
  w = vec3(w.x * cb - w.y * sb, w.x * sb + w.y * cb, w.z);
  float cr = cos(uRot.z), sr = sin(uRot.z);
  w = vec3(w.x * cr - w.z * sr, w.y, w.x * sr + w.z * cr);
  float h = length(w.xz);
  float thz = atan(h, w.y);
  float rho = thz / TM;
  vec2 dir = h > 1e-7 ? w.xz / h : vec2(0.0);
  vec3 o = texture(uOuter, 0.5 + 0.5 * rho * dir).rgb;
  vec3 i = texture(uInner, 0.5 + 0.5 * (rho / RI) * dir).rgb;
  float wi = 1.0 - smoothstep(RI * 0.84, RI * 0.97, rho);
  outColor = vec4(mix(o, i, wi) * uGain, 1.0);
}`;

const FILM = {
  input: "linear",
  headroom: 0,
  exposure: 0,
  whitePoint: 2.0,
  contrast: 1.16,
  shoulder: 0.95,
  toe: 0.035,
  halation: 0.22,
  halationThreshold: 0.95,
  bloom: 0.16,
  softness: 0.42,
  saturation: 1.04,
  blueDepth: 0.3,
  grain: 0.34,
  vignette: 0.2,
  // sunlit cloud lands warm-neutral, never blue-white
  highlightTint: [1.02, 1, 0.965],
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Rectilinear down to 16 mm, then easing toward stereographic by 10 mm.
const K_WIDE = 0.34;
const kOf = (mm) => 1 + K_WIDE * smoothstep(16, 10, mm);

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

function uploadCap(gl, bm, aniso) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, bm.width, bm.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  bm.close?.();
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return tex;
}

// A damped spring on one value.
function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

// A zoom ring's markings, felt rather than seen: near each focal length the
// ring turns a little slower, so the hand finds the notch.
function notched(u) {
  let out = u;
  for (const d of DETENT_U) {
    const x = u - d;
    out -= 0.55 * x * Math.exp(-(x * x) / (0.03 * 0.03));
  }
  return out;
}
const nearestDetent = (u) => DETENT_U.reduce((best, d) => (Math.abs(d - u) < Math.abs(best - u) ? d : best), DETENT_U[0]);

export async function createFocalLength(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const qmm = q.get("mm");
  const held = qmm != null && qmm !== "" && Number.isFinite(+qmm);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---- DOM: the picture fills the box, its focal length set bottom-left.
  const box = host.closest(".piece-box") || host;
  const print = document.createElement("div");
  print.className = "fl-print";
  const canvas = document.createElement("canvas");
  canvas.className = "kit-canvas fl-canvas";
  print.appendChild(canvas);
  const mark = document.createElement("div");
  mark.className = "fl-mark";
  mark.setAttribute("aria-live", "polite");
  host.appendChild(print);
  host.appendChild(mark);
  host.tabIndex = 0;
  host.setAttribute("role", "slider");
  host.setAttribute("aria-label", "Focal length");
  host.setAttribute("aria-valuemin", String(MM_WIDE));
  host.setAttribute("aria-valuemax", String(MM_LONG));

  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("no webgl2");

  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const [outerBm, innerBm] = await Promise.all([loadBitmap(`${ASSET}outer.webp`), loadBitmap(`${ASSET}inner.webp`)]);
  const outer = uploadCap(gl, outerBm, aniso);
  const inner = uploadCap(gl, innerBm, aniso);

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

  const film = createFilm(gl, { width: 2, height: 2 });

  // ---- layout and the scene target
  let W = 1; // frame size, css px
  let H = 1;
  let dpr = 1;
  let tex = null;
  let fbo = null;
  let enc = 1;
  let dirty = true;
  const build = () => {
    const w = canvas.width;
    const h = canvas.height;
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
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      enc = 1 / ENC; // keep the light in range; film is told the stops
    } else enc = 1;
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(w, h);
    dirty = true;
  };

  // Full bleed: the frame is the box, so the towers run off every edge. The
  // lens is set by the frame's diagonal (full frame's 43.3 mm), so a
  // landscape window is a camera held level and a phone is one held upright.
  const MAX_PX = 3840 * 2160; // device px the scene and film are rendered at
  const layout = () => {
    const r = print.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    W = w;
    H = h;
    // Render at the screen's own density, so the bigger surface stays sharp.
    dpr = Math.min(3, window.devicePixelRatio || 1, Math.sqrt(MAX_PX / (w * h)));
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (cw === canvas.width && ch === canvas.height && tex) return;
    canvas.width = cw;
    canvas.height = ch;
    build();
  };
  const ro = new ResizeObserver(layout);
  ro.observe(box);
  ro.observe(print);
  layout();

  // ---- state
  const startU = held ? clamp(uOf(clamp(+qmm, MM_WIDE, MM_LONG)), 0, 1) : reduced ? uOf(MM_REST) : 0;
  const zoom = spring(startU);
  const hover = { x: 0, y: 0 };
  let born = performance.now();
  let introDone = held || reduced;
  const exposureFrom = held ? 0 : 2.5;
  let grab = null;
  let lastKey = "";
  let lastGrain = -1;
  let lastMark = "";
  let breathe = 0;
  let lastInput = -1e9;
  let wheelAt = -1e9;
  let wheelPending = false;

  const pointer = { x: 0, y: 0, inside: false, vx: 0, t: 0 };
  // px for the whole 24 -> 10 turn: about a hand's sweep, whatever the width
  const dragScale = () => clamp(W * 0.55, 360, 720);

  const local = (e) => {
    const r = print.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e) => {
    if (grab) return;
    const [x, y] = local(e);
    introDone = true;
    grab = { id: e.pointerId, x, u0: zoom.to, raw: zoom.to };
    Object.assign(pointer, { x, y, vx: 0, t: performance.now(), inside: true });
    lastInput = performance.now();
    host.setPointerCapture?.(e.pointerId);
    host.dataset.grabbing = "";
  };
  const onMove = (e) => {
    const [x, y] = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - pointer.t);
    const k = Math.min(1, dt / 40);
    pointer.vx += (((x - pointer.x) / dt) * 1000 - pointer.vx) * k;
    Object.assign(pointer, { x, y, t: now, inside: true });
    if (grab && e.pointerId === grab.id) {
      lastInput = now;
      let raw = grab.u0 + (x - grab.x) / dragScale();
      // Past the ends the ring resists.
      if (raw > 1) raw = 1 + (raw - 1) * 0.35;
      if (raw < 0) raw = raw * 0.35;
      grab.raw = raw;
      zoom.to = notched(raw);
    }
  };
  const onUp = (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    grab = null;
    delete host.dataset.grabbing;
    lastInput = performance.now();
    const vu = performance.now() - pointer.t > 60 ? 0 : pointer.vx / dragScale();
    // Carry the hand's speed, then settle into the nearest marking if close.
    const land = clamp(zoom.to + vu * 0.2, 0, 1);
    const d = nearestDetent(land);
    zoom.to = Math.abs(d - land) < 0.075 ? d : land;
  };
  const onLeave = () => {
    pointer.inside = false;
  };
  const onWheel = (e) => {
    // On the index a plain vertical scroll belongs to the page.
    const pinch = e.ctrlKey;
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (embedded && !pinch && !sideways) return;
    e.preventDefault();
    introDone = true;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const d = (sideways ? e.deltaX : e.deltaY) * unit * (pinch ? 2.5 : 1);
    zoom.to = clamp(zoom.to + d / 700, 0, 1);
    wheelAt = performance.now();
    wheelPending = true;
    lastInput = wheelAt;
  };
  const onKey = (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    introDone = true;
    const cur = zoom.to;
    const next = dir > 0 ? DETENT_U.find((d) => d > cur + 0.01) : [...DETENT_U].reverse().find((d) => d < cur - 0.01);
    if (next != null) zoom.to = next;
    lastInput = performance.now();
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKey);

  const renderScene = (mm, rot) => {
    const w = canvas.width;
    const h = canvas.height;
    const k = kOf(mm);
    const f = (0.5 * Math.hypot(w, h) * mm) / HALF_DIAG;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(scene.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, outer);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inner);
    gl.uniform1i(scene.u.uOuter, 0);
    gl.uniform1i(scene.u.uInner, 1);
    gl.uniform2f(scene.u.uRes, w, h);
    gl.uniform1f(scene.u.uF, f);
    gl.uniform1f(scene.u.uK, k);
    gl.uniform3f(scene.u.uRot, rot[0], rot[1], rot[2]);
    gl.uniform1f(scene.u.uGain, ENC * enc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  let raf = 0;
  let visible = true;
  let destroyed = false;
  let last = 0;
  const D2R = Math.PI / 180;

  const frame = (dt, t) => {
    const now = performance.now();
    const age = (now - born) / 1000;

    // Reveal: open on the long end, overexposed, and widen to 14 mm, so the
    // towers lean in from the edges and the lens shows what it does.
    if (!introDone) {
      const u = clamp((age - 0.5) / 2.2, 0, 1);
      zoom.to = uOf(MM_REST) * expoOut(u);
      if (u >= 1) introDone = true;
    }
    const expT = reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = exposureFrom * (1 - expT);

    if (wheelPending && now - wheelAt > 160) {
      wheelPending = false;
      const d = nearestDetent(zoom.to);
      if (Math.abs(d - zoom.to) < 0.025) zoom.to = d;
    }
    if (grab) stepSpring(zoom, 40, 1, dt);
    else if (!introDone) {
      zoom.x = zoom.to;
      zoom.v = 0;
    } else stepSpring(zoom, 13, 0.86, dt);

    // Hover: the view leans a degree toward the pointer, never 1:1.
    const live = !grab && pointer.inside && !reduced && !held;
    const hx = live ? (pointer.x / W - 0.5) * 2 : 0;
    const hy = live ? (pointer.y / H - 0.5) * 2 : 0;
    hover.x = damp(hover.x, hx, 1 / 0.35, dt);
    hover.y = damp(hover.y, hy, 1 / 0.35, dt);

    // Breathing: a held camera, half a degree on a slow Lissajous.
    const idle = !grab && now - lastInput > 1500 && introDone && !held && !reduced;
    breathe = damp(breathe, idle ? 1 : 0, 0.8, dt);
    const bx = breathe * 0.4 * Math.sin((t * 2 * Math.PI) / 11.3);
    const by = breathe * 0.35 * Math.sin((t * 2 * Math.PI) / 13.7 + 1.2);

    const mm = mmOf(clamp(zoom.x, -0.08, 1.08));
    const rot = [(hover.y * 1.2 + by) * D2R, (-hover.x * 1.2 + bx) * D2R, 0];
    const key = `${mm.toFixed(4)}|${rot[0].toFixed(5)}|${rot[1].toFixed(5)}`;
    if (key !== lastKey || dirty) {
      renderScene(mm, rot);
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // Film at 24 fps: the grain moves at the rate film did.
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || exposure > 1e-3) {
      film.render(tex, { ...FILM, exposure: exposure + (enc < 1 ? Math.log2(ENC) : 0), grainSeed: tick * 7.31 });
      lastGrain = tick;
    }

    const label = `${Math.round(clamp(mm, MM_WIDE, MM_LONG))} mm`;
    if (label !== lastMark) {
      mark.textContent = label;
      host.setAttribute("aria-valuenow", String(Math.round(mm)));
      lastMark = label;
    }
  };

  const loop = (t) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(1 / 20, last ? (t - last) / 1000 : 1 / 60);
    last = t;
    frame(dt, t / 1000);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!raf && visible && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    wake();
  });
  io.observe(box);
  const onVis = () => {
    visible = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);

  // Warm every program up before the reveal: one full frame now.
  frame(1 / 60, performance.now() / 1000);
  born = performance.now();
  wake();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("keydown", onKey);
      film.destroy();
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      gl.deleteTexture(outer);
      gl.deleteTexture(inner);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(scene.p);
      print.remove();
      mark.remove();
    },
  };
}
