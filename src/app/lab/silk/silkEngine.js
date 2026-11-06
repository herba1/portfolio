import { createStage, clamp, damp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A silk square on a verlet grid: structural, shear and bend constraints,
// two pinned corners on clips, a breeze, and a hand that can grab any point.
// Rendered in WebGL2 with wrapped diffuse and an anisotropic fibre sheen.

// ?v= picks a factory variant to compare (r1 is the round 1 parent).
const V = typeof location !== "undefined" ? new URLSearchParams(location.search).get("v") ?? "b" : "b";
const CRAFT = V.includes("a") || V.includes("b");
const AIR = V.includes("b");
const N = CRAFT ? 42 : 36; // particles per side
const ITER = 10;
const ORDER = ["abbey-road", "rubber-soul", "sgt-pepper", "revolver", "let-it-be", "help", "magical-mystery-tour"];

const VERT = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv; in vec3 aTan;
uniform vec2 uView; uniform float uF; uniform float uD; uniform float uShadow; uniform vec3 uLight;
out vec3 vNor; out vec2 vUv; out vec3 vTan; out vec3 vPos;
void main(){
  vec3 p = aPos;
  if (uShadow > 0.5) {
    // Project onto the wall behind (z = -wall) along the light.
    float wall = 260.0;
    float t = (p.z + wall) / max(0.2, -uLight.z);
    p = p + uLight * t;
    p.z = -wall;
  }
  float s = uF / (uD - p.z);
  vec2 sp = p.xy * s;
  gl_Position = vec4(sp.x / uView.x * 2.0, -sp.y / uView.y * 2.0, 0.5 - p.z * 0.0005, 1.0);
  vNor = aNor; vUv = aUv; vTan = aTan; vPos = aPos;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNor; in vec2 vUv; in vec3 vTan; in vec3 vPos;
uniform sampler2D uTex; uniform float uShadow; uniform vec3 uLight; uniform float uD; uniform float uFade;
out vec4 o;
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  if (uShadow > 0.5) { o = vec4(0.0, 0.0, 0.0, 0.22 * uFade); return; }
  vec3 n = normalize(vNor);
  vec3 v = normalize(vec3(0.0, 0.0, uD) - vPos);
  bool back = dot(n, v) < 0.0;
  if (back) n = -n;
  vec3 l = normalize(-uLight);
  vec3 h = normalize(l + v);
  vec3 base = toLin(texture(uTex, vUv).rgb);
  // Print shows through the back of silk, paler.
  if (back) base = mix(base, vec3(0.78, 0.74, 0.68), 0.45);
  float ndl = dot(n, l);
  float wrap = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  vec3 t = normalize(vTan - n * dot(vTan, n));
  float th = dot(t, h);
  float aniso = pow(sqrt(max(0.0, 1.0 - th * th)), 90.0);
  vec3 b = normalize(cross(n, t));
  float bh = dot(b, h);
  float aniso2 = pow(sqrt(max(0.0, 1.0 - bh * bh)), 140.0);
  float rim = pow(1.0 - abs(dot(n, v)), 3.0);
  vec3 col = base * (0.10 + 0.95 * wrap);
  vec3 sheenTint = mix(vec3(1.0), base * 1.6 + 0.2, 0.5);
  col += sheenTint * (aniso * 0.38 + aniso2 * 0.22) * smoothstep(-0.2, 0.4, ndl);
  col += base * rim * 0.35;
  // Cavity: folds turned away from the light darken further.
  col *= mix(0.55, 1.0, smoothstep(-0.6, 0.3, ndl));
  col = col / (1.0 + col * 0.35);
  o = vec4(pow(col, vec3(1.0 / 2.2)), uFade);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export async function createSilk(host, { embedded = false } = {}) {
  const stage = createStage(host, { webgl: true, dpr: 1.5, alpha: CRAFT });
  if (CRAFT) host.style.background = "radial-gradient(60% 70% at 50% 38%, #3a3631 0%, #1b1916 55%, #0e0d0c 100%)";
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const overlay = document.createElement("canvas");
  overlay.className = "kit-canvas";
  overlay.style.pointerEvents = "none";
  host.appendChild(overlay);
  const g2 = overlay.getContext("2d");

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { view: U("uView"), f: U("uF"), d: U("uD"), shadow: U("uShadow"), light: U("uLight"), tex: U("uTex"), fade: U("uFade") };

  const count = N * N;
  const pos = new Float32Array(count * 3);
  const prev = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const tan = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      uv[(j * N + i) * 2] = i / (N - 1);
      uv[(j * N + i) * 2 + 1] = j / (N - 1);
    }
  const idx = [];
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      idx.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
    }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (data, loc, size, usage = gl.DYNAMIC_DRAW) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const l = gl.getAttribLocation(prog, loc);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
    return b;
  };
  const bPos = buf(pos, "aPos", 3);
  const bNor = buf(nor, "aNor", 3);
  const bTan = buf(tan, "aTan", 3);
  buf(uv, "aUv", 2, gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  // Constraints: [a, b, rest]
  const cons = [];
  const add = (a, b, k) => cons.push(a, b, k);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * N + i;
      if (i < N - 1) add(a, a + 1, 1);
      if (j < N - 1) add(a, a + N, 1);
      if (i < N - 1 && j < N - 1) {
        add(a, a + N + 1, Math.SQRT2);
        add(a + 1, a + N, Math.SQRT2);
      }
      if (i < N - 2) add(a, a + 2, 2);
      if (j < N - 2) add(a, a + 2 * N, 2);
    }
  const C = new Float32Array(cons);

  const textures = new Map();
  const texFor = async (id) => {
    if (textures.has(id)) return textures.get(id);
    const img = await loadCover(id);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    textures.set(id, t);
    return t;
  };

  let coverIndex = 0;
  let tex = await texFor(ORDER[0]);
  texFor(ORDER[1]);

  // World: pixels, y down, z toward the viewer. Camera on +z.
  let S = 300; // cloth size
  let spacing = S / (N - 1);
  const D = 1400;
  const F = 1400;
  let pinA = [0, 0, 0];
  let pinB = [0, 0, 0];
  // Each clip holds its corner until pulled free; `drop` slides a new
  // scarf's clips down from above.
  const pins = [
    { i: 0, held: true, at: pinA },
    { i: N - 1, held: true, at: pinB },
  ];
  let hangT = 1;
  let wireY = 0;
  let fade = 1;
  let falling = false;

  const layout = () => {
    S = Math.min(stage.width * 0.46, stage.height * 0.5, 460);
    spacing = S / (N - 1);
    wireY = -S * 0.66;
    pinA = [-S / 2, wireY, 0];
    pinB = [S / 2, wireY, 0];
    pins[0].at = pinA;
    pins[1].at = pinB;
  };

  const hang = (fromAbove) => {
    const lift = fromAbove ? -stage.height * 0.9 : 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 3;
        pos[k] = -S / 2 + i * spacing;
        pos[k + 1] = wireY + j * spacing * 0.98 + lift;
        pos[k + 2] = Math.sin(i * 0.4) * 2;
        prev[k] = pos[k];
        prev[k + 1] = pos[k + 1];
        prev[k + 2] = pos[k + 2];
      }
    pins[0].held = true;
    pins[1].held = true;
    hangT = fromAbove ? 0 : 1;
    fade = 1;
    falling = false;
  };

  stage.onResize((w, h) => {
    overlay.width = Math.round(w * stage.dpr);
    overlay.height = Math.round(h * stage.dpr);
    layout();
    hang(false);
  });

  // The hand: a grabbed particle and its neighbourhood, weighted.
  let grab = null;
  const toScreen = (k) => {
    const s = F / (D - pos[k + 2]);
    return [stage.width / 2 + pos[k] * s, stage.height / 2 + pos[k + 1] * s];
  };
  const pick = (x, y) => {
    let best = -1;
    let bd = 70 * 70;
    for (let p = 0; p < count; p++) {
      const [sx, sy] = toScreen(p * 3);
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  let downAt = 0;
  let downXY = [0, 0];
  stage.on("down", (p) => {
    downAt = performance.now();
    downXY = [p.x, p.y];
    const hit = pick(p.x, p.y);
    if (hit < 0) return;
    const gi = hit % N;
    const gj = Math.floor(hit / N);
    const around = [];
    const R = 3;
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = gi + di;
        const j = gj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const d = Math.hypot(di, dj);
        if (d > R) continue;
        const q = j * N + i;
        around.push({ q, w: Math.pow(1 - d / (R + 1), 2), off: [pos[q * 3] - pos[hit * 3], pos[q * 3 + 1] - pos[hit * 3 + 1], pos[q * 3 + 2] - pos[hit * 3 + 2]] });
      }
    grab = { p: hit, z: pos[hit * 3 + 2], around, taut: 0 };
  });
  stage.on("up", (p) => {
    if (grab && performance.now() - downAt < 220 && Math.hypot(p.x - downXY[0], p.y - downXY[1]) < 6) {
      // A tap flicks the silk away from you at that point.
      for (const a of grab.around) prev[a.q * 3 + 2] += 26 * a.w;
    }
    grab = null;
  });

  const wind = { t: Math.random() * 100 };
  let auto = 0;

  const step = (dt, t) => {
    const sub = 2;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      wind.t += h;
      const g = 1500;
      const breeze = (embedded ? 1 : 0.8) * (Math.sin(wind.t * 0.7) * 0.6 + Math.sin(wind.t * 1.9 + 1) * 0.3 + 0.2);
      for (let p = 0; p < count; p++) {
        const k = p * 3;
        const i = p % N;
        const j = Math.floor(p / N);
        const vx = (pos[k] - prev[k]) * 0.992;
        const vy = (pos[k + 1] - prev[k + 1]) * 0.992;
        const vz = (pos[k + 2] - prev[k + 2]) * 0.992;
        prev[k] = pos[k];
        prev[k + 1] = pos[k + 1];
        prev[k + 2] = pos[k + 2];
        const gust = breeze * (0.6 + 0.4 * Math.sin(i * 0.31 + j * 0.17 + wind.t * 2.3));
        pos[k] += vx + h * h * (gust * 60);
        pos[k + 1] += vy + h * h * g;
        pos[k + 2] += vz + h * h * gust * 140 * (0.5 + 0.5 * Math.sin(j * 0.2 - wind.t * 3));
      }
      // Air: a pointer passing near the silk (not holding it) pushes air.
      if (AIR && !stage.pointer.down && stage.pointer.inside) {
        const sp = Math.hypot(stage.pointer.vx, stage.pointer.vy);
        if (sp > 40) {
          const ax = stage.pointer.vx / sp;
          const ay = stage.pointer.vy / sp;
          const push = Math.min(1, sp / 1600) * h * h * 9000;
          for (let p = 0; p < count; p++) {
            const k = p * 3;
            const [sx, sy] = toScreen(k);
            const d2 = (sx - stage.pointer.x) ** 2 + (sy - stage.pointer.y) ** 2;
            if (d2 > 160 * 160) continue;
            const w = Math.exp(-d2 / (2 * 70 * 70));
            pos[k] += ax * push * w;
            pos[k + 1] += ay * push * w * 0.6;
            pos[k + 2] -= push * w * 1.4;
          }
        }
      }
      // The hand.
      if (grab && stage.pointer.down) {
        const s2 = (D - grab.z) / F;
        const tx = (stage.pointer.x - stage.width / 2) * s2;
        const ty = (stage.pointer.y - stage.height / 2) * s2;
        const tz = grab.z + (CRAFT ? 14 : 40);
        for (const a of grab.around) {
          const k = a.q * 3;
          const w = a.w * 0.9;
          pos[k] += (tx + a.off[0] * 0.6 - pos[k]) * w;
          pos[k + 1] += (ty + a.off[1] * 0.6 - pos[k + 1]) * w;
          pos[k + 2] += (tz + a.off[2] - pos[k + 2]) * w * 0.5;
        }
        // Pulled far past the length of cloth, the nearer clip gives.
        const gk = grab.p * 3;
        for (const pin of pins) {
          if (!pin.held) continue;
          const dist = Math.hypot(pos[gk] - pin.at[0], pos[gk + 1] - pin.at[1], pos[gk + 2] - pin.at[2]);
          const gi = grab.p % N;
          const gj = Math.floor(grab.p / N);
          const rest = Math.hypot(gi - pin.i, gj) * spacing;
          if (dist > rest * 1.55 + 60) grab.taut += h;
        }
        if (grab.taut > 0.22) {
          const held = pins.filter((q) => q.held);
          if (held.length) {
            const gk2 = grab.p * 3;
            held.sort((a, b) => Math.hypot(pos[gk2] - a.at[0], pos[gk2 + 1] - a.at[1]) - Math.hypot(pos[gk2] - b.at[0], pos[gk2 + 1] - b.at[1]));
            held[0].held = false;
            grab.taut = -0.25;
          }
        }
      }
      // Constraints.
      for (let it = 0; it < ITER; it++) {
        for (let c = 0; c < C.length; c += 3) {
          const a = C[c] * 3;
          const b = C[c + 1] * 3;
          const rest = C[c + 2] * spacing;
          const dx = pos[b] - pos[a];
          const dy = pos[b + 1] - pos[a + 1];
          const dz = pos[b + 2] - pos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const stiff = C[c + 2] === 2 ? 0.25 : 1;
          const diff = ((d - rest) / d) * 0.5 * stiff;
          // Silk barely stretches but bends and buckles freely.
          if (C[c + 2] !== 2 || d > rest) {
            pos[a] += dx * diff;
            pos[a + 1] += dy * diff;
            pos[a + 2] += dz * diff;
            pos[b] -= dx * diff;
            pos[b + 1] -= dy * diff;
            pos[b + 2] -= dz * diff;
          } else {
            pos[a] += dx * diff * 0.15;
            pos[a + 1] += dy * diff * 0.15;
            pos[b] -= dx * diff * 0.15;
            pos[b + 1] -= dy * diff * 0.15;
          }
        }
        for (const pin of pins) {
          if (!pin.held) continue;
          const k = pin.i * 3;
          const e = 1 - Math.pow(1 - Math.min(1, hangT), 3);
          const lift = (1 - e) * -stage.height * 0.9;
          pos[k] = pin.at[0];
          pos[k + 1] = pin.at[1] + lift;
          pos[k + 2] = 0;
        }
        // The wall behind.
        for (let p = 0; p < count; p++) if (pos[p * 3 + 2] < -240) pos[p * 3 + 2] = -240;
      }
    }
    if (hangT < 1) hangT = Math.min(1, hangT + dt / 1.1);
    // Off both clips: when it has fallen away, hang the next one.
    if (!pins[0].held && !pins[1].held) {
      let minY = Infinity;
      for (let p = 0; p < count; p++) minY = Math.min(minY, pos[p * 3 + 1]);
      if (!falling) falling = true;
      // Gone past the bottom, or let go of and falling: fade and re-hang.
      if (minY > stage.height * 0.3 || (!grab && minY > -S * 0.2)) {
        fade = damp(fade, 0, 9, dt);
        if (fade < 0.02) next();
      }
    }
    // Idle: the hand comes back to play every so often.
    if (!stage.pointer.down && stage.idleFor() > 6000 && !falling) {
      auto += dt;
      if (auto > 5) {
        auto = 0;
        const p = (Math.floor(N * 0.65) * N + Math.floor(N * (0.3 + Math.random() * 0.4))) * 3;
        prev[p + 2] -= 18;
        prev[p] += (Math.random() - 0.5) * 20;
      }
    }
    void t;
  };

  let swapping = false;
  const next = async () => {
    if (swapping) return;
    swapping = true;
    coverIndex = (coverIndex + 1) % ORDER.length;
    tex = await texFor(ORDER[coverIndex]);
    texFor(ORDER[(coverIndex + 1) % ORDER.length]);
    hang(true);
    swapping = false;
  };

  const normals = () => {
    nor.fill(0);
    for (let j = 0; j < N - 1; j++)
      for (let i = 0; i < N - 1; i++) {
        const a = (j * N + i) * 3;
        const b = a + 3;
        const c = a + N * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const q of [a, b, c, c + 3]) {
          nor[q] += nx;
          nor[q + 1] += ny;
          nor[q + 2] += nz;
        }
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 3;
        const a = (j * N + Math.max(0, i - 1)) * 3;
        const b = (j * N + Math.min(N - 1, i + 1)) * 3;
        tan[k] = pos[b] - pos[a];
        tan[k + 1] = pos[b + 1] - pos[a + 1];
        tan[k + 2] = pos[b + 2] - pos[a + 2];
      }
  };

  const light = [-0.45, 0.55, -0.7];
  const ll = Math.hypot(...light);
  const L = light.map((v) => v / ll);

  const draw = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    gl.viewport(0, 0, W, H);
    if (CRAFT) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(0.105, 0.098, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bNor);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, nor);
    gl.bindBuffer(gl.ARRAY_BUFFER, bTan);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, tan);
    gl.uniform2f(u.view, stage.width, stage.height);
    gl.uniform1f(u.f, F);
    gl.uniform1f(u.d, D);
    gl.uniform3f(u.light, L[0], L[1], L[2]);
    gl.uniform1f(u.fade, fade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.tex, 0);
    // Shadow on the wall first, then the silk.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(u.shadow, 1);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(u.shadow, 0);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);

    // The wire and the clips.
    const d = stage.dpr;
    g2.setTransform(d, 0, 0, d, 0, 0);
    g2.clearRect(0, 0, stage.width, stage.height);
    const s0 = F / D;
    const cy = stage.height / 2 + wireY * s0;
    g2.strokeStyle = "rgba(210, 200, 185, 0.35)";
    g2.lineWidth = 1;
    g2.beginPath();
    g2.moveTo(0, cy - 6);
    g2.lineTo(stage.width, cy - 6);
    g2.stroke();
    const e = 1 - Math.pow(1 - Math.min(1, hangT), 3);
    for (const pin of pins) {
      const x = stage.width / 2 + pin.at[0] * s0;
      const y = cy + (1 - e) * -stage.height * 0.9 * s0;
      g2.save();
      g2.translate(x, Math.min(y, cy) - 6);
      g2.fillStyle = "#1c1b19";
      g2.strokeStyle = "rgba(230, 220, 200, 0.5)";
      g2.beginPath();
      g2.roundRect(-7, -4, 14, 16, 2);
      g2.fill();
      g2.stroke();
      g2.fillStyle = "rgba(240, 232, 215, 0.6)";
      g2.fillRect(-5, -2, 10, 1);
      g2.restore();
    }
  };

  stage.onFrame((dt, t) => {
    step(dt, t);
    normals();
    draw();
  });

  return {
    destroy() {
      overlay.remove();
      stage.destroy();
    },
  };
}
