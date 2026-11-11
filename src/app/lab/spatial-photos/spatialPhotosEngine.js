import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Spatial photos: five Japanese summer photographs as spatial scenes, swiped through
// the way Photos does it full screen.
//
// Each photo was cut offline (tools/depth/bakes/spatial-photos) into depth
// planes: an opaque sky with everything in front of it inpainted, then the
// wires, poles and towers as matted planes, each continued behind the planes
// in front of it, each with its own smooth depth map. Every plane is drawn as
// a mesh displaced by that depth, so a pole or a tower turns in 3D when the
// pointer (or the phone) orbits the view a degree or two, and no mesh ever
// spans a silhouette, so nothing stretches at the edges: what opens up behind
// a pole is sky that was painted there.
//
// The swipe follows the finger 1:1, and on release a spring takes the
// release velocity to the next photo (or back); grab it again mid-flight and
// it stops under the finger. The screen edge is a window onto each scene:
// as a photo slides through it, its far sky lags behind the frame and its
// near planes lead, by depth, so the two scenes keep their own space while
// they pass.
//
// The five skies share one grade, baked into the planes (grade.py, with
// signal-cumulonimbus as the reference), and everything is developed
// through the shared film pass (summer preset).
//
// Still params: ?i=0..4 photo, ?swipe=0..1 towards the next one,
// ?tilt=x,y in -1..1.

const BASE = "/lab/spatial-photos/";
const SCENES = ["kyoto-crossing-lowangle", "signal-cumulonimbus", "ine-catenary-clouds", "smokestack-cumulus", "crossing-summer"];
// The photo the piece opens on: signal-cumulonimbus, the set's reference.
const START = 1;
const HUE = {};
const GAIN = {};

const GAP = 24; // css px between photos, as Photos leaves between pages
const ZOOM = 1.06; // crop, the room the orbit moves in (Spatial Scenes crops in too)
const ORBIT = 0.024; // parallax across the full depth range at full tilt, x frame long side
const PIVOT = 0.38; // depth that stays put while orbiting
const LAG = 0.14; // how far the sky trails the frame through the screen edge
const GRID = 160;

const VERT = `#version 300 es
precision highp float;
in vec2 aGrid;
uniform vec4 uRect;      // plane rect in photo uv (x0, y0, x1, y1), y down
uniform sampler2D uDepth;
uniform vec4 uChan;      // which channel holds this plane's depth (0 for the sky)
uniform vec4 uFrame;     // frame rect, device px, top left origin
uniform vec2 uRes;       // drawing buffer size
uniform vec2 uOrbit;     // uv shift per unit of (depth - pivot)
uniform float uLag;      // uv shift of a depth-0 point from the swipe
uniform float uPlaneD;   // the plane's own depth: the swipe moves planes rigidly
uniform float uZoom;
uniform float uPivot;
out vec2 vUv;
void main() {
  vec2 uv = mix(uRect.xy, uRect.zw, aGrid);
  vUv = aGrid;
  float d = dot(texture(uDepth, uv), uChan);
  vec2 off = uOrbit * (d - uPivot);
  off.x += uLag * (1.0 - uPlaneD);
  vec2 s = (uv + off - 0.5) * uZoom + 0.5;
  vec2 p = uFrame.xy + s * uFrame.zw;
  vec2 c = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uFade;
uniform float uHue;      // radians: turns this photo's saturated blues
uniform float uGain;     // this photo's exposure, before the film
out vec4 outColor;
// Rotate about the grey axis (Rodrigues).
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec4 t = texture(uTex, vUv); // premultiplied
  if (uHue != 0.0 && t.a > 0.0) {
    vec3 c = t.rgb / t.a;
    float mx = max(c.r, max(c.g, c.b));
    float sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-3);
    float w = smoothstep(0.25, 0.6, sat) * smoothstep(0.0, 0.08, c.b - c.r);
    t.rgb = mix(c, max(hueRotate(c, uHue), 0.0), w) * t.a;
  }
  outColor = vec4(t.rgb * uGain, t.a) * uFade;
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
  gl.bindAttribLocation(p, 0, "aGrid");
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

function texture(gl, img, { premultiply = true, mips = true, raw = false } = {}) {
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

// Apple's rubber band: resistance grows with the overshoot, never a wall.
const rubber = (x, c = 0.55) => Math.sign(x) * (1 - 1 / ((Math.abs(x) * c) + 1)) / c;

export async function createSpatialPhotos(host, { embedded = false } = {}) {
  const q = new URLSearchParams(location.search);
  const num = (k) => {
    const v = q.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const iQ = num("i");
  const swipeQ = num("swipe");
  const tiltRaw = q.get("tilt");
  const tiltQ = tiltRaw ? tiltRaw.split(",").map(Number).filter(Number.isFinite) : null;
  const still = iQ != null || swipeQ != null || (tiltQ && tiltQ.length > 0);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const N = SCENES.length;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  stage.canvas.style.cursor = "grab";

  const prog = compile(gl, VERT, FRAG);
  const film = createFilm(gl, { width: 2, height: 2 });

  // One unit grid, shared by every plane.
  const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2);
  for (let y = 0, k = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++, k += 2) (verts[k] = x / GRID), (verts[k + 1] = y / GRID);
  const idx = new Uint32Array(GRID * GRID * 6);
  for (let y = 0, k = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const a = y * (GRID + 1) + x;
      const b = a + 1;
      const c = a + GRID + 1;
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

  // A flat 1x1 depth for the thumbnails.
  const flat = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, flat);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  // ---- scenes: metadata and thumbnails now, planes when needed
  const metas = await Promise.all(SCENES.map((s) => fetch(`${BASE}${s}/scene.json`).then((r) => r.json())));
  const scenes = SCENES.map((slug, i) => ({
    slug,
    meta: metas[i],
    aspect: metas[i].size[0] / metas[i].size[1],
    thumb: null,
    planes: null,
    depth: null,
    state: "idle",
    fade: 0,
  }));
  await Promise.all(
    scenes.map((s) =>
      loadImage(`${BASE}${s.slug}/t.webp`).then((img) => {
        s.thumb = texture(gl, img, { mips: false });
      }),
    ),
  );
  let destroyed = false;
  const ensure = (i) => {
    const s = scenes[i];
    if (!s || s.state !== "idle") return s?.loading;
    s.state = "loading";
    const names = s.meta.planes.map((p) => `p${p.k}.webp`);
    s.loading = Promise.all([...names.map((n) => loadImage(`${BASE}${s.slug}/${n}`)), loadImage(`${BASE}${s.slug}/depth.png`)]).then((imgs) => {
      if (destroyed) return;
      s.depth = texture(gl, imgs.pop(), { premultiply: false, mips: false, raw: true });
      s.planes = imgs.map((img, k) => ({ tex: texture(gl, img), rect: s.meta.planes[k].rect, k, d: k === 0 ? 0 : s.meta.planes[k].depth }));
      s.state = "ready";
      s.readyAt = performance.now();
      dirty = true;
    });
    return s.loading;
  };

  // ---- state
  let pos = clamp(iQ ?? START, 0, N - 1) + clamp(swipeQ ?? 0, 0, 1);
  pos = clamp(pos, 0, N - 1);
  let vel = 0;
  let target = Math.round(pos);
  let springing = false;
  let drag = null;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  if (tiltQ && tiltQ.length) {
    tilt.x = tilt.tx = clamp(tiltQ[0] ?? 0, -1, 1);
    tilt.y = tilt.ty = clamp(tiltQ[1] ?? 0, -1, 1);
  }
  let orient = null; // device tilt, once permitted
  let exposureAge = still ? 1e9 : 0;
  let revealStarted = still;
  let grainT = 0;
  let grainSeed = 1;
  let time = 0;
  let dirty = true;

  // Current photo first, then its neighbours.
  const evict = (keep) => {
    // more than one photo away: give the GPU memory back
    for (let i = 0; i < N; i++) {
      const s = scenes[i];
      if (s.state !== "ready" || keep.has(i)) continue;
      gl.deleteTexture(s.depth);
      s.planes.forEach((p) => gl.deleteTexture(p.tex));
      Object.assign(s, { planes: null, depth: null, state: "idle", fade: 0, loading: null });
    }
  };
  const prefetch = () => {
    if (still) return;
    const c = Math.round(pos);
    evict(new Set([c - 1, c, c + 1, Math.round(target), Math.floor(pos), Math.ceil(pos)]));
    ensure(c);
    scenes[c].loading?.then(() => {
      ensure(c + 1);
      ensure(c - 1);
      if (Math.round(target) !== c) ensure(Math.round(target));
    });
  };
  if (!still) prefetch();
  if (still) {
    await Promise.all([ensure(Math.floor(pos)), ensure(Math.min(N - 1, Math.floor(pos) + 1))]);
  }

  // ---- layout
  let sceneT = null;
  const freeTarget = () => {
    if (!sceneT) return;
    gl.deleteTexture(sceneT.tex);
    gl.deleteFramebuffer(sceneT.fbo);
    sceneT = null;
  };
  const box = { w: 1, h: 1, dpr: 1, pw: 1, ph: 1 };
  stage.onResize((w, h, dpr) => {
    Object.assign(box, { w, h, dpr, pw: Math.round(w * dpr), ph: Math.round(h * dpr) });
    freeTarget();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, box.pw, box.ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    sceneT = { tex, fbo };
    film.resize(box.pw, box.ph);
    dirty = true;
  });
  const pageW = () => box.w + GAP;
  // Frame of photo i in css px: contained in the box, as Photos shows it.
  const frameOf = (i) => {
    const a = scenes[i].aspect;
    let fw = box.w;
    let fh = fw / a;
    if (fh > box.h) {
      fh = box.h;
      fw = fh * a;
    }
    const x = (box.w - fw) / 2 + (i - pos) * pageW();
    return { x, y: (box.h - fh) / 2, w: fw, h: fh };
  };

  // ---- input
  const toPage = (dxCss) => dxCss / pageW();
  stage.on("down", (p) => {
    drag = { x0: p.x, y0: p.y, pos0: pos, moved: false, axis: null };
    springing = false;
    vel = 0;
    stage.canvas.style.cursor = "grabbing";
    dirty = true;
  });
  stage.on("move", (p) => {
    if (!drag) {
      // hover orbit, never 1:1
      const f = frameOf(Math.round(pos));
      tilt.tx = clamp((p.x - (f.x + f.w / 2)) / (f.w / 2), -1, 1);
      tilt.ty = clamp((p.y - (f.y + f.h / 2)) / (f.h / 2), -1, 1);
      dirty = true;
      return;
    }
    const dx = p.x - drag.x0;
    const dy = p.y - drag.y0;
    if (!drag.axis && Math.hypot(dx, dy) > 4) drag.axis = Math.abs(dx) >= Math.abs(dy) * 0.8 ? "x" : "y";
    if (drag.axis !== "x") return;
    drag.moved = true;
    const raw = drag.pos0 - toPage(dx);
    const c = clamp(raw, 0, N - 1);
    pos = c + rubber(raw - c) * 0.6;
    target = Math.round(pos);
    prefetch();
    dirty = true;
  });
  const release = (p) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.canvas.style.cursor = "grab";
    if (!d.moved) {
      askOrientation();
      return;
    }
    vel = -toPage(p.vx);
    const start = Math.round(d.pos0);
    const projected = pos + vel * 0.22;
    target = clamp(Math.round(projected), Math.max(0, start - 1), Math.min(N - 1, start + 1));
    springing = true;
    prefetch();
    dirty = true;
  };
  stage.on("up", release);
  const onLeave = () => {
    tilt.tx = 0;
    tilt.ty = 0;
    dirty = true;
  };
  stage.canvas.addEventListener("pointerleave", onLeave);

  const go = (dir) => {
    target = clamp(Math.round(target) + dir, 0, N - 1);
    springing = true;
    prefetch();
    dirty = true;
  };
  const onKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else return;
    e.preventDefault();
  };
  if (!embedded) window.addEventListener("keydown", onKey);

  // Phones: the scene answers the phone's tilt, as on the lock screen.
  let base = null;
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!base) base = { g: e.gamma, b: e.beta };
    // drift the rest pose slowly so holding the phone differently re-centres
    base.g += (e.gamma - base.g) * 0.004;
    base.b += (e.beta - base.b) * 0.004;
    orient = { x: clamp((e.gamma - base.g) / 14, -1, 1), y: clamp((e.beta - base.b) / 14, -1, 1) };
    dirty = true;
  };
  let askedOrientation = false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const askOrientation = () => {
    if (askedOrientation || !coarse || still) return;
    askedOrientation = true;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    if (typeof DOE.requestPermission === "function") {
      DOE.requestPermission()
        .then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient))
        .catch(() => {});
    } else window.addEventListener("deviceorientation", onOrient);
  };
  if (coarse && !still && typeof window.DeviceOrientationEvent?.requestPermission !== "function") askOrientation();

  // ---- draw
  const drawScene = (i) => {
    const s = scenes[i];
    const f = frameOf(i);
    const dpr = box.dpr;
    // the part of this frame that has crossed the screen edge
    const cutL = Math.max(0, -f.x);
    const cutR = Math.max(0, f.x + f.w - box.w);
    // far content lags the frame by LAG of what has crossed: shifted right
    // (towards where it came from) when leaving left, left when coming in
    // from the right. In uv before the crop zoom.
    const lagPx = (cutL - cutR) * LAG;
    const lag = lagPx / f.w / ZOOM;
    const long = Math.max(f.w, f.h);
    const ox = (-tilt.x * ORBIT * long) / f.w;
    const oy = (-tilt.y * ORBIT * long) / f.h;
    const x0 = Math.max(0, Math.floor(f.x * dpr));
    const x1 = Math.min(box.pw, Math.ceil((f.x + f.w) * dpr));
    const y0 = Math.max(0, Math.floor(f.y * dpr));
    const y1 = Math.min(box.ph, Math.ceil((f.y + f.h) * dpr));
    if (x1 <= x0 || y1 <= y0) return;
    gl.scissor(x0, box.ph - y1, x1 - x0, y1 - y0);
    const u = prog.u;
    gl.uniform4f(u.uFrame, f.x * dpr, f.y * dpr, f.w * dpr, f.h * dpr);
    gl.uniform2f(u.uOrbit, ox, oy);
    gl.uniform1f(u.uLag, lag);
    gl.uniform1f(u.uZoom, ZOOM);
    gl.uniform1f(u.uPivot, PIVOT);
    gl.uniform1f(u.uHue, ((HUE[s.slug] || 0) * Math.PI) / 180);
    gl.uniform1f(u.uGain, GAIN[s.slug] || 1);
    const ready = s.state === "ready";
    const fade = ready ? s.fade : 0;
    if (fade < 1) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, flat);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.thumb);
      gl.uniform4f(u.uRect, 0, 0, 1, 1);
      gl.uniform4f(u.uChan, 0, 0, 0, 0);
      gl.uniform1f(u.uPlaneD, 0);
      gl.uniform1f(u.uFade, 1);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    }
    if (!ready || fade <= 0) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.depth);
    for (const p of s.planes) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.uniform4f(u.uRect, p.rect[0], p.rect[1], p.rect[2], p.rect[3]);
      const c = p.k - 1;
      gl.uniform4f(u.uChan, c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0, c === 3 ? 1 : 0);
      gl.uniform1f(u.uPlaneD, p.d);
      gl.uniform1f(u.uFade, fade);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    }
  };

  const render = () => {
    if (!sceneT) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, box.pw, box.ph);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    gl.uniform2f(prog.u.uRes, box.pw, box.ph);
    gl.uniform1i(prog.u.uTex, 0);
    gl.uniform1i(prog.u.uDepth, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    const lo = Math.max(0, Math.floor(pos - 1));
    const hi = Math.min(N - 1, Math.ceil(pos + 1));
    const frames = [];
    for (let i = lo; i <= hi; i++) {
      const f = frameOf(i);
      if (f.x + f.w <= 0 || f.x >= box.w) continue;
      drawScene(i);
      frames.push(f);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);

    // Develop. The reveal opens overexposed, an airy white-blue, and the sky
    // deepens into cobalt as the eye adjusts.
    const t = clamp(exposureAge / (reduce ? 0.3 : 2.1), 0, 1);
    const ease = 1 - Math.pow(1 - t, 4);
    const exposure = reduce ? 0 : 2.4 * (1 - ease);
    film.render(sceneT.tex, { ...FILM_PRESETS.summer, exposure, grainSeed });

    // The ground between and around the photos is clean black: the film's
    // veil and lifted toe belong to the prints, not to the screen.
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    const dpr = box.dpr;
    const rects = [];
    const xs = frames.map((f) => [Math.max(0, Math.round(f.x * dpr)), Math.min(box.pw, Math.round((f.x + f.w) * dpr)), Math.round(f.y * dpr), Math.round((f.y + f.h) * dpr)]).sort((a, b) => a[0] - b[0]);
    let cx = 0;
    for (const [a, b, ya, yb] of xs) {
      if (a > cx) rects.push([cx, 0, a - cx, box.ph]);
      if (ya > 0) rects.push([a, 0, b - a, ya]);
      if (yb < box.ph) rects.push([a, yb, b - a, box.ph - yb]);
      cx = Math.max(cx, b);
    }
    if (cx < box.pw) rects.push([cx, 0, box.pw - cx, box.ph]);
    for (const [x, y, w, h] of rects) {
      if (w <= 0 || h <= 0) continue;
      gl.scissor(x, box.ph - y - h, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
  };

  // ---- frame loop
  const OMEGA = (2 * Math.PI) / 0.5; // response
  const ZETA = 0.88;
  stage.onFrame((dt) => {
    let active = false;
    // spring
    if (springing && !drag) {
      const n = 4;
      const h = dt / n;
      for (let k = 0; k < n; k++) {
        const acc = -OMEGA * OMEGA * (pos - target) - 2 * ZETA * OMEGA * vel;
        vel += acc * h;
        pos += vel * h;
      }
      if (Math.abs(pos - target) < 1e-4 && Math.abs(vel) < 1e-3) {
        pos = target;
        vel = 0;
        springing = false;
      }
      active = true;
    }
    if (drag) active = true;

    // orbit target: device tilt on phones, the pointer elsewhere, and a slow
    // breath of a fraction of a degree when nothing moves it
    if (!still) {
      time += dt;
      let tx = orient ? orient.x : tilt.tx;
      let ty = orient ? orient.y : tilt.ty;
      if (drag) {
        tx = tilt.x;
        ty = tilt.y;
      }
      if (!reduce) {
        tx += 0.14 * Math.sin((time * 2 * Math.PI) / 11);
        ty += 0.1 * Math.sin((time * 2 * Math.PI) / 13.7 + 1.3);
      }
      const leaving = !orient && !stage.pointer.inside;
      const lambda = leaving ? 2.6 : 1 / 0.35;
      const nx = damp(tilt.x, clamp(tx, -1, 1), lambda, dt);
      const ny = damp(tilt.y, clamp(ty, -1, 1), lambda, dt);
      if (Math.abs(nx - tilt.x) + Math.abs(ny - tilt.y) > 1e-5) active = true;
      tilt.x = nx;
      tilt.y = ny;
    }

    // fade new planes in over the thumbnail, then the reveal
    for (const s of scenes) {
      if (s.state === "ready" && s.fade < 1) {
        s.fade = still || reduce ? 1 : Math.min(1, s.fade + dt / 0.45);
        active = true;
      }
    }
    const cur = scenes[Math.round(pos)];
    if (!revealStarted && cur.state === "ready") revealStarted = true;
    if (revealStarted && exposureAge < 3) {
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
      destroyed = true;
      if (!embedded) window.removeEventListener("keydown", onKey);
      window.removeEventListener("deviceorientation", onOrient);
      stage.canvas.removeEventListener("pointerleave", onLeave);
      film.destroy();
      freeTarget();
      for (const s of scenes) {
        if (s.thumb) gl.deleteTexture(s.thumb);
        if (s.depth) gl.deleteTexture(s.depth);
        s.planes?.forEach((p) => gl.deleteTexture(p.tex));
      }
      gl.deleteTexture(flat);
      gl.deleteBuffer(vb);
      gl.deleteBuffer(ib);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog.p);
      stage.destroy();
    },
  };
}
