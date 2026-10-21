import { BAKE_FRAGMENT, BAKE_VERTEX, FOCUS_FRAGMENT, FOCUS_VERTEX } from "./focusShader";
import { createLensAudio } from "./lensAudio";
import { albumById } from "@/app/lab/_music/catalog";

const ABBEY = albumById("abbey-road");
const RUBBER = albumById("rubber-soul");
const LETITBE = albumById("let-it-be");
const LINES = [
  ["i", "keep", "your", { glyph: "moon", w: 0.62 }],
  ["voice", { img: RUBBER.cover, w: 0.78, fx: 0.5, fy: 0.5, label: RUBBER.title }, "on", "the"],
  ["walk", { img: ABBEY.cover, w: 0.78, fx: 0.5, fy: 0.5, label: ABBEY.title }, "home"],
  ["and", "it", "gets"],
  ["clearer", { img: LETITBE.cover, w: 0.78, fx: 0.5, fy: 0.5, label: LETITBE.title }, "the"],
  ["closer", "i", "get", { glyph: "star", w: 0.62 }],
];
export const LYRIC = LINES.map((tokens) => tokens.filter((t) => typeof t === "string").join(" "));
const ATOM_H = 0.78;
const ATOM_DROP = 0.03;
const AUTO_ORDER = [3, 1, 4, 0, 5, 2];
const AUTO_EVERY = 3800;
const AUTO_IDLE = 7000;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(g, img, x, y, w, h, fx, fy, r) {
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.clip();
  if (img) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (img.naturalWidth - sw) * fx;
    const sy = (img.naturalHeight - sh) * fy;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  } else {
    g.fillStyle = "#d8d8d6";
    g.fillRect(x, y, w, h);
  }
  g.restore();
}

function drawGlyph(g, kind, x, baseline, em) {
  const cx = x + em * 0.31;
  const cy = baseline - em * 0.36;
  if (kind === "moon") {
    g.save();
    g.beginPath();
    g.arc(cx, cy, em * 0.3, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(cx + em * 0.15, cy - em * 0.09, em * 0.26, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return;
  }
  const R = em * 0.33;
  const pinch = em * 0.035;
  g.beginPath();
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2 - Math.PI / 2;
    const b = a + Math.PI / 4;
    if (k === 0) g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.quadraticCurveTo(cx + Math.cos(b) * pinch, cy + Math.sin(b) * pinch, cx + Math.cos(a + Math.PI / 2) * R, cy + Math.sin(a + Math.PI / 2) * R);
  }
  g.closePath();
  g.fill();
}
const DISTANCES = [0.5, 0.7, 1, 1.5, 3, Infinity];
const DIOPTERS = DISTANCES.map((d) => (Number.isFinite(d) ? 1 / d : 0));
const MAX_D = 2;
const K = 1.25;
const DETENTS = 96;
const LABELS = [
  [2, "0.5"],
  [1 / 0.7, "0.7"],
  [1, "1"],
  [1 / 1.5, "1.5"],
  [0.5, "2"],
  [1 / 3, "3"],
  [0.2, "5"],
  [0, "∞"],
];
const MINOR = [1 / 0.6, 1 / 0.8, 1 / 1.2, 1 / 2.5, 1 / 4, 0.1];
const FAMILY = '"Focus Arimo", Arial, Helvetica, sans-serif';
const INK_CSS = "rgb(9, 9, 11)";
const RING_H = 76;
const SPEED_CAP = 1.4;
const LEVELS = [0, 0.05, 0.1, 0.17, 0.26, 0.38, 0.53, 0.75, 1];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function formatDistance(df) {
  if (df < 0.09) return "infinity";
  const d = 1 / df;
  return `${d < 1 ? d.toFixed(2) : d.toFixed(1)} metres`;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
  return s;
}

export function createFocus({ root, glCanvas, ring, onFail }) {
  const gl = glCanvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) {
    onFail?.();
    return null;
  }
  const link = (vs, fs) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
  };
  let program = null;
  let bake = null;
  try {
    program = link(FOCUS_VERTEX, FOCUS_FRAGMENT);
    bake = link(BAKE_VERTEX, BAKE_FRAGMENT);
  } catch {
    program = null;
  }
  if (!program || !bake) {
    onFail?.();
    return null;
  }
  const bu = {
    uTex: gl.getUniformLocation(bake, "uTex"),
    uTexel: gl.getUniformLocation(bake, "uTexel"),
    uRadius: gl.getUniformLocation(bake, "uRadius"),
  };
  const stack = gl.createTexture();
  const fbo = gl.createFramebuffer();
  const u = {};
  for (const name of ["uRect", "uUv", "uRes", "uTex", "uStack", "uTexel", "uLevel"]) u[name] = gl.getUniformLocation(program, name);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  const atlas = document.createElement("canvas");
  const rctx = ring.getContext("2d");

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let font = 64;
  let block = { x: 0, y: 0, w: 0, h: 0 };
  let lines = [];
  let pad = 0;
  let rowH = 0;
  let maxBlur = 24;
  let ringBox = { x: 0, y: 0, w: 320 };
  let uiFamily = "system-ui, sans-serif";

  let p = 0.5;
  let v = 0;
  let mode = "idle";
  let target = 0.5;
  let omega = 12;
  let drag = null;
  let tap = null;
  let lastDetent = Math.floor(p * DETENTS);
  let frame = 0;
  let lastT = 0;
  let visible = true;
  let destroyed = false;
  let needsDraw = true;
  let audio = null;
  let soundOn = true;
  let atEnd = false;
  let images = new Map();
  let autoTimer = 0;
  let autoIdx = 0;
  let lastTouch = -Infinity;

  const touch = () => {
    lastTouch = performance.now();
  };

  const tokenWidth = (m, token, em) => (typeof token === "string" ? m.measureText(token).width : token.w * em);
  const lineWidth = (m, tokens, em) => tokens.reduce((sum, t) => sum + tokenWidth(m, t, em), 0) + m.measureText(" ").width * (tokens.length - 1);

  const ensureAudio = () => {
    if (!audio) audio = createLensAudio();
    return audio;
  };

  const df = () => MAX_D * (1 - p);

  const layout = () => {
    const rectRaw = root.getBoundingClientRect();
    const rect = { top: rectRaw.top, left: rectRaw.left, right: rectRaw.right, bottom: rectRaw.bottom, x: rectRaw.x, y: rectRaw.y, width: root.clientWidth, height: root.clientHeight };
    cssW = rect.width;
    cssH = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    glCanvas.width = Math.max(1, Math.round(cssW * dpr));
    glCanvas.height = Math.max(1, Math.round(cssH * dpr));
    glCanvas.style.width = `${cssW}px`;
    glCanvas.style.height = `${cssH}px`;
    uiFamily = getComputedStyle(root).fontFamily || uiFamily;
    const narrow = cssW < 640;
    const embedded = root.dataset.embedded !== undefined;
    const side = narrow ? 20 : 48;
    const ringGap = narrow ? 40 : 36;
    const edge = narrow ? 28 : 32;
    const top = embedded ? edge : narrow ? 200 : 196;
    const ringSpace = embedded ? RING_H + ringGap : RING_H + (narrow ? 72 : 64);
    const availW = Math.min(760, cssW - side * 2);
    const availH = Math.max(embedded ? 96 : 160, cssH - top - ringSpace - (embedded ? edge : 24));
    const m = atlas.getContext("2d");
    m.font = `100px ${FAMILY}`;
    const widest = Math.max(...LINES.map((tokens) => lineWidth(m, tokens, 100))) / 100;
    const lead = 1.04;
    font = Math.min(availW / (widest * 1.18), availH / (LINES.length * lead + 0.2), 96);
    font = Math.max(22, Math.floor(font));
    const blockW = Math.min(availW, Math.round(widest * font * 1.42));
    const pitch = font * lead;
    const blockH = pitch * (LINES.length - 1) + font * 1.16;
    const x = Math.round((cssW - blockW) / 2);
    const y = embedded
      ? Math.round(Math.max(edge * 0.5, (cssH - blockH - ringGap - RING_H) / 2))
      : Math.round(top + Math.max(0, (availH - blockH) / 2));
    block = { x, y, w: blockW, h: blockH, pitch };
    maxBlur = font * 0.34;
    const rw = Math.max(blockW, Math.min(cssW - 32, 360));
    ringBox = { x: Math.round((cssW - rw) / 2), y: Math.round(y + blockH + ringGap), w: rw };
    ring.style.left = `${ringBox.x}px`;
    ring.style.top = `${ringBox.y}px`;
    ring.style.width = `${ringBox.w}px`;
    ring.style.height = `${RING_H}px`;
    ring.width = Math.round(ringBox.w * dpr);
    ring.height = Math.round(RING_H * dpr);
    buildAtlas();
    needsDraw = true;
    request();
  };

  const buildAtlas = () => {
    pad = Math.ceil(maxBlur * dpr * 1.6 + 6);
    const boxH = Math.ceil(font * 1.2 * dpr);
    rowH = boxH + pad * 2;
    const w = Math.ceil(block.w * dpr) + pad * 2;
    atlas.width = w;
    atlas.height = rowH * LINES.length;
    const g = atlas.getContext("2d");
    g.clearRect(0, 0, atlas.width, atlas.height);
    const em = font * dpr;
    g.fillStyle = INK_CSS;
    g.font = `${em}px ${FAMILY}`;
    g.textBaseline = "alphabetic";
    lines = LINES.map((tokens, i) => {
      const widths = tokens.map((t) => tokenWidth(g, t, em));
      const total = widths.reduce((a, b) => a + b, 0);
      const span = block.w * dpr;
      const gap = tokens.length > 1 ? (span - total) / (tokens.length - 1) : 0;
      const baseline = i * rowH + pad + font * 0.93 * dpr;
      let cx = pad;
      tokens.forEach((token, k) => {
        const x = Math.round(cx);
        if (typeof token === "string") g.fillText(token, x, Math.round(baseline));
        else if (token.glyph) drawGlyph(g, token.glyph, x, baseline, em);
        else {
          const h = Math.round(em * ATOM_H);
          const y = Math.round(baseline + em * ATOM_DROP) - h;
          drawCover(g, images.get(token.img), x, y, Math.round(widths[k]), h, token.fx, token.fy, em * 0.06);
          g.fillStyle = INK_CSS;
        }
        cx += widths[k] + gap;
      });
      return { text: LYRIC[i], top: block.y + i * block.pitch, diopter: DIOPTERS[i] };
    });
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bakeStack();
  };

  const bakeStack = () => {
    const bw = Math.ceil(atlas.width / 2);
    const bh = Math.ceil(atlas.height / 2);
    const depth = LEVELS.length - 1;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, stack);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, bw, bh, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(bake);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(bu.uTex, 0);
    gl.uniform2f(bu.uTexel, 1 / atlas.width, 1 / atlas.height);
    gl.viewport(0, 0, bw, bh);
    for (let k = 1; k < LEVELS.length; k += 1) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, stack, 0, k - 1);
      gl.uniform1f(bu.uRadius, LEVELS[k] * maxBlur * dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const levelFor = (blurCss) => {
    const t = clamp(blurCss / maxBlur, 0, 1);
    for (let k = 1; k < LEVELS.length; k += 1) {
      if (t <= LEVELS[k]) return k - 1 + (t - LEVELS[k - 1]) / (LEVELS[k] - LEVELS[k - 1]);
    }
    return LEVELS.length - 1;
  };

  const drawText = () => {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, stack);
    gl.uniform1i(u.uStack, 1);
    gl.uniform2f(u.uRes, glCanvas.width, glCanvas.height);
    gl.uniform2f(u.uTexel, 1 / atlas.width, 1 / atlas.height);
    const focus = df();
    const breathe = 1 + 0.012 * (focus - 1);
    const cx = (block.x + block.w / 2) * dpr;
    const cy = (block.y + block.h / 2) * dpr;
    lines.forEach((line, i) => {
      const blurCss = Math.min(maxBlur, Math.abs(focus - line.diopter) * font * 0.19);
      const x0 = block.x * dpr - pad;
      const y0 = line.top * dpr - pad;
      const w = atlas.width;
      const h = rowH;
      const sx = cx + (x0 - cx) * breathe;
      const sy = cy + (y0 - cy) * breathe;
      gl.uniform4f(u.uRect, sx, sy, w * breathe, h * breathe);
      gl.uniform4f(u.uUv, 0, (i * rowH) / atlas.height, 1, rowH / atlas.height);
      gl.uniform1f(u.uLevel, levelFor(blurCss));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  };

  const drawRing = () => {
    const W = ring.width;
    const H = ring.height;
    const s = dpr;
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.clearRect(0, 0, W, H);
    const top = 14 * s;
    const scaleH = 24 * s;
    const gripTop = top + scaleH + 2 * s;
    const bottom = H - 2 * s;
    const R = W / 2;
    const cx = W / 2;
    const radius = 7 * s;
    const body = rctx.createLinearGradient(0, 0, W, 0);
    body.addColorStop(0, "#020202");
    body.addColorStop(0.08, "#0d0d0e");
    body.addColorStop(0.22, "#18181a");
    body.addColorStop(0.42, "#202023");
    body.addColorStop(0.58, "#202023");
    body.addColorStop(0.78, "#18181a");
    body.addColorStop(0.92, "#0d0d0e");
    body.addColorStop(1, "#020202");
    rctx.fillStyle = body;
    rctx.beginPath();
    rctx.roundRect(0, top, W, bottom - top, radius);
    rctx.fill();
    const focus = df();
    rctx.save();
    rctx.beginPath();
    rctx.rect(0, top, W, bottom - top);
    rctx.clip();
    const ribs = 132;
    const step = (Math.PI * 2) / ribs;
    const phase = focus * K;
    for (let k = 0; k < ribs; k += 1) {
      let phi = k * step + phase;
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      const c = Math.cos(phi);
      if (c < 0.04) continue;
      const x = cx + R * Math.sin(phi);
      const w = Math.max(0.6 * s, R * step * 0.46 * c);
      rctx.fillStyle = `rgba(255,255,255,${(0.035 + 0.11 * c * c).toFixed(3)})`;
      rctx.fillRect(x - w / 2, gripTop + 3 * s, w, bottom - gripTop - 6 * s);
      rctx.fillStyle = `rgba(0,0,0,${(0.35 * c).toFixed(3)})`;
      rctx.fillRect(x + w / 2, gripTop + 3 * s, Math.max(0.5, w * 0.35), bottom - gripTop - 6 * s);
    }
    rctx.fillStyle = "rgba(255,255,255,0.08)";
    rctx.fillRect(0, gripTop - 1 * s, W, 1 * s);
    rctx.fillStyle = "rgba(0,0,0,0.6)";
    rctx.fillRect(0, gripTop, W, 1 * s);
    rctx.textAlign = "center";
    rctx.textBaseline = "middle";
    const labelY = top + scaleH / 2 + 1 * s;
    const fontPx = 12 * s;
    rctx.font = `500 ${fontPx}px ${uiFamily}`;
    for (const [d, label] of LABELS) {
      const phi = (focus - d) * K;
      if (Math.abs(phi) > 1.5) continue;
      const c = Math.cos(phi);
      const x = cx + R * Math.sin(phi);
      const a = smoothstep(0.05, 0.45, c);
      rctx.save();
      rctx.translate(x, labelY);
      rctx.scale(Math.max(0.05, c), 1);
      rctx.fillStyle = `rgba(242,242,240,${a.toFixed(3)})`;
      if (label === "∞") {
        rctx.font = `500 ${fontPx * 1.3}px ${uiFamily}`;
        rctx.fillText(label, 0, -0.5 * s);
        rctx.font = `500 ${fontPx}px ${uiFamily}`;
      } else {
        rctx.fillText(label, 0, 0);
      }
      rctx.restore();
      rctx.fillStyle = `rgba(242,242,240,${(a * 0.9).toFixed(3)})`;
      rctx.fillRect(x - 0.5 * s, top + 1 * s, Math.max(0.6, 1 * s * c), 3 * s);
    }
    for (const d of MINOR) {
      const phi = (focus - d) * K;
      if (Math.abs(phi) > 1.5) continue;
      const c = Math.cos(phi);
      const x = cx + R * Math.sin(phi);
      rctx.fillStyle = `rgba(242,242,240,${(smoothstep(0.05, 0.45, c) * 0.55).toFixed(3)})`;
      rctx.fillRect(x - 0.5 * s, top + 1 * s, Math.max(0.6, 1 * s * c), 2 * s);
    }
    rctx.restore();
    rctx.fillStyle = "#e5321f";
    rctx.beginPath();
    rctx.moveTo(cx - 5 * s, 4 * s);
    rctx.lineTo(cx + 5 * s, 4 * s);
    rctx.lineTo(cx, 11 * s);
    rctx.closePath();
    rctx.fill();
    ring.setAttribute("aria-valuetext", formatDistance(focus));
    ring.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  };

  const crossDetents = (speed) => {
    const d = Math.floor(p * DETENTS + 0.5);
    if (d !== lastDetent) {
      lastDetent = d;
      audio?.detent(speed);
    }
  };

  const setP = (next, speed) => {
    const clamped = clamp(next, 0, 1);
    const hit = clamped !== next;
    if (hit && !atEnd && Math.abs(speed) > 0.05) audio?.stop();
    atEnd = hit;
    if (clamped !== p) needsDraw = true;
    p = clamped;
    crossDetents(speed);
    return hit;
  };

  const step = (now) => {
    frame = 0;
    if (destroyed) return;
    const dt = Math.min(0.2, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    let active = false;
    if (drag) {
      active = true;
      const speed = drag.speed;
      drag.speed *= Math.exp(-dt * 10);
      audio?.friction(speed);
    } else if (mode === "coast") {
      active = true;
      const hit = setP(p + v * dt, v);
      v *= Math.exp(-dt * 4.2);
      if (hit) v = 0;
      audio?.friction(v);
      if (Math.abs(v) < 0.05) {
        mode = "target";
        target = Math.round(p * DETENTS) / DETENTS;
        omega = 16;
      }
    } else if (mode === "target") {
      active = true;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let k = 0; k < steps && mode === "target"; k += 1) {
        const acc = omega * omega * (target - p) - 2 * omega * v;
        v = clamp(v + acc * h, -SPEED_CAP, SPEED_CAP);
        setP(p + v * h, v);
        if (Math.abs(target - p) < 0.0002 && Math.abs(v) < 0.002) {
          p = target;
          v = 0;
          mode = "idle";
          needsDraw = true;
        }
      }
      audio?.friction(v * 0.8);
    } else {
      audio?.friction(0);
    }
    if (needsDraw && visible) {
      drawText();
      drawRing();
      needsDraw = false;
    }
    if (active || needsDraw) request();
    else lastT = 0;
  };

  function request() {
    if (!frame && !destroyed) frame = requestAnimationFrame(step);
  }

  const localX = (e) => e.clientX - root.getBoundingClientRect().left;
  const localY = (e) => e.clientY - root.getBoundingClientRect().top;

  const onRingDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    touch();
    audio?.wake();
    ring.setPointerCapture?.(e.pointerId);
    mode = "drag";
    v = 0;
    drag = { id: e.pointerId, x: e.clientX, samples: [{ t: e.timeStamp, p }], speed: 0 };
    root.dataset.grabbing = "";
    request();
  };

  const onRingMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    const R = ringBox.w / 2;
    const dp = -dx / (R * K * MAX_D);
    const before = p;
    setP(p + dp, dp * 60);
    drag.samples.push({ t: e.timeStamp, p });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
    drag.speed = Math.min(1, Math.abs(p - before) * 40);
    request();
  };

  const onRingUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const span = Math.max(16, last.t - first.t);
    const recent = e.timeStamp - last.t < 80;
    v = recent ? clamp(((last.p - first.p) / span) * 1000, -SPEED_CAP, SPEED_CAP) : 0;
    drag = null;
    delete root.dataset.grabbing;
    mode = Math.abs(v) > 0.05 ? "coast" : "target";
    target = Math.round(p * DETENTS) / DETENTS;
    omega = 16;
    request();
  };

  const lineAt = (x, y) => {
    if (x < block.x - 16 || x > block.x + block.w + 16) return -1;
    const i = Math.floor((y - block.y + block.pitch * 0.08) / block.pitch);
    return i >= 0 && i < LINES.length ? i : -1;
  };

  const rack = (i, w) => {
    target = 1 - DIOPTERS[i] / MAX_D;
    omega = w;
    if (mode !== "target") v = 0;
    mode = "target";
    request();
  };

  const autoTick = () => {
    autoTimer = window.setTimeout(autoTick, AUTO_EVERY);
    if (destroyed || !visible || document.hidden || drag || mode !== "idle") return;
    if (performance.now() - lastTouch < AUTO_IDLE) return;
    let next = AUTO_ORDER[autoIdx % AUTO_ORDER.length];
    autoIdx += 1;
    if (Math.abs(1 - DIOPTERS[next] / MAX_D - p) < 0.01) {
      next = AUTO_ORDER[autoIdx % AUTO_ORDER.length];
      autoIdx += 1;
    }
    rack(next, 4.2);
  };

  const focusLine = (i) => {
    touch();
    audio?.wake();
    target = 1 - DIOPTERS[i] / MAX_D;
    omega = 7;
    if (mode !== "target") v = 0;
    mode = "target";
    request();
  };

  const onTextDown = (e) => {
    if (e.button !== 0) return;
    touch();
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, line: lineAt(localX(e), localY(e)) };
  };

  const onTextUp = (e) => {
    if (!tap || e.pointerId !== tap.id) return;
    const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
    if (moved < 10 && tap.line >= 0) focusLine(tap.line);
    tap = null;
  };

  const onTextHover = (e) => {
    if (e.pointerType !== "mouse") return;
    const over = lineAt(localX(e), localY(e)) >= 0;
    if (over) root.dataset.overLine = "";
    else delete root.dataset.overLine;
  };

  const onWheel = (e) => {
    const onRing = e.target === ring;
    const y = localY(e);
    const overBlock = y > block.y - 24 && y < ringBox.y + RING_H + 16;
    if (!onRing && (root.dataset.embedded !== undefined || !overBlock)) return;
    e.preventDefault();
    touch();
    audio?.wake();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const base = mode === "target" ? target : p;
    target = clamp(base + clamp(delta * unit, -120, 120) * 0.0011, 0, 1);
    omega = 13;
    if (mode !== "target") v = 0;
    mode = "target";
    request();
  };

  const onKey = (e) => {
    const stepBy = (n) => {
      e.preventDefault();
      touch();
      audio?.wake();
      const base = mode === "target" ? target : p;
      target = clamp(Math.round(base * DETENTS + n) / DETENTS, 0, 1);
      omega = 14;
      if (mode !== "target") v = 0;
      mode = "target";
      request();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowUp") stepBy(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") stepBy(-1);
    else if (e.key === "PageUp") stepBy(8);
    else if (e.key === "PageDown") stepBy(-8);
    else if (e.key === "End") stepBy(DETENTS);
    else if (e.key === "Home") stepBy(-DETENTS);
    else if (/^[1-6]$/.test(e.key)) {
      e.preventDefault();
      focusLine(Number(e.key) - 1);
    }
  };

  // On the experiments index the first touch anywhere must not arm this
  // tile's sound, only a touch on the tile itself.
  const gestureScope = root.dataset.embedded !== undefined ? root : window;
  const onFirstGesture = () => {
    gestureScope.removeEventListener("pointerdown", onFirstGesture, true);
    gestureScope.removeEventListener("keydown", onFirstGesture, true);
    if (soundOn) ensureAudio()?.setEnabled(true);
  };

  ring.addEventListener("pointerdown", onRingDown);
  ring.addEventListener("pointermove", onRingMove);
  ring.addEventListener("pointerup", onRingUp);
  ring.addEventListener("pointercancel", onRingUp);
  ring.addEventListener("keydown", onKey);
  glCanvas.addEventListener("pointerdown", onTextDown);
  glCanvas.addEventListener("pointerup", onTextUp);
  glCanvas.addEventListener("pointermove", onTextHover);
  root.addEventListener("wheel", onWheel, { passive: false });
  gestureScope.addEventListener("pointerdown", onFirstGesture, true);
  gestureScope.addEventListener("keydown", onFirstGesture, true);

  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      needsDraw = true;
      request();
    }
  });
  io.observe(root);
  const onVisibility = () => {
    if (document.hidden) audio?.friction(0);
    else request();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onLost = (e) => {
    e.preventDefault();
    onFail?.();
  };
  glCanvas.addEventListener("webglcontextlost", onLost);

  return {
    async init() {
      try {
        await document.fonts.load(`64px "Focus Arimo"`);
      } catch {
        return;
      }
      if (destroyed) return;
      const sources = LINES.flat().filter((t) => typeof t === "object" && t.img);
      const loaded = await Promise.all(sources.map((t) => loadImage(t.img)));
      if (destroyed) return;
      images = new Map(sources.map((t, k) => [t.img, loaded[k]]));
      layout();
      drawText();
      drawRing();
      needsDraw = false;
      autoTimer = window.setTimeout(autoTick, 1600);
    },
    focusLine,
    async setSound(on) {
      soundOn = on;
      if (!on) {
        await audio?.setEnabled(false);
        return false;
      }
      const a = ensureAudio();
      return a ? a.setEnabled(true) : false;
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(autoTimer);
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      ring.removeEventListener("pointerdown", onRingDown);
      ring.removeEventListener("pointermove", onRingMove);
      ring.removeEventListener("pointerup", onRingUp);
      ring.removeEventListener("pointercancel", onRingUp);
      ring.removeEventListener("keydown", onKey);
      glCanvas.removeEventListener("pointerdown", onTextDown);
      glCanvas.removeEventListener("pointerup", onTextUp);
      glCanvas.removeEventListener("pointermove", onTextHover);
      glCanvas.removeEventListener("webglcontextlost", onLost);
      root.removeEventListener("wheel", onWheel);
      gestureScope.removeEventListener("pointerdown", onFirstGesture, true);
      gestureScope.removeEventListener("keydown", onFirstGesture, true);
      gl.deleteTexture(texture);
      gl.deleteTexture(stack);
      gl.deleteFramebuffer(fbo);
      gl.deleteProgram(bake);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      audio?.destroy();
      audio = null;
    },
  };
}
