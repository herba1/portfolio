import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Nyudogumo: a cumulonimbus building behind a railway crossing on a summer
// afternoon, as a time-lapse made from one still photograph.
//
// The photograph (Kanata, Unsplash) is taken apart offline
// (tools/depth/bakes/nyudogumo): the signal, gantry and catenary are matted
// out (sky segmentation, a thin-line key and black-silhouette unmixing,
// guided-filter refined), the sky and cloud behind them are inpainted (LaMa),
// the sky is fitted as a smooth quadratic in linear light, and the cloud is
// keyed from the blue by saturation and luminance. From the cloud's own
// shape and shading a convective flow is baked: an updraft under every
// column, strongest under the columns that already stand tallest, constant
// through the upper tower so its crisp outline rises unstretched; an outward
// spread toward the top; every lobe swelling away from its own bright
// centre; and the curl of a stream function made of the cloud's band-passed
// luminance, signed by side, so the flanks roll outward and down like the
// vortex ring of a rising thermal.
//
// Here, every cloud pixel is the photograph's, traced back along that flow
// for the afternoon's elapsed time (RK2) and laid over the fitted sky as its
// excess over the sky where it came from: out = S(p) + P(src) - S(src).
// Drag up and the afternoon advances: the tower boils up and out, its base
// thickens to skylight blue-grey while the sunlit tops stay warm, and the
// light on the crossing goes warmer and longer. Let go and it eases back.
//
// Query: ?t=0..1 holds the hour (0 = the photograph), ?still=1 skips the reveal.

const BASE = "/lab/nyudogumo/";
const PW = 2400;
const PH = 1600;
const STEPS = 20;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The backtrace is smooth (the flow is baked at 600x400), so it runs at a
// quarter of the frame's resolution into a half-float displacement map and
// the full-resolution pass only reads it.
const WARP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFlow;
uniform vec4 uView;
uniform float uT;
vec2 vel(vec2 p) { return texture(uFlow, p).xy; }
void main() {
  vec2 p = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;
  vec2 q = p;
  float dt = uT / float(${STEPS});
  for (int i = 0; i < ${STEPS}; i++) {
    vec2 k1 = vel(q);
    vec2 k2 = vel(q - k1 * dt * 0.5);
    q -= k2 * dt;
  }
  outColor = vec4(q - p, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;  // sky + cloud, silhouettes removed (sRGB)
uniform sampler2D uFg;     // silhouette colour (sRGB)
uniform sampler2D uAlpha;  // silhouette matte
uniform sampler2D uFlow;   // convective flow, uv per unit t (RG16F)
uniform sampler2D uField;  // cloud density, overburden
uniform vec4 uView;        // x0, y0, w, h in image uv (top-left origin)
uniform float uT;          // afternoon time 0..1 (advection length)
uniform float uHour;       // 0..1 for the light (same, but kept separate)
uniform vec3 uSky[6];      // quadratic sky coefficients, linear rgb
uniform float uVmax;
uniform float uExpo;
uniform vec2 uTexel;       // 1 / plate size
uniform sampler2D uWarp;   // backtrace displacement (quarter res)
uniform float uUseWarp;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 sky(vec2 p) {
  float v = min(p.y, uVmax);
  float u = p.x;
  return max(uSky[0] + uSky[1] * u + uSky[2] * v + uSky[3] * u * u + uSky[4] * u * v + uSky[5] * v * v, vec3(1e-4));
}
vec2 vel(vec2 p) { return texture(uFlow, p).xy; }

void main() {
  vec2 p = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;

  // trace back along the flow for time uT (RK2)
  vec2 q = p;
  if (uUseWarp > 0.5) {
    q = p + texture(uWarp, vUv).xy;
  } else {
    float dt = uT / float(${STEPS});
    for (int i = 0; i < ${STEPS}; i++) {
      vec2 k1 = vel(q);
      vec2 k2 = vel(q - k1 * dt * 0.5);
      q -= k2 * dt;
    }
  }
  q = clamp(q, vec2(0.0), vec2(1.0));

  vec3 P = texture(uPlate, q).rgb;
  vec3 Sp = sky(p);
  vec3 Sq = sky(q);
  vec2 f = texture(uField, q).rg;   // density, overburden
  float h = uHour;

  // the sky deepens a little toward evening, hue held
  vec3 S = Sp * mix(1.0, 0.86, h);
  vec3 cloud = P - Sq;              // the cloud's excess over its own sky
  vec3 col = S + cloud;

  float dens = clamp(f.r, 0.0, 1.0);
  // a lower sun rakes: the relief of the cloud's own shading deepens
  // (local luminance against a ~16 px neighbourhood of the same pixels)
  float Lp = dot(P, LUMA);
  float Lm = dot(textureLod(uPlate, q, 4.0).rgb, LUMA);
  float relief = clamp(Lp / max(Lm, 1e-3), 0.4, 1.8);
  col *= mix(1.0, pow(relief, 0.45), h * dens);
  float L = dot(col, LUMA);
  // sunlit tops warm with the lowering sun (relative to their own light)
  float lit = smoothstep(0.2, 0.7, L) * dens * (1.0 - smoothstep(0.55, 1.0, f.g));
  col *= mix(vec3(1.0), vec3(1.08, 0.99, 0.85), h * lit);
  // the base thickens: deep in the column the cloud goes to skylight
  // blue-grey (scattered sky light, not black)
  float thick = dens * smoothstep(0.5, 1.0, f.g + 0.2 * h);
  vec3 skyl = vec3(0.64, 0.71, 0.86) * L * 0.85;
  col = mix(col, skyl, 0.6 * h * thick);
  col = max(col, vec3(0.0));

  // the crossing: its own colour, warmer and lifted along the edges that
  // face the low sun (from the left, behind the camera)
  float a = texture(uAlpha, p).r;
  vec3 F = texture(uFg, p).rgb;
  vec2 e = uTexel * 2.5;
  float gx = texture(uAlpha, p + vec2(e.x, 0.0)).r - texture(uAlpha, p - vec2(e.x, 0.0)).r;
  float gy = texture(uAlpha, p + vec2(0.0, e.y)).r - texture(uAlpha, p - vec2(0.0, e.y)).r;
  // outward normal is -grad(a); the sun is low to the left and a little up
  float rim = clamp(dot(-vec2(gx, gy), normalize(vec2(-1.0, -0.35))), 0.0, 1.0) * a;
  vec3 warm = vec3(1.0, 0.55, 0.26);
  F = F * mix(vec3(1.0), vec3(1.5, 1.12, 0.86), h) + warm * (0.012 + 0.05 * rim) * h;

  col = mix(col, F, a);
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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function setParams(gl, mips) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// Images go up top row first: texture v = image v, no flips anywhere.
function imageTexture(gl, img, { srgb = false, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  setParams(gl, mips);
  return t;
}

// fields.png: left half vx, right half vy, each 16-bit across G (lo) and R
// (hi) around 32768; B carries density (left) and overburden (right).
function fieldTextures(gl, img, vscale) {
  const w = img.width / 2;
  const h = img.height;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, h).data;
  const flow = new Float32Array(w * h * 2);
  const fld = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * img.width + x) * 4;
      const j = (y * img.width + x + w) * 4;
      const k = y * w + x;
      flow[k * 2] = ((d[i] * 256 + d[i + 1] - 32768) / 32767) * vscale;
      flow[k * 2 + 1] = ((d[j] * 256 + d[j + 1] - 32768) / 32767) * vscale;
      fld[k * 4] = d[i + 2];
      fld[k * 4 + 1] = d[j + 2];
      fld[k * 4 + 3] = 255;
    }
  }
  const tf = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tf);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, flow);
  setParams(gl, false);
  const tg = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tg);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, fld);
  setParams(gl, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  return [tf, tg];
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  setParams(gl, false);
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
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createNyudogumo(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const tRaw = q.get("t");
  const tQ = tRaw != null && tRaw !== "" && Number.isFinite(+tRaw) ? clamp(+tRaw, 0, 1) : null;
  const frozen = tQ != null;
  const still = frozen || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [skyFit, ...imgs] = await Promise.all([
    fetch(BASE + "sky.json").then((r) => r.json()),
    ...["plate.webp", "fg.webp", "alpha.png", "fields.png"].map((n) => loadImage(BASE + n)),
  ]);
  const [flowTex, fieldTex] = fieldTextures(gl, imgs[3], skyFit.vscale);
  const tex = {
    plate: imageTexture(gl, imgs[0], { srgb: true }),
    fg: imageTexture(gl, imgs[1], { srgb: true }),
    alpha: imageTexture(gl, imgs[2]),
    flow: flowTex,
    field: fieldTex,
  };
  // sky.json: coef[channel][term], terms 1,u,v,uu,uv,vv
  const skyU = new Float32Array(18);
  for (let k = 0; k < 6; k++) for (let c = 0; c < 3; c++) skyU[k * 3 + c] = skyFit.coef[c][k];

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const warp = program(gl, VERT, WARP);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // Layout, in css px of the box: a 3:2 print on the paper; a 4:5 crop on a
  // narrow screen, kept on the tower.
  const L = { x: 0, y: 0, w: 1, h: 1, view: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let warpT = null;
  let dirty = true;
  let sceneDirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    let aspect = 1.5;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
      aspect = W / H;
    } else if (W / H < 0.9) {
      aspect = 0.8;
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w / aspect;
      if (h > H * 0.74) {
        h = H * 0.74;
        w = h * aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.78 * 1.5);
      const h = w / 1.5;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    const plateAspect = PW / PH;
    let vw = 1;
    let vh = (vw * plateAspect) / aspect;
    if (vh > 1) {
      vh = 1;
      vw = (vh * aspect) / plateAspect;
    }
    const cx = aspect < 1.2 ? 0.53 : 0.5;
    const x0 = clamp(cx - vw / 2, 0, 1 - vw);
    L.view = [x0, (1 - vh) / 2, vw, vh];
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
    freeTarget(gl, warpT);
    warpT = floatOk ? target(gl, Math.max(2, Math.round(L.rw / 4)), Math.max(2, Math.round(L.rh / 4)), true) : null;
    if (warpT && !warpT.ok) {
      freeTarget(gl, warpT);
      warpT = null;
    }
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
    dirty = true;
    sceneDirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // --- input: drag up advances the afternoon, 1:1 with the hand ---
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  let drag = null; // { y0, t0 }
  let t = tQ ?? 0; // afternoon time, 0 = the photograph
  let tv = 0;
  let keyHold = false;
  let touched = false;
  const span = () => Math.max(120, L.h * 0.8);
  // rubber band past the ends, resistance 0.35
  const band = (x) => (x < 0 ? x * 0.35 : x > 1 ? 1 + (x - 1) * 0.35 : x);
  stage.on("down", (p) => {
    if (frozen || !inPrint(p)) return;
    drag = { y0: p.y, t0: t };
    touched = true;
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!drag) {
      stage.canvas.style.cursor = inPrint(p) && !frozen ? "grab" : "";
      return;
    }
    t = band(drag.t0 + (drag.y0 - p.y) / span());
    sceneDirty = true;
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    // carry the hand's speed into the spring that eases it back
    tv = clamp(-p.vy / span(), -4, 4);
    stage.canvas.style.cursor = inPrint(p) ? "grab" : "";
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKeyDown = (e) => {
    if (e.key !== " " && e.key !== "Enter" && e.key !== "ArrowUp") return;
    e.preventDefault();
    keyHold = true;
    touched = true;
  };
  const onKeyUp = (e) => {
    if (e.key !== " " && e.key !== "Enter" && e.key !== "ArrowUp") return;
    keyHold = false;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  const draw = (expoStops, fade, tt, grainSeed) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const hour = clamp(tt, 0, 1.1);
    if (sceneDirty) {
      sceneDirty = false;
      if (warpT) {
        gl.useProgram(warp.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.flow);
        gl.uniform1i(warp.u.uFlow, 0);
        gl.uniform4f(warp.u.uView, ...L.view);
        gl.uniform1f(warp.u.uT, Math.max(0, tt));
        gl.bindFramebuffer(gl.FRAMEBUFFER, warpT.fbo);
        gl.viewport(0, 0, warpT.w, warpT.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const u = scene.u;
      gl.useProgram(scene.p);
      const units = ["plate", "fg", "alpha", "flow", "field"];
      const uni = ["uPlate", "uFg", "uAlpha", "uFlow", "uField"];
      units.forEach((k, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex[k]);
        gl.uniform1i(u[uni[i]], i);
      });
      gl.uniform4f(u.uView, ...L.view);
      gl.uniform1f(u.uT, Math.max(0, tt));
      gl.uniform1f(u.uHour, hour);
      gl.uniform3fv(u.uSky, skyU);
      gl.uniform1f(u.uVmax, skyFit.vmax);
      gl.uniform1f(u.uExpo, 2 ** expoStops);
      gl.uniform2f(u.uTexel, 1 / PW, 1 / PH);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, warpT ? warpT.tex : tex.field);
      gl.uniform1i(u.uWarp, 5);
      gl.uniform1f(u.uUseWarp, warpT ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
      gl.viewport(0, 0, L.rw, L.rh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        halation: 0.3 + 0.12 * hour,
        halationThreshold: 0.8,
        bloom: 0.2,
        softness: 0.55,
        contrast: 1.14,
        whitePoint: 1.25,
        toe: 0.08,
        toeColor: [0.7, 1, 1.25],
        blueDepth: 0.35,
        saturation: 1.06,
        warmth: 0.12 * hour,
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

  // Reveal: the print comes up as an overexposed white-blue and the cobalt
  // deepens over two seconds; then, once, the tower stirs a little and
  // settles, so the sky reads as alive before anyone touches it.
  const REVEAL = 2.0;
  const HINT_AT = 2.0;
  const HINT = 2.8;
  let slow = 0;
  let lastNow = 0;
  let wall = 0;
  let grainClock = 0;
  let grainSeed = 0;
  let lastExpo = -1;
  let lastFade = -1;
  let shown = -1;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!frozen) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    wall += dt;
    const age = still ? 99 : wall;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let tt = t;
    if (!frozen) {
      if (keyHold) {
        // keyboard: the afternoon runs forward while held
        t = Math.min(1, t + dt * 0.45);
        tv = 0;
      } else if (!drag) {
        // ease back to the photograph: a spring, damping 0.9, from the
        // hand's own speed
        const w = 3.0;
        const z = 0.9;
        tv += (w * w * (0 - t) - 2 * z * w * tv) * dt;
        t += tv * dt;
        if (Math.abs(t) < 1e-4 && Math.abs(tv) < 1e-4) {
          t = 0;
          tv = 0;
        }
      }
      tt = t;
      // a single stir after the reveal, until the first touch
      if (!touched && !reduce && !still) {
        const k = clamp((age - HINT_AT) / HINT, 0, 1);
        tt += 0.16 * Math.pow(Math.sin(Math.PI * k), 2) * (k < 1 ? 1 : 0);
      }
      // idle breathing: the tower never quite stops (24 fps, like the grain)
      if (!reduce && !drag) tt += 0.012 * (0.5 - 0.5 * Math.cos((wall * 2 * Math.PI) / 13));
    }

    if (!reduce && !frozen) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    // the hand gets every frame; the idle tower moves on the grain's clock,
  // and only once its breathing has moved it by a visible step
    if (drag || Math.abs(tv) > 1e-3 || keyHold) {
      if (Math.abs(tt - shown) > 1e-5) sceneDirty = true;
    } else if (dirty && Math.abs(tt - shown) > (touched || still ? 6e-4 : 1e-5)) sceneDirty = true;
    if (expo !== lastExpo) sceneDirty = true;
    if (!sceneDirty && !dirty && fade === lastFade) return;
    dirty = false;
    if (sceneDirty) shown = tt;
    lastExpo = expo;
    lastFade = fade;
    draw(expo, fade, sceneDirty ? tt : shown, grainSeed);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      freeTarget(gl, warpT);
      gl.deleteProgram(warp.p);
      Object.values(tex).forEach((x) => gl.deleteTexture(x));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
