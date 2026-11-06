import { createStage, clamp } from "../_kit/stage";

// A row of number drums with an album title printed around them. Each letter
// is its own wheel: a real cylinder seen through a window, so a letter's
// height on screen is R·sin(angle) and it foreshortens and falls out of the
// light as it rolls over the top or under the bottom. The fragment shader
// works backwards from every pixel: screen y → angle on the cylinder → arc
// position on the wheel → which title's letter is printed there.

const TITLES = ["HORSES", "BLONDE", "HEROES", "CLOSER", "PARADE", "VOODOO"];
const K = 6; // wheels
const N = TITLES.length;

const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const INK = [0.055, 0.05, 0.045];

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;          // device px
uniform vec4 uFrame;        // x0, y0, cellW, bandH (device px)
uniform vec2 uGrid;         // cols, rows
uniform float uRowGap;      // device px
uniform float uTheta;       // window half-angle
uniform float uAlpha;       // letter half-angle
uniform float uSlot;        // angle between titles on a wheel
uniform float uPhi[${K}];   // wheel positions, in titles
uniform int uGlyph[${K * N}];
uniform vec2 uAtlas;        // atlas cols, rows
uniform vec2 uInset;        // glyph pad inside an atlas cell, uv
uniform sampler2D uTex;
uniform vec3 uPaper; uniform vec3 uInk;
out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = p - uFrame.xy;
  float pitch = uFrame.w + uRowGap;
  float row = floor(q.y / pitch);
  float col = floor(q.x / uFrame.z);
  float ly = q.y - row * pitch;
  vec3 c = uPaper;
  if (row >= 0.0 && row < uGrid.y && col >= 0.0 && col < uGrid.x && ly <= uFrame.w) {
    int w = int(row * uGrid.x + col);
    // Screen y on the band → angle on the cylinder.
    float yn = (ly / uFrame.w) * 2.0 - 1.0;
    float th = asin(clamp(yn * sin(uTheta), -1.0, 1.0));
    float u = uPhi[w] + th / uSlot;
    float k = floor(u + 0.5);
    float a = (u - k) * uSlot;
    float t = mod(k, ${N}.0);
    int g = uGlyph[int(t) * ${K} + w];
    float lx = (q.x - col * uFrame.z) / uFrame.z;
    float ink = 0.0;
    if (abs(a) < uAlpha && g >= 0) {
      vec2 cell = vec2(float(g % int(uAtlas.x)), float(g / int(uAtlas.x)));
      vec2 inner = vec2(lx, a / (2.0 * uAlpha) + 0.5);
      vec2 uv = (cell + uInset + inner * (1.0 - 2.0 * uInset)) / uAtlas;
      // Explicit gradients: the column and slot boundaries are discontinuous,
      // and implicit derivatives there would pull in a coarse mip (and the
      // neighbouring glyph) as a hairline down every seam.
      float sy = yn * sin(uTheta);
      float dth = (2.0 / uFrame.w) * sin(uTheta) / sqrt(max(1e-4, 1.0 - sy * sy));
      vec2 gx = vec2((1.0 - 2.0 * uInset.x) / (uFrame.z * uAtlas.x), 0.0);
      vec2 gy = vec2(0.0, dth / (2.0 * uAlpha) * (1.0 - 2.0 * uInset.y) / uAtlas.y);
      ink = textureGrad(uTex, uv, gx, gy).r;
    }
    // Light from the front: the drum's face falls off as cos(angle), and
    // the paper and the ink both lose it toward the rims.
    float lit = cos(th);
    float edge = clamp((1.0 - lit) / (1.0 - cos(uTheta)), 0.0, 1.0);
    float shade = 1.0 - 0.17 * pow(edge, 1.6);
    vec3 paper = uPaper * shade;
    // A hairline where one wheel meets the next, deeper in the shadow.
    float px = min(lx, 1.0 - lx) * uFrame.z;
    float seam = 1.0 - smoothstep(0.0, 1.6, px);
    paper *= 1.0 - seam * (0.05 + 0.08 * edge);
    c = mix(paper, uInk * mix(1.0, 0.6, edge), ink);
  }
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// Detent: the drag is sticky around each title, as if a pawl rides in a notch.
const notch = (x) => x - (Math.sin(2 * Math.PI * x) / (2 * Math.PI)) * 0.78;

export async function createDrum(host, { embedded = false, family = "sans-serif" } = {}) {
  const fontName = family.split(",")[0].trim();
  try {
    await document.fonts.load(`400 200px ${fontName}`, "HORSEBLNDCVPA");
  } catch {}

  const stage = createStage(host, { dpr: 2, webgl: true });
  const gl = stage.ctx;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const n of ["uRes", "uFrame", "uGrid", "uRowGap", "uTheta", "uAlpha", "uSlot", "uPhi", "uGlyph", "uAtlas", "uInset", "uTex", "uPaper", "uInk"])
    U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();

  const letters = [...new Set(TITLES.join(""))];
  const glyphOf = new Int32Array(K * N);
  TITLES.forEach((t, i) => [...t].forEach((ch, w) => (glyphOf[i * K + w] = letters.indexOf(ch))));

  // Geometry, rebuilt on resize.
  const THETA = 0.96; // the window shows ±55° of each drum
  const ALPHA = 0.88; // a letter covers ±50°
  const SLOT = THETA + ALPHA + 0.05;
  let geo = null;

  const mc = document.createElement("canvas").getContext("2d");
  mc.font = `400 1000px ${family}`;
  const capRatio = mc.measureText("H").actualBoundingBoxAscent / 1000;
  const widthOf = (ch) => {
    const m = mc.measureText(ch);
    return (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 1000 / capRatio; // in cap heights
  };
  const maxW = Math.max(...letters.map(widthOf));

  const build = (W, H, dpr) => {
    const pad = Math.round(Math.min(W, H) * 0.035);
    const gapY = Math.round(Math.min(W, H) * 0.03);
    // Rows of wheels: pick the split whose letters come closest to Druk's
    // narrow proportions without the face being squeezed past recognition.
    let best = null;
    for (const r of [1, 2, 3]) {
      const c = K / r;
      const cellW = (W - 2 * pad) / c;
      const bandH = (H - 2 * pad - (r - 1) * gapY) / r;
      const R = bandH / 2 / Math.sin(THETA);
      const cap = 2 * R * Math.sin(ALPHA) * 0.97;
      const s = (cellW * 0.9) / (cap * maxW);
      const score = Math.abs(Math.log(Math.min(s, 1.15) / 0.62)) + (s > 1 ? 1 : 0);
      if (!best || score < best.score) best = { r, c, cellW, bandH, R, s: Math.min(s, 1), score };
    }
    const { r, c, cellW, bandH, R } = best;
    const s = best.s;
    // Glyph texture: arc length of a letter, so 1:1 at the drum's front.
    const gw = Math.round(cellW * dpr);
    const gh = Math.round(2 * ALPHA * R * dpr);
    const capPx = 2 * R * Math.sin(ALPHA) * dpr * 0.97;
    const fontPx = capPx / capRatio;
    // Compressing a face thins its stems more than its bars: restore some of
    // the vertical stroke by dilating sideways.
    const stem = 0.15 * capPx;
    const dil = Math.max(0, (stem * (Math.sqrt(s) - s)) / 2);
    const inset = 6;
    const cw = gw + inset * 2;
    const ch = gh + inset * 2;
    const ac = Math.ceil(Math.sqrt(letters.length * (ch / cw)));
    const ar = Math.ceil(letters.length / ac);
    const cv = document.createElement("canvas");
    cv.width = cw * ac;
    cv.height = ch * ar;
    const x = cv.getContext("2d");
    x.fillStyle = "#000";
    x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = "#fff";
    x.font = `400 ${fontPx}px ${family}`;
    x.textAlign = "center";
    x.textBaseline = "alphabetic";
    letters.forEach((L, i) => {
      const ox = (i % ac) * cw + inset;
      const oy = Math.floor(i / ac) * ch + inset;
      const m = x.measureText(L);
      const mid = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
      const base = oy + gh / 2 + capPx / 2;
      for (let d = -dil; d <= dil + 1e-3; d += 0.5) {
        x.save();
        x.translate(ox + gw / 2 + d, base);
        x.scale(s, 1);
        x.fillText(L, mid, 0);
        x.restore();
      }
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const x0 = (W - c * cellW) / 2;
    const y0 = (H - r * bandH - (r - 1) * gapY) / 2;
    geo = { r, c, cellW, bandH, R, gapY, x0, y0, ac, ar, insetU: inset / cw, insetV: inset / ch, dpr };
  };
  stage.onResize(build);

  // Motion. `target` is where the mechanism is being driven; each wheel reads
  // it a beat later than the wheel before and follows on a stiff spring.
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? parseFloat(params.get("t")) : null;
  let target = params.has("n") ? parseInt(params.get("n"), 10) || 0 : 0;
  const hist = [[0, target]];
  const wheels = Array.from({ length: K }, () => ({ x: target, v: 0 }));
  const DELAY = 0.045;
  let now = 0;
  let drag = null;
  let lastStep = 0;
  const push = () => {
    hist.push([now, target]);
    while (hist.length > 2 && hist[1][0] < now - 1) hist.shift();
  };
  const at = (t) => {
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1];
    return hist[0][1];
  };
  const step = (dir) => {
    target = Math.round(target) + dir;
    lastStep = now;
    push();
  };
  // Geared down from the surface (R·slot, more than a band tall) so one
  // comfortable thumb swipe turns one title.
  const slotPx = () => (geo ? geo.bandH * 0.62 : 200);

  stage.on("down", (p) => {
    drag = { y: p.y, from: wheels[0].x, raw: wheels[0].x };
  });
  stage.on("move", (p) => {
    if (!drag || !p.down) return;
    drag.raw = drag.from - (p.y - drag.y) / slotPx();
    target = Math.floor(drag.raw) + notch(drag.raw - Math.floor(drag.raw));
    push();
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // A pawl, not a rounding: a third of a title past the notch commits to
    // the next one, and a flick carries on up to two more.
    const start = Math.round(drag.from);
    const moved = drag.raw - start;
    const fling = moved - (p.vy / slotPx()) * 0.12;
    const n = Math.sign(fling) * Math.floor(Math.abs(fling) + 0.67);
    target = start + clamp(n, -3, 3);
    drag = null;
    lastStep = now;
    push();
  });
  const onKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") step(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
    stage.pointer.lastInput = performance.now();
  };
  let wheelAcc = 0;
  const onWheel = (e) => {
    e.preventDefault();
    stage.pointer.lastInput = performance.now();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40 && now - lastStep > 0.22) {
      step(Math.sign(wheelAcc));
      wheelAcc = 0;
    }
  };
  window.addEventListener("keydown", onKey);
  stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  stage.onFrame((dt) => {
    now += dt;
    if (!geo) return;
    if (still == null && !drag && stage.idleFor() > 5000 && now - lastStep > 3.4) step(1);

    const phi = new Float32Array(K);
    for (let w = 0; w < K; w++) {
      const wh = wheels[w];
      if (still != null) {
        wh.x = clamp(still * 1.7 - w * 0.14, 0, 1);
      } else {
        const goal = at(now - w * DELAY);
        // Heavy and firm: stiff, just under critical, so it lands in the
        // notch with a single small settle rather than a wobble.
        const k = drag ? 900 : 420;
        const z = drag ? 1 : 0.74;
        const sub = 4;
        const h = dt / sub;
        for (let i = 0; i < sub; i++) {
          const a = -k * (wh.x - goal) - 2 * z * Math.sqrt(k) * wh.v;
          wh.v += a * h;
          wh.x += wh.v * h;
        }
      }
      phi[w] = wh.x;
    }

    const W = stage.width;
    const H = stage.height;
    const d = geo.dpr;
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uTex, 0);
    gl.uniform2f(U.uRes, W * d, H * d);
    gl.uniform4f(U.uFrame, geo.x0 * d, geo.y0 * d, geo.cellW * d, geo.bandH * d);
    gl.uniform2f(U.uGrid, geo.c, geo.r);
    gl.uniform1f(U.uRowGap, geo.gapY * d);
    gl.uniform1f(U.uTheta, THETA);
    gl.uniform1f(U.uAlpha, ALPHA);
    gl.uniform1f(U.uSlot, SLOT);
    gl.uniform1fv(U.uPhi, phi);
    gl.uniform1iv(U.uGlyph, glyphOf);
    gl.uniform2f(U.uAtlas, geo.ac, geo.ar);
    gl.uniform2f(U.uInset, geo.insetU, geo.insetV);
    gl.uniform3fv(U.uPaper, PAPER);
    gl.uniform3fv(U.uInk, INK);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    void embedded;
  });

  return {
    destroy() {
      window.removeEventListener("keydown", onKey);
      stage.destroy();
    },
  };
}
