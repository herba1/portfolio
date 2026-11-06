import { createStage, clamp } from "../_kit/stage";

// A photograph as a point cloud. Every cell of the depth grid becomes one
// point, unprojected along its own camera ray to the depth Depth Anything
// gave it, and coloured from the photo. Seen from the camera that took it,
// the cloud reprojects to exactly the photograph: each point lands on its own
// cell, square and opaque. Loosening it does three things at once: the points
// turn into soft round dots of light, they drift apart along their rays and in
// a slow divergence-free current, and the camera turns a few degrees, which is
// what shows the depth. Two springs carry the loosening, a quick one for near
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
out vec3 vColor;
out float vS;
out float vA;
out float vGain;

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
  vColor = textureLod(uColor, uv, uLod).rgb;

  float d = aDepth;                       // relative inverse depth, 1 = near
  float far = 1.0 - d;
  float z = 1.0 / (0.16 + 0.84 * d);       // 1 near .. ~6 far
  vec2 scr = (uv - 0.5) * uRect * vec2(1.0, -1.0) + uOffset * vec2(1.0, -1.0);
  vec3 p = vec3(scr / uFocal * z, z);

  // Far points let go first and come back last.
  float s = mix(uLoose.x, uLoose.y, smoothstep(0.0, 1.0, far));
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

  float cell = uRect.y / uGrid.y;
  // At rest a point is exactly its cell, a hair over to close the seams.
  float size = mix(cell + 0.6, cell * (1.7 + 1.6 * r3 * s), s) * (z / p.z);
  gl_PointSize = clamp(size, 1.0, 40.0);
  // A soft dot covers about a third of its square; give the light back so
  // the open cloud keeps the photo's brightness instead of greying out.
  float cover = (cell * cell) / (gl_PointSize * gl_PointSize * 0.25);
  vGain = mix(1.0, cover * 0.72, smoothstep(0.0, 0.25, s));
  vS = s;
  // A trace of haze on the far points while the cloud is open.
  vA = far * s;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vColor; in float vS; in float vA; in float vGain;
uniform vec3 uBg;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float soft = exp(-r2 * 3.2) * step(r2, 1.0);
  float w = mix(1.0, soft, smoothstep(0.0, 0.25, vS));
  if (w < 0.004) discard;
  vec3 col = mix(vColor, uBg, vA * 0.3);
  // Premultiplied: alpha falls faster than colour, so as the cloud opens the
  // points stop covering each other and start adding up, like light.
  float a = w * mix(1.0, 0.55, smoothstep(0.0, 0.6, vS));
  float g = w * vGain;
  o = vec4(col * g, a);
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
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const k of ["uColor", "uGrid", "uRect", "uCanvas", "uOffset", "uFocal", "uLod", "uLoose", "uOrbit", "uTime", "uPivot", "uBg"]) U[k] = gl.getUniformLocation(prog, k);

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

  const draw = () => {
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
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
    gl.uniform3f(U.uBg, br, bg, bb);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
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
