import {
  DISPLAY_FRAGMENT,
  INK_FRAGMENT,
  MAX_SEGMENTS,
  PAPER_FRAGMENT,
  PRINT_FRAGMENT,
  QUAD_VERTEX,
  VELOCITY_FRAGMENT,
} from "./inkDragShader";
import { DEFAULT_WORD, INKS, PAPER } from "./inkDragParams";
import { balanceLines, readCover } from "./inkDragArt";

const FONT_FAMILY = "InkDragLastik";
const FONT_URL = "/lastikfont.otf";
const MAX_SIM_PIXELS = 720000;
const MAX_DPR = 2;
const MAX_SPEED = 2400;
const FAST_FROM = 160;
const FAST_TO = 1700;
const PRINT_MS = 820;
const VELOCITY_LIFE_MS = 1400;
const QUEUE_LIMIT = 96;
const VELOCITY_SCALE = 0.5;
const MORPH_MS = 1300;
const MORPH_HOLD_MS = 760;
const IDLE_FIRST_MS = 2600;
const IDLE_MS = 6400;
const SWEEP_SEGMENTS = 6;

let fontPromise = null;

function loadFont() {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === "undefined") {
    fontPromise = Promise.resolve(false);
    return fontPromise;
  }
  const face = new FontFace(FONT_FAMILY, `url(${FONT_URL})`);
  fontPromise = face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      return true;
    })
    .catch(() => false);
  return fontPromise;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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

function link(gl, vertex, fragmentSource) {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
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
    uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(
      program,
      info.name,
    );
  }
  return { program, uniforms };
}

export default class InkDragEngine {
  constructor({ host, canvas, cursor, onStatus, onReady, onState }) {
    this.host = host;
    this.canvas = canvas;
    this.cursor = cursor;
    this.onStatus = onStatus;
    this.onReady = onReady;
    this.onState = onState;
    this.items = [];
    this.index = 0;
    this.kind = "cover";
    this.covers = new Map();
    this.waits = new Map();
    this.morph = null;
    this.idleTimer = 0;
    this.reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.ink = INKS[0];
    this.width = 0;
    this.height = 0;
    this.simWidth = 0;
    this.simHeight = 0;
    this.simScale = 1;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.frameCount = 0;
    this.clock = 0;
    this.visible = true;
    this.destroyed = false;
    this.fontReady = false;
    this.queue = [];
    this.pointer = null;
    this.releasing = null;
    this.velocityUntil = 0;
    this.drying = false;
    this.lastStir = 0;
    this.printStart = -1;
    this.dirty = true;
    this.status = "";
    this.segData = new Float32Array(MAX_SEGMENTS * 4);
    this.segVel = new Float32Array(MAX_SEGMENTS * 4);
    this.gl = null;
    this.interactive = false;
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: () => this.hideCursor(),
      visibility: () => this.checkVisibility(),
    };
  }

  start() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      this.setStatus("static");
      return false;
    }
    this.gl = gl;
    try {
      this.setupGl();
    } catch {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.setStatus("static");
      return false;
    }
    this.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    this.host.addEventListener("pointerdown", this.handlers.down);
    this.host.addEventListener("pointermove", this.handlers.move);
    this.host.addEventListener("pointerup", this.handlers.up);
    this.host.addEventListener("pointercancel", this.handlers.up);
    this.host.addEventListener("pointerleave", this.handlers.leave);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    loadFont()
      .then(() => this.coverReady())
      .then(() => {
        if (this.destroyed) return;
        this.fontReady = true;
        this.print(!this.reduced);
        this.onReady?.();
      });
    return true;
  }

  setupGl() {
    const gl = this.gl;
    const fullFloat = gl.getExtension("EXT_color_buffer_float");
    const halfFloat =
      fullFloat || gl.getExtension("EXT_color_buffer_half_float");
    this.interactive =
      Boolean(fullFloat) ||
      (Boolean(halfFloat) && this.renderable(gl.RGBA16F, gl.HALF_FLOAT));
    this.vertex = compile(gl, gl.VERTEX_SHADER, QUAD_VERTEX);
    this.programs = {
      paper: link(gl, this.vertex, PAPER_FRAGMENT),
      print: link(gl, this.vertex, PRINT_FRAGMENT),
      velocity: link(gl, this.vertex, VELOCITY_FRAGMENT),
      ink: link(gl, this.vertex, INK_FRAGMENT),
      display: link(gl, this.vertex, DISPLAY_FRAGMENT),
    };
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.maskCanvas = document.createElement("canvas");
    this.maskTexture = gl.createTexture();
    this.coverCanvas = document.createElement("canvas");
  }

  renderable(internal, type) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const ok =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(texture);
    return ok;
  }

  makeTarget(width, height, float) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (float)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        width,
        height,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  dropTarget(target) {
    if (!target || !this.gl) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  dropTargets() {
    for (const pair of [this.inkTargets, this.velTargets])
      if (pair) pair.forEach((t) => this.dropTarget(t));
    this.dropTarget(this.paperTarget);
    this.dropTarget(this.goalTarget);
    this.goalTarget = null;
    this.inkTargets = null;
    this.velTargets = null;
    this.paperTarget = null;
  }

  resize() {
    if (!this.gl) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr)
      return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.simScale = Math.min(1, Math.sqrt(MAX_SIM_PIXELS / (width * height)));
    this.simWidth = Math.max(8, Math.round(width * this.simScale));
    this.simHeight = Math.max(8, Math.round(height * this.simScale));
    this.dropTargets();
    const float = this.interactive;
    this.inkTargets = [
      this.makeTarget(this.simWidth, this.simHeight, float),
      this.makeTarget(this.simWidth, this.simHeight, float),
    ];
    this.velWidth = Math.max(4, Math.round(this.simWidth * VELOCITY_SCALE));
    this.velHeight = Math.max(4, Math.round(this.simHeight * VELOCITY_SCALE));
    this.velTargets = [
      this.makeTarget(this.velWidth, this.velHeight, float),
      this.makeTarget(this.velWidth, this.velHeight, float),
    ];
    this.paperTarget = this.makeTarget(
      this.canvas.width,
      this.canvas.height,
      false,
    );
    this.goalTarget = this.makeTarget(this.simWidth, this.simHeight, float);
    this.inkRead = 0;
    this.velRead = 0;
    this.renderPaper();
    if (this.fontReady) {
      this.drawMask();
      if (this.morph) {
        this.morph = null;
        this.scheduleIdle(IDLE_MS);
      }
      if (this.printStart < 0) this.runPrint(1);
    }
    this.dirty = true;
    this.wake();
  }

  renderPaper() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.paper;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paperTarget.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms.uPx, this.dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  currentItem() {
    return this.items[this.index] || null;
  }

  currentKind() {
    const item = this.currentItem();
    if (this.kind === "cover" && item && this.covers.get(item.cover))
      return "cover";
    return "title";
  }

  drawMask() {
    const item = this.currentItem();
    const wantsCover = this.currentKind() === "cover";
    const cover = wantsCover
      ? this.coverPixels(this.covers.get(item.cover))
      : null;
    if (wantsCover && !cover) this.covers.delete(item.cover);
    this.tone = cover ? 1 : 0;
    this.uploadMask(cover || this.titlePixels(item ? item.word : DEFAULT_WORD));
  }

  coverPixels(image) {
    const w = this.simWidth;
    const h = this.simHeight;
    const portrait = h > w * 1.1;
    const side = Math.round(
      Math.min(w * (portrait ? 0.78 : 0.5), h * (portrait ? 0.46 : 0.6)),
    );
    const x = Math.round((w - side) / 2);
    const y = Math.round(h * (portrait ? 0.48 : 0.5) - side / 2);
    this.extent = [x / w, (x + side) / w];
    return readCover(this.coverCanvas, image, w, h, x, y, side);
  }

  titlePixels(text) {
    const canvas = this.maskCanvas;
    canvas.width = this.simWidth;
    canvas.height = this.simHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const word = text.trim() || DEFAULT_WORD;
    const family = this.fontReady
      ? `"${FONT_FAMILY}", Georgia, serif`
      : "Georgia, serif";
    ctx.font = `100px ${family}`;
    const portrait = this.simHeight > this.simWidth * 1.1;
    const lines = portrait ? balanceLines(word, 3) : [word];
    const metrics = lines.map((line) => {
      const m = ctx.measureText(line);
      return {
        text: line,
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent,
        left: m.actualBoundingBoxLeft,
        width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      };
    });
    const gap = 14;
    const blockHeight =
      metrics.reduce((sum, m) => sum + m.ascent + m.descent, 0) +
      gap * (metrics.length - 1);
    const widest = Math.max(...metrics.map((m) => m.width));
    const fitWidth = (this.simWidth * (portrait ? 0.84 : 0.8)) / widest;
    const fitHeight =
      (this.simHeight * (portrait ? (lines.length > 1 ? 0.56 : 0.3) : 0.5)) /
      blockHeight;
    const scale = Math.min(fitWidth, fitHeight);
    const size = 100 * scale;
    const half = (widest * scale) / 2 / canvas.width;
    this.extent = [0.5 - half, 0.5 + half];
    ctx.font = `${size}px ${family}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.014;
    let top =
      canvas.height * (portrait ? 0.48 : 0.5) - (blockHeight * scale) / 2;
    for (const m of metrics) {
      const x = canvas.width / 2 - (m.width * scale) / 2 + m.left * scale;
      const y = top + m.ascent * scale;
      ctx.fillText(m.text, x, y);
      ctx.strokeText(m.text, x, y);
      top += (m.ascent + m.descent + gap) * scale;
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 2] = 128;
      data[i + 3] = 128;
    }
    return data;
  }

  uploadMask(pixels) {
    const gl = this.gl;
    const rows = this.simHeight;
    const stride = this.simWidth * 4;
    const flipped = new Uint8Array(pixels.length);
    for (let row = 0; row < rows; row += 1)
      flipped.set(
        pixels.subarray(row * stride, (row + 1) * stride),
        (rows - 1 - row) * stride,
      );
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.simWidth,
      this.simHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      flipped,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  runPrint(progress, into = null) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.print;
    const target = into || this.inkTargets[this.inkRead];
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.simWidth, this.simHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.uniform1i(uniforms.uMask, 0);
    gl.uniform2f(uniforms.uRes, this.simWidth, this.simHeight);
    gl.uniform1f(uniforms.uProgress, progress);
    gl.uniform1f(uniforms.uGain, this.ink.gain);
    gl.uniform1f(uniforms.uTone, this.tone || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (progress >= 1 && !into) {
      const vel = this.velTargets;
      for (const t of vel) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  print(animate) {
    if (!this.gl || !this.inkTargets) return;
    this.morph = null;
    this.drawMask();
    this.drying = false;
    this.velocityUntil = 0;
    this.queue.length = 0;
    this.releasing = null;
    if (this.pointer) this.pointer.points.length = 0;
    if (animate) {
      this.printStart = 0;
      this.runPrint(0);
    } else {
      this.printStart = -1;
      this.runPrint(1);
    }
    this.dirty = true;
    this.setStatus(this.interactive ? "wet" : "static");
    this.emitState();
    this.scheduleIdle(animate ? IDLE_FIRST_MS + PRINT_MS : IDLE_MS);
    this.wake();
  }

  emitState() {
    this.onState?.({ index: this.index, kind: this.currentKind() });
  }

  setItems(items) {
    this.items = items.slice();
    if (this.index >= this.items.length) this.index = 0;
    for (const item of this.items) this.loadCover(item.cover);
    if (this.fontReady && this.gl && this.inkTargets) this.print(!this.reduced);
  }

  coverReady() {
    const item = this.currentItem();
    const wait = item ? this.waits.get(item.cover) : null;
    if (!wait) return Promise.resolve();
    return Promise.race([
      wait,
      new Promise((resolve) => setTimeout(resolve, 1600)),
    ]);
  }

  loadCover(src) {
    if (!src || this.covers.has(src)) return;
    this.covers.set(src, null);
    let settle = null;
    this.waits.set(
      src,
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      settle();
      if (this.destroyed) return;
      this.covers.set(src, image);
      const item = this.currentItem();
      if (
        item &&
        item.cover === src &&
        this.kind === "cover" &&
        this.tone === 0 &&
        !this.morph &&
        this.fontReady &&
        this.inkTargets
      )
        this.print(!this.reduced);
    };
    image.onerror = () => {
      settle();
      this.covers.delete(src);
    };
    image.src = src;
  }

  scheduleIdle(ms) {
    clearTimeout(this.idleTimer);
    if (this.reduced || this.destroyed || this.items.length === 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (this.pointer || this.morph || document.hidden || !this.visible) {
        this.scheduleIdle(IDLE_MS);
        return;
      }
      this.advance();
    }, ms);
  }

  advance() {
    if (!this.items.length) return;
    if (this.currentKind() === "cover") this.show(this.index, "title");
    else this.show((this.index + 1) % this.items.length, "cover");
  }

  toggle() {
    this.show(this.index, this.currentKind() === "cover" ? "title" : "cover");
  }

  show(index, kind) {
    if (!this.items[index]) return;
    if (index === this.index && kind === this.currentKind() && !this.morph)
      return;
    this.index = index;
    this.kind = kind;
    if (!this.gl || !this.inkTargets || !this.fontReady) return;
    if (!this.interactive || this.reduced) {
      this.print(false);
      return;
    }
    const before = this.extent || [0, 1];
    this.drawMask();
    const after = this.extent || [0, 1];
    this.runPrint(1, this.goalTarget);
    this.printStart = -1;
    this.drying = false;
    const from = Math.max(-0.08, Math.min(before[0], after[0]) - 0.08);
    const to = Math.min(1.08, Math.max(before[1], after[1]) + 0.08);
    this.morph = { t: 0, prevX: null, from, to };
    this.front = from;
    this.setStatus("wet");
    this.emitState();
    clearTimeout(this.idleTimer);
    this.wake();
  }

  sweep(dt) {
    const m = this.morph;
    m.t += dt * 1000;
    const p = Math.min(1, m.t / MORPH_MS);
    const inOut = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const eased = 0.3 * p + 0.7 * inOut;
    const front = m.from + (m.to - m.from) * eased;
    this.front = front;
    const W = this.width;
    const H = this.height;
    const x = front * W;
    const speed =
      m.prevX == null
        ? 0
        : Math.min(MAX_SPEED, Math.max(0, (x - m.prevX) / dt));
    m.prevX = x;
    if (p < 1 && speed > 1) {
      for (let i = 0; i < SWEEP_SEGMENTS; i += 1) {
        const ya = ((i / SWEEP_SEGMENTS) * 1.1 - 0.05) * H;
        const yb = (((i + 1) / SWEEP_SEGMENTS) * 1.1 - 0.05) * H;
        const xa = x + (ya / H - 0.5) * 0.1 * W;
        const xb = x + (yb / H - 0.5) * 0.1 * W;
        const wobble = Math.sin(m.t * 0.004 + i * 1.7) * speed * 0.08;
        this.queue.push([
          xa,
          ya,
          xb,
          yb,
          speed * 1.05,
          wobble,
          Math.min(speed, 1100),
          1.9,
        ]);
      }
    }
    this.lastStir = this.clock;
    if (m.t >= MORPH_MS + MORPH_HOLD_MS) {
      this.morph = null;
      this.front = 3;
      this.scheduleIdle(IDLE_MS);
      return 3;
    }
    return p < 1 ? front : 3;
  }

  setInk(id) {
    const next = INKS.find((ink) => ink.id === id);
    if (!next || next === this.ink) return;
    this.ink = next;
    if (this.fontReady) this.print(!this.reduced);
  }

  fresh() {
    if (this.fontReady) this.print(!this.reduced);
  }

  localPoint(e) {
    const rect = this.host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  baseRadius() {
    return Math.min(
      40,
      Math.max(12, Math.min(this.width, this.height) * 0.045),
    );
  }

  pointerDown(e) {
    if (!this.interactive || e.button > 0) return;
    if (e.target.closest("button, input, label, a")) return;
    this.host.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localPoint(e);
    this.pointer = {
      id: e.pointerId,
      x,
      y,
      fx: x,
      fy: y,
      vx: 0,
      vy: 0,
      speed: 0,
      points: [],
    };
    this.host.setAttribute("data-pressed", "");
    clearTimeout(this.idleTimer);
    this.placeCursor(x, y);
    this.drying = true;
    this.lastStir = this.clock;
    this.wake();
  }

  pointerMove(e) {
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      const [x, y] = this.localPoint(e);
      this.placeCursor(x, y);
    }
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() || [];
    const rect = this.host.getBoundingClientRect();
    for (const ev of events.length ? events : [e]) {
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const last = p.points.length ? p.points[p.points.length - 1] : [p.x, p.y];
      if ((x - last[0]) ** 2 + (y - last[1]) ** 2 < 0.25) continue;
      p.points.push([x, y]);
      if (p.points.length > QUEUE_LIMIT) p.points.shift();
    }
    if (p.points.length) [p.x, p.y] = p.points[p.points.length - 1];
    this.placeCursor(p.x, p.y);
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    this.pointer = null;
    if (p.points.length) this.releasing = p;
    this.host.removeAttribute("data-pressed");
    if (!this.morph) this.scheduleIdle(IDLE_MS);
    if (e.pointerType !== "mouse") this.hideCursor();
    this.wake();
  }

  collectStroke(elapsed) {
    const p = this.pointer || this.releasing;
    this.releasing = null;
    if (!p) return;
    const dx = p.x - p.fx;
    const dy = p.y - p.fy;
    let rvx = dx / elapsed;
    let rvy = dy / elapsed;
    const raw = Math.hypot(rvx, rvy);
    if (raw > MAX_SPEED) {
      rvx *= MAX_SPEED / raw;
      rvy *= MAX_SPEED / raw;
    }
    const blend = 1 - Math.exp(-elapsed / 0.035);
    p.vx += (rvx - p.vx) * blend;
    p.vy += (rvy - p.vy) * blend;
    p.speed = Math.hypot(p.vx, p.vy);
    let from = [p.fx, p.fy];
    for (const point of p.points) {
      this.queue.push([
        from[0],
        from[1],
        point[0],
        point[1],
        p.vx,
        p.vy,
        p.speed,
      ]);
      from = point;
    }
    p.points.length = 0;
    p.fx = p.x;
    p.fy = p.y;
  }

  placeCursor(x, y) {
    if (!this.cursor) return;
    const fast = this.pointer
      ? smoothstep(FAST_FROM, FAST_TO, this.pointer.speed)
      : 0;
    const r = this.baseRadius() * (1 - 0.45 * fast);
    this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / 28).toFixed(3)})`;
    this.cursor.setAttribute("data-shown", "");
  }

  hideCursor() {
    this.cursor?.removeAttribute("data-shown");
  }

  packSegments() {
    const q = this.queue;
    while (q.length > MAX_SEGMENTS) {
      const merged = [];
      for (let i = 0; i < q.length; i += 2) {
        const a = q[i];
        const b = q[i + 1];
        if (!b) merged.push(a);
        else
          merged.push([
            a[0],
            a[1],
            b[2],
            b[3],
            (a[4] + b[4]) / 2,
            (a[5] + b[5]) / 2,
            (a[6] + b[6]) / 2,
            Math.max(a[7] ?? 1, b[7] ?? 1),
          ]);
      }
      q.length = 0;
      q.push(...merged);
    }
    const s = this.simScale;
    const vs = s * (this.velWidth / this.simWidth);
    const h = this.velHeight;
    const base = this.baseRadius();
    const ink = this.ink;
    for (let i = 0; i < q.length; i += 1) {
      const [x0, y0, x1, y1, vx, vy, speed, grow = 1] = q[i];
      const fast = smoothstep(FAST_FROM, FAST_TO, speed);
      const transfer =
        ink.transferSlow + (ink.transferFast - ink.transferSlow) * fast;
      const radius = base * (1 - 0.45 * fast) * grow * vs;
      this.segData[i * 4] = x0 * vs;
      this.segData[i * 4 + 1] = h - y0 * vs;
      this.segData[i * 4 + 2] = x1 * vs;
      this.segData[i * 4 + 3] = h - y1 * vs;
      this.segVel[i * 4] = vx * s * transfer;
      this.segVel[i * 4 + 1] = -vy * s * transfer;
      this.segVel[i * 4 + 2] = Math.max(1.5, radius);
      this.segVel[i * 4 + 3] = fast;
    }
    const count = q.length;
    q.length = 0;
    return count;
  }

  stepVelocity(dt, count) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.velocity;
    const read = this.velTargets[this.velRead];
    const write = this.velTargets[1 - this.velRead];
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, this.velWidth, this.velHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(uniforms.uVelocity, 0);
    gl.uniform2f(uniforms.uRes, this.velWidth, this.velHeight);
    gl.uniform1f(uniforms.uUnit, this.velWidth / this.simWidth);
    gl.uniform1f(uniforms.uDt, dt);
    gl.uniform1f(uniforms.uDecay, Math.exp(-dt / this.ink.tau));
    gl.uniform1f(
      uniforms.uViscosity,
      1 - Math.pow(1 - this.ink.viscosity, dt * 60),
    );
    gl.uniform1i(uniforms.uCount, count);
    gl.uniform4fv(uniforms.uSeg, this.segData);
    gl.uniform4fv(uniforms.uSegV, this.segVel);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.velRead = 1 - this.velRead;
  }

  stepInk(dt, front = -10) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.ink;
    const read = this.inkTargets[this.inkRead];
    const write = this.inkTargets[1 - this.inkRead];
    const ink = this.ink;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, this.simWidth, this.simHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(uniforms.uInk, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velTargets[this.velRead].texture);
    gl.uniform1i(uniforms.uVelocity, 1);
    gl.uniform2f(uniforms.uRes, this.simWidth, this.simHeight);
    gl.uniform1f(uniforms.uDt, dt);
    gl.uniform1f(uniforms.uDrying, this.drying ? 1 : 0);
    gl.uniform1f(uniforms.uDryThin, ink.dryThin);
    gl.uniform1f(uniforms.uDryThick, ink.dryThick);
    gl.uniform1f(uniforms.uRewet, ink.rewet);
    gl.uniform1f(uniforms.uLevel, 1 - Math.pow(1 - ink.level, dt * 60));
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.goalTarget.texture);
    gl.uniform1i(uniforms.uGoal, 2);
    gl.uniform1f(uniforms.uFront, front);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.inkRead = 1 - this.inkRead;
  }

  display() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.display;
    const ink = this.ink;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTargets[this.inkRead].texture);
    gl.uniform1i(uniforms.uInk, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.uniform1i(uniforms.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paperTarget.texture);
    gl.uniform1i(uniforms.uPaper, 2);
    gl.uniform2f(uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(uniforms.uSimRes, this.simWidth, this.simHeight);
    gl.uniform3fv(uniforms.uPaperColor, PAPER);
    gl.uniform3fv(uniforms.uInkColor, ink.ink);
    gl.uniform3fv(uniforms.uThinTint, ink.thin);
    gl.uniform1f(uniforms.uGloss, ink.gloss);
    gl.uniform1f(uniforms.uPx, this.dpr);
    gl.uniform1f(uniforms.uDeboss, this.tone ? 0 : 1);
    gl.uniform1f(uniforms.uFront, this.morph ? this.front : 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dryMs() {
    return 1000 / this.ink.dryThick + 400;
  }

  updateStatus(now) {
    if (!this.interactive) return;
    if (!this.drying) {
      this.setStatus("wet");
      return;
    }
    const share = (now - this.lastStir) / this.dryMs();
    this.setStatus(share < 0.3 ? "wet" : share < 1 ? "tacky" : "dry");
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  wake() {
    if (
      this.raf ||
      this.destroyed ||
      !this.gl ||
      !this.visible ||
      document.hidden
    )
      return;
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
    if (this.destroyed || !this.inkTargets) return;
    const elapsed = this.last
      ? Math.min(0.1, Math.max(1 / 240, (now - this.last) / 1000))
      : 1 / 60;
    const dt = Math.min(1 / 30, elapsed);
    this.last = now;
    this.frameCount += 1;
    this.clock += dt * 1000;
    const clock = this.clock;
    let busy = false;
    if (this.printStart >= 0) {
      this.printStart += dt * 1000;
      const p = Math.min(1, this.printStart / PRINT_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      this.runPrint(eased);
      if (p >= 1) this.printStart = -1;
      busy = true;
      this.dirty = true;
    } else if (this.interactive && this.fontReady) {
      this.collectStroke(elapsed);
      const front = this.morph ? this.sweep(dt) : -10;
      const sweeping = front > -10;
      const count = this.queue.length ? this.packSegments() : 0;
      if (count) {
        this.velocityUntil = clock + VELOCITY_LIFE_MS;
        this.lastStir = clock;
      }
      if (this.pointer) this.lastStir = Math.max(this.lastStir, clock - 200);
      const moving = clock < this.velocityUntil;
      const dryingLeft = this.drying && clock - this.lastStir < this.dryMs();
      if (moving) this.stepVelocity(dt, count);
      if (moving || dryingLeft || sweeping) {
        this.stepInk(dt, front);
        this.dirty = true;
      }
      busy =
        moving ||
        dryingLeft ||
        sweeping ||
        Boolean(this.morph) ||
        Boolean(this.pointer);
      if (this.pointer) this.placeCursor(this.pointer.x, this.pointer.y);
    }
    if (this.dirty) {
      this.display();
      this.dirty = false;
    }
    this.updateStatus(clock);
    if (busy) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.idleTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.host.removeEventListener("pointerdown", this.handlers.down);
    this.host.removeEventListener("pointermove", this.handlers.move);
    this.host.removeEventListener("pointerup", this.handlers.up);
    this.host.removeEventListener("pointercancel", this.handlers.up);
    this.host.removeEventListener("pointerleave", this.handlers.leave);
    const gl = this.gl;
    if (!gl) return;
    this.dropTargets();
    gl.deleteTexture(this.maskTexture);
    Object.values(this.programs).forEach(({ program }) =>
      gl.deleteProgram(program),
    );
    gl.deleteShader(this.vertex);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
