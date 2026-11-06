import { createStage, clamp } from "../_kit/stage";

// A photograph as a point cloud. Every cell of the depth grid becomes one
// point, unprojected along its own camera ray to the depth Depth Anything
// gave it, and coloured from the photo. Seen from the camera that took it,
// the cloud reprojects to exactly the photograph: each point lands on its own
// cell, square and opaque. Loosening it does three things at once: the points
// turn into soft round dots of light, they drift apart along their rays and in
// a slow divergence-free current, and the camera turns a few degrees, which is
// what shows the depth. The loose cloud is not drawn as dots on screen: it is
// splatted as wide Gaussians (wider the further a point sits from the focal
// depth, so the points carry their own depth of field) into a half-res
// half-float buffer, light and coverage kept apart so dark points vanish
// instead of drawing as specks, then resolved with a normalized-convolution
// pyramid and laid over the sharp photograph, which fades point by point.
// Two springs carry the loosening, a quick one for near
// points and a slow one for far ones, so the picture re-forms front to back.

const SCENES = {
  city: { src: "/lab/house-of-cards/city.webp", depth: "/lab/house-of-cards/city-depth.png", bg: [0, 0, 0], fit: "contain" },
};

const VS = `#version 300 es
layout(location=0) in float aCell;
layout(location=1) in float aDepth;
uniform sampler2D uColor;
uniform vec2 uGrid;        // depth grid size in cells
uniform vec2 uRect;        // drawn image size, device px
uniform vec2 uCanvas;      // canvas size, device px
uniform vec2 uOffset;      // image centre offset from canvas centre, device px
uniform float uFocal;      // device px
uniform float uLod;
uniform vec2 uLoose;       // near spring, far spring
uniform vec2 uOrbit;       // yaw, pitch
uniform float uTime;
uniform float uPivot;
uniform float uFocus;      // depth (0 far .. 1 near) that stays sharp
uniform float uScale;      // target px per device px (0.5 for the soft layer)
uniform int uPass;         // 0 sharp photo, 1 soft light
out vec3 vColor;
out float vW;
out float vLum;

// Integer hash: a float sin-hash loses precision past a few thousand cells
// and paints diagonal moire across half a million points.
float hash(uint x){
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}

// Each component ignores its own axis, so the field has no divergence: points
// flow around each other instead of bunching up.
vec3 flow(vec3 p, float t){
  return vec3(
    sin(p.y * 1.7 + t) + 0.5 * sin(p.z * 2.3 - t * 0.7),
    sin(p.z * 1.9 + t * 0.8) + 0.5 * sin(p.x * 2.1 + t * 0.6),
    sin(p.x * 1.5 - t * 0.9) + 0.5 * sin(p.y * 2.7 + t * 0.5));
}

void main(){
  float gx = mod(aCell, uGrid.x);
  float gy = floor(aCell / uGrid.x);
  vec2 uv = (vec2(gx, gy) + 0.5) / uGrid;
  vec3 srgb = textureLod(uColor, uv, uLod).rgb;

  float d = aDepth;                       // relative inverse depth, 1 = near
  float far = 1.0 - d;
  float z = 1.0 / (0.16 + 0.84 * d);       // 1 near .. ~6 far
  vec2 scr = (uv - 0.5) * uRect * vec2(1.0, -1.0) + uOffset * vec2(1.0, -1.0);
  vec3 p = vec3(scr / uFocal * z, z);

  // Far points let go first and come back last.
  float s = mix(uLoose.x, uLoose.y, smoothstep(0.0, 1.0, far));
  // How far this point has handed over from the photo to the soft light.
  float L = smoothstep(0.0, 0.16, s);
  float w = uPass == 0 ? 1.0 - L : L;
  if (w < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }

  uint id = uint(aCell);
  float r1 = hash(id), r2 = hash(id ^ 0x9e3779b9u), r3 = hash(id + 0x632be5abu);
  // Apart along the ray: depth is stretched and every point gets its own
  // share of scatter, so layers that sat flush pull away from each other.
  float spread = 1.0 + s * (0.22 * (r1 - 0.5) + 0.18 * far);
  p *= spread;
  // A slow current, scaled with distance so it reads the same on screen.
  vec3 q = p * 0.9 + vec3(r2, r3, r1) * 0.12;
  p += flow(q, uTime + r2 * 0.3) * (0.016 * z) * s * s;
  p += (vec3(r1, r2, r3) - 0.5) * 0.007 * z * s;

  // Orbit about a pivot in the middle distance.
  p.z -= uPivot;
  float cy = cos(uOrbit.x), sy = sin(uOrbit.x);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  float cp = cos(uOrbit.y), sp = sin(uOrbit.y);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  p.z += uPivot;

  vec2 o = p.xy / p.z * uFocal;
  gl_Position = vec4(o / (uCanvas * 0.5), 0.0, 1.0);

  float cell = uRect.y / uGrid.y * uScale;
  float persp = z / p.z;
  if (uPass == 0) {
    // At rest a point is exactly its cell, a hair over to close the seams.
    gl_PointSize = clamp((cell + 0.6) * persp, 1.0, 40.0);
    vColor = srgb;
  } else {
    // Depth of field on the points themselves: the further a point sits from
    // the focal depth and the further it has drifted, the wider its disc.
    float dof = abs(d - uFocus);
    float grow = s * (1.4 + 1.8 * r3 + 16.0 * dof * dof + 6.0 * dof);
    gl_PointSize = clamp(cell * (3.0 + grow) * persp, 1.0, 64.0);
    vColor = pow(srgb, vec3(2.2));   // light adds in linear
    // Dark street and dark clothes give way: only the city's light stays.
    float m = max(srgb.r, max(srgb.g, srgb.b));
    vLum = smoothstep(0.08, 0.42, m);
    w = pow(w, 2.2);                 // so the crossfade is even after encoding
  }
  vW = w;
}`;

const FS_SHARP = `#version 300 es
precision highp float;
in vec3 vColor; in float vW;
out vec4 o;
void main(){
  // Square, opaque at rest: the photograph, pixel for pixel. Premultiplied.
  o = vec4(vColor * vW, vW);
}`;

const FS_SOFT = `#version 300 es
precision highp float;
in vec3 vColor; in float vW; in float vLum;
layout(location=0) out vec4 o;
layout(location=1) out vec4 oCov;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 4.0);
  // Target 0 holds light only: dark points add nothing to it, so they never
  // draw as dark specks. Target 1 holds every point's coverage, which says
  // where the cloud is, light or not.
  o = vec4(vColor * (g * vW * vLum), g * vLum);
  oCov = vec4(g * vW, 0.0, 0.0, 0.0);
}`;

const VS_QUAD = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS_MASK = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCov;
out vec4 o;
// What fraction of the screen the cloud covers, as 0..1, so its mips say
// "mostly inside" or "mostly outside" regardless of how densely points pile.
void main(){ o = vec4(smoothstep(0.05, 0.6, texture(uCov, vUv).r), 0.0, 0.0, 1.0); }`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAcc;
uniform sampler2D uCov;
uniform sampler2D uMask;
uniform vec2 uTexel;
out vec4 o;
// A 3x3 tent over one mip level; bilinear taps make it wide and smooth so
// the coarse levels never show their blocks.
vec4 blurLod(sampler2D tx, float lod){
  vec2 k = uTexel * exp2(lod) * 1.2;
  vec4 s = textureLod(tx, vUv, lod) * 4.0;
  s += (textureLod(tx, vUv + vec2(k.x, 0.0), lod) + textureLod(tx, vUv - vec2(k.x, 0.0), lod)
      + textureLod(tx, vUv + vec2(0.0, k.y), lod) + textureLod(tx, vUv - vec2(0.0, k.y), lod)) * 2.0;
  s += textureLod(tx, vUv + k, lod) + textureLod(tx, vUv - k, lod)
     + textureLod(tx, vUv + vec2(k.x, -k.y), lod) + textureLod(tx, vUv + vec2(-k.x, k.y), lod);
  return s / 16.0;
}
vec4 soft(float lod){ return blurLod(uAcc, lod); }
void main(){
  // A small tent over the half-res buffer; bilinear taps make it 4x4.
  vec4 a = texture(uAcc, vUv) * 0.36;
  a += texture(uAcc, vUv + uTexel * vec2( 0.9,  0.9)) * 0.16;
  a += texture(uAcc, vUv + uTexel * vec2(-0.9,  0.9)) * 0.16;
  a += texture(uAcc, vUv + uTexel * vec2( 0.9, -0.9)) * 0.16;
  a += texture(uAcc, vUv + uTexel * vec2(-0.9, -0.9)) * 0.16;
  // Where the dark points were (the street, the figure, the sky between
  // buildings) the light around them closes in from coarser levels of the
  // same buffer, a normalized-convolution pyramid, like a defocused lens
  // spreading the signs into the shadow. Big dark areas far from any light
  // stay dark: the fill fades with how much light the neighbourhood holds.
  vec4 m3 = soft(3.0);
  vec4 m5 = soft(5.0);
  // Half a step coarser again, so no single point reads on its own.
  a = mix(a, soft(1.0), 0.55);
  vec4 t = a;
  float h = max(0.0, 1.0 - t.a) * smoothstep(0.0, 0.25, m3.a);
  t += vec4(m3.rgb / max(m3.a, 1e-4), 1.0) * h;
  h = max(0.0, 1.0 - t.a) * smoothstep(0.0, 0.2, m5.a);
  t += vec4(m5.rgb / max(m5.a, 1e-4), 1.0) * h;
  // Where splats pile up, their weighted average: a smooth field.
  vec3 c = t.rgb / max(t.a, 1.0);
  // Only inside the cloud's footprint, which falls off softly at its edge.
  // Narrow gaps the cloud opens behind near objects are inside too, so they
  // fill with light; the outer edge fades over a few pixels.
  float inside = max(smoothstep(0.25, 0.75, blurLod(uMask, 1.5).r), smoothstep(0.45, 0.75, blurLod(uMask, 4.5).r));
  c *= inside;
  // Keep the neon's chroma: averaging neighbours pulls toward grey.
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(y), c, 1.25), 0.0);
  // A breath of glow from the raw sum, rolled off so it never clips.
  vec3 glow = 1.0 - exp(-a.rgb * 0.06);
  c += glow * 0.3;
  // And a wide, faint bloom off the signs, inside the cloud only.
  vec3 bloom = 1.0 - exp(-soft(4.0).rgb * 0.05);
  c += bloom * 0.35 * inside;
  o = vec4(pow(c, vec3(1.0 / 2.2)), 0.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

async function loadBitmap(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

export async function createCloud(host) {
  const params = new URLSearchParams(window.location.search);
  const scene = SCENES[params.get("scene")] || SCENES.city;
  const hold = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const [img, dep] = await Promise.all([loadBitmap(scene.src), loadBitmap(scene.depth)]);

  // Depth comes packed as 16 bits in red (high) and green (low).
  const gw = dep.width;
  const gh = dep.height;
  const cv = document.createElement("canvas");
  cv.width = gw;
  cv.height = gh;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(dep, 0, 0);
  const px = cx.getImageData(0, 0, gw, gh).data;
  const n = gw * gh;
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) depth[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;

  // Far to near, once: drawing in this order lets the opaque rest state
  // occlude correctly and keeps the soft state free of depth-test fringes.
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const keys = new Uint16Array(n);
  for (let i = 0; i < n; i++) keys[i] = Math.round(depth[i] * 65535);
  order.sort((a, b) => keys[a] - keys[b]);
  const cells = new Float32Array(n);
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cells[i] = order[i];
    ds[i] = depth[order[i]];
  }

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false, alpha: false });
  const gl = stage.ctx;
  const link = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const progSharp = link(VS, FS_SHARP);
  const progSoft = link(VS, FS_SOFT);
  const progComp = link(VS_QUAD, FS_COMPOSITE);
  const progMask = link(VS_QUAD, FS_MASK);
  const NAMES = ["uColor", "uGrid", "uRect", "uCanvas", "uOffset", "uFocal", "uLod", "uLoose", "uOrbit", "uTime", "uPivot", "uFocus", "uScale", "uPass"];
  const uniforms = (p) => Object.fromEntries(NAMES.map((k) => [k, gl.getUniformLocation(p, k)]));
  const USharp = uniforms(progSharp);
  const USoft = uniforms(progSoft);
  const UComp = { uAcc: gl.getUniformLocation(progComp, "uAcc"), uMask: gl.getUniformLocation(progComp, "uMask"), uTexel: gl.getUniformLocation(progComp, "uTexel") };

  // The soft layer accumulates at half resolution in a half-float target, so
  // hundreds of overlapping splats sum without banding and the per-pixel
  // speckle of a point cloud never reaches the screen.
  const floatOk = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
  const acc = { tex: gl.createTexture(), cov: gl.createTexture(), mask: gl.createTexture(), fbo: gl.createFramebuffer(), mfbo: gl.createFramebuffer(), w: 0, h: 0 };
  const UMask = gl.getUniformLocation(progMask, "uCov");
  const sizeAcc = (w, h) => {
    if (w === acc.w && h === acc.h) return;
    acc.w = w;
    acc.h = h;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, acc.tex);
    if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, acc.cov);
    if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, acc.cov, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindTexture(gl.TEXTURE_2D, acc.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.mfbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc.mask, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b0 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b0);
  gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
  const b1 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b1);
  gl.bufferData(gl.ARRAY_BUFFER, ds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const [br, bg, bb] = scene.bg;
  host.style.background = `rgb(${br * 255},${bg * 255},${bb * 255})`;

  // Motion state: two loosening springs and an orbit spring.
  const st = {
    near: { x: 0, v: 0 },
    far: { x: 0, v: 0 },
    yaw: { x: 0, v: 0 },
    pitch: { x: 0, v: 0 },
    target: 0,
    tYaw: 0,
    tPitch: 0,
    time: 0,
  };
  if (hold != null) {
    st.near.x = hold * 0.82;
    st.far.x = hold;
    st.yaw.x = 0.1 * hold;
    st.pitch.x = -0.035 * hold;
    st.time = 2.4;
  }

  let dirty = true;
  let grab = null;
  stage.on("down", (p) => {
    grab = { x: p.x, y: p.y, yaw: st.tYaw, pitch: st.tPitch };
    st.target = 0.22;
    dirty = true;
  });
  stage.on("move", (p) => {
    if (!grab) return;
    const dx = p.x - grab.x;
    const dy = p.y - grab.y;
    const s = Math.min(stage.width, stage.height);
    // Soft limits: the camera turns a few degrees at most.
    const soft = (v, m) => m * Math.tanh(v / m);
    st.tYaw = soft((dx / s) * 0.5, 0.14);
    st.tPitch = soft((-dy / s) * 0.3, 0.06);
    st.target = clamp(0.22 + Math.hypot(dx, dy) / (s * 0.45), 0, 1);
    dirty = true;
  });
  stage.on("up", () => {
    grab = null;
    st.target = 0;
    st.tYaw = 0;
    st.tPitch = 0;
    dirty = true;
  });

  const spring = (sp, target, k, dt) => {
    // Critically damped: no overshoot, so the photo re-forms without wobble.
    const c = 2 * Math.sqrt(k);
    sp.v += (k * (target - sp.x) - c * sp.v) * dt;
    sp.x += sp.v * dt;
    return Math.abs(target - sp.x) > 1e-4 || Math.abs(sp.v) > 1e-4;
  };

  let W = 1;
  let H = 1;
  let dpr = 1;
  stage.onResize((w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    dirty = true;
  });

  const setCloud = (U, pass, scale, rw, rh, cw, ch) => {
    gl.uniform1i(U.uColor, 0);
    gl.uniform2f(U.uGrid, gw, gh);
    gl.uniform2f(U.uRect, rw, rh);
    gl.uniform2f(U.uCanvas, cw, ch);
    gl.uniform2f(U.uOffset, 0, 0);
    gl.uniform1f(U.uFocal, Math.max(rw, rh) * 1.1);
    gl.uniform1f(U.uLod, Math.max(0, Math.log2(img.width / gw)));
    gl.uniform2f(U.uLoose, st.near.x, st.far.x);
    gl.uniform2f(U.uOrbit, st.yaw.x, st.pitch.x);
    gl.uniform1f(U.uTime, st.time);
    gl.uniform1f(U.uPivot, 2.2);
    gl.uniform1f(U.uFocus, 0.6);
    gl.uniform1f(U.uScale, scale);
    gl.uniform1i(U.uPass, pass);
  };

  const draw = () => {
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    const ia = img.width / img.height;
    let rw;
    let rh;
    if (cw / ch > ia) {
      rh = ch;
      rw = rh * ia;
    } else {
      rw = cw;
      rh = rw / ia;
    }
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.enable(gl.BLEND);
    const open = Math.max(st.near.x, st.far.x) > 1e-4;

    // Soft light, half resolution, summed.
    if (open) {
      const hw = Math.ceil(cw / 2);
      const hh = Math.ceil(ch / 2);
      sizeAcc(hw, hh);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
      gl.viewport(0, 0, hw, hh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progSoft);
      setCloud(USoft, 1, hw / cw, rw, rh, cw, ch);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, n);
      // Coverage to a 0..1 mask with mips.
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.mfbo);
      gl.disable(gl.BLEND);
      gl.useProgram(progMask);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, acc.cov);
      gl.uniform1i(UMask, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, acc.mask);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // The sharp photograph, fading out point by point as each one lets go.
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progSharp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    setCloud(USharp, 0, 1, rw, rh, cw, ch);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);

    if (open) {
      gl.useProgram(progComp);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, acc.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(UComp.uAcc, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, acc.mask);
      gl.uniform1i(UComp.uMask, 2);
      gl.uniform2f(UComp.uTexel, 1 / acc.w, 1 / acc.h);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  };

  stage.onFrame((dt) => {
    let moving = false;
    if (hold == null) {
      // Near points answer quickly, far ones slowly: a focus pull on release.
      moving = spring(st.near, st.target * 0.82, grab ? 30 : 34, dt) || moving;
      moving = spring(st.far, st.target, grab ? 20 : 7, dt) || moving;
      moving = spring(st.yaw, st.tYaw, 40, dt) || moving;
      moving = spring(st.pitch, st.tPitch, 40, dt) || moving;
      const open = Math.max(st.near.x, st.far.x);
      if (open > 1e-3) {
        st.time += dt * 0.55;
        moving = true;
      }
      if (!moving && st.far.x !== 0) {
        st.near.x = st.far.x = st.yaw.x = st.pitch.x = 0;
        dirty = true;
      }
    }
    if (moving || dirty) {
      dirty = false;
      draw();
    }
  });

  return {
    destroy() {
      stage.destroy();
      img.close?.();
      dep.close?.();
    },
  };
}
