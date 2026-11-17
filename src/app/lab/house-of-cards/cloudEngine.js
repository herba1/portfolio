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
// thins to what a spinning Velodyne would have returned: points on scan rings
// of constant elevation seen from a sensor a little above the lens, so on the
// street they are arcs round the sensor's feet. Because the sensor sits above
// the camera, a ring lands lower on near things than on far ones, so the
// lines jog at every depth edge (the figure, the taxis, the truck) even
// before the camera moves. Each return carries energy, not colour: its
// reflectance over r^2, summed in a float buffer and tone-mapped, so the near
// bodies, scanned densely in 2x2 dots, pile up and clip to solid white, and
// the far street, scanned sparsely and losing its weak returns, is a scatter
// of faint single pixels.
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
// Return energy: the floor a black surface still reflects, and the energy a
// white wall standing at the nearest point sends back, before 1/r^2. A dark
// coat up close comes back at FLOOR x GAIN, about three times what it takes
// to clip to white; the far street, skimmed and three times as far, comes
// back at a few percent of that.
const FLOOR = 0.35;
const GAIN = 14;
// The resolve curve's exposure: display = 1 - exp(-EXPOSURE x energy).
const EXPOSURE = 1;
// Local detail: what the photo's structure does to a return. Luminance less
// an 8 px Gaussian of itself, plus Sobel edge strength, mapped so a flat
// interior comes back at DETAIL[0] and a hard edge or a letter at DETAIL[1].
const DETAIL = [0.5, 1.7];
const DETAIL_SIGMA = 8; // photo px
// Contrast is read against the local mean plus this, so a hood's edge in a
// dark coat counts as much as a letter on a lit panel.
const DETAIL_KNEE = 0.08;

const VS = `#version 300 es
layout(location=0) in float aCell;
layout(location=1) in float aDepth;
layout(location=2) in float aUpright; // 1 standing square to the sensor, 0 the street
layout(location=3) in float aDetail;  // local detail gain from the photo, DETAIL[0]..DETAIL[1]
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
uniform float uFloor;      // reflectance floor: what a black surface still returns
uniform float uGain;       // return intensity at the nearest point
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
    // Range from the sensor.
    vec3 q = p - vec3(0.0, uSensor, 0.0);
    float r = length(q);
    // Range falloff, 1 at the nearest point. It also sets how densely a
    // surface is sampled: the rings bunch up close to the sensor, so the
    // strong returns are the dense ones and the weak ones are sparse, never
    // a uniform hatch. It leaves out the photo's brightness, so a surface
    // keeps one ring spacing across its whole face and the lines stay whole.
    float near = 1.0 / (r * r);
    float dense = smoothstep(0.15, 0.6, near);
    // Which scan ring this point sits on: elevation from the sensor, in ring
    // steps. A point is a return if its cell holds the ring's centre line.
    // Near surfaces come back on up to three times the rings, so the street
    // at the sensor's feet is written in close-packed arcs that open out with
    // range. Anything near and standing (the figure, the taxis, the
    // pedicab) fills its beam on every azimuth step too, so it comes back as
    // a solid mass of returns.
    bool body = near > 0.25 && aUpright > 0.5;
    float ring = uRing * mix(1.0, 0.34, dense);
    float u = q.y / length(q.xz) * uFocal / ring;
    float k = floor(u + 0.5);
    bool onRing = abs(u - k) * ring < cell * 0.5;
    // Along the ring, every other azimuth step, staggered ring to ring. Lit
    // signs return on every step too, so they read as solid strips.
    float m = max(max(srgb.r, srgb.g), srgb.b);
    bool onStep = mod(gx + k, 2.0) < 0.5 || m > 0.55 || body;
    // Return energy. A lidar measures how much of its own laser comes back:
    // a black coat, a tyre or wet asphalt still returns, so reflectance has a
    // floor and the photo's luminance only lifts it. Incidence takes it down
    // (the street the beam skims returns 40% of what a body
    // standing square to it does), the photo's local structure scales it (an
    // edge, a letter or a seam scatters more than the flat panel round it),
    // and range takes it down as 1/r^2. The sum is light, not colour: it
    // goes into a float buffer and is tone-mapped at the end, so near returns
    // overlap and clip to white while the far street fades to faint single
    // dots.
    float y = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
    float refl = max(uFloor, pow(y, 0.6));
    float I = uGain * refl * mix(0.4, 1.0, aUpright) * mix(1.0, aDetail, 0.6) * near;
    // A return too weak to clear the receiver's threshold is lost. The odds
    // are fixed per point, so the far street thins to a stable scatter.
    float lost = hash(uint(aCell) * 2654435761u);
    bool ret = onRing && onStep && lost < smoothstep(0.15, 2.0, I);
    // Everything else goes out early: the dense grid is a stage on the way.
    float keep = ret ? 1.0 : 1.0 - smoothstep(0.06, 0.3, s);
    w *= keep;
    if (w < 0.004) { cull(); return; }
    // Near and standing returns are 2x2 device px, so they close up into a
    // solid mass; an edge or a letter in the middle distance gets the same
    // weight; everything else is a single device pixel.
    size = ret && (body || aDetail > 1.1 && dense > 0.2) ? 2.0 : 1.0;
    // Near-white, a touch cool. Only the signs keep their hue, and only as a
    // tint: bright and saturated in the photo, so lit panels, not paint. The
    // tint's brightest channel is 1, so a strong return still clips to white
    // through the curve while a weak one keeps its colour.
    float chroma = m - min(min(srgb.r, srgb.g), srgb.b);
    float lit = smoothstep(0.5, 0.85, m) * smoothstep(0.3, 0.65, chroma / max(m, 1e-3));
    vec3 hue = srgb / max(m, 1e-3);
    vec3 tint = mix(vec3(0.9, 0.96, 1.0), hue, 0.75 * lit);
    vec3 c = tint * I;
    // While the photo is still handing over, a dot starts as its own pixel
    // and turns into a return as it loosens. The pixel goes in through the
    // inverse of the resolve curve, so a lone dot comes out its own colour.
    vec3 px = srgb / max(m, 1e-3) * -log(1.0 - min(m, 0.996));
    c = mix(px, c, smoothstep(0.04, 0.3, s));
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

// The lidar's light, summed in a float buffer, resolved through an
// exponential film curve (display = 1 - exp(-energy)) and added over the
// photo. One return reads as its
// own strength; where returns pile up (a near body, two layers sheared over
// each other) the sum runs past 1 and every channel saturates, so it clips
// to a white mass instead of wrapping or banding.
const RESOLVE_VS = `#version 300 es
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uLight;
uniform float uExposure;
out vec4 o;
void main(){
  vec3 e = uExposure * texelFetch(uLight, ivec2(gl_FragCoord.xy), 0).rgb;
  // The curve runs on the brightest channel, so a sign's tint keeps its hue
  // up to the shoulder; past it each channel runs on its own, so a pile of
  // returns bleaches to pure white whatever its tint.
  float mx = max(max(e.r, e.g), e.b);
  vec3 keep = e / max(mx, 1e-5) * (1.0 - exp(-mx));
  vec3 bleach = 1.0 - exp(-e);
  o = vec4(mix(keep, bleach, smoothstep(1.5, 6.0, mx)), 0.0);
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

// One pass of a box blur along rows (step 1) or columns (step w), radius r,
// edges held. Three of them make a Gaussian.
function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const span = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    const at = (i) => src[base + (i < 0 ? 0 : i >= len ? len - 1 : i) * step];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = sum / span;
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

function percentile(a, p) {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 1e-6;
}

// The photo's local structure per grid cell, as a gain on the return: high
// pass (luminance less an ~8 px Gaussian of itself) plus Sobel edge strength,
// both measured on the full photo relative to the local mean, averaged into
// each cell, normalised against the frame's own 95th percentile and mapped to
// DETAIL.
function detailMap(img, gw, gh) {
  const w = img.width;
  const h = img.height;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, w, h).data;
  const m = w * h;
  const y = new Float32Array(m);
  for (let i = 0; i < m; i++) y[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;

  // Three box passes each way approximate the Gaussian.
  const r = Math.max(1, Math.round(Math.sqrt((4 * DETAIL_SIGMA * DETAIL_SIGMA) + 1) / 2));
  let a = Float32Array.from(y);
  let b = new Float32Array(m);
  for (let k = 0; k < 3; k++) {
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }

  const hp = new Float32Array(gw * gh);
  const sob = new Float32Array(gw * gh);
  const cnt = new Float32Array(gw * gh);
  const Y = (x, yy) => y[(yy < 0 ? 0 : yy >= h ? h - 1 : yy) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let yy = 0; yy < h; yy++) {
    const cy = Math.min(gh - 1, Math.floor((yy * gh) / h)) * gw;
    for (let x = 0; x < w; x++) {
      const gx = Y(x + 1, yy - 1) + 2 * Y(x + 1, yy) + Y(x + 1, yy + 1) - Y(x - 1, yy - 1) - 2 * Y(x - 1, yy) - Y(x - 1, yy + 1);
      const gy = Y(x - 1, yy + 1) + 2 * Y(x, yy + 1) + Y(x + 1, yy + 1) - Y(x - 1, yy - 1) - 2 * Y(x, yy - 1) - Y(x + 1, yy - 1);
      const c = cy + Math.min(gw - 1, Math.floor((x * gw) / w));
      const mean = a[yy * w + x] + DETAIL_KNEE;
      hp[c] += (y[yy * w + x] - a[yy * w + x]) / mean;
      sob[c] += Math.hypot(gx, gy) / mean;
      cnt[c] += 1;
    }
  }
  const n = gw * gh;
  const ah = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hp[i] /= cnt[i] || 1;
    sob[i] /= cnt[i] || 1;
    ah[i] = Math.abs(hp[i]);
  }
  const pe = percentile(sob, 0.95);
  const ph = percentile(ah, 0.95);
  const score = new Float32Array(n);
  for (let i = 0; i < n; i++) score[i] = 0.55 * Math.min(sob[i] / pe, 1.5) + 0.45 * clamp(hp[i] / ph, -1, 1.2);
  // Widen each edge by a cell up and down, so the sparse scan rings land on
  // a horizontal edge instead of stepping over a one-cell line.
  const out = new Float32Array(n);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let s = -Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = gy + dy < 0 ? 0 : gy + dy >= gh ? gh - 1 : gy + dy;
        const v = score[yy * gw + gx];
        if (v > s) s = v;
      }
      const t = clamp((s + 0.1) / 1.2, 0, 1);
      out[gy * gw + gx] = DETAIL[0] + (DETAIL[1] - DETAIL[0]) * t * t * (3 - 2 * t);
    }
  }
  return out;
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
  // How upright each surface stands. A lidar's beam comes back strongest off
  // what stands square to it (a person, a truck, a wall) and weakest off the
  // street it skims. Depth Anything's street gets nearer steadily down the
  // frame; anything standing up holds its depth from top to bottom. So the
  // vertical slope of depth, over a stencil wide enough to read the slope of a
  // surface and not the steps between its slabs, says which is which.
  const upright = new Float32Array(n);
  {
    const K = Math.max(1, Math.round(gh / 130));
    const lo = (0.012 * K) / 6;
    const hi = (0.022 * K) / 6;
    for (let y = 0; y < gh; y++) {
      const up = Math.max(0, y - K) * gw;
      const dn = Math.min(gh - 1, y + K) * gw;
      const me = y * gw;
      for (let x = 0; x < gw; x++) {
        // The gentler side, so the top of a head against the far street
        // still counts as standing.
        const slope = 2 * Math.min(depth[dn + x] - depth[me + x], depth[me + x] - depth[up + x]);
        const t = clamp((slope - lo) / (hi - lo), 0, 1);
        upright[y * gw + x] = 1 - t * t * (3 - 2 * t);
      }
    }
  }

  const detail = detailMap(img, gw, gh);

  const cells = new Float32Array(n);
  const ds = new Float32Array(n);
  const us = new Float32Array(n);
  const es = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cells[i] = order[i];
    ds[i] = depth[order[i]];
    us[i] = upright[order[i]];
    es[i] = detail[order[i]];
  }

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false, alpha: false });
  const gl = stage.ctx;
  const link = (vs, fs) => {
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  };
  const prog = link(VS, FS);
  const resolve = link(RESOLVE_VS, RESOLVE_FS);
  const uLight = gl.getUniformLocation(resolve, "uLight");
  const uExposure = gl.getUniformLocation(resolve, "uExposure");
  const empty = gl.createVertexArray();

  // The light buffer: half float where the GPU can render to it, so summed
  // returns run past 1 before the curve; 8 bit otherwise, which clips early
  // but keeps the same picture.
  const floatLight = !!gl.getExtension("EXT_color_buffer_float");
  const light = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
  const sizeLight = (w, h) => {
    if (light.w === w && light.h === h) return;
    light.w = w;
    light.h = h;
    gl.bindTexture(gl.TEXTURE_2D, light.tex);
    if (floatLight) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, light.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const NAMES = ["uColor", "uGrid", "uRect", "uCanvas", "uOffset", "uFocal", "uLod", "uLoose", "uOrbit", "uTime", "uPivot", "uRing", "uSensor", "uPass", "uFloor", "uGain"];
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
  const b2 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b2);
  gl.bufferData(gl.ARRAY_BUFFER, us, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  const b3 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b3);
  gl.bufferData(gl.ARRAY_BUFFER, es, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);

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
    gl.uniform1f(U.uFloor, FLOOR);
    gl.uniform1f(U.uGain, GAIN);
    gl.enable(gl.BLEND);

    // The photograph, opaque, fading out point by point as each one lets go.
    gl.uniform1i(U.uPass, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);

    // The same points as light on black: summed as energy in the light
    // buffer, then resolved through the curve and added over the photo.
    if (Math.max(st.near.x, st.far.x) > 1e-4) {
      sizeLight(cw, ch);
      gl.bindFramebuffer(gl.FRAMEBUFFER, light.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1i(U.uPass, 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.useProgram(resolve);
      gl.bindVertexArray(empty);
      gl.bindTexture(gl.TEXTURE_2D, light.tex);
      gl.uniform1i(uLight, 0);
      gl.uniform1f(uExposure, EXPOSURE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
      gl.deleteFramebuffer(light.fbo);
      gl.deleteTexture(light.tex);
      img.close?.();
      dep.close?.();
    },
  };
}
