import InkSheet, { makeWeave, seeded } from "./typewriterInk";
import { MATERIAL_FRAGMENT, PAPER_FRAGMENT, PAPER_VERTEX } from "./typewriterShader";
import TypewriterSound from "./typewriterSound";
import {
  BARS,
  BELL_COL,
  INK_COL0,
  INK_COLS,
  LAST_LINE,
  LINE_UNITS,
  MARGIN_COLS,
  MAX_COL,
  SCRIPT,
  SHEET_COLS,
  SHEET_LINES,
  START,
  TOP_LINES,
  noteStrikes,
} from "./typewriterNotes";

const MAX_DPR = 2;
const UP = 0.05;
const DOWN = 0.14;
const KNOB = 4;
const CAR_LEFT = -KNOB - 3;
const CAR_RIGHT = SHEET_COLS + KNOB + 3;
const A1 = 0.32;
const PHI_MAX = 0.72;
const VMAX = 170;
const ACCEL = 2600;
const ENAMEL = [214, 210, 199];
const TAU = Math.PI * 2;
const PERIOD = 20;
const TILE = 512;

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader failed");
  }
  return shader;
}

function springStep(state, target, omega, zeta, dt) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    const a = -omega * omega * (state.x - target) - 2 * zeta * omega * state.v;
    state.v += a * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.x - target) < 0.0015 && Math.abs(state.v) < 0.02) {
    state.x = target;
    state.v = 0;
    return false;
  }
  return true;
}

export default class TypewriterEngine {
  constructor({ stage, glCanvas, overlay, keys, embedded, insets, onReady, onFail, onShift }) {
    this.stage = stage;
    this.glCanvas = glCanvas;
    this.overlay = overlay;
    this.keysEl = keys;
    this.embedded = embedded;
    this.insets = insets;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onShift = onShift;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sound = new TypewriterSound();
    this.rand = seeded(20261017);
    this.seed = 1;
    this.strikes = [];
    this.bars = [];
    this.keyFx = [];
    this.dirty = [];
    this.col = START.col;
    this.line = START.line;
    this.car = { x: START.col, v: 0, mode: "spring" };
    this.roll = { x: START.line, v: 0, mode: "spring", target: START.line };
    this.lever = { x: 0, v: 0 };
    this.spool = 0;
    this.shift = false;
    this.script = 0;
    this.ejecting = false;
    this.strikeCount = 0;
    this.drag = null;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.geo = null;
    this.keyMap = new Map();
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      key: (e) => this.keyDown(e),
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
  }

  async start() {
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--font-mono)";
    this.stage.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily || "monospace";
    probe.remove();
    await document.fonts?.load(`500 40px ${family}`).catch(() => null);
    if (this.destroyed) return;
    this.ink = new InkSheet(family);
    const gl = this.glCanvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.onFail?.();
      return;
    }
    this.gl = gl;
    try {
      this.setupGl();
    } catch (error) {
      console.error(error);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return;
    }
    this.ctx = this.overlay.getContext("2d");
    this.cache = document.createElement("canvas");
    this.weaveHi = makeWeave(3, [255, 255, 255], 0);
    this.keysEl?.querySelectorAll("[data-key]").forEach((el) => this.keyMap.set(el.getAttribute("data-key"), el));
    this.glCanvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.stage.addEventListener("pointerdown", this.handlers.down);
    this.stage.addEventListener("pointermove", this.handlers.move);
    this.stage.addEventListener("pointerup", this.handlers.up);
    this.stage.addEventListener("pointercancel", this.handlers.up);
    (this.embedded ? this.stage : window).addEventListener("keydown", this.handlers.key);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.stage);
    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.stage);
    if (this.keysEl) this.resizer.observe(this.keysEl);
    for (const s of noteStrikes()) this.strikes.push(this.makeStrike(s.ch, s.col, s.line));
    this.layout();
    this.ready = true;
    this.render();
    this.onReady?.();
  }

  link(fragmentSource) {
    const gl = this.gl;
    const vertex = compile(gl, gl.VERTEX_SHADER, PAPER_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(info || "link failed");
    }
    const uniforms = {};
    const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < total; i += 1) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  setupGl() {
    const gl = this.gl;
    const paper = this.link(PAPER_FRAGMENT);
    this.program = paper.program;
    this.uniforms = paper.uniforms;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.inkTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const bake = this.link(MATERIAL_FRAGMENT);
    this.materialTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.materialTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TILE, TILE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.materialTex, 0);
    gl.viewport(0, 0, TILE, TILE);
    gl.useProgram(bake.program);
    gl.uniform1f(bake.uniforms.uTile, TILE);
    gl.uniform1f(bake.uniforms.uPeriod, PERIOD);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(bake.program);
    gl.bindTexture(gl.TEXTURE_2D, this.materialTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }

  makeStrike(ch, col, line) {
    const bar = BARS.map.get(ch);
    const left = bar ? bar.left : false;
    const r = this.rand;
    this.strikeCount += 1;
    const n = this.strikeCount;
    return {
      ch,
      col,
      line,
      left,
      force: (left ? 1.05 : 0.95) * (0.88 + r() * 0.22),
      ribbon: 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(n * 0.031)) * (0.85 + r() * 0.15),
      weave: [r(), r()],
      seed: (this.seed += 7919),
    };
  }

  rebuildInk() {
    this.ink.clear();
    for (const s of this.strikes) this.ink.stamp(s);
    this.uploadInk(null);
  }

  uploadInk(rect) {
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (!rect) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.ink.canvas);
      return;
    }
    if (rect.w <= 0 || rect.h <= 0) return;
    const data = this.ink.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, data.data);
  }

  layout() {
    if (!this.gl || this.destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const ins = this.insets();
    const pitch = clamp(Math.min(W / 84, H / 44), 11.5, 18);
    const lineH = pitch * LINE_UNITS;
    const R = lineH * 1.9;
    let L = clamp(Math.max(pitch * 5, R * 1.85), 50, 100);
    const bottom = H - ins.bottom;
    let yP = Math.round(Math.min(H * 0.64, bottom - (2 * L + 14) - 4));
    const minY = ins.top + lineH * 5;
    if (yP < minY) {
      L = Math.max(R * 1.4, (bottom - 18 - minY) / 2);
      yP = Math.round(Math.max(minY, bottom - (2 * L + 14) - 4));
    }
    const printX = Math.round(W * 0.5);
    const fy = yP - lineH * 0.3;
    const A = Math.min(1.08, Math.acos(clamp((R * 1.05 + 8 + lineH * 0.3) / L, 0, 0.95)));
    const dA = R * Math.sin(A1);
    const Rc = Math.max(R * 2, (yP + 24 - dA) / (Math.sin(PHI_MAX) - Math.sin(A1)));
    const wellR = 2 * L + 14;
    const wellA = A + 0.12;
    const RS = wellR * Math.sin(Math.min(wellA, 1.4)) + 0.2 * L;
    const spoolR = L * (W < 600 ? 0.48 : 0.55);
    const SX = RS + spoolR + 0.16 * L;
    const yDeck = yP + R * 0.92;
    const angles = [];
    for (let i = 0; i < BARS.count; i += 1) angles.push(-A + (2 * A * i) / (BARS.count - 1));
    const res = clamp(Math.round(pitch * dpr * 0.95), 16, 28);
    this.geo = { W, H, dpr, pitch, lineH, R, L, yP, printX, fy, A, Rc, wellR, wellA, RS, spoolR, SX, yDeck, angles };
    this.glCanvas.width = Math.round(W * dpr);
    this.glCanvas.height = Math.round(H * dpr);
    this.overlay.width = Math.round(W * dpr);
    this.overlay.height = Math.round(H * dpr);
    this.cache.width = this.overlay.width;
    this.cache.height = this.overlay.height;
    if (this.ink.setResolution(res)) this.rebuildInk();
    this.ribbonTiles();
    this.drawCache();
    if (this.ready) this.render();
  }

  ribbonTiles() {
    const ctx = this.ctx;
    this.weavePattern = ctx.createPattern(this.weaveHi, "repeat");
  }

  arcToScreen(s) {
    const { R, Rc } = this.geo;
    if (s <= R * A1) return R * Math.sin(s / R);
    return R * Math.sin(A1) + Rc * (Math.sin(Math.min(1.5, A1 + (s - R * A1) / Rc)) - Math.sin(A1));
  }

  headX() {
    return MARGIN_COLS + this.car.x + 0.5;
  }

  headY() {
    return (TOP_LINES + this.roll.x) * LINE_UNITS;
  }

  render() {
    if (!this.gl || !this.geo) return;
    this.renderGl();
    this.drawOverlay();
  }

  renderGl() {
    const gl = this.gl;
    const g = this.geo;
    const u = this.uniforms;
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.uniform1i(u.uInk, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.materialTex);
    gl.uniform1i(u.uMaterial, 1);
    gl.uniform1f(u.uPeriod, PERIOD);
    gl.uniform2f(u.uRes, this.glCanvas.width, this.glCanvas.height);
    gl.uniform2f(u.uBox, g.W, g.H);
    gl.uniform1f(u.uDpr, this.glCanvas.width / g.W);
    gl.uniform2f(u.uPrint, g.printX, g.yP);
    gl.uniform1f(u.uPitch, g.pitch);
    gl.uniform2f(u.uHead, this.headX(), this.headY());
    gl.uniform1f(u.uPlatenR, g.R);
    gl.uniform1f(u.uA1, A1);
    gl.uniform1f(u.uRc, g.Rc);
    gl.uniform4f(u.uSheet, 0, 0, SHEET_COLS, SHEET_LINES * LINE_UNITS);
    gl.uniform2f(u.uCarriage, CAR_LEFT, CAR_RIGHT);
    gl.uniform1f(u.uKnob, KNOB);
    gl.uniform1f(u.uRoll, (this.roll.x * g.lineH) / g.R);
    gl.uniform4f(u.uInkMap, INK_COL0, 0, 1 / INK_COLS, 1 / (SHEET_LINES * LINE_UNITS));
    gl.uniform2f(u.uInkTexel, 1 / this.ink.canvas.width, 1 / this.ink.canvas.height);
    gl.uniform3f(u.uEnamel, ENAMEL[0] / 255, ENAMEL[1] / 255, ENAMEL[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  wellPath(c) {
    const { printX, fy, wellR, wellA, L } = this.geo;
    const inner = 0.84 * L;
    c.moveTo(printX + Math.cos(Math.PI / 2 - wellA) * wellR, fy + Math.sin(Math.PI / 2 - wellA) * wellR);
    c.arc(printX, fy, wellR, Math.PI / 2 - wellA, Math.PI / 2 + wellA);
    c.arc(printX, fy, inner, Math.PI / 2 + wellA, Math.PI / 2 - wellA, true);
    c.closePath();
  }

  drawCache() {
    const g = this.geo;
    const c = this.cache.getContext("2d");
    const { W, H, dpr, printX, fy, yDeck, L, R, wellR, angles, spoolR, SX } = g;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cache.width, this.cache.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    c.save();
    c.beginPath();
    c.rect(0, yDeck, W, H - yDeck + 2);
    this.wellPath(c);
    c.clip("evenodd");
    const deck = c.createLinearGradient(0, yDeck, 0, H);
    deck.addColorStop(0, `rgb(${ENAMEL.map((v) => Math.round(v * 0.97)).join(" ")})`);
    deck.addColorStop(0.08, `rgb(${ENAMEL.join(" ")})`);
    deck.addColorStop(0.5, `rgb(${ENAMEL.map((v) => Math.round(v * 0.985)).join(" ")})`);
    deck.addColorStop(1, `rgb(${ENAMEL.map((v) => Math.round(v * 0.95)).join(" ")})`);
    c.fillStyle = deck;
    c.fillRect(0, yDeck, W, H - yDeck + 2);
    const grain = this.grainTile();
    c.fillStyle = c.createPattern(grain, "repeat");
    c.fillRect(0, yDeck, W, H - yDeck + 2);
    const under = c.createLinearGradient(0, yDeck, 0, yDeck + R * 0.9);
    under.addColorStop(0, "rgb(40 34 26 / 0.34)");
    under.addColorStop(0.25, "rgb(40 34 26 / 0.16)");
    under.addColorStop(0.6, "rgb(40 34 26 / 0.05)");
    under.addColorStop(1, "rgb(40 34 26 / 0)");
    c.fillStyle = under;
    c.fillRect(0, yDeck, W, R * 0.9);
    c.fillStyle = "rgb(255 255 255 / 0.5)";
    c.fillRect(0, yDeck, W, 1);

    for (const side of [-1, 1]) {
      const cx = printX + side * SX;
      const cy = yDeck + spoolR + 0.22 * L;
      c.save();
      c.beginPath();
      c.arc(cx, cy, spoolR * 1.1, 0, TAU);
      c.fillStyle = "rgb(36 33 30)";
      c.fill();
      c.clip();
      c.shadowColor = "rgb(0 0 0 / 0.7)";
      c.shadowBlur = 10;
      c.lineWidth = 8;
      c.strokeStyle = "rgb(0 0 0 / 1)";
      c.beginPath();
      c.arc(cx, cy, spoolR * 1.1 + 4, 0, TAU);
      c.stroke();
      c.restore();
      c.beginPath();
      c.arc(cx, cy, spoolR * 1.1, 0, TAU);
      c.lineWidth = 1.5;
      c.strokeStyle = "rgb(255 255 255 / 0.55)";
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, spoolR * 1.1 + 1.5, Math.PI * 0.15, Math.PI * 1.15);
      c.strokeStyle = "rgb(60 50 40 / 0.25)";
      c.stroke();
    }
    c.restore();

    c.save();
    c.beginPath();
    c.rect(0, yDeck, W, H - yDeck + 2);
    c.clip();
    c.beginPath();
    this.wellPath(c);
    c.save();
    c.clip();
    const well = c.createRadialGradient(printX, fy, L * 0.8, printX, fy, wellR);
    well.addColorStop(0, "rgb(30 28 26)");
    well.addColorStop(0.6, "rgb(24 22 21)");
    well.addColorStop(1, "rgb(14 13 12)");
    c.fillStyle = well;
    c.fillRect(0, 0, W, H);
    c.beginPath();
    c.arc(printX, fy, L * 2.06, Math.PI / 2 - g.wellA, Math.PI / 2 + g.wellA);
    c.arc(printX, fy, L * 1.86, Math.PI / 2 + g.wellA, Math.PI / 2 - g.wellA, true);
    c.closePath();
    c.fillStyle = "rgb(58 60 52)";
    c.fill();
    c.fillStyle = c.createPattern(grain, "repeat");
    c.fill();
    c.beginPath();
    c.arc(printX, fy, L * 1.1, Math.PI / 2 - g.wellA, Math.PI / 2 + g.wellA);
    c.arc(printX, fy, L * 0.9, Math.PI / 2 + g.wellA, Math.PI / 2 - g.wellA, true);
    c.closePath();
    const seg = c.createRadialGradient(printX, fy, L * 0.9, printX, fy, L * 1.1);
    seg.addColorStop(0, "rgb(70 72 75)");
    seg.addColorStop(0.5, "rgb(120 122 126)");
    seg.addColorStop(1, "rgb(64 66 69)");
    c.fillStyle = seg;
    c.fill();
    c.strokeStyle = "rgb(20 20 22 / 0.8)";
    c.lineWidth = 1;
    for (const a of angles) {
      const ux = Math.sin(a);
      const uy = Math.cos(a);
      c.beginPath();
      c.moveTo(printX + ux * L * 0.9, fy + uy * L * 0.9);
      c.lineTo(printX + ux * L * 1.1, fy + uy * L * 1.1);
      c.stroke();
    }
    c.shadowColor = "rgb(0 0 0 / 0.75)";
    c.shadowBlur = 14;
    c.lineWidth = 10;
    c.strokeStyle = "rgb(0 0 0)";
    c.beginPath();
    this.wellPath(c);
    c.stroke();
    c.restore();
    c.beginPath();
    this.wellPath(c);
    c.lineWidth = 1.25;
    c.strokeStyle = "rgb(255 255 255 / 0.45)";
    c.stroke();
    c.restore();

    const lampX = -0.18 * W;
    const lampY = -0.3 * H;
    const diag = Math.hypot(W, H);
    const lamp = c.createRadialGradient(lampX, lampY, diag * 0.3, lampX, lampY, diag * 1.3);
    lamp.addColorStop(0, "rgb(255 255 255)");
    lamp.addColorStop(0.35, "rgb(246 246 246)");
    lamp.addColorStop(0.7, "rgb(228 228 228)");
    lamp.addColorStop(1, "rgb(214 214 214)");
    c.save();
    c.globalCompositeOperation = "multiply";
    c.fillStyle = lamp;
    c.fillRect(0, yDeck, W, H - yDeck + 2);
    c.restore();
    c.save();
    c.globalCompositeOperation = "destination-in";
    c.fillStyle = "#000";
    c.beginPath();
    c.rect(0, yDeck, W, H - yDeck + 2);
    c.fill();
    c.restore();
  }

  grainTile() {
    if (this.grain) return this.grain;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const r = seeded(4242);
    for (let i = 0; i < size * size; i += 1) {
      const v = r();
      const light = v > 0.5;
      img.data[i * 4] = light ? 255 : 40;
      img.data[i * 4 + 1] = light ? 255 : 34;
      img.data[i * 4 + 2] = light ? 255 : 28;
      img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * 16);
    }
    ctx.putImageData(img, 0, 0);
    this.grain = canvas;
    return canvas;
  }

  barPose(index, theta) {
    const { printX, fy, L, angles } = this.geo;
    const a = angles[index];
    const ux = Math.sin(a);
    const uy = Math.cos(a);
    const px = printX + ux * L;
    const py = fy + uy * L;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const wx = px + ux * L * ct;
    const wy = py + uy * L * ct;
    const z = L * st;
    const D = 2.5 * L;
    const s = D / Math.max(D * 0.2, D - z);
    return { a, ux, uy, px, py, sx: printX + (wx - printX) * s, sy: fy + (wy - fy) * s, z, s, st, theta };
  }

  drawBar(c, pose, flying) {
    const { L, pitch } = this.geo;
    const { a, px, py, sx, sy, z, s, st, theta } = pose;
    const w = L * 0.042 * (1 + (s - 1) * 0.9);
    c.save();
    if (flying) {
      c.shadowColor = `rgb(20 16 10 / ${(0.12 + 0.2 * st).toFixed(3)})`;
      c.shadowBlur = 3 + 7 * st;
      c.shadowOffsetX = 1 + z * 0.26;
      c.shadowOffsetY = 2 + z * 0.36;
    }
    c.lineCap = "round";
    c.strokeStyle = "rgb(52 54 57)";
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(sx, sy);
    c.stroke();
    c.shadowColor = "transparent";
    c.strokeStyle = "rgb(178 181 185)";
    c.lineWidth = w * 0.32;
    c.beginPath();
    c.moveTo(px - w * 0.18, py - w * 0.18);
    c.lineTo(sx - w * 0.18, sy - w * 0.18);
    c.stroke();
    c.restore();

    const face = Math.sin(Math.min(Math.PI, theta) * 0.5);
    const restW = Math.max(3, ((2 * this.geo.A) / (this.geo.angles.length - 1)) * 2 * L * 0.85);
    const sw = (restW + (pitch * 1.15 - restW) * face) * s;
    const sh = L * (0.13 + 0.05 * face) * s;
    c.save();
    c.translate(sx, sy);
    c.rotate(-a);
    if (flying) {
      c.shadowColor = `rgb(20 16 10 / ${(0.15 + 0.22 * st).toFixed(3)})`;
      c.shadowBlur = 3 + 8 * st;
      c.shadowOffsetX = 1 + z * 0.26;
      c.shadowOffsetY = 2 + z * 0.36;
    }
    const grad = c.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2);
    grad.addColorStop(0, "rgb(196 198 201)");
    grad.addColorStop(0.45, "rgb(120 122 126)");
    grad.addColorStop(1, "rgb(58 60 63)");
    c.fillStyle = grad;
    c.beginPath();
    c.roundRect(-sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) * 0.2);
    c.fill();
    c.restore();
  }

  ribbonLift() {
    let lift = 0;
    for (const b of this.bars) {
      const t = b.t;
      let v = 0;
      if (t < UP) v = t / UP;
      else v = 1 - clamp((t - UP) / (DOWN * 0.75), 0, 1);
      v = v * v * (3 - 2 * v);
      lift = Math.max(lift, v);
    }
    return lift;
  }

  drawOverlay() {
    const g = this.geo;
    const c = this.ctx;
    const { W, H, dpr, printX, yP, lineH, L, RS, spoolR, SX, yDeck } = g;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hx = this.headX();

    this.drawBail(c, hx);
    this.drawLever(c, hx);

    c.drawImage(this.cache, 0, 0, W, H);

    const flying = [];
    for (const b of this.bars) flying[b.index] = b;
    c.save();
    c.beginPath();
    c.rect(0, yDeck, W, H - yDeck);
    c.clip();
    c.beginPath();
    this.wellPath(c);
    c.clip();
    for (let i = 0; i < g.angles.length; i += 1) {
      if (flying[i]) continue;
      this.drawBar(c, this.barPose(i, 0), false);
    }
    c.restore();

    for (const side of [-1, 1]) {
      const cx = printX + side * SX;
      const cy = yDeck + spoolR + 0.22 * L;
      const rot = this.spool * (side < 0 ? 1 : 0.92);
      c.save();
      c.translate(cx, cy);
      const coil = c.createRadialGradient(-spoolR * 0.2, -spoolR * 0.25, spoolR * 0.1, 0, 0, spoolR * 0.9);
      coil.addColorStop(0, "rgb(52 50 52)");
      coil.addColorStop(0.7, "rgb(30 29 31)");
      coil.addColorStop(1, "rgb(18 17 18)");
      c.fillStyle = coil;
      c.beginPath();
      c.arc(0, 0, spoolR * (side < 0 ? 0.92 : 0.8), 0, TAU);
      c.fill();
      c.strokeStyle = "rgb(255 255 255 / 0.05)";
      c.lineWidth = 1;
      for (let k = 1; k < 6; k += 1) {
        c.beginPath();
        c.arc(0, 0, spoolR * (0.36 + k * 0.1), 0, TAU);
        c.stroke();
      }
      c.rotate(rot);
      const hub = c.createLinearGradient(-spoolR * 0.4, -spoolR * 0.4, spoolR * 0.4, spoolR * 0.4);
      hub.addColorStop(0, "rgb(232 233 235)");
      hub.addColorStop(0.5, "rgb(150 152 156)");
      hub.addColorStop(1, "rgb(92 94 98)");
      c.fillStyle = hub;
      c.beginPath();
      c.arc(0, 0, spoolR * 0.36, 0, TAU);
      c.fill();
      c.fillStyle = "rgb(30 29 31)";
      for (let k = 0; k < 3; k += 1) {
        const ang = (k * TAU) / 3;
        c.beginPath();
        c.arc(Math.cos(ang) * spoolR * 0.2, Math.sin(ang) * spoolR * 0.2, spoolR * 0.07, 0, TAU);
        c.fill();
      }
      c.beginPath();
      c.arc(0, 0, spoolR * 0.06, 0, TAU);
      c.fill();
      c.restore();
    }

    const lift = this.ribbonLift();
    const top0 = yP + lineH * 0.34;
    const hR = lineH * 1.45;
    const liftPx = lineH * 1.0 * lift;
    const spoolY = yDeck + spoolR + 0.22 * L;
    const reach = SX - spoolR * 0.15;
    const N = 48;
    const smooth = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const shape = (x) => {
      const t = Math.abs(x - printX) / reach;
      const span = RS / reach;
      const hump = 1 - smooth(0, span, t);
      const fall = smooth(span * 0.92, 1, t);
      const mid = top0 + hR * 0.5 - liftPx * hump;
      const cy = mid + (spoolY - spoolR * 0.78 - mid) * fall;
      const h = hR * (1 - 0.86 * smooth(span * 0.85, 1, t));
      return [cy - h / 2, h];
    };
    const band = (from, to) => {
      c.beginPath();
      for (let i = 0; i <= N; i += 1) {
        const x = printX - reach + (2 * reach * i) / N;
        const [y, h] = shape(x);
        if (i === 0) c.moveTo(x, y + h * from);
        else c.lineTo(x, y + h * from);
      }
      for (let i = N; i >= 0; i -= 1) {
        const x = printX - reach + (2 * reach * i) / N;
        const [y, h] = shape(x);
        c.lineTo(x, y + h * to);
      }
      c.closePath();
    };
    c.save();
    c.shadowColor = "rgb(20 14 8 / 0.34)";
    c.shadowBlur = 10;
    c.shadowOffsetX = 3;
    c.shadowOffsetY = 5 + lift * 3;
    band(0, 1);
    c.fillStyle = "rgb(24 24 27)";
    c.fill();
    c.restore();
    band(0.5, 1);
    c.fillStyle = "rgb(112 28 28)";
    c.fill();
    band(0, 1);
    c.save();
    c.globalAlpha = 0.14;
    c.fillStyle = this.weavePattern;
    c.fill();
    c.restore();
    const gloss = c.createLinearGradient(0, top0 - liftPx, 0, top0 - liftPx + hR);
    gloss.addColorStop(0, "rgb(255 255 255 / 0.2)");
    gloss.addColorStop(0.06, "rgb(255 255 255 / 0.07)");
    gloss.addColorStop(0.3, "rgb(255 255 255 / 0.02)");
    gloss.addColorStop(0.5, "rgb(0 0 0 / 0)");
    gloss.addColorStop(0.8, "rgb(0 0 0 / 0.1)");
    gloss.addColorStop(1, "rgb(0 0 0 / 0.32)");
    c.fillStyle = gloss;
    c.fill();
    const fade = c.createLinearGradient(printX - reach, 0, printX + reach, 0);
    fade.addColorStop(0, "rgb(0 0 0 / 0.45)");
    fade.addColorStop(0.18, "rgb(0 0 0 / 0.1)");
    fade.addColorStop(0.32, "rgb(0 0 0 / 0)");
    fade.addColorStop(0.68, "rgb(0 0 0 / 0)");
    fade.addColorStop(0.82, "rgb(0 0 0 / 0.1)");
    fade.addColorStop(1, "rgb(0 0 0 / 0.45)");
    c.fillStyle = fade;
    c.fill();
    for (const side of [-1, 1]) {
      const gx = printX + side * RS;
      const [gy, gh] = shape(gx);
      const post = c.createLinearGradient(gx - 4, 0, gx + 4, 0);
      post.addColorStop(0, "rgb(120 122 126)");
      post.addColorStop(0.35, "rgb(236 237 239)");
      post.addColorStop(1, "rgb(96 98 102)");
      c.save();
      c.shadowColor = "rgb(20 14 8 / 0.3)";
      c.shadowBlur = 4;
      c.shadowOffsetX = 2;
      c.shadowOffsetY = 3;
      c.fillStyle = post;
      c.beginPath();
      c.roundRect(gx - 3, gy - 3, 6, gh + 6, 3);
      c.fill();
      c.restore();
    }
    this.drawGuide(c);

    for (const b of this.bars) {
      const theta = this.barTheta(b.t);
      this.drawBar(c, this.barPose(b.index, theta), true);
    }
  }

  drawGuide(c) {
    const { printX, yP, lineH, pitch } = this.geo;
    const y = yP + lineH * 0.3;
    const h = Math.max(6, lineH * 0.34);
    const half = pitch * 4.5;
    c.save();
    c.shadowColor = "rgb(20 14 8 / 0.3)";
    c.shadowBlur = 4;
    c.shadowOffsetX = 1;
    c.shadowOffsetY = 2;
    const plate = c.createLinearGradient(0, y, 0, y + h);
    plate.addColorStop(0, "rgb(246 246 247)");
    plate.addColorStop(0.3, "rgb(196 198 201)");
    plate.addColorStop(1, "rgb(128 130 134)");
    c.fillStyle = plate;
    const notch = Math.min(h * 0.6, pitch * 0.4);
    c.beginPath();
    c.moveTo(printX - half, y + 2);
    c.quadraticCurveTo(printX - half, y, printX - half + 2, y);
    c.lineTo(printX - notch, y);
    c.lineTo(printX, y + notch);
    c.lineTo(printX + notch, y);
    c.lineTo(printX + half - 2, y);
    c.quadraticCurveTo(printX + half, y, printX + half, y + 2);
    c.lineTo(printX + half, y + h);
    c.lineTo(printX - half, y + h);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = "rgb(40 40 44 / 0.6)";
    c.lineWidth = 1;
    for (let k = -4; k <= 4; k += 1) {
      if (k === 0) continue;
      const x = Math.round(printX + k * pitch) + 0.5;
      const long = k % 5 === 0;
      c.beginPath();
      c.moveTo(x, y + h * 0.3);
      c.lineTo(x, y + h * (long ? 0.85 : 0.6));
      c.stroke();
    }
  }

  drawBail(c, hx) {
    const { W, printX, yP, lineH, pitch } = this.geo;
    const d = this.arcToScreen(lineH * 7.2);
    const y = yP - d;
    if (y < -20) return;
    const xl = Math.max(-10, printX + (CAR_LEFT + 2.5 - hx) * pitch);
    const xr = Math.min(W + 10, printX + (CAR_RIGHT - 2.5 - hx) * pitch);
    if (xr <= xl) return;
    const rod = Math.max(4, pitch * 0.3);
    const shade = c.createLinearGradient(0, y, 0, y + rod * 3.2);
    shade.addColorStop(0, "rgb(40 30 20 / 0.12)");
    shade.addColorStop(0.4, "rgb(40 30 20 / 0.05)");
    shade.addColorStop(1, "rgb(40 30 20 / 0)");
    c.fillStyle = shade;
    c.fillRect(xl + 4, y + rod * 0.6, xr - xl, rod * 3.2);
    const metal = c.createLinearGradient(0, y - rod / 2, 0, y + rod / 2);
    metal.addColorStop(0, "rgb(250 250 251)");
    metal.addColorStop(0.35, "rgb(206 208 211)");
    metal.addColorStop(0.7, "rgb(110 112 116)");
    metal.addColorStop(1, "rgb(160 162 166)");
    c.fillStyle = metal;
    c.fillRect(xl, y - rod / 2, xr - xl, rod);
    for (const X of [14, 71]) {
      const x = printX + (X - hx) * pitch;
      if (x < -60 || x > W + 60) continue;
      const rw = pitch * 1.9;
      const rh = rod * 2.3;
      c.save();
      c.shadowColor = "rgb(30 20 10 / 0.3)";
      c.shadowBlur = 4;
      c.shadowOffsetX = 2;
      c.shadowOffsetY = 3;
      const rub = c.createLinearGradient(0, y - rh / 2, 0, y + rh / 2);
      rub.addColorStop(0, "rgb(96 94 92)");
      rub.addColorStop(0.3, "rgb(52 50 50)");
      rub.addColorStop(1, "rgb(22 21 21)");
      c.fillStyle = rub;
      c.beginPath();
      c.roundRect(x - rw / 2, y - rh / 2, rw, rh, rh * 0.45);
      c.fill();
      c.restore();
    }
  }

  drawLever(c, hx) {
    const { printX, yP, lineH, pitch, R } = this.geo;
    const baseX = printX + (CAR_LEFT + 1 - hx) * pitch;
    if (baseX < -lineH * 6) return;
    const baseY = yP - R * 0.25;
    const ang = -2.55 + this.lever.x * 0.3;
    const len = lineH * 3.4;
    const ex = baseX + Math.cos(ang) * len;
    const ey = baseY + Math.sin(ang) * len;
    c.save();
    c.shadowColor = "rgb(20 14 8 / 0.3)";
    c.shadowBlur = 6;
    c.shadowOffsetX = 3;
    c.shadowOffsetY = 5;
    c.lineCap = "round";
    c.strokeStyle = "rgb(150 152 156)";
    c.lineWidth = pitch * 0.42;
    c.beginPath();
    c.moveTo(baseX, baseY);
    c.lineTo(ex, ey);
    c.stroke();
    c.shadowColor = "transparent";
    c.strokeStyle = "rgb(236 237 239)";
    c.lineWidth = pitch * 0.14;
    c.beginPath();
    c.moveTo(baseX - 1, baseY - 2);
    c.lineTo(ex - 1, ey - 2);
    c.stroke();
    c.translate(ex, ey);
    c.rotate(ang + Math.PI / 2);
    const pad = c.createLinearGradient(-pitch, 0, pitch, 0);
    pad.addColorStop(0, "rgb(246 246 247)");
    pad.addColorStop(0.5, "rgb(180 182 186)");
    pad.addColorStop(1, "rgb(110 112 116)");
    c.fillStyle = pad;
    c.beginPath();
    c.roundRect(-pitch * 1.1, -pitch * 0.45, pitch * 2.2, pitch * 0.9, pitch * 0.45);
    c.fill();
    c.restore();
    const boss = c.createRadialGradient(baseX - pitch * 0.2, baseY - pitch * 0.25, 1, baseX, baseY, pitch * 0.75);
    boss.addColorStop(0, "rgb(250 250 251)");
    boss.addColorStop(0.5, "rgb(170 172 176)");
    boss.addColorStop(1, "rgb(80 82 86)");
    c.fillStyle = boss;
    c.beginPath();
    c.arc(baseX, baseY, pitch * 0.7, 0, TAU);
    c.fill();
  }

  barTheta(t) {
    if (this.reduced) return 0;
    if (t < UP) {
      const k = t / UP;
      return Math.PI * Math.pow(k, 1.6);
    }
    const k = clamp((t - UP) / DOWN, 0, 1);
    return Math.PI * (1 - (1 - Math.pow(1 - k, 3)));
  }

  keyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target && target !== this.stage && target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (target && target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    const key = e.key;
    if (key === "ArrowUp" || key === "ArrowDown") {
      e.preventDefault();
      this.rollBy(key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.repeat) {
      if (key.length === 1 || key === "Enter" || key === "Backspace") e.preventDefault();
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      this.flash("return");
      this.carriageReturn();
    } else if (key === "Backspace" || key === "ArrowLeft") {
      e.preventDefault();
      this.flash("back");
      this.backspace();
    } else if (key === " " || key === "ArrowRight") {
      e.preventDefault();
      this.flash(" ");
      this.space();
    } else if (key.length === 1) {
      if (!BARS.map.has(key)) return;
      e.preventDefault();
      this.flash(key.toLowerCase());
      this.press(key);
    }
  }

  pressKey(key) {
    this.sound.unlock();
    if (key === "return") this.carriageReturn();
    else if (key === "back") this.backspace();
    else if (key === " ") this.space();
    else if (key === "shift") {
      this.shift = !this.shift;
      this.onShift?.(this.shift);
    } else {
      const ch = this.shift ? key.toUpperCase() : key;
      if (this.shift) {
        this.shift = false;
        this.onShift?.(false);
      }
      this.press(ch);
    }
    this.flash(key);
  }

  flash(key) {
    const el = this.keyMap.get(key);
    if (!el) return;
    el.setAttribute("data-down", "");
    this.keyFx = this.keyFx.filter((k) => k.el !== el);
    this.keyFx.push({ el, t0: -1 });
    this.wake();
  }

  settleHead() {
    if (this.car.mode === "coast" || this.car.mode === "drag") {
      this.col = clamp(Math.round(this.car.x), 0, MAX_COL);
      this.car.mode = "spring";
    }
    if (this.roll.mode === "coast") {
      this.line = clamp(Math.round(this.roll.x), 0, LAST_LINE);
      this.roll.mode = "spring";
      this.roll.target = this.line;
    }
  }

  press(ch) {
    if (this.ejecting || !this.ready) return;
    this.sound.unlock();
    const bar = BARS.map.get(ch);
    if (!bar) return;
    if (this.drag && this.drag.axis) return;
    this.settleHead();
    const strike = this.makeStrike(ch, this.col, this.line);
    const advance = this.col < MAX_COL;
    if (advance) this.col += 1;
    strike.bell = advance && this.col === BELL_COL;
    this.bars.push({ index: bar.index, strike, t0: -1, t: 0, hit: false, advance });
    this.wake();
  }

  space() {
    if (this.ejecting || !this.ready) return;
    this.sound.unlock();
    this.settleHead();
    if (this.col < MAX_COL) {
      this.col += 1;
      if (this.col === BELL_COL) this.sound.bell();
    }
    this.sound.space();
    this.wake();
  }

  backspace() {
    if (this.ejecting || !this.ready) return;
    this.sound.unlock();
    this.settleHead();
    if (this.col > 0) this.col -= 1;
    this.sound.backspace();
    this.wake();
  }

  rollBy(n) {
    if (this.ejecting || !this.ready) return;
    this.sound.unlock();
    this.settleHead();
    this.line = clamp(this.line + n, 0, LAST_LINE);
    this.roll.target = this.line;
    this.roll.mode = "spring";
    this.sound.ratchet(0.8);
    this.wake();
  }

  carriageReturn(fromLever = false) {
    if (this.ejecting || !this.ready) return;
    this.sound.unlock();
    this.settleHead();
    if (this.line >= LAST_LINE) {
      this.eject();
      return;
    }
    this.line += 1;
    this.roll.target = this.line;
    this.roll.mode = "spring";
    this.sound.ratchet(1);
    if (!fromLever) {
      const dist = this.car.x;
      this.col = 0;
      this.car.mode = "return";
      if (this.car.v > 0) this.car.v = 0;
      if (dist > 0.5) this.sound.slide(dist / VMAX + 0.07);
      this.lever.v -= 9;
    }
    this.wake();
  }

  eject() {
    this.ejecting = true;
    this.col = 0;
    this.car.mode = "return";
    this.roll.mode = "eject";
    this.roll.target = this.line + 34;
    this.sound.slide(0.5);
    this.wake();
  }

  pointerDown(e) {
    if (e.button > 0 || !this.ready) return;
    if (e.target.closest?.("button, a, input")) return;
    this.sound.unlock();
    this.stage.setPointerCapture?.(e.pointerId);
    if (this.embedded) this.stage.focus({ preventScroll: true });
    const rect = this.stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this.car.mode === "coast") this.car.v = 0;
    if (this.roll.mode === "coast") this.roll.v = 0;
    this.drag = { id: e.pointerId, x0: x, y0: y, x, y, px: x, py: y, axis: null, vx: 0, vy: 0, released: false, fed: false };
    this.stage.setAttribute("data-grabbing", "");
    this.wake();
  }

  pointerMove(e) {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    const rect = this.stage.getBoundingClientRect();
    g.x = e.clientX - rect.left;
    g.y = e.clientY - rect.top;
    this.wake();
  }

  pointerUp(e) {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    g.released = true;
    this.stage.removeAttribute("data-grabbing");
    this.wake();
  }

  tap() {
    if (!this.embedded) return;
    const ch = SCRIPT[this.script % SCRIPT.length];
    this.script += 1;
    if (ch === "\n") this.carriageReturn();
    else if (ch === " ") this.space();
    else this.press(ch);
  }

  stepDrag(dt) {
    const g = this.drag;
    if (!g) return false;
    const { pitch, lineH } = this.geo;
    const k = 1 - Math.exp(-dt / 0.035);
    g.vx += ((g.x - g.px) / dt - g.vx) * k;
    g.vy += ((g.y - g.py) / dt - g.vy) * k;
    g.px = g.x;
    g.py = g.y;
    const tx = g.x - g.x0;
    const ty = g.y - g.y0;
    if (!g.axis && Math.hypot(tx, ty) > 7 && !this.ejecting) {
      g.axis = Math.abs(tx) > Math.abs(ty) ? "h" : "v";
      g.x0 = g.x;
      g.y0 = g.y;
      this.settleHead();
      if (g.axis === "h") {
        if (tx > 0) {
          g.fed = true;
          this.carriageReturn(true);
        }
        g.car0 = this.car.x;
        this.car.mode = "drag";
      } else {
        g.roll0 = this.roll.x;
        this.roll.mode = "drag";
        g.tick = Math.round(this.roll.x);
      }
    }
    if (g.axis === "h") {
      const x = clamp(g.car0 - (g.x - g.x0) / pitch, 0, MAX_COL);
      this.car.v = (x - this.car.x) / dt;
      this.car.x = x;
      this.col = clamp(Math.round(x), 0, MAX_COL);
      this.lever.x = clamp((g.x - g.x0) / (pitch * 8), 0, 1);
      this.lever.v = 0;
    } else if (g.axis === "v") {
      const y = clamp(g.roll0 + (g.y0 - g.y) / lineH, -0.6, LAST_LINE + 0.6);
      this.roll.v = (y - this.roll.x) / dt;
      this.roll.x = y;
      const tick = Math.round(y);
      if (tick !== g.tick) {
        g.tick = tick;
        this.sound.ratchet(0.55);
      }
      this.line = clamp(tick, 0, LAST_LINE);
    }
    if (g.released) {
      if (g.axis === "h") {
        this.car.mode = "coast";
        this.car.v = clamp(-g.vx / pitch, -VMAX, VMAX);
        this.car.tick = Math.round(this.car.x);
      } else if (g.axis === "v") {
        this.roll.mode = "coast";
        this.roll.v = clamp(-g.vy / lineH, -36, 36);
        this.roll.tick = Math.round(this.roll.x);
      } else {
        this.tap();
      }
      this.drag = null;
    }
    return true;
  }

  stepBars(now) {
    if (!this.bars.length) return false;
    let pending = 0;
    for (const b of this.bars) {
      if (b.t0 < 0) b.t0 = now;
      b.t = (now - b.t0) / 1000;
      if (!b.hit && (b.t >= UP || this.reduced)) {
        b.hit = true;
        this.impact(b);
      }
      if (!b.hit && b.advance) pending += 1;
    }
    this.pending = pending;
    this.bars = this.bars.filter((b) => !(b.hit && (this.reduced || b.t >= UP + DOWN)));
    return true;
  }

  impact(b) {
    const s = b.strike;
    this.strikes.push(s);
    this.dirty.push(this.ink.stamp(s));
    const pan = clamp((this.geo.angles[b.index] || 0) * 0.5, -0.6, 0.6);
    this.sound.strike(s.force, pan, s.weave[0] - 0.5);
    if (b.advance) this.sound.escape();
    if (s.bell) this.sound.bell();
    this.spool += 0.035;
  }

  stepCarriage(dt) {
    const car = this.car;
    if (car.mode === "drag") return true;
    const target = clamp(this.col - (this.pending || 0), 0, MAX_COL);
    if (this.reduced && car.mode !== "coast") {
      const moved = car.x !== target;
      car.x = target;
      car.v = 0;
      car.mode = "spring";
      return moved;
    }
    if (car.mode === "return") {
      car.v = Math.max(-VMAX, car.v - ACCEL * dt);
      car.x += car.v * dt;
      if (car.x <= target) {
        const hit = Math.min(1, Math.abs(car.v) / VMAX);
        car.x = target;
        car.v *= 0.06;
        car.mode = "settle";
        this.sound.thunk(hit);
        this.lever.v += 4 * hit;
      }
      return true;
    }
    if (car.mode === "coast") {
      car.v *= Math.exp(-3.2 * dt);
      car.x += car.v * dt;
      if (car.x <= 0) {
        if (Math.abs(car.v) > 25) this.sound.thunk(Math.min(1, Math.abs(car.v) / VMAX));
        car.x = 0;
        car.v = 0;
      } else if (car.x >= MAX_COL) {
        car.x = MAX_COL;
        car.v = 0;
      }
      const tick = Math.round(car.x);
      if (tick !== car.tick) {
        car.tick = tick;
        if (Math.abs(car.v) < 60) this.sound.escape();
      }
      if (Math.abs(car.v) < 3) {
        this.col = clamp(Math.round(car.x), 0, MAX_COL);
        car.mode = "spring";
      }
      return true;
    }
    if (car.mode === "settle") {
      const moving = springStep(car, target, 46, 0.62, dt);
      if (!moving) car.mode = "spring";
      return moving;
    }
    return springStep(car, target, 58, 1, dt);
  }

  stepRoll(dt) {
    const roll = this.roll;
    if (roll.mode === "drag") return true;
    if (this.reduced && roll.mode !== "coast" && !this.ejecting) {
      const moved = roll.x !== roll.target;
      roll.x = roll.target;
      roll.v = 0;
      return moved;
    }
    if (roll.mode === "eject") {
      springStep(roll, roll.target, 6.5, 1, dt);
      if (this.reduced || roll.x > roll.target - 4) {
        this.strikes = [];
        this.ink.clear();
        this.uploadInk(null);
        this.dirty = [];
        this.line = 0;
        roll.x = this.reduced ? 0 : -7.5;
        roll.v = 0;
        roll.target = 0;
        roll.mode = "feed";
        this.ejecting = false;
        this.sound.slide(0.35);
      }
      return true;
    }
    if (roll.mode === "coast") {
      roll.v *= Math.exp(-4.5 * dt);
      roll.x += roll.v * dt;
      if (roll.x < 0 || roll.x > LAST_LINE) {
        roll.x = clamp(roll.x, 0, LAST_LINE);
        roll.v = 0;
      }
      const tick = Math.round(roll.x);
      if (tick !== roll.tick) {
        roll.tick = tick;
        this.sound.ratchet(0.45);
      }
      if (Math.abs(roll.v) < 1.2) {
        this.line = clamp(Math.round(roll.x), 0, LAST_LINE);
        roll.target = this.line;
        roll.mode = "spring";
      }
      return true;
    }
    if (roll.mode === "feed") {
      const moving = springStep(roll, roll.target, 8, 1, dt);
      if (!moving) roll.mode = "spring";
      return moving;
    }
    return springStep(roll, roll.target, 26, 1, dt);
  }

  stepLever(dt) {
    if (this.drag && this.drag.axis === "h") return true;
    if (this.reduced) {
      const moved = this.lever.x !== 0;
      this.lever.x = 0;
      this.lever.v = 0;
      return moved;
    }
    return springStep(this.lever, 0, 18, 0.9, dt);
  }

  stepKeys(now) {
    if (!this.keyFx.length) return false;
    this.keyFx = this.keyFx.filter((k) => {
      if (k.t0 < 0) k.t0 = now;
      if (now - k.t0 > 130) {
        k.el.removeAttribute("data-down");
        return false;
      }
      return true;
    });
    return true;
  }

  flushInk() {
    if (!this.dirty.length) return;
    for (const r of this.dirty) this.uploadInk(r);
    this.dirty = [];
  }

  wake() {
    if (this.raf || this.destroyed || !this.gl || !this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  checkVisibility() {
    if (document.hidden || !this.visible) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.wake();
  }

  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.geo) return;
    const dt = this.last ? clamp((now - this.last) / 1000, 1 / 480, 0.05) : 1 / 60;
    this.last = now;
    let busy = false;
    if (this.stepDrag(dt)) busy = true;
    if (this.stepBars(now)) busy = true;
    else this.pending = 0;
    if (this.stepCarriage(dt)) busy = true;
    if (this.stepRoll(dt)) busy = true;
    if (this.stepLever(dt)) busy = true;
    if (this.stepKeys(now)) busy = true;
    this.flushInk();
    this.render();
    if (busy) this.raf = requestAnimationFrame(this.frame);
  }

  setSound(on) {
    this.sound.setEnabled(on);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.glCanvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.stage.removeEventListener("pointerdown", this.handlers.down);
    this.stage.removeEventListener("pointermove", this.handlers.move);
    this.stage.removeEventListener("pointerup", this.handlers.up);
    this.stage.removeEventListener("pointercancel", this.handlers.up);
    (this.embedded ? this.stage : window).removeEventListener("keydown", this.handlers.key);
    for (const k of this.keyFx) k.el.removeAttribute("data-down");
    this.sound.destroy();
    const gl = this.gl;
    if (!gl) return;
    gl.deleteTexture(this.inkTex);
    gl.deleteTexture(this.materialTex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
