import InkSheet, { seeded } from "./typewriterInk";
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
const VMAX = 170;
const ACCEL = 2600;
const FOLLOW = 0.8;
const ENAMEL = [226, 223, 216];
const CHARCOAL = "rgb(30 30 32)";
const RIBBON_RED = "rgb(196 52 40)";
const PERIOD = 20;
const TILE = 512;
const NARROW_COLS = [MARGIN_COLS - 2, MARGIN_COLS + MAX_COL + 3];

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
  constructor({ stage, glCanvas, overlay, embedded, insets, onReady, onFail }) {
    this.stage = stage;
    this.glCanvas = glCanvas;
    this.overlay = overlay;
    this.embedded = embedded;
    this.insets = insets;
    this.onReady = onReady;
    this.onFail = onFail;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sound = new TypewriterSound();
    this.rand = seeded(20261017);
    this.seed = 1;
    this.strikes = [];
    this.bars = [];
    this.dirty = [];
    this.col = START.col;
    this.line = START.line;
    this.car = { x: START.col, v: 0, mode: "spring" };
    this.roll = { x: START.line, v: 0, mode: "spring", target: START.line };
    this.lever = { x: 0, v: 0 };
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
    const gut = W < 640 ? 16 : 40;
    const fit = (W - gut * 2) / (SHEET_COLS + MAX_COL * (1 - FOLLOW));
    const wide = fit >= 9;
    const pitch = wide ? clamp(Math.min(fit, H / 44), 9, 15) : Math.min((W - gut * 2) / (NARROW_COLS[1] - NARROW_COLS[0]), 15);
    const lineH = pitch * LINE_UNITS;
    const top = Math.round(ins.top);
    const bottom = Math.round(H - ins.bottom);
    const yP = Math.round(clamp(top + (bottom - top) * (wide ? 0.56 : 0.62), top + lineH * 4, bottom - lineH * 3));
    const printX = Math.round(W * 0.5);
    const box = { x0: gut, x1: W - gut, y0: top, y1: bottom };
    const angles = [];
    for (let i = 0; i < BARS.count; i += 1) angles.push(-0.9 + (1.8 * i) / (BARS.count - 1));
    const res = clamp(Math.round(pitch * dpr * 0.95), 16, 28);
    this.geo = { W, H, dpr, pitch, lineH, yP, printX, angles, wide, box };
    this.view = { x: this.viewTarget(), v: 0 };
    this.geo.printX = this.view.x;
    this.glCanvas.width = Math.round(W * dpr);
    this.glCanvas.height = Math.round(H * dpr);
    this.overlay.width = Math.round(W * dpr);
    this.overlay.height = Math.round(H * dpr);
    if (this.ink.setResolution(res)) this.rebuildInk();
    if (this.ready) this.render();
  }

  headX() {
    return MARGIN_COLS + this.car.x + 0.5;
  }

  viewTarget() {
    const { W, pitch, wide, box } = this.geo;
    const h = this.headX();
    if (wide) return W / 2 + (h - SHEET_COLS / 2) * pitch * FOLLOW;
    const span = (NARROW_COLS[1] - NARROW_COLS[0]) * pitch;
    const left = (box.x0 + box.x1 - span) / 2;
    return left + (h - NARROW_COLS[0]) * pitch;
  }

  stepView() {
    if (!this.view) return false;
    this.view.x = this.viewTarget();
    this.geo.printX = this.view.x;
    return false;
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
    gl.uniform1f(u.uDpr, this.glCanvas.width / g.W);
    gl.uniform2f(u.uPrint, g.printX, g.yP);
    gl.uniform1f(u.uPitch, g.pitch);
    gl.uniform2f(u.uHead, this.headX(), this.headY());
    gl.uniform4f(u.uSheet, 0, 0, SHEET_COLS, SHEET_LINES * LINE_UNITS);
    const span = Math.round((NARROW_COLS[1] - NARROW_COLS[0]) * g.pitch);
    const left = Math.round(g.wide ? g.printX - this.headX() * g.pitch : (g.box.x0 + g.box.x1 - span) / 2);
    const right = left + (g.wide ? Math.round(SHEET_COLS * g.pitch) : span);
    gl.uniform4f(u.uFrame, left, g.box.y0, right, g.box.y1);
    gl.uniform4f(u.uInkMap, INK_COL0, 0, 1 / INK_COLS, 1 / (SHEET_LINES * LINE_UNITS));
    gl.uniform2f(u.uInkTexel, 1 / this.ink.canvas.width, 1 / this.ink.canvas.height);
    gl.uniform3f(u.uEnamel, ENAMEL[0] / 255, ENAMEL[1] / 255, ENAMEL[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    const { dpr, printX, yP, lineH, pitch } = g;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const lift = this.ribbonLift();
    const rw = pitch * 2;
    const rh = Math.max(8, lineH * 0.5);
    const ry = yP + lineH * 0.3 + Math.max(6, lineH * 0.34) - lineH * 0.95 * lift;
    c.fillStyle = CHARCOAL;
    c.beginPath();
    c.roundRect(printX - rw / 2, ry, rw, rh, 2);
    c.fill();
    c.fillStyle = RIBBON_RED;
    c.beginPath();
    c.roundRect(printX - rw / 2, ry + rh / 2, rw, rh / 2, [0, 0, 2, 2]);
    c.fill();
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
      this.carriageReturn();
    } else if (key === "Backspace" || key === "ArrowLeft") {
      e.preventDefault();
      this.backspace();
    } else if (key === " " || key === "ArrowRight") {
      e.preventDefault();
      this.space();
    } else if (key.length === 1) {
      if (!BARS.map.has(key)) return;
      e.preventDefault();
      this.press(key);
    }
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
    this.sound.key(clamp((this.geo?.angles[bar.index] || 0) * 0.5, -0.6, 0.6));
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
    if (b.advance) this.sound.escape(0.032);
    if (s.bell) this.sound.bell();
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
    if (this.stepView()) busy = true;
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
