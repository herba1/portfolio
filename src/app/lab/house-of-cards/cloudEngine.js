import { createStage, clamp } from "../_kit/stage";

// A photograph as a point cloud, then as a lidar scan. Every cell of the depth
// grid becomes one point, unprojected along its own camera ray to the depth
// Depth Anything gave it, and coloured from the photo. Seen from the camera
// that took it, the cloud reprojects to exactly the photograph: each point
// lands on its own cell, square and opaque.
//
// Loosening it never blurs anything. Each point hands over from its opaque
// square to a crisp additive dot of its own colour on black, one device pixel
// at first, so the photo turns into a countable grid of light. Then the grid
// thins to what a spinning Velodyne would have returned: points on horizontal
// scan rings of constant elevation seen from a sensor a little above the lens,
// every other step of azimuth. Because the sensor sits above the camera, a
// ring lands lower on near things than on far ones, so the lines jog at every
// depth edge (the figure, the taxis, the truck) even before the camera moves.
// Then the camera swings round half a radian about the middle distance: near
// and far layers shear apart, black shadows open behind everything the photo
// could not see past, and the street reads as a volume. The sky gives no
// return and stays black. Two springs carry the loosening, a quick one for
// near points and a slow one for far ones, so the picture re-forms front to
// back.

const SCENES = {
  city: { src: "/lab/house-of-cards/city.webp", depth: "/lab/house-of-cards/city-depth.png", bg: [0, 0, 0], fit: "contain" },
};

// Scan geometry.
const RINGS = 150; // scan rings across the frame
const SENSOR = 0.03; // sensor height above the lens, world units (z = 1 is the nearest point)
// Orbit: the most the camera turns, radians, about a pivot in world units.
const YAW = 0.55;
const PITCH = 0.16;
const PIVOT = 2.1;

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
uniform float uRing;       // scan ring spacing, device px
uniform float uSensor;     // sensor height above the lens
uniform int uPass;         // 0 opaque photo, 1 lidar dots
out vec4 vColor;

float hash(uint x){
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}

// Each component ignores its own axis, so the field has no divergence: the
// scan lines bend together instead of fraying.
vec3 flow(vec3 p, float t){
  return vec3(
    sin(p.y * 1.7 + t) + 0.5 * sin(p.z * 2.3 - t * 0.7),
    sin(p.z * 1.9 + t * 0.8) + 0.5 * sin(p.x * 2.1 + t * 0.6),
    sin(p.x * 1.5 - t * 0.9) + 0.5 * sin(p.y * 2.7 + t * 0.5));
}

void cull(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }

void main(){
  float gx = mod(aCell, uGrid.x);
  float gy = floor(aCell / uGrid.x);
  vec2 uv = (vec2(gx, gy) + 0.5) / uGrid;
  vec3 srgb = textureLod(uColor, uv, uLod).rgb;

  float d = aDepth;                       // relative inverse depth, 1 = near
  float far = 1.0 - d;
  float z = 1.0 / (0.35 + 0.65 * d);       // 1 near .. ~2.9 far
  vec2 scr = (uv - 0.5) * uRect * vec2(1.0, -1.0) + uOffset * vec2(1.0, -1.0);
  vec3 p = vec3(scr / uFocal * z, z);

  // Far points let go first and come back last.
  float s = mix(uLoose.x, uLoose.y, smoothstep(0.0, 1.0, far));
  // How far this point has handed over from the photo to a dot of light.
  float L = smoothstep(0.0, 0.12, s);
  float w = uPass == 0 ? 1.0 - L : L;
  if (w < 0.002) { cull(); return; }

  float cell = uRect.y / uGrid.y;
  float size = cell + 0.6;
  if (uPass == 1) {
    // The sky is out of range: no return.
    if (d < 0.015) { cull(); return; }
    // Which scan ring this point sits on: elevation from the sensor, in ring
    // steps. A point is a return if its cell holds the ring's centre line.
    vec3 q = p - vec3(0.0, uSensor, 0.0);
    float u = q.y / length(q.xz) * uFocal / uRing;
    float k = floor(u + 0.5);
    bool onRing = abs(u - k) * uRing < cell * 0.5;
    // Along the ring, every other azimuth step, staggered ring to ring; a
    // lit surface returns on every step, so the signs read as solid strips.
    float m = max(max(srgb.r, srgb.g), srgb.b);
    bool onStep = mod(gx + k, 2.0) < 0.5 || m > 0.55;
    bool ret = onRing && onStep;
    // Everything else goes out early: the dense grid is a stage on the way.
    float keep = ret ? 1.0 : 1.0 - smoothstep(0.08, 0.42, s);
    w *= keep;
    if (w < 0.004) { cull(); return; }
    // Returns are a whole device pixel wider than the grid's dots.
    size = ret ? 2.0 : 1.0;
    // Light on black. The signs run hot and keep their hue (scaled back under 1 instead of
    // clipping to white, and a touch more saturated); walls and asphalt stay
    // dim grey lines, so the city's light carries the picture.
    float y = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = max(mix(vec3(y), srgb, 1.3), 0.0) * 1.8;
    // Near surfaces return stronger, as a real scanner's do, so a dark coat
    // close by still reads as lines while the far dark street sinks.
    c = c / max(1.0, max(max(c.r, c.g), c.b)) + vec3(0.88, 1.0, 1.1) * (0.03 + 0.2 * d * d * d);
    vColor = vec4(c * w, 0.0);
  } else {
    vColor = vec4(srgb * w, w);
  }

  // Apart along the ray, the far street more than the near figure, so the
  // layers that sat flush separate in depth as the camera turns.
  p *= 1.0 + s * 0.12 * far;
  // A slow current; it is smooth, so whole scan lines bend together.
  uint id = uint(aCell);
  float r2 = hash(id ^ 0x9e3779b9u);
  p += flow(p * 0.9, uTime + r2 * 0.05) * (0.005 * z) * s * s;

  // Orbit about a pivot in the middle distance.
  p.z -= uPivot;
  float cy = cos(uOrbit.x), sy = sin(uOrbit.x);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  float cp = cos(uOrbit.y), sp = sin(uOrbit.y);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  p.z += uPivot;
  if (p.z < 0.1) { cull(); return; }

  vec2 o = p.xy / p.z * uFocal;
  gl_Position = vec4(o / (uCanvas * 0.5), 0.0, 1.0);
  // At rest a point is exactly its cell, a hair over to close the seams; a
  // dot stays its fixed device size however close it comes.
  gl_PointSize = uPass == 0 ? clamp(size * z / p.z, 1.0, 40.0) : size;
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 o;
// Pass 0 is premultiplied over; pass 1 adds light. Either way a square of
// one flat colour: nothing is filtered, so every dot stays a hard pixel.
void main(){ o = vColor; }`;

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
  // occlude correctly without a depth buffer.
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
  const NAMES = ["uColor", "uGrid", "uRect", "uCanvas", "uOffset", "uFocal", "uLod", "uLoose", "uOrbit", "uTime", "uPivot", "uRing", "uSensor", "uPass"];
  const U = Object.fromEntries(NAMES.map((k) => [k, gl.getUniformLocation(prog, k)]));

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
    st.yaw.x = -YAW * 0.75 * hold;
    st.pitch.x = -PITCH * 0.25 * hold;
    st.time = 2.4;
  }

  let dirty = true;
  let grab = null;
  stage.on("down", (p) => {
    grab = { x: p.x, y: p.y };
    st.target = 0.22;
    dirty = true;
  });
  stage.on("move", (p) => {
    if (!grab) return;
    const dx = p.x - grab.x;
    const dy = p.y - grab.y;
    const s = Math.min(stage.width, stage.height);
    // Soft limits: far enough round that the depth shows, never so far the
    // street turns edge-on.
    const soft = (v, m) => m * Math.tanh(v / m);
    // Dragging right carries the near layer right, as if the street were
    // held by the figure in front and turned about the middle distance.
    st.tYaw = soft((-dx / s) * 1.6, YAW);
    st.tPitch = soft((-dy / s) * 0.8, PITCH);
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

  stage.onResize(() => {
    dirty = true;
  });

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
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.useProgram(prog);
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
    gl.uniform1f(U.uPivot, PIVOT);
    gl.uniform1f(U.uRing, rh / RINGS);
    gl.uniform1f(U.uSensor, SENSOR);
    gl.enable(gl.BLEND);

    // The photograph, opaque, fading out point by point as each one lets go.
    gl.uniform1i(U.uPass, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);

    // The same points as light on black, added.
    if (Math.max(st.near.x, st.far.x) > 1e-4) {
      gl.uniform1i(U.uPass, 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, n);
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
