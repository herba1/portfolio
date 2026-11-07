import { createStage, clamp } from "../_kit/stage";

// Miniature: Piazza del Popolo seen from the Pincio terrace on a clear
// morning, with its depth map, as a print on the warm ground. Looking down
// from forty metres at people the size of rice grains is what lets a wrong
// depth of field read as a model. The pointer is the plane of focus. Depth is relative
// inverse depth (white = near), and the circle of confusion of a thin lens is
// proportional to the gap in inverse depth, so |d - focus| is the physically
// right blur measure. The plane is reverse-tilted a little, so blur grows
// faster up and down the frame than any lens at this scale would allow: the
// tilt-shift miniature.
//
//   pass 1  gather at half CSS resolution: golden-spiral scatter-as-gather,
//           occlusion-aware (a farther sample may not spread over a nearer,
//           sharper centre).
//   pass 2  full resolution: a small disc for near-focus pixels, the gathered
//           buffer through a depth-aware joint upsample for the rest, a gentle
//           contrast lift and a print shoulder that stops short of white.

const COLOR_SRC = "/lab/miniature/city.webp";
const DEPTH_SRC = "/lab/miniature/depth.png";
const ASPECT = 3 / 2; // print width / height
const GROUND = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const K_COC = 0.26; // circle of confusion, in print heights per unit of inverse depth
const DOF = 0.06; // inverse depth either side of the plane that still reads as sharp
const MAX_COC = 0.03; // cap, in print heights
const TILT = 0.16; // reverse tilt of the focal plane, inverse depth per print height
const BUF_SCALE = 0.5; // gather buffer pixels per CSS pixel
const TAPS = 88;

// The depth map is baked so the piazza's middle distance sits at 0.76
// (tools/depth/bakes/miniature/bake.py): the obelisk and the crowd round it.
const HERO = { f: 0.76, y: 0.6 };

const FAR = { f: 0.634, y: 0.3 }; // St Peter's dome on the horizon

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Row 0 of every texture is the top of the photograph.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uFocus;
uniform float uFocusY;
uniform float uTilt;
uniform float uK;     // coc per unit inverse depth, in output units
uniform float uMax;   // coc cap, in output units
uniform float uDof;
float cocAt(vec2 uv, out float d) {
  d = texture(uDepth, uv).r;
  float plane = uFocus - uTilt * (uv.y - uFocusY);
  return min(max(abs(d - plane) - uDof, 0.0) * uK, uMax);
}
// Print white: everything above the knee rolls off towards 0.95 and never
// reaches it, so a bright roof or a windscreen keeps its texture as it opens
// into a disc instead of turning to flat paper.
vec3 shoulder(vec3 x) {
  const float k = 0.85;
  const float top = 0.95;
  vec3 over = max(x - k, 0.0);
  return min(x, vec3(k)) + (top - k) * (1.0 - exp(-over / (top - k)));
}
`;

const GATHER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON}
uniform vec2 uBuf;     // gather buffer size in pixels
uniform float uLod;
void main() {
  float d0;
  float s0 = cocAt(vUv, d0);
  vec3 c0 = textureLod(uColor, vUv, uLod).rgb;
  vec3 acc = c0;
  float cacc = s0;
  float tot = 1.0;
  vec2 px = 1.0 / uBuf;
  // Interleaved-gradient rotation per pixel: the spiral's structure turns to
  // fine grain instead of a visible pattern inside the discs.
  float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < ${TAPS}; i++) {
    float fi = float(i);
    float r = uMax * sqrt((fi + 0.5) / ${TAPS}.0);
    float a = fi * 2.39996323 + spin;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * px;
    float d;
    float s = cocAt(uv, d);
    // A sample behind the centre cannot spread over it further than the
    // centre's own blur: sharp foreground stays clean over a soft distance.
    if (d < d0 - 0.004) s = min(s, s0 * 1.6);
    float m = smoothstep(r - 1.1, r + 0.6, s);
    vec3 c = textureLod(uColor, uv, uLod).rgb;
    acc += mix(acc / tot, c, m);
    cacc += mix(cacc / tot, s, m);
    tot += 1.0;
  }
  outColor = vec4(acc / tot, cacc / tot / uMax);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON}
uniform sampler2D uBlur;
uniform vec2 uBuf;
uniform vec2 uOut;      // print size in device pixels
uniform float uDpr;
uniform float uMaxCss;  // coc cap in css px (uMax / uK are in css px here)
uniform vec2 uView;     // viewport origin in device px
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uGround;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(uGround, 1.0);
    return;
  }
  float d0;
  float s0 = cocAt(uv, d0); // css px

  // Near focus: a small full-resolution disc, depth-weighted so an edge
  // between two distances does not smear.
  vec3 small = texture(uColor, uv).rgb;
  float ws = 1.0;
  float rs = min(s0, 4.0) * uDpr;
  if (rs > 0.35) {
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float r = rs * sqrt((fi + 0.5) / 12.0);
      float a = fi * 2.39996323 + 0.7;
      vec2 o = vec2(cos(a), sin(a)) * r / uOut;
      float d = texture(uDepth, uv + o).r;
      float w = exp(-abs(d - d0) * 40.0);
      small += texture(uColor, uv + o).rgb * w;
      ws += w;
    }
  }
  small /= ws;

  // Far from focus: depth-aware joint upsample of the gather buffer, over a
  // 4x4 texel footprint with a soft gaussian so the spiral's grain settles.
  vec2 p = uv * uBuf - 0.5;
  vec2 i0 = floor(p) - 1.0;
  vec4 big = vec4(0.0);
  float wb = 0.0;
  float sharpness = 24.0 / (1.0 + s0 * 0.25);
  for (int j = 0; j < 16; j++) {
    vec2 t = i0 + vec2(float(j & 3), float(j >> 2));
    vec2 dv = t - p;
    t = clamp(t, vec2(0.0), uBuf - 1.0);
    vec2 tuv = (t + 0.5) / uBuf;
    float g = exp(-dot(dv, dv) * 0.7);
    float d = textureLod(uDepth, tuv, 1.0).r;
    float w = g * (exp(-abs(d - d0) * sharpness) + 0.002);
    big += texture(uBlur, tuv) * w;
    wb += w;
  }
  big /= wb;
  float spill = big.a * uMaxCss;
  float t = smoothstep(2.2, 5.0, max(s0, spill));
  vec3 col = mix(small, big.rgb, t);

  // The tilt-shift print: a touch more snap in the mids, no extra colour;
  // the shoulder comes last so nothing on the print reaches white.
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
  col = shoulder(col);
  col += (hash(frag) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
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

function texture(gl, img, format, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (format === "r") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// Depth as a CPU array too, so the pointer can ask "how far is this?"
function depthField(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const w = c.width;
  const h = c.height;
  return (u, v) => {
    // Median of a small neighbourhood: a pointer resting on an edge picks a
    // side instead of focusing on the halfway distance between them.
    const cx = Math.round(clamp(u, 0, 1) * (w - 1));
    const cy = Math.round(clamp(v, 0, 1) * (h - 1));
    const vals = [];
    for (let y = -3; y <= 3; y++) {
      for (let x = -3; x <= 3; x++) {
        const px = clamp(cx + x * 2, 0, w - 1);
        const py = clamp(cy + y * 2, 0, h - 1);
        vals.push(data[(py * w + px) * 4]);
      }
    }
    vals.sort((a, b) => a - b);
    return vals[vals.length >> 1] / 255;
  };
}

// A focus ring: a critically damped spring with a little extra mass, so a
// rack has weight and lands without overshoot.
function ring(x) {
  return { x, v: 0, target: x };
}
function stepRing(s, dt, k = 46) {
  const c = 2 * Math.sqrt(k) * 1.04;
  const a = k * (s.target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return Math.abs(s.target - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}

export async function createMiniature(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [colorImg, depthImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(DEPTH_SRC)]);
  const depthAt = depthField(depthImg);

  const colorTex = texture(gl, colorImg, "rgba", true);
  const depthTex = texture(gl, depthImg, "r", true);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const gather = compile(gl, VERT, GATHER);
  const composite = compile(gl, VERT, COMPOSITE);

  // Half-float keeps the soft gradients of a deep defocus free of banding;
  // RGBA8 is the fallback.
  const float = !!gl.getExtension("EXT_color_buffer_float");
  const blurTex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let buf = [1, 1];
  let rect = { x: 0, y: 0, w: 1, h: 1 };

  const params = new URLSearchParams(window.location.search);
  const qf = params.get("f");
  const qy = params.get("y");
  const held = qf != null && Number.isFinite(+qf);
  const start = held ? { f: clamp(+qf, 0, 1), y: qy != null ? clamp(+qy, 0, 1) : HERO.y } : FAR;
  const focus = ring(start.f);
  const focusY = ring(start.y);
  let locked = held;
  let dirty = true;
  let touched = held;

  const layout = (w, h) => {
    // The print: as large as the box allows with a generous margin.
    const m = Math.max(24, Math.min(w, h) * 0.08);
    let ph = h - 2 * m;
    let pw = ph * ASPECT;
    if (pw > w - 2 * m) {
      pw = w - 2 * m;
      ph = pw / ASPECT;
    }
    rect = { x: Math.round((w - pw) / 2), y: Math.round((h - ph) / 2), w: Math.round(pw), h: Math.round(ph) };
    buf = [Math.max(8, Math.round(rect.w * BUF_SCALE)), Math.max(8, Math.round(rect.h * BUF_SCALE))];
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, buf[0], buf[1], 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, buf[0], buf[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    dirty = true;
  };
  stage.onResize(layout);

  const aim = (p) => {
    const u = (p.x - rect.x) / rect.w;
    const v = clamp((p.y - rect.y) / rect.h, 0, 1);
    // Off the print, the pointer still racks by height alone.
    focus.target = depthAt(clamp(u, 0.02, 0.98), v);
    focusY.target = v;
  };

  stage.on("move", (p) => {
    touched = true;
    if (!locked) aim(p);
  });
  stage.on("down", (p) => {
    touched = true;
    if (locked) {
      locked = false;
      aim(p);
    } else {
      aim(p);
      locked = true;
    }
  });

  // On arrival the lens is on the dome; then it racks down into the piazza,
  // and the square turns into a model of itself.
  const intro = held
    ? 0
    : window.setTimeout(() => {
        if (touched) return;
        focus.target = HERO.f;
        focusY.target = HERO.y;
      }, 1100);

  const draw = () => {
    const dpr = stage.dpr;
    const ph = rect.h; // css px
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);

    // pass 1: gather (units: buffer pixels)
    gl.useProgram(gather.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, buf[0], buf[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    const gu = gather.u;
    gl.uniform1i(gu.uColor, 0);
    gl.uniform1i(gu.uDepth, 1);
    gl.uniform1f(gu.uFocus, focus.x);
    gl.uniform1f(gu.uFocusY, focusY.x);
    gl.uniform1f(gu.uTilt, TILT);
    gl.uniform1f(gu.uDof, DOF);
    gl.uniform1f(gu.uK, K_COC * ph * BUF_SCALE);
    gl.uniform1f(gu.uMax, MAX_COC * ph * BUF_SCALE);
    gl.uniform2f(gu.uBuf, buf[0], buf[1]);
    gl.uniform1f(gu.uLod, Math.max(0, Math.log2(colorImg.naturalHeight / buf[1])));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: composite (units: css pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(composite.p);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    const cu = composite.u;
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uDepth, 1);
    gl.uniform1i(cu.uBlur, 2);
    gl.uniform1f(cu.uFocus, focus.x);
    gl.uniform1f(cu.uFocusY, focusY.x);
    gl.uniform1f(cu.uTilt, TILT);
    gl.uniform1f(cu.uDof, DOF);
    gl.uniform1f(cu.uK, K_COC * ph);
    gl.uniform1f(cu.uMax, MAX_COC * ph);
    gl.uniform1f(cu.uMaxCss, MAX_COC * ph);
    gl.uniform2f(cu.uBuf, buf[0], buf[1]);
    gl.uniform2f(cu.uOut, rect.w * dpr, rect.h * dpr);
    gl.uniform1f(cu.uDpr, dpr);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(cu.uGround, GROUND[0], GROUND[1], GROUND[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  stage.onFrame((dt) => {
    const moving = stepRing(focus, dt) | stepRing(focusY, dt, 40);
    if (!moving && !dirty) return;
    dirty = false;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(intro);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
