import { createStage, clamp } from "../_kit/stage";

// Rolling. A 1980s SANYO senpuki in a tatami room, seen through a phone's
// CMOS sensor. The fan is a real photograph, cut tight to the fan head and
// cut in three: the plate (the back of the guard and the motor, the room
// behind pulled down to a dim ground lit only by the ceiling lamp; across
// the whole disc the rotor sweeps it is redrawn, the room continuing through
// and the rear guard's spokes and rings as soft lines in the disc plane over
// the motor housing, so no shadow of the photographed blades stays), the rotor (the three blades as
// the photo's own acrylic: its pixels, grain, dust, the light through the
// sheet and the real specular, unwrapped into each blade's (radius, chord)
// frame and read back at every sub-sample's turned point, so the readout
// shears the photo's own texture into striations along the rows and tears
// it into photographic fragments; a signed distance to one smooth outline
// per blade only cuts and anti-aliases the edge, since the readout drags any
// burr on it out into a frayed stroke end; the plate shows through the
// sheet, tinted; and a bright edge drawn here, lit by the lamp as far as the
// outline faces it at each sub-sample's angle), and the front (the guard's
// wires and centre badge: each wire cut from the photo's own luminance, as
// wide as the photo shows it and keeping the steel's shading and highlights,
// running out to the guard's rim, where the plate keeps the same wires).
// The head is turned, so the rotor turns in its own tilted plane: the guard
// rim's ellipse maps picture to disc and back (tools/depth/bakes/rolling).
//
// The sensor is a rolling shutter: it reads its rows one after another, top
// to bottom, over READOUT seconds, and starts a new frame every 1 / FPS
// seconds (29.97 fps). Every frame here is captured that way. Output row s of a frame
// that starts at t0 is exposed over [t0 + s * READOUT, + EXPOSURE], and the
// rotor is drawn at its angle at those instants (EXPOSURE is integrated in
// linear light over a few sub-samples, so a fast blade tip smears exactly as
// far as it travels while that row is open). The angles come from the
// rotor's own simulated history, not from a speed: if the fan accelerates
// during a readout the bottom of the frame sees it. Nothing is warped; the
// blades bend into curls, break into floating segments and stand still at
// the frame-rate's stroboscopic speeds only because of when each row looked.
//
// The room is lit by a ring fluorescent on the same 60 Hz mains that drives
// the motor, so its light pulses at 120 Hz, and every row integrates it over
// its own exposure window too. Four lamp cycles fit the 1/30 s readout, so the
// frame carries four bands: broad cool crests and short warm, dimmer gaps,
// the readout itself drawn in the picture's own light. They lie along the
// sensor's rows (they turn when the phone turns) and they light everything
// through the same linear composite: a crest brightens a row of the guard's
// chrome and the blade islands under it, the gap beside it dims them warm. At 29.97 fps the 120 Hz lamp gains
// 0.004 of a cycle a frame, so they creep up the frame while the torn
// blades creep backwards.
//
// The fan: an induction motor that pushes toward its set speed (it cannot
// brake), quadratic air drag, viscous and dry bearing friction. Left alone
// it runs on its 'high' notch, a shaded-pole motor slipping well below its
// 3600 rpm synchronous speed, at 2395 rpm: a turn and a third per readout,
// so one blade is read twice down the frame, torn clean off the hub into
// floating pieces, while the others stay hooked to it and trail long
// tapering tails, and the three blades pass just under 4 x 29.97 times a
// second, so the torn pattern crawls slowly backwards against the frame
// rate. Drag up (or scroll up) to overdrive it; drag down to drop the set
// speed and let it coast down through the hooks and the wagon-wheel speeds;
// let go and it returns to the notch. Drag sideways to turn the phone: the
// sensor's readout direction rotates with it.
//
// Stills: ?rpm=4800&t=0.25 holds the frame that starts at t (seconds) with
// the rotor at a steady rpm; the hero is ?rpm=2395&t=13.78043, the frame the
// live view opens on. ?scan=deg sets the readout direction; ?exp=N a 1/N s exposure (the default
// is 1/16000, so a blade tip travels a few px while its row is open and every
// hook keeps a hard edge: long exposures blur the blades and wash the bands out, and at
// 1/120 s the bands vanish).

const BASE = "/lab/rolling/";
const FPS = 30000 / 1001; // sensor frame rate: NTSC 29.97, a hair under 30
const READOUT = 1 / 30; // top row to bottom row (fits inside the 1 / 29.97 s frame)
const EXPOSURE = 1 / 16000; // each row's open time (?exp=N for 1 / N s)
const SUB = 16; // exposure sub-samples, so the smear and the lamp are integrated as ramps, not stacks of copies
// The room's lamp: a ring fluorescent on the same 60 Hz mains as the motor,
// on a tired choke ballast. The arc goes out every time the mains voltage
// falls below its re-strike level (STRIKE of the peak, high on an old tube)
// and the tube is dark until it re-strikes, nearly half of every cycle; while it burns its light follows the voltage softly
// (a discharge's light saturates with current, so ARC < 1 flattens the
// crest). That is a 120 Hz train of broad bright crests and short dark
// gaps. Each phosphor holds the light for its own decay time, a first-order
// lag (each harmonic k scaled by 1 / (1 + i k w tau)), so each channel keeps
// its own share of the gap and lags by its own angle; blue decays fastest
// and drops furthest in the gap, red holds on, so the crests run
// cool and the gaps warm, as real flicker bands do. STEADY is each channel's
// light that does not flicker: the phosphors' long afterglow and the
// daylight through the shoji, over half the room's light. The result is
// carried as LAMP_K harmonics, so a row's exposure integrates it exactly.
// Behind a phone's sensor that is four bands down a 1/30 s readout, each
// gap a broad plateau at about 0.56 of the mean light (on the screen, about
// a quarter darker than the mean) and each crest about 1.6 times it: plain
// bands across the torn blades and the guard, never deep enough to drown
// the guard's chrome or the hub.
const MAINS = 60;
const LAMP = 2 * MAINS; // Hz
const STRIKE = 0.8;
const ARC = 0.35;
const DECAY = [0.0016, 0.0011, 0.0004]; // phosphor decay, s (r, g, b)
const STEADY = [0.55, 0.54, 0.57];
const LAMP_K = 10;

// The lamp's light as a function of phase (cycles), mean 1 per channel:
// 1 + sum_k C_k cos(2 pi k phase) + S_k sin(2 pi k phase), per channel.
function lampWave() {
  const N = 2048;
  const d = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    d[i] = Math.max(0, Math.sin((Math.PI * (i + 0.5)) / N) - STRIKE) ** ARC;
    mean += d[i] / N;
  }
  const C = new Float32Array(LAMP_K * 3);
  const S = new Float32Array(LAMP_K * 3);
  for (let k = 1; k <= LAMP_K; k++) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < N; i++) {
      const th = (2 * Math.PI * k * (i + 0.5)) / N;
      a += (2 / N) * d[i] * Math.cos(th);
      b += (2 / N) * d[i] * Math.sin(th);
    }
    for (let c = 0; c < 3; c++) {
      // Z = a - i b through H = 1 / (1 + i x): Z H = (a - i b)(1 - i x) / (1 + x^2).
      const x = 2 * Math.PI * k * LAMP * DECAY[c];
      const re = (a - b * x) / (1 + x * x);
      const im = (-b - a * x) / (1 + x * x);
      const g = (1 - STEADY[c]) / mean;
      C[(k - 1) * 3 + c] = re * g;
      S[(k - 1) * 3 + c] = -im * g;
    }
  }
  return { C, S };
}
const H = 1 / 960; // physics step and angle-history spacing
const NANG = 48; // angle samples per frame (covers READOUT + EXPOSURE)
const RPM = (2 * Math.PI) / 60;

// Fan dynamics, in rad/s and rad/s^2 (per unit rotor inertia).
// The fan on its 'high' notch: a two-pole shaded-pole motor slips a third
// below its 3600 rpm synchronous speed under the blades' load. 2395 rpm is
// 1.33 turns per readout, enough to tear one blade off the hub and leave
// the others hooked to it, and just under 2397.6 rpm (3 blades x 4 x 29.97
// Hz), so the torn pattern crawls backwards, a blade pitch every 8 s.
const REST = 2395;
// The live view starts at this frame (k / FPS), the hero still: two blades
// hooked to the hub with long tapering tails, one torn clean off at the top
// and one at the bottom, the lamp's gaps lying across the hooks.
const HERO_FRAME = 413;
const MAX = 5400; // rpm, overdriven
const DRAG = 0.0005; // quadratic air drag
const VISC = 0.06; // viscous bearing loss
const DRY = 0.5; // dry friction
const SLIP = 6; // motor torque per rad/s of slip below the set speed
const TORQUE = 260; // motor torque cap
const PX_PER_RPM = 0.15; // drag distance (CSS px) per rpm of set speed

const AA = 0.6; // the blade outline's anti-aliasing width, device px: a moulded edge, caught hard
// The blade's moulded edge: a bright line EDGE_AT device px inside the
// outline, EDGE_W wide (sigma), as bright as EDGE where the edge faces the
// ceiling lamp (LAMP_DIR, picture space, y down) and EDGE_BACK of that where
// it faces away, so the glint runs round each torn piece as it turns.
const EDGE = 0.5;
const EDGE_AT = 0.8;
const EDGE_W = 0.5;
const EDGE_BACK = 0.12;
const LAMP_DIR = [-0.29, -0.96];
const PAPER = [0.949, 0.941, 0.922]; // #f2f0eb

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPlate;
uniform sampler2D uRotor;
uniform sampler2D uShape;
uniform sampler2D uFront;
uniform vec2 uView;
uniform vec4 uRect;
uniform vec2 uImg;
uniform vec2 uHub;
uniform mat2 uToDisc;
uniform mat2 uFromDisc;
uniform float uAng[${NANG}];
uniform float uBase;
uniform float uDir;
uniform float uStep;
uniform float uReadout;
uniform float uExpo;
uniform vec2 uScan;
uniform vec2 uScanRange;
uniform float uRows;
uniform vec3 uPaper;
uniform float uPx;
uniform float uSdf;
uniform highp sampler2D uFrame; // the blades' leading and trailing angles against their mids, per radius
uniform float uFrameN;
uniform vec3 uMid;
uniform vec4 uAtlas; // rho0, rho1, chord0, chord1
uniform vec3 uPanel; // texel rows per panel, pad rows, atlas rows
uniform float uLod;
uniform float uLamp0; // the lamp's phase (cycles) at the frame's first row
uniform vec3 uLampC[${LAMP_K}];
uniform vec3 uLampS[${LAMP_K}];
uniform vec2 uLampDir;
out vec4 o;

vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

float angAt(float tau){
  float f = tau / uStep;
  int i = clamp(int(floor(f)), 0, ${NANG - 2});
  return uBase + mix(uAng[i], uAng[i + 1], clamp(f - float(i), 0.0, 1.0));
}

// The lamp's light at tau seconds into the frame, mean 1 per channel.
vec3 lampAt(float tau){
  float th = 6.2831853 * fract(uLamp0 + ${LAMP.toFixed(1)} * tau);
  vec2 r1 = vec2(cos(th), sin(th));
  vec2 r = r1;
  vec3 l = vec3(1.0);
  for (int k = 0; k < ${LAMP_K}; k++) {
    l += uLampC[k] * r.x + uLampS[k] * r.y;
    r = vec2(r.x * r1.x - r.y * r1.y, r.x * r1.y + r.y * r1.x);
  }
  return max(l, 0.0);
}

// ...and its mean over a row's exposure [tau, tau + uExpo], exactly: each
// harmonic's mean over the window, (sin, -cos) differences over k w uExpo.
vec3 lampOver(float tau){
  float w = 6.2831853 * ${LAMP.toFixed(1)} * uExpo;
  float th = 6.2831853 * fract(uLamp0 + ${LAMP.toFixed(1)} * tau);
  vec2 a1 = vec2(cos(th), sin(th));
  vec2 b1 = vec2(cos(th + w), sin(th + w));
  vec2 a = a1, b = b1;
  vec3 l = vec3(1.0);
  for (int k = 0; k < ${LAMP_K}; k++) {
    float kw = float(k + 1) * w;
    l += (uLampC[k] * (b.y - a.y) - uLampS[k] * (b.x - a.x)) / kw;
    a = vec2(a.x * a1.x - a.y * a1.y, a.x * a1.y + a.y * a1.x);
    b = vec2(b.x * b1.x - b.y * b1.y, b.x * b1.y + b.y * b1.x);
  }
  return max(l, 0.0);
}

// The blade frame at radius rho: row 0 holds blades 0 and 1 (lo, hi), row 1
// blade 2, every angle against the blade's mid, linear between FRAME radii.
vec4 frameAt(int row, float rho){
  float f = clamp(rho * uFrameN - 0.5, 0.0, uFrameN - 1.0);
  int i = int(floor(f));
  int j = min(i + 1, int(uFrameN) - 1);
  return mix(texelFetch(uFrame, ivec2(i, row), 0), texelFetch(uFrame, ivec2(j, row), 0), f - float(i));
}
float wrapA(float a){ return a - 6.2831853 * floor((a + 3.14159265) / 6.2831853); }

// The photo's own blade at a point of the rotor's frame, given as its radius
// rho (which the turn leaves alone), its angle phi, and the three blades'
// extents lo, hi at that radius: which blade it falls on (the one whose
// chord is nearest its middle) and where on it, (rho, chord), read from that
// blade's panel of the unwrapped atlas.
vec4 bladeAt(float rho, float phi, vec3 lo, vec3 hi){
  vec3 c = (vec3(wrapA(phi - uMid.x), wrapA(phi - uMid.y), wrapA(phi - uMid.z)) - lo) / max(hi - lo, vec3(1e-3));
  vec3 m = abs(c - 0.5);
  float k = 0.0;
  float ch = c.x;
  if (m.y < m.x) { k = 1.0; ch = c.y; }
  if (m.z < min(m.x, m.y)) { k = 2.0; ch = c.z; }
  float u = clamp((ch - uAtlas.z) / (uAtlas.w - uAtlas.z), 0.0, 1.0);
  float v = clamp((rho - uAtlas.x) / (uAtlas.y - uAtlas.x) * uPanel.x, 0.5, uPanel.x - 0.5);
  v = (k * (uPanel.x + uPanel.y) + v) / uPanel.z;
  return textureLod(uRotor, vec2(u, v), uLod);
}

// The front: the photo's own guard wires, cut from its luminance with their
// shading and highlights (tools/depth/bakes/rolling/photo_front.py), and the
// badge's chrome. Straight alpha over everything behind.
vec4 frontAt(vec2 q){
  return texture(uFront, q);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 q = (frag - uRect.xy) / uRect.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { o = vec4(enc(uPaper), 1.0); return; }
  vec2 p = q * uImg;
  // The sensor row this pixel belongs to, as a fraction of the readout.
  float s = (dot(p, uScan) - uScanRange.x) / (uScanRange.y - uScanRange.x);
  s = (floor(s * uRows) + 0.5) / uRows;
  vec3 plate = texture(uPlate, q).rgb;
  // The fan head is turned: the blades turn in the disc's own plane, which
  // the picture sees as the guard rim's ellipse.
  vec2 d = uToDisc * (p - uHub);
  vec4 f = frontAt(q);
  // Everything in the room is lit by the lamp, so every row sees it at the
  // brightness of its own exposure window: the readout drawn as bands.
  vec3 lit = lampOver(s * uReadout);
  // Beyond the blade tips (0.83 of the rim) nothing turns.
  if (dot(d, d) > 0.81) { o = vec4(enc(mix(plate, f.rgb, f.a) * lit), 1.0); return; }
  // The rotor is acrylic: per sub-sample, coverage c from the signed
  // distance to the blade's outline (anti-aliased over AA device px), the
  // photo's blade at this point of the blade (the atlas), the plate passed
  // through it tinted, T = 1 - c + c (1 - A) tint, and what it sends back,
  // E = c A body + edge. Linear light throughout, and
  // each sub-sample lit by the lamp at that instant.
  vec3 accT = vec3(0.0);
  vec3 accE = vec3(0.0);
  // The turn keeps this point's radius and only moves its angle, so the
  // blades' extents at its radius are read once for every sub-sample.
  float rho = length(d);
  float phi0 = atan(d.y, d.x);
  vec4 f01 = frameAt(0, rho);
  vec2 f2 = frameAt(1, rho).xy;
  vec3 lo = vec3(f01.x, f01.z, f2.x);
  vec3 hi = vec3(f01.y, f01.w, f2.y);
  for (int k = 0; k < ${SUB}; k++) {
    float tau = s * uReadout + uExpo * (float(k) + 0.5) / float(${SUB});
    float a = uDir * angAt(tau);
    float c = cos(a), sn = sin(a);
    vec2 e = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y); // this point in the rotor's own frame
    vec2 r = (uFromDisc * e + uHub) / uImg;
    float sd = (texture(uShape, r).r * 255.0 - 128.0) / uSdf * uPx; // device px, + inside
    float cov = clamp(sd / ${AA.toFixed(2)} + 0.5, 0.0, 1.0);
    if (sd < -2.5) { accT += lampAt(tau); continue; }
    vec4 t = bladeAt(rho, phi0 - a, lo, hi);
    vec3 L = lampAt(tau);
    vec3 tint = t.rgb / max(max(t.r, max(t.g, t.b)), 1e-4);
    // The moulded edge: a line ${EDGE_AT} device px inside the outline, lit
    // by the lamp as far as the edge faces it. The outline's normal is the
    // signed distance's gradient, carried from the rotor's own frame to the
    // picture through this sub-sample's turn (J = fromDisc R toDisc, n = J^T g).
    float edge = 0.0;
    if (abs(sd) < 3.0) {
      vec2 ex = vec2(1.5 / uImg.x, 0.0), ey = vec2(0.0, 1.5 / uImg.y);
      vec2 g = vec2(texture(uShape, r + ex).r - texture(uShape, r - ex).r, texture(uShape, r + ey).r - texture(uShape, r - ey).r);
      vec2 n = -(transpose(uFromDisc * mat2(c, -sn, sn, c) * uToDisc) * g);
      float face = dot(n, uLampDir) / max(length(n), 1e-6);
      float glint = mix(${EDGE_BACK.toFixed(2)}, 1.0, pow(max(face, 0.0), 1.5));
      edge = exp(-0.5 * pow((sd - ${EDGE_AT.toFixed(2)}) / ${EDGE_W.toFixed(2)}, 2.0)) * glint;
    }
    accT += L * (1.0 - cov + cov * (1.0 - t.a) * tint);
    accE += L * (cov * t.a * t.rgb + edge * ${EDGE.toFixed(2)} * (0.45 + 0.55 * tint));
  }
  vec3 col = (plate * accT + accE) / float(${SUB});
  col = mix(col, f.rgb * lit, f.a);
  o = vec4(enc(col), 1.0);
}`;

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function program(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "compile");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
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

export async function createRolling(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const stillRpm = num("rpm");
  const stillT = num("t");
  const scanQ = num("scan");
  const expQ = num("exp");
  // Never longer than the angle history covers past the last row.
  const expo = expQ && expQ > 0 ? clamp(1 / expQ, 1e-5, 1 / 100) : EXPOSURE;
  const lamp = lampWave();

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "ns-resize";

  const [meta, plateBm, rotorBm, shapeBm, frontBm] = await Promise.all([
    fetch(`${BASE}meta.json`).then((r) => r.json()),
    loadBitmap(`${BASE}plate.webp`),
    loadBitmap(`${BASE}rotor.webp`),
    loadBitmap(`${BASE}rotor-shape.webp`),
    loadBitmap(`${BASE}front.webp`),
  ]);
  const IW = meta.width;
  const IH = meta.height;
  // Image px <-> disc units: rows of toDisc are e1 / a and e2 / b; fromDisc
  // has columns a e1 and b e2 (column-major for GL).
  const [e1x, e1y, e2x, e2y, sa, sb] = meta.disc;
  const toDisc = new Float32Array([e1x / sa, e2x / sb, e1y / sa, e2y / sb]);
  const fromDisc = new Float32Array([e1x * sa, e1y * sa, e2x * sb, e2y * sb]);

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  // Colour is sRGB (the plate, the front and the blade atlas); the rotor's signed distance is data.
  const texFrom = (bm, srgb = true) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bm.close?.();
    return t;
  };
  const plateTex = texFrom(plateBm);
  const rotorTex = texFrom(rotorBm);
  const shapeTex = texFrom(shapeBm, false);
  const frontTex = texFrom(frontBm);
  // The blade frame (meta.frame): per radius, each blade's leading and
  // trailing angle against its mid, read exactly (texelFetch, lerped).
  const FN = meta.frame.n;
  const frameData = new Float32Array(FN * 2 * 4);
  for (let i = 0; i < FN; i++) {
    frameData.set([meta.frame.lo[0][i], meta.frame.hi[0][i], meta.frame.lo[1][i], meta.frame.hi[1][i]], i * 4);
    frameData.set([meta.frame.lo[2][i], meta.frame.hi[2][i], 0, 0], (FN + i) * 4);
  }
  const frameTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, frameTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, FN, 2, 0, gl.RGBA, gl.FLOAT, frameData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const atlas = meta.atlas;
  const atlasRows = 3 * atlas.n[0] + 2 * atlas.pad;

  const prog = program(gl, VS, FS);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // ---- the print's place on the paper
  let rect = [0, 0, 1, 1];
  const layout = () => {
    const W = stage.width;
    const Hh = stage.height;
    const dpr = stage.dpr;
    // The print is cut tight to the fan head, so it can sit close to the
    // paper's edges. It is never drawn larger than the photo's own pixels
    // (one image px to one device px at most), so the guard stays crisp.
    const m = embedded ? 0.05 : 0.07;
    const mh = Math.max(16, Hh * m);
    const mw = Math.max(16, W * 0.05);
    const s = Math.min((W - 2 * mw) / IW, (Hh - 2 * mh) / IH, 1 / dpr);
    const w = Math.round(IW * s * dpr);
    const h = Math.round(IH * s * dpr);
    rect = [Math.round((W * dpr - w) / 2), Math.round((Hh * dpr - h) / 2), w, h];
  };

  // ---- the fan
  let theta = 0; // rad, unwrapped
  let omega = (stillRpm ?? REST) * RPM;
  const rest = stillRpm ?? REST;
  let setRpm = rest;
  let simT = stillT ?? HERO_FRAME / FPS;
  const ring = new Float64Array(4096); // theta at simT steps: ring[(step) & 4095]
  let step = Math.round(simT / H);
  // The rotor's angle is its absolute time's (the ring holds it at whole steps).
  theta = stillT != null ? omega * stillT : omega * step * H;
  ring[step & 4095] = theta;

  const physics = () => {
    const target = setRpm * RPM;
    const drag = DRAG * omega * omega + VISC * omega;
    // The motor carries the load at its set speed and pushes harder the
    // further the rotor slips below it. It never brakes: above the set speed
    // the rotor coasts down on its own drag.
    const motor = target > 0 ? clamp(DRAG * target * target + VISC * target + DRY + SLIP * (target - omega), 0, TORQUE) : 0;
    let acc = motor - drag;
    if (omega > 0) acc -= DRY;
    omega = Math.max(0, omega + acc * H);
    theta += omega * H;
    step += 1;
    ring[step & 4095] = theta;
  };

  // ---- the sensor
  let scan = ((scanQ ?? 0) * Math.PI) / 180;
  let scanTarget = scan;
  let frameIndex = Math.floor((simT + 1e-9) * FPS);
  let lastFrame = null; // { base, ang }
  const angs = new Float32Array(NANG);
  // A frame starts at t0 = frameIndex / 29.97 s, between two physics steps:
  // the rotor's history is read at t0 + j H exactly (interpolated), so the
  // rotor and the lamp keep one clock and the bands creep without jitter.
  const capture = (t0, constant) => {
    let base;
    if (constant) {
      const w = omega;
      const th0 = w * t0;
      base = th0 % (2 * Math.PI);
      for (let j = 0; j < NANG; j++) angs[j] = w * j * H;
    } else {
      const x = t0 / H;
      const i = Math.floor(x);
      const fr = x - i;
      const at = (k) => ring[(i + k) & 4095] + fr * (ring[(i + k + 1) & 4095] - ring[(i + k) & 4095]);
      const th0 = at(0);
      base = th0 % (2 * Math.PI);
      for (let j = 0; j < NANG; j++) angs[j] = at(j) - th0;
    }
    // The lamp's phase (cycles) at the first row.
    lastFrame = { base, ang: Float32Array.from(angs), scan, lamp: (t0 * LAMP) % 1 };
    draw();
  };

  const draw = () => {
    if (!lastFrame) return;
    const cw = stage.canvas.width;
    const ch = stage.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog.p);
    const u = prog.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rotorTex);
    gl.uniform1i(u.uRotor, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, frontTex);
    gl.uniform1i(u.uFront, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, shapeTex);
    gl.uniform1i(u.uShape, 3);
    gl.uniform1f(u.uPx, rect[2] / IW);
    gl.uniform1f(u.uSdf, meta.sdf);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, frameTex);
    gl.uniform1i(u.uFrame, 4);
    gl.uniform1f(u.uFrameN, FN);
    gl.uniform3f(u.uMid, meta.frame.mid[0], meta.frame.mid[1], meta.frame.mid[2]);
    gl.uniform4f(u.uAtlas, atlas.rho[0], atlas.rho[1], atlas.chord[0], atlas.chord[1]);
    gl.uniform3f(u.uPanel, atlas.n[0], atlas.pad, atlasRows);
    // The atlas holds about one photo px per texel, so its level of detail
    // is the print's own scale (the turned point's footprint is the same
    // whatever the angle).
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(IW / rect[2])));
    gl.uniform2f(u.uView, cw, ch);
    gl.uniform4f(u.uRect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform2f(u.uImg, IW, IH);
    gl.uniform2f(u.uHub, meta.hub[0], meta.hub[1]);
    gl.uniformMatrix2fv(u.uToDisc, false, toDisc);
    gl.uniformMatrix2fv(u.uFromDisc, false, fromDisc);
    gl.uniform1fv(u.uAng, lastFrame.ang);
    gl.uniform1f(u.uBase, lastFrame.base);
    gl.uniform1f(u.uDir, meta.dir);
    gl.uniform1f(u.uStep, H);
    gl.uniform1f(u.uReadout, READOUT);
    gl.uniform1f(u.uExpo, expo);
    gl.uniform1f(u.uLamp0, lastFrame.lamp);
    gl.uniform3fv(u.uLampC, lamp.C);
    gl.uniform3fv(u.uLampS, lamp.S);
    gl.uniform2f(u.uLampDir, LAMP_DIR[0], LAMP_DIR[1]);
    // Readout direction: rows run along (cos, sin) of the scan angle's
    // perpendicular; s grows down the frame at scan = 0.
    const a = lastFrame.scan;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const proj = [0, IW * nx, IH * ny, IW * nx + IH * ny];
    gl.uniform2f(u.uScan, nx, ny);
    gl.uniform2f(u.uScanRange, Math.min(...proj), Math.max(...proj));
    // A row is one device pixel of the print at scan 0.
    gl.uniform1f(u.uRows, Math.max(rect[3], 2));
    gl.uniform3f(u.uPaper, PAPER[0] ** 2.2, PAPER[1] ** 2.2, PAPER[2] ** 2.2);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  stage.onResize(() => {
    layout();
    draw();
  });

  // ---- input
  let holding = stillT != null; // a still holds its frame until touched
  let gesture = null;
  const release = () => {
    setRpm = rest;
  };
  const wake = () => {
    if (holding) {
      holding = false;
      // Live from the still's moment.
      simT = frameIndex / FPS + READOUT + expo + H;
      step = Math.round(simT / H);
      theta = omega * simT;
      for (let j = 0; j < 4096; j++) ring[(step - j) & 4095] = theta - omega * j * H;
    }
  };
  stage.on("down", (p) => {
    wake();
    gesture = { x: p.x, y: p.y, rpm: Math.max(setRpm, omega / RPM), scan: scanTarget, axis: null };
  });
  stage.on("move", (p) => {
    if (!gesture || !p.down) return;
    const dx = p.x - gesture.x;
    const dy = p.y - gesture.y;
    if (!gesture.axis && Math.hypot(dx, dy) > 8) gesture.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
    if (gesture.axis === "y") setRpm = clamp(gesture.rpm - dy / PX_PER_RPM, 0, MAX);
    if (gesture.axis === "x") scanTarget = gesture.scan + (dx / Math.max(200, stage.width)) * Math.PI;
    stage.canvas.style.cursor = gesture.axis === "x" ? "ew-resize" : "ns-resize";
  });
  stage.on("up", () => {
    gesture = null;
    release();
    stage.canvas.style.cursor = "ns-resize";
  });
  let wheelTimer = 0;
  let wheelRpm = null;
  const onWheel = (e) => {
    e.preventDefault();
    wake();
    if (wheelRpm == null) wheelRpm = Math.max(setRpm, omega / RPM);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    wheelRpm = clamp(wheelRpm - dy / PX_PER_RPM / 2, 0, MAX);
    setRpm = wheelRpm;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelRpm = null;
      if (!gesture) release();
    }, 260);
  };
  host.addEventListener("wheel", onWheel, { passive: false });

  // ---- clock
  layout();
  if (holding) {
    frameIndex = Math.floor(stillT * FPS + 1e-6);
    capture(stillT, true);
  } else {
    // Start with a full history at the resting speed.
    for (let j = 0; j < 4096; j++) ring[(step - j) & 4095] = theta - omega * j * H;
  }
  const SPAN = Math.ceil((READOUT + expo) / H) + 2;
  stage.onFrame((dt) => {
    // The phone turns with a little weight.
    scan += (scanTarget - scan) * (1 - Math.exp(-dt * 14));
    if (holding) return;
    const end = simT + dt;
    while (simT + H <= end) {
      simT += H;
      physics();
    }
    // Develop every frame whose readout (and its last row's exposure) is done.
    const t0Step = Math.floor(frameIndex / FPS / H);
    if (step >= t0Step + SPAN) {
      // Skip frames lost to a stall; a sensor does not catch up.
      const latest = Math.floor((step - SPAN) * H * FPS);
      frameIndex = Math.max(frameIndex, latest);
      capture(frameIndex / FPS, false);
      frameIndex += 1;
    }
  });

  return {
    destroy() {
      clearTimeout(wheelTimer);
      host.removeEventListener("wheel", onWheel);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
