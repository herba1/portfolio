import { createStage, clamp } from "../_kit/stage";
import { createDetents } from "./detent";

// A row of number drums with an album title printed around them. Each letter
// is its own wheel: a real cylinder seen through a window, so a letter's
// height on screen is R·sin(angle) and it foreshortens and falls out of the
// light as it rolls over the top or under the bottom. The fragment shader
// works backwards from every pixel: screen y → angle on the cylinder → arc
// position on the wheel → which title's letter is printed there.

const TITLES = ["HORSES", "BLONDE", "HEROES", "CLOSER", "PARADE", "VOODOO"];
const K = 6; // wheels
// Heavy, but a step below the face's 900: squeezed to Druk's proportions the
// black closes its counters to hairlines; at 780 they stay open slits.
const WEIGHT = 780;
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
    // Matte print on a matte drum under a broad, soft light a little above
    // the eye: Lambertian, part direct and part fill. The window shows ±72°
    // of the drum, so that one term is the cylinder: the front is all but
    // even, and the surface darkens smoothly, faster and faster, as it turns
    // edge-on toward each lip, a little deeper below than above. No contact
    // shadow and no bar at the lip; the form does it. Ink is printed on that
    // same surface, so it takes the same light; there is no separate
    // darkening of the type.
    const float LIGHT = -0.12; // radians above the axis
    float lam = cos(th - LIGHT) / cos(LIGHT);
    float shade = 1.0 + 0.26 * (lam - 1.0);
    vec3 paper = uPaper * shade;
    // Where one wheel meets the next: a hairline gap, not a groove.
    float px = min(lx, 1.0 - lx) * uFrame.z;
    paper *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 1.4, px));
    c = mix(paper, uInk * shade, ink);
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

// Semi-implicit spring toward `goal`, substepped so the stiff pawl stays stable.
function integrate(wh, goal, k, z, dt) {
  const sub = Math.max(4, Math.ceil(dt * 960));
  const h = dt / sub;
  const c = 2 * z * Math.sqrt(k);
  for (let i = 0; i < sub; i++) {
    wh.v += (-k * (wh.x - goal) - c * wh.v) * h;
    wh.x += wh.v * h;
  }
}

// Detent: the drag is sticky around each title, as if a pawl rides in a notch.
const notch = (x) => x - (Math.sin(2 * Math.PI * x) / (2 * Math.PI)) * 0.78;

// The face's own file, so it can be registered again at any one width.
function faceSource(family) {
  const name = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const covers = (range, cp) =>
    (range || "U+0-10FFFF").split(",").some((r) => {
      const m = r.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
      if (!m) return false;
      const lo = parseInt(m[1].replace(/\?/g, "0"), 16);
      const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "f"), 16);
      return cp >= lo && cp <= hi;
    });
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      if (r.style.getPropertyValue("font-family").replace(/["']/g, "").trim() !== name) continue;
      if (!covers(r.style.getPropertyValue("unicode-range"), 0x48)) continue;
      const url = r.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (url) return new URL(url[1], sheet.href || location.href).href;
    }
  }
  return null;
}

// Fit the type instead of monospacing it. Every wheel is the same width, so
// each letter is set at the point on Anybody's width axis where its ink
// comes out at one shared width: E and L open out, H, O and S sit a hair
// off the narrow end, and all of them stand the same distance from the
// seam, the way a Druk cover line is fitted by hand. Canvas only takes
// font-stretch as a keyword, so each width the fit asks for is registered
// as its own face from the same file, declared at that one stretch; the
// browser drives the wdth axis from it. Ink is measured off a raster, not
// from measureText, whose boxes are rounded too coarsely to fit by.
async function fitLetters(letters, family) {
  const MP = 400; // measuring size, px
  const mcv = document.createElement("canvas");
  mcv.width = 1200;
  mcv.height = 480;
  const mx = mcv.getContext("2d", { willReadFrequently: true });
  const X0 = 200;
  const BASE = 400;
  // Ink extent of a letter set by `font`, in cap heights from its origin.
  const ink = (font, L) => {
    mx.clearRect(0, 0, mcv.width, mcv.height);
    font(mx);
    mx.fillStyle = "#000";
    mx.textBaseline = "alphabetic";
    mx.fillText(L, X0, BASE);
    const d = mx.getImageData(0, 0, mcv.width, mcv.height).data;
    let l = mcv.width;
    let r = -1;
    let top = mcv.height;
    for (let y = 0; y < mcv.height; y++)
      for (let x = 0; x < mcv.width; x++)
        if (d[(y * mcv.width + x) * 4 + 3] > 127) {
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < top) top = y;
        }
    return { l: l - X0, r: r + 1 - X0, top: BASE - top };
  };

  let buf = null;
  try {
    const src = faceSource(family);
    if (src) buf = await (await fetch(src)).arrayBuffer();
  } catch {
    buf = null;
  }
  const tag = Math.random().toString(36).slice(2, 8);
  const faces = new Map();
  const faceAt = async (w) => {
    const key = Math.round(w * 4) / 4;
    if (!faces.has(key)) {
      const f = new FontFace(`drum-${tag}-${String(key).replace(".", "_")}`, buf, { weight: String(WEIGHT), stretch: `${key}%` });
      await f.load();
      document.fonts.add(f);
      faces.set(key, f);
    }
    const fam = faces.get(key).family;
    return { stretch: key, set: (ctx, px) => (ctx.font = `${WEIGHT} ${px}px "${fam}"`) };
  };

  let lo;
  let hi;
  try {
    if (!buf) throw new Error("no face file");
    lo = await faceAt(50);
    hi = await faceAt(150);
  } catch {
    // No file to register widths from: the narrow end for every letter,
    // and the fit falls back to squeezing each one to the common width.
    const set = (ctx, px) => {
      ctx.font = `${WEIGHT} ${px}px ${family}`;
      if ("fontStretch" in ctx) ctx.fontStretch = "ultra-condensed";
    };
    lo = hi = { stretch: 50, set };
    buf = null;
  }
  const capPx = ink((c) => lo.set(c, MP), "H").top;
  const widthAt = (face, L) => {
    const e = ink((c) => face.set(c, MP), L);
    return { w: (e.r - e.l) / capPx, c: (e.r + e.l) / 2 / capPx };
  };
  const narrow = letters.map((L) => widthAt(lo, L));
  // The common width: what the broad letters (the rounds, R, A) need at the
  // narrow end. A letter that cannot come in that far (N) stays at the
  // narrow end and takes the last few percent as a squeeze.
  const sorted = narrow.map((n) => n.w).sort((a, b) => a - b);
  const T = sorted[Math.floor(sorted.length * 0.8)];

  const fit = [];
  for (let i = 0; i < letters.length; i++) {
    const L = letters[i];
    let a = { s: 50, ...narrow[i], face: lo };
    if (a.w >= T || !buf) {
      fit.push({ set: lo.set, stretch: 50, squeeze: T / a.w, c: a.c, w: a.w });
      continue;
    }
    let b = { s: 150, ...widthAt(hi, L), face: hi };
    if (b.w <= T) {
      fit.push({ set: hi.set, stretch: 150, squeeze: T / b.w, c: b.c, w: b.w });
      continue;
    }
    // Regula falsi on the width axis: the ink grows a little less than
    // linearly with wdth, so a straight line between the ends is close and
    // two corrections land it within a pixel.
    let best = Math.abs(a.w - T) < Math.abs(b.w - T) ? a : b;
    for (let it = 0; it < 3 && Math.abs(best.w - T) / T > 0.003; it++) {
      const s = a.s + ((T - a.w) / (b.w - a.w)) * (b.s - a.s);
      const face = await faceAt(s);
      const m = { s: face.stretch, ...widthAt(face, L), face };
      if (m.w < T) a = m;
      else b = m;
      if (Math.abs(m.w - T) < Math.abs(best.w - T)) best = m;
    }
    fit.push({ set: best.face.set, stretch: best.s, squeeze: T / best.w, c: best.c, w: best.w });
  }
  // Drop the trial widths nothing ended up set in.
  const kept = new Set(fit.map((f) => f.stretch));
  for (const [k, f] of faces) if (!kept.has(k)) document.fonts.delete(f);
  return {
    T,
    capRatio: capPx / MP,
    glyphs: fit,
    destroy: () => {
      for (const f of faces.values()) document.fonts.delete(f);
    },
  };
}

export async function createDrum(host, { embedded = false, family = "sans-serif" } = {}) {
  try {
    await document.fonts.load(`${WEIGHT} 200px ${family}`, "HORSEBLNDCVPA");
  } catch {}

  const letters = [...new Set(TITLES.join(""))];
  const fitted = await fitLetters(letters, family);

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
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  const glyphOf = new Int32Array(K * N);
  TITLES.forEach((t, i) => [...t].forEach((ch, w) => (glyphOf[i * K + w] = letters.indexOf(ch))));

  // Geometry, rebuilt on resize.
  // The window opens wide, ±72° of each drum, so a letter visibly curves
  // away over the top: by the lip the surface is two-thirds edge-on and a
  // rolling letter squashes to a sliver. A letter covers ±66° of its wheel,
  // which at rest fills all but the last few degrees of the window. The
  // titles are printed tight round the drum, so the next word follows close
  // behind the last instead of after a stretch of bare paper, but just far
  // enough apart that at rest every neighbour sits wholly past the lip: a
  // still shows one title and clean paper at both lips, on every wheel, and
  // the next title shows only once a wheel starts to turn.
  const THETA = 1.25;
  const ALPHA = 1.15;
  const SLOT = ALPHA + THETA + 0.035;
  let geo = null;

  // One sidebearing for every letter, so the ink stands the same distance
  // from every seam and the gaps down the line come out even.
  const SIDE = 0.055;
  const T = fitted.T;
  const capRatio = fitted.capRatio;

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
      const cap = 2 * ALPHA * R * 0.98;
      const s = (cellW * (1 - 2 * SIDE)) / (cap * T);
      const score = Math.abs(Math.log(Math.min(s, 1.15) / 0.62)) + (s > 1 ? 1 : 0);
      if (!best || score < best.score) best = { r, c, cellW, bandH, R, s: Math.min(s, 1), score };
    }
    const { r, c, cellW, bandH, R } = best;
    const s = best.s;
    // Glyph texture: arc length of a letter, so 1:1 at the drum's front, and
    // the cap fills that arc (less a hair for the rounds' overshoot): the
    // letter is printed on the curve, not sized to the chord it projects to.
    const gw = Math.round(cellW * dpr);
    const gh = Math.round(2 * ALPHA * R * dpr);
    const capPx = gh * 0.98;
    const fontPx = capPx / capRatio;
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
    x.textAlign = "left";
    x.textBaseline = "alphabetic";
    // Each letter at its own fitted width, its ink centred on the wheel.
    // `s` is the one condensation the whole line shares (Druk is narrower
    // than the face's narrow end), the same for every letter; only N, which
    // cannot come in to the common width on the axis, takes a little more.
    letters.forEach((L, i) => {
      const g = fitted.glyphs[i];
      const ox = (i % ac) * cw + inset;
      const oy = Math.floor(i / ac) * ch + inset;
      const base = oy + gh / 2 + capPx / 2;
      g.set(x, fontPx);
      x.save();
      x.translate(ox + gw / 2, base);
      x.scale(s * g.squeeze, 1);
      x.fillText(L, -g.c * capPx, 0);
      x.restore();
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Toward the lip a letter is squashed hard in y only; anisotropic
    // filtering keeps its stems sharp there instead of blurring them sideways.
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
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
  // `held` is the notch a wheel's pawl sits in once it has landed; `pass`
  // the last notch it clicked through, so a wheel hovering on a notch under
  // the thumb does not chatter.
  const wheels = Array.from({ length: K }, () => ({ x: target, v: 0, held: target, pass: target }));
  const DELAY = 0.05;
  const sound = createDetents();
  let quiet = false; // the idle demo turns the drums in silence
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
  const step = (dir, idle = false) => {
    quiet = idle;
    target = Math.round(target) + dir;
    lastStep = now;
    push();
  };
  // Geared down from the surface (R·slot, more than a band tall) so one
  // comfortable thumb swipe turns one title.
  const slotPx = () => (geo ? geo.bandH * 0.62 : 200);

  stage.on("down", (p) => {
    sound.wake();
    quiet = false;
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
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", " "].includes(e.key)) sound.wake();
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
    if (still == null && !drag && stage.idleFor() > 5000 && now - lastStep > 3.4) step(1, true);

    const phi = new Float32Array(K);
    for (let w = 0; w < K; w++) {
      const wh = wheels[w];
      if (still != null) {
        wh.x = clamp(still * 1.7 - w * 0.14, 0, 1);
      } else {
        const goal = at(now - w * DELAY);
        const prev = wh.x;
        if (drag || goal !== wh.held || Math.abs(goal - Math.round(goal)) > 1e-6) {
          // Free: under the thumb a stiff, critically damped follow; let go,
          // a heavy wheel winds up toward the notch and arrives with speed
          // (just under critical damping, so it would overshoot a little —
          // but the pawl catches it on the way in, so it never does).
          const k = drag ? 900 : 320;
          const z = drag ? 1 : 0.66;
          integrate(wh, goal, k, z, dt);
          const lo = Math.min(prev, wh.x);
          const hi = Math.max(prev, wh.x);
          const n = wh.v > 0 ? Math.floor(hi) : Math.ceil(lo);
          // Crossed a notch: the pawl drops into it.
          if (n > lo && n <= hi && n !== wh.pass) {
            wh.pass = n;
            if (!quiet) sound.click(Math.abs(wh.v), w, K);
            if (!drag && n === goal) {
              wh.held = goal;
              wh.x = n + (wh.x - n) * 0.25;
            }
          } else if (Math.abs(wh.x - wh.pass) > 0.25) wh.pass = NaN;
          // Let go on (or just past) a notch it already clicked into: the
          // pawl is in it, so it is caught, not sprung toward it.
          if (!drag && (wh.pass === goal || (Math.abs(wh.x - goal) < 1e-3 && Math.abs(wh.v) < 1e-2))) wh.held = goal;
        } else {
          // Caught: the pawl's spring holds the wheel hard in its notch. It
          // takes the arriving momentum as a few pixels of give, critically
          // damped: a thunk, never a wobble.
          integrate(wh, goal, 5200, 1, dt);
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
      fitted.destroy();
      sound.destroy();
      stage.destroy();
    },
  };
}
