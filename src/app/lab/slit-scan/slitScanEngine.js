import { createStage, clamp } from "../_kit/stage";
import { readWebm } from "./webm";

// Slit-Scan: time displacement over ten seconds of real footage. A two-car
// Ohmi Railway train runs past an old wooden station in Koka, Shiga, in low
// evening sun; the camera never moves. Every output pixel shows the clip at its own
// moment, t = clock - D(x, y), where D is a delay field in seconds that you
// sculpt. Anything that did not move is the same at every moment, so the
// station, the fence and the parked cars stay pin sharp whatever D does;
// only what moved is redrawn by the time front. Where D climbs at exactly
// the rate the train travels (1/v seconds per pixel) one column of the train
// is stretched across the whole span: a rigid ribbon. Steeper still and the
// train comes out mirrored; tilt the front and it shears.
//
// The ring. The moving band (448 rows) is decoded once from a 15 fps VP9
// file with WebCodecs (a <video> seek loop where that is missing) into a
// 2D texture array, stored as full-resolution luma (R8) and half-resolution
// chroma (RG8), the 4:2:0 the clip was shot in, ~200 MB rather than 540 in
// RGBA. Everything outside the band, and every pixel inside it that matches
// the empty station, is drawn from one still plate (a median of the empty
// seconds before the train), so static detail is never touched by video
// compression or by time.
//
// Continuous time. 15 frames a second would make every ribbon a staircase
// of 44 px steps. Between ring frames f and f+1 a pixel is fetched along the
// train's own motion: from f at x - a v and from f+1 at x + (1 - a) v (v is
// the train's measured velocity, px per ring frame, from the bake). Between
// the train's fitted front and tail every pixel is train; a sample that lands
// on the occluder mask (fence posts and grass that stand in front of the
// train, found in the bake) is not trusted, and only within a few px of the
// front or tail (template-matched in the bake) is colour against the empty
// station consulted. So the posts never smear, the cab never ghosts, and D
// is a real-valued time: the ribbons are continuous.
//
// The slit. D is a single time front: 0 left of a curve c(y), `depth`
// seconds right of it, climbing across a slit 2w wide. Press anywhere and the
// slit comes to you, held most strongly at the row you hold, like a rope, so
// a drag sculpts its curve; held, it deepens from 2.4 s towards 4.6 s. Let go
// and it eases back to its resting lean. Hovering, it leans a little towards
// the pointer. D is sampled with a cubic B-spline, so its slope (the train's
// magnification) has no kinks.
//
// Query (stills): ?t=seconds holds the clock; ?front=flat shows the clip as
// shot; ?slit=x,lean sets the resting slit; ?depth (or ?delay)=seconds;
// ?bend=y,x;... pulls the rows near y to x (0..1 of the print).

const ASSET = "/lab/slit-scan/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const MW = 240; // delay map, print aspect 2.4
const MH = 100;
const RELAX = 2.2; // s, time constant of the slit easing back to rest

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

// RGB frame -> luma layer (full res)
const LUMA_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec3 c = texture(uSrc, uv).rgb;
  o = vec4(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 0.0, 1.0);
}`;

// RGB frame -> chroma layer (half res; one bilinear tap at the 2x2 corner is
// the exact box average)
const CHROMA_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0) / vec2(textureSize(uSrc, 0));
  vec3 c = texture(uSrc, uv).rgb;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4((c.b - y) / 1.8556 + 0.5, (c.r - y) / 1.5748 + 0.5, 0.0, 1.0);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uY;
uniform sampler2DArray uC;
uniform sampler2D uPlate;     // the empty station, print crop, top row first
uniform sampler2D uDelay;     // R16F seconds, print-normalised, top row first
uniform sampler2D uTrack;     // RGBA32F n x 1: v, x0, x1, 0
uniform sampler2D uOcc;       // band-sized: things standing in front of the train
uniform vec4 uPrint;          // device px: x, y, w, h (top-left origin)
uniform float uCanvasH;
uniform vec3 uPaper;
uniform vec2 uSrc;            // source px of the print: 1920, 800
uniform vec2 uBand;           // band rows in print px: top, height
uniform vec2 uBody;           // rows where the train's motion applies (print px)
uniform float uClock;         // seconds
uniform float uLoop;          // seconds
uniform float uFps;
uniform int uN;
uniform float uOn;            // 0..1, eases the time field in
uniform float uReady;         // ring complete
out vec4 o;

vec3 yuv2rgb(float y, vec2 c) {
  float cb = c.x - 0.5, cr = c.y - 0.5;
  return vec3(y + 1.5748 * cr, y - 0.1873 * cb - 0.4681 * cr, y + 1.8556 * cb);
}
vec3 ring(vec2 p, int f) {
  vec2 uv = vec2(p.x / uSrc.x, (p.y - uBand.x) / uBand.y);
  float y = texture(uY, vec3(uv, float(f))).r;
  vec2 c = texture(uC, vec3(uv, float(f))).rg;
  return yuv2rgb(y, c);
}
vec3 plate(vec2 p) { return texture(uPlate, p / uSrc).rgb; }

// cubic B-spline from 4 bilinear taps
float delayAt(vec2 uv) {
  vec2 ts = vec2(textureSize(uDelay, 0));
  vec2 st = uv * ts - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f * f - 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (w1 / g0) - 1.0 + i + 0.5;
  vec2 h1 = (w3 / g1) + 1.0 + i + 0.5;
  float a = texture(uDelay, vec2(h0.x, h0.y) / ts).r;
  float b = texture(uDelay, vec2(h1.x, h0.y) / ts).r;
  float c = texture(uDelay, vec2(h0.x, h1.y) / ts).r;
  float d = texture(uDelay, vec2(h1.x, h1.y) / ts).r;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

float diff(vec3 a, vec3 b) {
  vec3 d = abs(a - b);
  return max(max(d.r, d.g), d.b) + 0.5 * abs(dot(a - b, vec3(0.2126, 0.7152, 0.0722)));
}

void main() {
  vec2 dpx = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 l = (dpx - uPrint.xy) / uPrint.zw;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThanEqual(l, vec2(1.0)))) { o = vec4(uPaper, 1.0); return; }
  vec2 p = l * uSrc;
  vec3 still = plate(p);
  float by = p.y - uBand.x;
  if (uReady < 0.5 || by < 0.5 || by > uBand.y - 0.5) { o = vec4(still, 1.0); return; }

  float D = delayAt(l) * uOn;
  float t = mod(uClock - D, uLoop) * uFps;
  int f0 = int(floor(t)) % uN;
  int f1 = (f0 + 1) % uN;
  float a = fract(t);

  vec3 s0 = ring(p, f0);
  vec3 s1 = ring(p, f1);
  float st0 = diff(s0, still);
  float st1 = diff(s1, still);
  vec3 col = mix(s0, s1, a);

  vec4 k0 = texelFetch(uTrack, ivec2(f0, 0), 0);
  vec4 k1 = texelFetch(uTrack, ivec2(f1, 0), 0);
  float v = k0.x;
  vec2 buv = vec2(p.x / uSrc.x, by / uBand.y);
  float occ = texture(uOcc, buv).r;
  // the train's extent at this moment (fitted front and tail; open where
  // it runs off the frame)
  float e0 = mix(k0.y, k1.y, a), e1 = mix(k0.z, k1.z, a);
  e0 = e0 < 0.0 ? -1e4 : e0;
  e1 = e1 > uSrc.x ? 1e4 : e1;
  bool body = abs(v) > 0.5 && p.y > uBody.x && p.y < uBody.y;
  float edge = min(p.x - e0, e1 - p.x); // > 0 inside the train
  if (body && occ < 0.5 && edge > -6.0) {
    // fetch along the train's motion
    vec2 pa = p - vec2(a * v, 0.0);
    vec2 pb = p + vec2((1.0 - a) * v, 0.0);
    vec3 A = ring(pa, f0);
    vec3 B = ring(pb, f1);
    // a sample that lands on something in front of the train is not trusted
    float ta = 1.0 - texture(uOcc, vec2(pa.x / uSrc.x, buv.y)).r;
    float tb = 1.0 - texture(uOcc, vec2(pb.x / uSrc.x, buv.y)).r;
    float wa = (1.0 - a) * (0.001 + ta);
    float wb = a * (0.001 + tb);
    vec3 W = (A * wa + B * wb) / (wa + wb);
    // The front and tail are template-matched to the pixel in the bake. Only
    // within a few px of them is a point allowed to be station, and then
    // only if both samples, followed along the motion, are exactly the empty
    // station where they landed.
    float sa = 1.0 - smoothstep(0.03, 0.06, diff(A, plate(pa)));
    float sb = 1.0 - smoothstep(0.03, 0.06, diff(B, plate(pb)));
    float train = edge >= 6.0 ? 1.0 : smoothstep(-6.0, 0.0, edge) * (1.0 - sa * sb);
    col = mix(st0 < st1 ? s0 : s1, W, train);
  } else if (body && occ < 0.5) {
    // ahead of or behind the train: whichever end is the station
    col = st0 < st1 ? s0 : s1;
  }
  if (occ >= 0.5) col = still;
  // static pixels come from the plate, at full quality
  float m = smoothstep(0.035, 0.085, diff(col, still));
  o = vec4(mix(still, col, m), 1.0);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

// ---- the slit: D(x, y) = depth * smoothstep(c(y) - w, c(y) + w, x)
// Left of the slit curve c(y) the frame is now; right of it, `depth`
// seconds ago; across the slit (2w wide) the whole of those seconds is packed
// in, so the train there is drawn compressed and mirrored, its window frames
// leaning with the curve, and each shoulder of the slit, where the front
// climbs exactly as fast as the train runs, pulls one column into a ribbon.
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const SLIT_W = 0.07; // half width, print widths
const DEPTH0 = 2.4; // s at rest
const DEPTH_HOLD = 4.6; // s, a held press deepens the slit towards this
const restCurve = (y, x0 = 0.525, lean = 0.1) => x0 + lean * (y - 0.5);

function parseBend(s) {
  if (!s) return [];
  return s
    .split(";")
    .map((d) => d.split(",").map(Number))
    .filter((d) => d.length === 2 && d.every(Number.isFinite))
    .map(([y, x]) => ({ y, x }));
}

// ---- the ring: decode every frame of the band into Y / CbCr layers
async function decodeRing(gl, meta, onFrame) {
  const vp9 = typeof VideoDecoder !== "undefined";
  if (vp9) {
    try {
      const buf = await (await fetch(`${ASSET}band.webm`)).arrayBuffer();
      const webm = readWebm(buf);
      const config = { codec: "vp09.00.40.08", codedWidth: webm.width, codedHeight: webm.height };
      const ok = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
      if (ok.supported) {
        let failed = null;
        const decoder = new VideoDecoder({
          output: (frame) => {
            const idx = Math.round(((frame.timestamp / 1e6) * meta.fps));
            try {
              onFrame(frame, idx);
            } finally {
              frame.close();
            }
          },
          error: (e) => {
            failed = e;
          },
        });
        decoder.configure(config);
        for (const f of webm.frames) {
          decoder.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: Math.round(f.time * 1000), data: f.data }));
          // keep the decode queue short so frames are uploaded as they come
          if (decoder.decodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        }
        await decoder.flush();
        decoder.close();
        if (!failed) return;
      }
    } catch (e) {
      console.warn("slit-scan: WebCodecs path failed, falling back", e);
    }
  }
  // fallback: seek a <video> frame by frame
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = video.canPlayType('video/webm; codecs="vp9"') ? `${ASSET}band.webm` : `${ASSET}band.mp4`;
  await new Promise((res, rej) => {
    video.onloadeddata = res;
    video.onerror = () => rej(new Error("slit-scan: video"));
  });
  for (let i = 0; i < meta.n; i++) {
    await new Promise((res) => {
      video.onseeked = res;
      video.currentTime = (i + 0.5) / meta.fps;
    });
    onFrame(video, i);
  }
  video.removeAttribute("src");
  video.load();
}

export async function createSlitScan(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const holdT = num("t");
  const flat = q.get("front") === "flat";
  const slitQ = (q.get("slit") || "").split(",").map((v) => (v.trim() === "" ? NaN : Number(v)));
  const x0 = Number.isFinite(slitQ[0]) ? slitQ[0] : 0.525;
  const lean = Number.isFinite(slitQ[1]) ? slitQ[1] : 0.1;
  const depthQ = num("depth") ?? num("delay");
  const bends = parseBend(q.get("bend"));

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "crosshair";

  const [meta, plateBm, occBm] = await Promise.all([
    fetch(`${ASSET}track.json`).then((r) => r.json()),
    loadBitmap(`${ASSET}plate.webp`),
    loadBitmap(`${ASSET}occ.png`),
  ]);
  const SW = meta.width;
  const SH = meta.crop[1] - meta.crop[0];
  const BW = SW;
  const BH = meta.band[1] - meta.band[0];
  const N = meta.n;
  const LOOP = N / meta.fps;

  // ---- GL resources
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const tex2d = (internal, format, type, w, h, data, filter = gl.LINEAR) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const plateTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, plateTex);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, plateBm);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  plateBm.close?.();

  const arr = (internal, w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, w, h, N);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const yTex = arr(gl.R8, BW, BH);
  const cTex = arr(gl.RG8, BW / 2, BH / 2);
  const srcTex = tex2d(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, BW, BH, null);
  const fbo = gl.createFramebuffer();

  const trackData = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    trackData[i * 4] = meta.v[i] || 0;
    trackData[i * 4 + 1] = meta.x[i]?.[0] ?? 0;
    trackData[i * 4 + 2] = meta.x[i]?.[1] ?? 0;
  }
  const occTex = tex2d(gl.R8, gl.RED, gl.UNSIGNED_BYTE, BW, BH, null);
  gl.bindTexture(gl.TEXTURE_2D, occTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, occBm);
  occBm.close?.();
  const trackTex = tex2d(gl.RGBA32F, gl.RGBA, gl.FLOAT, N, 1, trackData, gl.NEAREST);

  // the delay field, drawn from the slit curve
  const field = new Float32Array(MW * MH);
  const rest = new Float32Array(MH);
  const curve = new Float32Array(MH);
  const tmp = new Float32Array(MH);
  for (let j = 0; j < MH; j++) rest[j] = restCurve((j + 0.5) / MH, x0, lean);
  curve.set(rest);
  // a still can hold the slit bent: each ?bend=y,x pulls the rows near y to x
  for (const b of bends) {
    for (let j = 0; j < MH; j++) {
      const g = Math.exp(-((((j + 0.5) / MH - b.y) / 0.2) ** 2));
      curve[j] += (b.x - curve[j]) * g;
    }
  }
  let depth = flat ? 0 : clamp(depthQ ?? DEPTH0, 0, LOOP * 0.9);
  const depthRest = depth;
  const drawField = () => {
    for (let j = 0; j < MH; j++) {
      const c = curve[j];
      const jr = j * MW;
      for (let i = 0; i < MW; i++) field[jr + i] = depth * smooth(c - SLIT_W, c + SLIT_W, (i + 0.5) / MW);
    }
  };
  drawField();
  const delayTex = tex2d(gl.R16F, gl.RED, gl.FLOAT, MW, MH, field);
  let fieldDirty = false;

  const luma = compile(gl, QUAD_VS, LUMA_FS);
  const chroma = compile(gl, QUAD_VS, CHROMA_FS);
  const show = compile(gl, QUAD_VS, SHOW_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---- layout
  let L = null;
  let drawn = false;
  let resized = true;
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    const narrow = W < 700;
    const margin = Math.max(16, Math.min(W, H) * (narrow ? 0.04 : 0.09));
    const printW = Math.min(W - margin * 2, (H - margin * 2) * (SW / SH));
    const pw = Math.round(printW * dpr);
    const ph = Math.round((printW * SH * dpr) / SW);
    const px = Math.round((W * dpr - pw) / 2);
    const py = Math.round((H * dpr - ph) / 2);
    return { W, H, dpr, pw, ph, px, py };
  };
  stage.onResize(() => {
    L = layout();
    resized = true;
  });

  // ---- state
  let ready = false;
  let on = 0; // time field eased in (ease-out) once the ring is complete
  let onT = 0;
  let clock = holdT ?? 0;
  const held = holdT != null;
  if (held) on = onT = 1;

  const present = () => {
    if (!L) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.useProgram(show.p);
    const u = show.u;
    const bind = (unit, target, t, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, t);
      gl.uniform1i(u[name], unit);
    };
    bind(0, gl.TEXTURE_2D_ARRAY, yTex, "uY");
    bind(1, gl.TEXTURE_2D_ARRAY, cTex, "uC");
    bind(2, gl.TEXTURE_2D, plateTex, "uPlate");
    bind(3, gl.TEXTURE_2D, delayTex, "uDelay");
    bind(4, gl.TEXTURE_2D, trackTex, "uTrack");
    bind(5, gl.TEXTURE_2D, occTex, "uOcc");
    gl.uniform4f(u.uPrint, L.px, L.py, L.pw, L.ph);
    gl.uniform1f(u.uCanvasH, stage.canvas.height);
    gl.uniform3f(u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform2f(u.uSrc, SW, SH);
    gl.uniform2f(u.uBand, meta.band[0] - meta.crop[0], BH);
    gl.uniform2f(u.uBody, meta.body[0] - meta.crop[0], meta.body[1] - meta.crop[0]);
    gl.uniform1f(u.uClock, clock);
    gl.uniform1f(u.uLoop, LOOP);
    gl.uniform1f(u.uFps, meta.fps);
    gl.uniform1i(u.uN, N);
    gl.uniform1f(u.uOn, on);
    gl.uniform1f(u.uReady, ready ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  // ---- fill the ring
  const upload = (src, idx) => {
    if (idx < 0 || idx >= N) return;
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, yTex, 0, idx);
    gl.viewport(0, 0, BW, BH);
    gl.useProgram(luma.p);
    gl.uniform1i(luma.u.uSrc, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, cTex, 0, idx);
    gl.viewport(0, 0, BW / 2, BH / 2);
    gl.useProgram(chroma.p);
    gl.uniform1i(chroma.u.uSrc, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  };

  // ---- input: press and drag takes hold of the slit; it follows the
  // pointer most strongly at the row you hold, like a rope, and deepens
  // while held. Let go and it eases back to rest over several seconds.
  const toPrint = (x, y) => (L ? [(x * L.dpr - L.px) / L.pw, (y * L.dpr - L.py) / L.ph] : [0.5, 0.5]);
  let press = false;
  stage.on("down", () => {
    press = true;
  });
  stage.on("up", () => {
    press = false;
  });

  let settled = held;
  const frame = (dt) => {
    if (!L) return;
    if (!held) clock = (clock + dt) % LOOP;
    if (ready && onT < 1) {
      onT = held ? 1 : Math.min(1, onT + dt / 1.6);
      on = 1 - (1 - onT) ** 3;
    }
    const p = stage.pointer;
    const [px, py] = toPrint(p.x, p.y);
    const inside = p.inside && px >= 0 && px <= 1 && py >= 0 && py <= 1;
    if (ready && (press || inside || !settled)) {
      const grab = press ? 1 - Math.exp(-dt * 14) : 0;
      const back = 1 - Math.exp(-dt / RELAX);
      let dev = 0;
      for (let j = 0; j < MH; j++) {
        const yj = (j + 0.5) / MH;
        const g = Math.exp(-(((yj - py) / 0.22) ** 2));
        // hovering, the slit leans a little towards you; held, it follows
        const aim = press ? px : rest[j] + (inside ? 0.1 * g * (clamp(px, -0.1, 1.1) - rest[j]) : 0);
        const k = press ? grab * g : back;
        tmp[j] = curve[j] + (aim - curve[j]) * k;
      }
      // a little tension along the slit keeps the curve smooth
      const kt = Math.min(1, dt * 12) * 0.35;
      for (let j = 0; j < MH; j++) {
        const a = tmp[Math.max(0, j - 1)];
        const b = tmp[Math.min(MH - 1, j + 1)];
        curve[j] = tmp[j] + ((a + b) * 0.5 - tmp[j]) * kt;
        dev = Math.max(dev, Math.abs(curve[j] - rest[j]));
      }
      if (!flat) depth += ((press ? DEPTH_HOLD : depthRest) - depth) * (1 - Math.exp(-dt / (press ? 2.5 : 3)));
      settled = !press && !inside && dev < 5e-4 && Math.abs(depth - depthRest) < 2e-3;
      drawField();
      fieldDirty = true;
    }
    if (fieldDirty) {
      gl.bindTexture(gl.TEXTURE_2D, delayTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MW, MH, gl.RED, gl.FLOAT, field);
      fieldDirty = false;
      drawn = false;
    }
    // While the ring fills only the plate shows; a held still with nothing
    // moving is drawn once. Everything else is live every frame.
    const still = !ready || (held && settled);
    if (!still || !drawn || resized) present();
    drawn = true;
    resized = false;
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (!L && stage.canvas.width > 1) L = layout();
  present();

  // decode after the first paint, so the plate shows while the ring fills
  let destroyed = false;
  const filled = new Uint8Array(N);
  decodeRing(gl, meta, (src, idx) => {
    if (destroyed) return;
    upload(src, idx);
    if (idx >= 0 && idx < N) filled[idx] = 1;
    host.dataset.ringN = String((+host.dataset.ringN || 0) + 1);
  })
    .then(() => {
      if (destroyed) return;
      const missing = N - filled.reduce((a, b) => a + b, 0);
      if (missing) console.warn(`slit-scan: ${missing} ring frames missing`);
      ready = true;
      drawn = false;
      host.dataset.ring = "full";
    })
    .catch((e) => console.warn("slit-scan: ring", e));
  void embedded;

  return {
    destroy() {
      destroyed = true;
      for (const t of [yTex, cTex, srcTex, plateTex, delayTex, trackTex, occTex]) gl.deleteTexture(t);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      for (const s of [luma, chroma, show]) gl.deleteProgram(s.p);
      stage.destroy();
    },
  };
}
