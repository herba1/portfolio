import { createStage, clamp } from "../_kit/stage";

// A worm's-eye photo of a wooden pole under summer cumulus, as a spatial
// scene you can look up through. bake.py split it offline into two layers:
// the sky, inpainted behind the pole and continued past the frame towards the
// zenith, at infinity; and the pole with its wires and insulators, a mesh
// displaced by its own depth.
//
// Both are drawn through one camera. Vertical movement pitches it, horizontal
// movement yaws it, and either way it orbits a point low on the pole, so the
// pole stays anchored while the sky swings past behind it (the sky rotates by
// the full angle, the wires and the pole's top by less, in proportion to their
// distance). Pitching up also swings the lens from rectilinear towards
// stereographic, r = f/s tan(s theta), s from 1 to 1/2: the pole's verticals
// converge harder on the zenith and the edges of the frame open into sky the
// photo never framed.

const BASE = "/lab/spatial-scene/";
const GROUND = [0.949, 0.941, 0.922]; // #f2f0eb
const ZOOM = 1.2; // the print shows the middle 1/ZOOM of the photo at rest
const YAW = 6; // degrees at |x| = 1
const PITCH_UP = 16; // degrees at y = 1
const PITCH_DOWN = 8; // degrees at y = -1
const GRID_X = 120;
const GRID_Y = 160;

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// s = 1 is rectilinear, 1/2 stereographic; looking down stays rectilinear.
const lensFor = (y) => 1 - 0.5 * smooth(-0.5, 1, y);

const LENS = `
uniform float uF; uniform float uS; uniform vec2 uOff; uniform mat3 uM;
const float ASPECT = 0.75;
const float ZOOM = ${ZOOM.toFixed(4)};
vec2 project(vec3 d){
  float l = length(d.xy);
  float th = atan(l, d.z);
  return l > 1e-6 ? d.xy / l * (uF / uS * tan(uS * th)) : vec2(0.0);
}
vec3 unproject(vec2 X){
  float r = length(X);
  float th = atan(r * uS / uF) / uS;
  return r > 1e-6 ? vec3(X / r * sin(th), cos(th)) : vec3(0.0, 0.0, 1.0);
}
// Film-like: blacks lifted a hair, highlights rolled off under paper white.
vec3 grade(vec3 rgb){
  rgb = mix(vec3(0.035, 0.03, 0.04), vec3(1.0), rgb);
  vec3 o = max(rgb - 0.85, 0.0);
  return min(rgb, 0.85 + o / (1.0 + o / 0.13));
}`;

const NEAR_VS = `#version 300 es
layout(location=0) in vec2 aUv;
uniform sampler2D uDepth; uniform vec3 uA; uniform vec4 uRect;
${LENS}
out vec2 vUv;
void main(){
  float d = texture(uDepth, aUv).r;
  // Inverse depth to distance along z, in the units the anchor uses.
  float z = 1.0 / max(d, 0.08);
  vec3 P = vec3((aUv.x - 0.5) * ASPECT, 0.5 - aUv.y, uF) * (z / uF);
  vec3 P1 = transpose(uM) * (P - uA) + uA; // orbit about the anchor
  vec2 X = (project(P1) - uOff) * ZOOM;
  gl_Position = vec4(mix(uRect.xy, uRect.zw, vec2(X.x / ASPECT, X.y) + 0.5), 0.0, 1.0);
  vUv = aUv;
}`;

const NEAR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uCol;
${LENS}
out vec4 o;
void main(){
  vec4 c = texture(uCol, vUv); // premultiplied on upload
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  o = vec4(grade(rgb) * c.a, c.a);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(mix(uRect.xy, uRect.zw, aPos), 0.0, 1.0); }`;

// The sky at infinity: rotation only, looked up per pixel through the lens.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uSky; uniform vec4 uCanvas;
${LENS}
out vec4 o;
void main(){
  vec2 X = vec2((vUv.x - 0.5) * ASPECT, vUv.y - 0.5) / ZOOM + uOff;
  vec3 d = uM * unproject(X);
  vec2 p = uF * d.xy / max(d.z, 0.05);
  vec2 uv = vec2((p.x - uCanvas.x) / (uCanvas.z - uCanvas.x), (uCanvas.w - p.y) / (uCanvas.w - uCanvas.y));
  o = vec4(grade(texture(uSky, uv).rgb), 1.0);
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

// --- camera maths, in the photo's camera frame (x right, y up, z forward)
const rotation = (axis, a) => {
  const [x, y, z] = axis;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // row-major
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
};
const mul = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const columnMajor = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
const projectJS = (d, f, s) => {
  const l = Math.hypot(d[0], d[1]);
  if (l < 1e-9) return [0, 0];
  const r = (f / s) * Math.tan(s * Math.atan2(l, d[2]));
  return [(d[0] / l) * r, (d[1] / l) * r];
};

export async function createSpatial(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, alpha: false });
  const gl = stage.ctx;
  let images;
  let scene;
  try {
    [scene, ...images] = await Promise.all([
      fetch(BASE + "scene.json").then((r) => {
        if (!r.ok) throw new Error("could not load scene.json");
        return r.json();
      }),
      ...["sky.webp", "near.webp", "depth.png"].map((n) => loadImage(BASE + n)),
    ]);
  } catch (e) {
    stage.destroy();
    throw e;
  }
  const [skyIm, nearIm, depthIm] = images;
  const ASPECT = scene.aspect;
  const F = 0.5 / Math.tan(((scene.fovY / 2) * Math.PI) / 180);
  const p0 = (scene.pitch0 * Math.PI) / 180;
  const UP = [0, Math.cos(p0), Math.sin(p0)]; // world up, seen from the photo's camera
  const [au, av, ad] = scene.anchor;
  const az = 1 / Math.max(ad, 0.08);
  const A = [(au - 0.5) * ASPECT * (az / F), (0.5 - av) * (az / F), az];
  const restA = projectJS(A, F, 1);

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
    sky: texture(skyIm, { mips: true }),
    near: texture(nearIm, { premultiply: true, mips: true }),
    depth: texture(depthIm),
  };

  const nearProg = compile(gl, NEAR_VS, NEAR_FS);
  const skyProg = compile(gl, QUAD_VS, SKY_FS);
  const shadowProg = compile(gl, QUAD_VS, SHADOW_FS);

  // The near layer's grid; each vertex is displaced by the layer's depth.
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

  // --- camera: x yaws and y pitches (up is +); spring-follow the pointer,
  // settle when it leaves, drift when idle. ?x=&y= hold a view.
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

  let print = { x: 0, y: 0, w: 1, h: 1 };
  const layout = (w, h) => {
    const ph = Math.min(h * 0.84, (w - 32) / ASPECT);
    const pw = ph * ASPECT;
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

    // the camera: yaw about the pole's (world-vertical) axis, pitch about
    // the horizontal, both through the anchor
    const yaw = (cam.x * YAW * Math.PI) / 180;
    const pitch = ((cam.y > 0 ? cam.y * PITCH_UP : cam.y * PITCH_DOWN) * Math.PI) / 180;
    const M = mul(rotation(UP, yaw), rotation([1, 0, 0], -pitch));
    const s = lensFor(cam.y);
    // The lens change moves the anchor radially; a principal-point shift puts it back.
    const pa = projectJS(A, F, s);
    const off = [pa[0] - restA[0], pa[1] - restA[1]];
    const Mc = columnMajor(M);
    const setLens = (prog) => {
      gl.uniform1f(prog.u.uF, F);
      gl.uniform1f(prog.u.uS, s);
      gl.uniform2f(prog.u.uOff, off[0], off[1]);
      gl.uniformMatrix3fv(prog.u.uM, false, Mc);
      gl.uniform4f(prog.u.uRect, ...rect);
    };

    // the scene, clipped to the print
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(print.x * dpr), Math.round((H - print.y - print.h) * dpr), Math.round(print.w * dpr), Math.round(print.h * dpr));

    gl.disable(gl.BLEND);
    gl.useProgram(skyProg.p);
    setLens(skyProg);
    gl.uniform4f(skyProg.u.uCanvas, ...scene.canvas);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.sky);
    gl.uniform1i(skyProg.u.uSky, 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.useProgram(nearProg.p);
    setLens(nearProg);
    gl.uniform3f(nearProg.u.uA, A[0], A[1], A[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.depth);
    gl.uniform1i(nearProg.u.uDepth, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.near);
    gl.uniform1i(nearProg.u.uCol, 1);
    gl.bindVertexArray(gridVao);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
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
        ty = -tilt.y;
      } else if (p.inside) {
        tx = clamp(((p.x / stage.width) * 2 - 1) * 1.15, -1, 1);
        ty = clamp((1 - (p.y / stage.height) * 2) * 1.15, -1, 1);
      }
      // Idle drift: on load, and again after a while untouched. It leans
      // towards looking up, and fades in and out rather than taking over.
      const wantDrift = !tilt && !p.inside && idle > 3500 ? 1 : 0;
      drift += (wantDrift - drift) * (1 - Math.exp(-dt * (wantDrift ? 0.6 : 4)));
      tx += Math.sin(time * 0.42) * 0.8 * drift;
      ty += (0.25 + Math.sin(time * 0.29 + 0.8) * 0.6) * drift;
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
