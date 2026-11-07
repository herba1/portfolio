import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createModal } from "./modal";

// Poke: a still frame of a tree against a summer sky that you can pull.
//
// Image-space modal bases (Abe Davis, Justin G. Chen and Fredo Durand,
// "Image-Space Modal Bases for Plausible Manipulation of Objects in Video",
// SIGGRAPH Asia 2015; the method behind Interactive Dynamic Video). Twenty-six
// seconds of a locked-off clip of the tree moving in the wind were taken apart
// offline (tools/depth/bakes/poke): dense optical flow from one reference
// frame to every other, a spectral decomposition of all that motion at once
// (frequency domain decomposition), and the twelve strongest spatially
// coherent resonances kept as complex 2D displacement fields with their own
// measured frequency (0.36 to 1.27 Hz) and damping ratio (6 to 29%).
//
// Live, the reference frame is warped by the sum of those modes. Grab any
// part of the picture and it follows the hand through a stiff spring; every
// other part of the tree answers through the modes it shares with that spot,
// with its own lag. Let go and each mode rings down at its own frequency and
// damping. The tree is a matted layer over the sky behind it (filled and
// regraded offline), so a branch that swings away uncovers sky instead of
// dragging it. The frame is developed with the shared film kit (summer).
//
// Query: ?poke=x,y,amp[,deg] holds a pull at print uv (x, y) by amp (a
// fraction of the print's width, toward deg, default 180 = left); add
// &t=seconds for the moment that long after letting go. ?still=1 stops the
// breeze.

const BASE = "/lab/poke/";
const ASPECT = 1.5; // the print, 3:2
const VIEW_H = 0.95; // share of the plate's height the print shows
const VIEW_X = 0.985; // right edge of the print in the plate (the tree runs off it)
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const LMAX = 90; // plate px: how far the pointer can lead the grabbed point (soft)
const BREEZE = 0.2; // idle forcing, in units of each mode's static response
const REVEAL = 1.8;
const SHUTTER = 1 / 30; // s, for motion blur

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const sceneFrag = (K) => `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTree;          // RGBA: decontaminated tree colour, matte
uniform sampler2D uSky;           // the sky behind it, filled and regraded
uniform sampler2DArray uModes;    // ${K} layers: re x, re y, im x, im y (0..1 = -1..1)
uniform vec2 uQ[${K}];            // modal coordinates times each layer's scale
uniform vec2 uV[${K}];            // their velocities, times the shutter time
uniform vec4 uView;               // print window in plate uv
uniform vec2 uPlate;
uniform float uExpo;

vec2 field(vec2 uv) {
  vec2 d = vec2(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(uv, float(i))) * 2.0 - 1.0;
    d += m.xy * uQ[i].x - m.zw * uQ[i].y;
  }
  return d / uPlate;
}
// displacement and how far it travels while the shutter is open
vec4 field2(vec2 uv) {
  vec4 d = vec4(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(uv, float(i))) * 2.0 - 1.0;
    d.xy += m.xy * uQ[i].x - m.zw * uQ[i].y;
    d.zw += m.xy * uV[i].x - m.zw * uV[i].y;
  }
  return d / uPlate.xyxy;
}

void main() {
  vec2 uv = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;
  // backward warp: where the material drawn here came from (inverse of the
  // forward displacement by two fixed-point steps)
  vec2 d = field(uv);
  vec4 dv = field2(uv - d);
  vec2 src = uv - dv.xy;
  // a film shutter: the tree is integrated along its own motion, so a fast
  // swing streaks the way it would on a 1/30 s frame (premultiplied)
  vec4 tree = vec4(0.0);
  if (dot(dv.zw, dv.zw) * uPlate.x * uPlate.x < 0.25) {
    tree = texture(uTree, src);
  } else {
    for (int k = 0; k < 6; k++) {
      vec4 t = texture(uTree, src - dv.zw * (float(k) / 5.0 - 0.5));
      tree += vec4(t.rgb * t.a, t.a);
    }
    tree /= 6.0;
    tree.rgb /= max(tree.a, 1e-4);
  }
  vec3 sky = texture(uSky, uv).rgb;
  vec3 col = mix(sky, tree.rgb, tree.a);
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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// the mode atlas (K tiles stacked vertically) as a texture array, and its
// exact bytes read back for the CPU side
function modeArray(gl, bmp, gw, gh, K) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, gw, gh, K, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const layers = [];
  for (let i = 0; i < K; i++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, i);
    const px = new Uint8Array(gw * gh * 4);
    gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    layers.push(px);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return { tex: t, layers };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

// a seeded generator, so a still is the same every time
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createPoke(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const pokeQ = (q.get("poke") || "").split(",").map(Number).filter(Number.isFinite);
  const tQ = q.get("t") != null && q.get("t") !== "" && Number.isFinite(+q.get("t")) ? +q.get("t") : null;
  const posed = pokeQ.length >= 3;
  const still = posed || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [meta, treeBmp, skyBmp, modesBmp] = await Promise.all([
    fetch(BASE + "modes.json").then((r) => r.json()),
    loadBitmap(BASE + "tree.webp"),
    loadBitmap(BASE + "sky.webp"),
    loadBitmap(BASE + "modes.png"),
  ]);
  const K = meta.modes.length;
  const [gw, gh] = meta.grid;
  const [PW, PH] = meta.plate;
  const tex = { tree: imageTexture(gl, treeBmp), sky: imageTexture(gl, skyBmp) };
  const ma = modeArray(gl, modesBmp, gw, gh, K);
  tex.modes = ma.tex;
  treeBmp.close?.();
  skyBmp.close?.();
  modesBmp.close?.();
  const modal = createModal(meta, ma.layers);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const scene = program(gl, VERT, sceneFrag(K));
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout: a 3:2 print on the paper; the print is a window on the plate ---
  const L = { x: 0, y: 0, w: 1, h: 1, view: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      // a phone gets a 4:5 print: the crown against the sky, the way it is held
      const aspect = W < 600 ? 0.8 : ASPECT;
      const side = W < 600 ? 16 : Math.max(24, W * 0.07);
      let h = H * (W < 600 ? 0.7 : 0.78);
      let w = h * aspect;
      if (w > W - side * 2) {
        w = W - side * 2;
        h = w / aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - (W < 600 ? 8 : 4) });
    }
    // window in the plate: full print height of VIEW_H, anchored at the right
    const a = L.w / L.h;
    let vh = VIEW_H;
    let vw = (vh * a * PH) / PW;
    if (vw > 0.97) {
      vw = 0.97;
      vh = (vw * PW) / (a * PH);
    }
    L.view = [VIEW_X - vw, 0.5 - vh / 2, vw, vh];
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.rw, L.rh);
    filmT = target(gl, L.rw, L.rh);
    film.resize(L.rw, L.rh);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const toPlate = (x, y) => [
    (L.view[0] + ((x - L.x) / L.w) * L.view[2]) * PW,
    (L.view[1] + ((y - L.y) / L.h) * L.view[3]) * PH,
  ];
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  const grabbable = (px, py) => modal.complianceAt(px, py) > 0.06;

  // --- the hand ---
  let held = null; // { x0, y0, dx0, dy0 }
  const rubber = (dx, dy, lmax) => {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return [0, 0];
    const s = (lmax * (1 - Math.exp(-l / lmax))) / l;
    return [dx * s, dy * s];
  };
  const pull = (held, px, py) => {
    const [ox, oy] = rubber(px - held.px0, py - held.py0, held.lmax);
    modal.setTarget(held.dx0 + ox, held.dy0 + oy);
  };

  stage.on("down", (p) => {
    if (posed || !inPrint(p)) return;
    const [px, py] = toPlate(p.x, p.y);
    if (!grabbable(px, py)) return;
    const h = modal.grab(px, py);
    // stiffer spots travel less: the limit scales with the spot's compliance
    held = { px0: px, py0: py, dx0: h.tx, dy0: h.ty, lmax: Math.min(LMAX, h.reach) };
    host.dataset.grab = "held";
    dirty = true;
  });
  stage.on("move", (p) => {
    const [px, py] = toPlate(p.x, p.y);
    if (held) {
      pull(held, px, py);
      dirty = true;
    } else if (!posed) {
      host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
    }
  });
  stage.on("up", (p) => {
    if (!held) return;
    held = null;
    modal.release();
    const [px, py] = toPlate(p.x, p.y);
    host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
  });

  // --- a posed still: pull, hold until it settles, let go, run t seconds ---
  let posedDone = false;
  const runPose = () => {
    posedDone = true;
    const [ux, uy, amp, deg = 180] = pokeQ;
    const [px, py] = [(L.view[0] + ux * L.view[2]) * PW, (L.view[1] + uy * L.view[3]) * PH];
    const h = modal.grab(px, py);
    const tx0 = h.tx;
    const ty0 = h.ty;
    const len = amp * L.view[2] * PW;
    const r = (deg * Math.PI) / 180;
    const lmax = Math.min(LMAX, h.reach);
    const [ox, oy] = rubber(Math.cos(r) * len, -Math.sin(r) * len, lmax);
    const steps = 240;
    for (let i = 0; i < steps; i++) {
      // ease the pull in over the first second, as a hand would
      const e = Math.min(1, (i / 60) * 1.0);
      const k = 1 - Math.pow(1 - e, 3);
      modal.setTarget(tx0 + ox * k, ty0 + oy * k);
      modal.step(1 / 60);
    }
    if (tQ != null && tQ >= 0) {
      modal.release();
      const n = Math.round(tQ * 120);
      for (let i = 0; i < n; i++) modal.step(1 / 120);
    }
  };

  // --- draw ---
  const uQ = new Float32Array(K * 2);
  const uV = new Float32Array(K * 2);
  let grainSeed = 0;
  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(scene.p);
    const u = scene.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tree);
    gl.uniform1i(u.uTree, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.sky);
    gl.uniform1i(u.uSky, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.modes);
    gl.uniform1i(u.uModes, 2);
    for (let i = 0; i < K; i++) {
      uQ[i * 2] = modal.q[i * 2] * modal.scale[i];
      uQ[i * 2 + 1] = modal.q[i * 2 + 1] * modal.scale[i];
    }
    for (let i = 0; i < K; i++) {
      uV[i * 2] = modal.v[i * 2] * modal.scale[i] * SHUTTER;
      uV[i * 2 + 1] = modal.v[i * 2 + 1] * modal.scale[i] * SHUTTER;
    }
    gl.uniform2fv(u.uQ, uQ);
    gl.uniform2fv(u.uV, uV);
    gl.uniform4f(u.uView, ...L.view);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        halation: 0.3,
        halationThreshold: 0.85,
        bloom: 0.22,
        softness: 0.5,
        contrast: 1.14,
        whitePoint: 1.25,
        toe: 0.06,
        blueDepth: 0.6,
        saturation: 0.97,
        warmth: 0.08,
        vignette: 0.22,
        grain: 0.3,
        grainSeed,
      },
      filmT.fbo,
    );

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
  };

  let wall = 0;
  let t0 = -1;
  let grainClock = 0;
  let slow = 0;
  let lastNow = 0;
  const rand = mulberry(7);
  const breezeOn = !still && !reduce;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    if (posed && !posedDone) runPose();
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      // drop the render scale on a slow machine
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    wall += dt;
    if (t0 < 0) t0 = wall;
    const age = still ? 99 : wall - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let moving = false;
    if (!posed) {
      modal.step(dt, { breezeAmp: breezeOn ? BREEZE : 0, rand });
      if (!breezeOn && held == null && modal.restless() < 0.02) {
        if (modal.restless() > 0) {
          modal.reset();
          dirty = true;
        }
      } else moving = true;
    }
    if (!reduce && !still && moving) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    if (!dirty && !moving && age > REVEAL + 0.2) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
