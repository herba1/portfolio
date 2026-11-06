import { createStage, clamp } from "../_kit/stage";

// herb's Times Square photo as a spatial scene. bake.py split it offline into
// four layers at the depth discontinuities (far street, taxis and billboards,
// pedicab, herb), each with its own depth and with its colour and depth
// continued behind the layers in front of it. Here every layer is a grid mesh
// displaced by its own depth, so a small camera move parallaxes each vertex by
// inverse depth (which is exactly what the depth map is) and the nearer
// layers slide over street that was really hidden, not stretched.

const BASE = "/lab/spatial-scene/";
const GROUND = [0.949, 0.941, 0.922]; // #f2f0eb
const PHOTO_ASPECT = 3 / 4; // w / h
const FOCUS = 0.5; // the depth that stays put
const AMP = 0.068; // parallax at |cam| = 1, in print widths per unit of depth
const ZOOM = 1 / (1 - 2 * AMP * 0.55); // overscan so no layer edge ever shows
const GRID_X = 120;
const GRID_Y = 160;

const LAYER_VS = `#version 300 es
layout(location=0) in vec2 aUv;
uniform sampler2D uDepth; uniform vec4 uChan;
uniform vec2 uCam;        // camera offset, print widths per unit depth (y already scaled to heights)
uniform vec4 uRect;       // print rect in clip space: x0, y0, x1, y1
out vec2 vUv; out float vD;
void main(){
  float d = dot(texture(uDepth, aUv), uChan);
  vec2 p = (aUv - 0.5) * ${ZOOM.toFixed(5)} + 0.5;
  // Inverse depth is parallax: shift is proportional to it, relative to the focus plane.
  p -= uCam * (d - ${FOCUS.toFixed(3)});
  vec2 c = mix(uRect.xy, uRect.zw, vec2(p.x, 1.0 - p.y));
  gl_Position = vec4(c, 0.0, 1.0);
  vUv = aUv; vD = d;
}`;

const LAYER_FS = `#version 300 es
precision highp float;
in vec2 vUv; in float vD;
uniform sampler2D uCol; uniform sampler2D uSoft; uniform float uDof; uniform float uOpaque;
out vec4 o;
void main(){
  vec4 c = texture(uCol, vUv);           // premultiplied on upload
  // A hint of depth of field: only the far city, and only a little.
  float blur = uDof * smoothstep(0.24, 0.02, vD);
  c.rgb = mix(c.rgb, texture(uSoft, vUv).rgb, blur * 0.85);
  if (uOpaque > 0.5) c.a = 1.0;
  // Film-like: blacks lifted a hair toward warm violet, highlights eased.
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  rgb = mix(vec3(0.035, 0.028, 0.04), vec3(1.0), rgb);
  rgb = rgb / (1.0 + 0.08 * rgb) * 1.08;
  o = vec4(rgb * c.a, c.a);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(mix(uRect.xy, uRect.zw, aPos), 0.0, 1.0); }`;

// The city's lights bloom very slightly, riding with the far-middle depth.
const BLOOM_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uBloom; uniform vec2 uCam; uniform float uGain;
out vec4 o;
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  uv = (uv + uCam * (0.3 - ${FOCUS.toFixed(3)}) - 0.5) / ${ZOOM.toFixed(5)} + 0.5;
  vec3 b = texture(uBloom, uv).rgb;
  o = vec4(b * b * uGain + b * uGain * 0.4, 0.0);
}`;

// A print lying on the ground: a soft, faint contact shadow, nothing more.
const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform vec2 uSize; uniform vec2 uPrint; uniform vec2 uOff;
out vec4 o;
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main(){
  vec2 p = (vUv - 0.5) * uSize;
  float near = sdBox(p - vec2(0.0, 1.0), uPrint * 0.5);
  float far = sdBox(p - uOff, uPrint * 0.5);
  float a = 0.10 * exp(-max(near, 0.0) / 1.6) + 0.07 * exp(-max(far, 0.0) / (uSize.y * 0.035));
  o = vec4(0.0, 0.0, 0.0, a);
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
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${src}`));
    im.src = src;
  });

export async function createSpatial(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, alpha: false });
  const gl = stage.ctx;
  const names = ["far.webp", "far-soft.webp", "mid.webp", "near.webp", "herb.webp", "depth.png", "depth-herb.png", "bloom.webp"];
  let images;
  try {
    images = await Promise.all(names.map((n) => loadImage(BASE + n)));
  } catch (e) {
    stage.destroy();
    throw e;
  }
  const [farIm, softIm, midIm, nearIm, herbIm, depthIm, depthHerbIm, bloomIm] = images;

  const texture = (im, { premultiply = false, mips = false } = {}) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tex = {
    far: texture(farIm, { mips: true }),
    soft: texture(softIm),
    mid: texture(midIm, { premultiply: true, mips: true }),
    near: texture(nearIm, { premultiply: true, mips: true }),
    herb: texture(herbIm, { premultiply: true, mips: true }),
    depth: texture(depthIm),
    depthHerb: texture(depthHerbIm),
    bloom: texture(bloomIm),
  };

  const layerProg = compile(gl, LAYER_VS, LAYER_FS);
  const bloomProg = compile(gl, QUAD_VS, BLOOM_FS);
  const shadowProg = compile(gl, QUAD_VS, SHADOW_FS);

  // One grid shared by every layer; each displaces it by its own depth.
  const verts = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 2);
  for (let y = 0, i = 0; y <= GRID_Y; y++) for (let x = 0; x <= GRID_X; x++) {
    verts[i++] = x / GRID_X;
    verts[i++] = y / GRID_Y;
  }
  const idx = new Uint16Array(GRID_X * GRID_Y * 6);
  for (let y = 0, i = 0; y < GRID_Y; y++) for (let x = 0; x < GRID_X; x++) {
    const a = y * (GRID_X + 1) + x;
    const b = a + GRID_X + 1;
    idx.set([a, b, a + 1, a + 1, b, b + 1], i);
    i += 6;
  }
  const gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const layers = [
    { col: tex.far, depth: tex.depth, chan: [1, 0, 0, 0], opaque: 1, dof: 1 },
    { col: tex.mid, depth: tex.depth, chan: [0, 1, 0, 0], opaque: 0, dof: 0 },
    { col: tex.near, depth: tex.depth, chan: [0, 0, 1, 0], opaque: 0, dof: 0 },
    { col: tex.herb, depth: tex.depthHerb, chan: [1, 0, 0, 0], opaque: 0, dof: 0 },
  ];

  // --- camera: spring-follow the pointer, settle when it leaves, drift when idle
  const params = new URLSearchParams(location.search);
  const held = params.has("x") || params.has("y");
  const cam = { x: held ? clamp(+params.get("x") || 0, -1, 1) : 0, y: held ? clamp(+params.get("y") || 0, -1, 1) : 0, vx: 0, vy: 0 };
  const target = { x: cam.x, y: cam.y };
  let tilt = null; // device orientation target, where it needs no permission
  let tiltBase = null;
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = { b: e.beta, g: e.gamma };
    tilt = { x: clamp((e.gamma - tiltBase.g) / 18, -1, 1), y: clamp((e.beta - tiltBase.b) / 18, -1, 1) };
  };
  const orientable = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function";
  if (orientable && matchMedia("(pointer: coarse)").matches) window.addEventListener("deviceorientation", onOrient);

  let print = { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1 };
  const layout = (w, h) => {
    const ph = Math.min(h * 0.84, (w - 32) / PHOTO_ASPECT);
    const pw = ph * PHOTO_ASPECT;
    const x = Math.round((w - pw) / 2);
    const y = Math.round((h - ph) / 2);
    print = { x, y, w: Math.round(pw), h: Math.round(ph) };
  };
  let dirty = true;
  stage.onResize((w, h) => {
    layout(w, h);
    dirty = true;
  });

  let drift = held ? 0 : 1;
  let time = 0;
  const drawn = { x: NaN, y: NaN };

  const render = () => {
    const { width: W, height: H, dpr } = stage;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const clipX = (px) => (px / W) * 2 - 1;
    const clipY = (py) => 1 - (py / H) * 2;
    const rect = [clipX(print.x), clipY(print.y + print.h), clipX(print.x + print.w), clipY(print.y)];

    // shadow under the print
    const pad = Math.round(print.h * 0.12);
    gl.useProgram(shadowProg.p);
    gl.uniform4f(shadowProg.u.uRect, clipX(print.x - pad), clipY(print.y + print.h + pad), clipX(print.x + print.w + pad), clipY(print.y - pad));
    gl.uniform2f(shadowProg.u.uSize, print.w + pad * 2, print.h + pad * 2);
    gl.uniform2f(shadowProg.u.uPrint, print.w, print.h);
    gl.uniform2f(shadowProg.u.uOff, 0, -print.h * 0.018);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // the scene, clipped to the print
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(print.x * dpr), Math.round((H - print.y - print.h) * dpr), Math.round(print.w * dpr), Math.round(print.h * dpr));
    const cx = cam.x * AMP;
    const cy = cam.y * AMP * 0.7 * PHOTO_ASPECT; // in print heights
    gl.useProgram(layerProg.p);
    gl.uniform4f(layerProg.u.uRect, ...rect);
    gl.uniform2f(layerProg.u.uCam, cx, cy);
    gl.uniform1i(layerProg.u.uDepth, 0);
    gl.uniform1i(layerProg.u.uCol, 1);
    gl.uniform1i(layerProg.u.uSoft, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex.soft);
    gl.bindVertexArray(gridVao);
    for (const L of layers) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, L.depth);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, L.col);
      gl.uniform4f(layerProg.u.uChan, ...L.chan);
      gl.uniform1f(layerProg.u.uOpaque, L.opaque);
      gl.uniform1f(layerProg.u.uDof, L.dof);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(bloomProg.p);
    gl.uniform4f(bloomProg.u.uRect, ...rect);
    gl.uniform2f(bloomProg.u.uCam, cx, cy);
    gl.uniform1f(bloomProg.u.uGain, 0.2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.bloom);
    gl.uniform1i(bloomProg.u.uBloom, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };

  stage.onFrame((dt) => {
    if (!held) {
      time += dt;
      const p = stage.pointer;
      const idle = stage.idleFor();
      let tx = 0;
      let ty = 0;
      if (tilt) {
        tx = tilt.x;
        ty = tilt.y;
      } else if (p.inside) {
        tx = clamp(((p.x / stage.width) * 2 - 1) * 1.15, -1, 1);
        ty = clamp(((p.y / stage.height) * 2 - 1) * 1.15, -1, 1);
      }
      // Idle drift: on load, and again after a while untouched. It fades in
      // and out rather than taking over.
      const wantDrift = !tilt && !p.inside && idle > 3500 ? 1 : 0;
      drift += (wantDrift - drift) * (1 - Math.exp(-dt * (wantDrift ? 0.6 : 4)));
      tx += Math.sin(time * 0.42) * 0.85 * drift;
      ty += Math.sin(time * 0.29 + 0.8) * 0.4 * drift;
      const m = Math.hypot(tx, ty);
      if (m > 1) {
        tx /= m;
        ty /= m;
      }
      target.x = tx;
      target.y = ty;
      // Gentle, nearly critically damped spring.
      const k = 26;
      const c = 2 * Math.sqrt(k) * 0.92;
      const steps = Math.ceil(dt / (1 / 120));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        cam.vx += (k * (target.x - cam.x) - c * cam.vx) * h;
        cam.vy += (k * (target.y - cam.y) - c * cam.vy) * h;
        cam.x += cam.vx * h;
        cam.y += cam.vy * h;
      }
    }
    if (dirty || Math.abs(cam.x - drawn.x) > 2e-4 || Math.abs(cam.y - drawn.y) > 2e-4) {
      render();
      drawn.x = cam.x;
      drawn.y = cam.y;
      dirty = false;
    }
  });

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      stage.destroy();
    },
  };
}
