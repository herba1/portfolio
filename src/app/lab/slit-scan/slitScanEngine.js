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
// Discrete time. Nothing is blended between moments. Every pixel is locked
// to the nearest whole ring frame, and D is read once per slit cell (2
// device px square), so where the front moves the train the picture breaks
// into hard strata, each one moment of the clip, bounded by the front's
// isochrones; at 15 fps one frame is ~44 px of the train's run, so along a
// ribbon the strata are rigid slices of carriage set side by side. The
// rounding is the same everywhere, so each seam between two moments is one
// clean edge along the isochrone and the strata read as wide, hard bands of
// carriage, never as a texture of dashes. Where the isochrones run across
// the rows rather than down them (where the front cuts the train's end) a
// whole frame would move the end ~44 px at a time, a staircase; there each
// stratum's frame is read where the train stood at the stratum's own moment
// (shifted by the train's measured run over the remainder, never blended),
// with the tracked nose and tail deciding train from station, so the cut is a
// smooth curve. Anything that matches
// the empty station, or lies on the occluder mask (fence posts and grass in
// front of the train, found in the bake), is drawn from the plate.
//
// The front. D is a single time front: 0 on the left, `depth` seconds on
// the right, climbing across a ramp as wide as the distance the train runs in
// those seconds (depth x v, ~1600 source px), so on average it climbs at
// exactly 1/v; D is spent along the train's measured run rather than the
// wall clock, so that holds while the train speeds up. At rest the front's
// half-way rope is already bent deep, pulled far left at the roof and the
// windows and part way at the undercarriage, so along each row the slope swings above 1/v (the train folded
// back on itself: mirrored X-shaped windows) and below it (doors and
// pillars drawn out), and the bends drift slowly. The rope also sets each
// row's moment (ROW_T): a row whose rope is pulled left is later, so the
// front cuts through the end of the train along a curve that follows the
// rope; every row also sits half a second later (ROW_OFF), so at the rest
// moment (CLOCK0) the front already cuts the tail and the train is a
// carved silhouette with the empty station showing through it. Press
// anywhere and the rope comes to you, held most strongly at the row you hold, so a drag bends the
// local slope above 1/v (the train mirrored) on one side of the hand and
// below it (compressed) on the other; held, the whole front steepens. Let go
// and it eases back to rest. Hovering, it leans a little towards the
// pointer. D is sampled with a cubic B-spline, so the isochrones that bound
// the strata run without kinks. Rows above the train's body never take the
// sculpted time, so nothing rises onto the canopy; below the red stripe
// every slit column is held at the moment of the stripe directly above it,
// so the undercarriage never streaks and follows the body's cut sliver for
// sliver.
//
// The print is cropped tight to the carriage (VIEW) and drawn at most one
// device pixel per source pixel, never upsampled.
//
// Query (stills): ?t=seconds holds the clock (the hero is ?t=8.2); ?front=flat shows the clip as
// shot; ?slit=x,lean sets the resting front; ?depth (or ?delay)=seconds also
// sets the ramp's width (deeper is wider, still matched); ?bend=y,x;... sets
// the rest pose, pulling the rope near row y to x (0..1 of the print), in
// place of the built-in bends (?bend=none for the plain 1/v ramp).

const ASSET = "/lab/slit-scan/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const MW = 240; // delay map over the whole plate (1920 x 800, aspect 2.4)
const MH = 100;
// The print shows only these source rows: the carriage (roof ~305, wheels
// ~672) with a little of the station's eaves above and the fence and grass
// below, so the train is ~60% of the print's height and the process has the
// bulk of the frame. The delay field still spans the whole plate, so ?bend
// and ?slit keep their meaning.
const VIEW = [190, 790];
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
uniform sampler2D uOcc;       // band-sized: things standing in front of the train
uniform vec4 uPrint;          // device px: x, y, w, h (top-left origin)
uniform vec4 uView;           // plate px the print shows: x, y, w, h
uniform float uCanvasH;
uniform vec3 uPaper;
uniform vec2 uSrc;            // source px of the plate (and of the delay field): 1920, 800
uniform vec2 uBand;           // band rows in print px: top, height
uniform vec2 uBody;           // the train's body rows, where the sculpted time applies (print px)
uniform vec2 uCap;            // the red stripe's lower edge: row at x = 0, rise across the print
uniform sampler2D uInv;       // R32F NP x 1: frame time at each distance the train has run
uniform sampler2D uTrack;     // RGBA32F N x 1: per ring frame, the train's run (px per frame), nose and tail x
uniform float uRun;           // distance the train has run at the clock, px
uniform float uRunLoop;       // ... over the whole loop
uniform float uSpeed;         // px per second that one second of D stands for
uniform float uFps;
uniform int uN;
uniform float uOn;            // 0..1, eases the time field in
uniform float uReady;         // ring complete
out vec4 o;
const float STRATUM = 2.0;    // device px: one slit cell, one ring frame

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
// level 0 always: the print is never smaller than the source, and a read
// that jumps at a seam must not fall to a blurred mip
vec3 plate(vec2 p) { return textureLod(uPlate, p / uSrc, 0.0).rgb; }

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
  vec2 p = uView.xy + l * uView.zw;
  vec2 lf = p / uSrc;
  vec3 still = plate(p);
  float by = p.y - uBand.x;
  float occ = texture(uOcc, vec2(p.x / uSrc.x, by / uBand.y)).r;
  if (uReady < 0.5 || by < 0.5 || by > uBand.y - 0.5) { o = vec4(still, 1.0); return; }

  // D is read in the train's own time: D seconds back is D x speed px of
  // the train's run back, so where D climbs at 1/speed the same column of
  // the train is held exactly, however the train speeds up
  // The sculpted rows stop at the bottom of the red stripe. It is a hard
  // horizontal edge of the train, at the same row in every frame (it leans
  // a little with the perspective), so cutting time there leaves no seam.
  // Below it the undercarriage would only be pulled into dark streaks, with
  // the fence wires and the grass dragged in: there each slit column is held
  // at the moment of the stripe's slit directly above it (the same frame,
  // shift), so wheels and bogies stay crisp, the train
  // is there exactly where its body is, and its cut runs on down as fine
  // vertical slivers.
  float cap = uCap.x + uCap.y * l.x;
  bool under = p.y >= cap;
  // D is read once per slit cell, STRATUM device px square, so every seam
  // between two moments lands on the pixel grid, hard
  vec2 cell = floor((dpx - uPrint.xy) / STRATUM);
  if (under) cell.y = floor(((cap - 1.5 - uView.y) / uView.w) * uPrint.w / STRATUM);
  vec2 lD = (uView.xy + (cell + 0.5) * STRATUM / uPrint.zw * uView.zw) / uSrc;
  float D = delayAt(lD) * uOn;
  float q = mod(uRun - D * uSpeed, uRunLoop);
  int np = textureSize(uInv, 0).x;
  float qi = q / uRunLoop * float(np - 1);
  int q0 = min(int(floor(qi)), np - 2);
  float t = mix(texelFetch(uInv, ivec2(q0, 0), 0).r, texelFetch(uInv, ivec2(q0 + 1, 0), 0).r, qi - float(q0));
  // Every pixel is drawn from one whole ring frame, the nearest, never
  // blended. Where the isochrone runs down the rows (the ribbons, D climbing
  // along x) that is all: each stratum is a rigid slice of carriage and the
  // seams between them are clean vertical cuts. Where it runs across the rows
  // (D changing down the picture, as where the front cuts the train's end)
  // whole frames would move the end ~44 px at a time, a staircase, so there
  // the frame is read where the train stands at the stratum's own moment: it
  // is shifted by the train's measured run over the remainder, never resampled
  // in time. The cut then follows the isochrone as a smooth curve.
  vec2 e = 3.0 / uSrc;
  vec2 g = vec2(delayAt(lD + vec2(e.x, 0.0)) - delayAt(lD - vec2(e.x, 0.0)),
                delayAt(lD + vec2(0.0, e.y)) - delayAt(lD - vec2(0.0, e.y))) / (3.0 * uPrint.zw / uView.zw);
  float follow = smoothstep(0.4, 0.5, g.y * g.y / (dot(g, g) + 1e-12));
  int f0 = int(floor(t + 0.5));
  int f = f0 % uN;
  float v = texelFetch(uTrack, ivec2(f0 % uN, 0), 0).r;
  float sx = follow * v * (t - float(f0));
  vec2 ps = vec2(p.x - sx, p.y);
  vec3 col = ring(p, f);
  vec3 ref = still;
  if (abs(sx) > 0.25) {
    // Which of the two the pixel shows is decided by where the train stands
    // in that frame (its tracked nose and tail), not by comparing against the
    // plate, whose exposure drifts from the late frames: shifted, a false
    // match would draw the station displaced.
    vec2 ex = texelFetch(uTrack, ivec2(f, 0), 0).gb;
    bool atS = ps.x >= ex.x && ps.x <= ex.y;
    bool atP = p.x >= ex.x && p.x <= ex.y;
    bool post = texture(uOcc, vec2(ps.x / uSrc.x, by / uBand.y)).r >= 0.5;
    if (atS && !post) {
      // the train at the stratum's own moment
      col = ring(ps, f);
      ref = plate(ps);
    } else if (atP && !post) {
      // the train had already left this pixel at that moment
      col = still;
    }
  }
  bool rows = p.y > uBody.x && p.y < uBody.y;
  if (!rows) {
    // Above and below the train's body rows, where the front is sculpted
    // (D changing across x), those rows keep the empty station: the ribbons stop at the train and never climb
    // onto the canopy. Where D is flat (the train as shot, now or ago) the
    // roof and pantograph show as they were.
    float e = 4.0 / uSrc.x;
    float slope = abs(delayAt(lf + vec2(e, 0.0)) - delayAt(lf - vec2(e, 0.0))) * uOn * uSpeed / 8.0;
    col = mix(col, ref, smoothstep(0.04, 0.2, slope));
  }
  if (occ >= 0.5) col = ref;
  // static pixels come from the plate, at full quality
  float m = smoothstep(0.035, 0.085, diff(col, ref));
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

// ---- the time front. D climbs from 0 to `depth` across a ramp whose width
// is the distance the train covers in those seconds (depth x v), so left
// alone its slope is exactly 1/v: one column of the train held still and
// drawn out into rigid horizontal ribbons, with knees at either end that hand
// back to the train as shot (now on the left, ago on the right). The ramp leans with the rest curve, so each row holds a
// slightly different column and the ribbons carry the train's windows and
// doors as colour. The rope c(y) is where D is half way: drag it and that
// row's front is bent (a bias curve, smooth and monotone), steeper than 1/v
// on one side of the hand, where the train comes out mirrored, and shallower
// on the other, where it comes out compressed.
const DEPTH0 = 2.4; // s at rest
const KNEE = 0.09; // of the ramp: the soft hand-off at either end
const HOLD = 1.6; // a held press deepens the front by this much (steeper than 1/v)
// The rest curve leans hard, so down the train each row holds a column
// further along it: the ribbons cut a long diagonal through the windows,
// doors and stripes, and come out as dense bands of the train's colours.
const X0 = 0.525;
const LEAN = 0.8;
const restCurve = (y, x0 = X0, lean = LEAN) => x0 + lean * (y - 0.5);
// The rest pose is not the flat ramp: the rope is already bent deep, pulled
// far left at the roof and through the windows and part way at the
// undercarriage, so across them the front's slope swings
// above 1/v (the train folded back on itself: the windows come out as
// mirrored X shapes) and below it (doors and pillars drawn out), crossing 1/v
// again at every row the rope leans through. It breathes: each bend drifts a
// little, on its own slow period. They are deep enough that the still, not
// only a drag, shows the window rows folded into mirrored X and wave strata
// (the same as ?bend=0.3,0.15;0.55,0.2;0.75,0.45). ?bend replaces these
// (?bend=none for the plain ramp).
const REST_BENDS = [
  { y: 0.3, x: 0.15, ax: 0.03, ay: 0.015, period: 13 },
  { y: 0.55, x: 0.2, ax: 0.035, ay: 0.02, period: 17.5 },
  { y: 0.75, x: 0.45, ax: 0.03, ay: 0.02, period: 21 },
];
const BEND_W = 0.2; // the rope's reach above and below a bend, print heights
// The rope also sets each row's moment. Every row is offset in time by
// ROW_T seconds per print width that its rope stands right of the line's
// centre: where the rope is pulled left the row is later, where it lies right
// the row is earlier. The bent rows and the rows beside them sit 0.3 to 2 s
// apart, so the time front cuts through the train's tail along a curve that
// follows the rope: some rows already show the empty station where the train
// has gone, others still carry carriage, folded into mirrored windows at the
// edge. Drag the rope and that boundary moves with it.
const ROW_T = 6;
// ...and every row is half a second later than its rope alone would put it,
// so at the rest moment the front already stands in the train's tail: the
// rows the rope pulls left (the roof and the windows) are cut back to the
// empty station on either side and hold carriage only where the front folds
// it into mirrored windows, the rows below still carry the whole car.
const ROW_OFF = -0.5;
// the clock at rest, and the still: the moment the front cuts the tail
const CLOCK0 = 8.2;
// Between the tail leaving every row (~9.4 s) and the nose reaching the
// front (~0.5 s, across the loop's seam; the deep bends bring it early) the rest pose is only the empty
// station, which is one still plate: the clock runs through it SKIP times
// faster, so nothing visible is skipped and the loop is mostly train.
const EMPTY = [9.4, 0.45];
const SKIP = 6;
// the red stripe's lower edge, source rows of the print at its left and right
const CAP = [616, 581];
// 0 -> 1 with slope 1 between the knees and a quadratic hand-off at the ends
const soft0 = (s) => (s <= -KNEE ? 0 : s >= KNEE ? s : ((s + KNEE) * (s + KNEE)) / (4 * KNEE));
const ramp = (s) => soft0(s) - soft0(s - 1);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// the train's typical speed, px per second of the source
const trainSpeed = (meta) => {
  const v = meta.v.map((x) => Math.abs(x)).filter((x) => x > 0.5).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] * meta.fps : 650;
};

function parseBend(s) {
  if (s == null) return REST_BENDS;
  if (!s) return [];
  return s
    .split(";")
    .map((d) => d.split(",").map(Number))
    .filter((d) => d.length === 2 && d.every(Number.isFinite))
    .map(([y, x]) => ({ y, x, ax: 0, ay: 0, period: 1 }));
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
  const x0 = Number.isFinite(slitQ[0]) ? slitQ[0] : X0;
  const lean = Number.isFinite(slitQ[1]) ? slitQ[1] : LEAN;
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
  const VY = VIEW[0] - meta.crop[0]; // the print's top row in the plate
  const VH = VIEW[1] - VIEW[0];
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

  const occTex = tex2d(gl.R8, gl.RED, gl.UNSIGNED_BYTE, BW, BH, null);
  gl.bindTexture(gl.TEXTURE_2D, occTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, occBm);
  occBm.close?.();
  // The train's run: run[i] is how far it has travelled by ring frame i (a
  // little creep where it stands still or is out of shot, so time never
  // stops), and inv maps distance back to frame time. D is spent along it.
  const SPEED = trainSpeed(meta);
  const run = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) run[i + 1] = run[i] + Math.max(Math.abs(meta.v[i] || 0), 2);
  const RUN = run[N];
  const runAt = (sec) => {
    const f = clamp(sec * meta.fps, 0, N);
    const i = Math.min(N - 1, Math.floor(f));
    return run[i] + (run[i + 1] - run[i]) * (f - i);
  };
  const NP = 4096;
  const inv = new Float32Array(NP);
  for (let j = 0, i = 0; j < NP; j++) {
    const d = (j / (NP - 1)) * RUN;
    while (i < N - 1 && run[i + 1] < d) i++;
    inv[j] = i + clamp((d - run[i]) / (run[i + 1] - run[i]), 0, 1);
  }
  const invTex = tex2d(gl.R32F, gl.RED, gl.FLOAT, NP, 1, inv, gl.NEAREST);
  // per ring frame: the train's run, and where its nose and tail stand
  // (an empty frame has no extent)
  const trackData = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const [a, b] = meta.x[i] || [0, 0];
    trackData.set([meta.v[i] || 0, a, b > a ? b : -1, 0], i * 4);
  }
  const trackTex = tex2d(gl.RGBA32F, gl.RGBA, gl.FLOAT, N, 1, trackData, gl.NEAREST);

  // the delay field, drawn from the slit curve
  const field = new Float32Array(MW * MH);
  const line = new Float32Array(MH); // the ramp's centre: the plain leaning line
  const rest = new Float32Array(MH); // the rope at rest: the line, bent
  const curve = new Float32Array(MH);
  const tmp = new Float32Array(MH);
  // the rest pose at breath time tb: the leaning line, with each bend
  // pulling the rows near its y to its x (at tb = 0 exactly where it is set)
  const pose = (tb) => {
    rest.set(line);
    for (const b of bends) {
      const ph = (tb / b.period) * Math.PI * 2;
      const bx = b.x + b.ax * Math.sin(ph);
      const by = b.y + b.ay * Math.sin(ph * 0.5 + 1.1) - b.ay * Math.sin(1.1);
      for (let j = 0; j < MH; j++) {
        const g = Math.exp(-((((j + 0.5) / MH - by) / BEND_W) ** 2));
        rest[j] += (bx - rest[j]) * g;
      }
    }
  };
  for (let j = 0; j < MH; j++) line[j] = restCurve((j + 0.5) / MH, x0, lean);
  pose(0);
  curve.set(rest);
  let depth = flat ? 0 : clamp(depthQ ?? DEPTH0, 0, (RUN / SPEED / HOLD) * 0.9);
  const depthRest = depth;
  // the ramp's half width, print widths: half the distance the train runs in
  // the resting depth, so the front climbs at exactly 1/v
  const halfW = Math.max(0.05, ((depthRest || DEPTH0) * SPEED) / (2 * SW));
  const drawField = () => {
    for (let j = 0; j < MH; j++) {
      const a = line[j] - halfW;
      const span = 2 * halfW;
      // where the rope holds this row's half-way point, 0..1 of the ramp
      const m = clamp((curve[j] - a) / span, 0.07, 0.93);
      // Schlick bias through (m, 1/2), extended linearly past the ends
      const k = 1 / (1 - m) - 2;
      const g0 = (1 - m) / m;
      const g1 = m / (1 - m);
      const rowT = flat ? 0 : ROW_T * (curve[j] - x0) + ROW_OFF;
      const jr = j * MW;
      for (let i = 0; i < MW; i++) {
        const s = ((i + 0.5) / MW - a) / span;
        const g = s <= 0 ? s * g0 : s >= 1 ? 1 + (s - 1) * g1 : s / (k * (1 - s) + 1);
        field[jr + i] = depth * ramp(g) + rowT;
      }
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
    // never larger than the source: at most one device pixel per source
    // pixel, so the footage is drawn 1:1 and never upsampled
    const printW = Math.min(W - margin * 2, (H - margin * 2) * (SW / VH), SW / dpr);
    const pw = Math.round(printW * dpr);
    const ph = Math.round((printW * VH * dpr) / SW);
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
  let clock = holdT ?? CLOCK0;
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
    bind(5, gl.TEXTURE_2D, occTex, "uOcc");
    bind(6, gl.TEXTURE_2D, invTex, "uInv");
    bind(7, gl.TEXTURE_2D, trackTex, "uTrack");
    gl.uniform4f(u.uPrint, L.px, L.py, L.pw, L.ph);
    gl.uniform4f(u.uView, 0, VY, SW, VH);
    gl.uniform1f(u.uCanvasH, stage.canvas.height);
    gl.uniform3f(u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform2f(u.uSrc, SW, SH);
    gl.uniform2f(u.uBand, meta.band[0] - meta.crop[0], BH);
    gl.uniform2f(u.uBody, meta.body[0] - meta.crop[0], meta.body[1] - meta.crop[0]);
    gl.uniform2f(u.uCap, CAP[0], CAP[1] - CAP[0]);
    gl.uniform1f(u.uRun, runAt(clock));
    gl.uniform1f(u.uRunLoop, RUN);
    gl.uniform1f(u.uSpeed, SPEED);
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
  // print rows -> the delay field's rows (the whole plate)
  const toField = (y) => (VY + y * VH) / SH;
  let press = false;
  stage.on("down", () => {
    press = true;
  });
  stage.on("up", () => {
    press = false;
  });

  let settled = held;
  const breathing = !held && bends.some((b) => b.ax || b.ay);
  let breath = 0;
  const frame = (dt) => {
    if (!L) return;
    // the clock waits for the ring and for the front to ease in, so the first
    // whole picture is the rest moment
    if (!held && ready && onT >= 1) {
      const span = LOOP - EMPTY[0] + EMPTY[1];
      const u = (clock - EMPTY[0] + LOOP) % LOOP;
      const w = u < span ? smooth(u / 0.3) * smooth((span - u) / 0.3) : 0;
      clock = (clock + dt * (1 + (SKIP - 1) * w)) % LOOP;
    }
    if (ready && breathing) {
      // the rest pose drifts, and the rope rides along with it
      breath += dt * on;
      for (let j = 0; j < MH; j++) tmp[j] = rest[j];
      pose(breath);
      for (let j = 0; j < MH; j++) curve[j] += rest[j] - tmp[j];
      settled = false;
    }
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
        const g = Math.exp(-(((yj - toField(py)) / 0.22) ** 2));
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
      if (!flat) depth += ((press ? depthRest * HOLD : depthRest) - depth) * (1 - Math.exp(-dt / (press ? 2.5 : 3)));
      settled = !breathing && !press && !inside && dev < 5e-4 && Math.abs(depth - depthRest) < 2e-3;
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
      for (const t of [yTex, cTex, srcTex, plateTex, delayTex, occTex, invTex, trackTex]) gl.deleteTexture(t);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      for (const s of [luma, chroma, show]) gl.deleteProgram(s.p);
      stage.destroy();
    },
  };
}
