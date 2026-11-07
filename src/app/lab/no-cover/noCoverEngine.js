import { createStage, clamp, damp } from "../_kit/stage";
import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./noCoverTakes";

// After Christian Marclay, Record Without a Cover (1985): a record sold with
// no sleeve, so the marks of handling become part of what it plays.
//
// The record is drawn in one full-screen pass, analytically, at the true
// proportions of a 12-inch LP (302 mm across, 100 mm label, grooves from
// 146 mm in to 60 mm). The grooves are far finer than a pixel, so they are
// not drawn as lines: they are a tangent field. Each point of vinyl reflects
// light along the groove's circle (Kajiya-Kay), so the record lights up only
// where the groove runs across the half vector: a narrow fan through the
// centre that points at the light and turns with it. Band gaps between
// tracks are smooth vinyl and break the fan into rings. The pressing is a
// hair off centre and a little warped, so the fan sways once a turn.
//
// Scratches live in a texture fixed to the record: coverage, and the
// direction of the cut (as a doubled angle, so a line has no head or tail).
// A cut lights where it runs across the half vector, like a groove of its
// own. Each cut also leaves its angle in a ring of bins; spinning sweeps the
// stylus through the bins, and every bin with damage in it ticks or pops.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uC; uniform float uR;
uniform float uA; uniform float uBlur; uniform vec3 uL; uniform vec2 uEcc;
uniform sampler2D uScr; uniform sampler2D uLab;
out vec4 o;

const float LABEL = 0.331;   // 50 / 151
const float HOLE = 0.0238;   // 3.6 / 151
const float G_OUT = 0.966;   // first groove
const float G_IN = 0.40;     // last music groove

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Where each track ends: a smooth band a millimetre wide.
float gaps(float r, float aa){
  float g = 0.0;
  g += 1.0 - smoothstep(0.0035, 0.0035 + aa, abs(r - 0.872));
  g += 1.0 - smoothstep(0.0030, 0.0030 + aa, abs(r - 0.771));
  g += 1.0 - smoothstep(0.0040, 0.0040 + aa, abs(r - 0.668));
  g += 1.0 - smoothstep(0.0030, 0.0030 + aa, abs(r - 0.583));
  g += 1.0 - smoothstep(0.0035, 0.0035 + aa, abs(r - 0.489));
  return clamp(g, 0.0, 1.0);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr; // css px, y down
  vec2 q = (px - uC) / uR;
  float r = length(q);
  float aa = 1.0 / (uR * uDpr);
  vec2 Lxy = normalize(uL.xy);

  // The table: warm white, with the record's shadow on it. A tight contact
  // line where the edge sits, and a soft penumbra thrown away from the light.
  vec3 ground = pow(vec3(0.949, 0.941, 0.922), vec3(2.2));
  float dC = length(q + Lxy * 0.004) - 1.0;
  float dS = length(q + Lxy * 0.045) - 1.0;
  float contact = 1.0 - smoothstep(-0.004, 0.022, dC);
  float soft = 1.0 - smoothstep(-0.10, 0.20, dS);
  vec3 table = ground * (1.0 - 0.5 * contact) * (1.0 - 0.16 * soft);

  float disc = smoothstep(1.0 + aa * 0.6, 1.0 - aa * 0.6, r);
  float hole = 1.0 - smoothstep(HOLE - aa * 0.6, HOLE + aa * 0.6, r);

  vec3 col = table;
  if (disc > 0.0) {
    vec3 V = normalize(vec3(-q, 5.0));
    vec3 H = normalize(uL + V);
    float theta = atan(q.y, q.x);

    // Warp: the record is not quite flat, so the half vector it sees tips a
    // little, twice a turn, carried round with the record.
    float thL = theta - uA;
    vec2 tilt = rot(vec2(cos(2.0 * thL), sin(2.0 * thL)) * 0.010 * r, uA);
    vec2 Hxy = H.xy + tilt;

    // Grooves and scratches are sampled along a short arc behind the record
    // while it spins: the shutter's worth of motion.
    float sheen = 0.0, scr = 0.0, cov = 0.0, ampAvg = 0.0;
    const int N = 12;
    float jit = hash(gl_FragCoord.xy * 0.71) - 0.5;
    int n = uBlur > 0.002 ? N : 1;
    for (int i = 0; i < N; i++) {
      if (i >= n) break;
      float a = uA - uBlur * ((float(i) + 0.5 + jit) / float(N) - 0.5);
      vec2 l = rot(q, -a);                      // record-local
      vec2 lg = l - uEcc;                       // groove centre is off by a hair
      float rg = length(lg);
      float tl = atan(lg.y, lg.x);
      // How hard the music drives the groove changes along the spiral: the
      // sheen is mottled by it, and the mottling is what streams.
      vec2 ring = vec2(cos(tl), sin(tl));
      float amp = 0.62 + 0.55 * noise(vec2(rg * 110.0, 0.0) + ring * 3.2) * noise(vec2(rg * 31.0, 7.0) + ring * 1.6);
      ampAvg += amp;
      vec4 s = texture(uScr, l * 0.5 + 0.5);
      float c = s.r;
      float ang = 0.5 * atan(s.b * 2.0 - 1.0, s.g * 2.0 - 1.0) + a;
      float tS = dot(vec2(cos(ang), sin(ang)), Hxy);
      scr += c * (0.06 + 1.1 * exp(-pow(tS / 0.06, 2.0)) + 0.12 * exp(-pow(tS / 0.2, 2.0)));
      cov += c;
    }
    float fn = float(n);
    scr /= fn; cov /= fn; ampAvg /= fn;

    vec2 gc = rot(uEcc, uA);
    vec2 d = q - gc;
    float rg = length(d);
    vec2 T = vec2(-d.y, d.x) / max(rg, 1e-4);
    float tH = dot(T, Hxy);

    // Fine striations in the groove field: the land between turns catches
    // the light unevenly, ring by ring.
    float stri = 0.72 + 0.28 * n1(rg * 900.0) * (0.6 + 0.4 * n1(rg * 260.0 + 3.0));

    float grooved = smoothstep(G_IN - aa, G_IN + aa, rg) * (1.0 - smoothstep(G_OUT - aa, G_OUT + aa, rg));
    grooved *= 1.0 - gaps(rg, aa);
    // The run-out: a few turns of lead-out spiral on smooth vinyl, and the
    // locked groove at the end.
    float runout = 0.0;
    for (int k = 0; k < 4; k++) {
      float rr = G_IN - 0.012 - float(k) * 0.011;
      runout += 1.0 - smoothstep(0.0012, 0.0012 + aa, abs(rg - rr));
    }
    runout += 1.0 - smoothstep(0.0012, 0.0012 + aa, abs(rg - 0.352));

    float fan = 0.8 * exp(-pow(tH / 0.026, 2.0)) + 0.13 * exp(-pow(tH / 0.085, 2.0)) + 0.012 * exp(-pow(tH / 0.3, 2.0));
    sheen = fan * (grooved * stri * ampAvg + runout * 0.8) * (1.0 - 0.85 * clamp(cov, 0.0, 1.0));

    // Black vinyl: almost no diffuse, a faint coherent reflection of the
    // room where it is smooth, a little more scatter where it is grooved.
    float flat_ = 1.0 - grooved;
    float roomRefl = 0.0015 + 0.006 * smoothstep(-0.6, 1.0, dot(q, Lxy));
    vec3 vinyl = vec3(0.0042) + vec3(0.0022) * grooved + vec3(roomRefl) * flat_;
    vinyl += vec3(1.0, 0.985, 0.96) * sheen * 0.95;
    vinyl += vec3(0.95, 0.94, 0.92) * scr * 0.75;

    // The rim: a raised bead and a rounded edge that catch the light on its
    // side and go dark on the other.
    float facing = dot(q / max(r, 1e-4), Lxy);
    float bead = exp(-pow((r - 0.983) / 0.006, 2.0));
    vinyl += vec3(0.16) * bead * pow(max(0.0, facing), 6.0);
    vinyl += vec3(0.02) * bead * pow(max(0.0, -facing), 4.0);
    float edge = smoothstep(1.0 - 3.0 * aa, 1.0 - 0.6 * aa, r) * (1.0 - smoothstep(1.0 - 0.6 * aa, 1.0, r));
    vinyl += vec3(0.32) * edge * pow(max(0.0, facing), 2.0);

    // The label: plain paper, matte, a step proud of the vinyl.
    float lab = 1.0 - smoothstep(LABEL - aa * 0.6, LABEL + aa * 0.6, r);
    if (lab > 0.0) {
      vec2 l = rot(q, -uA);
      vec3 paper = pow(texture(uLab, l / LABEL * 0.5 + 0.5).rgb, vec3(2.2));
      float light = 0.86 + 0.06 * dot(q, Lxy) / LABEL * 0.3;
      vec3 labc = paper * light;
      // The edge of the paper: a hairline of shadow away from the light.
      float rim = exp(-pow((r - (LABEL - 0.002)) / 0.003, 2.0));
      labc *= 1.0 - 0.35 * rim * max(0.0, -facing);
      vinyl = mix(vinyl, labc, lab);
    }

    vec3 through = ground * 0.7;
    vinyl = mix(vinyl, through, hole);
    col = mix(table, vinyl, disc);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy * 0.37 + 0.5) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const TAU = Math.PI * 2;
const RPM = 100 / 3;
const OMEGA = (RPM / 60) * TAU; // rad/s at 33 1/3
const SCR = 1024; // scratch texture, the whole record across
const LABEL = 0.331;
const BINS = 720;

// A deterministic generator for the seeded stills.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function drawLabel(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;
  g.fillStyle = "#ebe7dd";
  g.fillRect(0, 0, size, size);
  // Paper: a faint tooth.
  const img = g.getImageData(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (r() - 0.5) * 5;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  const css = getComputedStyle(document.body);
  const sans = css.getPropertyValue("--font-sans").trim() || css.fontFamily;
  try {
    await document.fonts.ready;
  } catch {}
  g.fillStyle = "#2b2926";
  g.strokeStyle = "rgba(43,41,38,0.85)";
  g.lineWidth = size * 0.0028;
  g.beginPath();
  g.arc(mid, mid, size * 0.455, 0, TAU);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `560 ${Math.round(size * 0.052)}px ${sans}`;
  g.fillText("A", mid, size * 0.27);
  return c;
}

export async function createNoCover(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const prog = program(gl, VS, FS);
  const U = {};
  for (const n of ["uRes", "uDpr", "uC", "uR", "uA", "uBlur", "uL", "uEcc", "uScr", "uLab"]) U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeTex = (src) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // Scratches, in record space: R coverage, GB the cut's doubled angle.
  const scrCanvas = document.createElement("canvas");
  scrCanvas.width = scrCanvas.height = SCR;
  const sg = scrCanvas.getContext("2d", { willReadFrequently: false });
  sg.fillStyle = "#000";
  sg.fillRect(0, 0, SCR, SCR);
  sg.lineCap = "round";
  const scrTex = makeTex(scrCanvas);
  let scrDirty = false;

  const labTex = makeTex(await drawLabel(512));

  // Damage by angle on the record, for the stylus to find.
  const bins = new Float32Array(BINS);

  // --- sound
  const sound = createSound({ level: -5, room: 0.06 });
  const tickBank = sound.bank(takes.tick.render, takes.tick);
  const popBank = sound.bank(takes.pop.render, takes.pop);
  const surfBank = sound.bank(takes.surface.render, takes.surface);
  let surf = null;
  let woke = false;

  // --- state
  let angle = 0.6; // record angle, clockwise on screen
  let omega = 0;
  let lightAz = -2.2; // toward upper left
  let lightTarget = lightAz;
  let mode = "idle"; // idle | pending | scratch | hold
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let stroke = null;
  let total = 0; // how much damage there is, for the bed
  let C = [0, 0];
  let R = 100;

  const toLocal = (x, y) => {
    const qx = (x - C[0]) / R;
    const qy = (y - C[1]) / R;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    return [c * qx - s * qy, s * qx + c * qy];
  };

  // One cut: a few hairlines side by side, from the grit that made it, each
  // with its own depth, wavering a little.
  const newStroke = (rand = Math.random) => {
    const lines = [];
    const k = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < k; i += 1) lines.push({ off: (i === 0 ? 0 : (rand() - 0.5) * 7), depth: i === 0 ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.45, w: 0.75 + rand() * 0.55 });
    return { lines, last: null, len: 0, rand };
  };

  const cut = (st, lx, ly) => {
    const r = Math.hypot(lx, ly);
    const onVinyl = r > LABEL + 0.006 && r < 0.992;
    if (!onVinyl) {
      st.last = null;
      return;
    }
    const p = [(lx * 0.5 + 0.5) * SCR, (ly * 0.5 + 0.5) * SCR];
    if (!st.last) {
      st.last = p;
      return;
    }
    const dx = p[0] - st.last[0];
    const dy = p[1] - st.last[1];
    const len = Math.hypot(dx, dy);
    if (len < 1.5) return;
    const ux = dx / len;
    const uy = dy / len;
    const a2 = 2 * Math.atan2(dy, dx);
    const g = Math.round((0.5 + 0.5 * Math.cos(a2)) * 255);
    const b = Math.round((0.5 + 0.5 * Math.sin(a2)) * 255);
    const ramp = Math.min(1, (st.len + len) / 26); // a cut starts light
    for (const line of st.lines) {
      const ox = -uy * line.off;
      const oy = ux * line.off;
      const cov = Math.round(255 * line.depth * ramp);
      sg.strokeStyle = `rgb(${cov},${g},${b})`;
      sg.lineWidth = line.w;
      sg.beginPath();
      sg.moveTo(st.last[0] + ox, st.last[1] + oy);
      sg.lineTo(p[0] + ox + (st.rand() - 0.5) * 0.5, p[1] + oy + (st.rand() - 0.5) * 0.5);
      sg.stroke();
    }
    // Into the bins, by the angle of the middle of the segment.
    const mx = (st.last[0] + p[0]) / SCR - 1;
    const my = (st.last[1] + p[1]) / SCR - 1;
    let th = Math.atan2(my, mx);
    if (th < 0) th += TAU;
    const bi = Math.floor((th / TAU) * BINS) % BINS;
    bins[bi] = Math.min(2, bins[bi] + len * 0.035 * st.lines[0].depth);
    total += len;
    st.len += len;
    st.last = p;
    scrDirty = true;
  };

  // A seeded handful of cuts, for stills and for the tile.
  const seed = () => {
    const rand = rng(1985);
    for (let k = 0; k < 9; k += 1) {
      const st = newStroke(rand);
      const a0 = rand() * TAU;
      const r0 = 0.42 + rand() * 0.5;
      const dir = a0 + (rand() - 0.5) * 2.4 + Math.PI / 2 * (rand() < 0.5 ? 1 : 0);
      const L = 0.12 + rand() * 0.35;
      const bend = (rand() - 0.5) * 0.8;
      let x = Math.cos(a0) * r0;
      let y = Math.sin(a0) * r0;
      let d = dir;
      for (let i = 0; i <= 40; i += 1) {
        cut(st, x, y);
        x += Math.cos(d) * (L / 40);
        y += Math.sin(d) * (L / 40);
        d += bend / 40;
      }
    }
  };
  if (still != null || embedded) seed();

  // --- input
  const onRecord = (x, y) => Math.hypot(x - C[0], y - C[1]) < R;

  stage.on("down", (p) => {
    if (!woke) {
      woke = true;
      sound.unlock();
    } else sound.unlock();
    mode = "pending";
    downAt = performance.now();
    downX = p.x;
    downY = p.y;
    stroke = newStroke();
    if (onRecord(p.x, p.y)) cut(stroke, ...toLocal(p.x, p.y));
  });
  stage.on("move", (p) => {
    if (!p.down) {
      // The light leans toward the pointer, so the fan turns to meet it.
      if (onRecord(p.x, p.y) || Math.hypot(p.x - C[0], p.y - C[1]) < R * 2.2) lightTarget = Math.atan2(p.y - C[1], p.x - C[0]);
      return;
    }
    if (mode === "pending" && Math.hypot(p.x - downX, p.y - downY) > 4) mode = "scratch";
    if (mode === "scratch" || mode === "hold") cut(stroke, ...toLocal(p.x, p.y));
  });
  stage.on("up", () => {
    mode = "idle";
    stroke = null;
  });

  // --- sound per frame
  const ensureSurf = () => {
    if (surf || !sound.live) return;
    surf = sound.loop(surfBank);
  };
  let lastRel = null;
  const listen = (dt) => {
    const speed = omega / OMEGA;
    if (speed > 0.02) ensureSurf();
    if (surf && sound.ctx) {
      const t = sound.ctx.currentTime;
      const bed = clamp(speed, 0, 1.2) * (0.5 + Math.min(0.5, total / 12000));
      surf.gain.setTargetAtTime(db(-24) * bed, t, 0.05);
      surf.rate.setTargetAtTime(Math.max(0.001, speed), t, 0.05);
    }
    // The stylus sits where the fan points at the light. Sweep it through
    // the bins this frame covered, in record space.
    let rel = (lightAz - angle) % TAU;
    if (rel < 0) rel += TAU;
    if (lastRel == null || speed < 0.05 || !sound.live) {
      lastRel = rel;
      return;
    }
    let sweep = lastRel - rel; // the record turns clockwise, so rel falls
    if (sweep < 0) sweep += TAU;
    if (sweep > Math.PI) {
      lastRel = rel;
      return;
    }
    const b0 = (lastRel / TAU) * BINS;
    const nb = (sweep / TAU) * BINS;
    let hits = 0;
    for (let i = 0; i < Math.ceil(nb) && hits < 6; i += 1) {
      const bi = ((Math.floor(b0 - i) % BINS) + BINS) % BINS;
      const s = bins[bi];
      if (s < 0.02) continue;
      hits += 1;
      const at = (i / Math.max(1, nb)) * dt;
      const rate = 0.55 + 0.45 * Math.min(1.1, speed);
      const level = 20 * Math.log10(Math.min(1, s)) - 6 + 12 * Math.log10(Math.max(0.05, speed));
      if (s > 0.6 && Math.random() < 0.7) sound.play(popBank, { gain: level - 2, rate, at, pan: 0.15 });
      else sound.play(tickBank, { gain: level, rate: rate * (0.9 + Math.random() * 0.2), at, pan: 0.15 });
    }
    lastRel = rel;
  };

  stage.onResize((w, h) => {
    C = [w / 2, h / 2];
    // The object is small: a third of the short side, room on every side.
    R = Math.round(Math.min(w, h) * (embedded ? 0.32 : 0.24));
  });

  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    const now = performance.now();
    if (mode === "pending" && now - downAt > 170) mode = "hold";

    // Torque up while held, coast down when let go.
    const target = mode === "hold" ? OMEGA : 0;
    omega = damp(omega, target, target > omega ? 1.9 : 0.75, dt);
    if (omega < 0.002 && target === 0) omega = 0;
    let blur = omega / 60; // a 1/60 s shutter
    if (still != null) {
      omega = OMEGA * still;
      blur = (OMEGA * still) / 60;
    }
    angle += omega * dt;

    // Light: follows a hovering pointer, drifts slowly back when left alone.
    let dl = lightTarget - lightAz;
    dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    lightAz = damp(lightAz, lightAz + dl, 3.2, dt);
    if (!stage.pointer.down && stage.idleFor() > 5000) lightTarget += dt * 0.05;

    listen(dt);

    if (scrDirty) {
      gl.bindTexture(gl.TEXTURE_2D, scrTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scrCanvas);
      scrDirty = false;
    }

    const el = 0.92; // ~53 degrees up
    const L = [Math.cos(lightAz) * Math.cos(el), Math.sin(lightAz) * Math.cos(el), Math.sin(el)];

    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uDpr, stage.dpr);
    gl.uniform2f(U.uC, C[0], C[1]);
    gl.uniform1f(U.uR, R);
    gl.uniform1f(U.uA, angle);
    gl.uniform1f(U.uBlur, blur);
    gl.uniform3f(U.uL, L[0], L[1], L[2]);
    gl.uniform2f(U.uEcc, 0.0035, -0.002);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scrTex);
    gl.uniform1i(U.uScr, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, labTex);
    gl.uniform1i(U.uLab, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return {
    destroy() {
      surf?.stop();
      sound.destroy();
      stage.destroy();
    },
  };
}
